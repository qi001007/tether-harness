from __future__ import annotations

import hashlib
import io
import json
import os
import socket
import tarfile
import threading
from pathlib import Path

import pytest

from tether.node.agents_runtime import AgentsRuntime


class _Response:
    status = 200

    def __init__(self, body: bytes = b'{"status":"ok","version":"test"}') -> None:
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size: int = -1) -> bytes:
        return self.body


def test_authenticated_ready_sends_bearer_to_codeg_health(monkeypatch) -> None:
    import urllib.request

    captured = {}

    def open_request(request, timeout):
        captured["url"] = request.full_url
        captured["authorization"] = request.get_header("Authorization")
        captured["method"] = request.get_method()
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", open_request)
    runtime = object.__new__(AgentsRuntime)
    assert runtime._authenticated_ready(4200, "test-token") is True
    assert captured == {
        "url": "http://127.0.0.1:4200/api/health",
        "authorization": "Bearer test-token",
        "method": "POST",
        "timeout": 0.8,
    }


def test_authenticated_ready_rejects_non_ok_body(monkeypatch) -> None:
    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", lambda *_args, **_kwargs: _Response(b'{"status":"error"}'))
    runtime = object.__new__(AgentsRuntime)
    assert runtime._authenticated_ready(4200, "test-token") is False


def _make_runtime_archive(path: Path, members: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as archive:
        for name, contents in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(contents)
            archive.addfile(info, io.BytesIO(contents))


def test_linux_runtime_installer_verifies_archive_and_extracts_only_server(tmp_path: Path, monkeypatch) -> None:
    from tether.node import agents_runtime

    payload = b"fake-linux-codeg-server"
    archive = tmp_path / "runtime.tar.gz"
    _make_runtime_archive(archive, {
        "codeg-server-linux-x64/codeg-server": payload,
        "codeg-server-linux-x64/codeg-mcp": b"fake-mcp",
        "codeg-server-linux-x64/codeg-computer-helper": b"fake-helper",
        "codeg-server-linux-x64/codeg-cli": b"not installed",
        "codeg-server-linux-x64/web/index.html": b"upstream web is ignored",
    })
    monkeypatch.setattr(agents_runtime.platform, "system", lambda: "Linux")
    monkeypatch.setattr(agents_runtime.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(agents_runtime, "LINUX_SERVER_ARCHIVE_SIZE", archive.stat().st_size)
    monkeypatch.setattr(agents_runtime, "LINUX_SERVER_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    monkeypatch.setattr(agents_runtime, "LINUX_RUNTIME_MEMBERS", {
        "codeg-server-linux-x64/codeg-server": ("codeg-server", len(payload)),
        "codeg-server-linux-x64/codeg-mcp": ("codeg-mcp", len(b"fake-mcp")),
        "codeg-server-linux-x64/codeg-computer-helper": ("codeg-computer-helper", len(b"fake-helper")),
    })
    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "node-data"

    installed = Path(runtime._install_linux_binary(archive))
    assert archive.exists()
    assert installed.read_bytes() == payload
    if os.name != "nt":
        assert installed.stat().st_mode & 0o111
    assert (installed.parent / "codeg-mcp").read_bytes() == b"fake-mcp"
    assert (installed.parent / "codeg-computer-helper").read_bytes() == b"fake-helper"
    assert not (installed.parent / "codeg-cli").exists()
    assert not (installed.parent / "web").exists()


def test_linux_runtime_installer_rejects_bad_sha_without_installing(tmp_path: Path, monkeypatch) -> None:
    from tether.node import agents_runtime

    archive = tmp_path / "runtime.tar.gz"
    _make_runtime_archive(archive, {
        "codeg-server-linux-x64/codeg-server": b"server",
        "codeg-server-linux-x64/codeg-mcp": b"mcp",
        "codeg-server-linux-x64/codeg-computer-helper": b"helper",
    })
    monkeypatch.setattr(agents_runtime.platform, "system", lambda: "Linux")
    monkeypatch.setattr(agents_runtime.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(agents_runtime, "LINUX_SERVER_ARCHIVE_SIZE", archive.stat().st_size)
    monkeypatch.setattr(agents_runtime, "LINUX_SERVER_SHA256", "0" * 64)
    monkeypatch.setattr(agents_runtime, "LINUX_RUNTIME_MEMBERS", {
        "codeg-server-linux-x64/codeg-server": ("codeg-server", 6),
        "codeg-server-linux-x64/codeg-mcp": ("codeg-mcp", 3),
        "codeg-server-linux-x64/codeg-computer-helper": ("codeg-computer-helper", 6),
    })
    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "node-data"

    with pytest.raises(ValueError, match="SHA-256"):
        runtime._install_linux_binary(archive)
    assert archive.exists()
    assert not (runtime.data_dir.parent / "agents-runtime-linux" / "bin" / "codeg-server").exists()


def test_new_runtime_bootstrap_enables_delegation_without_overwriting_other_settings(tmp_path: Path, monkeypatch) -> None:
    import urllib.request

    captured = []

    def open_request(request, timeout):
        body = request.data or b"{}"
        captured.append((request.full_url.rsplit("/", 1)[-1], request.get_header("Authorization"), body))
        if len(captured) == 1:
            return _Response(b'{"enabled":false,"depth_limit":3,"other":"kept"}')
        return _Response(b'{"enabled":true,"depth_limit":3,"other":"kept"}')

    monkeypatch.setattr(urllib.request, "urlopen", open_request)
    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "agents-runtime"
    runtime.port = 4201
    runtime.token = "secret-token"
    runtime._bootstrap_new_runtime_delegation(True)

    assert [call[0] for call in captured] == ["get_delegation_settings", "set_delegation_settings"]
    assert all(call[1] == "Bearer secret-token" for call in captured)
    assert json.loads(captured[1][2]) == {"settings": {"enabled": True, "depth_limit": 3, "other": "kept"}}
    assert (runtime.data_dir / "delegation-bootstrap.json").exists()


def test_existing_runtime_bootstrap_preserves_delegation_opt_out(tmp_path: Path, monkeypatch) -> None:
    import urllib.request

    captured = []

    def open_request(request, timeout):
        captured.append(request.full_url)
        return _Response(b'{"enabled":false,"depth_limit":1}')

    monkeypatch.setattr(urllib.request, "urlopen", open_request)
    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "agents-runtime"
    runtime.port = 4201
    runtime.token = "secret-token"
    runtime._bootstrap_new_runtime_delegation(False)

    assert captured == ["http://127.0.0.1:4201/api/get_delegation_settings"]
    assert (runtime.data_dir / "delegation-bootstrap.json").exists()


def test_linux_install_start_is_single_flight_and_failure_stays_visible(tmp_path: Path, monkeypatch) -> None:
    from tether.node import agents_runtime

    entered = threading.Event()
    release = threading.Event()
    calls = []
    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "agents-runtime"
    runtime.workspace = tmp_path
    runtime.root = tmp_path / "bundle"
    runtime.process = None
    runtime.external_pid = 0
    runtime.port = 0
    runtime.token = ""
    runtime.lock = threading.RLock()
    runtime.install_thread = None
    runtime.installing = False
    runtime.install_error = ""
    monkeypatch.setattr(runtime, "_adopt", lambda: None)
    monkeypatch.setattr(runtime, "_is_running", lambda: False)
    monkeypatch.setattr(runtime, "_binary", lambda: "")
    monkeypatch.setattr(runtime, "_web_dir", lambda: "static")

    def install_binary():
        calls.append(1)
        entered.set()
        release.wait(2)
        raise ValueError("test download failure")

    monkeypatch.setattr(runtime, "_install_linux_binary", install_binary)
    monkeypatch.setattr(agents_runtime.platform, "system", lambda: "Linux")

    first = runtime.start()
    assert entered.wait(1)
    second = runtime.start()
    assert first["installing"] is True
    assert second["installing"] is True
    assert calls == [1]
    release.set()
    runtime.install_thread.join(2)
    assert runtime.status()["install_error"] == "test download failure"


def test_failed_first_delegation_bootstrap_retries_with_saved_new_state(tmp_path: Path, monkeypatch) -> None:
    import urllib.request

    calls = []

    def open_request(request, timeout):
        calls.append(request.full_url.rsplit("/", 1)[-1])
        if len(calls) == 1:
            raise OSError("temporary request failure")
        return _Response(b'{"enabled":false,"depth_limit":1}')

    monkeypatch.setattr(urllib.request, "urlopen", open_request)
    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "agents-runtime"
    runtime.port = 4201
    runtime.token = "secret-token"
    runtime._bootstrap_new_runtime_delegation(True)
    assert (runtime.data_dir / "delegation-bootstrap-pending.json").exists()

    runtime._bootstrap_new_runtime_delegation(False)

    assert calls == ["get_delegation_settings", "get_delegation_settings", "set_delegation_settings"]
    assert (runtime.data_dir / "delegation-bootstrap.json").exists()
    assert not (runtime.data_dir / "delegation-bootstrap-pending.json").exists()


def test_runtime_uses_an_alternate_port_when_the_default_is_occupied(tmp_path: Path, monkeypatch) -> None:
    from tether.node import agents_runtime

    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupied.bind(("127.0.0.1", 0))
    port = occupied.getsockname()[1]
    monkeypatch.setattr(agents_runtime, "BASE_PORT", port)
    monkeypatch.setattr(agents_runtime, "PORT_SPAN", 4)
    runtime = object.__new__(AgentsRuntime)

    try:
        assert runtime._free_port() != port
    finally:
        occupied.close()


def test_runtime_registers_the_actual_port_and_preserves_other_apps(tmp_path: Path) -> None:
    from tether.node.apps import AppCatalog

    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "data" / "agents-runtime"
    runtime._write_apps({"apps": [{"name": "Other", "port": 8800}, {"name": "Agents", "port": 4200}]})

    runtime._register(4201)
    entries = AppCatalog(runtime.data_dir.parent).entries()
    assert [(item["name"], item["target_port"]) for item in entries] == [("Other", 8800), ("Agents", 4201)]


def test_runtime_status_republishes_missing_route_without_dropping_other_apps(tmp_path: Path, monkeypatch) -> None:
    from tether.node.apps import AppCatalog

    class Process:
        @staticmethod
        def poll():
            return None

    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "data" / "agents-runtime"
    runtime.workspace = tmp_path
    runtime.root = tmp_path / "bundle"
    runtime.process = Process()
    runtime.external_pid = 0
    runtime.port = 4203
    runtime.token = "valid-token"
    runtime.lock = threading.RLock()
    runtime._write_apps({"apps": [{"name": "DSH Web", "port": 3080, "listen_port": 37301,
                                   "url": "http://10.144.0.1:37301", "path": "/?token=redacted"}]})
    monkeypatch.setattr(runtime, "_adopt", lambda: None)
    monkeypatch.setattr(runtime, "_is_running", lambda: True)
    monkeypatch.setattr(runtime, "_authenticated_ready", lambda _port, _token: True)

    result = runtime.status()

    entries = AppCatalog(runtime.data_dir.parent).entries()
    assert result["running"] is True
    assert [(item["name"], item["target_port"]) for item in entries] == [
        ("DSH Web", 3080), ("Agents", 4203)]


def test_stale_runtime_auth_hides_route_without_clearing_live_process(tmp_path: Path, monkeypatch) -> None:
    from tether.node import agents_runtime
    from tether.node.apps import AppCatalog

    class Process:
        @staticmethod
        def poll():
            return None

    runtime = object.__new__(AgentsRuntime)
    runtime.data_dir = tmp_path / "data" / "agents-runtime"
    runtime.workspace = tmp_path
    runtime.root = tmp_path / "bundle"
    runtime.process = Process()
    runtime.external_pid = 0
    runtime.port = 4200
    runtime.token = "stale-token"
    runtime.lock = threading.RLock()
    runtime._register(4200)
    state = runtime.data_dir / "runtime.json"
    state.parent.mkdir(parents=True, exist_ok=True)
    state.write_text('{"pid":123,"port":4200,"token":"stale-token"}', encoding="utf-8")
    monkeypatch.setattr(runtime, "_authenticated_ready", lambda _port, _token: False)

    result = runtime.status()

    assert result["running"] is False
    assert runtime.process is not None
    assert runtime.port == 4200
    assert state.exists()
    assert AppCatalog(runtime.data_dir.parent).entries() == []


def test_herdr_project_scope_is_stable_per_cwd_and_opt_in(tmp_path: Path) -> None:
    from tether.node.terminal import _herdr_project_launch

    first = tmp_path / "project-one"
    second = tmp_path / "project-two"
    first.mkdir()
    second.mkdir()
    command = ["/usr/bin/herdr", "--session", "tether"]

    scoped, env = _herdr_project_launch("herdr", command, first, None, windows=False)
    again, _ = _herdr_project_launch("herdr", command, first, None, windows=False)
    other, _ = _herdr_project_launch("herdr", command, second, None, windows=False)
    unchanged, _ = _herdr_project_launch("bash", command, first, None, windows=False)

    assert scoped == again
    assert scoped[1] == "--session" and scoped[2].startswith("tether-project-")
    assert scoped != other
    assert unchanged == command
    assert env is None


def test_herdr_project_scope_uses_windows_wrapper_environment(tmp_path: Path) -> None:
    from tether.node.terminal import _herdr_project_launch

    command = ["cmd.exe", "/d", "/s", "/c", "herdr.cmd"]
    scoped, env = _herdr_project_launch("herdr", command, tmp_path, {"KEEP": "yes"}, windows=True)
    assert scoped == command
    assert env and env["KEEP"] == "yes"
    assert env["TETHER_HERDR_SESSION"].startswith("tether-project-")
