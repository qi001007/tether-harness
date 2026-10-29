from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_standalone_plugin_archive_passes_offline_installer_preflight(tmp_path: Path) -> None:
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh")
    if not powershell:
        pytest.skip("PowerShell is required to run the Windows installer preflight")

    spec = importlib.util.spec_from_file_location("build_release", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.OUT = tmp_path / "release"
    module.main()
    version = module.VERSION

    app_archive_path = module.OUT / f"tether-app-{version}.zip"
    archive_path = module.OUT / f"tether-plugin-{version}.zip"
    node_archive_path = module.OUT / f"tether-node-{version}.zip"
    with zipfile.ZipFile(app_archive_path) as archive:
        app_names = set(archive.namelist())
        assert f"tether-app-{version}/tether/node/agent.py" in app_names
        assert not any(name.startswith((
            f"tether-app-{version}/tether/controller/", f"tether-app-{version}/tether/static/",
            f"tether-app-{version}/tether_server/", f"tether-app-{version}/deploy/",
            f"tether-app-{version}/tests/"
        )) for name in app_names)
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        prefix = f"tether-plugin-{version}/"
        assert prefix + "desktop/install-plugin.ps1" in names
        assert prefix + "scripts/build-native-ui-bridge.mjs" in names
        assert prefix + "packages/tether-dsh-native-ui/lib/client.js" in names
        for relative in (
            "packages/tether-dsh-surface/updater/tether/__init__.py",
            "packages/tether-dsh-surface/updater/tether/updates.py",
            "packages/tether-dsh-surface/updater/tether/updates_cli.py",
            "packages/tether-dsh-surface/updater/tether/node/__init__.py",
            "packages/tether-dsh-surface/updater/tether/node/dsh_sessions.py",
        ):
            assert prefix + relative in names
        assert prefix + "version.json" in names
        assert not any(".runtime/npm/node_modules/@deepseek-ai/" in name for name in names)
        archive.extractall(tmp_path / "extracted")

    with zipfile.ZipFile(node_archive_path) as archive:
        node_names = set(archive.namelist())
        assert f"tether-node-{version}/tether/node/agent.py" in node_names
        assert f"tether-node-{version}/laptop/tether-node.ps1" in node_names
        assert f"tether-node-{version}/version.json" in node_names
        assert f"tether-node-{version}/.env.example" not in node_names
        install_readme = archive.read(f"tether-node-{version}/README-INSTALL.md").decode("utf-8")
        bootstrap = archive.read(f"tether-node-{version}/laptop/bootstrap-node.ps1").decode("utf-8")
        assert "Hub WebSocket URL" in install_readme
        assert "hostname" in install_readme
        assert ".env.example" not in install_readme
        assert "100.x.x.x" not in bootstrap
        assert "tether-local-2026" not in bootstrap
        assert "DEEPSEEK_API_KEY" not in bootstrap
        assert not any(name.startswith((
            f"tether-node-{version}/tether/controller/", f"tether-node-{version}/tether/static/",
            f"tether-node-{version}/tether_server/", f"tether-node-{version}/deploy/",
            f"tether-node-{version}/tests/"
        )) for name in node_names)
    manifest = (module.OUT / "tether-update.json").read_text(encoding="utf-8")
    manifest_data = json.loads(manifest)
    assert set(manifest_data["components"]) == {"app", "plugin", "node"}
    assert all(item["version"] == version for item in manifest_data["components"].values())
    assert all(item["min_updater"] == "0.2.1" for item in manifest_data["components"].values())

    install_script = tmp_path / "extracted" / f"tether-plugin-{version}" / "desktop" / "install-plugin.ps1"
    result = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(install_script), "-VerifyPackage"],
        cwd=install_script.parents[1], capture_output=True, text=True, timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Offline package verification passed" in result.stdout

    source_root = tmp_path / "source-install"
    source_installer = source_root / "desktop" / "install-plugin.ps1"
    source_installer.parent.mkdir(parents=True)
    shutil.copy2(ROOT / "desktop" / "install-plugin.ps1", source_installer)
    (source_root / "packages/dsh-plugin-tether").mkdir(parents=True)
    (source_root / "packages/dsh-plugin-tether/package.json").write_text("{}", encoding="utf-8")
    native_ui = source_root / "packages/tether-dsh-native-ui/lib/client.js"
    native_ui.parent.mkdir(parents=True)
    shutil.copy2(ROOT / "packages/tether-dsh-native-ui/lib/client.js", native_ui)
    for relative in (
        "__init__.py", "updates.py", "updates_cli.py", "release.py", "ed25519.py", "node/__init__.py", "node/dsh_sessions.py"
    ):
        destination = source_root / "tether" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "tether" / relative, destination)
    source_preflight = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(source_installer), "-VerifyPackage"],
        cwd=source_installer.parents[1], capture_output=True, text=True, timeout=30,
        check=False,
    )
    assert source_preflight.returncode == 0, source_preflight.stdout + source_preflight.stderr
    for relative in (
        "__init__.py", "updates.py", "updates_cli.py", "release.py", "ed25519.py", "node/__init__.py", "node/dsh_sessions.py"
    ):
        assert (source_root / "packages/tether-dsh-surface/updater/tether" / relative).is_file()
