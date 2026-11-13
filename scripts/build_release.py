#!/usr/bin/env python3
"""Build standalone plugin and APP archives (no repository clone needed)."""
from __future__ import annotations

import argparse
import base64
import copy
import json
import hashlib
import os
import re
import sys
import stat
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tether.release import ReleaseSignatureError, canonical_bytes, verify_signature  # noqa: E402

OUT = ROOT / "release"
VERSION = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["app"]
MIN_UPDATER_VERSION = "0.2.1"
SKIP = {"node_modules", "data", "__pycache__", ".pytest_cache", ".venv", ".git", "release",
        ".aws", ".dsh", ".ssh", "credentials"}


def add_tree(archive: zipfile.ZipFile, src: Path, prefix: str, *, plugin_version: str | None = None) -> None:
    for path in src.rglob("*"):
        relative = path.relative_to(ROOT).as_posix()
        if relative.startswith("packages/tether-dsh-surface/updater/"):
            continue
        if path.is_symlink() or any(part in SKIP or part.startswith(".env") or part == ".credentials.yaml"
                                    for part in path.parts):
            continue
        if path.is_file():
            if relative == "packages/dsh-plugin-tether-client/lib/client.js" and plugin_version is not None:
                source = path.read_text(encoding="utf-8")
                source = re.sub(r"(\bPLUGIN_VERSION\s*=\s*['\"])[^'\"]+(['\"])",
                                rf"\g<1>{plugin_version}\g<2>", source, count=1)
                archive.writestr(f"{prefix}/{relative}", source.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
            else:
                archive.write(path, f"{prefix}/{relative}")


def add_file(archive: zipfile.ZipFile, rel: str, prefix: str) -> None:
    path = ROOT / rel
    if path.exists():
        if rel == "laptop/install-node.sh":
            payload = path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            archive.writestr(f"{prefix}/{rel}", payload, compress_type=zipfile.ZIP_DEFLATED)
        else:
            archive.write(path, f"{prefix}/{rel}")


def add_mapped_file(archive: zipfile.ZipFile, source: str, target: str, prefix: str) -> None:
    path = ROOT / source
    if path.is_file():
        archive.write(path, f"{prefix}/{target}")


def add_tether_runtime(archive: zipfile.ZipFile, prefix: str, *, target_platform: str | None = None) -> None:
    """Add only the public client/Node runtime; Controller and web admin UI are private."""
    for rel in ("tether/__init__.py", "tether/updates.py", "tether/updates_cli.py",
                "tether/release.py", "tether/ed25519.py", "tether/mcp_server.py"):
        add_file(archive, rel, prefix)
    node = ROOT / "tether" / "node"
    windows_excluded_runtime_files = {
        "bin/herdr-linux-x86_64",
        "bin/herdr-macos-x86_64",
        "bin/herdr-macos-aarch64",
        "bin/croc-linux-x64",
        "bin/croc-darwin-x64",
        "bin/croc-darwin-arm64",
    }
    for path in node.rglob("*"):
        if path.is_file() and not path.is_symlink() and (
                path.suffix in {".py", ".html"} or "bin" in path.relative_to(node).parts):
            if target_platform == "windows" and path.relative_to(node).as_posix() in windows_excluded_runtime_files:
                continue
            rel = path.relative_to(ROOT).as_posix()
            if "__pycache__" not in path.parts:
                archive.write(path, f"{prefix}/{rel}")


def add_windows_herdr_runtime(archive: zipfile.ZipFile, prefix: str, herdr_runtime: Path) -> None:
    from scripts.hydrate_herdr_runtime import verify_windows_runtime

    herdr_runtime = Path(herdr_runtime)
    relatives = verify_windows_runtime(herdr_runtime)
    targets = [f"{prefix}/tether/node/bin/{relative}" for relative in relatives]
    existing = {item.filename for item in archive.infolist()}
    duplicate = next((target for target in targets if target in existing), None)
    if duplicate is not None:
        raise ValueError(f"Node ZIP already contains Herdr runtime member: {duplicate}")
    for relative, target in zip(relatives, targets, strict=True):
        archive.write(herdr_runtime / relative, target)


def release_private_key():
    material = os.environ.get("TETHER_RELEASE_PRIVATE_KEY", "").strip()
    key_file = os.environ.get("TETHER_RELEASE_PRIVATE_KEY_FILE", "").strip()
    if not material and key_file:
        material = Path(key_file).read_text(encoding="ascii").strip()
    if not material:
        if os.environ.get("TETHER_REQUIRE_SIGNED_RELEASE", "") == "1":
            raise SystemExit("TETHER_RELEASE_PRIVATE_KEY is required for a signed release")
        return None
    try:
        seed = base64.b64decode(material.encode("ascii"), validate=True)
    except (ValueError, UnicodeError):
        raise SystemExit("TETHER_RELEASE_PRIVATE_KEY must be base64-encoded")
    if len(seed) != 32:
        raise SystemExit("TETHER_RELEASE_PRIVATE_KEY must contain a 32-byte Ed25519 seed")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    return Ed25519PrivateKey.from_private_bytes(seed)


def rollout_config() -> dict:
    percent_text = os.environ.get("TETHER_ROLLOUT_PERCENT", "100").strip() or "100"
    try:
        percent = int(percent_text)
    except ValueError:
        raise SystemExit("TETHER_ROLLOUT_PERCENT must be an integer")
    if not 0 <= percent <= 100:
        raise SystemExit("TETHER_ROLLOUT_PERCENT must be between 0 and 100")
    include = [item.strip() for item in os.environ.get("TETHER_ROLLOUT_INCLUDE", "").split(",") if item.strip()]
    exclude = [item.strip() for item in os.environ.get("TETHER_ROLLOUT_EXCLUDE", "").split(",") if item.strip()]
    rollout = {"percent": percent, "include": include, "exclude": exclude}
    if os.environ.get("TETHER_ROLLOUT_HOLD", "") == "1":
        rollout["hold"] = True
    return rollout


def load_frozen_plugin(manifest_path: Path, archive_path: Path) -> tuple[dict, dict, str]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise ValueError("frozen plugin manifest is unreadable JSON") from exc
    if not isinstance(manifest, dict) or manifest.get("schema") != 1 or manifest.get("channel") != "stable":
        raise ValueError("frozen plugin manifest schema is unsupported")
    try:
        verify_signature(manifest)
    except ReleaseSignatureError as exc:
        raise ValueError(f"frozen plugin manifest signature is invalid: {exc.code}") from None
    components = manifest.get("components")
    entry = components.get("plugin") if isinstance(components, dict) else None
    if not isinstance(entry, dict):
        raise ValueError("frozen plugin manifest is missing its plugin component")
    version = entry.get("version")
    if not isinstance(version, str) or not re.fullmatch(
            r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("frozen plugin version is invalid")
    expected_name = f"tether-plugin-{version}.zip"
    if archive_path.name != expected_name:
        raise ValueError(f"frozen plugin archive must be named {expected_name}")
    parsed = urlsplit(str(entry.get("url") or ""))
    expected_url = f"/qi001007/tether-harness/releases/download/v{version}/{expected_name}"
    if (parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.path != expected_url
            or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise ValueError("frozen plugin URL does not identify its official versioned GitHub asset")
    size = entry.get("size")
    digest_expected = entry.get("sha256")
    if type(size) is not int or size <= 0 or not isinstance(digest_expected, str) \
            or not re.fullmatch(r"[0-9a-f]{64}", digest_expected):
        raise ValueError("frozen plugin size or SHA-256 is invalid")
    if archive_path.stat().st_size != size:
        raise ValueError("frozen plugin archive size does not match its signed manifest")
    digest = hashlib.sha256()
    with archive_path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != digest_expected:
        raise ValueError("frozen plugin archive SHA-256 does not match its signed manifest")

    root_prefix = f"tether-plugin-{version}/"
    packages: dict[str, bytes] = {}
    package_versions: dict[str, str] = {}
    seen: set[str] = set()
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for info in archive.infolist():
                raw = info.filename
                name = raw[:-1] if info.is_dir() and raw.endswith("/") else raw
                parts = name.split("/")
                mode = (info.external_attr >> 16) & 0xFFFF
                if (not name or "\\" in name or ":" in parts[0] or name.startswith("/")
                        or any(part in {"", ".", ".."} for part in parts)
                        or stat.S_ISLNK(mode)):
                    raise ValueError("frozen plugin archive contains an unsafe path or file type")
                if not raw.startswith(root_prefix):
                    raise ValueError("frozen plugin archive has an unexpected top-level path")
                if raw in seen:
                    raise ValueError("frozen plugin archive contains duplicate paths")
                seen.add(raw)
                if info.is_dir():
                    continue
                relative = raw[len(root_prefix):]
                if relative.startswith("packages/"):
                    packages[relative] = archive.read(info)
                    package_parts = relative.split("/")
                    if len(package_parts) == 3 and package_parts[2] == "package.json":
                        data = json.loads(packages[relative].decode("utf-8"))
                        package_versions[package_parts[1]] = str(data.get("version") or "")
    except (OSError, zipfile.BadZipFile, UnicodeError, ValueError) as exc:
        if isinstance(exc, ValueError) and str(exc).startswith("frozen plugin archive"):
            raise
        raise ValueError("frozen plugin archive is invalid") from exc
    required_packages = {
        "dsh-plugin-tether", "dsh-plugin-tether-client",
        "tether-dsh-native-ui", "tether-dsh-surface",
    }
    if not packages or not required_packages.issubset(package_versions):
        raise ValueError("frozen plugin archive is missing required DSH package manifests")
    if any(package_versions[name] != version for name in required_packages):
        raise ValueError("frozen plugin package versions do not match the signed manifest")
    return manifest, copy.deepcopy(entry), root_prefix


def add_frozen_plugin_packages(archive: zipfile.ZipFile, archive_path: Path,
                               root_prefix: str, target_prefix: str) -> None:
    with zipfile.ZipFile(archive_path) as frozen:
        for info in frozen.infolist():
            if info.is_dir() or not info.filename.startswith(root_prefix + "packages/"):
                continue
            relative = info.filename[len(root_prefix):]
            archive.writestr(f"{target_prefix}/{relative}", frozen.read(info),
                             compress_type=zipfile.ZIP_DEFLATED)


def validate_versions(frozen_plugin_version: str | None = None) -> dict[str, str]:
    components = json.loads((ROOT / "version.json").read_text(encoding="utf-8")).get("components")
    if not isinstance(components, dict) or set(components) != {"app", "plugin", "node"}:
        raise ValueError("version.json must define app, plugin, and node versions")
    if components["app"] != components["node"]:
        raise ValueError("APP and Node release versions must match")
    if frozen_plugin_version is None and components["plugin"] != components["app"]:
        raise ValueError("a differing plugin version requires an explicitly verified frozen plugin")
    if frozen_plugin_version is not None and components["plugin"] != frozen_plugin_version:
        raise ValueError("version.json plugin version does not match the frozen plugin manifest")
    version = components["app"]
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    project_match = re.search(r"(?ms)^\[project\]\s*.*?^version\s*=\s*['\"]([^'\"]+)", pyproject)
    if not project_match or project_match.group(1) != version:
        raise ValueError("pyproject.toml version does not match version.json")
    package_paths = [ROOT / "apps/tether-app/package.json"]
    if frozen_plugin_version is None:
        package_paths.extend(ROOT / "packages" / name / "package.json" for name in (
            "dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface"))
    for path in package_paths:
        package = json.loads(path.read_text(encoding="utf-8"))
        expected = version if path == ROOT / "apps/tether-app/package.json" else components["plugin"]
        if package.get("version") != expected:
            raise ValueError(f"{path.relative_to(ROOT)} version does not match version.json")
    return {name: str(components[name]) for name in ("app", "plugin", "node")}


def archive_compatibility(path: Path, component: str, *, max_archive_bytes: int,
                          max_file_bytes: int, max_files: int, max_compression_ratio: int,
                          allowed: tuple[str, ...]) -> dict:
    issues = []
    size = path.stat().st_size
    if size > max_archive_bytes:
        issues.append(f"archive exceeds {max_archive_bytes} byte limit ({size})")
    largest = (0, "")
    rejected = []
    with zipfile.ZipFile(path) as archive:
        files = [item for item in archive.infolist() if not item.is_dir()]
        if len(files) > max_files:
            issues.append(f"archive has {len(files)} files; limit is {max_files}")
        for item in files:
            relative = item.filename.split("/", 1)[-1]
            largest = max(largest, (item.file_size, relative))
            if item.file_size > max_file_bytes:
                issues.append(f"member exceeds {max_file_bytes} byte limit: {relative} ({item.file_size})")
            if item.file_size and (not item.compress_size or item.file_size / item.compress_size > max_compression_ratio):
                issues.append(f"member exceeds compression ratio {max_compression_ratio}: {relative}")
            if relative == "version.json" or relative in {"README-INSTALL.md", ".env.example"}:
                continue
            if component == "app":
                if relative == "pyproject.toml":
                    continue
                if relative.startswith("tether/") and relative not in allowed:
                    continue
                if relative.startswith("packages/tether-ui/"):
                    continue
            if component == "node" and relative.startswith("tether/") and Path(relative).name in {"description.md", "backlog.md"}:
                continue
            if not (any(relative.startswith(prefix) for prefix in allowed if prefix.endswith("/")) or relative in allowed):
                rejected.append(relative)
        if rejected:
            issues.append("files rejected by updater allowlist: " + ", ".join(rejected[:8]))
    return {"compatible": not issues, "issues": issues, "archive_bytes": size,
            "largest_member": {"path": largest[1], "bytes": largest[0]}}


def preflight_release_archives(archives: dict[str, Path]) -> dict[str, dict]:
    from tether.updates import (APP_ALLOWED, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_FILES,
                                MAX_COMPRESSION_RATIO, MAX_FILE_BYTES, NODE_ALLOWED)

    legacy_limits = {"max_archive_bytes": 100 * 1024 * 1024,
                     "max_file_bytes": 32 * 1024 * 1024,
                     "max_files": 4096, "max_compression_ratio": 150}
    legacy_allowed = {
        "app": ("apps/tether-app/", "packages/tether-ui/src/", "packages/tether-ui/web/", "assets/",
                "tether/__init__.py", "tether/updates.py", "tether/updates_cli.py", "tether/release.py",
                "tether/ed25519.py", "desktop/install-app.ps1", "desktop/install-app.cmd", "version.json"),
        "node": ("tether/", "laptop/tether-node.ps1", "laptop/bootstrap-node.ps1", "laptop/install-node.sh",
                 "pyproject.toml", "version.json"),
    }
    current_allowed = {"app": APP_ALLOWED, "node": NODE_ALLOWED}
    current_limits = {"max_archive_bytes": MAX_ARCHIVE_BYTES, "max_file_bytes": MAX_FILE_BYTES,
                      "max_files": MAX_ARCHIVE_FILES, "max_compression_ratio": MAX_COMPRESSION_RATIO}
    reports = {}
    for component, path in archives.items():
        current = archive_compatibility(path, component, **current_limits, allowed=current_allowed[component])
        legacy = archive_compatibility(path, component, **legacy_limits, allowed=legacy_allowed[component])
        reports[component] = {"current": current, "legacy_0.3.6": legacy}
        print(f"{component} updater preflight: current={current}; legacy_0.3.6={legacy}")
        if not current["compatible"]:
            raise ValueError(f"{component} archive cannot be applied by the current updater: {'; '.join(current['issues'])}")
    return reports


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Build local Tether component release archives")
    parser.add_argument("--frozen-plugin-manifest", type=Path)
    parser.add_argument("--frozen-plugin-archive", type=Path)
    parser.add_argument("--release-tag")
    parser.add_argument("--channel", choices=("stable", "preview"), default="stable")
    parser.add_argument("--node-deb", type=Path)
    parser.add_argument("--herdr-runtime", type=Path,
                         help="directory containing the pinned, hydrated Windows Herdr/ConPTY files")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args(argv)
    if bool(args.frozen_plugin_manifest) != bool(args.frozen_plugin_archive):
        parser.error("--frozen-plugin-manifest and --frozen-plugin-archive must be supplied together")
    frozen = None
    if args.frozen_plugin_manifest:
        frozen = load_frozen_plugin(args.frozen_plugin_manifest, args.frozen_plugin_archive)
    if args.channel == "preview":
        if not args.node_deb or not frozen or frozen[1].get("version") != "0.2.93":
            parser.error("preview requires the frozen 0.2.93 plugin manifest/archive and the signed Node Debian asset")
    versions = validate_versions(frozen[1]["version"] if frozen else None)
    version = versions["app"]
    plugin_version = versions["plugin"]
    release_tag = args.release_tag or f"v{version}"
    if args.channel == "stable":
        if release_tag != f"v{version}":
            parser.error("stable release tag must match the APP/Node component version")
    elif not re.fullmatch(
        rf"v{re.escape(version)}-preview\.[1-9][0-9]*", release_tag
    ):
        parser.error("preview release tag must be v<APP/Node version>-preview.<positive integer>")
    node_deb = args.node_deb.resolve() if args.node_deb else None
    herdr_runtime = args.herdr_runtime.resolve() if args.herdr_runtime else None
    if node_deb is not None:
        if not node_deb.is_file():
            parser.error("--node-deb must name an existing Debian package")
        try:
            fields = [subprocess.run(
                ["dpkg-deb", "--field", str(node_deb), name],
                check=True, capture_output=True, text=True).stdout.strip()
                for name in ("Package", "Version", "Architecture")]
        except (OSError, subprocess.CalledProcessError):
            parser.error("--node-deb requires dpkg-deb to verify package metadata")
        if fields != ["tether-node", version, "amd64"]:
            parser.error("--node-deb must be Package=tether-node, matching version, Architecture=amd64")
    output_dir = args.output_dir.resolve() if args.output_dir else OUT
    output_dir.mkdir(parents=True, exist_ok=True)
    stage_dir = tempfile.TemporaryDirectory(prefix=".build-release-", dir=output_dir)
    stage = Path(stage_dir.name)
    plugin_prefix = f"tether-plugin-{plugin_version}"
    app_prefix = f"tether-app-{version}"

    plugin = stage / f"tether-plugin-{plugin_version}.zip"
    if frozen is None:
        with zipfile.ZipFile(plugin, "w", zipfile.ZIP_DEFLATED) as archive:
            add_file(archive, "desktop/install-plugin.ps1", plugin_prefix)
            add_file(archive, "scripts/build-native-ui-bridge.mjs", plugin_prefix)
            add_file(archive, "version.json", plugin_prefix)
            for package in ("dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface"):
                add_tree(archive, ROOT / "packages" / package, plugin_prefix, plugin_version=plugin_version)
            for rel in ("tether/__init__.py", "tether/updates.py", "tether/updates_cli.py",
                        "tether/release.py", "tether/ed25519.py",
                        "tether/node/__init__.py", "tether/node/dsh_sessions.py",
                        "tether/node/dsh_restart.py"):
                add_mapped_file(archive, rel, f"packages/tether-dsh-surface/updater/{rel}", plugin_prefix)
            archive.writestr(f"{plugin_prefix}/README-INSTALL.md", """# Tether DSH plugin (standalone)

1. Close DeepSeek Harness.
2. Run `desktop\\install-plugin.ps1` from this folder.
3. Start DeepSeek Harness and open Tether in the sidebar.

This archive contains only the DSH plugin. It does not install the APP or a Node.
Open Tether and use its connection page to configure the service address and credentials.
The plugin is a client: it can connect to a Hub and control devices that run a Node.
It does NOT make this machine a target by itself. To be controlled, also install the
Node ZIP (or the APP, whose supervisor can start a Node). This archive does not install
or start a server.
""")

    app = stage / f"tether-app-{version}.zip"
    with zipfile.ZipFile(app, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tree(archive, ROOT / "apps" / "tether-app", app_prefix)
        add_tree(archive, ROOT / "packages" / "tether-ui", app_prefix)
        add_tether_runtime(archive, app_prefix, target_platform="windows")
        add_tree(archive, ROOT / "assets", app_prefix)
        for rel in ("pyproject.toml", ".env.example", "version.json", "desktop/install-app.ps1", "desktop/install-app.cmd"):
            add_file(archive, rel, app_prefix)
        archive.writestr(f"{app_prefix}/README-INSTALL.md", """# Tether APP (standalone)

Run `apps\\tether-app\\Tether-App.vbs` (or `desktop\\install-app.ps1` for a shortcut).
The launcher creates `.venv`, installs Python deps once, installs Electron once.

This archive contains only the APP. It does not install the DSH plugin or a Hub.
To use a Hub, create `apps\\tether-app\\data\\hub.json` with url/accessToken/nodeToken.
When `nodeToken` is present, the APP supervisor starts a local Node and this machine
can be controlled by other devices. The DeepSeek Harness desktop app must be installed
for native DSH sessions; the DSH plugin is optional.
Without a Hub, the APP starts a local private Controller and Node only when the private
tether-harness-server component is installed. Otherwise, configure a Hub or install that component.
""")

    node_prefix = f"tether-node-{version}"
    node = stage / f"tether-node-{version}.zip"
    with zipfile.ZipFile(node, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tether_runtime(archive, node_prefix)
        if herdr_runtime is not None:
            add_windows_herdr_runtime(archive, node_prefix, herdr_runtime)
        if frozen is None:
            for package in ("dsh-plugin-tether", "dsh-plugin-tether-client",
                            "tether-dsh-native-ui", "tether-dsh-surface"):
                add_tree(archive, ROOT / "packages" / package, node_prefix, plugin_version=plugin_version)
        else:
            add_frozen_plugin_packages(archive, args.frozen_plugin_archive, frozen[2], node_prefix)
        for rel in ("laptop/tether-node.ps1", "laptop/bootstrap-node.ps1",
                    "laptop/install-node.sh", "pyproject.toml", "version.json"):
            add_file(archive, rel, node_prefix)
        add_file(archive, "THIRD_PARTY_NOTICES.md", node_prefix)
        archive.writestr(f"{node_prefix}/README-INSTALL.md", """# Tether Node (standalone)

Install the Python dependencies listed in `pyproject.toml`, then run
`laptop\\bootstrap-node.ps1` with `-ControllerUrl` and `-Token`, or create a
local `.env` containing `TETHER_CONTROLLER` and `TETHER_NODE_TOKEN`. Configure
the Hub WebSocket URL to end in `/ws/node`. Existing `.env` files are kept;
missing configuration is reported without starting against placeholders.
On Linux or macOS run `bash laptop/install-node.sh --controller <ws-url> --token <token>`
(the script creates its own venv and launcher).
Device name defaults to this computer's hostname.

The Node is a headless target-device agent: it has no chat UI and is controlled
from an APP or DSH plugin on another device. It connects outbound to the Hub;
no inbound port or Tailscale/VPN is required. This archive contains the Node
backend and launch/bootstrap scripts; it does not install APP or modify a
DeepSeek Harness profile.
""")

    preflight_release_archives({"app": app, "node": node})
    rollout = rollout_config()
    manifest = {"schema": 1, "channel": args.channel,
                "released_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "components": {}}
    for component, archive in (("app", app), ("node", node)):
        payload = archive.read_bytes()
        manifest["components"][component] = {
            "version": version,
            "url": f"https://github.com/qi001007/tether-harness/releases/download/{release_tag}/{archive.name}",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
            "protocol": 1,
            "min_protocol": 1,
            "min_updater": MIN_UPDATER_VERSION,
            "rollout": rollout,
        }
    if node_deb is not None:
        payload = node_deb.read_bytes()
        node_entry = manifest["components"]["node"]
        node_entry["debian"] = {"amd64": {
            "format": "deb", "package": "tether-node", "architecture": "amd64",
            "version": version,
            "url": f"https://github.com/qi001007/tether-harness/releases/download/{release_tag}/{node_deb.name}",
            "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload),
        }}
        node_deb_stage = stage / node_deb.name
        node_deb_stage.write_bytes(payload)
    else:
        node_deb_stage = None
    if frozen is None:
        payload = plugin.read_bytes()
        manifest["components"]["plugin"] = {
            "version": plugin_version,
            "url": f"https://github.com/qi001007/tether-harness/releases/download/v{plugin_version}/{plugin.name}",
            "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload), "protocol": 1,
            "min_protocol": 1, "min_updater": MIN_UPDATER_VERSION, "rollout": rollout,
        }
    else:
        manifest["components"]["plugin"] = frozen[1]
    key = release_private_key()
    if args.channel == "preview" and key is None:
        raise SystemExit("TETHER_RELEASE_PRIVATE_KEY is required for a signed preview candidate")
    if key is not None:
        manifest["signature"] = base64.b64encode(key.sign(canonical_bytes(manifest))).decode("ascii")
        verify_signature(manifest)
    manifest_path = stage / "tether-update.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    staged_artifacts = ((plugin,) if frozen is None else ()) + (app, node) + ((node_deb_stage,) if node_deb_stage else ()) + (manifest_path,)
    final_artifacts = []
    for archive in staged_artifacts:
        destination = output_dir / archive.name
        os.replace(archive, destination)
        final_artifacts.append(destination)
    stage_dir.cleanup()
    for archive in final_artifacts:
        print(archive.name, archive.stat().st_size)
    print("signed" if key is not None else "unsigned development manifest")


if __name__ == "__main__":
    main()
