from __future__ import annotations

import base64
import hashlib
import sqlite3
import sys
from pathlib import Path

import pytest

from tether.node.fs_service import FsService
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


def _insert_job(jobs: RcloneJobs, operation_id: str, **values: object) -> None:
    fields = {"operation_id": operation_id, "payload_hash": "hash", "payload": "{}",
              "state": "queued", "updated_at": 0.0, **values}
    columns = ",".join(fields)
    placeholders = ",".join("?" for _ in fields)
    with jobs._connect() as db:
        db.execute(f"INSERT INTO jobs({columns}) VALUES({placeholders})", tuple(fields.values()))


def test_write_started_defaults_to_zero_and_flips_one_way(tmp_path: Path) -> None:
    jobs = _jobs(tmp_path)
    _insert_job(jobs, "op-write", state="authorizing")
    assert jobs._get("op-write")["write_started"] is False

    jobs._update("op-write", write_started=1)
    assert jobs._get("op-write")["write_started"] is True

    # Later state transitions never clear the durable write marker.
    jobs._update("op-write", state="running")
    jobs._update("op-write", state="cancelled", rate=0)
    assert jobs._get("op-write")["write_started"] is True


def test_fallback_safe_requires_terminal_zero_write_and_finished_cleanup(tmp_path: Path) -> None:
    jobs = _jobs(tmp_path)
    cases = {
        "failed-safe": ({"state": "failed", "write_started": 0, "cleanup_done": 1}, True),
        "cancelled-safe": ({"state": "cancelled", "write_started": 0, "cleanup_done": 1}, True),
        "zero-byte-safe": ({"state": "failed", "write_started": 0, "cleanup_done": 1,
                            "bytes_done": 0, "files_done": 0}, True),
        "zero-byte-published": ({"state": "failed", "write_started": 1, "cleanup_done": 1,
                                 "bytes_done": 0, "files_done": 0}, False),
        "failed-no-cleanup": ({"state": "failed", "write_started": 0, "cleanup_done": 0}, False),
        "failed-after-write": ({"state": "failed", "write_started": 1, "cleanup_done": 1}, False),
        "running": ({"state": "running", "write_started": 0, "cleanup_done": 1}, False),
        "completed": ({"state": "completed", "write_started": 0, "cleanup_done": 1}, False),
    }
    for operation_id, (values, _) in cases.items():
        _insert_job(jobs, operation_id, **values)
    for operation_id, (_, expected) in cases.items():
        snapshot = jobs._get(operation_id)
        assert snapshot["fallback_safe"] is expected, operation_id


def test_legacy_database_gains_write_markers_by_migration(tmp_path: Path) -> None:
    data_dir = tmp_path / "legacy"
    data_dir.mkdir()
    db_path = data_dir / "transfer-jobs.sqlite3"
    connection = sqlite3.connect(db_path)
    connection.execute("""CREATE TABLE jobs (
        operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL, bytes_done INTEGER NOT NULL DEFAULT 0,
        bytes_total INTEGER NOT NULL DEFAULT 0, files_done INTEGER NOT NULL DEFAULT 0,
        files_total INTEGER NOT NULL DEFAULT 0, rate INTEGER NOT NULL DEFAULT 0,
        rc_job_id INTEGER, rc_execute_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 1,
        error TEXT, updated_at REAL NOT NULL
    )""")
    connection.execute("INSERT INTO jobs(operation_id,payload_hash,payload,state,updated_at) "
                       "VALUES('old','hash','{}','failed',0)")
    connection.commit()
    connection.close()

    jobs = RcloneJobs(
        data_dir, target_id="target",
        resolver=lambda _network_id: {"host": "127.0.0.1", "port": 1080},
        read_guard=lambda *_args: None, write_guard=lambda *_args: None,
        binary=sys.executable,
    )
    with jobs._connect() as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
        row = db.execute("SELECT write_started,cleanup_done FROM jobs WHERE operation_id='old'").fetchone()
    assert {"write_started", "cleanup_done"} <= columns
    assert row["write_started"] == 0 and row["cleanup_done"] == 0

    snapshot = jobs._get("old")
    assert snapshot["write_started"] is False
    assert snapshot["fallback_safe"] is False


def test_transfer_info_advertises_directional_engines_without_dropping_legacy_fields(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    service = FsService(device="dev-a", workspace=workspace,
                        data_dir=tmp_path / "data", workspaces_root=workspace)

    def legacy_fields(report: dict[str, object]) -> None:
        assert report["engine"] == "croc"
        assert report["legacy"] is True
        assert report["default_engine"] == "rclone-sftpgo"
        assert report["available"] is False
        assert report["version"] == ""
        assert report["relay"] is False
        assert report["finish_by_transfer_id"] is True
        assert report["verify_sha256_before_finish"] is True
        assert report["device_id"] == "dev-a"

    info = service.dispatch("transfer_info", {})
    legacy_fields(info)
    engines = info["transfer_engines"]
    assert set(engines) == {"native_source", "native_target", "fallback_safe_marker"}
    assert isinstance(engines["native_source"], bool)
    assert isinstance(engines["native_target"], bool)
    assert engines["fallback_safe_marker"] is True

    # A bundled node reports both directions without losing any legacy field.
    service.sftpgo_grants.admin_url = ""
    service.sftpgo_grants.binary = Path(sys.executable)
    service.transfer_jobs._binary = sys.executable
    bundled = service.dispatch("transfer_info", {})
    legacy_fields(bundled)
    assert bundled["transfer_engines"]["native_source"] is True
    assert bundled["transfer_engines"]["native_target"] is True
    assert bundled["transfer_engines"]["fallback_safe_marker"] is True