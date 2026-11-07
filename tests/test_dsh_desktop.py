from __future__ import annotations

from pathlib import Path

import pytest

from tether.node import dsh_desktop
from tether.node.dsh_desktop import DshDesktop, DshError, _parse_feed
from tether.node.fs_service import FsService


FEED = """version: 0.2.1-rc.5
files:
  - url: >-
      https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.5-win-x64.exe
    sha512: >-
      gu2dH+aTr678c0P8DGAH/h4B1GaWfQIjpsPrLjl/ukLrQIh6DLVq/MhX4FZvJ8o1GCMocOhix6XbLa6KmtjXXg==
    size: 289408544
path: >-
  https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.5-win-x64.exe
sha512: >-
  gu2dH+aTr678c0P8DGAH/h4B1GaWfQIjpsPrLjl/ukLrQIh6DLVq/MhX4FZvJ8o1GCMocOhix6XbLa6KmtjXXg==
"""


def test_electron_nightly_feed_is_parsed():
    feed = _parse_feed(FEED)
    assert feed["version"] == "0.2.1-rc.5"
    assert feed["url"].endswith("deepseek-harness-0.2.1-rc.5-win-x64.exe")
    assert feed["size"] == 289408544


def test_status_reports_an_installed_app_from_the_env_override(tmp_path, monkeypatch):
    exe = tmp_path / "DeepSeek Harness.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setenv("TETHER_DSH_EXE", str(exe))
    monkeypatch.setattr(dsh_desktop, "_registry_info", lambda: {})
    monkeypatch.setattr(DshDesktop, "_running", lambda self, path: (False, 0))
    desktop = DshDesktop(tmp_path / "data", dsh_home=tmp_path / "home")
    status = desktop.status()
    assert status["installed"] is True
    assert status["running"] is False
    assert status["exe"] == str(exe)


def test_start_uses_a_windowless_detached_process(tmp_path, monkeypatch):
    exe = tmp_path / "DeepSeek Harness.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setenv("TETHER_DSH_EXE", str(exe))
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "test-home"))
    monkeypatch.setenv("TETHER_NATIVE_DSH_HOME", str(tmp_path / "test-home"))
    monkeypatch.setenv("ELECTRON_RUN_AS_NODE", "1")
    monkeypatch.setattr(dsh_desktop, "_registry_info", lambda: {})
    monkeypatch.setattr(DshDesktop, "_running", lambda self, path: (False, 0))
    captured = []

    class FakeProcess:
        pass

    def popen(args, **kwargs):
        captured.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr(dsh_desktop.subprocess, "Popen", popen)
    desktop = DshDesktop(tmp_path / "data", dsh_home=tmp_path / "home")
    result = desktop.start()
    assert captured and captured[0][0] == [str(exe)]
    flags = captured[0][1]["creationflags"]
    assert flags & dsh_desktop.DETACHED_PROCESS
    assert flags & dsh_desktop.CREATE_NEW_PROCESS_GROUP
    assert flags & dsh_desktop.CREATE_NO_WINDOW
    assert captured[0][1]["env"]["DSH_HOME"] == str(tmp_path / "home")
    assert "TETHER_NATIVE_DSH_HOME" not in captured[0][1]["env"]
    assert "ELECTRON_RUN_AS_NODE" not in captured[0][1]["env"]
    assert result["started"] is True


def test_status_observes_surface_after_the_start_snapshot_cache_expires(tmp_path, monkeypatch):
    exe = tmp_path / "DeepSeek Harness.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setenv("TETHER_DSH_EXE", str(exe))
    monkeypatch.setattr(dsh_desktop, "_registry_info", lambda: {})
    monkeypatch.setattr(dsh_desktop.psutil, "process_iter", lambda *_: [])
    monkeypatch.setattr(dsh_desktop.psutil, "pid_exists", lambda pid: pid == 4242)
    clock = [10.0]
    monkeypatch.setattr(dsh_desktop.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(dsh_desktop.subprocess, "Popen", lambda *_args, **_kwargs: object())
    desktop = DshDesktop(tmp_path / "data", dsh_home=tmp_path / "home")

    started = desktop.start()
    assert started["running"] is True
    assert started["surface"] is False

    desktop.descriptor.parent.mkdir(parents=True)
    desktop.descriptor.write_text('{"pid": 4242}', encoding="utf-8")
    clock[0] += 3.9
    assert desktop.status()["surface"] is False, "the short post-spawn snapshot avoids duplicate process scans"
    clock[0] += 0.2
    status = desktop.status()
    assert status["surface"] is True
    assert status["pid"] == 4242


def test_feed_rejects_a_non_https_override(tmp_path, monkeypatch):
    monkeypatch.setenv("TETHER_DSH_FEED_URL", "http://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml")
    desktop = DshDesktop(tmp_path / "data", dsh_home=tmp_path / "home")
    with pytest.raises(DshError) as error:
        desktop._feed()
    assert error.value.code == "dsh_feed_invalid"


def test_fs_service_exposes_dsh_status(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    service = FsService(device="UNIT", workspace=workspace, data_dir=tmp_path / "data",
                        workspaces_root=tmp_path / "workspaces", dsh_home=tmp_path / "home")
    monkeypatch.setattr(service.dsh_desktop, "status",
                        lambda: {"installed": True, "running": False, "version": "0.2.1-rc.3"})
    result = service.dispatch("dsh_status", {})
    assert result["device_id"] == "UNIT"
    assert result["installed"] is True
    assert result["version"] == "0.2.1-rc.3"

def test_restart_schedules_a_windowless_dsh_restart_helper(tmp_path, monkeypatch):
    exe = tmp_path / "DeepSeek Harness.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setenv("TETHER_DSH_EXE", str(exe))
    monkeypatch.setattr(dsh_desktop, "_registry_info", lambda: {})
    monkeypatch.setattr(DshDesktop, "_running", lambda self, path: (True, 4242))
    captured = []

    class FakeProcess:
        pass

    def popen(args, **kwargs):
        captured.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr(dsh_desktop.subprocess, "Popen", popen)
    desktop = DshDesktop(tmp_path / "data", dsh_home=tmp_path / "home")
    result = desktop.restart()
    assert result["restarting"] is True
    assert captured
    args, kwargs = captured[0]
    assert "tether.node.dsh_restart" in args
    assert str(desktop.descriptor) in args
    assert "--host-pid" in args
    assert "--dsh-home" in args
    assert kwargs["creationflags"] & dsh_desktop.CREATE_NO_WINDOW
