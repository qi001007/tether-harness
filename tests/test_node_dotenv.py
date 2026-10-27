from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]


def _powershell() -> str | None:
    return shutil.which("powershell.exe") or shutil.which("pwsh")


def test_bootstrap_env_encoding_is_readable_by_node_with_chinese_values(tmp_path: Path) -> None:
    config_dir = tmp_path / "节点配置"
    config_dir.mkdir()
    env_path = config_dir / ".env"
    values = {
        "TETHER_CONTROLLER": "wss://hub.example.invalid/ws/node",
        "TETHER_DEVICE": "实验室笔记本",
        "TETHER_NODE_TOKEN": "local-fixture-token",
        "DSH_HOME": str(config_dir / "用户数据"),
    }
    env_path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")

    assert env_path.read_bytes()[:3] != b"\xef\xbb\xbf"
    assert dotenv_values(env_path, encoding="utf-8") == values

    bootstrap = (ROOT / "laptop" / "bootstrap-node.ps1").read_text(encoding="utf-8")
    assert "Get-Content -Encoding UTF8" in bootstrap
    assert "UTF8Encoding($false)" in bootstrap
    assert "Set-Content -Encoding UTF8" not in bootstrap


def test_bootstrap_preserves_existing_token_and_writes_utf8_without_bom(
    tmp_path: Path,
) -> None:
    powershell = _powershell()
    if not powershell:
        import pytest

        pytest.skip("PowerShell is required for the bootstrap integration check")
    app_dir = tmp_path / "安装目录"
    laptop = app_dir / "laptop"
    laptop.mkdir(parents=True)
    script = laptop / "bootstrap-node.ps1"
    script.write_bytes((ROOT / "laptop" / "bootstrap-node.ps1").read_bytes())
    env_path = app_dir / ".env"
    env_path.write_text(
        "TETHER_CONTROLLER=wss://hub.example.invalid/ws/node\n"
        "TETHER_NODE_TOKEN=fixture-existing-token\n"
        f"DSH_HOME={app_dir / '用户数据'}\n",
        encoding="utf-8",
    )
    empty_path = tmp_path / "empty-bin"
    empty_path.mkdir()
    child_env = dict(os.environ)
    child_env["PATH"] = str(empty_path)

    result = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-File", str(script)],
        cwd=app_dir,
        env=child_env,
        capture_output=True,
        timeout=15,
        check=False,
    )

    output = (result.stdout or b"").decode("utf-8", errors="replace") + (result.stderr or b"").decode("utf-8", errors="replace")
    assert result.returncode != 0
    assert "Python 3.10+ not found" in output
    assert "fixture-existing-token" not in output
    raw = env_path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf")
    parsed = dotenv_values(env_path, encoding="utf-8")
    assert parsed["TETHER_NODE_TOKEN"] == "fixture-existing-token"
    assert parsed["TETHER_CONTROLLER"] == "wss://hub.example.invalid/ws/node"
    assert parsed["TETHER_DEVICE"]
    assert parsed["DSH_HOME"] == str(app_dir / "用户数据")


def test_bootstrap_rejects_duplicate_node_configuration_keys_before_install(
    tmp_path: Path,
) -> None:
    powershell = _powershell()
    if not powershell:
        import pytest

        pytest.skip("PowerShell is required for the bootstrap integration check")
    app_dir = tmp_path / "node-install"
    laptop = app_dir / "laptop"
    laptop.mkdir(parents=True)
    script = laptop / "bootstrap-node.ps1"
    script.write_bytes((ROOT / "laptop" / "bootstrap-node.ps1").read_bytes())
    env_path = app_dir / ".env"
    env_path.write_text(
        "TETHER_CONTROLLER=wss://hub.example.invalid/ws/node\n"
        "TETHER_NODE_TOKEN=first-token\n"
        "TETHER_NODE_TOKEN=second-token\n",
        encoding="utf-8",
    )
    empty_path = tmp_path / "empty-bin"
    empty_path.mkdir()
    child_env = dict(os.environ)
    child_env["PATH"] = str(empty_path)

    result = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-File", str(script)],
        cwd=app_dir,
        env=child_env,
        capture_output=True,
        timeout=15,
        check=False,
    )

    output = (result.stdout or b"").decode("utf-8", errors="replace") + (result.stderr or b"").decode("utf-8", errors="replace")
    assert result.returncode != 0
    assert "Duplicate TETHER_NODE_TOKEN entries" in output
    assert env_path.read_text(encoding="utf-8").count("TETHER_NODE_TOKEN=") == 2


def test_node_runtime_declares_python_dotenv_dependency() -> None:
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert '"python-dotenv>=1.0"' in pyproject
