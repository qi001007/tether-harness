from __future__ import annotations

import base64
import hashlib
import sys
from pathlib import Path

import pytest

from tether.node.transfer_jobs import RcloneJobs, TransferJobError


def _jobs(tmp_path: Path) -> RcloneJobs:
    return RcloneJobs(
        tmp_path / "jobs", target_id="target",
        resolver=lambda _network_id: {"host": "127.0.0.1", "port": 1080},
        read_guard=lambda *_args: None, write_guard=lambda *_args: None,
        binary=sys.executable,
    )


def _endpoint() -> dict[str, object]:
    raw = b"0123456789abcdefgh"
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
    return {
        "host": "10.0.0.5", "port": 22, "username": "tether",
        "host_key": "ssh-ed25519 " + base64.b64encode(raw).decode(),
        "host_key_fingerprint": fingerprint, "network_id": "net-1",
    }


def test_rclone_config_uses_multithreaded_sftp_tuning(tmp_path: Path) -> None:
    jobs = _jobs(tmp_path)
    jobs.socks_proxy_resolver = lambda _network_id: {"host": "127.0.0.1", "port": 1080}
    directory = tmp_path / "cfg"
    directory.mkdir()
    config = jobs._write_rclone_config("op1", _endpoint(), tmp_path / "key", config_dir=directory)
    body = config.read_text(encoding="utf-8")
    assert "connections = 9" in body
    assert "chunk_size = 255k" in body
    assert "concurrency = 64" in body
    assert "shell_type = none" in body
    assert "known_hosts_file" in body


class _FakeProcess:
    pid = 4321

    def poll(self):  # noqa: D401 - mimics subprocess.Popen
        return None


def test_start_rc_passes_multi_thread_flags_from_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = _jobs(tmp_path)
    (jobs._grant_dir / "op2").mkdir()
    captured: list[list[str]] = []

    def fake_popen(args, **_kwargs):
        captured.append(list(args))
        return _FakeProcess()

    monkeypatch.setattr("tether.node.transfer_jobs.subprocess.Popen", fake_popen)
    monkeypatch.setattr(jobs, "_rc_call", lambda *_args: {})
    monkeypatch.setenv("RCLONE_MULTI_THREAD_CUTOFF", "32Mi")
    monkeypatch.setenv("RCLONE_MULTI_THREAD_STREAMS", "8")
    monkeypatch.setenv("RCLONE_MULTI_THREAD_CHUNK_SIZE", "16Mi")
    jobs._start_rc("op2", tmp_path / "rclone.conf")

    argv = captured[0]
    assert argv[argv.index("--multi-thread-cutoff") + 1] == "32Mi"
    assert argv[argv.index("--multi-thread-streams") + 1] == "8"
    assert argv[argv.index("--multi-thread-chunk-size") + 1] == "16Mi"
    assert "--transfers" in argv


def test_start_rc_uses_safe_defaults_and_rejects_injection(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = _jobs(tmp_path)
    (jobs._grant_dir / "op3").mkdir()
    captured: list[list[str]] = []

    monkeypatch.setattr("tether.node.transfer_jobs.subprocess.Popen",
                        lambda args, **_kwargs: captured.append(list(args)) or _FakeProcess())
    monkeypatch.setattr(jobs, "_rc_call", lambda *_args: {})
    for name in ("RCLONE_MULTI_THREAD_CUTOFF", "RCLONE_MULTI_THREAD_STREAMS", "RCLONE_MULTI_THREAD_CHUNK_SIZE"):
        monkeypatch.delenv(name, raising=False)
    jobs._start_rc("op3", tmp_path / "rclone.conf")
    argv = captured[0]
    assert argv[argv.index("--multi-thread-cutoff") + 1] == "16Mi"
    assert argv[argv.index("--multi-thread-streams") + 1] == "4"
    assert argv[argv.index("--multi-thread-chunk-size") + 1] == "8Mi"

    monkeypatch.setenv("RCLONE_MULTI_THREAD_CUTOFF", "16Mi; rm -rf /")
    with pytest.raises(TransferJobError) as caught:
        (jobs._grant_dir / "op4").mkdir()
        jobs._start_rc("op4", tmp_path / "rclone.conf")
    assert caught.value.code == "invalid_transfer_tuning"