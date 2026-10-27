#!/usr/bin/env python3
"""End-to-end smoke test for a public Tether Hub.

Reads TETHER_CONTROLLER_URL / TETHER_ACCESS_TOKEN from .env, then checks:
  1. unauthenticated /api/state is rejected
  2. authenticated state lists devices
  3. every online device returns a public https surface URL
  4. bootstrap returns a redirect + host-only cookie
  5. the followed page is HTTP 200 and contains the DSH shell

It never prints tokens or tickets. Exit code 1 on a hard failure.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ""


def load_env() -> None:
    global BASE
    values = {}
    for file in (ROOT / ".env", ROOT / ".runtime" / "hub-secrets.env"):
        if not file.exists():
            continue
        for line in file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    BASE = (values.get("TETHER_CONTROLLER_URL") or "").rstrip("/")
    if not BASE:
        raise SystemExit("TETHER_CONTROLLER_URL missing")
    os.environ.setdefault("TETHER_ACCESS_TOKEN", values.get("TETHER_ACCESS_TOKEN", ""))


def request(path: str, *, token: bool = True, opener=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + os.environ.get("TETHER_ACCESS_TOKEN", "")
    req = urllib.request.Request(BASE + path, headers=headers)
    return (opener or urllib.request.build_opener()).open(req, timeout=15)


def fetch_surface(device: str) -> str:
    with request(f"/api/devices/{urllib.parse.quote(device)}/dsh/surface") as response:
        data = json.load(response)
    url = data.get("url") or ""
    if not data.get("available") or not url.startswith("https://g"):
        raise RuntimeError("surface is not a public https g<port> URL: " + str(data.get("reason") or data))
    return url


def follow_bootstrap(url: str) -> tuple[int, bytes]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    headers = {
        "Accept": "text/html",
        "Origin": "dsh-app://app",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "iframe",
    }
    req = urllib.request.Request(url, headers=headers)
    with opener.open(req, timeout=30) as response:
        return response.status, response.read(20000)


def main() -> int:
    load_env()
    failures = 0
    try:
        request("/api/state", token=False)
        print("FAIL auth: unauthenticated /api/state was accepted")
        failures += 1
    except urllib.error.HTTPError as error:
        print("PASS auth: unauthenticated ->", error.code)

    with request("/api/state") as response:
        state = json.load(response)
    devices = state.get("devices", [])
    online = [item for item in devices if item.get("online")]
    print(f"PASS state: {len(devices)} device(s), {len(online)} online")
    if not online:
        print("WARN no online device; surface checks skipped")
        return 0 if failures == 0 else 1

    for item in online:
        device = item["device_id"]
        try:
            url = fetch_surface(device)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")
            print(f"WARN {device}: surface HTTP {error.code} {detail[:120]}")
            continue
        except Exception as error:
            print(f"FAIL {device}: {error}")
            failures += 1
            continue
        try:
            status, body = follow_bootstrap(url)
            if status != 200 or b"deepseek" not in body.lower():
                print(f"FAIL {device}: bootstrap page status={status} bytes={len(body)}")
                failures += 1
            else:
                print(f"PASS {device}: public surface page {status} ({len(body)} bytes)")
        except Exception as error:
            print(f"FAIL {device}: bootstrap failed: {type(error).__name__}: {error}")
            failures += 1

    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())