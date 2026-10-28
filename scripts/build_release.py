#!/usr/bin/env python3
"""Build standalone plugin and APP archives (no repository clone needed)."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tether.release import canonical_bytes, verify_signature  # noqa: E402

OUT = ROOT / "release"
VERSION = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["app"]
MIN_UPDATER_VERSION = "0.2.1"
SKIP = {"node_modules", "data", "__pycache__", ".pytest_cache", ".venv", ".git", "release",
        ".aws", ".dsh", ".ssh", "credentials"}


def add_tree(archive: zipfile.ZipFile, src: Path, prefix: str) -> None:
    for path in src.rglob("*"):
        relative = path.relative_to(ROOT).as_posix()
        if relative.startswith("packages/tether-dsh-surface/updater/"):
            continue
        if path.is_symlink() or any(part in SKIP or part.startswith(".env") or part == ".credentials.yaml"
                                    for part in path.parts):
            continue
        if path.is_file():
            if relative == "packages/dsh-plugin-tether-client/lib/client.js":
                source = path.read_text(encoding="utf-8")
                source = re.sub(r"(\bPLUGIN_VERSION\s*=\s*['\"])[^'\"]+(['\"])",
                                rf"\g<1>{VERSION}\g<2>", source, count=1)
                archive.writestr(f"{prefix}/{relative}", source.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
            else:
                archive.write(path, f"{prefix}/{relative}")


def add_file(archive: zipfile.ZipFile, rel: str, prefix: str) -> None:
    path = ROOT / rel
    if path.exists():
        archive.write(path, f"{prefix}/{rel}")


def add_mapped_file(archive: zipfile.ZipFile, source: str, target: str, prefix: str) -> None:
    path = ROOT / source
    if path.is_file():
        archive.write(path, f"{prefix}/{target}")


def add_tether_runtime(archive: zipfile.ZipFile, prefix: str) -> None:
    """Add only the public client/Node runtime; Controller and web admin UI are private."""
    for rel in ("tether/__init__.py", "tether/updates.py", "tether/updates_cli.py",
                "tether/release.py", "tether/ed25519.py", "tether/mcp_server.py"):
        add_file(archive, rel, prefix)
    node = ROOT / "tether" / "node"
    for path in node.rglob("*"):
        if path.is_file() and not path.is_symlink() and path.suffix in {".py", ".html"}:
            rel = path.relative_to(ROOT).as_posix()
            if "__pycache__" not in path.parts:
                archive.write(path, f"{prefix}/{rel}")


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


def validate_versions() -> None:
    components = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]
    if set(components) != {"app", "plugin", "node"} or len(set(components.values())) != 1:
        raise ValueError("version.json must define matching app, plugin, and node versions")
    version = components["app"]
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    project_match = re.search(r"(?ms)^\[project\]\s*.*?^version\s*=\s*['\"]([^'\"]+)", pyproject)
    if not project_match or project_match.group(1) != version:
        raise ValueError("pyproject.toml version does not match version.json")
    package_paths = [ROOT / "apps/tether-app/package.json"] + [
        ROOT / "packages" / name / "package.json"
        for name in ("dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface")
    ]
    for path in package_paths:
        package = json.loads(path.read_text(encoding="utf-8"))
        if package.get("version") != version:
            raise ValueError(f"{path.relative_to(ROOT)} version does not match version.json")


def main() -> None:
    validate_versions()
    OUT.mkdir(exist_ok=True)
    plugin_prefix = f"tether-plugin-{VERSION}"
    app_prefix = f"tether-app-{VERSION}"

    plugin = OUT / f"tether-plugin-{VERSION}.zip"
    with zipfile.ZipFile(plugin, "w", zipfile.ZIP_DEFLATED) as archive:
        add_file(archive, "desktop/install-plugin.ps1", plugin_prefix)
        add_file(archive, "scripts/build-native-ui-bridge.mjs", plugin_prefix)
        add_file(archive, "version.json", plugin_prefix)
        for package in ("dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface"):
            add_tree(archive, ROOT / "packages" / package, plugin_prefix)
        for rel in ("tether/__init__.py", "tether/updates.py", "tether/updates_cli.py",
                    "tether/release.py", "tether/ed25519.py",
                    "tether/node/__init__.py", "tether/node/dsh_sessions.py"):
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

    app = OUT / f"tether-app-{VERSION}.zip"
    with zipfile.ZipFile(app, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tree(archive, ROOT / "apps" / "tether-app", app_prefix)
        add_tree(archive, ROOT / "packages" / "tether-ui", app_prefix)
        add_tether_runtime(archive, app_prefix)
        add_tree(archive, ROOT / "assets", app_prefix)
        for rel in ("pyproject.toml", ".env.example", "version.json", "desktop/install-app.ps1"):
            add_file(archive, rel, app_prefix)
        archive.writestr(f"{app_prefix}/README-INSTALL.md", """# Tether APP (standalone)

Run `apps\\tether-app\\Tether-App.cmd` (or `desktop\\install-app.ps1` for a shortcut).
The launcher creates `.venv`, installs Python deps once, installs Electron once.

This archive contains only the APP. It does not install the DSH plugin or a Hub.
To use a Hub, create `apps\\tether-app\\data\\hub.json` with url/accessToken/nodeToken.
When `nodeToken` is present, the APP supervisor starts a local Node and this machine
can be controlled by other devices. The DeepSeek Harness desktop app must be installed
for native DSH sessions; the DSH plugin is optional.
Without a Hub, the APP starts a local private Controller and Node only when the private
tether-harness-server component is installed. Otherwise, configure a Hub or install that component.
""")

    node_prefix = f"tether-node-{VERSION}"
    node = OUT / f"tether-node-{VERSION}.zip"
    with zipfile.ZipFile(node, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tether_runtime(archive, node_prefix)
        for rel in ("laptop/tether-node.ps1", "laptop/bootstrap-node.ps1", "pyproject.toml",
                    "version.json"):
            add_file(archive, rel, node_prefix)
        archive.writestr(f"{node_prefix}/README-INSTALL.md", """# Tether Node (standalone)

Install the Python dependencies listed in `pyproject.toml`, then run
`laptop\\bootstrap-node.ps1` with `-ControllerUrl` and `-Token`, or create a
local `.env` containing `TETHER_CONTROLLER` and `TETHER_NODE_TOKEN`. Configure
the Hub WebSocket URL to end in `/ws/node`. Existing `.env` files are kept;
missing configuration is reported without starting against placeholders.
Device name defaults to this computer's hostname.

The Node is a headless target-device agent: it has no chat UI and is controlled
from an APP or DSH plugin on another device. It connects outbound to the Hub;
no inbound port or Tailscale/VPN is required. This archive contains the Node
backend and launch/bootstrap scripts; it does not install APP or modify a
DeepSeek Harness profile.
""")

    rollout = rollout_config()
    manifest = {"schema": 1, "channel": "stable", "released_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "components": {}}
    for component, archive in (("app", app), ("plugin", plugin), ("node", node)):
        payload = archive.read_bytes()
        manifest["components"][component] = {
            "version": VERSION,
            "url": f"https://github.com/qi001007/tether-harness/releases/download/v{VERSION}/{archive.name}",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
            "protocol": 1,
            "min_protocol": 1,
            "min_updater": MIN_UPDATER_VERSION,
            "rollout": rollout,
        }
    key = release_private_key()
    if key is not None:
        manifest["signature"] = base64.b64encode(key.sign(canonical_bytes(manifest))).decode("ascii")
        verify_signature(manifest)
    manifest_path = OUT / "tether-update.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for archive in (plugin, app, node, manifest_path):
        print(archive.name, archive.stat().st_size)
    print("signed" if key is not None else "unsigned development manifest")


if __name__ == "__main__":
    main()
