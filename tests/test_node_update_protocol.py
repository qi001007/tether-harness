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
        self.last_force = None
        self.prepare_started = threading.Event()
        self.prepare_release = threading.Event()

    def check(self, force: bool = False) -> dict:
        self.last_force = force
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
    from tether.updates import MAX_UPDATE_PROTOCOL, MIN_UPDATE_PROTOCOL, UPDATE_PROTOCOL

    node = _node(tmp_path, monkeypatch)
    node.update_managers["node"] = FakeUpdateManager()
    node.node_version = "0.2.1"
    capabilities = node.capabilities()
    assert capabilities["node_version"] == "0.2.1"
    assert capabilities["update_protocol"] == UPDATE_PROTOCOL
    assert capabilities["min_update_protocol"] == MIN_UPDATE_PROTOCOL
    assert capabilities["max_update_protocol"] == MAX_UPDATE_PROTOCOL
    assert capabilities["app_version"] == node._managed_app_version()
    assert "app" in node.update_managers
    node.store.db.close()


def test_node_status_keeps_restart_pending_when_disk_version_differs_from_loaded_runtime(
        tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    result = {"ok": True, "component": "node", "current_version": "0.4.6",
              "restart_required": True}
    manager.check = lambda force=False: dict(result)
    manager.status = lambda: dict(result)
    node.update_managers["node"] = manager
    node.node_version = "0.4.5"
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    for action in ("check", "status"):
        asyncio.run(node._update_call({"type": "update_call", "req_id": action,
                                       "action": action, "component": "node"}))

    assert [message["runtime_version"] for message in sent] == ["0.4.5", "0.4.5"]
    assert all(message["restart_required"] is True for message in sent)
    node.store.db.close()


def test_node_status_clears_historical_restart_when_loaded_runtime_matches_disk(
        tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    manager.status = lambda: {"ok": True, "component": "node", "current_version": "0.4.6",
                              "restart_required": True}
    node.update_managers["node"] = manager
    node.node_version = "0.4.6"
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "caught-up",
                                   "action": "status", "component": "node"}))

    assert sent[0]["runtime_version"] == "0.4.6"
    assert sent[0]["restart_required"] is False
    node.store.db.close()


def test_node_status_keeps_restart_pending_for_unknown_runtime_version(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    manager.status = lambda: {"ok": True, "component": "node", "current_version": "0.4.6",
                              "restart_required": False}
    node.update_managers["node"] = manager
    node.node_version = "unknown"
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "unknown-runtime",
                                   "action": "status", "component": "node"}))

    assert sent[0]["runtime_version"] == "unknown"
    assert sent[0]["restart_required"] is True
    node.store.db.close()


def test_app_manager_uses_trusted_external_installation_root_and_shared_state(tmp_path, monkeypatch):
    import hashlib

    from tether.updates import app_installation_path

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("TETHER_NODE_TOKEN", "node-credential")
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    node = _node(tmp_path, monkeypatch)
    root = tmp_path / "separate-app"
    app_dir = root / "apps" / "tether-app"
    app_dir.mkdir(parents=True)
    (app_dir / "main.js").write_text("", encoding="utf-8")
    (root / "version.json").write_text(json.dumps({
        "schema": 1, "components": {"app": "0.4.5", "node": "0.4.4", "plugin": "0.2.93"}
    }), encoding="utf-8")
    origin = "http://127.0.0.1:18890"
    record_path = app_installation_path("ws://127.0.0.1:18890/ws/node", "test-node")
    assert record_path is not None
    record_path.parent.mkdir(parents=True)
    record_path.write_text(json.dumps({
        "schema": 1, "controller_origin": origin, "device_id": "test-node", "root": str(root),
        "pid": 2_000_000_000, "process_started_at": 1.0, "started_version": "0.4.5",
        "credential_fingerprint": hashlib.sha256(
            f"{origin}\ntest-node\nfake".encode()).hexdigest(),
    }), encoding="utf-8")

    node._refresh_app_update_manager()
    manager = node.update_managers["app"]
    assert manager.root == root.resolve()
    assert manager.state_dir == app_dir / "data" / "updates" / "app"
    fields = node._app_heartbeat_fields()
    assert fields == {"app_version": "0.4.5", "app_installed": True}
    assert manager.app_binding_required is True
    node.store.db.close()


def test_unbound_standalone_node_does_not_advertise_an_app(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    node = _node(tmp_path, monkeypatch)
    assert node._app_heartbeat_fields() == {"app_version": "", "app_installed": False}
    assert node.update_managers["app"].status()["error_code"] == "app_not_installed"
    node.store.db.close()


def test_managed_node_keeps_same_root_app_update_binding(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("TETHER_NODE_MANAGED", "1")
    node = _node(tmp_path, monkeypatch)
    manager = node.update_managers["app"]
    assert manager.root == agent.ROOT.resolve()
    assert manager.app_binding_required is False
    node.store.db.close()


def test_check_forces_the_manifest_while_status_keeps_the_cache(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    asyncio.run(node._update_call({"type": "update_call", "req_id": "check-1",
                                   "component": "node", "action": "check"}))
    assert manager.last_force is True
    manager.last_force = None
    asyncio.run(node._update_call({"type": "update_call", "req_id": "status-1",
                                   "component": "node", "action": "status"}))
    assert manager.last_force is None
    node.store.db.close()


def test_control_websocket_bypasses_desktop_proxy(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    captured: dict = {}

    class FakeWebSocket:
        receives = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def send(self, _message: str) -> None:
            return None

        async def recv(self) -> str:
            self.receives += 1
            if self.receives == 1:
                return json.dumps({"type": "registered"})
            raise OSError("fixture disconnect")

    def connect(url: str, *, proxy=True, **options):
        options["proxy"] = proxy
        captured.update({"url": url, **options})
        return FakeWebSocket()

    monkeypatch.setattr(agent.websockets, "connect", connect)
    try:
        asyncio.run(node._session())
    except OSError as exc:
        assert str(exc) == "fixture disconnect"

    assert captured["proxy"] is None
    assert captured["ping_interval"] == 20
    assert captured["ping_timeout"] == 20
    node.store.db.close()


def test_update_result_does_not_cross_reconnected_websocket(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    old_ws = object()
    new_ws = object()
    node.ws = old_ws
    node.connected = True
    sent: list[dict] = []
    original_check = manager.check

    def blocking_check(_force: bool = False) -> dict:
        manager.prepare_started.set()
        manager.prepare_release.wait(3)
        return original_check(True)

    async def send(message: dict) -> None:
        sent.append(message)

    manager.check = blocking_check
    monkeypatch.setattr(node, "_send", send)

    async def scenario() -> None:
        await node._handle({"type": "update_call", "req_id": "stale-check",
                            "component": "node", "action": "check"})
        task = next(iter(node.update_tasks))
        assert await asyncio.to_thread(manager.prepare_started.wait, 2)
        node.ws = new_ws
        manager.prepare_release.set()
        await task

    asyncio.run(scenario())
    assert sent == []
    node.store.db.close()


def test_invalid_state_while_sending_result_is_transport_churn(
        tmp_path, monkeypatch, capsys):
    node = _node(tmp_path, monkeypatch)
    node.update_managers["node"] = FakeUpdateManager()
    node.ws = object()
    node.connected = True

    async def send(_message: dict) -> None:
        raise asyncio.InvalidStateError

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "closing-check",
                                   "component": "node", "action": "check"}, node.ws))

    assert "InvalidStateError" not in capsys.readouterr().out
    assert node.connected is False
    node.store.db.close()


def test_remote_app_apply_returns_restart_required(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    app_root = (tmp_path / "bound-app").resolve()
    manager = FakeUpdateManager()
    manager.root = app_root
    manager.apply = lambda _prepared_id: {"ok": True, "component": "app", "version": "0.2.2",
                                          "restart_required": True}
    node.update_managers["app"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    sent: list[dict] = []
    scheduled_roots: list[Path] = []
    node.ws = object()
    original_ws = node.ws

    async def send(message: dict) -> None:
        sent.append(message)

    def schedule(root: Path) -> bool:
        scheduled_roots.append(root)
        return True

    monkeypatch.setattr(node, "_send", send)
    monkeypatch.setattr(agent, "schedule_app_restart", schedule)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "app-apply",
                                   "action": "apply", "component": "app",
                                   "prepared_id": "a" * 32}))

    assert sent[0]["ok"] is True
    assert sent[0]["component"] == "app"
    assert sent[0]["restart_required"] is True
    assert sent[0]["restart_scheduled"] is True
    assert scheduled_roots == [app_root]
    assert node.ws is original_ws
    assert node.restart_requested is False
    assert node.update_applying is False
    node.store.db.close()


def test_managed_same_root_app_apply_rejects_active_node_work_before_restart(
        tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.setenv("TETHER_NODE_MANAGED", "1")
    manager = FakeUpdateManager()
    manager.root = agent.ROOT.resolve()
    node.update_managers["app"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    monkeypatch.setattr(node.croc, "status", lambda: {"state": "idle"})
    monkeypatch.setattr(node.fs.agents_runtime, "activity", lambda: {
        "ok": True, "busy": True, "reason": "agent_turn_active"})
    scheduled_roots: list[Path] = []
    monkeypatch.setattr(agent, "schedule_app_restart", lambda root: scheduled_roots.append(root))
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "managed-app-busy",
                                   "action": "apply", "component": "app",
                                   "prepared_id": "d" * 32}))

    assert sent[0]["error_code"] == "update_busy"
    assert sent[0]["busy_reason"] == "agent_turn_active"
    assert manager.apply_calls == 0
    assert scheduled_roots == []
    assert node.update_applying is False
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

    assert order == ["restart", "response"]
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

    assert sent[0]["ok"] is False
    assert sent[0]["error_code"] == "restart_failed"
    assert sent[-1]["type"] == "update_ready"
    assert node.update_applying is False
    node.store.db.close()


def test_windows_app_restart_helper_spawns_a_windowless_python_helper(tmp_path, monkeypatch):
    app_root = tmp_path / "installed app"
    electron = (app_root / "apps" / "tether-app" / "node_modules" / "electron"
                / "dist" / "electron.exe")
    electron.parent.mkdir(parents=True)
    electron.write_bytes(b"MZ")
    launcher = app_root / "apps" / "tether-app" / "Tether-App.cmd"
    launcher.write_text("@echo off\n", encoding="utf-8")
    captured: list[tuple[list[str], dict]] = []

    def popen(args, **kwargs):
        captured.append((args, kwargs))
        return object()

    monkeypatch.setattr(agent.sys, "platform", "win32")
    monkeypatch.setattr(agent.subprocess, "Popen", popen)
    assert agent.schedule_app_restart(app_root) is True
    args, options = captured[0]
    assert args[:3] == [agent.sys.executable, "-m", "tether.node.app_restart"]
    assert args[args.index("--root") + 1] == str(app_root.resolve())
    lowered = [str(arg).lower() for arg in args]
    assert not any("explorer" in arg or arg.endswith(".cmd") or "powershell" in arg for arg in lowered)
    assert options["creationflags"] & agent.CREATE_NO_WINDOW
    assert options["creationflags"] & agent.DETACHED_PROCESS
    assert options["creationflags"] & agent.CREATE_NEW_PROCESS_GROUP


def test_app_restart_helper_fails_cleanly_when_electron_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(agent.sys, "platform", "win32")
    assert agent.schedule_app_restart(tmp_path) is False


def test_app_restart_launches_electron_directly_without_a_shell(tmp_path, monkeypatch):
    from tether.node import app_restart

    root = tmp_path / "install"
    electron = app_restart.electron_executable(root)
    app_dir = root / "apps" / "tether-app"
    electron.parent.mkdir(parents=True)
    electron.write_bytes(b"MZ")
    captured: list[tuple[list[str], dict]] = []

    def popen(args, **kwargs):
        captured.append((args, kwargs))
        return object()

    monkeypatch.setattr(app_restart.sys, "platform", "win32")
    monkeypatch.setattr(app_restart.subprocess, "Popen", popen)
    monkeypatch.setattr(app_restart, "stop_app", lambda _electron, _log: None)
    code = app_restart.main(["--root", str(root), "--log", str(tmp_path / "restart.log"),
                             "--delay", "0"])

    assert code == 0
    args, options = captured[0]
    assert args == [str(electron), str(app_dir)]
    assert options["cwd"] == str(app_dir)
    assert not any("explorer" in str(arg).lower() or str(arg).lower().endswith(".cmd") for arg in args)
    assert "ELECTRON_RUN_AS_NODE" not in options["env"]


def test_update_calls_attach_while_an_apply_is_running(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.update_applying = True
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    for req_id, action in (("status-during", "status"), ("check-during", "check")):
        asyncio.run(node._update_call({"type": "update_call", "req_id": req_id,
                                       "action": action, "component": "node"}))
    asyncio.run(node._update_call({"type": "update_call", "req_id": "apply-during",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "b" * 32}))

    assert [message["status"] for message in sent] == ["in_progress"] * 3
    assert all(message["ok"] is True and message["in_progress"] is True for message in sent)
    assert manager.apply_calls == 0
    assert node.update_applying is True
    node.store.db.close()


def test_in_progress_apply_result_does_not_request_a_restart(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    manager.apply = lambda _prepared_id: {"ok": True, "component": "node",
                                          "status": "in_progress", "in_progress": True,
                                          "restart_required": False, "error": ""}
    node.update_managers["node"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "node-attached",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "b" * 32}))

    assert sent[0]["status"] == "in_progress"
    assert node.restart_requested is False
    assert node.update_applying is False
    assert sent[-1]["type"] == "update_ready"
    node.store.db.close()


def test_node_apply_rejects_active_agents_work_before_stop_or_apply(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    stop_calls: list[bool] = []
    monkeypatch.setattr(node.fs.agents_runtime, "activity", lambda: {
        "ok": True, "busy": True, "reason": "agent_delegation_active"})
    monkeypatch.setattr(node.fs.agents_runtime, "stop", lambda: stop_calls.append(True))
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "active-agents",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "a" * 32}))

    assert sent[0]["error_code"] == "update_busy"
    assert sent[0]["error"] == "正在执行任务或文件传输，完成或取消后重试。"
    assert sent[0]["busy_reason"] == "agent_delegation_active"
    assert manager.apply_calls == 0
    assert stop_calls == []
    assert node.restart_requested is False
    node.store.db.close()


def test_node_apply_continues_when_agents_idle(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    stop_calls: list[bool] = []
    monkeypatch.setattr(node.fs.agents_runtime, "activity", lambda: {
        "ok": True, "busy": False, "reason": ""})
    monkeypatch.setattr(node.fs.agents_runtime, "stop", lambda: stop_calls.append(True))
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "idle-agents",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "b" * 32}))

    assert sent[0]["ok"] is True
    assert manager.apply_calls == 1
    assert stop_calls == [True]
    assert node.restart_requested is True
    node.store.db.close()


def test_node_apply_rejects_running_croc_before_runtime_stop(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.delenv("TETHER_NODE_MANAGED", raising=False)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    stop_calls: list[bool] = []
    monkeypatch.setattr(node.croc, "status", lambda: {"state": "running"})
    monkeypatch.setattr(node.fs.agents_runtime, "activity", lambda: (_ for _ in ()).throw(
        AssertionError("runtime activity must be short-circuited by active Croc")))
    monkeypatch.setattr(node.fs.agents_runtime, "stop", lambda: stop_calls.append(True))
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "active-croc",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "c" * 32}))

    assert sent[0]["error_code"] == "update_busy"
    assert sent[0]["error"] == "正在执行任务或文件传输，完成或取消后重试。"
    assert sent[0]["busy_reason"] == "croc_transfer_active"
    assert manager.apply_calls == 0
    assert stop_calls == []
    node.store.db.close()


def test_node_restart_is_deferred_when_the_app_update_is_prepared(tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    monkeypatch.setenv("TETHER_NODE_MANAGED", "1")
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager

    class PreparedAppManager(FakeUpdateManager):
        def status(self) -> dict:
            return {"ok": True, "component": "app", "prepared": [{"to_version": "0.2.2"}]}

    node.update_managers["app"] = PreparedAppManager()
    node.update_managers["app"].root = agent.ROOT.resolve()
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(node, "_send", send)
    asyncio.run(node._update_call({"type": "update_call", "req_id": "node-defer",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "a" * 32}))

    result = sent[0]
    assert result["ok"] is True
    assert result["restart_required"] is True
    assert result["restart_deferred"] is True
    assert node.restart_requested is False
    assert node.update_applying is False
    assert sent[-1]["type"] == "update_ready"
    node.store.db.close()


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
    assert sent[0]["error"] == "正在执行任务或文件传输，完成或取消后重试。"
    assert sent[0]["busy_reason"] == "native_dsh_turn_active"
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
    assert sent[0]["error"] == "正在执行任务或文件传输，完成或取消后重试。"
    assert sent[0]["busy_reason"] == "tether_task_active"
    assert manager.apply_calls == 0
    node.store.db.close()


def test_remote_plugin_apply_refuses_when_no_profile_has_the_plugin(tmp_path, monkeypatch):
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

    assert sent[0]["error_code"] == "plugin_package_missing"
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


def test_node_apply_closes_current_socket_after_request_socket_reconnects(
        tmp_path, monkeypatch):
    node = _node(tmp_path, monkeypatch)
    manager = FakeUpdateManager()
    node.update_managers["node"] = manager
    node.dsh_sessions.list = lambda: []
    node.dsh_sessions._files = lambda: []
    request_ws = object()

    class CurrentWebSocket:
        closed = False

        async def close(self, **_kwargs) -> None:
            self.closed = True

    current_ws = CurrentWebSocket()
    node.ws = current_ws
    asyncio.run(node._update_call({"type": "update_call", "req_id": "apply-after-reconnect",
                                   "action": "apply", "component": "node",
                                   "prepared_id": "a" * 32}, request_ws))

    assert current_ws.closed is True
    assert node.restart_requested is True
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
