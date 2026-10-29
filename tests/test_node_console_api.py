from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from tether.node import console
from tether.node.fs_service import FsService


@pytest.fixture()
def local_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    workspace = tmp_path / "node-work"
    workspace.mkdir()
    root = tmp_path / "TetherWorkspaces"
    svc = FsService(device="DEV", workspace=workspace, data_dir=tmp_path / "data", workspaces_root=root)
    sessions = SimpleNamespace(
        home=tmp_path / "dsh-home",
        list=lambda: [{"session_id": "s1"}],
        transcript=lambda session_id: {"session_id": session_id, "events": []} if session_id == "s1" else None,
        register_workspace=lambda path, title: {"path": path, "title": title},
    )
    api = SimpleNamespace(fs=svc, dsh_sessions=sessions)
    store = SimpleNamespace(snapshot=lambda device: {"device": device, "runs": [], "events": []})
    server = console.start(store, "DEV", 0, api=api, token="local-token")
    port = server.server_address[1]
    try:
        yield {"svc": svc, "root": root, "port": port, "api": api}
    finally:
        server.shutdown()
        server.server_close()


def call(port: int, method: str, path: str, body: dict | None = None, token: str | None = "local-token"):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    request = Request(f"http://127.0.0.1:{port}{path}", data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode())
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def test_local_api_requires_token_and_rejects_other_devices(local_api) -> None:
    port = local_api["port"]
    status, body = call(port, "GET", "/api/devices/DEV/workspaces", token=None)
    assert status == 401
    assert body["detail"]["code"] == "unauthorized"
    status, body = call(port, "GET", "/api/devices/OTHER/workspaces")
    assert status == 404
    assert body["detail"]["code"] == "device_not_found"
    status, body = call(port, "GET", "/state", token=None)
    assert status == 200 and body["device"] == "DEV"


def test_local_api_matches_controller_routes_and_enforces_policy(local_api) -> None:
    port = local_api["port"]
    root: Path = local_api["root"]
    status, body = call(port, "GET", "/api/devices/DEV/workspaces")
    assert status == 200 and body["root"] == str(root)
    status, body = call(port, "POST", "/api/devices/DEV/fs/mkdir", {"path": str(root / "demo")})
    assert status == 200 and body["path"].endswith("demo")
    status, body = call(port, "POST", "/api/devices/DEV/fs/write",
                        {"path": str(root / "demo" / "a.txt"), "text": "hello"})
    assert status == 200 and body["bytes"] == 5
    status, body = call(port, "POST", "/api/devices/DEV/fs/list", {"path": str(root / "demo")})
    assert status == 200 and [entry["name"] for entry in body["entries"]] == ["a.txt"]
    status, body = call(port, "POST", "/api/devices/DEV/fs/write",
                        {"path": str(root.parent / "outside.txt"), "text": "no"})
    assert status == 400 and body["detail"]["code"] == "denied"
    status, body = call(port, "GET", "/api/devices/DEV/audit?limit=5&offset=0")
    assert status == 200 and body["count"] >= 2
    status, body = call(port, "GET", "/api/devices/DEV/dsh/sessions")
    assert status == 200 and body["sessions"] == [{"session_id": "s1"}]
    status, body = call(port, "GET", "/api/devices/DEV/dsh/sessions/s1")
    assert status == 200 and body == {"session_id": "s1", "events": []}
    status, body = call(port, "GET", "/api/devices/DEV/dsh/sessions/missing")
    assert status == 400 and body["detail"]["code"] == "not_found"
    status, body = call(port, "POST", "/api/devices/DEV/dsh/workspaces/register",
                        {"path": str(root / "demo"), "title": "demo"})
    assert status == 200 and body == {"path": str(root / "demo"), "title": "demo"}


def test_local_api_exposes_the_same_host_surface_url(local_api) -> None:
    base = local_api["api"]
    api = SimpleNamespace(fs=base.fs, dsh_sessions=base.dsh_sessions,
                          native_surface=SimpleNamespace(local_url=lambda: "http://127.0.0.1:43123/?token=local",
                                                          descriptor_info=lambda: {"pid": 4321, "updated_at": 1.0}))
    store = SimpleNamespace(snapshot=lambda device: {"device": device})
    server = console.start(store, "DEV", 0, api=api, token="local-token")
    try:
        port = server.server_address[1]
        status, body = call(port, "GET", "/api/devices/DEV/dsh/surface")
        assert status == 200
        assert body == {"available": True, "url": "http://127.0.0.1:43123/?token=local", "pid": 4321, "updated_at": 1.0}
        status, body = call(port, "GET", "/api/devices/DEV/dsh/surface", token=None)
        assert status == 401 and body["detail"]["code"] == "unauthorized"
        status, body = call(port, "GET", "/api/devices/OTHER/dsh/surface")
        assert status == 404 and body["detail"]["code"] == "device_not_found"
    finally:
        server.shutdown()
        server.server_close()


def test_local_surface_route_reports_unavailable(local_api) -> None:
    base = local_api["api"]
    api = SimpleNamespace(fs=base.fs, dsh_sessions=base.dsh_sessions,
                          native_surface=SimpleNamespace(local_url=lambda: None))
    store = SimpleNamespace(snapshot=lambda device: {"device": device})
    server = console.start(store, "DEV", 0, api=api, token="local-token")
    try:
        status, body = call(server.server_address[1], "GET", "/api/devices/DEV/dsh/surface")
        assert status == 409 and body["detail"]["code"] == "descriptor_missing"
    finally:
        server.shutdown()
        server.server_close()


def test_local_api_is_disabled_without_a_token(local_api) -> None:
    port = local_api["port"]
    store = SimpleNamespace(snapshot=lambda device: {"device": device})
    server = console.start(store, "DEV", 0, api=local_api["api"], token="")
    try:
        status, body = call(server.server_address[1], "GET", "/api/devices/DEV/workspaces", token=None)
        assert status == 401 and body["detail"]["code"] == "unauthorized"
    finally:
        server.shutdown()
        server.server_close()
