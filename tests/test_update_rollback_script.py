"""回滚脚本的端到端回归：真做一次 node 更新，再用脚本把它退回去。

脚本的价值在于"自己找到待处理事务并证明回滚后版本真的回来了"，所以这里不打桩：
prepare/apply 走真实更新器，回滚走真实 UpdateManager.rollback，版本从
version.json 复算。
"""
from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tether.updates import UpdateManager

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update_rollback.py"


def _json_line(stdout: str) -> dict:
    """The script prints a human preamble plus one machine-readable JSON line."""
    lines = [line for line in stdout.splitlines() if line.startswith("{")]
    assert lines, f"no JSON result line in:\n{stdout}"
    return json.loads(lines[-1])

NODE_FILES = {
    "tether/node/agent.py": b"new-node",
    "tether/updates.py": b"new-updates",
    "tether/updates_cli.py": b"new-cli",
    "tether/release.py": b"new-release",
    "tether/ed25519.py": b"new-ed",
}


class ManifestServer:
    """Serves an unsigned loopback manifest, which the updater accepts for dev roots."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                payload = owner.files.get(self.path)
                if payload is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


def _node_archive(version: str) -> bytes:
    prefix = f"tether-node-{version}/"
    payload = {prefix + "version.json": json.dumps({"schema": 1, "components": {"node": version}}).encode(),
               prefix + "pyproject.toml": b"[project]\nversion='0.2.1'\ndependencies=[]\n"}
    for name, content in NODE_FILES.items():
        payload[prefix + name] = content
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in payload.items():
            archive.writestr(name, content)
    return buffer.getvalue()


@pytest.fixture
def updated_node(tmp_path: Path):
    """A node that really applied 0.2.0 -> 0.2.1 and is awaiting acceptance."""
    root = tmp_path / "install"
    root.mkdir()
    (root / "version.json").write_text(json.dumps(
        {"schema": 1, "components": {"app": "0.2.0", "plugin": "0.2.0", "node": "0.2.0"}}), encoding="utf-8")
    target = root / "tether" / "node" / "agent.py"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"old-node")

    server = ManifestServer()
    archive = _node_archive("0.2.1")
    entry = {"version": "0.2.1", "url": server.base + "/node.zip",
             "sha256": hashlib.sha256(archive).hexdigest(), "size": len(archive),
             "protocol": 1, "min_updater": "0.2.1"}
    server.files["/node.zip"] = archive
    server.files["/manifest.json"] = json.dumps(
        {"schema": 1, "components": {name: dict(entry) for name in ("app", "plugin", "node")}}).encode()
    url = server.base + "/manifest.json"
    state = tmp_path / "state"
    manager = UpdateManager(root, "node", manifest_url=url, state_dir=state)
    prepared = manager.prepare()
    assert prepared["ok"] is True, prepared
    applied = manager.apply(prepared["prepared_id"])
    assert applied["status"] == "awaiting_acceptance", applied
    yield root, state, url, prepared["prepared_id"]
    server.close()


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def test_scan_finds_the_open_transaction_with_its_backups(updated_node) -> None:
    root, state, _url, prepared_id = updated_node

    result = run("scan", "--root", str(root), "--component", "node", "--state-dir", str(state))

    assert result.returncode == 0, result.stdout + result.stderr
    assert prepared_id in result.stdout
    assert '"from_version": "0.2.0"' in result.stdout
    assert '"backups": "在场"' in result.stdout, result.stdout


def test_revert_previews_without_touching_the_machine(updated_node) -> None:
    root, state, _url, _prepared_id = updated_node
    before = json.loads((root / "version.json").read_text(encoding="utf-8"))["components"]["node"]

    result = run("revert", "--root", str(root), "--component", "node", "--state-dir", str(state))

    assert result.returncode == 0, result.stdout + result.stderr
    assert "只读预览" in result.stdout
    after = json.loads((root / "version.json").read_text(encoding="utf-8"))["components"]["node"]
    assert after == before == "0.2.1"


def test_revert_apply_restores_the_previous_version_and_reports_seconds(updated_node) -> None:
    root, state, _url, prepared_id = updated_node
    target = root / "tether" / "node" / "agent.py"
    assert target.read_bytes() == b"new-node"

    result = run("revert", "--root", str(root), "--component", "node",
                 "--state-dir", str(state), "--prepared-id", prepared_id, "--apply")

    assert result.returncode == 0, result.stdout + result.stderr
    payload = _json_line(result.stdout)
    assert payload["ok"] is True and payload["version_restored"] == "0.2.0"
    assert payload["rollback_s"] >= 0
    assert target.read_bytes() == b"old-node"
    assert not (state / "transactions" / prepared_id).exists()


def test_scan_reports_nothing_to_do_after_a_commit(tmp_path: Path, updated_node) -> None:
    root, state, url, prepared_id = updated_node
    UpdateManager(root, "node", manifest_url=url, state_dir=state).commit(prepared_id)

    result = run("scan", "--root", str(root), "--component", "node", "--state-dir", str(state))

    assert result.returncode == 2, result.stdout
    assert "没有待处理事务" in result.stdout


def test_multiple_open_transactions_require_an_explicit_selection(updated_node):
    root, state, _url, prepared_id = updated_node
    second_id = "f" * 32
    journal = state / "transactions" / prepared_id / "transaction.json"
    second = journal.parent.parent / second_id / journal.name
    second.parent.mkdir()
    second.write_text(json.dumps({**json.loads(journal.read_text()), "id": second_id}))
    result = run("revert", "--root", str(root), "--component", "node", "--state-dir", str(state))
    assert result.returncode == 2 and "--prepared-id" in result.stdout
