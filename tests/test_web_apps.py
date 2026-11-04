from __future__ import annotations

import json
import sys

from tether.node.fs_service import FsService
from tether.node.web_apps import OpenCodeWeb


def _fake_server(monkeypatch, engine: OpenCodeWeb) -> None:
    monkeypatch.setattr(engine, "_binary", lambda: sys.executable)
    monkeypatch.setattr(engine, "_argv", lambda binary, port: [
        binary, "-m", "http.server", str(port), "--bind", "127.0.0.1"])


def test_start_registers_and_stop_unregisters(tmp_path, monkeypatch) -> None:
    engine = OpenCodeWeb(tmp_path, tmp_path)
    _fake_server(monkeypatch, engine)
    try:
        started = engine.start()
        assert started["running"] is True
        assert started["port"] >= 4096
        saved = json.loads((tmp_path / "apps.json").read_text(encoding="utf-8"))
        assert saved["apps"] == [{
            "name": "OpenCode", "port": started["port"], "path": "/"}]
        assert engine.status()["running"] is True
    finally:
        stopped = engine.stop()
    assert stopped["running"] is False
    assert json.loads((tmp_path / "apps.json").read_text(encoding="utf-8"))["apps"] == []


def test_start_failure_leaves_no_entry(tmp_path, monkeypatch) -> None:
    engine = OpenCodeWeb(tmp_path, tmp_path)
    monkeypatch.setattr(engine, "_binary", lambda: sys.executable)
    monkeypatch.setattr(engine, "_argv", lambda binary, port: [binary, "-c", "raise SystemExit(2)"])
    try:
        engine.start()
    except ValueError as exc:
        assert "did not start" in str(exc)
    else:
        raise AssertionError("start should fail")
    assert not (tmp_path / "apps.json").exists()


def test_start_reports_the_gateway_url(tmp_path, monkeypatch) -> None:
    engine = OpenCodeWeb(tmp_path, tmp_path)
    _fake_server(monkeypatch, engine)
    service = FsService(device="TEST", workspace=tmp_path, data_dir=tmp_path,
                        workspaces_root=tmp_path / "workspaces")
    service.opencode = engine

    class Apps:
        def list(self, _args):
            return {"apps": [{"name": "OpenCode", "url": "http://10.144.0.2:32115", "path": "/"}]}

    service.apps = Apps()
    try:
        started = service._op_opencode_start({})
        assert started["url"] == "http://10.144.0.2:32115/"
        status = service._op_opencode_status({})
        assert status["url"] == "http://10.144.0.2:32115/"
    finally:
        engine.stop()


def test_status_adopts_a_server_that_outlived_the_node(tmp_path, monkeypatch) -> None:
    first = OpenCodeWeb(tmp_path, tmp_path)
    _fake_server(monkeypatch, first)
    started = first.start()
    second = OpenCodeWeb(tmp_path, tmp_path)
    monkeypatch.setattr(second, "_pid_matches", lambda pid: True)
    adopted = second.status()
    assert adopted["running"] is True
    assert adopted["port"] == started["port"]
    assert second.stop()["running"] is False
    assert not (tmp_path / "opencode.json").exists()


def test_status_scrubs_a_stale_entry(tmp_path, monkeypatch) -> None:
    (tmp_path / "apps.json").write_text(
        json.dumps({"apps": [{"name": "OpenCode", "port": 4999, "path": "/"}]}),
        encoding="utf-8")
    engine = OpenCodeWeb(tmp_path, tmp_path)
    monkeypatch.setattr(engine, "_binary", lambda: sys.executable)
    assert engine.status()["running"] is False
    assert json.loads((tmp_path / "apps.json").read_text(encoding="utf-8"))["apps"] == []