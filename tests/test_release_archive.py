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

    app_archive_path = module.OUT / "tether-app-0.2.1.zip"
    archive_path = module.OUT / "tether-plugin-0.2.1.zip"
    node_archive_path = module.OUT / "tether-node-0.2.1.zip"
    with zipfile.ZipFile(app_archive_path) as archive:
        app_names = set(archive.namelist())
        assert "tether-app-0.2.1/tether/node/agent.py" in app_names
        assert not any(name.startswith((
            "tether-app-0.2.1/tether/controller/", "tether-app-0.2.1/tether/static/",
            "tether-app-0.2.1/tether_server/", "tether-app-0.2.1/deploy/",
            "tether-app-0.2.1/tests/"
        )) for name in app_names)
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        prefix = "tether-plugin-0.2.1/"
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
        assert "tether-node-0.2.1/tether/node/agent.py" in node_names
        assert "tether-node-0.2.1/laptop/tether-node.ps1" in node_names
        assert "tether-node-0.2.1/version.json" in node_names
        assert "tether-node-0.2.1/.env.example" not in node_names
        install_readme = archive.read("tether-node-0.2.1/README-INSTALL.md").decode("utf-8")
        bootstrap = archive.read("tether-node-0.2.1/laptop/bootstrap-node.ps1").decode("utf-8")
        assert "Hub WebSocket URL" in install_readme
        assert "hostname" in install_readme
        assert ".env.example" not in install_readme
        assert "100.x.x.x" not in bootstrap
        assert "tether-local-2026" not in bootstrap
        assert "DEEPSEEK_API_KEY" not in bootstrap
        assert not any(name.startswith((
            "tether-node-0.2.1/tether/controller/", "tether-node-0.2.1/tether/static/",
            "tether-node-0.2.1/tether_server/", "tether-node-0.2.1/deploy/",
            "tether-node-0.2.1/tests/"
        )) for name in node_names)
    manifest = (module.OUT / "tether-update.json").read_text(encoding="utf-8")
    manifest_data = json.loads(manifest)
    assert set(manifest_data["components"]) == {"app", "plugin", "node"}
    assert all(item["version"] == "0.2.1" for item in manifest_data["components"].values())
    assert all(item["min_updater"] == "0.2.1" for item in manifest_data["components"].values())

    install_script = tmp_path / "extracted" / "tether-plugin-0.2.1" / "desktop" / "install-plugin.ps1"
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
        "__init__.py", "updates.py", "updates_cli.py", "node/__init__.py", "node/dsh_sessions.py"
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
        "__init__.py", "updates.py", "updates_cli.py", "node/__init__.py", "node/dsh_sessions.py"
    ):
        assert (source_root / "packages/tether-dsh-surface/updater/tether" / relative).is_file()
