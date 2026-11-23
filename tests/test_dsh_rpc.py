from __future__ import annotations

import json
import socket
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from tether.node import console
from tether.node.dsh_rpc import DshRpcClient, DshRpcError
from tether.node.fs_service import FsService

COOKIE = "dsh-auth-abc123=v1.payload.sig"


def write_descriptor(home: Path, origin: str = "http://127.0.0.1:59999",
                     token: str = "tok") -> Path:
    path = home / "storages" / "tether" / "native-surface.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "origin": origin,
                                "authenticated_url": f"{origin}/?token={token}"}), encoding="utf-8")
    return path


def reply(status: int, payload=None, cookies: str | None = None) -> tuple[int, list, bytes]:
    headers: list[tuple[str, str]] = []
    if cookies:
        headers.append(("Set-Cookie", f"{cookies}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict"))
    if payload is None:
        return status, headers, b"unauthorized" if status == 401 else b""
    body = json.dumps(payload, ensure_ascii=False).encode()
    headers.append(("Content-Type", "application/json"))
    return status, headers, body


def ok(value) -> dict:
    return {"type": "server-response", "rpcId": "x", "result": {"ok": True, "value": value}}


def failed(code: str, message: str) -> dict:
    return {"type": "server-response", "rpcId": "x",
            "result": {"ok": False, "error": {"code": code, "message": message, "details": {}}}}


class FakeTransport:
    def __init__(self, *responses) -> None:
        self.queue = list(responses)
        self.calls: list[dict] = []

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "headers": dict(headers),
                           "body": json.loads(body) if body else None})
        if not self.queue:
            raise AssertionError(f"unexpected {method} {url}")
        return self.queue.pop(0)


def make_client(tmp_path: Path, transport) -> DshRpcClient:
    write_descriptor(tmp_path)
    return DshRpcClient(tmp_path, transport=transport)


def test_rpc_envelope_and_session_list(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303, cookies=COOKIE),
                              reply(200, ok({"items": [{"sessionId": "s1", "cwd": "C:/w"}]})))
    client = make_client(tmp_path, transport)
    sessions = client.list_sessions()

    assert sessions == [{"sessionId": "s1", "cwd": "C:/w"}]
    login, call = transport.calls
    assert login["method"] == "GET"
    assert login["url"] == "http://127.0.0.1:59999/?token=tok"
    assert call["method"] == "POST"
    assert call["url"] == "http://127.0.0.1:59999/api/session/list"
    assert call["body"]["type"] == "client-request"
    assert call["body"]["method"] == "session/list"
    assert call["body"]["payload"] == {"args": {"_request": {}}}
    assert len(call["body"]["rpcId"]) == 36
    assert call["headers"]["Cookie"] == COOKIE


def test_page_arguments_match_native_schema(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303, cookies=COOKIE),
                              reply(200, ok({"records": [{"type": "event"}], "hasMore": False})))
    client = make_client(tmp_path, transport)
    page = client.page("session-1", 42, 20)

    assert page["records"] == [{"type": "event"}]
    assert transport.calls[1]["body"]["payload"]["args"] == {"request": {
        "address": {"kind": "session", "sessionId": "session-1"},
        "throughSeq": 42, "maxMessages": 20}}


def test_401_relogins_once(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303, cookies=COOKIE),
                              reply(401),
                              reply(303, cookies=COOKIE),
                              reply(200, ok({"items": []})))
    client = make_client(tmp_path, transport)

    assert client.list_sessions() == []
    assert [call["method"] for call in transport.calls] == ["GET", "POST", "GET", "POST"]
    assert transport.calls[3]["headers"]["Cookie"] == COOKIE


def test_second_401_surfaces_unauthorized(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303, cookies=COOKIE), reply(401),
                              reply(303, cookies=COOKIE), reply(401))
    client = make_client(tmp_path, transport)
    with pytest.raises(DshRpcError) as caught:
        client.list_sessions()
    assert caught.value.code == "unauthorized"
    assert caught.value.status == 401


def test_login_without_cookie_is_auth_failure(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303))
    client = make_client(tmp_path, transport)
    with pytest.raises(DshRpcError) as caught:
        client.list_sessions()
    assert caught.value.code == "auth_failed"


def test_upstream_error_code_passthrough(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303, cookies=COOKIE),
                              reply(200, failed("session/not-found", 'session "x" not found')))
    client = make_client(tmp_path, transport)
    with pytest.raises(DshRpcError) as caught:
        client.page("x", 1, 5)
    assert caught.value.code == "session/not-found"
    assert "not found" in str(caught.value)


def test_write_endpoints_are_refused_locally(tmp_path: Path) -> None:
    transport = FakeTransport()
    client = make_client(tmp_path, transport)
    for endpoint in ("session/delete", "session/rename", "workspace/create"):
        with pytest.raises(DshRpcError) as caught:
            client.rpc(endpoint, {})
        assert caught.value.code == "read_only"
    assert transport.calls == []


def test_bad_page_arguments_rejected_before_network(tmp_path: Path) -> None:
    transport = FakeTransport()
    client = make_client(tmp_path, transport)
    for args in (("", 1, 5), ("a/b", 1, 5), ("s", -1, 5), ("s", 1, 0), ("s", "3", 5)):
        with pytest.raises(DshRpcError) as caught:
            client.page(*args)
        assert caught.value.code == "bad_args"
    assert transport.calls == []


def test_descriptor_must_be_loopback(tmp_path: Path) -> None:
    write_descriptor(tmp_path, origin="http://10.0.0.5:59999")
    client = DshRpcClient(tmp_path, transport=FakeTransport())
    with pytest.raises(DshRpcError) as caught:
        client.list_sessions()
    assert caught.value.code == "descriptor_invalid"


def test_fallback_home_is_used(tmp_path: Path) -> None:
    primary, secondary = tmp_path / "primary", tmp_path / "secondary"
    primary.mkdir()
    write_descriptor(secondary)
    transport = FakeTransport(reply(303, cookies=COOKIE), reply(200, ok({"items": []})))
    client = DshRpcClient(primary, fallback_homes=(secondary,), transport=transport)
    assert client.list_sessions() == []
    assert client.descriptor == secondary / "storages" / "tether" / "native-surface.json"


def test_default_transport_reports_dead_daemon() -> None:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    client = DshRpcClient.__new__(DshRpcClient)
    client.timeout = 1.0
    with pytest.raises(DshRpcError) as caught:
        DshRpcClient._http_transport(client, "GET", f"http://127.0.0.1:{port}/?token=t", {}, None)
    # Windows retries the refused loopback connect until the socket timeout fires.
    assert caught.value.code in ("host_unreachable", "timeout")


class FakeClient:
    def __init__(self, sessions=None, page=None, error: DshRpcError | None = None) -> None:
        self._sessions = sessions or []
        self._page = page or {"records": [], "hasMore": False}
        self._error = error
        self.pages: list[tuple] = []

    def list_sessions(self):
        if self._error:
            raise self._error
        return self._sessions

    def page(self, session_id, through_seq, max_messages):
        self.pages.append((session_id, through_seq, max_messages))
        if self._error:
            raise self._error
        return self._page


@pytest.fixture()
def live_api(tmp_path: Path):
    home = tmp_path / "home"
    home.mkdir()
    workspace = tmp_path / "node-work"
    workspace.mkdir()
    svc = FsService(device="DEV", workspace=workspace, data_dir=tmp_path / "data",
                    workspaces_root=tmp_path / "TetherWorkspaces")
    dsh_rpc = FakeClient(sessions=[{"sessionId": "session-1", "cwd": "D:/w"}])
    api = SimpleNamespace(fs=svc, dsh_rpc=dsh_rpc)
    store = SimpleNamespace(snapshot=lambda device: {"device": device})
    server = console.start(store, "DEV", 0, api=api, token="local-token")
    try:
        yield {"port": server.server_address[1], "dsh_rpc": dsh_rpc, "api": api}
    finally:
        server.shutdown()
        server.server_close()


def call(port: int, path: str, token: str | None = "local-token"):
    headers = {"Authorization": "Bearer " + token} if token else {}
    request = Request(f"http://127.0.0.1:{port}{path}", method="GET", headers=headers)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode())
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def test_console_live_sessions_route(live_api) -> None:
    status, body = call(live_api["port"], "/api/devices/DEV/dsh/live/sessions")
    assert status == 200
    assert body == {"sessions": [{"sessionId": "session-1", "cwd": "D:/w"}], "source": "native"}


def test_console_live_page_route(live_api) -> None:
    status, body = call(live_api["port"],
                        "/api/devices/DEV/dsh/live/sessions/session-1/page?throughSeq=155&maxMessages=20")
    assert status == 200
    assert body == {"records": [], "hasMore": False}
    assert live_api["dsh_rpc"].pages == [("session-1", 155, 20)]


def test_console_live_routes_require_token(live_api) -> None:
    status, body = call(live_api["port"], "/api/devices/DEV/dsh/live/sessions", token=None)
    assert status == 401
    assert body["detail"]["code"] == "unauthorized"


def test_console_live_page_rejects_bad_query(live_api) -> None:
    status, body = call(live_api["port"],
                        "/api/devices/DEV/dsh/live/sessions/session-1/page?throughSeq=&maxMessages=5")
    assert status == 400
    assert body["detail"]["code"] == "bad_args"
    assert live_api["dsh_rpc"].pages == []


def test_console_live_page_maps_upstream_code(live_api) -> None:
    live_api["dsh_rpc"]._error = DshRpcError('session "x" not found', "session/not-found")
    status, body = call(live_api["port"],
                        "/api/devices/DEV/dsh/live/sessions/x/page?throughSeq=1&maxMessages=5")
    assert status == 404
    assert body["detail"] == {"error": 'session "x" not found', "code": "session/not-found"}


def test_console_live_route_without_proxy(live_api) -> None:
    del live_api["api"].dsh_rpc
    status, body = call(live_api["port"], "/api/devices/DEV/dsh/live/sessions")
    assert status == 409
    assert body["detail"]["code"] == "surface_unavailable"

def test_prompt_envelope(tmp_path: Path) -> None:
    transport = FakeTransport(reply(303, cookies=COOKIE),
                              reply(200, ok({"requestId": "req-1", "sessionId": "s1"})))
    client = make_client(tmp_path, transport)
    result = client.prompt("s1", "hello", request_id="req-1")

    login, call = transport.calls
    assert call["url"] == "http://127.0.0.1:59999/api/session/prompt"
    assert call["body"]["method"] == "session/prompt"
    assert call["body"]["payload"]["args"] == {"request": {
        "requestId": "req-1", "sessionId": "s1", "mode": "queue",
        "content": [{"type": "text", "text": "hello"}]}}
    assert result == {"requestId": "req-1", "sessionId": "s1"}
