import asyncio
import base64
import gzip
import json
import socket
import threading
from http.cookiejar import Cookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import websockets

from tether.node.native_surface import MAX_BODY, NativeSurface, NativeSurfaceError
from tether.node.fs_service import FsService
import tether.node.native_surface as native_surface_module

ORIGINAL_PROCESS_IDENTITY_MATCHES = NativeSurface._process_identity_matches

GZIP_BODY = gzip.compress(b"native gzip response body" * 200, mtime=0)
HTML_BODY = gzip.compress(
    b"<!doctype html><html><head><meta charset=\"utf-8\"></head><body>native</body></html>", mtime=0
)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/?token="):
            self.send_response(303)
            self.send_header("Set-Cookie", "session=secret-cookie; Path=/")
            self.send_header("Location", "/login")
            self.end_headers()
            return
        if getattr(self.server, "force_401_once", False):
            self.server.force_401_once = False
            self.send_response(401)
            self.end_headers()
            return
        if getattr(self.server, "force_auth_page_once", False):
            self.server.force_auth_page_once = False
            body = b"dsh web authentication required"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.headers.get("Cookie") != "session=secret-cookie":
            self.send_response(401)
            self.end_headers()
            return
        if self.headers.get("Origin") != f"http://127.0.0.1:{self.server.server_port}":
            self.send_response(403)
            self.end_headers()
            return
        if self.headers.get("Sec-Fetch-Site") != "same-origin":
            self.send_response(403)
            self.end_headers()
            return
        if self.path == "/gzip":
            if self.headers.get("Accept-Encoding") != "gzip":
                self.send_response(406)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(GZIP_BODY)
            return
        if self.path == "/html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("ETag", "\"old\"")
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()
            self.wfile.write(HTML_BODY)
            return
        if self.path.split("?", 1)[0] == "/plugins/events":
            if self.headers.get("Accept") != "text/event-stream":
                self.send_response(406)
                self.end_headers()
                return
            if self.path.endswith("?error=1"):
                self.send_response(503)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", "5")
                self.end_headers()
                self.wfile.write(b"error")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                first = b"data: first\n\n"
                self.wfile.write(f"{len(first):X}\r\n".encode() + first + b"\r\n")
                self.wfile.flush()
                self.server.sse_first_sent.set()
                self.server.sse_continue.wait(2)
                second = b"data: second\n\n"
                self.wfile.write(f"{len(second):X}\r\n".encode() + second + b"\r\n")
                self.wfile.flush()
                self.server.sse_second_sent.set()
                self.server.sse_finish.wait(2)
                third = b"data: after-close\n\n"
                self.wfile.write(f"{len(third):X}\r\n".encode() + third + b"\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                self.server.sse_disconnected.set()
            return
        body = b"native"
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Set-Cookie", "should-not-leak=yes")
        self.send_header("Location", "https://example.com/")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


@pytest.fixture(autouse=True)
def trust_synthetic_descriptor_processes(monkeypatch):
    monkeypatch.setattr(
        NativeSurface, "_process_identity_matches",
        lambda self, *args, **kwargs: (True, "ready"), raising=False
    )


@pytest.fixture
def native_home(tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.sse_first_sent = threading.Event()
    server.sse_second_sent = threading.Event()
    server.sse_continue = threading.Event()
    server.sse_finish = threading.Event()
    server.sse_disconnected = threading.Event()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    home = tmp_path
    descriptor = home / "storages" / "tether" / "native-surface.json"
    descriptor.parent.mkdir(parents=True)
    descriptor.write_text(json.dumps({
        "version": 1, "pid": 123, "origin": f"http://127.0.0.1:{port}",
        "authenticated_url": f"http://127.0.0.1:{port}/?token=secret-token", "updated_at": 1,
    }), encoding="utf-8")
    yield home, port, server
    server.sse_continue.set()
    server.sse_finish.set()
    server.shutdown()
    thread.join(timeout=2)


def test_sse_stream_delivers_chunks_without_eof_buffering_and_closes(native_home):
    async def run():
        home, _, server = native_home
        service = NativeSurface(home)
        with pytest.raises(NativeSurfaceError) as rejected:
            await service.call("http_stream_open", {"method": "GET", "path": "/api/upload"})
        assert rejected.value.code == "bad_path"
        opened = await asyncio.wait_for(service.call("http_stream_open", {
            "method": "GET", "path": "/plugins/events",
            "headers": {"accept": "text/event-stream"},
        }), 1)
        stream = opened["stream"]
        assert opened["status"] == 200
        assert "text/event-stream" in opened["headers"]["content-type"]
        first = await asyncio.wait_for(service.call("http_stream_read", {"stream": stream}), 1)
        assert first["kind"] == "chunk"
        assert base64.b64decode(first["data"]) == b"data: first\n\n"
        # The upstream intentionally pauses between events. The second read must wait
        # briefly and return the next bytes without requiring the response to end.
        asyncio.get_running_loop().call_later(0.1, server.sse_continue.set)
        started = asyncio.get_running_loop().time()
        second = await asyncio.wait_for(service.call("http_stream_read", {"stream": stream}), 1)
        assert asyncio.get_running_loop().time() - started >= 0.05
        assert second["kind"] == "chunk"
        assert base64.b64decode(second["data"]) == b"data: second\n\n"
        pump = service._http_streams[stream].pump
        await service.call("http_stream_close", {"stream": stream})
        assert pump.done() and pump.cancelled()
        assert await service.call("http_stream_read", {"stream": stream}) == {"kind": "closed"}
        error = await service.call("http_stream_open", {
            "method": "GET", "path": "/plugins/events?error=1",
            "headers": {"accept": "text/event-stream"},
        })
        assert error["status"] == 503
        assert base64.b64decode(error["body_base64"]) == b"error"
        await service.dispose()

    asyncio.run(run())


def test_sse_stream_reopen_works_while_another_stream_is_live(native_home):
    async def run():
        home, _, _ = native_home
        service = NativeSurface(home)
        first = await asyncio.wait_for(service.call("http_stream_open", {
            "method": "GET", "path": "/plugins/events",
            "headers": {"accept": "text/event-stream"},
        }), 1)
        second = await asyncio.wait_for(service.call("http_stream_open", {
            "method": "GET", "path": "/plugins/events",
            "headers": {"accept": "text/event-stream"},
        }), 1)
        assert first["status"] == 200 and second["status"] == 200
        assert first["stream"] != second["stream"]
        await service.dispose()

    asyncio.run(run())


def test_sse_stream_idle_ttl_closes_unpolled_reader(native_home, monkeypatch):
    async def run():
        home, _, _ = native_home
        monkeypatch.setattr(native_surface_module, "HTTP_STREAM_IDLE_TTL", 0.05)
        monkeypatch.setattr(native_surface_module, "HTTP_STREAM_WATCHDOG_POLL", 0.01)
        service = NativeSurface(home)
        opened = await service.call("http_stream_open", {
            "method": "GET", "path": "/plugins/events",
            "headers": {"accept": "text/event-stream"},
        })
        stream = opened["stream"]
        pump = service._http_streams[stream].pump
        watchdog = service._http_streams[stream].watchdog
        await asyncio.wait_for(watchdog, 1)
        assert pump.done()
        assert await service.call("http_stream_read", {"stream": stream}) == {"kind": "closed"}
        await service.dispose()

    asyncio.run(run())


def test_http_fixed_target_and_credential_filter(native_home):
    home, _, _ = native_home
    service = NativeSurface(home)
    assert service.status() == {"available": True, "reason": "ready"}
    result = asyncio.run(service.call("http", {"path": "/api/remote/connect", "headers": {
        "accept": "application/json", "authorization": "Bearer user-secret",
        "cookie": "user-cookie", "host": "evil.example",
    }}))
    assert result["status"] == 200
    assert base64.b64decode(result["body_base64"]) == b"native"
    assert "set-cookie" not in result["headers"]
    assert "location" not in result["headers"]


def test_device_fs_prefix_serves_this_node_files_and_raw_attachment_bytes(tmp_path, monkeypatch):
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    workspace = tmp_path / "node-work"
    workspace.mkdir()
    root = tmp_path / "TetherWorkspaces"
    root.mkdir()
    service = FsService(device="LAPTOP-01", workspace=workspace,
                        data_dir=tmp_path / "data", workspaces_root=root)
    service.policy.update({"mode": "full"})
    payload = "中文附件\r\n".encode("gb18030")
    target = root / "legacy.txt"
    target.write_bytes(payload)

    async def call(method, path, body=None):
        args = {"method": method, "path": path}
        if body is not None:
            args["body_base64"] = base64.b64encode(json.dumps(body).encode("utf-8")).decode("ascii")
        return await surface.call("http", args)

    surface = NativeSurface(tmp_path / "home", device_fs=service)

    async def run():
        drives = await call("GET", "/tether-device-fs/drives?device_id=LAPTOP-01")
        assert drives["status"] == 200
        assert isinstance(json.loads(base64.b64decode(drives["body_base64"]))["drives"], list)

        listing = await call("POST", "/tether-device-fs/list",
                             {"device_id": "LAPTOP-01", "path": str(root)})
        assert listing["status"] == 200
        entries = json.loads(base64.b64decode(listing["body_base64"]))["entries"]
        assert any(entry["name"] == "legacy.txt" for entry in entries)

        read = await call("POST", "/tether-device-fs/read",
                          {"device_id": "LAPTOP-01", "path": str(target), "offset": 0, "limit": 1024})
        result = json.loads(base64.b64decode(read["body_base64"]))
        assert read["status"] == 200
        assert result["device_id"] == "LAPTOP-01"
        assert result["binary"] is True
        assert base64.b64decode(result["base64"]) == payload

        dropped = b"dropped bytes"
        drop_target = root / "inbox" / "drop.txt"
        write = await call("POST", "/tether-device-fs/write_chunk", {
            "device_id": "LAPTOP-01", "path": str(drop_target),
            "transfer_id": "abcdef1234567890", "offset": 0, "total": len(dropped),
            "base64": base64.b64encode(dropped).decode("ascii"), "final": True, "overwrite": False,
        })
        assert write["status"] == 200, write
        assert drop_target.read_bytes() == dropped

        mismatch = await call("GET", "/tether-device-fs/drives?device_id=OTHER")
        assert mismatch["status"] == 404
        detail = json.loads(base64.b64decode(mismatch["body_base64"]))["detail"]
        assert detail["code"] == "device_not_found"

        unknown = await call("GET", "/tether-device-fs/other")
        assert unknown["status"] == 404
        wrong_method = await call("GET", "/tether-device-fs/read")
        assert wrong_method["status"] == 405
        await surface.dispose()

    asyncio.run(run())


def test_http_request_body_limit_uses_surface_constant(native_home, monkeypatch):
    assert MAX_BODY == 8 * 1024 * 1024
    monkeypatch.setattr(native_surface_module, "MAX_BODY", 4)
    service = NativeSurface(native_home[0])
    service._ensure_authenticated = lambda: None
    with pytest.raises(NativeSurfaceError) as error:
        asyncio.run(service.call("http", {"path": "/upload", "method": "POST",
                                           "body_base64": base64.b64encode(b"12345").decode()}))
    assert error.value.code == "too_large"


def test_asset_gets_use_the_long_surface_timeout(native_home, monkeypatch):
    service = NativeSurface(native_home[0])
    service._ensure_authenticated = lambda: None
    service._cookie_header = lambda: ""
    monkeypatch.setattr(service, "_target", lambda path, **_: "http://127.0.0.1:1" + path)
    seen = []

    class Response:
        code = 200
        headers = {}

        def read(self, _limit):
            return b"ok"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, request, timeout=None):
            seen.append((request.full_url, timeout))
            return Response()

    monkeypatch.setattr(native_surface_module.urllib.request, "build_opener", lambda *_, **__: Opener())
    asyncio.run(service.call("http", {"path": "/plugins/??a/client.js", "method": "GET"}))
    asyncio.run(service.call("http", {"path": "/api/state", "method": "GET"}))
    assert seen[0][1] == native_surface_module.LONG_ASSET_TIMEOUT == 180
    assert seen[1][1] == native_surface_module.TIMEOUT == 20


def test_gzip_response_bytes_and_encoding_header_are_preserved(native_home):
    service = NativeSurface(native_home[0])
    result = asyncio.run(service.call("http", {"path": "/gzip", "headers": {
        "accept": "application/javascript",
    }}))
    assert result["status"] == 200
    assert result["headers"]["content-encoding"] == "gzip"
    assert base64.b64decode(result["body_base64"]) == GZIP_BODY


def test_html_response_drops_native_sidebar_seam(native_home):
    service = NativeSurface(native_home[0])
    result = asyncio.run(service.call("http", {"path": "/html", "headers": {"accept": "text/html"}}))
    body = base64.b64decode(result["body_base64"])
    assert result["status"] == 200
    assert b'<style id="tether-native-surface">' in body
    assert b'[class*="sidebarCol"]{border-right:0!important}' in body
    assert b"</head>" in body
    assert "content-encoding" not in result["headers"]
    assert "etag" not in result["headers"]
    assert result["headers"]["cache-control"] == "no-store"


def test_http_reauthenticates_once_after_dsh_rejects_the_session(native_home):
    home, _port, server = native_home
    surface = NativeSurface(home)
    assert surface._load()
    server.force_401_once = True
    result = surface._http({"method": "GET", "path": "/api/anything"})
    assert result["status"] == 200
    assert base64.b64decode(result["body_base64"]) == b"native"


def test_http_reauthenticates_on_the_dsh_auth_page(native_home):
    home, _port, server = native_home
    surface = NativeSurface(home)
    assert surface._load()
    server.force_auth_page_once = True
    result = surface._http({"method": "GET", "path": "/api/anything"})
    assert result["status"] == 200
    assert base64.b64decode(result["body_base64"]) == b"native"


def test_dual_instances_report_bundled_web_instead_of_stale_desktop(tmp_path, native_home):
    desktop_home, port, _server = native_home
    web_home = tmp_path / "node-data" / "dsh-web" / "home"
    descriptor = web_home / "storages" / "tether" / "native-surface.json"
    descriptor.parent.mkdir(parents=True)
    descriptor.write_text(json.dumps({
        "version": 1, "profile": "web", "pid": 9400,
        "origin": f"http://127.0.0.1:{port}",
        "authenticated_url": f"http://127.0.0.1:{port}/?token=web-token",
        "updated_at": 2,
    }), encoding="utf-8")
    (desktop_home / "storages" / "tether" / "native-surface.json").unlink()

    surface = NativeSurface(desktop_home, fallback_homes=(web_home,))

    assert surface.local_url() == f"http://127.0.0.1:{port}/?token=web-token"
    info = surface.descriptor_info()
    assert info["instance_kind"] == "node-bundled-web"
    assert info["profile"] == "web"
    assert info["pid"] == 9400
    assert info["account_state"] == "unknown"
    assert "web-token" not in json.dumps(info)


class FakeIdentityProcess:
    def __init__(self, name, argv, ports):
        self._attrs = {
            "name": name, "exe": argv[0] if argv else "", "cmdline": argv,
            "create_time": 1000,
            "net_connections": [type("Connection", (), {"laddr": ("127.0.0.1", port)})() for port in ports],
        }

    def as_dict(self, _attrs):
        return self._attrs


def test_descriptor_identity_rejects_reused_pid_and_port_mismatch(tmp_path, monkeypatch):
    monkeypatch.setattr(native_surface_module.psutil, "Process",
                        lambda pid: FakeIdentityProcess("steamwebhelper.exe", ["steamwebhelper.exe"], []))
    surface = NativeSurface(tmp_path)

    ok, reason = ORIGINAL_PROCESS_IDENTITY_MATCHES(
        surface, 5196, 64053, layer="desktop", profile="desktop", home=tmp_path)

    assert ok is False
    assert reason == "port_owner_mismatch"


def test_descriptor_identity_accepts_bundled_web_only_with_matching_profile(tmp_path, monkeypatch):
    argv = ["E:/apps/tether/resources/tether-runtime/components/nodejs/node.exe",
            "E:/apps/tether/resources/tether-runtime/components/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
            "web", "--host", "127.0.0.1", "--no-open", "--port", "0"]
    monkeypatch.setattr(native_surface_module.psutil, "Process",
                        lambda pid: FakeIdentityProcess("node.exe", argv, [50669]))
    surface = NativeSurface(tmp_path)

    ok, reason = ORIGINAL_PROCESS_IDENTITY_MATCHES(
        surface, 9400, 50669, layer="node-bundled-web", profile="web", home=tmp_path)

    assert ok is True
    assert reason == "ready"


def test_stale_primary_descriptor_is_retired_before_using_bundled_web(native_home, tmp_path):
    _desktop_home, port, _server = native_home
    desktop_home = tmp_path / "stale-desktop-home"
    desktop_descriptor = desktop_home / "storages" / "tether" / "native-surface.json"
    desktop_descriptor.parent.mkdir(parents=True)
    desktop_descriptor.write_text(json.dumps({
        "version": 1, "profile": "desktop", "pid": 5196,
        "origin": "http://127.0.0.1:1", "authenticated_url": "http://127.0.0.1:1/?token=stale",
        "updated_at": 1,
    }), encoding="utf-8")
    web_home = tmp_path / "node-data" / "dsh-web" / "home"
    web_descriptor = web_home / "storages" / "tether" / "native-surface.json"
    web_descriptor.parent.mkdir(parents=True)
    web_descriptor.write_text(json.dumps({
        "version": 1, "profile": "web", "pid": 9400,
        "origin": f"http://127.0.0.1:{port}",
        "authenticated_url": f"http://127.0.0.1:{port}/?token=web-token", "updated_at": 2,
    }), encoding="utf-8")
    surface = NativeSurface(desktop_home, fallback_homes=(web_home,))

    assert surface._load() is True
    assert not desktop_descriptor.is_file()
    assert (desktop_home / "storages" / "tether" / "native-surface.json.stale").is_file()
    info = surface.descriptor_info()
    assert info["selected_layer"] == "node-bundled-web"
    assert "desktop:port_down:1" in info["selection_reason"]


def test_local_url_only_when_the_descriptor_is_live(native_home, tmp_path):
    home, port, _server = native_home
    surface = NativeSurface(home)
    assert surface.local_url() == f"http://127.0.0.1:{port}/?token=secret-token"
    info = surface.descriptor_info()
    assert info["account_state"] == "unknown"
    assert info["pid"] == 123
    assert info["updated_at"] == 1.0
    assert info["instance_kind"] == "desktop"
    assert info["selected_layer"] == "desktop"
    assert info["selection_reason"] == "primary_valid"
    assert info["process_identity"] == "ready"
    assert info["dsh_home"] == str(home)
    assert info["dsh_home_label"] == home.name
    assert info["port"] == port
    assert NativeSurface(tmp_path / "empty").local_url() is None


@pytest.mark.parametrize("origin", ["http://example.com:1234", "http://127.0.0.1:0", "http://127.0.0.1:65536"])
def test_rejects_non_loopback_or_invalid_port(tmp_path, origin):
    path = tmp_path / "storages" / "tether" / "native-surface.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"version": 1, "origin": origin,
                                "authenticated_url": origin + "/?token=x"}), encoding="utf-8")
    assert NativeSurface(tmp_path).status() == {"available": False, "reason": "descriptor_invalid"}


def test_status_distinguishes_missing_descriptor_and_unreachable_host(tmp_path):
    assert NativeSurface(tmp_path).status() == {"available": False, "reason": "descriptor_missing"}
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    path = tmp_path / "storages" / "tether" / "native-surface.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"version": 1, "origin": f"http://127.0.0.1:{port}",
                                "authenticated_url": f"http://127.0.0.1:{port}/?token=x"}), encoding="utf-8")
    assert NativeSurface(tmp_path).status() == {"available": False, "reason": "host_unreachable"}


def test_active_profile_requires_profile_metadata_and_live_host_pid(tmp_path, monkeypatch):
    home = tmp_path
    path = home / "storages" / "tether" / "native-surface.json"
    path.parent.mkdir(parents=True)
    # NativeSurface only trusts a descriptor whose host is actually listening,
    # so bind a real loopback listener instead of a dangling fixed port.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        data = {"version": 1, "pid": 12345, "profile": "work",
                "origin": f"http://127.0.0.1:{port}",
                "authenticated_url": f"http://127.0.0.1:{port}/?token=fixture"}
        path.write_text(json.dumps(data), encoding="utf-8")
        queried = []
        monkeypatch.setattr(NativeSurface, "_process_identity_matches",
                            lambda self, pid, port, **kwargs: queried.append((pid, port)) or (True, "ready"))
        assert NativeSurface(home).active_profile() == "work"
        assert queried == [(12345, port), (12345, port)]

        data["pid"] = 2147483646
        path.write_text(json.dumps(data), encoding="utf-8")
        monkeypatch.setattr(NativeSurface, "_process_identity_matches",
                            lambda self, pid, port, **kwargs: (False, "pid_missing"))
        assert NativeSurface(home).active_profile() is None

        data["pid"] = 12345
        data.pop("profile")
        path.write_text(json.dumps(data), encoding="utf-8")
        assert NativeSurface(home).active_profile() is None


@pytest.mark.parametrize("path", ["//evil.example/x", "/a/../b", "/a/%2e%2e/b", "https://evil/x"])
def test_rejects_ssrf_paths(native_home, path):
    service = NativeSurface(native_home[0])
    with pytest.raises(NativeSurfaceError):
        asyncio.run(service.call("http", {"path": path}))


@pytest.mark.asyncio
async def test_websocket_binary_roundtrip_and_close(native_home):
    home, _, _ = native_home
    received = asyncio.Future()

    async def echo(ws):
        frame = await ws.recv()
        received.set_result(frame)
        await ws.send(frame)

    async with websockets.serve(echo, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        descriptor = home / "storages" / "tether" / "native-surface.json"
        old = json.loads(descriptor.read_text(encoding="utf-8"))
        old["origin"] = old["origin"].rsplit(":", 1)[0] + f":{port}"
        old["authenticated_url"] = old["origin"] + "/?token=secret-token"
        descriptor.write_text(json.dumps(old), encoding="utf-8")
        service = NativeSurface(home)
        # The WS server does not implement HTTP auth, so seed the jar from its test HTTP endpoint.
        service._jar.set_cookie(Cookie(
            0, "session", "secret-cookie", None, False, "127.0.0.1", True, False, "/", True,
            False, None, True, None, None, {}, False))
        service._ensure_authenticated = lambda: None
        opened = await service.call("ws_open", {"path": "/api/remote.mux?x=1"})
        frame = base64.b64encode(b"\x00\xffnative").decode("ascii")
        await service.call("ws_send", {"channel": opened["channel"], "kind": "binary", "data": frame})
        result = await service.call("ws_receive", {"channel": opened["channel"]})
        assert result == {"kind": "binary", "data": frame}
        assert await received == b"\x00\xffnative"
        await service.call("ws_close", {"channel": opened["channel"]})
        assert await service.call("ws_receive", {"channel": opened["channel"]}) == {"kind": "closed"}
        await service.dispose()


@pytest.mark.asyncio
async def test_http_and_send_progress_while_receive_is_pending(native_home, monkeypatch):
    home, _, _ = native_home
    finish = asyncio.Event()

    async def handler(ws):
        await ws.recv()
        await ws.send("response")
        await finish.wait()

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        descriptor = home / "storages" / "tether" / "native-surface.json"
        data = json.loads(descriptor.read_text(encoding="utf-8"))
        data["origin"] = f"http://127.0.0.1:{port}"
        data["authenticated_url"] = data["origin"] + "/?token=test"
        descriptor.write_text(json.dumps(data), encoding="utf-8")
        service = NativeSurface(home)
        service._ensure_authenticated = lambda: None
        opened = await service.call("ws_open", {"path": "/api/remote.mux"})
        channel = opened["channel"]
        receive = asyncio.create_task(service.call("ws_receive", {"channel": channel}))
        await asyncio.sleep(0)
        assert await asyncio.wait_for(
            service.call("ws_send", {"channel": channel, "kind": "text", "data": "go"}), 1
        ) == {"ok": True}
        assert await asyncio.wait_for(receive, 1) == {"kind": "text", "data": "response"}

        monkeypatch.setattr(service, "_http", lambda *_: {"status": 204, "headers": {}, "body_base64": ""})
        receive = asyncio.create_task(service.call("ws_receive", {"channel": channel}))
        await asyncio.sleep(0)
        assert (await asyncio.wait_for(service.call("http", {"path": "/api/remote/connect"}), 1))["status"] == 204
        finish.set()
        assert await asyncio.wait_for(receive, 1) == {"kind": "closed"}
        await service.dispose()


@pytest.mark.asyncio
async def test_websocket_receive_timeout_and_dispose(native_home, monkeypatch):
    class IdleSocket:
        closed = False

        async def recv(self):
            await asyncio.Future()

        async def close(self):
            self.closed = True

    monkeypatch.setattr(native_surface_module, "TIMEOUT", 0.01)
    service = NativeSurface(native_home[0])
    socket = IdleSocket()
    service._channels["test"] = socket
    assert await service.call("ws_receive", {"channel": "test"}) == {"kind": "idle"}
    await service.dispose()
    assert socket.closed


def test_active_profile_falls_back_to_live_dsh_host_argv(tmp_path, monkeypatch):
    profile_dir = tmp_path / "profiles" / "desktop"
    profile_dir.mkdir(parents=True)

    class HostProcess:
        info = {"cmdline": [
            r"D:\DeepSeek harness\DeepSeek Harness.exe",
            "--expose-internals",
            r"D:\DeepSeek harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js",
            str(profile_dir),
        ]}

    monkeypatch.setattr(native_surface_module.psutil, "process_iter", lambda *_: [HostProcess()])
    service = NativeSurface(tmp_path)
    assert service.active_profile() == "desktop"

    class UnrelatedProcess:
        info = {"cmdline": ["dsh-desktop-host", str(tmp_path / "other")]}

    monkeypatch.setattr(native_surface_module.psutil, "process_iter", lambda *_: [UnrelatedProcess()])
    assert service.active_profile() is None


def _plugin_bundle_body():
    anchor = native_surface_module.DIRECTORY_FLOW_ANCHOR
    return (
        "window.__ModuleLoader__.load({\n  id: 'tether-dsh-client',\n  factory: (require) => {\n"
        "    function apply(ctx) {\n      if (true) {\n        try { noop()\n        "
        + anchor + "\n          return\n      }\n    }\n  }\n})\n"
    )


def test_directory_flow_injects_once_into_single_and_combo_bundles():
    inject = native_surface_module.inject_tether_directory_flow
    anchor = native_surface_module.DIRECTORY_FLOW_ANCHOR
    body = _plugin_bundle_body().encode("utf-8")
    headers = {"content-type": "application/javascript; charset=utf-8",
               "etag": '"rev"', "cache-control": "max-age=3600"}
    single_path = "/plugins/??tether-dsh-client/client.js"
    out, out_headers = inject(body, dict(headers), single_path)
    assert out != body
    assert out.count(native_surface_module.DIRECTORY_FLOW_MARKER.encode("utf-8")) == 1
    assert out.count(anchor.encode("utf-8")) == 1
    assert out_headers["cache-control"] == "no-store"
    assert "etag" not in out_headers
    # 应用 combo：本插件段被替换，相邻段原样保留。
    neighbour = 'window.__ModuleLoader__.load({\n  id: "other-plugin",\n  factory: () => ({})\n})\n'
    combo = body + b";\n" + neighbour.encode("utf-8")
    combo_path = "/plugins/??tether-dsh-client/client.js,other-plugin/client.js"
    out_combo, _ = inject(combo, dict(headers), combo_path)
    assert out_combo.count(native_surface_module.DIRECTORY_FLOW_MARKER.encode("utf-8")) == 1
    assert out_combo.endswith(neighbour.encode("utf-8"))
    # 再注入一次不会叠加（标记已存在）。
    again, _ = inject(out_combo, dict(headers), combo_path)
    assert again == out_combo


def test_directory_flow_requires_unique_anchor_and_javascript_type():
    inject = native_surface_module.inject_tether_directory_flow
    anchor = native_surface_module.DIRECTORY_FLOW_ANCHOR
    body = _plugin_bundle_body().encode("utf-8")
    path = "/plugins/??tether-dsh-client/client.js"
    js = {"content-type": "application/javascript"}
    duplicated = body.replace(anchor.encode("utf-8"), anchor.encode("utf-8") + b"\n" + anchor.encode("utf-8"))
    assert inject(duplicated, dict(js), path)[0] == duplicated
    assert inject(b"no anchor here", dict(js), path)[0] == b"no anchor here"
    assert inject(body, {"content-type": "application/json"}, path + ".map")[0] == body
    assert inject(body, dict(js), "/assets/index.js")[0] == body


def test_directory_flow_gzip_body_is_decompressed_for_injection():
    inject = native_surface_module.inject_tether_directory_flow
    body = _plugin_bundle_body().encode("utf-8")
    headers = {"content-type": "application/javascript", "content-encoding": "gzip"}
    out, out_headers = inject(gzip.compress(body), headers, "/plugins/??tether-dsh-client/client.js")
    assert native_surface_module.DIRECTORY_FLOW_MARKER.encode("utf-8") in out
    assert "content-encoding" not in out_headers
    plain, _ = inject(body, {"content-type": "application/javascript"}, "/plugins/??tether-dsh-client/client.js")
    assert out == plain


def test_directory_flow_missing_snippet_passes_through(tmp_path, monkeypatch):
    monkeypatch.setattr(native_surface_module, "DIRECTORY_FLOW_SNIPPET_PATH", tmp_path / "absent.js")
    body = _plugin_bundle_body().encode("utf-8")
    headers = {"content-type": "application/javascript"}
    out, out_headers = native_surface_module.inject_tether_directory_flow(
        body, dict(headers), "/plugins/??tether-dsh-client/client.js")
    assert out == body
    assert out_headers == headers
