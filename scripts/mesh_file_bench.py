#!/usr/bin/env python3
"""Prototype: file transfer over the managed EasyTier mesh (SOCKS5 ingress).

Two roles, stdlib only, so the same file can be copied to any Tether node:

  receive --port 52010 --root DIR [--socks 127.0.0.1:53061]
  send --target 10.224.0.3 --port 52010 --socks 127.0.0.1:53061 \
       --file X [--streams 1] [--transit 10.224.0.2]

The receiver binds 127.0.0.1:PORT; the managed network maps the peer's
service_ip:PORT back to that loopback port (proxy_network) and the network ACL
allows 52000-52063, so no TUN or admin right is needed on either side.

Routes tested here:
  direct   server A dials peer B service_ip:port through A's own SOCKS
  transit  A uploads to a third node T, T streams to B in the same job
  relay    a peer uses its public relay (croc/SFTP) - not part of this file
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

CHUNK = 1024 * 1024


# ---------------------------------------------------------------- SOCKS5 client
def socks_connect(socks: tuple[str, int], host: str, port: int, timeout: float = 15.0) -> socket.socket:
    sock = socket.create_connection(socks, timeout=timeout)
    sock.settimeout(600.0)
    sock.sendall(b"\x05\x01\x00")
    if sock.recv(2) != b"\x05\x00":
        raise OSError("socks: no-auth rejected")
    try:
        addr = socket.inet_aton(host)
        request = b"\x05\x01\x00\x01" + addr
    except OSError:
        name = host.encode()
        request = b"\x05\x01\x00\x03" + bytes([len(name)]) + name
    sock.sendall(request + struct.pack("!H", port))
    reply = sock.recv(10)
    if len(reply) < 4 or reply[1] != 0:
        raise OSError(f"socks: connect failed ({reply[1] if len(reply) > 1 else '?'})")
    return sock


def dial(socks: tuple[str, int] | None, host: str, port: int) -> socket.socket:
    if socks is None:
        sock = socket.create_connection((host, port), timeout=20.0)
        sock.settimeout(300.0)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        return sock
    return socks_connect(socks, host, port)


def parse_addr(value: str) -> tuple[str, int]:
    host, _, port = value.rpartition(":")
    return host, int(port)


# ---------------------------------------------------------------- receiver
class Receiver:
    def __init__(self, root: Path, socks: tuple[str, int] | None) -> None:
        self.root = root
        self.socks = socks
        self.lock = threading.Lock()

    def target_path(self, name: str) -> Path:
        safe = unquote(name).replace("\\", "/").strip("/")
        path = (self.root / safe).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError("path escapes root")
        path.parent.mkdir(parents=True, exist_ok=True)
        return path


def make_handler(state: Receiver):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):  # quieter benchmark
            return

        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlsplit(self.path)
            if parsed.path == "/ping":
                self._json(200, {"ok": True, "host": socket.gethostname()})
                return
            if not parsed.path.startswith("/download/"):
                self._json(404, {"error": "not_found"})
                return
            path = state.target_path(parsed.path[len("/download/"):])
            if not path.is_file():
                self._json(404, {"error": "missing"})
                return
            size = path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with path.open("rb") as handle:
                while True:
                    block = handle.read(CHUNK)
                    if not block:
                        break
                    self.wfile.write(block)
            return

        def do_PUT(self) -> None:  # noqa: N802
            parsed = urlsplit(self.path)
            length = int(self.headers.get("Content-Length", "0"))
            if parsed.path.startswith("/relay"):
                self._relay(parsed, length)
                return
            if not parsed.path.startswith("/upload/"):
                self._json(404, {"error": "not_found"})
                return
            path = state.target_path(parsed.path[len("/upload/"):])
            digest = hashlib.sha256()
            received = 0
            started = time.perf_counter()
            with path.open("wb") as handle:
                while received < length:
                    block = self.rfile.read(min(CHUNK, length - received))
                    if not block:
                        break
                    handle.write(block)
                    digest.update(block)
                    received += len(block)
            elapsed = max(time.perf_counter() - started, 1e-6)
            self._json(200, {"ok": received == length, "bytes": received,
                             "sha256": digest.hexdigest(), "seconds": round(elapsed, 3),
                             "mbps": round(received / elapsed / 1_000_000, 2)})

        def _relay(self, parsed, length: int) -> None:
            query = parse_qs(parsed.query)
            target = query.get("to", [""])[0]
            name = query.get("name", [os.urandom(6).hex()])[0]
            if not target or state.socks is None:
                self._json(400, {"error": "relay_target_or_socks_missing"})
                return
            host, port = parse_addr(target)
            upstream = dial(state.socks, host, port)
            upstream.sendall(
                f"PUT /upload/{name} HTTP/1.1\r\nHost: {host}\r\n"
                f"Content-Length: {length}\r\nConnection: close\r\n\r\n".encode())
            forwarded = 0
            started = time.perf_counter()
            while forwarded < length:
                block = self.rfile.read(min(CHUNK, length - forwarded))
                if not block:
                    break
                upstream.sendall(block)
                forwarded += len(block)
            response = b""
            while b"\r\n\r\n" not in response:
                block = upstream.recv(4096)
                if not block:
                    break
                response += block
            upstream.close()
            elapsed = max(time.perf_counter() - started, 1e-6)
            self._json(200, {"ok": forwarded == length, "bytes": forwarded,
                             "seconds": round(elapsed, 3),
                             "mbps": round(forwarded / elapsed / 1_000_000, 2)})

    return Handler


# ---------------------------------------------------------------- sender
def put_part(socks: tuple[str, int], target: str, port: int, path: Path, offset: int,
             length: int, name: str, results: list, index: int, via: str = "") -> None:
    host = target
    sock = dial(socks, host, port)
    prefix = f"/relay?to={host}:{port}&name={name}" if via == "transit" else f"/upload/{name}"
    sock.sendall(f"PUT {prefix} HTTP/1.1\r\nHost: {host}\r\nContent-Length: {length}\r\n"
                 f"Connection: close\r\n\r\n".encode())
    sent = 0
    started = time.perf_counter()
    with path.open("rb") as handle:
        handle.seek(offset)
        remaining = length
        while remaining > 0:
            block = handle.read(min(CHUNK, remaining))
            if not block:
                break
            sock.sendall(block)
            remaining -= len(block)
            sent += len(block)
    elapsed = max(time.perf_counter() - started, 1e-6)
    body = b""
    try:
        while True:
            block = sock.recv(65536)
            if not block:
                break
            body += block
    finally:
        sock.close()
    results[index] = {"bytes": sent, "seconds": round(elapsed, 3),
                      "mbps": round(sent / elapsed / 1_000_000, 2),
                      "response": body.split(b"\r\n\r\n", 1)[-1][:200].decode("utf-8", "replace")}


def send(args) -> dict:
    source = Path(args.file)
    size = source.stat().st_size
    socks = None if args.socks == "direct" else parse_addr(args.socks)
    streams = max(1, args.streams)
    part = (size + streams - 1) // streams
    results: list = [None] * streams
    threads = []
    started = time.perf_counter()
    for index in range(streams):
        offset = index * part
        length = min(part, size - offset)
        if length <= 0:
            results[index] = {"bytes": 0, "seconds": 0, "mbps": 0, "response": ""}
            continue
        name = f"{args.name or source.name}.part{index}"
        thread = threading.Thread(target=put_part, args=(
            socks, args.target, args.port, source, offset, length, name, results, index,
            "transit" if args.transit else ""), daemon=True)
        thread.start()
        threads.append(thread)
    for thread in threads:
        thread.join()
    elapsed = time.perf_counter() - started
    sent = sum(int(item.get("bytes", 0)) for item in results if item)
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        while True:
            block = handle.read(CHUNK * 4)
            if not block:
                break
            digest.update(block)
    return {"file": str(source), "bytes": size, "streams": streams,
            "target": f"{args.target}:{args.port}", "via": args.transit or "direct",
            "seconds": round(elapsed, 3), "mbps": round(sent / elapsed / 1_000_000, 2),
            "sha256": digest.hexdigest(), "parts": results}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="role", required=True)

    recv = sub.add_parser("receive")
    recv.add_argument("--port", type=int, default=52010)
    recv.add_argument("--host", default="127.0.0.1")
    recv.add_argument("--root", required=True)
    recv.add_argument("--socks", default="127.0.0.1:53061")

    snd = sub.add_parser("send")
    snd.add_argument("--target", required=True)
    snd.add_argument("--port", type=int, default=52010)
    snd.add_argument("--socks", default="127.0.0.1:53061")
    snd.add_argument("--file", required=True)
    snd.add_argument("--streams", type=int, default=1)
    snd.add_argument("--transit", default="")
    snd.add_argument("--name", default="")
    snd.add_argument("--json-out", default="")

    args = parser.parse_args()
    if args.role == "receive":
        state = Receiver(Path(args.root), None if args.socks == "direct" else parse_addr(args.socks))
        server = ThreadingHTTPServer((args.host, args.port), make_handler(state))
        print(json.dumps({"listening": f"{args.host}:{args.port}", "root": str(state.root)}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        return 0
    report = send(args)
    text = json.dumps(report, indent=2)
    print(text)
    if args.json_out:
        Path(args.json_out).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())