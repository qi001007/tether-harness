"""Token-authenticated file API on the EasyTier virtual LAN.

The Hub control link remains the default path. This listener lets the owner's
other devices use the direct mesh for bulk reads/writes without a TUN-aware
client: the URL is the peer's virtual IP and the token is fetched from the Hub.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import secrets
import socketserver
import threading
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable

import psutil

from .fs_service import FsError

MAX_BODY = 4 * 1024 * 1024
LOOPBACK = ("127.0.0.0/8", "::1/128")
MESH = ("10.144.0.0/24",)


def easy_tier_address() -> str:
    try:
        interfaces = psutil.net_if_addrs()
    except (psutil.Error, OSError):
        return ""
    for name, addresses in interfaces.items():
        lowered = name.lower()
        if not (lowered.startswith("et_") or "easytier" in lowered):
            continue
        for address in addresses:
            value = getattr(address, "address", "")
            if getattr(address, "family", None) == 2 and value.startswith("10.144."):
                return value
    return ""


class _Handler(BaseHTTPRequestHandler):
    dispatch: Callable[[str, dict[str, Any]], Any]
    token: str
    allowed: tuple[ipaddress._BaseNetwork, ...]
    api: "DirectApi"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _authorized(self) -> bool:
        try:
            address = ipaddress.ip_address(self.client_address[0])
        except ValueError:
            return False
        if not any(address in network for network in self.allowed):
            return False
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return False
        return hmac.compare_digest(header[7:], self.token)

    def do_GET(self) -> None:
        if not self._authorized():
            self._json(401, {"ok": False, "error": {"code": "forbidden", "message": "unauthorized"}})
            return
        if self.path == "/health":
            self._json(200, {"ok": True, "host": self.api.host, "port": self.api.port})
            return
        self._json(404, {"ok": False, "error": {"code": "not_found", "message": "unknown path"}})

    def do_POST(self) -> None:
        if not self._authorized():
            self._json(401, {"ok": False, "error": {"code": "forbidden", "message": "unauthorized"}})
            return
        if not self.path.startswith("/fs/"):
            self._json(404, {"ok": False, "error": {"code": "not_found", "message": "unknown path"}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "invalid body size"}})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, OSError):
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "invalid json"}})
            return
        if not isinstance(body, dict):
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "body must be an object"}})
            return
        operation = self.path[len("/fs/"):]
        try:
            value = self.dispatch(operation, body)
        except FsError as error:
            self._json(200, {"ok": False, "error": {"code": error.code, "message": str(error)}})
            return
        except Exception:
            self._json(500, {"ok": False, "error": {"code": "internal", "message": "direct operation failed"}})
            return
        self._json(200, {"ok": True, "value": value})

    def log_message(self, _format: str, *_args: object) -> None:
        pass


class _Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class DirectApi:
    def __init__(self, dispatch: Callable[[str, dict[str, Any]], Any], *,
                 port: int | None = None, token: str | None = None,
                 allowed: tuple[str, ...] = MESH + LOOPBACK) -> None:
        self.dispatch = dispatch
        self.port = port if port is not None else int(os.environ.get("TETHER_DIRECT_PORT", "18895"))
        self.token = token or secrets.token_urlsafe(32)
        self.allowed = tuple(ipaddress.ip_network(value, strict=False) for value in allowed)
        self.host = ""
        self._server: _Server | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        handler = type("_DirectHandler", (_Handler,), {
            "dispatch": staticmethod(self.dispatch),
            "token": self.token,
            "allowed": self.allowed,
            "api": self,
        })
        server = _Server(("0.0.0.0", self.port), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self._server, self._thread = server, thread
        self.port = server.server_address[1]
        self.host = easy_tier_address()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    def info(self) -> dict[str, Any]:
        self.host = easy_tier_address()
        return {"host": self.host, "port": self.port, "token": self.token}