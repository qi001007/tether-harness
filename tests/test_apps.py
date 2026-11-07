import json
import socket
import threading
import urllib.request
import pytest

import http.server
import socketserver

from tether.node import apps as apps_module
from tether.node.app_gateway import AppRoute, Gateway
from tether.node.apps import AppCatalog


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_entries_include_only_valid_configured_apps(tmp_path):
    _write(tmp_path / "apps.json", {"apps": [
        {"name": "Local Docs", "port": 19001},
        {"name": "bad", "port": 0},
        {"name": "bad path", "port": 80, "path": "nope"},
    ]})
    catalog = AppCatalog(tmp_path)
    entries = catalog.entries()
    assert [entry["id"] for entry in entries] == ["app-0"]
    assert entries[0]["name"] == "Local Docs"
    assert entries[0]["path"] == "/"


def test_entries_ignore_broken_file(tmp_path):
    (tmp_path / "apps.json").write_text("{not json", encoding="utf-8")
    catalog = AppCatalog(tmp_path)
    assert catalog.entries() == []


def test_list_without_mesh_returns_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(apps_module, "easy_tier_address", lambda: "")
    catalog = AppCatalog(tmp_path)
    result = catalog.list()
    assert result == {"ok": True, "mesh": "", "apps": [], "reason": "mesh_unavailable"}


def test_list_binds_loopback_route_and_proxies(tmp_path, monkeypatch):
    monkeypatch.setattr(apps_module, "easy_tier_address", lambda: "127.0.0.1")
    monkeypatch.setattr(apps_module, "MESH", ("10.144.0.0/24", "127.0.0.0/8"))
    upstream = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    received = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            received.append(self.path)
            body = b"tether-app-ok"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        _write(tmp_path / "apps.json", {"apps": [{"name": "Docs", "port": server.server_address[1]}]})
        catalog = AppCatalog(tmp_path)
        result = catalog.list()
        assert result["ok"] is True
        assert result["mesh"] == "127.0.0.1"
        assert [app["name"] for app in result["apps"]] == ["Docs"]
        app = result["apps"][0]
        assert app["url"].startswith("http://127.0.0.1:")
        with upstream.open(app["url"] + "/", timeout=5) as response:
            assert response.read() == b"tether-app-ok"
        assert received == ["/"]
    finally:
        catalog.stop()
        server.shutdown()
        server.server_close()


def test_catalog_reloads_when_apps_file_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(apps_module, "easy_tier_address", lambda: "127.0.0.1")
    _write(tmp_path / "apps.json", {"apps": [{"name": "First", "port": 19001}]})
    catalog = AppCatalog(tmp_path)
    try:
        assert [app["name"] for app in catalog.list()["apps"]] == ["First"]
        _write(tmp_path / "apps.json", {"apps": [{"name": "Second", "port": 19002}]})
        assert [app["name"] for app in catalog.list()["apps"]] == ["Second"]
    finally:
        catalog.stop()


def test_catalog_reuses_exact_local_mesh_url_and_binds_new_apps(tmp_path, monkeypatch):
    monkeypatch.setattr(apps_module, "easy_tier_address", lambda: "127.0.0.1")
    monkeypatch.setattr(apps_module, "MESH", ("10.144.0.0/24", "127.0.0.0/8"))
    occupied = socketserver.TCPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)
    port = occupied.server_address[1]
    _write(tmp_path / "apps.json", {"apps": [
        {"name": "DSH Web", "port": 3080, "listen_port": port,
         "url": "http://127.0.0.1:%d" % port, "path": "/?token=kept"},
        {"name": "Agents", "port": 4200, "listen_port": 0, "path": "/"},
    ]})
    catalog = AppCatalog(tmp_path)
    try:
        result = catalog.list()
        assert [(app["name"], app["url"], app["path"]) for app in result["apps"]] == [
            ("DSH Web", "http://127.0.0.1:%d" % port, "/?token=kept"),
            ("Agents", catalog.gateway.routes[0]["listen"].replace("127.0.0.1:", "http://127.0.0.1:"), "/"),
        ]
        assert result["reason"] == ""
    finally:
        catalog.stop()
        occupied.server_close()


def test_gateway_closes_prior_sockets_if_a_later_route_bind_fails():
    first_probe = socket.socket()
    first_probe.bind(("127.0.0.1", 0))
    first_port = first_probe.getsockname()[1]
    first_probe.close()
    occupied = socketserver.TCPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)
    try:
        with pytest.raises(OSError):
            Gateway([
                AppRoute("first", "127.0.0.1", first_port, "127.0.0.1", 1),
                AppRoute("occupied", "127.0.0.1", occupied.server_address[1], "127.0.0.1", 1),
            ], ("127.0.0.0/8",))
        reclaimed = socket.socket()
        try:
            reclaimed.bind(("127.0.0.1", first_port))
        finally:
            reclaimed.close()
    finally:
        occupied.server_close()
