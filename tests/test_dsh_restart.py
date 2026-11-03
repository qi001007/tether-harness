import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tether.node import dsh_restart


def test_wait_for_loaded_plugin_requires_the_running_host_version(tmp_path):
    descriptor = tmp_path / "native-surface.json"
    descriptor.write_text(json.dumps({
        "version": 1, "pid": os.getpid(), "plugin_version": "0.2.91"
    }), encoding="utf-8")
    assert dsh_restart._wait_for_loaded_plugin(descriptor, "0.2.91", 1.0) is True
    assert dsh_restart._wait_for_loaded_plugin(descriptor, "0.2.90", 0.3) is False


def test_restart_skips_the_app_when_the_hot_reload_handshake_landed(tmp_path, monkeypatch):
    descriptor = tmp_path / "native-surface.json"
    descriptor.write_text(json.dumps({
        "version": 1, "pid": os.getpid(), "plugin_version": "0.2.91"
    }), encoding="utf-8")

    def fail(*_args, **_kwargs):
        raise AssertionError("restart helper must not touch the app")

    monkeypatch.setattr(dsh_restart, "_stop_tree", fail)
    monkeypatch.setattr(dsh_restart, "_launch", fail)
    assert dsh_restart.restart(descriptor, None, delay=0.5,
                               expect_plugin_version="0.2.91") == 0


def test_launch_strips_the_electron_node_selector(monkeypatch):
    captured = {}

    class Proc:
        pass

    def fake_popen(args, **kwargs):
        captured["args"] = args
        captured["env"] = kwargs.get("env")
        return Proc()

    monkeypatch.setattr(dsh_restart.subprocess, "Popen", fake_popen)
    monkeypatch.setenv("ELECTRON_RUN_AS_NODE", "1")
    monkeypatch.setenv("DSH_HOME", "E:/tether/.runtime/dsh-home")
    monkeypatch.setenv("TETHER_NATIVE_DSH_HOME", "E:/tether/.runtime/dsh-home")
    monkeypatch.setenv("TETHER_TEST_MARKER", "kept")
    dsh_restart._launch("C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe")
    assert captured["args"] == ["C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe"]
    assert "ELECTRON_RUN_AS_NODE" not in captured["env"]
    assert "DSH_HOME" not in captured["env"]
    assert "TETHER_NATIVE_DSH_HOME" not in captured["env"]
    assert captured["env"]["TETHER_TEST_MARKER"] == "kept"


def test_launch_uses_the_detected_dsh_home(monkeypatch):
    captured = {}

    class Proc:
        pass

    def fake_popen(args, **kwargs):
        captured["env"] = kwargs.get("env")
        return Proc()

    monkeypatch.setattr(dsh_restart.subprocess, "Popen", fake_popen)
    monkeypatch.setenv("DSH_HOME", "C:/Users/test/.dsh")
    dsh_restart._launch("C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe", Path("D:/DeepSeek Harness/.dsh"))
    assert captured["env"]["DSH_HOME"] == str(Path("D:/DeepSeek Harness/.dsh"))


def test_restart_relaunches_when_the_first_attempt_never_publishes(monkeypatch, tmp_path):
    launches = []
    current = {"pid": None}

    class FakeTime:
        def __init__(self):
            self.now = 0.0

        def time(self):
            return self.now

        def sleep(self, seconds):
            self.now += seconds

    class Host:
        pid = 10

        def exe(self):
            return "C:/DSH/DeepSeek Harness.exe"

    monkeypatch.setattr(dsh_restart, "time", FakeTime())
    monkeypatch.setattr(dsh_restart, "_host_pid", lambda _path: current["pid"])
    monkeypatch.setattr(dsh_restart, "_find_host", lambda: Host())
    monkeypatch.setattr(dsh_restart, "_root_of", lambda process: process)
    monkeypatch.setattr(dsh_restart, "_stop_tree", lambda _root: None)

    def fake_launch(exe, dsh_home=None):
        launches.append(exe)
        if len(launches) == 2:
            current["pid"] = 99

    monkeypatch.setattr(dsh_restart, "_launch", fake_launch)
    assert dsh_restart.restart(tmp_path / "native-surface.json", None, delay=0, wait=60) == 0
    assert launches == ["C:/DSH/DeepSeek Harness.exe", "C:/DSH/DeepSeek Harness.exe"]


def test_restart_refuses_a_process_that_is_not_the_dsh_desktop_app(monkeypatch, tmp_path):
    current = {"pid": None}
    launches = []

    class Host:
        pid = 10

        def exe(self):
            return "C:/Windows/explorer.exe"

    monkeypatch.setattr(dsh_restart, "_host_pid", lambda _path: current["pid"])
    monkeypatch.setattr(dsh_restart, "_find_host", lambda: Host())
    monkeypatch.setattr(dsh_restart, "_root_of", lambda process: process)
    monkeypatch.setattr(dsh_restart, "_stop_tree", lambda _root: launches.append("stopped"))
    monkeypatch.setattr(dsh_restart, "_launch", lambda exe, dsh_home=None: launches.append(exe))
    assert dsh_restart.restart(tmp_path / "native-surface.json", None, delay=0, wait=5) == 1
    assert launches == []
