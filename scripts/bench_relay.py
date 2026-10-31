#!/usr/bin/env python3
"""Measure the Tether control plane and relay transfer throughput.

The same command is meant to be run before and after a network overlay:

    python scripts/bench_relay.py --size-mb 2

It reads the Hub URL and token from apps/tether-app/data/hub.json (or the
TETHER_CONTROLLER_URL / TETHER_ACCESS_TOKEN environment variables), never
prints credentials, and removes its temporary files.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import os
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def credentials() -> tuple[str, str]:
    config = ROOT / "apps" / "tether-app" / "data" / "hub.json"
    values = {}
    if config.exists():
        try:
            values = json.loads(config.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            values = {}
    url = str(os.environ.get("TETHER_CONTROLLER_URL") or values.get("url") or "").rstrip("/")
    token = str(os.environ.get("TETHER_ACCESS_TOKEN") or values.get("accessToken") or "")
    if not url or not token:
        raise SystemExit("Hub URL/token are not configured")
    return url, token


def request_json(base: str, token: str, path: str, body: dict | None = None, *,
                 timeout: float = 30.0) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json",
               "Content-Type": "application/json"}
    last = None
    for _ in range(4):
        try:
            req = urllib.request.Request(base + path, data=data, headers=headers,
                                         method="POST" if data is not None else "GET")
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8"))
            except Exception:
                detail = {}
            if error.code == 400:
                raise RuntimeError(f"{path}: {detail}") from None
            last = error
            time.sleep(0.7)
        except Exception as error:  # TLS EOF is observed occasionally
            last = error
            time.sleep(0.7)
    raise last  # type: ignore[misc]


def control_latency(url: str, token: str, samples: int) -> dict:
    parsed = urllib.parse.urlsplit(url)
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=15,
                                             context=ssl.create_default_context())
    values = []
    for _ in range(samples):
        started = time.perf_counter()
        connection.request("GET", "/api/state", headers={
            "Authorization": "Bearer " + token, "Accept": "application/json",
            "Connection": "keep-alive"})
        response = connection.getresponse()
        response.read()
        values.append((time.perf_counter() - started) * 1000)
    connection.close()
    values.sort()
    return {
        "samples": len(values),
        "p50_ms": round(statistics.median(values), 1),
        "p95_ms": round(values[max(0, int(len(values) * 0.95) - 1)], 1),
        "min_ms": round(values[0], 1),
        "max_ms": round(values[-1], 1),
    }


def surface_latency(base: str, token: str, device: str) -> float | None:
    descriptor = request_json(base, token, f"/api/devices/{urllib.parse.quote(device)}/dsh/surface")
    url = descriptor.get("url")
    if not descriptor.get("available") or not url:
        return None
    import http.cookiejar
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    started = time.perf_counter()
    try:
        with opener.open(urllib.request.Request(url, headers={
                "Origin": "dsh-app://app", "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Dest": "iframe", "Accept": "text/html"}), timeout=30) as response:
            response.read(20000)
    except Exception:
        # A loopback device may return a direct token URL instead of /tether-connect.
        try:
            with opener.open(urllib.request.Request(url, headers={"Accept": "text/html"}),
                             timeout=30) as response:
                response.read(20000)
        except Exception:
            return None
    return round((time.perf_counter() - started) * 1000, 1)


def fs(base: str, token: str, device: str, op: str, body: dict) -> dict:
    return request_json(base, token,
                        f"/api/devices/{urllib.parse.quote(device)}/fs/{op}", body, timeout=60)


def read_all(base: str, token: str, device: str, path: str, chunk: int = 1024 * 1024) -> bytes:
    output = bytearray()
    offset = 0
    while True:
        reply = fs(base, token, device, "read",
                   {"path": path, "offset": offset, "limit": chunk, "encoding": "base64"})
        data = base64.b64decode(reply["base64"])
        output += data
        offset += len(data)
        if reply.get("truncated") is False or not data:
            break
    return bytes(output)


def transfer(base: str, token: str, source: str, dest: str, size: int,
             workdir: str) -> dict:
    source_path = workdir + "/relay-bench-src.bin"
    dest_path = workdir + "/relay-bench-dst.bin"
    payload = bytes((index * 31) & 0xFF for index in range(size))
    transfer_id = hashlib.sha256(f"{time.time()}-{size}".encode()).hexdigest()[:16]
    try:
        offset = 0
        while offset < size:
            chunk = payload[offset:offset + 1024 * 1024]
            final = offset + len(chunk) >= size
            reply = fs(base, token, source, "write_chunk", {
                "path": source_path, "transfer_id": transfer_id, "offset": offset,
                "total": size, "base64": base64.b64encode(chunk).decode(),
                "final": final, "overwrite": True, "resume": offset > 0})
            offset = int(reply["offset"])
        started = time.perf_counter()
        dest_offsets = []
        offset = 0
        while offset < size:
            reply = fs(base, token, source, "read",
                       {"path": source_path, "offset": offset, "limit": 1024 * 1024,
                        "encoding": "base64"})
            chunk = base64.b64decode(reply["base64"])
            final = offset + len(chunk) >= size
            written = fs(base, token, dest, "write_chunk", {
                "path": dest_path, "transfer_id": transfer_id[::-1], "offset": offset,
                "total": size, "base64": reply["base64"], "final": final,
                "overwrite": True, "resume": offset > 0})
            offset = int(written["offset"])
            dest_offsets.append(offset)
        seconds = time.perf_counter() - started
        back = read_all(base, token, dest, dest_path)
        return {
            "source": source, "dest": dest, "bytes": size,
            "seconds": round(seconds, 2),
            "mb_per_s": round(size / seconds / 1e6, 2) if seconds else None,
            "sha256_match": hashlib.sha256(back).hexdigest() == hashlib.sha256(payload).hexdigest(),
            "chunks": len(dest_offsets),
        }
    finally:
        for device, path in ((source, source_path), (dest, dest_path)):
            try:
                fs(base, token, device, "delete", {"path": path})
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size-mb", type=float, default=2.0)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--source", default="DESKTOP-LOCAL")
    parser.add_argument("--dest", default="LAPTOP-01")
    parser.add_argument("--workdir", default="D:/TetherWorkspaces")
    args = parser.parse_args()
    base, token = credentials()
    result = {
        "control": control_latency(base, token, args.samples),
        "surface_first_page_ms": (surface_latency(base, token, args.source)
                                  or surface_latency(base, token, args.dest)),
        "transfer": transfer(base, token, args.source, args.dest,
                             max(1, int(args.size_mb * 1024 * 1024)), args.workdir),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
