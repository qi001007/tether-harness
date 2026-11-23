"""Loopback-only live console for a Tether node.

The console always serves the node's own outbox so the machine doing the work
has a local view even when the controller link is down. When the APP supervisor
starts the node it also passes a per-run token, which enables the local device
API used by the APP as a zero-WAN-hop fast path. The API is bound to loopback,
requires that token, and dispatches through the same policy and audit checks as
the controller path.
"""

from __future__ import annotations

import hmac
import json
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from .dsh_rpc import DshRpcError
from .fs_service import FsError

PAGE = Path(__file__).with_name("console.html")
DEFAULT_PORT = 18894 if sys.platform == "win32" else 18893


class _Handler(BaseHTTPRequestHandler):
    # Keep the loopback device API on one connection per APP session instead of
    # paying a new TCP handshake for every fs/policy call.
    protocol_version = "HTTP/1.1"
    store: Any
    api: Any
    device: str
    token: str

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str, code: str = "fs_error") -> None:
        self._json(status, {"detail": {"error": message, "code": code}})

    def _authorized(self) -> bool:
        if not self.token:
            return False
        header = self.headers.get("Authorization") or ""
        return hmac.compare_digest(header, "Bearer " + self.token)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 2 * 1024 * 1024:
            # The body stays unread, so this connection cannot be reused.
            self.close_connection = True
            raise FsError("request body too large", "bad_args")
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise FsError("invalid JSON body", "bad_args") from exc
        if not isinstance(value, dict):
            raise FsError("JSON body must be an object", "bad_args")
        return value

    def _dispatch(self, op: str, args: dict[str, Any]) -> Any:
        try:
            return self.api.fs.dispatch(op, args)
        except FsError as exc:
            self._error(400, str(exc), exc.code)
        except Exception as exc:  # noqa: BLE001 - one failed request must not stop the console
            print(f"[console] {op} failed: {exc}", file=sys.stderr)
            self._error(500, "local operation failed", "local_error")
        return None

    def _device_route(self) -> tuple[list[str], dict[str, list[str]]] | None:
        parsed = urlsplit(self.path)
        parts = [unquote(item) for item in parsed.path.strip("/").split("/")]
        if len(parts) < 4 or parts[0] != "api" or parts[1] != "devices":
            self._error(404, "local route not found", "not_found")
            return None
        if parts[2] != self.device:
            self._error(404, "device not found", "device_not_found")
            return None
        return parts[3:], parse_qs(parsed.query)

    def _dsh_live(self) -> Any:
        """Native DSH reader proxy; absent when the node was built without it."""
        client = getattr(self.api, "dsh_rpc", None)
        if client is None:
            self._error(409, "native DSH proxy unavailable", "surface_unavailable")
        return client

    def _dsh_failure(self, exc: DshRpcError) -> None:
        if exc.code in ("bad_args", "read_only"):
            status = 400
        elif exc.code == "session/not-found":
            status = 404
        else:
            status = 502
        self._error(status, str(exc), exc.code)

    def _get(self, tail: list[str], query: dict[str, list[str]]) -> None:
        if len(tail) == 3 and tail[0] == "mesh" and tail[2] == "route":
            runtime = getattr(self.api.fs, "mesh_runtime", None)
            if runtime is None:
                self._error(409, "selected EasyTier network is not ready (mesh_runtime_missing)",
                            "network_not_connected")
                return
            network_id = tail[1]
            try:
                expected_network_id = uuid.UUID(network_id).hex
                status = runtime.status_for_network(network_id)
            except Exception:
                self._error(400, "network_id is invalid", "bad_network_id")
                return
            route = status.get("socks_proxy") if isinstance(status, dict) else None
            try:
                runtime_network_id = uuid.UUID(str(status.get("network_id") or "")).hex
            except (ValueError, TypeError, AttributeError):
                runtime_network_id = ""
            if (status.get("state") != "ready" or runtime_network_id != expected_network_id or
                    not isinstance(route, dict) or route.get("host") != "127.0.0.1" or
                    type(route.get("port")) is not int or not 1 <= route["port"] <= 65535):
                self._error(409, f"selected EasyTier network is not ready "
                                 f"(state={status.get('state') if isinstance(status, dict) else 'unknown'}, "
                                 f"network_id={runtime_network_id or 'unknown'})",
                            "network_not_connected")
                return
            result = {"protocol": 1, "device_id": self.device, "network_id": network_id,
                      "state": "ready", "socks_proxy": route,
                      "peers": status.get("peers"),
                      "peer_count": status.get("peer_count"),
                      "remote_peer_count": status.get("remote_peer_count"),
                      "peer_connectivity": status.get("peer_connectivity", "unknown"),
                      "cost": status.get("cost"), "tunnel": status.get("tunnel"),
                      "latency_ms": status.get("latency_ms"), "loss_rate": status.get("loss_rate"),
                      "nat_type": status.get("nat_type"), "peer_read_at": status.get("peer_read_at")}
        elif tail == ["mesh"]:
            network_id = (query.get("network_id") or [None])[0]
            try:
                result = self.api.fs.mesh_summary(network_id)
            except FsError as exc:
                self._error(400, str(exc), exc.code)
                return
        elif tail == ["sftp-relay", "consent"]:
            try:
                result = self.api.fs.local_sftp_relay_status((query.get("network_id") or [""])[0])
            except FsError as exc:
                self._error(400, str(exc), exc.code)
                return
        elif tail == ["workspaces"]:
            result = self._dispatch("workspaces", {})
        elif tail == ["drives"]:
            result = self._dispatch("drives", {})
        elif tail == ["policy"]:
            result = self._dispatch("policy_get", {})
        elif tail == ["audit"]:
            try:
                limit = int((query.get("limit") or ["100"])[0])
                offset = int((query.get("offset") or ["0"])[0])
            except ValueError:
                self._error(400, "limit and offset must be integers", "bad_args")
                return
            result = self._dispatch("audit_list", {"limit": limit, "offset": offset})
        elif tail == ["dsh", "surface"]:
            surface = getattr(self.api, "native_surface", None)
            url = surface.local_url() if surface is not None else None
            if not url:
                self._error(409, "native DSH surface unavailable", "descriptor_missing")
                return
            result = {"available": True, "url": url}
            info = getattr(surface, "descriptor_info", None)
            if callable(info):
                result.update(info() or {})
        elif tail == ["dsh", "sessions"]:
            result = {"sessions": self.api.dsh_sessions.list(),
                      "home": str(self.api.dsh_sessions.home)}
        elif len(tail) == 3 and tail[0] == "dsh" and tail[1] == "sessions":
            transcript = self.api.dsh_sessions.transcript(tail[2])
            if transcript is None:
                self._error(400, "DSH session not found", "not_found")
                return
            result = transcript
        elif tail == ["dsh", "live", "sessions"]:
            client = self._dsh_live()
            if client is None:
                return
            try:
                sessions = client.list_sessions()
            except DshRpcError as exc:
                self._dsh_failure(exc)
                return
            result = {"sessions": sessions, "source": "native"}
        elif len(tail) == 5 and tail[:3] == ["dsh", "live", "sessions"] and tail[4] == "page":
            client = self._dsh_live()
            if client is None:
                return
            try:
                through_seq = int((query.get("throughSeq") or [""])[0])
                max_messages = int((query.get("maxMessages") or ["50"])[0])
            except ValueError:
                self._error(400, "throughSeq and maxMessages must be integers", "bad_args")
                return
            try:
                result = client.page(tail[3], through_seq, max_messages)
            except DshRpcError as exc:
                self._dsh_failure(exc)
                return
        else:
            self._error(404, "local route not found", "not_found")
            return
        if result is not None:
            self._json(200, result)

    def _post(self, tail: list[str]) -> None:
        try:
            body = self._body()
        except FsError as exc:
            self._error(400, str(exc), exc.code)
            return
        if len(tail) == 2 and tail[0] == "fs":
            result = self._dispatch(tail[1], body)
        elif tail == ["policy"]:
            result = self._dispatch("policy_set", body)
        elif tail == ["sftp-relay", "consent"]:
            try:
                result = self.api.fs.local_sftp_relay_consent(body)
            except FsError as exc:
                self._error(400, str(exc), exc.code)
                return
        elif len(tail) == 5 and tail[:3] == ["dsh", "live", "sessions"] and tail[4] == "prompt":
            client = self._dsh_live()
            if client is None:
                return
            try:
                request_id = body.get("requestId")
                result = client.prompt(tail[3], str(body.get("text") or ""),
                                       request_id=str(request_id) if request_id else None,
                                       mode=str(body.get("mode") or "queue"))
            except DshRpcError as exc:
                self._dsh_failure(exc)
                return
        elif tail == ["dsh", "workspaces", "register"]:
            try:
                result = self.api.dsh_sessions.register_workspace(
                    str(body.get("path") or ""), str(body.get("title") or ""))
            except FsError as exc:
                self._error(400, str(exc), exc.code)
                return
            except Exception as exc:  # noqa: BLE001
                print(f"[console] workspace register failed: {exc}", file=sys.stderr)
                self._error(500, "workspace register failed", "local_error")
                return
        else:
            self._error(404, "local route not found", "not_found")
            return
        if result is not None:
            self._json(200, result)

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        path = self.path.split("?")[0]
        if path == "/state":
            self._json(200, self.store.snapshot(self.device))
            return
        if path in ("/", "/index.html"):
            body = PAGE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not path.startswith("/api/devices/"):
            self._error(404, "local route not found", "not_found")
            return
        if not self._authorized():
            self._error(401, "local token required", "unauthorized")
            return
        route = self._device_route()
        if route is None:
            return
        self._get(*route)

    def do_POST(self) -> None:  # noqa: N802 - stdlib API
        if not self.path.split("?")[0].startswith("/api/devices/"):
            self._error(404, "local route not found", "not_found")
            return
        if not self._authorized():
            self._error(401, "local token required", "unauthorized")
            return
        route = self._device_route()
        if route is None:
            return
        self._post(route[0])

    def log_message(self, _format: str, *args: Any) -> None:
        pass


def start(store: Any, device: str, port: int = DEFAULT_PORT, *,
          api: Any = None, token: str = "") -> ThreadingHTTPServer:
    handler = type("TetherConsoleHandler", (_Handler,), {
        "store": store, "device": device, "api": api, "token": token,
    })
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="tether-console")
    thread.start()
    return server
