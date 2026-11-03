#!/usr/bin/env python3
"""Audit published release archives without installing them.

Downloads the current Hub manifest, verifies its signature and every archive
hash, extracts the three archives to a temporary directory, and checks that
the files a clean install needs are present while secrets/build junk are not.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tether.release import verify_signature  # noqa: E402

HUB_FILE = ROOT / "apps" / "tether-app" / "data" / "hub.json"
REQUIRED = {
    "app": {
        "version.json",
        "apps/tether-app/main.js",
        "packages/tether-ui/web/index.html",
        "tether/node/dsh_plugin.py",
        "desktop/install-app.ps1",
    },
    "node": {
        "version.json",
        "tether/node/agent.py",
        "tether/node/dsh_plugin.py",
        "laptop/tether-node.ps1",
    },
    "plugin": {
        "version.json",
        "packages/dsh-plugin-tether/package.json",
        "packages/dsh-plugin-tether-client/lib/client.js",
        "packages/tether-dsh-surface/lib/index.js",
        "packages/tether-dsh-native-ui/lib/client.js",
        "desktop/install-plugin.ps1",
    },
}
FORBIDDEN_PARTS = {"node_modules", "data", "__pycache__", ".git", "work-local", ".venv"}
FORBIDDEN_NAMES = {"hub.json", ".credentials.yaml"}
ALLOWED_ENV = {".env.example"}


def fetch(url: str, limit: int = 512 * 1024 * 1024, headers: dict[str, str] | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Tether-Release-Audit/1", **(headers or {})})
    with urllib.request.urlopen(request, timeout=120) as response:
        chunks, total = [], 0
        while True:
            chunk = response.read(min(256 * 1024, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise RuntimeError("asset too large")
            chunks.append(chunk)
        return b"".join(chunks)


def audit(component: str, payload: bytes, version: str, folder: Path) -> list[str]:
    archive = folder / f"{component}.zip"
    archive.write_bytes(payload)
    errors: list[str] = []
    with zipfile.ZipFile(archive) as bundle:
        names = [name.replace("\\", "/") for name in bundle.namelist() if not name.endswith("/")]
        prefix = next((name.rsplit("/", 1)[0] for name in names
                       if name.endswith("/version.json") and name.count("/") == 1), "")
        relative = {name[len(prefix) + 1:] for name in names if prefix and name.startswith(prefix + "/")}
        for required in sorted(REQUIRED[component]):
            if required not in relative:
                errors.append(f"{component}: missing {required}")
        data = json.loads(bundle.read(f"{prefix}/version.json")) if f"{prefix}/version.json" in names else {}
        if str((data.get("components") or {}).get(component) or "") != version:
            errors.append(f"{component}: version.json does not match {version}")
        for name in names:
            parts = set(Path(name).parts)
            if parts & FORBIDDEN_PARTS:
                errors.append(f"{component}: forbidden path {name}")
            if Path(name).name in FORBIDDEN_NAMES:
                errors.append(f"{component}: forbidden file {name}")
            if Path(name).name.startswith(".env") and Path(name).name not in ALLOWED_ENV:
                errors.append(f"{component}: forbidden env file {name}")
    return errors


def main() -> int:
    hub = json.loads(HUB_FILE.read_text(encoding="utf-8"))
    base = str(hub["url"]).rstrip("/")
    token = str(hub.get("accessToken") or "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    manifest = json.loads(fetch(base + "/releases/manifest", headers=headers))
    verify_signature(manifest)
    version = str((manifest.get("components") or {}).get("app", {}).get("version") or "")
    if not version:
        raise RuntimeError("manifest has no app version")
    errors: list[str] = []
    with tempfile.TemporaryDirectory(prefix="tether-release-audit-") as folder_name:
        folder = Path(folder_name)
        for component in ("app", "node", "plugin"):
            item = (manifest.get("components") or {}).get(component) or {}
            if str(item.get("version") or "") != version:
                errors.append(f"{component}: manifest version differs from {version}")
            payload = fetch(str(item.get("url") or ""))
            if len(payload) != int(item.get("size") or 0):
                errors.append(f"{component}: size {len(payload)} != {item.get('size')}")
            if hashlib.sha256(payload).hexdigest() != item.get("sha256"):
                errors.append(f"{component}: sha256 mismatch")
            errors.extend(audit(component, payload, version, folder))
            print(f"checked {component} {len(payload)} bytes")
    if errors:
        print("FAIL")
        for error in errors:
            print(" -", error)
        return 1
    print(f"PASS release {version}: signature, hashes, required files, and secret checks")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 - a failed gate must be visibly red
        print("FAIL", exc)
        raise SystemExit(1)
