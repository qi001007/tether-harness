"""Loopback-only live console for a Tether node.

It is intentionally read-only and serves the node's own outbox, so the machine
doing the work always has a local view even when the controller link is down.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

PAGE = Path(__file__).with_name("console.html")


class _Handler(BaseHTTPRequestHandler):
    store: Any
    device: str

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        if self.path.split("?")[0] == "/state":
            body = json.dumps(self.store.snapshot(self.device), ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?")[0] in ("/", "/index.html"):
            body = PAGE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, _format: str, *args: Any) -> None:
        pass


def start(store: Any, device: str, port: int = 18893) -> ThreadingHTTPServer:
    handler = type("TetherConsoleHandler", (_Handler,), {"store": store, "device": device})
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="tether-console")
    thread.start()
    return server