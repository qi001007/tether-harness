"""Token-authenticated file API on the EasyTier virtual LAN.

The Hub control link remains the default path. This listener lets the owner's
other devices use the direct mesh for bulk reads/writes without a TUN-aware
client: the URL is the peer's virtual IP and the token is fetched from the Hub.
"""

from __future__ import annotations

import base64
import hmac
import ipaddress
import json
import os
import secrets
import socketserver
import threading
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

import psutil

from .fs_service import FsError

MAX_BODY = 8 * 1024 * 1024
LOOPBACK = ("127.0.0.0/8", "::1/128")
MESH = ("10.144.0.0/24",)


def easy_tier_address() -> str:
    try:
        interfaces = psutil.net_if_addrs()
    except (psutil.Error, OSError):
        return ""
    fallback = ""
    for name, addresses in interfaces.items():
        lowered = name.lower()
        preferred = lowered.startswith("et_") or "easytier" in lowered
        for address in addresses:
            value = getattr(address, "address", "")
            if getattr(address, "family", None) == 2 and value.startswith("10.144."):
                if preferred:
                    return value
                fallback = fallback or value
    return fallback


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
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
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")
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
        parsed = urlparse(self.path)
        if parsed.path == "/fs/read_raw":
            self._read_raw()
            return
        if parsed.path == "/fs/write_raw":
            self._write_raw(parsed)
            return
        if parsed.path == "/fs/write_stream":
            self._write_stream(parsed)
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

    def _body_size(self) -> int:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 0 or length > MAX_BODY:
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "invalid body size"}})
            return -1
        return length

    def _read_raw(self) -> None:
        length = self._body_size()
        if length < 0:
            return
        if length <= 0:
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
        try:
            value = self.dispatch("read", {
                "path": body.get("path"), "offset": body.get("offset", 0),
                "limit": body.get("limit", 0), "encoding": "base64",
            })
        except FsError as error:
            self._json(200, {"ok": False, "error": {"code": error.code, "message": str(error)}})
            return
        except Exception:
            self._json(500, {"ok": False, "error": {"code": "internal", "message": "direct read failed"}})
            return
        data = base64.b64decode(value.get("base64") or "")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Tether-Size", str(value.get("size", 0)))
        self.send_header("X-Tether-Offset", str(value.get("offset", 0)))
        self.send_header("X-Tether-Reset", "1" if value.get("reset") else "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "X-Tether-Size, X-Tether-Offset, X-Tether-Reset")
        self.end_headers()
        self.wfile.write(data)

    def _write_raw(self, parsed: Any) -> None:
        length = self._body_size()
        if length < 0:
            return
        data = self.rfile.read(length) if length else b""
        query = parse_qs(parsed.query)

        def one(name: str, default: str = "") -> str:
            values = query.get(name)
            return values[0] if values else default

        try:
            args = {
                "path": one("path"), "transfer_id": one("transfer_id"),
                "offset": int(one("offset", "0") or 0), "total": int(one("total", "0") or 0),
                "base64": base64.b64encode(data).decode("ascii"),
                "final": one("final") in {"1", "true"},
                "overwrite": one("overwrite") in {"1", "true"},
                "resume": one("resume") in {"1", "true"},
            }
        except (TypeError, ValueError):
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "invalid transfer metadata"}})
            return
        try:
            value = self.dispatch("write_chunk", args)
        except FsError as error:
            self._json(200, {"ok": False, "error": {"code": error.code, "message": str(error)}})
            return
        except Exception:
            self._json(500, {"ok": False, "error": {"code": "internal", "message": "direct write failed"}})
            return
        self._json(200, {"ok": True, "value": value})

    def _write_stream(self, parsed: Any) -> None:
        query = parse_qs(parsed.query)

        def one(name: str, default: str = "") -> str:
            values = query.get(name)
            return values[0] if values else default

        try:
            total = int(one("total", "0") or 0)
            length = int(self.headers.get("Content-Length", "-1"))
        except (TypeError, ValueError):
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "invalid transfer metadata"}})
            return
        if length != total or length < 0:
            self._json(400, {"ok": False, "error": {"code": "bad_request", "message": "content length must match total"}})
            return
        stream = getattr(self.api, "stream", None)
        if stream is None:
            self._json(400, {"ok": False, "error": {"code": "unavailable", "message": "stream writer unavailable"}})
            return
        try:
            writer = stream.open_write_stream(one("path"), one("transfer_id"), total,
                                              one("overwrite") in {"1", "true"})
        except FsError as error:
            self._json(200, {"ok": False, "error": {"code": error.code, "message": str(error)}})
            return
        except Exception:
            self._json(500, {"ok": False, "error": {"code": "internal", "message": "stream open failed"}})
            return
        remaining = length
        try:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise OSError("client closed the stream")
                writer.write(chunk)
                remaining -= len(chunk)
            value = writer.finish()
        except FsError as error:
            writer.abort()
            self._json(200, {"ok": False, "error": {"code": error.code, "message": str(error)}})
            return
        except Exception:
            writer.abort()
            self._json(500, {"ok": False, "error": {"code": "internal", "message": "stream write failed"}})
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
                 allowed: tuple[str, ...] = MESH + LOOPBACK, stream: Any = None) -> None:
        self.dispatch = dispatch
        self.stream = stream
        self.port = port if port is not None else int(os.environ.get("TETHER_DIRECT_PORT", "18895"))
        self.token = token or secrets.token_urlsafe(32)
        self.allowed = tuple(ipaddress.ip_network(value, strict=False) for value in allowed)
        self.host = ""
        self._servers: list[_Server] = []
        self._threads: list[threading.Thread] = []

    def _start_server(self, host: str, port: int, handler: type) -> _Server:
        server = _Server((host, port), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self._servers.append(server)
        self._threads.append(thread)
        return server

    def start(self) -> None:
        handler = type("_DirectHandler", (_Handler,), {
            "dispatch": staticmethod(self.dispatch),
            "token": self.token,
            "allowed": self.allowed,
            "api": self,
        })
        loopback = self._start_server("127.0.0.1", self.port, handler)
        self.port = loopback.server_address[1]
        mesh = easy_tier_address()
        if mesh and mesh != "127.0.0.1":
            try:
                self._start_server(mesh, self.port, handler)
            except OSError:
                pass
        self.host = mesh

    def stop(self) -> None:
        for server in self._servers:
            server.shutdown()
            server.server_close()
        self._servers = []
        self._threads = []

    def info(self) -> dict[str, Any]:
        mesh = easy_tier_address()
        if mesh:
            self.host = mesh
        return {"host": self.host, "port": self.port, "token": self.token}