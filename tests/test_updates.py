from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tether.updates import UpdateError, UpdateManager, _is_newer


class ArtifactServer:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                payload = owner.files.get(self.path)
                if payload is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


@pytest.fixture
def artifact_server():
    server = ArtifactServer()
    yield server
    server.close()


def make_zip(component: str, version: str = "0.2.1", extra: dict[str, bytes] | None = None) -> bytes:
    prefix = f"tether-{component}-{version}/"
    if component == "app":
        files = {
            "version.json": json.dumps({"schema": 1, "components": {"app": version}}).encode(),
            "apps/tether-app/main.js": b"new-main",
            "apps/tether-app/preload.js": b"new-preload",
            "apps/tether-app/package.json": b'{"dependencies":{},"devDependencies":{}}',
            "packages/tether-ui/src/app.js": b"new-ui",
            "tether/updates.py": b"update-engine",
            "tether/updates_cli.py": b"update-cli",
        }
    elif component == "node":
        files = {
            "version.json": json.dumps({"schema": 1, "components": {"node": version}}).encode(),
            "pyproject.toml": b"[project]\nversion='0.2.1'\ndependencies=[]\n",
            "tether/node/agent.py": b"new-node",
            "tether/updates.py": b"update-engine",
            "tether/updates_cli.py": b"update-cli",
        }
    else:
        files = {
            "version.json": json.dumps({"schema": 1, "components": {"plugin": version}}).encode(),
            "packages/dsh-plugin-tether/package.json": json.dumps({"name": "tether-dsh-plugin", "version": version}).encode(),
            "packages/dsh-plugin-tether-client/package.json": json.dumps({"name": "tether-dsh-client", "version": version}).encode(),
            "packages/tether-dsh-native-ui/package.json": json.dumps({"name": "tether-dsh-native-ui", "version": version}).encode(),
            "packages/tether-dsh-surface/package.json": json.dumps({"name": "tether-dsh-surface", "version": version}).encode(),
            "packages/dsh-plugin-tether-client/lib/client.js": b"const PLUGIN_VERSION = '0.2.1'",
            "packages/tether-dsh-native-ui/lib/client.js": b"native-ui",
            "packages/tether-dsh-surface/lib/index.js": b"surface",
            "packages/tether-dsh-surface/lib/local-updates.js": b"local updates",
            "packages/tether-dsh-surface/updater/tether/__init__.py": b"",
            "packages/tether-dsh-surface/updater/tether/updates.py": b"updater",
            "packages/tether-dsh-surface/updater/tether/updates_cli.py": b"cli",
            "packages/tether-dsh-surface/updater/tether/node/__init__.py": b"",
            "packages/tether-dsh-surface/updater/tether/node/dsh_sessions.py": b"sessions",
        }
    files.update(extra or {})
    from io import BytesIO
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in files.items():
            archive.writestr(prefix + name, payload)
    return output.getvalue()


def install_manifest(server: ArtifactServer, component: str, archive: bytes, *, bad_hash: bool = False,
                     version: str = "0.2.1", min_updater: str = "0.2.1") -> str:
    artifact_path = f"/{component}.zip"
    server.files[artifact_path] = archive
    entry = {
        "version": version, "url": server.base + artifact_path,
        "sha256": "0" * 64 if bad_hash else hashlib.sha256(archive).hexdigest(),
        "size": len(archive), "protocol": 1, "min_updater": min_updater,
    }
    components = {name: dict(entry) for name in ("app", "plugin", "node")}
    components[component]["url"] = server.base + artifact_path
    raw = json.dumps({"schema": 1, "components": components}).encode()
    server.files["/manifest.json"] = raw
    return server.base + "/manifest.json"


def test_check_manifest_cache_singleflights_and_prepare_fetches_fresh_manifest(
        artifact_server: ArtifactServer, tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "install"
    seed_version(root)
    manifest_url = install_manifest(artifact_server, "app", make_zip("app", version="0.2.1"),
                                    version="0.2.1")
    manager = UpdateManager(root, "app", manifest_url=manifest_url, state_dir=tmp_path / "state")
    original_fetch = manager._fetch
    fetched_manifests: list[str] = []
    fetched_lock = threading.Lock()

    def counted_fetch(url: str, limit: int, *, timeout: float = 15.0) -> bytes:
        if url == manifest_url:
            with fetched_lock:
                fetched_manifests.append(url)
            time.sleep(0.05)
        return original_fetch(url, limit, timeout=timeout)

    monkeypatch.setattr(manager, "_fetch", counted_fetch)
    with ThreadPoolExecutor(max_workers=5) as pool:
        checked = list(pool.map(lambda _index: manager.check(), range(5)))
    assert all(item["ok"] and item["latest_version"] == "0.2.1" for item in checked)
    assert fetched_manifests == [manifest_url]

    install_manifest(artifact_server, "app", make_zip("app", version="0.2.2"), version="0.2.2")
    assert manager.check()["latest_version"] == "0.2.1"  # check cache is short-lived
    prepared = manager.prepare()
    assert prepared["ok"] is True, prepared
    assert prepared["to_version"] == "0.2.2"
    assert fetched_manifests == [manifest_url, manifest_url]


def seed_version(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "version.json").write_text(json.dumps({
        "schema": 1, "components": {"app": "0.2.0", "plugin": "0.2.0", "node": "0.2.0"}
    }), encoding="utf-8")


def test_semver_comparison_is_strict_and_respects_prerelease_precedence() -> None:
    assert _is_newer("1.0.0", "1.0.0-rc.9")
    assert _is_newer("1.0.0-rc.10", "1.0.0-rc.2")
    assert not _is_newer("1.0.0-rc.2", "1.0.0-rc.10")
    assert not _is_newer("1.0.0-rc.1", "1.0.0")
    with pytest.raises(UpdateError):
        _is_newer("01.0.0", "1.0.0")


def test_app_update_preserves_user_data_and_versions_other_components(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    app = root / "apps" / "tether-app"
    app.mkdir(parents=True)
    (app / "main.js").write_bytes(b"old-main")
    (app / "preload.js").write_bytes(b"old-preload")
    (app / "package.json").write_text('{"dependencies":{},"devDependencies":{}}', encoding="utf-8")
    data = app / "data" / "user.db"
    data.parent.mkdir()
    data.write_bytes(b"user-state")
    (root / ".env").write_text("not touched", encoding="utf-8")
    url = install_manifest(artifact_server, "app", make_zip("app"))
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    prepared = manager.prepare()
    assert prepared["ok"] is True
    applied = manager.apply(prepared["prepared_id"])

    assert applied["ok"] is True
    assert applied["restart_required"] is True
    assert (app / "main.js").read_bytes() == b"new-main"
    assert data.read_bytes() == b"user-state"
    assert (root / ".env").read_text(encoding="utf-8") == "not touched"
    versions = json.loads((root / "version.json").read_text(encoding="utf-8"))["components"]
    assert versions == {"app": "0.2.1", "plugin": "0.2.0", "node": "0.2.0"}
    assert manager.status()["restart_required"] is True


def test_bad_archive_hash_is_rejected_before_staging(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    url = install_manifest(artifact_server, "app", make_zip("app"), bad_hash=True)
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] == "hash_mismatch"
    assert manager.status()["prepared"] == []


def test_current_updater_can_prepare_next_release_when_protocol_is_unchanged(
    artifact_server: ArtifactServer, tmp_path: Path
) -> None:
    root = tmp_path / "install"
    seed_version(root)
    archive = make_zip("app", version="0.2.2")
    url = install_manifest(artifact_server, "app", archive, version="0.2.2", min_updater="0.2.1")
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    checked = manager.check()
    prepared = manager.prepare()

    assert checked["ok"] is True
    assert checked["latest_version"] == "0.2.2"
    assert checked["update_available"] is True
    assert prepared["ok"] is True, prepared


def test_node_update_rejects_python_dependency_changes(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    current_pyproject = root / "pyproject.toml"
    current_pyproject.write_text(
        "[project]\ndependencies=[]\n[project.optional-dependencies]\nmedia=['pillow>=10']\n",
        encoding="utf-8",
    )
    archive = make_zip("node", extra={
        "pyproject.toml": b"[project]\ndependencies=[]\n[project.optional-dependencies]\nmedia=['pillow>=11']\n"
    })
    url = install_manifest(artifact_server, "node", archive)
    manager = UpdateManager(root, "node", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] == "dependency_change_requires_manual_install"


def test_archive_path_traversal_is_rejected(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    archive = make_zip("node", extra={"../outside.txt": b"escape"})
    url = install_manifest(artifact_server, "node", archive)
    manager = UpdateManager(root, "node", manifest_url=url, state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] == "unsafe_archive_path"
    assert not (tmp_path / "outside.txt").exists()


@pytest.mark.parametrize("extra_path", [
    "apps/tether-app/main.js:stream",
    "C:/outside.txt",
    "/outside.txt",
    "apps/tether-app/MAIN.js",
])
def test_windows_and_duplicate_archive_paths_are_rejected(
    artifact_server: ArtifactServer, tmp_path: Path, extra_path: str
) -> None:
    root = tmp_path / "install"
    seed_version(root)
    archive = make_zip("app", extra={extra_path: b"unsafe"})
    url = install_manifest(artifact_server, "app", archive)
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] in {"unsafe_archive_path", "duplicate_archive_path"}


def test_symlink_archive_entry_is_rejected(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    from io import BytesIO

    root = tmp_path / "install"
    seed_version(root)
    data = BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in {
            "version.json": json.dumps({"schema": 1, "components": {"node": "0.2.1"}}).encode(),
            "pyproject.toml": b"[project]\ndependencies=[]\n",
            "tether/node/agent.py": b"node",
            "tether/updates.py": b"updater",
            "tether/updates_cli.py": b"cli",
        }.items():
            archive.writestr("tether-node-0.2.1/" + name, payload)
        link = zipfile.ZipInfo("tether-node-0.2.1/tether/node/link.py")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, "../../outside.py")
    payload = data.getvalue()
    url = install_manifest(artifact_server, "node", payload)
    manager = UpdateManager(root, "node", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] == "unsafe_archive_entry"


def test_high_compression_ratio_archive_entry_is_rejected(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    archive = make_zip("app", extra={"apps/tether-app/large.txt": b"x" * (1024 * 1024)})
    url = install_manifest(artifact_server, "app", archive)
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] == "compression_ratio_exceeded"


def test_prepared_stage_hash_is_rechecked_before_apply(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    archive = make_zip("app")
    url = install_manifest(artifact_server, "app", archive)
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")
    prepared = manager.prepare()
    staged = manager.state_dir / "prepared" / prepared["prepared_id"] / "apps/tether-app/main.js"
    staged.write_bytes(b"tampered")

    result = manager.apply(prepared["prepared_id"])

    assert result["ok"] is False
    assert result["error_code"] == "prepared_hash_mismatch"


def test_prepared_update_is_stale_after_installed_version_changes(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    url = install_manifest(artifact_server, "app", make_zip("app"))
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")
    prepared = manager.prepare()
    (root / "version.json").write_text(json.dumps({
        "schema": 1, "components": {"app": "0.2.1", "node": "0.2.0", "plugin": "0.2.0"}
    }), encoding="utf-8")

    result = manager.apply(prepared["prepared_id"])

    assert result["ok"] is False
    assert result["error_code"] == "prepared_stale"


def test_components_share_apply_lock_even_with_different_state_dirs(tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    first = UpdateManager(root, "app", state_dir=tmp_path / "state-a")
    second = UpdateManager(root, "node", state_dir=tmp_path / "state-b")
    fd, lock = first._lock()
    try:
        with pytest.raises(UpdateError) as error:
            second._lock()
        assert error.value.code == "update_busy"
    finally:
        import os
        os.close(fd)
        lock.unlink()


def test_dirty_development_checkout_is_not_updated(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "checkout"
    seed_version(root)
    subprocess.run(["git", "init", str(root)], capture_output=True, check=True)
    (root / "user-edit.py").write_text("keep", encoding="utf-8")
    url = install_manifest(artifact_server, "node", make_zip("node"))
    manager = UpdateManager(root, "node", dsh_home=tmp_path / "empty-dsh", manifest_url=url,
                            state_dir=tmp_path / "state")

    result = manager.prepare()

    assert result["ok"] is False
    assert result["error_code"] == "dirty_checkout"
    assert (root / "user-edit.py").read_text(encoding="utf-8") == "keep"


def test_dirty_file_dependency_checkout_is_not_modified(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "app-root"
    seed_version(root)
    source_packages = tmp_path / "source" / "packages"
    source_plugin = source_packages / "dsh-plugin-tether"
    source_plugin.mkdir(parents=True)
    original_manifest = json.dumps({"name": "tether-dsh-plugin", "version": "0.2.1"})
    (source_plugin / "package.json").write_text(original_manifest, encoding="utf-8")
    subprocess.run(["git", "init", str(tmp_path / "source")], capture_output=True, check=True)
    user_change = source_plugin / "user-edit.txt"
    user_change.write_text("keep", encoding="utf-8")

    dsh_home = tmp_path / "dsh"
    profile_dir = dsh_home / "profiles" / "desktop"
    packages = profile_dir / "node_modules"
    profile_dir.mkdir(parents=True)
    (profile_dir / "package.json").write_text(json.dumps({
        "dependencies": {"tether-dsh-plugin": "file:" + os.path.relpath(source_plugin, profile_dir)},
    }), encoding="utf-8")
    for package in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        (packages / package).mkdir(parents=True)
    url = install_manifest(artifact_server, "plugin", make_zip("plugin"))
    manager = UpdateManager(root, "plugin", dsh_home=dsh_home, manifest_url=url,
                            state_dir=tmp_path / "state", profile="desktop")

    prepared = manager.prepare()

    assert prepared["ok"] is False
    assert prepared["error_code"] == "dirty_checkout"
    assert user_change.read_text(encoding="utf-8") == "keep"
    assert (source_plugin / "package.json").read_text(encoding="utf-8") == original_manifest


def test_plugin_apply_failure_restores_previously_replaced_package_file(
    artifact_server: ArtifactServer, tmp_path: Path
) -> None:
    root = tmp_path / "install"
    seed_version(root)
    dsh_home = tmp_path / "dsh"
    packages = dsh_home / "profiles/desktop/node_modules"
    for name in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        package = packages / name
        (package / "lib").mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"name": name, "version": "0.2.0"}), encoding="utf-8")
    plugin_json = packages / "tether-dsh-plugin/package.json"
    client_js = packages / "tether-dsh-client/lib/client.js"
    plugin_json.write_bytes(b'{"name":"tether-dsh-plugin","version":"0.2.0"}')
    client_js.write_text("const PLUGIN_VERSION = '0.2.0'", encoding="utf-8")
    url = install_manifest(artifact_server, "plugin", make_zip("plugin"))
    manager = UpdateManager(root, "plugin", dsh_home=dsh_home, manifest_url=url,
                            state_dir=tmp_path / "state")
    prepared = manager.prepare()
    write_atomic = manager._write_atomic

    failed = False

    def fail_on_client(target: Path, data: bytes) -> None:
        nonlocal failed
        if target == client_js and not failed:
            failed = True
            raise OSError("injected plugin write failure")
        write_atomic(target, data)

    manager._write_atomic = fail_on_client  # type: ignore[method-assign]
    result = manager.apply(prepared["prepared_id"])

    assert result["ok"] is False
    assert result["error_code"] == "apply_failed"
    assert plugin_json.read_bytes() == b'{"name":"tether-dsh-plugin","version":"0.2.0"}'
    assert client_js.read_text(encoding="utf-8") == "const PLUGIN_VERSION = '0.2.0'"


def test_activity_fails_closed_for_active_local_run_and_unreadable_native_session(tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    database = root / "apps/tether-app/data/node-local.db"
    database.parent.mkdir(parents=True)
    connection = sqlite3.connect(database)
    connection.execute("CREATE TABLE runs (state TEXT)")
    connection.execute("INSERT INTO runs(state) VALUES ('running')")
    connection.commit()
    connection.close()
    dsh_home = tmp_path / "dsh"
    native_log = dsh_home / "sessions/work/session/session.v1.jsonl"
    native_log.parent.mkdir(parents=True)
    native_log.write_bytes(b"not valid utf-8 \\xff")
    manager = UpdateManager(root, "app", dsh_home=dsh_home, state_dir=tmp_path / "state")

    result = manager.activity()

    assert result == {"ok": True, "busy": True, "reason": "node_run_active"}
    connection = sqlite3.connect(database)
    connection.execute("UPDATE runs SET state='completed'")
    connection.commit()
    connection.close()
    result = manager.activity()
    assert result == {"ok": True, "busy": True, "reason": "activity_unknown"}


def test_mid_apply_failure_rolls_back_replaced_files(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    app = root / "apps" / "tether-app"
    app.mkdir(parents=True)
    (app / "main.js").write_bytes(b"old-main")
    (app / "preload.js").write_bytes(b"old-preload")
    (app / "package.json").write_text('{"dependencies":{},"devDependencies":{}}', encoding="utf-8")
    url = install_manifest(artifact_server, "app", make_zip("app"))
    manager = UpdateManager(root, "app", manifest_url=url, state_dir=tmp_path / "state")
    prepared = manager.prepare()
    assert prepared["ok"] is True
    write_atomic = manager._write_atomic
    failed = False

    def fail_once(target: Path, data: bytes) -> None:
        nonlocal failed
        if not failed and target.name == "preload.js":
            failed = True
            raise OSError("injected failure")
        write_atomic(target, data)

    manager._write_atomic = fail_once  # type: ignore[method-assign]
    result = manager.apply(prepared["prepared_id"])

    assert result["ok"] is False
    assert result["error_code"] == "apply_failed"
    assert (app / "main.js").read_bytes() == b"old-main"
    assert (app / "preload.js").read_bytes() == b"old-preload"
    assert json.loads((root / "version.json").read_text(encoding="utf-8"))["components"]["app"] == "0.2.0"


def test_plugin_maps_zip_sources_to_existing_profile_packages(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "app-root"
    seed_version(root)
    dsh_home = tmp_path / "dsh"
    packages = dsh_home / "profiles" / "work" / "node_modules"
    for name in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        (packages / name / "lib").mkdir(parents=True)
        (packages / name / "package.json").write_text(json.dumps({"name": name, "version": "0.2.0"}), encoding="utf-8")
    (packages / "tether-dsh-client" / "lib" / "client.js").write_text(
        "const PLUGIN_VERSION = '0.2.0'", encoding="utf-8")
    url = install_manifest(artifact_server, "plugin", make_zip("plugin"))
    manager = UpdateManager(root, "plugin", dsh_home=dsh_home, manifest_url=url, state_dir=tmp_path / "state", profile="work")

    assert manager.check()["current_version"] == "0.2.0"
    prepared = manager.prepare()
    assert prepared["ok"] is True
    result = manager.apply(prepared["prepared_id"])

    assert result["ok"] is True
    assert result["restart_required"] is True
    assert json.loads((packages / "tether-dsh-plugin" / "package.json").read_text(encoding="utf-8"))["version"] == "0.2.1"
    assert "0.2.1" in (packages / "tether-dsh-client" / "lib" / "client.js").read_text(encoding="utf-8")
    assert json.loads((root / "version.json").read_text(encoding="utf-8"))["components"]["plugin"] == "0.2.0"
    assert manager.status()["current_version"] == "0.2.1"


@pytest.mark.parametrize("fail_source_write", [False, True])
def test_plugin_file_dependencies_update_source_and_profile_transactionally(
    artifact_server: ArtifactServer, tmp_path: Path, fail_source_write: bool
) -> None:
    root = tmp_path / "app-root"
    seed_version(root)
    dsh_home = tmp_path / "dsh"
    profile_dir = dsh_home / "profiles" / "desktop"
    packages = profile_dir / "node_modules"
    source_packages = tmp_path / "plugin" / "packages"
    package_names = {
        "dsh-plugin-tether": "tether-dsh-plugin",
        "dsh-plugin-tether-client": "tether-dsh-client",
        "tether-dsh-native-ui": "tether-dsh-native-ui",
        "tether-dsh-surface": "tether-dsh-surface",
    }
    source_dependencies = {
        "tether-dsh-plugin": {
            "tether-dsh-client": "file:../dsh-plugin-tether-client",
            "tether-dsh-native-ui": "file:../tether-dsh-native-ui",
            "tether-dsh-surface": "file:../tether-dsh-surface",
        },
        "tether-dsh-client": {"tether-dsh-native-ui": "file:../tether-dsh-native-ui"},
    }
    profile_dir.mkdir(parents=True)
    (profile_dir / "package.json").write_text(json.dumps({
        "dependencies": {"tether-dsh-plugin": "file:" + os.path.relpath(
            source_packages / "dsh-plugin-tether", profile_dir)},
    }), encoding="utf-8")
    for source_name, package_name in package_names.items():
        profile_package = packages / package_name
        profile_package.mkdir(parents=True)
        (profile_package / "package.json").write_text(json.dumps({"name": package_name, "version": "0.2.5"}), encoding="utf-8")
        source_package = source_packages / source_name
        (source_package / "lib").mkdir(parents=True)
        (source_package / "package.json").write_text(json.dumps({
            "name": package_name,
            "version": "0.2.1",
            "dependencies": source_dependencies.get(package_name, {}),
        }), encoding="utf-8")
        (source_package / "lib" / ("client.js" if source_name == "dsh-plugin-tether-client" else "index.js")).write_text(
            "const PLUGIN_VERSION = '0.2.1'" if source_name == "dsh-plugin-tether-client" else "old source",
            encoding="utf-8",
        )
    profile_client = packages / "tether-dsh-client"
    (profile_client / "lib").mkdir()
    (profile_client / "lib" / "client.js").write_text("const PLUGIN_VERSION = '0.2.5'", encoding="utf-8")
    retained = source_packages / "dsh-plugin-tether" / "user-note.txt"
    retained.write_text("preserve", encoding="utf-8")

    newer_packages = {
        "dsh-plugin-tether/package.json": json.dumps({
            "name": "tether-dsh-plugin", "version": "0.2.10", "dependencies": source_dependencies["tether-dsh-plugin"]
        }).encode(),
        "dsh-plugin-tether-client/package.json": json.dumps({
            "name": "tether-dsh-client", "version": "0.2.10",
            "dependencies": source_dependencies["tether-dsh-client"],
        }).encode(),
        "tether-dsh-native-ui/package.json": json.dumps({"name": "tether-dsh-native-ui", "version": "0.2.10"}).encode(),
        "tether-dsh-surface/package.json": json.dumps({"name": "tether-dsh-surface", "version": "0.2.10"}).encode(),
    }
    archive = make_zip("plugin", version="0.2.10", extra={
        **{f"packages/{path}": value for path, value in newer_packages.items()},
        "packages/dsh-plugin-tether-client/lib/client.js": b"const PLUGIN_VERSION = '0.2.10'",
    })
    url = install_manifest(artifact_server, "plugin", archive, version="0.2.10")
    manager = UpdateManager(root, "plugin", dsh_home=dsh_home, manifest_url=url, state_dir=tmp_path / "state")

    checked = manager.check()
    prepared = manager.prepare()

    assert checked["current_version"] == "0.2.1"
    assert checked["update_available"] is True
    assert prepared["ok"] is True, prepared
    if fail_source_write:
        write_atomic = manager._write_atomic
        failed = False

        def fail_once(target: Path, data: bytes) -> None:
            nonlocal failed
            if not failed and target == source_packages / "dsh-plugin-tether-client" / "lib" / "client.js":
                failed = True
                raise OSError("injected source package write failure")
            write_atomic(target, data)

        manager._write_atomic = fail_once  # type: ignore[method-assign]

    result = manager.apply(prepared["prepared_id"])

    if fail_source_write:
        assert result["ok"] is False
        assert result["error_code"] == "apply_failed"
        assert "0.2.1" in (source_packages / "dsh-plugin-tether-client" / "lib" / "client.js").read_text(encoding="utf-8")
        assert "0.2.5" in (packages / "tether-dsh-client" / "lib" / "client.js").read_text(encoding="utf-8")
        assert retained.read_text(encoding="utf-8") == "preserve"
        return

    assert result["ok"] is True, result
    assert result["restart_required"] is True
    assert "0.2.10" in (source_packages / "dsh-plugin-tether-client" / "lib" / "client.js").read_text(encoding="utf-8")
    assert "0.2.10" in (packages / "tether-dsh-client" / "lib" / "client.js").read_text(encoding="utf-8")
    for source_name, package_name in package_names.items():
        source_manifest = json.loads((source_packages / source_name / "package.json").read_text(encoding="utf-8"))
        profile_manifest = json.loads((packages / package_name / "package.json").read_text(encoding="utf-8"))
        assert source_manifest["version"] == profile_manifest["version"] == "0.2.10"
    assert retained.read_text(encoding="utf-8") == "preserve"
    assert manager.status()["current_version"] == "0.2.10"


def test_plugin_version_uses_the_oldest_profile_package_manifest(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "app-root"
    seed_version(root)
    dsh_home = tmp_path / "dsh"
    packages = dsh_home / "profiles" / "desktop" / "node_modules"
    for name in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        package = packages / name
        (package / "lib").mkdir(parents=True)
        version = "0.2.5" if name == "tether-dsh-surface" else "0.2.10"
        (package / "package.json").write_text(json.dumps({"name": name, "version": version}), encoding="utf-8")
    (packages / "tether-dsh-client" / "lib" / "client.js").write_text(
        "const PLUGIN_VERSION = '0.2.10'", encoding="utf-8")
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    (state_dir / "installed-plugin.json").write_text(json.dumps({"version": "0.2.10"}), encoding="utf-8")
    url = install_manifest(artifact_server, "plugin", make_zip("plugin", version="0.2.10"), version="0.2.10")
    manager = UpdateManager(root, "plugin", dsh_home=dsh_home, manifest_url=url, state_dir=state_dir)

    status = manager.status()
    checked = manager.check()

    assert status["current_version"] == "0.2.5"
    assert checked["current_version"] == "0.2.5"
    assert checked["update_available"] is True


def test_plugin_apply_refuses_if_host_profile_changes_after_prepare(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "app-root"
    seed_version(root)
    dsh_home = tmp_path / "dsh"
    packages = dsh_home / "profiles" / "work" / "node_modules"
    for name in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        (packages / name / "lib").mkdir(parents=True)
        (packages / name / "package.json").write_text(json.dumps({"name": name, "version": "0.2.0"}), encoding="utf-8")
    (packages / "tether-dsh-client" / "lib" / "client.js").write_text(
        "const PLUGIN_VERSION = '0.2.0'", encoding="utf-8")
    url = install_manifest(artifact_server, "plugin", make_zip("plugin"))
    manager = UpdateManager(root, "plugin", dsh_home=dsh_home, manifest_url=url,
                            state_dir=tmp_path / "state", profile="work")
    prepared = manager.prepare()
    assert prepared["ok"] is True

    manager.profile = "desktop"
    result = manager.apply(prepared["prepared_id"])

    assert result["ok"] is False
    assert result["error_code"] == "plugin_profile_changed"
    assert "0.2.0" in (packages / "tether-dsh-client" / "lib" / "client.js").read_text(encoding="utf-8")


def test_missing_remote_manifest_is_reported_without_claiming_a_version(artifact_server: ArtifactServer, tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    manager = UpdateManager(root, "app", manifest_url=artifact_server.base + "/missing.json")

    result = manager.check()

    assert result["ok"] is False
    assert result["error_code"] == "manifest_missing"
    assert "http" not in result["error"].lower()


def test_legacy_install_without_component_version_uses_known_020_baseline(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    manager = UpdateManager(root, "node", dsh_home=tmp_path / "empty-dsh", state_dir=tmp_path / "state")

    result = manager.status()

    assert result["ok"] is True
    assert result["current_version"] == "0.2.0"


def test_built_release_archives_prepare_and_apply_for_all_components(
    artifact_server: ArtifactServer, tmp_path: Path
) -> None:
    import importlib.util
    import re

    repository = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("build_release_integration", repository / "scripts" / "build_release.py")
    assert spec and spec.loader
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    builder.OUT = tmp_path / "release"
    builder.main()
    version = builder.VERSION

    manifest = json.loads((builder.OUT / "tether-update.json").read_text(encoding="utf-8"))
    for component in ("app", "plugin", "node"):
        archive = (builder.OUT / f"tether-{component}-{version}.zip").read_bytes()
        manifest["components"][component]["url"] = artifact_server.base + f"/{component}.zip"
        artifact_server.files[f"/{component}.zip"] = archive
    artifact_server.files["/manifest.json"] = json.dumps(manifest).encode()
    manifest_url = artifact_server.base + "/manifest.json"

    app_container = tmp_path / "app-install"
    with zipfile.ZipFile(builder.OUT / f"tether-app-{version}.zip") as app_zip:
        app_zip.extractall(app_container)
    app_root = app_container / f"tether-app-{version}"
    (app_root / "version.json").write_text(json.dumps({
        "schema": 1, "components": {"app": "0.2.0", "plugin": "0.2.0", "node": "0.2.0"}
    }), encoding="utf-8")
    app = UpdateManager(app_root, "app", dsh_home=tmp_path / "app-empty-dsh",
                        manifest_url=manifest_url, state_dir=tmp_path / "app-state")
    app_prepared = app.prepare()
    assert app_prepared["ok"] is True, app_prepared
    app_result = app.apply(app_prepared["prepared_id"])
    assert app_result["ok"] is True, app_result
    assert (app_root / "apps/tether-app/main.js").is_file()
    assert (app_root / ".env.example").is_file()

    node_container = tmp_path / "node-install"
    with zipfile.ZipFile(builder.OUT / f"tether-node-{version}.zip") as node_zip:
        node_zip.extractall(node_container)
    node_root = node_container / f"tether-node-{version}"
    (node_root / "version.json").write_text(json.dumps({
        "schema": 1, "components": {"app": "0.2.0", "plugin": "0.2.0", "node": "0.2.0"}
    }), encoding="utf-8")
    node = UpdateManager(node_root, "node", dsh_home=tmp_path / "node-empty-dsh",
                         manifest_url=manifest_url, state_dir=tmp_path / "node-state")
    node_prepared = node.prepare()
    assert node_prepared["ok"] is True, node_prepared
    node_result = node.apply(node_prepared["prepared_id"])
    assert node_result["ok"] is True, node_result
    assert (node_root / "tether/node/agent.py").is_file()

    plugin_root = tmp_path / "plugin-install"
    seed_version(plugin_root)
    dsh_home = tmp_path / "plugin-dsh"
    packages = dsh_home / "profiles/desktop/node_modules"
    for package_name in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        (packages / package_name).mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(builder.OUT / f"tether-plugin-{version}.zip") as plugin_zip:
        for archive_name in plugin_zip.namelist():
            match = re.fullmatch(rf"tether-plugin-{re.escape(version)}/packages/([^/]+)/(.*)", archive_name)
            if not match:
                continue
            source_name, relative = match.groups()
            package_name = {
                "dsh-plugin-tether": "tether-dsh-plugin",
                "dsh-plugin-tether-client": "tether-dsh-client",
                "tether-dsh-native-ui": "tether-dsh-native-ui",
                "tether-dsh-surface": "tether-dsh-surface",
            }[source_name]
            target = packages / package_name / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(plugin_zip.read(archive_name))
    client = packages / "tether-dsh-client/lib/client.js"
    client.write_text(re.sub(rf"(PLUGIN_VERSION\s*=\s*['\"]){re.escape(version)}", r"\g<1>0.2.0",
                             client.read_text(encoding="utf-8")),
                      encoding="utf-8")
    client_package = packages / "tether-dsh-client/package.json"
    package_data = json.loads(client_package.read_text(encoding="utf-8"))
    package_data["version"] = "0.2.0"
    client_package.write_text(json.dumps(package_data), encoding="utf-8")
    plugin = UpdateManager(plugin_root, "plugin", dsh_home=dsh_home, manifest_url=manifest_url,
                           state_dir=tmp_path / "plugin-state")
    plugin_prepared = plugin.prepare()
    assert plugin_prepared["ok"] is True, plugin_prepared
    plugin_result = plugin.apply(plugin_prepared["prepared_id"])
    assert plugin_result["ok"] is True, plugin_result
    assert node.status()["prepared"] == []
    assert plugin.status()["prepared"] == []
    installed_client_package = json.loads((packages / "tether-dsh-client/package.json").read_text(encoding="utf-8"))
    assert installed_client_package["version"] == version
    assert plugin.status()["current_version"] == version
    assert (packages / "tether-dsh-surface/updater/tether/updates.py").is_file()
    updater_root = packages / "tether-dsh-surface/updater"
    cli_result = subprocess.run(
        [sys.executable, "-m", "tether.updates_cli", "status", "--component", "plugin",
         "--root", str(updater_root), "--dsh-home", str(dsh_home), "--state-dir",
         str(tmp_path / "plugin-state")],
        cwd=updater_root, capture_output=True, text=True, timeout=30, check=False,
    )
    assert cli_result.returncode == 0, cli_result.stderr + cli_result.stdout
    assert json.loads(cli_result.stdout)["current_version"] == version


def test_real_020_release_archives_upgrade_with_bootstrap_updater(
    artifact_server: ArtifactServer, tmp_path: Path
) -> None:
    import importlib.util
    import re

    repository = Path(__file__).resolve().parents[1]
    old_assets = {
        "app": (repository / "release/tether-app-0.2.0.zip",
                "5c979e188e405cd9b878ea00902c4246cef410edca102bae1372c78f6572acc7"),
        "plugin": (repository / "release/tether-plugin-0.2.0.zip",
                   "6c9349326467e655b7ad243648b40999c09be8c3e394ffb60596f6677bd6d7b9"),
    }
    if any(not path.is_file() for path, _digest in old_assets.values()):
        pytest.skip("the local verified 0.2.0 release archives are not present; no network download attempted")
    for path, expected_digest in old_assets.values():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_digest

    spec = importlib.util.spec_from_file_location("build_release_020_upgrade", repository / "scripts" / "build_release.py")
    assert spec and spec.loader
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    builder.OUT = tmp_path / "release-0.2.1"
    builder.main()
    manifest = json.loads((builder.OUT / "tether-update.json").read_text(encoding="utf-8"))
    for component in ("app", "plugin", "node"):
        artifact = (builder.OUT / f"tether-{component}-{version}.zip").read_bytes()
        manifest["components"][component]["url"] = artifact_server.base + f"/{component}.zip"
        artifact_server.files[f"/{component}.zip"] = artifact
    artifact_server.files["/manifest.json"] = json.dumps(manifest).encode()
    manifest_url = artifact_server.base + "/manifest.json"

    app_root = tmp_path / "legacy-app"
    with zipfile.ZipFile(old_assets["app"][0]) as archive:
        archive.extractall(app_root)
    app_root = app_root / "tether-app-0.2.0"
    assert not (app_root / "version.json").exists()
    (app_root / "apps/tether-app/.env").write_text("keep local configuration", encoding="utf-8")
    user_data = app_root / "apps/tether-app/data/preferences.json"
    user_data.parent.mkdir(parents=True, exist_ok=True)
    user_data.write_text('{"keep":true}', encoding="utf-8")
    app = UpdateManager(app_root, "app", dsh_home=tmp_path / "legacy-app-dsh",
                        manifest_url=manifest_url, state_dir=tmp_path / "app-update-state")
    assert app.status()["current_version"] == "0.2.0"
    app_prepared = app.prepare()
    assert app_prepared["ok"] is True, app_prepared
    app_result = app.apply(app_prepared["prepared_id"])
    assert app_result["ok"] is True, app_result
    assert (app_root / "apps/tether-app/.env").read_text(encoding="utf-8") == "keep local configuration"
    assert user_data.read_text(encoding="utf-8") == '{"keep":true}'

    node = UpdateManager(app_root, "node", dsh_home=tmp_path / "legacy-node-dsh",
                         manifest_url=manifest_url, state_dir=tmp_path / "node-update-state")
    assert node.status()["current_version"] == "0.2.0"
    node_prepared = node.prepare()
    assert node_prepared["ok"] is True, node_prepared
    node_result = node.apply(node_prepared["prepared_id"])
    assert node_result["ok"] is True, node_result
    assert (app_root / "tether/node/agent.py").is_file()

    plugin_root = tmp_path / "legacy-plugin-root"
    plugin_root.mkdir()
    dsh_home = tmp_path / "legacy-plugin-dsh"
    packages = dsh_home / "profiles/desktop/node_modules"
    package_names = {
        "dsh-plugin-tether": "tether-dsh-plugin",
        "dsh-plugin-tether-client": "tether-dsh-client",
        "tether-dsh-native-ui": "tether-dsh-native-ui",
        "tether-dsh-surface": "tether-dsh-surface",
    }
    with zipfile.ZipFile(old_assets["plugin"][0]) as archive:
        for archive_name in archive.namelist():
            match = re.fullmatch(r"tether-plugin-0\.2\.0/packages/([^/]+)/(.*)", archive_name)
            if not match:
                continue
            source_package, relative = match.groups()
            target = packages / package_names[source_package] / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(archive_name))
    plugin = UpdateManager(plugin_root, "plugin", dsh_home=dsh_home, manifest_url=manifest_url,
                           state_dir=tmp_path / "plugin-update-state")
    assert plugin.check()["current_version"] == "0.2.0"
    plugin_prepared = plugin.prepare()
    assert plugin_prepared["ok"] is True, plugin_prepared
    plugin_result = plugin.apply(plugin_prepared["prepared_id"])
    assert plugin_result["ok"] is True, plugin_result
    assert plugin.status()["current_version"] == version
    assert (packages / "tether-dsh-surface/updater/tether/updates.py").is_file()


def test_app_and_node_version_reads_preserve_actual_plugin_version(tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    dsh_home = tmp_path / "dsh"
    packages = dsh_home / "profiles/desktop/node_modules"
    for name in ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-native-ui", "tether-dsh-surface"):
        package = packages / name
        (package / "lib").mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"name": name, "version": "0.2.2"}), encoding="utf-8")
    client = packages / "tether-dsh-client/lib/client.js"
    client.write_text("const PLUGIN_VERSION = '0.2.2'\n", encoding="utf-8")
    for component in ("app", "node"):
        manager = UpdateManager(root, component, dsh_home=dsh_home, state_dir=tmp_path / f"state-{component}")
        versions = manager._versions()
        assert versions == {"app": "0.2.0", "node": "0.2.0", "plugin": "0.2.2"}
    plugin = UpdateManager(root, "plugin", dsh_home=dsh_home, state_dir=tmp_path / "state-plugin")
    assert plugin._versions() == {"app": "0.2.0", "node": "0.2.0", "plugin": "0.2.2"}


def test_status_ignores_prepared_updates_that_are_not_newer(tmp_path: Path) -> None:
    root = tmp_path / "install"
    seed_version(root)
    manager = UpdateManager(root, "app", dsh_home=tmp_path / "empty-dsh", state_dir=tmp_path / "state")
    prepared_dir = manager.state_dir / "prepared" / ("a" * 32)
    prepared_dir.mkdir(parents=True)
    (prepared_dir / "prepared.json").write_text(json.dumps({
        "id": "a" * 32, "component": "app", "from_version": "0.2.0", "to_version": "0.2.2",
    }), encoding="utf-8")
    assert manager.status()["prepared"][0]["to_version"] == "0.2.2"
    (root / "version.json").write_text(json.dumps({
        "schema": 1, "components": {"app": "0.2.2", "plugin": "0.2.0", "node": "0.2.0"},
    }), encoding="utf-8")
    assert manager.status()["prepared"] == []
