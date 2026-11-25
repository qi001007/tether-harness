#!/usr/bin/env python3
"""装配并校验 tether-update.json，使 Hub 一定收得下这份清单。

为什么要单独一个脚本：`.github/workflows/release-matrix.yml` 里内联重写了一遍
清单装配，产出的 components 只有 app/node 且没有 flat url/sha256/size。Hub 的
`_valid_manifest`（tether-harness-server/tether_server/controller/releases.py）要求
app/node/plugin 三段各自带 version/size/sha256/url/protocol/min_protocol/min_updater，
整份不合格就 503 manifest_unavailable —— 也就是说草稿一旦推到 Hub，所有人的更新页
一起变红。装配只有一个实现，CI 和 `scripts/build_release.py` 都走它。

    python scripts/assemble_release_manifest.py assemble \
        --dist .scratch/release-draft --version 0.5.15 --channel preview \
        --base-url https://github.com/<owner>/<repo>/releases/download/v0.5.15-preview.1 \
        --out .scratch/release-draft/tether-update.json

    python scripts/assemble_release_manifest.py validate --manifest <path>

顺序是 assemble → 签名 → validate：assemble 产出的清单还没有 signature，直接
validate 必然判失败，这是有意的——未签清单本来就不许推。

退出码：0 = 通过；1 = 清单会被 Hub 拒收；2 = 输入缺失或读不了。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

COMPONENTS = ("app", "node", "plugin")
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MIN_UPDATER_VERSION = "0.2.1"
UPDATE_PROTOCOL = 1
# 与 Hub 端 _valid_manifest 同一条上限；超过它 Hub 会直接判整份清单无效。
HUB_MAX_COMPONENT_BYTES = 512 * 1024 * 1024
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
             plugin_base_url: str | None = None) -> dict:
    artifacts = classify(dist, version, plugin_version)
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
        if not isinstance(size, int) or not 0 < size <= HUB_MAX_COMPONENT_BYTES:
            problems.append(f"{prefix}.size 必须是 0<{HUB_MAX_COMPONENT_BYTES} 的整数，实际 {size!r}")
        if not isinstance(entry.get("sha256"), str) or not HEX64.fullmatch(str(entry.get("sha256"))):
            problems.append(f"{prefix}.sha256 缺失或不是 64 位十六进制")
        url = str(entry.get("url") or "")
        if urlsplit(url).scheme != "https":
            problems.append(f"{prefix}.url 必须是 https，实际 {url!r}")
        if type(entry.get("protocol")) is not int or entry.get("protocol") < 1:
            problems.append(f"{prefix}.protocol 非法")
        if type(entry.get("min_protocol", 1)) is not int:
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
    check = sub.add_parser("validate", help="只校验一份现成清单")
    check.add_argument("--manifest", required=True)
    args = parser.parse_args()

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
        print(f"已写出 {args.out}")

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
