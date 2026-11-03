"""Loopback application catalog exposed through the EasyTier mesh.

Only explicitly listed loopback HTTP services are forwarded.  Entries live in
``data_dir/apps.json`` as ``{"apps": [{"name": "...", "port": 3000, "path": "/"}]}``.
DSH itself is not listed here; it keeps using the authenticated native surface.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .app_gateway import AppRoute, Gateway
from .direct_api import easy_tier_address

MESH = ("10.144.0.0/24",)


class AppCatalog:
    def __init__(self, data_dir: Path | str) -> None:
        self.data_dir = Path(data_dir)
        self.gateway: Gateway | None = None
        self.host = ""
        self._apps: list[dict[str, Any]] = []
        self._fingerprint = ""

    def _current_fingerprint(self) -> str:
        try:
            return hashlib.sha1((self.data_dir / "apps.json").read_bytes()).hexdigest()
        except OSError:
            return ""

    def _configured(self) -> list[dict[str, Any]]:
        try:
            data = json.loads((self.data_dir / "apps.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        items = data.get("apps") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return []
        apps: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            try:
                port = int(item.get("port"))
            except (TypeError, ValueError):
                continue
            path = str(item.get("path") or "/")
            if not name or not 1 <= port <= 65535 or not path.startswith("/"):
                continue
            apps.append({"id": "app-%d" % len(apps), "name": name[:80], "kind": "web",
                         "target_port": port, "path": path})
        return apps

    def entries(self) -> list[dict[str, Any]]:
        return self._configured()

    def ensure(self) -> dict[str, Any]:
        host = easy_tier_address()
        if not host:
            self.stop()
            return {"ok": True, "mesh": "", "apps": [], "reason": "mesh_unavailable"}
        if self.gateway is not None and self.host == host and self._fingerprint == self._current_fingerprint():
            return self._result()
        self.stop()
        entries = self.entries()
        if not entries:
            self._fingerprint = self._current_fingerprint()
            return {"ok": True, "mesh": host, "apps": [], "reason": "no_apps"}
        try:
            gateway = Gateway(
                [AppRoute(app["name"], host, 0, "127.0.0.1", app["target_port"])
                 for app in entries],
                MESH,
            )
        except OSError:
            return {"ok": True, "mesh": host, "apps": [], "reason": "bind_failed"}
        self.gateway = gateway
        self.host = host
        self._fingerprint = self._current_fingerprint()
        self._apps = []
        for app, route in zip(entries, gateway.routes):
            listen = str(route.get("listen") or "")
            port = listen.rsplit(":", 1)[-1] if ":" in listen else ""
            if not port:
                continue
            self._apps.append({
                "id": app["id"], "name": app["name"], "kind": app["kind"],
                "url": "http://%s:%s" % (host, port), "path": app["path"],
            })
        return self._result()

    def _result(self) -> dict[str, Any]:
        return {"ok": True, "mesh": self.host, "apps": list(self._apps), "reason": ""}

    def list(self, _args: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.ensure()

    def stop(self) -> None:
        gateway, self.gateway = self.gateway, None
        self.host = ""
        self._apps = []
        if gateway is not None:
            gateway.stop()

    def dispatch(self, action: str, args: dict[str, Any]) -> Any:
        if action != "list":
            raise ValueError("unsupported apps action")
        return self.list(args)