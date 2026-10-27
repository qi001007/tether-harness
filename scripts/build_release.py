#!/usr/bin/env python3
"""Build standalone plugin and APP archives (no repository clone needed)."""
from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release"
VERSION = "0.2.0"
SKIP = {"node_modules", "data", "__pycache__", ".pytest_cache", ".venv", ".git", "release"}


def add_tree(archive: zipfile.ZipFile, src: Path, prefix: str) -> None:
    for path in src.rglob("*"):
        if any(part in SKIP for part in path.parts):
            continue
        if path.is_file():
            archive.write(path, f"{prefix}/{path.relative_to(ROOT).as_posix()}")


def add_file(archive: zipfile.ZipFile, rel: str, prefix: str) -> None:
    path = ROOT / rel
    if path.exists():
        archive.write(path, f"{prefix}/{rel}")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    plugin_prefix = f"tether-plugin-{VERSION}"
    app_prefix = f"tether-app-{VERSION}"

    plugin = OUT / f"tether-plugin-{VERSION}.zip"
    with zipfile.ZipFile(plugin, "w", zipfile.ZIP_DEFLATED) as archive:
        add_file(archive, "desktop/install-plugin.ps1", plugin_prefix)
        for package in ("dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface"):
            add_tree(archive, ROOT / "packages" / package, plugin_prefix)
        archive.writestr(f"{plugin_prefix}/README-INSTALL.md", """# Tether DSH plugin (standalone)

1. Close DeepSeek Harness.
2. Run `desktop\\install-plugin.ps1` from this folder.
3. Start DeepSeek Harness and open Tether in the sidebar.

This archive contains only the DSH plugin. It does not install the APP.
For a Hub, open Tether -> `Hub` and enter the Hub URL + access token.
Without a Hub, point it at a local Tether Controller (127.0.0.1:18890).
""")

    app = OUT / f"tether-app-{VERSION}.zip"
    with zipfile.ZipFile(app, "w", zipfile.ZIP_DEFLATED) as archive:
        add_tree(archive, ROOT / "apps" / "tether-app", app_prefix)
        add_tree(archive, ROOT / "packages" / "tether-ui", app_prefix)
        add_tree(archive, ROOT / "tether", app_prefix)
        add_tree(archive, ROOT / "assets", app_prefix)
        for rel in ("pyproject.toml", ".env.example", "desktop/install-app.ps1"):
            add_file(archive, rel, app_prefix)
        archive.writestr(f"{app_prefix}/README-INSTALL.md", """# Tether APP (standalone)

Run `apps\\tether-app\\Tether-App.cmd` (or `desktop\\install-app.ps1` for a shortcut).
The launcher creates `.venv`, installs Python deps once, installs Electron once.

This archive contains only the APP. It does not install the DSH plugin.
To use a Hub, create `apps\\tether-app\\data\\hub.json` with url/accessToken/nodeToken;
otherwise the APP starts a local Controller + Node.
""")

    for archive in (plugin, app):
        print(archive.name, archive.stat().st_size)


if __name__ == "__main__":
    main()