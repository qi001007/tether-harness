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
import tether.node.native_surface as native_surface_module

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
        body = b"native"
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Set-Cookie", "should-not-leak=yes")
        self.send_header("Location", "https://example.com/")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


@pytest.fixture
def native_home(tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
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
    yield home, port
    server.shutdown()
    thread.join(timeout=2)


def test_http_fixed_target_and_credential_filter(native_home):
    home, _ = native_home
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


def test_http_request_body_limit_uses_surface_constant(native_home, monkeypatch):
    assert MAX_BODY == 8 * 1024 * 1024
    monkeypatch.setattr(native_surface_module, "MAX_BODY", 4)
    service = NativeSurface(native_home[0])
    service._ensure_authenticated = lambda: None
    with pytest.raises(NativeSurfaceError) as error:
        asyncio.run(service.call("http", {"path": "/upload", "method": "POST",
                                           "body_base64": base64.b64encode(b"12345").decode()}))
    assert error.value.code == "too_large"


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
    data = {"version": 1, "pid": 12345, "profile": "work",
            "origin": "http://127.0.0.1:33091",
            "authenticated_url": "http://127.0.0.1:33091/?token=fixture"}
    path.write_text(json.dumps(data), encoding="utf-8")
    queried = []
    monkeypatch.setattr(native_surface_module.psutil, "pid_exists", lambda pid: queried.append(pid) or True)
    assert NativeSurface(home).active_profile() == "work"
    assert queried == [12345]

    data["pid"] = 2147483646
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(native_surface_module.psutil, "pid_exists", lambda _pid: False)
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
    home, _ = native_home
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
    home, _ = native_home
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
