#!/usr/bin/env python3
"""Assemble release component and platform metadata from the actual draft files."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tether.release import canonical_bytes, verify_signature

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

COMPONENTS = ("app", "node", "plugin")
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MIN_UPDATER_VERSION = "0.2.1"
UPDATE_PROTOCOL = 1
# Hub 镜像落盘时的单制品上限；超过的包只能从源站（GitHub/CDN）取，mirror 兜不住。
HUB_MAX_MIRROR_BYTES = 512 * 1024 * 1024
DEBIAN_ARCHITECTURES = {"amd64", "arm64"}


def digest(path: Path) -> str:
    """Stream the hash so a 900 MiB package does not need 900 MiB of RAM here."""
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def rollout_config() -> dict:
    return {"percent": 100, "include": [], "exclude": []}


def component_entry(version: str, url: str, size: int, sha256: str) -> dict:
    return {
        "version": version,
        "url": url,
        "sha256": sha256,
        "size": size,
        "protocol": UPDATE_PROTOCOL,
        "min_protocol": UPDATE_PROTOCOL,
        "min_updater": MIN_UPDATER_VERSION,
        "rollout": rollout_config(),
    }


def debian_entry(version: str, url: str, size: int, sha256: str, architecture: str) -> dict:
    return {
        "format": "deb",
        "package": "tether-node",
        "architecture": architecture,
        "version": version,
        "url": url,
        "sha256": sha256,
        "size": size,
    }


def classify(dist: Path, version: str, plugin_version: str) -> dict:
    """Map the built artifacts onto manifest slots by their release names."""
    found: dict[str, object] = {}
    for path in sorted(dist.glob("tether-app-*.zip")):
        if path.name == f"tether-app-{version}.zip":
            found["app"] = path
    for path in sorted(dist.glob("tether-node-*.zip")):
        if path.name == f"tether-node-{version}.zip":
            found["node"] = path
    for path in sorted(dist.glob("Tether-node-runtime-*.deb")):
        match = re.fullmatch(rf"Tether-node-runtime-{re.escape(version)}-linux-(x64|arm64)\.deb", path.name)
        if match:
            found.setdefault("debian", {})[{"x64": "amd64", "arm64": "arm64"}[match.group(1)]] = path
    for path in sorted(dist.glob("tether-plugin-*.zip")):
        if path.name == f"tether-plugin-{plugin_version}.zip":
            found["plugin"] = path
    return found


def assemble(dist: Path, version: str, plugin_version: str, channel: str, base_url: str,
             plugin_base_url: str | None = None, frozen_plugin: dict | None = None) -> dict:
    artifacts = classify(dist, version, plugin_version)
    if frozen_plugin is not None:
        artifacts["plugin"] = frozen_plugin
    missing = [name for name in ("app", "node", "plugin") if name not in artifacts]
    if missing:
        raise SystemExit(f"draft 目录里缺少制品：{missing}；清单不能引用不存在的包")
    base = base_url.rstrip("/") + "/"
    manifest = {
        "schema": 1,
        "channel": channel,
        "released_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "components": {},
    }
    for name in ("app", "node", "plugin"):
        if name == "plugin" and frozen_plugin is not None:
            if frozen_plugin.get("version") != plugin_version:
                raise ValueError("frozen plugin version differs from version.json")
            manifest["components"][name] = frozen_plugin
            continue
        path = artifacts[name]
        plugin_base = (plugin_base_url.rstrip("/") + "/") if (name == "plugin" and plugin_base_url) else base
        manifest["components"][name] = component_entry(
            plugin_version if name == "plugin" else version,
            f"{plugin_base}{path.name}", path.stat().st_size, digest(path))
    debian = artifacts.get("debian") or {}
    if debian:
        entry = {}
        for architecture, path in debian.items():
            entry[architecture] = debian_entry(version, f"{base}{path.name}",
                                               path.stat().st_size, digest(path), architecture)
        manifest["components"]["node"]["debian"] = entry
    return manifest


def validate(manifest: dict) -> list[str]:
    """Mirror the Hub's acceptance rules so CI fails before the upload, not after."""
    problems: list[str] = []
    if manifest.get("schema") != 1:
        problems.append("schema 必须是 1")
    if manifest.get("channel") not in {"stable", "beta", "preview"}:
        problems.append(f"channel 非法：{manifest.get('channel')}")
    if not manifest.get("signature"):
        problems.append("清单未签名，Hub 与客户端都会拒")
    components = manifest.get("components")
    if not isinstance(components, dict):
        return problems + ["缺少 components 段"]
    for name in COMPONENTS:
        entry = components.get(name)
        if not isinstance(entry, dict):
            problems.append(f"缺少 components.{name}，Hub 会整份清单判 503")
            continue
        prefix = f"components.{name}"
        version = entry.get("version")
        if not isinstance(version, str) or not SEMVER.fullmatch(version):
            problems.append(f"{prefix}.version 不是合法 semver：{version!r}")
        size = entry.get("size")
        if type(size) is not int or size <= 0:
            problems.append(f"{prefix}.size 必须是正整数，实际 {size!r}")
        if not isinstance(entry.get("sha256"), str) or not HEX64.fullmatch(str(entry.get("sha256"))):
            problems.append(f"{prefix}.sha256 缺失或不是 64 位十六进制")
        url = str(entry.get("url") or "")
        if urlsplit(url).scheme != "https":
            problems.append(f"{prefix}.url 必须是 https，实际 {url!r}")
        if type(entry.get("protocol")) is not int or entry.get("protocol") < 1:
            problems.append(f"{prefix}.protocol 非法")
        minimum = entry.get("min_protocol", 1)
        if type(minimum) is not int or type(entry.get("protocol")) is not int or not 1 <= minimum <= entry["protocol"]:
            problems.append(f"{prefix}.min_protocol 非法")
        min_updater = entry.get("min_updater")
        if not isinstance(min_updater, str) or not SEMVER.fullmatch(min_updater):
            problems.append(f"{prefix}.min_updater 非法：{min_updater!r}")
        for architecture, package in (entry.get("debian") or {}).items():
            if architecture not in DEBIAN_ARCHITECTURES:
                problems.append(f"{prefix}.debian 出现未知架构 {architecture}")
                continue
            if set(package) != {"format", "package", "architecture", "version", "url", "size", "sha256"}:
                problems.append(f"{prefix}.debian.{architecture} 字段不齐")
                continue
            if urlsplit(str(package.get("url"))).scheme != "https":
                problems.append(f"{prefix}.debian.{architecture}.url 必须是 https")
    return problems


def mirror_capacity(manifest: dict) -> list[str]:
    """Advisory only: artifacts the Hub cannot hold in its own mirror cache.

    These do not make the manifest invalid — the Hub serves the manifest and
    falls through to the origin for the oversized package. Reporting them as
    failures would train people to ignore the gate.
    """
    notes: list[str] = []
    for name, entry in (manifest.get("components") or {}).items():
        if not isinstance(entry, dict):
            continue
        for label, package in list((entry.get("debian") or {}).items()):
            size = int(package.get("size") or 0)
            if size > HUB_MAX_MIRROR_BYTES:
                notes.append(f"{name}.debian.{label} {size / 1024 / 1024:.0f} MiB > Hub 镜像上限 "
                             f"{HUB_MAX_MIRROR_BYTES // 1024 // 1024} MiB：只能走源站带宽")
        size = int(entry.get("size") or 0)
        if size > HUB_MAX_MIRROR_BYTES:
            notes.append(f"components.{name} {size / 1024 / 1024:.0f} MiB > Hub 镜像上限："
                         "mirror 兜不住这个包")
    return notes


def collect_matrix(inputs: Path, output: Path, version: str, channel: str, base_url: str) -> dict:
    """Collect native installers and both Node architectures beside the component ZIPs."""
    import shutil
    import yaml

    seed = json.loads((output / "tether-update.json").read_text(encoding="utf-8"))
    verify_signature(seed)
    plugin_version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["plugin"]
    mac_feeds = []
    feed = "latest" if channel == "stable" else channel
    platforms = {"app": {}, "node": {}}
    for target in ("windows-x64", "linux-x64", "linux-arm64", "macos-arm64", "macos-x64"):
        directory = inputs / f"tether-{version}-{target}"
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            name = path.name
            if name == f"{feed}-mac.yml":
                metadata = yaml.safe_load(path.read_text(encoding="utf-8"))
                arch = target.removeprefix("macos-")
                if (not target.startswith("macos-") or str(metadata["version"]) != version
                        or not any(item["url"].endswith(f"-{arch}.zip") for item in metadata["files"])):
                    raise ValueError(f"missing architecture-specific macOS ZIP in {target} feed")
                mac_feeds.append(metadata)
                continue
            if name in {"SHA256SUMS", "SHA256SUMS.json", "signing-status.json"}:
                name = f"{path.stem}-{target}{path.suffix}"
            destination = output / name
            if destination.exists():
                raise ValueError(f"duplicate release asset {name}")
            shutil.move(str(path), destination)
            kind = None
            if name == f"Tether-node-runtime-{version}-{target}.tar.gz":
                kind, fmt = "node", "tar.gz"
            elif (target == "windows-x64" and name.endswith(".exe")
                  or target.startswith("macos-") and name.endswith(".dmg")
                  or target == "linux-x64" and name.endswith(".AppImage")):
                kind, fmt = "app", destination.suffix[1:]
            if kind:
                if target in platforms[kind]:
                    raise ValueError(f"multiple {kind} installers for {target}")
                platforms[kind][target] = {"url": f"{base_url}/{name}", "size": destination.stat().st_size,
                                           "sha256": digest(destination), "format": fmt}
    if set(platforms["app"]) != {"windows-x64", "linux-x64", "macos-x64", "macos-arm64"}:
        raise ValueError("matrix is missing a desktop installer")
    if set(platforms["node"]) != {"linux-x64", "linux-arm64"}:
        raise ValueError("matrix is missing a Linux Node archive")
    if len(mac_feeds) != 2:
        raise ValueError("both macOS update feeds are required")
    merged = mac_feeds[0].copy()
    for obsolete in ("path", "sha512", "sha2"):
        merged.pop(obsolete, None)
    merged["files"] = [file for metadata in mac_feeds for file in metadata["files"]]
    (output / f"{feed}-mac.yml").write_text(yaml.safe_dump(merged, sort_keys=False), encoding="utf-8")
    for suffix in ("", "-linux", "-mac"):
        metadata = yaml.safe_load((output / f"{feed}{suffix}.yml").read_text(encoding="utf-8"))
        if (str(metadata["version"]) != version or not metadata.get("files") or not all(
                Path(file["url"]).name == file["url"] and file.get("sha512")
                and (output / file["url"]).is_file() for file in metadata["files"])):
            raise ValueError(f"incomplete Electron update feed: {feed}{suffix}.yml")
    assembled = assemble(output, version, plugin_version, channel, base_url, frozen_plugin=seed["components"]["plugin"])
    debian = assembled["components"]["node"].get("debian", {})
    if set(debian) != {"amd64", "arm64"}:
        raise ValueError("matrix is missing a Linux Node DEB")
    if seed["channel"] != channel:
        raise ValueError("matrix channel differs from signed component manifest")
    for kind, targets in platforms.items():
        signed = seed["components"][kind]
        actual = assembled["components"][kind]
        if any(signed[key] != actual[key] for key in ("version", "size", "sha256")):
            raise ValueError(f"{kind} ZIP differs from signed component manifest")
        signed.update(url=actual["url"], platforms=targets)
    seed["components"]["node"]["debian"] = debian
    del seed["signature"]
    return seed


def main() -> int:
    parser = argparse.ArgumentParser(description="装配并校验 tether-update.json")
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("assemble", help="从 draft 制品目录装配清单")
    build.add_argument("--dist", required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--plugin-version", default=None)
    build.add_argument("--channel", default="preview", choices=("stable", "beta", "preview"))
    build.add_argument("--base-url", required=True, help="本批 release 的下载前缀")
    build.add_argument("--plugin-base-url", default=None, help="插件固定发行所在前缀")
    build.add_argument("--out", required=True)
    matrix = sub.add_parser("matrix", help="assemble and sign the matrix draft")
    matrix.add_argument("--inputs", type=Path, required=True)
    matrix.add_argument("--dist", type=Path, required=True)
    matrix.add_argument("--base-url", required=True)
    matrix.add_argument("--version", required=True)
    matrix.add_argument("--channel", choices=("stable", "preview"), required=True)
    check = sub.add_parser("validate", help="只校验一份现成清单")
    check.add_argument("--manifest", required=True)
    args = parser.parse_args()

    if args.command == "matrix":
        from scripts.build_release import release_private_key

        manifest = collect_matrix(args.inputs, args.dist, args.version, args.channel, args.base_url)
        key = release_private_key()
        if key is None:
            raise SystemExit("TETHER_RELEASE_PRIVATE_KEY is required")
        manifest["signature"] = base64.b64encode(key.sign(canonical_bytes(manifest))).decode("ascii")
        verify_signature(manifest)
        problems = validate(manifest)
        if problems:
            raise SystemExit("\n".join(problems))
        (args.dist / "tether-update.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        files = sorted(path for path in args.dist.iterdir() if path.is_file() and path.name != "SHA256SUMS")
        (args.dist / "SHA256SUMS").write_text("".join(f"{digest(path)}  {path.name}\n" for path in files), encoding="ascii")
        return 0
    if args.command == "validate":
        path = Path(args.manifest)
        if not path.is_file():
            print(f"清单不存在：{path}", file=sys.stderr)
            return 2
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"清单不是合法 JSON：{exc}", file=sys.stderr)
            return 2
    else:
        plugin_version = args.plugin_version
        if not plugin_version:
            plugin_version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["plugin"]
        manifest = assemble(Path(args.dist), args.version, plugin_version, args.channel,
                            args.base_url, args.plugin_base_url)
        Path(args.out).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已写出待签名清单 {args.out}")
        return 0

    problems = validate(manifest)
    notes = mirror_capacity(manifest)
    for item in problems:
        print(f"[hub-shape] {item}")
    for item in notes:
        print(f"[mirror-capacity] {item}")
    if problems:
        print(f"\nFAIL：这份清单会被 Hub 判 503，共 {len(problems)} 项")
        return 1
    node = manifest.get("components", {}).get("node", {})
    print("PASS：Hub 收得下这份清单；components=%s debian=%s"
          % (",".join(sorted(manifest.get("components", {}))), ",".join(sorted(node.get("debian", {})))))
    if notes:
        print("提示：以下包超出 Hub 镜像容量，更新时走源站带宽（不是失败项）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
