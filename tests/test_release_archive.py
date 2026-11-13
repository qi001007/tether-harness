from __future__ import annotations

import importlib.util
import hashlib
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from scripts import hydrate_herdr_runtime


ROOT = Path(__file__).resolve().parents[1]


def test_node_archive_adds_only_verified_windows_herdr_members_once(tmp_path: Path, monkeypatch) -> None:
    spec = importlib.util.spec_from_file_location("build_release_herdr", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    relatives = (
        "herdr.exe",
        "conpty/arm64/OpenConsole.exe",
        "conpty/conpty.dll",
        "conpty/herdr-conpty.json",
        "conpty/x64/OpenConsole.exe",
    )
    runtime = tmp_path / "herdr-runtime"
    expected: dict[str, bytes] = {}
    pinned: dict[str, dict] = {}
    for relative in relatives:
        payload = ("pinned fixture " + relative).encode("utf-8")
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        expected[relative] = payload
        pinned[relative] = {
            "asset": "windows-x86_64",
            "size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    monkeypatch.setattr(hydrate_herdr_runtime, "WINDOWS_RUNTIME_FILES", relatives)
    monkeypatch.setattr(hydrate_herdr_runtime, "FILES", pinned)

    archive_path = tmp_path / "node.zip"
    prefix = "tether-node-0.5.3"
    expected_members = {f"{prefix}/tether/node/bin/{relative}" for relative in relatives}
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        module.add_windows_herdr_runtime(archive, prefix, runtime)

    with zipfile.ZipFile(archive_path) as archive:
        assert set(archive.namelist()) == expected_members
        for relative, payload in expected.items():
            assert archive.read(f"{prefix}/tether/node/bin/{relative}") == payload

    with zipfile.ZipFile(archive_path, "a", zipfile.ZIP_DEFLATED) as archive:
        with pytest.raises(ValueError, match="already contains Herdr runtime member"):
            module.add_windows_herdr_runtime(archive, prefix, runtime)

    corrupt_runtime = tmp_path / "corrupt-herdr-runtime"
    shutil.copytree(runtime, corrupt_runtime)
    (corrupt_runtime / "herdr.exe").write_bytes(b"tampered")
    corrupt_archive = tmp_path / "corrupt-node.zip"
    with zipfile.ZipFile(corrupt_archive, "w", zipfile.ZIP_DEFLATED) as archive:
        with pytest.raises(ValueError, match="failed pinned size/SHA-256"):
            module.add_windows_herdr_runtime(archive, prefix, corrupt_runtime)
        assert archive.namelist() == []


def test_node_installer_archive_entry_normalizes_only_its_line_endings(tmp_path: Path, monkeypatch) -> None:
    spec = importlib.util.spec_from_file_location("build_release_line_endings", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    (tmp_path / "laptop").mkdir()
    (tmp_path / "laptop" / "install-node.sh").write_bytes(b"#!/bin/sh\r\nfirst\rsecond\n")
    monkeypatch.setattr(module, "ROOT", tmp_path)

    output = tmp_path / "fixture.zip"
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        module.add_file(archive, "laptop/install-node.sh", "tether-node-0.4.4")

    with zipfile.ZipFile(output) as archive:
        assert archive.read("tether-node-0.4.4/laptop/install-node.sh") == b"#!/bin/sh\nfirst\nsecond\n"


def test_release_preflight_checks_current_limits_and_reports_legacy_incompatibility(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("build_release_preflight", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    archive_path = tmp_path / "tether-node-preflight.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("tether-node-0.4.2/version.json", b"{}")
        archive.writestr("tether-node-0.4.2/packages/dsh-plugin-tether-client/lib/client.js", b"client")
    report = module.preflight_release_archives({"node": archive_path})["node"]
    assert report["current"]["compatible"] is True
    assert report["legacy_0.3.6"]["compatible"] is False
    assert any("allowlist" in issue for issue in report["legacy_0.3.6"]["issues"])
    oversized = module.archive_compatibility(archive_path, "node", max_archive_bytes=100,
        max_file_bytes=5, max_files=4096, max_compression_ratio=150,
        allowed=("tether/", "version.json"))
    assert oversized["compatible"] is False
    assert any("member exceeds 5 byte limit" in issue for issue in oversized["issues"])


def test_preview2_tag_reaches_archive_stage_and_invalid_sequences_are_rejected(tmp_path: Path, monkeypatch) -> None:
    spec = importlib.util.spec_from_file_location("build_release_preview_tag", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app_version = "0.5.8"
    plugin_version = "0.2.93"
    monkeypatch.setattr(module, "validate_versions", lambda frozen=None: {
        "app": app_version, "node": app_version, "plugin": plugin_version})
    manifest = tmp_path / "manifest.json"
    archive = tmp_path / "plugin.zip"
    node_deb = tmp_path / "node.deb"
    for path in (manifest, archive, node_deb):
        path.write_bytes(b"fixture")
    monkeypatch.setattr(module, "load_frozen_plugin", lambda *_args: (
        {}, {"version": plugin_version}, f"tether-plugin-{plugin_version}/"))
    monkeypatch.setattr(module, "OUT", tmp_path / "release")
    deb_fields: list[str] = []

    def read_deb_field(command, **_kwargs):
        field = command[-1]
        deb_fields.append(field)
        values = {"Package": "tether-node", "Version": app_version, "Architecture": "amd64"}
        return subprocess.CompletedProcess(command, 0, stdout=values[field])

    class ArchiveStageReached(Exception):
        pass

    def stop_before_large_archives(*_args, **_kwargs):
        raise ArchiveStageReached

    monkeypatch.setattr(module.subprocess, "run", read_deb_field)
    monkeypatch.setattr(module, "add_tree", stop_before_large_archives)
    args = [
        "--channel", "preview", "--release-tag", "v0.5.8-preview.2",
        "--frozen-plugin-manifest", str(manifest), "--frozen-plugin-archive", str(archive),
        "--node-deb", str(node_deb), "--output-dir", str(module.OUT),
    ]
    with pytest.raises(ArchiveStageReached):
        module.main(args)
    assert deb_fields == ["Package", "Version", "Architecture"]

    invalid_tags = (
        "v0.5.8-preview.0", "v0.5.8-preview.01", "v0.5.8-preview.-1",
        "v0.5.9-preview.2", "v0.5.8-preview.2trailing", "v0.5.8-preview.2.0",
    )
    for tag in invalid_tags:
        before = len(deb_fields)
        with pytest.raises(SystemExit):
            module.main([*args[:3], tag, *args[4:]])
        assert len(deb_fields) == before


def test_frozen_plugin_build_keeps_signed_entry_and_packages_without_emitting_plugin_zip(tmp_path: Path, monkeypatch) -> None:
    spec = importlib.util.spec_from_file_location("build_release_frozen", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    frozen_version = "0.2.93"
    archive_path = tmp_path / f"tether-plugin-{frozen_version}.zip"
    root_prefix = f"tether-plugin-{frozen_version}/"
    payload = b"official frozen repair input\n"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for package in ("dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface"):
            archive.writestr(root_prefix + f"packages/{package}/package.json",
                             json.dumps({"version": frozen_version}))
        archive.writestr(root_prefix + "packages/tether-dsh-surface/updater/tether/node/dsh_restart.py", payload)
    plugin_entry = {"version": frozen_version, "url": "https://github.com/qi001007/tether-harness/releases/download/v0.2.93/tether-plugin-0.2.93.zip",
                    "sha256": __import__("hashlib").sha256(archive_path.read_bytes()).hexdigest(),
                    "size": archive_path.stat().st_size, "protocol": 1, "min_protocol": 1,
                    "min_updater": "0.2.1", "rollout": {"percent": 100}}
    manifest_path = tmp_path / "frozen-manifest.json"
    manifest_path.write_text(json.dumps({"schema": 1, "channel": "stable", "components": {"plugin": plugin_entry},
                                         "signature": "fixture"}), encoding="utf-8")
    app_version = module.VERSION
    monkeypatch.setattr(module, "OUT", tmp_path / "release")
    monkeypatch.setattr(module, "validate_versions", lambda frozen=None: {
        "app": app_version, "node": app_version, "plugin": frozen_version})
    monkeypatch.setattr(module, "load_frozen_plugin", lambda _manifest, _archive: ({}, plugin_entry, root_prefix))

    module.main(["--frozen-plugin-manifest", str(manifest_path), "--frozen-plugin-archive", str(archive_path)])

    assert not (module.OUT / archive_path.name).exists()
    assert (module.OUT / f"tether-app-{app_version}.zip").is_file()
    node_path = module.OUT / f"tether-node-{app_version}.zip"
    with zipfile.ZipFile(node_path) as node:
        node_entry = f"tether-node-{app_version}/packages/tether-dsh-surface/updater/tether/node/dsh_restart.py"
        assert node.read(node_entry) == payload
    produced = json.loads((module.OUT / "tether-update.json").read_text(encoding="utf-8"))
    assert produced["components"]["plugin"] == plugin_entry
    assert produced["components"]["app"]["version"] == app_version
    assert produced["components"]["node"]["version"] == app_version


def test_frozen_plugin_arguments_must_be_paired(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("build_release_arguments", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pytest.raises(SystemExit):
        module.main(["--frozen-plugin-manifest", str(tmp_path / "manifest.json")])


def test_standalone_plugin_archive_passes_offline_installer_preflight(tmp_path: Path, monkeypatch) -> None:
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh")
    if not powershell:
        pytest.skip("PowerShell is required to run the Windows installer preflight")

    spec = importlib.util.spec_from_file_location("build_release", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.OUT = tmp_path / "release"
    fixture_version = module.VERSION
    monkeypatch.setattr(module, "validate_versions", lambda frozen=None: {
        "app": fixture_version, "plugin": fixture_version, "node": fixture_version})
    original_add_tree = module.add_tree
    original_add_file = module.add_file

    class LockstepArchive:
        def __init__(self, archive):
            self.archive = archive

        def write(self, source, archive_name):
            if archive_name.endswith("/package.json"):
                package = json.loads(Path(source).read_text(encoding="utf-8"))
                package["version"] = fixture_version
                self.archive.writestr(archive_name, json.dumps(package).encode("utf-8"),
                                     compress_type=zipfile.ZIP_DEFLATED)
            else:
                self.archive.write(source, archive_name)

        def writestr(self, *args, **kwargs):
            return self.archive.writestr(*args, **kwargs)

        def __getattr__(self, name):
            return getattr(self.archive, name)

    def add_tree_with_fixture(archive, source, prefix, *, plugin_version=None):
        return original_add_tree(LockstepArchive(archive), source, prefix, plugin_version=plugin_version)

    def add_file_with_fixture(archive, relative, prefix):
        if relative == "version.json":
            archive.writestr(f"{prefix}/{relative}", json.dumps({"schema": 1, "components": {
                "app": fixture_version, "plugin": fixture_version, "node": fixture_version,
            }}).encode("utf-8"))
        else:
            original_add_file(archive, relative, prefix)

    monkeypatch.setattr(module, "add_tree", add_tree_with_fixture)
    monkeypatch.setattr(module, "add_file", add_file_with_fixture)
    module.main([])
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
            "packages/tether-dsh-surface/updater/tether/node/dsh_restart.py",
        ):
            assert prefix + relative in names
        assert prefix + "version.json" in names
        assert not any(".runtime/npm/node_modules/@deepseek-ai/" in name for name in names)
        archive.extractall(tmp_path / "extracted")

    with zipfile.ZipFile(node_archive_path) as archive:
        node_names = set(archive.namelist())
        assert f"tether-node-{version}/tether/node/agent.py" in node_names
        assert f"tether-node-{version}/laptop/tether-node.ps1" in node_names
        install_node = archive.read(f"tether-node-{version}/laptop/install-node.sh")
        assert b"\r" not in install_node
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
        "__init__.py", "updates.py", "updates_cli.py", "release.py", "ed25519.py", "node/__init__.py",
        "node/dsh_sessions.py", "node/dsh_restart.py"
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
        "__init__.py", "updates.py", "updates_cli.py", "release.py", "ed25519.py", "node/__init__.py",
        "node/dsh_sessions.py", "node/dsh_restart.py"
    ):
        assert (source_root / "packages/tether-dsh-surface/updater/tether" / relative).is_file()


def test_split_version_metadata_requires_the_matching_frozen_plugin_fixture(tmp_path: Path, monkeypatch) -> None:
    spec = importlib.util.spec_from_file_location("build_release_split_versions", ROOT / "scripts" / "build_release.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    frozen_version = "0.2.93"
    app_version = "0.4.4"
    (tmp_path / "pyproject.toml").write_text(f'[project]\nversion = "{app_version}"\n', encoding="utf-8")
    (tmp_path / "version.json").write_text(json.dumps({"components": {
        "app": app_version, "node": app_version, "plugin": frozen_version,
    }}), encoding="utf-8")
    app_package = tmp_path / "apps/tether-app"
    app_package.mkdir(parents=True)
    (app_package / "package.json").write_text(json.dumps({"version": app_version}), encoding="utf-8")
    for name in ("dsh-plugin-tether", "dsh-plugin-tether-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        package = tmp_path / "packages" / name
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"version": frozen_version}), encoding="utf-8")
    monkeypatch.setattr(module, "ROOT", tmp_path)

    with pytest.raises(ValueError, match="explicitly verified frozen plugin"):
        module.validate_versions()
    assert module.validate_versions(frozen_version) == {
        "app": app_version, "node": app_version, "plugin": frozen_version,
    }
