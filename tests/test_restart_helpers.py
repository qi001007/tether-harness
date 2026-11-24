from __future__ import annotations

import sys
from pathlib import Path

import pytest

from tether.node import agent
from tether.updates import UpdateManager


@pytest.mark.skipif(sys.platform != "win32", reason="Windows detached process flags")
def test_app_restart_helper_uses_supported_popen_kwargs(tmp_path: Path, monkeypatch) -> None:
    executable = tmp_path / "apps/tether-app/node_modules/electron/dist/electron.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")
    captured: dict[str, object] = {}

    class FakePopen:
        def __init__(self, *args, **kwargs) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(agent.subprocess, "Popen", FakePopen)
    assert agent.schedule_app_restart(tmp_path) is True
    assert "windowsHide" not in captured
    assert "creationflags" in captured


def test_app_restart_helper_reports_unsupported_popen_kwargs(tmp_path: Path, monkeypatch) -> None:
    executable = tmp_path / "apps/tether-app/node_modules/electron/dist/electron.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")

    def fail(*args, **kwargs):
        raise TypeError("unsupported keyword")

    monkeypatch.setattr(agent.subprocess, "Popen", fail)
    assert agent.schedule_app_restart(tmp_path) is False


def test_dsh_restart_helper_never_passes_windows_hide(tmp_path: Path, monkeypatch) -> None:
    manager = UpdateManager(tmp_path, "node", state_dir=tmp_path / "state")
    captured: dict[str, object] = {}

    class FakePopen:
        def __init__(self, *args, **kwargs) -> None:
            captured.update(kwargs)

    monkeypatch.setattr("tether.updates.subprocess.Popen", FakePopen)
    assert manager._spawn_dsh_restart() is True
    assert "windowsHide" not in captured
