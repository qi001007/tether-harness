import json
import threading
import urllib.request

import http.server
import socketserver

from tether.node import apps as apps_module
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