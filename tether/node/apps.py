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
from urllib.parse import urlsplit

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
            try:
                listen_port = int(item.get("listen_port") or 0)
            except (TypeError, ValueError):
                listen_port = 0
            if not 0 <= listen_port <= 65535:
                listen_port = 0
            apps.append({"id": "app-%d" % len(apps), "name": name[:80], "kind": "web",
                         "listen_port": listen_port, "target_port": port, "path": path,
                         "explicit_url": str(item.get("url") or "")})
        return apps

    def entries(self) -> list[dict[str, Any]]:
        return self._configured()

    def ensure(self) -> dict[str, Any]:
        host = easy_tier_address()
        if not host:
            self.stop()
            return {"ok": True, "mesh": "", "apps": [], "reason": "mesh_unavailable"}
        if self.host == host and self._fingerprint == self._current_fingerprint():
            return self._result()
        self.stop()
        entries = self.entries()
        if not entries:
            self._fingerprint = self._current_fingerprint()
            return {"ok": True, "mesh": host, "apps": [], "reason": "no_apps"}
        reused = {app["id"]: self._trusted_explicit_url(app, host) for app in entries}
        managed = [app for app in entries if not reused[app["id"]]]
        gateway = None
        if managed:
            try:
                gateway = Gateway(
                    [AppRoute(app["name"], host, app.get("listen_port", 0),
                              "127.0.0.1", app["target_port"])
                     for app in managed],
                    MESH,
                )
            except OSError:
                self._apps = [{"id": app["id"], "name": app["name"], "kind": app["kind"],
                               "url": reused[app["id"]], "path": app["path"]}
                              for app in entries if reused[app["id"]]]
                return {"ok": True, "mesh": host, "apps": list(self._apps), "reason": "bind_failed"}
        routes = {app["id"]: route for app, route in zip(managed, gateway.routes if gateway else [])}
        self.gateway = gateway
        self.host = host
        self._fingerprint = self._current_fingerprint()
        self._apps = []
        for app in entries:
            url = reused[app["id"]]
            if not url:
                listen = str(routes[app["id"]].get("listen") or "")
                port = listen.rsplit(":", 1)[-1] if ":" in listen else ""
                url = "http://%s:%s" % (host, port) if port else ""
            if url:
                self._apps.append({"id": app["id"], "name": app["name"], "kind": app["kind"],
                                   "url": url, "path": app["path"]})
        return self._result()

    @staticmethod
    def _trusted_explicit_url(app: dict[str, Any], host: str) -> str:
        value = app.get("explicit_url")
        if not value or not app.get("listen_port"):
            return ""
        try:
            parsed = urlsplit(value)
            if (parsed.scheme != "http" or parsed.hostname != host or
                    parsed.port != app["listen_port"] or parsed.username or parsed.password or
                    parsed.query or parsed.fragment or parsed.path not in ("", "/")):
                return ""
        except ValueError:
            return ""
        return "http://%s:%d" % (host, app["listen_port"])

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
