#!/usr/bin/env python3
"""Build standalone plugin and APP archives (no repository clone needed)."""
from __future__ import annotations

import zipfile
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release"
VERSION = "0.2.1"
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
                "tether/mcp_server.py"):
        add_file(archive, rel, prefix)
    node = ROOT / "tether" / "node"
    for path in node.rglob("*"):
        if path.is_file() and not path.is_symlink() and path.suffix in {".py", ".html"}:
            rel = path.relative_to(ROOT).as_posix()
            if "__pycache__" not in path.parts:
                archive.write(path, f"{prefix}/{rel}")


def main() -> None:
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
                    "tether/node/__init__.py", "tether/node/dsh_sessions.py"):
            add_mapped_file(archive, rel, f"packages/tether-dsh-surface/updater/{rel}", plugin_prefix)
        archive.writestr(f"{plugin_prefix}/README-INSTALL.md", """# Tether DSH plugin (standalone)

1. Close DeepSeek Harness.
2. Run `desktop\\install-plugin.ps1` from this folder.
3. Start DeepSeek Harness and open Tether in the sidebar.

This archive contains only the DSH plugin. It does not install the APP.
Open Tether and use its connection page to configure the service address and credentials.
The plugin connects to the configured service; this archive does not install or start a server.
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

This archive contains only the APP. It does not install the DSH plugin.
To use a Hub, create `apps\\tether-app\\data\\hub.json` with url/accessToken/nodeToken.
Without a Hub, the APP starts a local private Controller and Node only when the private
tether-harness-server component is installed. Otherwise, configure a Hub or install that component.
""")

    node_prefix = f"tether-node-{VERSION}"
    node = OUT / f"tether-node-{VERSION}.zip"
    with zipfile.ZipFile(node, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tether_runtime(archive, node_prefix)
        for rel in ("laptop/tether-node.ps1", "laptop/bootstrap-node.ps1", "pyproject.toml",
                    ".env.example", "version.json"):
            add_file(archive, rel, node_prefix)
        archive.writestr(f"{node_prefix}/README-INSTALL.md", """# Tether Node (standalone)

Install the Python dependencies listed in `pyproject.toml`, create a local `.env`
from `.env.example` as needed, then run `laptop\\tether-node.ps1`. This archive
contains the Node backend and launch/bootstrap scripts; it does not install APP
or modify a DeepSeek Harness profile.
""")

    manifest = {"schema": 1, "components": {}}
    for component, archive in (("app", app), ("plugin", plugin), ("node", node)):
        payload = archive.read_bytes()
        manifest["components"][component] = {
            "version": VERSION,
            "url": f"https://github.com/qi001007/tether-harness/releases/download/v{VERSION}/{archive.name}",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
            "protocol": 1,
            "min_updater": VERSION,
        }
    manifest_path = OUT / "tether-update.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for archive in (plugin, app, node, manifest_path):
        print(archive.name, archive.stat().st_size)


if __name__ == "__main__":
    main()
