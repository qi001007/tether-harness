"""安装器分层与发行策略判据（缺陷二第 1、2 条）。

真实后果样本：一台到 github.com 不通的机器，更新能走 Hub 镜像成功，安装却直接失败
——旧安装器只拼一个地址并原地重试三次。这里锁住「安装与更新共用同一套层序」。

装置复用 tests/test_install_node.py 里的 bash/python3 shim，不重造一份嵌套引号。
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from test_install_node import _bash_executable, _python3_wrapper, _shell_path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "laptop" / "install-node.sh"
VERSION = "9.8.7"


def _archive(payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        prefix = f"tether-node-{VERSION}/"
        archive.writestr(prefix + "version.json",
                         json.dumps({"schema": 1, "components": {"node": VERSION}}))
        archive.writestr(prefix + "pyproject.toml", b"[project]\n")
        archive.writestr(prefix + "tether/node/agent.py", payload)
    return buffer.getvalue()


def _manifest(**changes) -> dict:
    manifest = {"schema": 1, "components": {"node": {
        "version": VERSION, "protocol": 1, "min_updater": "0.2.1",
        "rollout": {"percent": 100, "include": [], "exclude": []}}}}
    manifest.update(changes)
    return manifest


class Feed:
    """A release feed. `status` lets a layer answer like a blocked or dead host."""

    def __init__(self, manifest: dict | None, archive: bytes | None, status: int = 0) -> None:
        self.hits: list[str] = []
        body = json.dumps(manifest).encode() if manifest is not None else b""
        payload = archive or b""
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                owner.hits.append(self.path)
                if status:
                    self.send_error(status)
                    return
                if self.path.endswith("tether-update.json"):
                    content = body
                elif self.path.endswith(".zip"):
                    content = payload
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *_args) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def _run(tmp_path: Path, mirror_base: str | None, origin_base: str) -> subprocess.CompletedProcess[str]:
    """No --version on purpose: the release policy is read while resolving `latest`,
    so pinning the version would skip the very branch under test."""
    bash = _bash_executable()
    if not bash:
        pytest.skip("bash is required for the installer fixture")
    if not subprocess.run([bash, "-c", "command -v curl"], capture_output=True,
                          text=True).stdout.strip():
        pytest.skip("curl is required")
    home = tmp_path / "home"
    prefix = tmp_path / "prefix"
    bin_dir = tmp_path / "bin"
    for directory in (home, bin_dir):
        directory.mkdir()
    _python3_wrapper(bin_dir / "python3")
    shell_path = subprocess.run([bash, "-c", 'printf %s "$PATH"'],
                                capture_output=True, text=True).stdout.strip()
    env = os.environ.copy()
    env.update({
        "HOME": _shell_path(home),
        "PATH": _shell_path(bin_dir) + ":" + shell_path,
        "TETHER_TEST_REAL_PYTHON": _shell_path(Path(sys.executable)) if os.name == "nt" else sys.executable,
        "TETHER_ORIGIN_BASE": origin_base,
        "TETHER_USER_TOKEN": "t" * 32,
    })
    if mirror_base is None:
        env.pop("TETHER_HUB_URL", None)
        env.pop("TETHER_ASSET_BASE", None)
    if os.name == "nt":
        env["MSYS"] = "winsymlinks:native"
    script = tmp_path / "install-node.sh"
    script.write_text(SCRIPT.read_text(encoding="utf-8").replace("\r\n", "\n"),
                      encoding="utf-8", newline="\n")
    command = [bash, _shell_path(script), "--controller", "wss://127.0.0.1:1/ws/node"]
    if mirror_base is not None:
        command.extend(["--base-url", mirror_base])
    command.extend(["--prefix", _shell_path(prefix), "--no-systemd", "--install-only"])
    return subprocess.run(
        command,
        cwd=str(tmp_path), env=env, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=180)


def test_a_blocked_github_still_installs_from_the_mirror(tmp_path: Path) -> None:
    """判据①：源站不通时镜像层必须装成，并且报出试过哪些层。"""
    archive = _archive(b"node-agent")
    mirror = Feed(_manifest(), archive)
    dead = Feed(None, None, status=502)
    try:
        result = _run(tmp_path, mirror.base, dead.base)
        combined = result.stdout + result.stderr
        assert result.returncode == 0, combined
        assert (tmp_path / "prefix" / f"tether-node-{VERSION}" / "pyproject.toml").is_file()
        assert "across 2 layer(s)" in combined
        assert "archive came from layer=hub_mirror" in combined
    finally:
        mirror.close()
        dead.close()


def test_withdrawn_release_refuses_the_install_instead_of_grabbing_an_older_build(
        tmp_path: Path) -> None:
    """判据②：清单声明已撤 → 拒装并说人话，不静默拉旧版。"""
    mirror = Feed(_manifest(withdrawn={"node": [VERSION]}), _archive(b"node-agent"))
    try:
        result = _run(tmp_path, mirror.base, "http://127.0.0.1:1")
        combined = result.stdout + result.stderr
        assert result.returncode != 0, combined
        assert "update_withdrawn" in combined
        assert not (tmp_path / "prefix" / f"tether-node-{VERSION}" / "pyproject.toml").exists()
    finally:
        mirror.close()


def test_paused_rollout_refuses_the_install(tmp_path: Path) -> None:
    manifest = _manifest()
    manifest["components"]["node"]["rollout"] = {"percent": 0, "include": [], "exclude": []}
    mirror = Feed(manifest, _archive(b"node-agent"))
    try:
        result = _run(tmp_path, mirror.base, "http://127.0.0.1:1")
        combined = result.stdout + result.stderr
        assert result.returncode != 0, combined
        assert "rollout_paused" in combined
    finally:
        mirror.close()


def test_installer_has_no_bare_and_or_assignment_under_set_e() -> None:
    """缺陷 A 那一类：`set -euo pipefail` 下裸 AND-OR 列表在两个测试都假时非零退出。

    内存限制真生效的机器会被「检查内存限制」的代码弄坏安装，就是这条形状。
    """
    source = SCRIPT.read_text(encoding="utf-8")
    assert "set -euo pipefail" in source
    offenders = [line.strip() for line in source.splitlines()
                 if re.match(r"^\[.*\]\s*\|\|\s*\[.*\]\s*&&\s*\w+=", line.strip())]
    assert not offenders, f"bare AND-OR assignment would abort install on a healthy host: {offenders}"


def test_no_base_url_means_no_layer_points_at_the_production_hub(tmp_path: Path) -> None:
    """判据：不给 --base-url 时不得存在 hub_mirror 层。

    镜像层原先由内置的 HUB_URL 默认值推导，于是每一次无人值守安装都会自动重试一个
    生产域名——Hub 不健康时这正是会挡住恢复的那种流量。
    """
    origin = Feed(_manifest(), _archive(b"node-agent"))
    try:
        result = _run(tmp_path, None, origin.base)
        combined = result.stdout + result.stderr
        assert "across 1 layer(s)" in combined, combined
        assert "hub_mirror" not in combined
        assert result.returncode == 0, combined
    finally:
        origin.close()
