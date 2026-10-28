from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from pathlib import Path

from tether.node import agent
from tether.node.agent import Node, NodeStore, restart_node_process


class FakeUpdateManager:
    def __init__(self) -> None:
        self.apply_calls = 0
        self.prepare_started = threading.Event()
        self.prepare_release = threading.Event()

    def check(self) -> dict:
        return {"ok": True, "component": "node", "current_version": "0.2.1",
                "latest_version": "0.2.2", "update_available": True}

    def status(self) -> dict:
        return {"ok": True, "component": "node", "current_version": "0.2.1", "prepared": []}

    def prepare(self) -> dict:
        self.prepare_started.set()
        self.prepare_release.wait(3)
        return {"ok": True, "component": "node", "prepared_id": "a" * 32}

    def apply(self, _prepared_id: str) -> dict:
        self.apply_calls += 1
        return {"ok": True, "component": "node", "version": "0.2.2",
                "restart_required": True}


def _node(tmp_path: Path, monkeypatch) -> Node:
    dsh_home = tmp_path / "dsh"
    dsh_home.mkdir()
    monkeypatch.setenv("TETHER_NATIVE_DSH_HOME", str(dsh_home))
    data_dir = tmp_path / "data"
    store = NodeStore(data_dir / "node.db")
    node = Node(url="ws://127.0.0.1:18890/ws/node", token="fake", device="test-node",
                workspace=tmp_path / "workspace", store=store, agent="fake", data_dir=data_dir)
    return node


def test_capabilities_advertise_update_protocol_and_cached_version(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    node.update_managers["node"] = FakeUpdateManager()
    node.node_version = "0.2.1"
    capabilities = node.capabilities()
    assert capabilities["node_version"] == "0.2.1"
    assert capabilities["update_protocol"] == 1
    assert capabilities["app_version"] == node._managed_app_version()
    assert "app" in node.update_managers
    node.store.db.close()


def test_remote_app_apply_returns_restart_required(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    manager = FakeUpdateManager()
    manager.apply = lambda _prepared_id: {"ok": True, "component": "app", "version": "0.2.2",
                                          "restart_required": True}
    node.update_managers["app"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "app-apply",
                                   "action": "apply", "component": "app",
                                   "prepared_id": "a" * 32}))

    assert sent[0]["ok"] is True
    assert sent[0]["component"] == "app"
    assert sent[0]["restart_required"] is True
    node.store.db.close()


def test_remote_app_restart_is_scheduled_only_after_result_send(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    manager.apply = lambda _prepared_id: {"ok": True, "component": "app", "version": "0.2.9",
                                          "restart_required": True}
    node.update_managers["app"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    order: list[str] = []

    async def send(_message: dict) -> None:
        order.append("response")

    def schedule(root: Path) -> bool:
        assert root == agent.ROOT
        order.append("restart")
        return True

    monkeypatch.setenv("TETHER_NODE_MANAGED", "1")
    monkeypatch.setattr(node, "_send", send)
    monkeypatch.setattr(agent, "schedule_app_restart", schedule)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "app-restart",
                                   "action": "apply", "component": "app",
                                   "prepared_id": "a" * 32}))

    assert order == ["response", "restart"]
    assert node.update_applying is True
    node.store.db.close()


def test_remote_app_restart_helper_failure_releases_update_gate(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    manager.apply = lambda _prepared_id: {"ok": True, "component": "app", "version": "0.2.9",
                                          "restart_required": True}
    node.update_managers["app"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    node.ws = object()
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setenv("TETHER_NODE_MANAGED", "1")
    monkeypatch.setattr(node, "_send", send)
    monkeypatch.setattr(agent, "schedule_app_restart", lambda _root: False)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "app-restart-fail",
                                   "action": "apply", "component": "app",
                                   "prepared_id": "a" * 32}))

    assert sent[0]["ok"] is True
    assert sent[-1]["type"] == "update_ready"
    assert node.update_applying is False
    node.store.db.close()


def test_windows_app_restart_helper_targets_only_install_electron_and_launcher(tmp_path, monkeypatch):
    app_root = tmp_path / "installed app"
    launcher = app_root / "apps" / "tether-app" / "Tether-App.cmd"
    launcher.parent.mkdir(parents=True)
    launcher.write_text("@echo off\n", encoding="utf-8")
    captured: list[tuple[list[str], dict]] = []

    def popen(args, **kwargs):
        captured.append((args, kwargs))
        wrapper = Path(args[1])
        config_path = Path(wrapper.with_name("restart.json"))
        config = json.loads(config_path.read_text(encoding="utf-8"))
        Path(config["ready_file"]).write_text("ready", encoding="ascii")
        return object()

    monkeypatch.setattr(agent.sys, "platform", "win32")
    monkeypatch.setattr(agent.subprocess, "Popen", popen)
    assert agent.schedule_app_restart(app_root) is True
    args, options = captured[0]
    assert args[0] == "explorer.exe"
    wrapper = Path(args[1])
    script = wrapper.with_name("worker.ps1")
    config_path = wrapper.with_name("restart.json")
    source = script.read_text(encoding="utf-8")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    wrapper_source = wrapper.read_text(encoding="utf-8")
    assert "Win32_Process" in source
    assert "Stop-Process" in source
    assert "Start-Sleep -Seconds 2" in source
    assert "explorer.exe" in source
    assert "WindowsPowerShell\\v1.0\\powershell.exe" in wrapper_source
    assert config["root"] == str(app_root.resolve())
    assert config["wrapper_file"] == str(wrapper)
    assert options["creationflags"] & getattr(agent.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
    agent.shutil.rmtree(wrapper.parent)


def test_app_restart_helper_fails_cleanly_when_launcher_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(agent.sys, "platform", "win32")
    assert agent.schedule_app_restart(tmp_path) is False


def test_update_prepare_does_not_block_message_receiver_or_cancel_heartbeat(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)

    async def scenario() -> None:
        await node._handle({"type": "update_call", "req_id": "prepare-1",
                            "action": "prepare", "component": "node"})
        assert await asyncio.to_thread(manager.prepare_started.wait, 2)
        await node._handle({"type": "heartbeat", "ts": 1.0})
        assert node.connected is False
        await node._handle({"type": "update_call", "req_id": "check-during-prepare",
                            "action": "check", "component": "node"})
        await node._handle({"type": "update_call", "req_id": "status-during-prepare",
                            "action": "status", "component": "node"})
        for _ in range(100):
            if {message.get("req_id") for message in sent} >= {
                    "check-during-prepare", "status-during-prepare"}:
                break
            await asyncio.sleep(0.01)
        assert {message.get("req_id") for message in sent} >= {
            "check-during-prepare", "status-during-prepare"}
        assert not any(message.get("req_id") == "prepare-1" for message in sent)
        manager.prepare_release.set()
        for _ in range(100):
            if any(message.get("req_id") == "prepare-1" for message in sent):
                break
            await asyncio.sleep(0.01)

    asyncio.run(scenario())
    assert {message["req_id"] for message in sent} == {
        "check-during-prepare", "status-during-prepare", "prepare-1"}
    assert next(message for message in sent if message["req_id"] == "prepare-1")["prepared_id"] == "a" * 32
    node.store.db.close()


def test_apply_refuses_native_dsh_open_turn_from_isolated_log(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    session_dir = node.native_dsh_home / "sessions" / "--C-work--" / "session-1"
    session_dir.mkdir(parents=True)
    rows = [
        {"type": "session", "id": "session-1", "cwd": "C:\\work"},
        {"type": "turn/start", "time": 1000, "data": {"turn": 1}},
        {"type": "user/message", "time": 1001,
         "data": {"source": {"kind": "user"}, "content": [{"type": "text", "text": "fixture"}]}},
    ]
    (session_dir / "session.v4.jsonl").write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "apply-1",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "a" * 32}))
    assert sent[0]["error_code"] == "update_busy"
    assert sent[0]["error"] == "native_dsh_turn_active"
    assert manager.apply_calls == 0
    assert node.update_applying is False
    node.store.db.close()


def test_apply_refuses_active_tether_run(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.store.upsert_run("run-1", "session-1", "active fixture", "running")
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "apply-run",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "a" * 32}))
    assert sent[0]["error_code"] == "update_busy"
    assert sent[0]["error"] == "tether_task_active"
    assert manager.apply_calls == 0
    node.store.db.close()


def test_remote_plugin_apply_refuses_when_live_host_profile_is_unknown(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["plugin"] = manager
    node.native_surface.active_profile = lambda: None
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "plugin-apply",
                                   "action": "apply", "component": "plugin",
                                   "prepared_id": "a" * 32}))

    assert sent[0]["error_code"] == "plugin_profile_unknown"
    assert manager.apply_calls == 0
    assert node.update_applying is False
    node.store.db.close()


def test_remote_plugin_apply_uses_live_host_profile(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    manager.apply = lambda _prepared_id: {"ok": True, "component": "plugin", "version": "0.2.2"}
    node.update_managers["plugin"] = manager
    node.native_surface.active_profile = lambda: "work"
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "plugin-apply-work",
                                   "action": "apply", "component": "plugin",
                                   "prepared_id": "a" * 32}))

    assert manager.profile == "work"
    assert sent[0]["ok"] is True
    node.store.db.close()


def test_apply_success_requests_restart_even_if_result_send_fails(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    node.connected = True

    class FakeWebSocket:
        closed = False

        async def close(self, **_kwargs) -> None:
            self.closed = True

    ws = FakeWebSocket()
    node.ws = ws

    async def failing_send(_message: dict) -> None:
        raise OSError("test disconnect")

    monkeypatch.setattr(node, "_send", failing_send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "apply-2",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "a" * 32}))
    assert node.restart_requested is True
    assert node.update_applying is True
    assert ws.closed is True
    assert manager.apply_calls == 1
    node.store.db.close()


def test_node_managed_restart_uses_supervisor_exit_code_75(monkeypatch):
    monkeypatch.setenv("TETHER_NODE_MANAGED", "1")
    try:
        restart_node_process()
    except SystemExit as error:
        assert error.code == 75
    else:
        raise AssertionError("managed node must yield restart to its supervisor")


def test_node_reconnect_loop_stops_after_successful_apply(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    calls = 0

    async def session() -> None:
        nonlocal calls
        calls += 1
        node.restart_requested = True

    node._session = session
    asyncio.run(node.run())
    assert calls == 1
    node.store.db.close()


def test_unmanaged_restart_preserves_original_python_command(monkeypatch):
    class ExecRequested(Exception):
        pass

    original = [sys.executable, "-m", "tether.node.agent", "--device", "target"]
    captured: list[tuple[str, list[str]]] = []

    def execv(executable: str, argv: list[str]) -> None:
        captured.append((executable, argv))
        raise ExecRequested

    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    monkeypatch.setattr(sys, "orig_argv", original, raising=False)
    monkeypatch.setattr(os, "execv", execv)
    try:
        restart_node_process()
    except ExecRequested:
        pass
    assert captured == [(sys.executable, original)]
