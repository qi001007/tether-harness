"""树莓派 / linux-arm64 的能力位判定。

原则：没有对应预编译产物的能力必须回 unavailable 并带原因码，不能因为
「操作系统是 Linux」就说可用。反向也要测，防止把 x64 一起禁掉。
"""
from __future__ import annotations

import hashlib
import platform as platform_module
from pathlib import Path
from types import SimpleNamespace

import pytest

from tether.node import dsh_web as dsh_web_module
from tether.node.agent import Node
from tether.node.dsh_web import (
    DSH_STATE_ABSENT,
    DSH_STATE_PRESENT_BUT_NOT_RUNNABLE,
    DshWeb,
)


def _fake_platform(monkeypatch, system: str, machine: str) -> None:
    monkeypatch.setattr(platform_module, "system", lambda: system)
    monkeypatch.setattr(platform_module, "machine", lambda: machine)


def _runtime_tree(tmp_path: Path, monkeypatch, *, plugin: bool) -> Path:
    runtime = tmp_path / "runtime"
    node = runtime / "bin" / "node"
    node.parent.mkdir(parents=True)
    node.write_text("fake runtime")
    entry = runtime / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"
    package = entry.parents[1] / "package.json"
    entry.parent.mkdir(parents=True)
    package.write_text(f'{{"version": "{dsh_web_module.DSH_VERSION}"}}', encoding="utf-8")
    entry.write_text("fake dsh entry")
    (runtime / "package-lock.json").write_text("{}", encoding="utf-8")
    if plugin:
        archive = runtime.parent / "dsh-plugin" / "tether-plugin-0.2.93.zip"
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(b"synthetic frozen plugin")
        monkeypatch.setattr(dsh_web_module, "PLUGIN_SHA256",
                            hashlib.sha256(archive.read_bytes()).hexdigest())
    monkeypatch.setenv("TETHER_DSH_RUNTIME_DIR", str(runtime))
    monkeypatch.setenv("TETHER_NODEJS_EXE", str(node))
    return runtime


def test_dsh_web_is_not_supported_on_linux_arm64(tmp_path: Path, monkeypatch) -> None:
    """Pi 上没有 node-pty/DSH 预编译包，supported 必须为假并给出原因码。"""
    _fake_platform(monkeypatch, "Linux", "aarch64")
    web = DshWeb(tmp_path)

    status = web.status()

    assert status["supported"] is False
    assert status["error_code"] == "unsupported_architecture"
    assert status["dsh_state"] == DSH_STATE_ABSENT


def test_dsh_web_missing_bundle_is_false_even_when_architecture_is_supported(
        tmp_path: Path, monkeypatch) -> None:
    """L1 supported 与 L2 installed 分层：x64 支持不代表随包 DSH 已装全。"""
    _fake_platform(monkeypatch, "Linux", "x86_64")
    _runtime_tree(tmp_path, monkeypatch, plugin=False)
    web = DshWeb(tmp_path)

    status = web.status()

    assert status["supported"] is True
    assert status["installed"] is False
    assert status["running"] is False
    assert status["error_code"] == "dsh_plugin_bundle_missing"
    assert status["dsh_state"] == DSH_STATE_ABSENT


def test_dsh_web_stays_unsupported_when_runtime_files_are_present(
        tmp_path: Path, monkeypatch) -> None:
    """L3：运行文件存在也不能让 arm64 变成 True，避免安装 linux-x64 预编译包。"""
    _fake_platform(monkeypatch, "Linux", "aarch64")
    _runtime_tree(tmp_path, monkeypatch, plugin=True)
    web = DshWeb(tmp_path)

    status = web.status()

    assert status["supported"] is False
    assert status["installed"] is False
    assert status["error_code"] == "unsupported_architecture"
    assert status["dsh_state"] == DSH_STATE_PRESENT_BUT_NOT_RUNNABLE


def test_dsh_web_stays_supported_on_linux_x64(tmp_path: Path, monkeypatch) -> None:
    """限制只管它适用的范围：arm64 降级不能把 x64 一起关掉。"""
    _fake_platform(monkeypatch, "Linux", "x86_64")
    web = DshWeb(tmp_path)

    assert web.status()["supported"] is True


def test_dsh_web_stays_supported_on_windows(tmp_path: Path, monkeypatch) -> None:
    _fake_platform(monkeypatch, "Windows", "AMD64")
    web = DshWeb(tmp_path)

    assert web.status()["supported"] is True


def test_dsh_web_reports_unsupported_os_reason_first(tmp_path: Path, monkeypatch) -> None:
    """BSD 之类连操作系统都不支持时，原因码不该被架构判定抢走。"""
    _fake_platform(monkeypatch, "FreeBSD", "amd64")
    web = DshWeb(tmp_path)

    status = web.status()

    assert status["supported"] is False
    assert status["error_code"] == "unsupported_platform"


def test_node_capabilities_use_the_exact_three_layer_dsh_state_contract(monkeypatch) -> None:
    """Hub 看到 supported、installed 与 dsh_state，不再只有一个可误读布尔。"""
    node = Node.__new__(Node)
    node.device = "pi-01"
    node.workspace = Path("/srv/pi")
    node.workspaces_root = Path("/srv")
    node.node_version = "0.5.15"
    node.update_managers = {}
    node.debian_package_update_capability = None
    node.debian_package_update_status = None
    node.terminal = SimpleNamespace(shells=lambda: [])
    node.dsh_sessions = SimpleNamespace(available=lambda: False, home=Path("/tmp/dsh"))
    node.native_surface = SimpleNamespace(available=lambda: False)
    node.croc = SimpleNamespace(info=lambda: {"available": False, "version": ""})
    node.direct = None
    node._app_heartbeat_fields = lambda: {"app_version": "0.5.15", "app_installed": True}
    node.fs = SimpleNamespace(
        dsh_web=SimpleNamespace(status=lambda: {
            "supported": True, "installed": False, "running": False,
            "error_code": "dsh_plugin_bundle_missing", "dsh_state": "absent"
        }),
        dsh_desktop=SimpleNamespace(status=lambda: {
            "installed": False, "running": False, "version": "", "installing": False
        }),
        policy=SimpleNamespace(data={}),
        _transfer_capabilities=lambda: {},
        mesh_runtime=None
    )
    monkeypatch.setenv("TETHER_NODE_UPDATE_OWNER", "node")

    caps = node.capabilities()

    assert caps["dsh_state"] == "absent"
    assert caps["dsh_web_supported"] is True
    assert caps["dsh_web_status"]["installed"] is False
    assert caps["dsh_web_status"]["error_code"] == "dsh_plugin_bundle_missing"
    assert "dsh_web_installed" not in caps
    assert "dsh_web_error_code" not in caps
