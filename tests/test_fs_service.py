from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import pytest

from tether.node.fs_service import MAX_PREVIEW_TEXT, FsError, FsService


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    data = tmp_path / "data"
    workspace = tmp_path / "node-work"
    workspace.mkdir()
    root = tmp_path / "TetherWorkspaces"
    service = FsService(device="TEST", workspace=workspace, data_dir=data, workspaces_root=root)
    return {"home": home, "data": data, "workspace": workspace, "root": root, "svc": service}


def test_readonly_allows_project_root_and_denies_outside(env, tmp_path: Path) -> None:
    svc: FsService = env["svc"]
    svc.policy.update({"mode": "readonly"})
    svc.dispatch("mkdir", {"path": str(env["root"] / "demo")})
    written = svc.dispatch("write", {"path": str(env["root"] / "demo" / "a.txt"), "text": "hello"})
    assert written["bytes"] == 5
    assert svc.dispatch("read", {"path": str(env["root"] / "demo" / "a.txt")})["text"] == "hello"
    listing = svc.dispatch("list", {"path": str(env["root"] / "demo")})
    assert [entry["name"] for entry in listing["entries"]] == ["a.txt"]

    outside = tmp_path / "outside.txt"
    with pytest.raises(FsError) as caught:
        svc.dispatch("write", {"path": str(outside), "text": "no"})
    assert caught.value.code == "denied"
    assert not outside.exists()

    audit = svc.dispatch("audit_list", {"limit": 20})["entries"]
    assert any(row["phase"] == "intent" and row["result"] == "denied" for row in audit)
    assert any(row["phase"] == "result" and row["result"] == "ok" for row in audit)


def test_agents_runtime_surface_keeps_remote_url_empty_but_exposes_local_loopback(env) -> None:
    svc: FsService = env["svc"]
    svc.agents_runtime.port = 4200
    svc.agents_runtime.token = "private-token"
    result = svc._agents_runtime_surface({
        "running": True, "url": "http://127.0.0.1:4200/", "token": "private-token",
    })
    assert result["url"] == ""
    assert result["loopback_url"].startswith("http://127.0.0.1:4200/token.html?token=")
    assert "token" not in result


def test_agents_runtime_surface_uses_gateway_route(env) -> None:
    svc: FsService = env["svc"]
    svc.agents_runtime.port = 4200
    svc.agents_runtime.token = "private-token"

    class Gateway:
        @staticmethod
        def list(_args):
            return {"apps": [{"name": "Agents", "url": "https://node.example/agents"}]}

    svc.apps = Gateway()
    result = svc._agents_runtime_surface({
        "running": True, "url": "http://127.0.0.1:4200/", "token": "private-token",
    })
    assert result["url"].startswith("https://node.example/agents/token.html?token=")
    assert "token" not in result


def test_existing_dsh_workspace_is_writable_in_readonly(env) -> None:
    svc: FsService = env["svc"]
    svc.policy.update({"mode": "readonly"})
    home: Path = env["home"]
    dsh_dir = home / "dsh-project"
    dsh_dir.mkdir()
    registry = home / ".dsh" / "storages" / "workspace.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(json.dumps({
        "tables": {"workspaces": {"w1": {"path": str(dsh_dir), "title": "proj"}}}
    }), encoding="utf-8")

    svc: FsService = env["svc"]
    workspaces = svc.dispatch("workspaces", {})["workspaces"]
    project = next(item for item in workspaces if item["id"] == "w1")
    assert project["writable"] is True

    svc.dispatch("write", {"path": str(dsh_dir / "file.txt"), "text": "ok"})
    assert (dsh_dir / "file.txt").read_text(encoding="utf-8") == "ok"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows drive and system path policy")
def test_default_mode_makes_the_system_drive_read_only(env, monkeypatch: pytest.MonkeyPatch) -> None:
    svc: FsService = env["svc"]
    monkeypatch.setenv("SystemDrive", "C:")
    svc.policy.update({"mode": "default"})
    assert svc.policy.can_write(Path("C:/Users/Public/tether-policy.txt"), op="write")[0] is False
    assert svc.policy.can_write(Path("D:/tether-policy/ok.txt"), op="write")[0] is True
    assert svc.policy.can_write(Path("C:/Windows/tether-policy.txt"), op="write")[0] is False
    assert svc.policy.can_write(Path("C:/Windows/System32/tether-policy.txt"), op="write")[0] is False
    assert svc.policy.can_write(env["root"] / "allowed.txt", op="write")[0] is True


def test_custom_mode_allows_only_writable_roots(env) -> None:
    svc: FsService = env["svc"]
    svc.policy.update({"mode": "custom"})
    assert svc.policy.can_write(env["root"] / "allowed.txt", op="write")[0] is True
    outside = Path("D:/tether-policy/denied.txt") if sys.platform == "win32" else Path("/tether-policy-denied.txt")
    assert svc.policy.can_write(outside, op="write")[0] is False


def test_locked_mode_denies_all_writes(env) -> None:
    svc: FsService = env["svc"]
    svc.policy.update({"mode": "locked"})
    assert svc.policy.can_write(env["root"] / "allowed.txt", op="write")[0] is False
    outside = Path("D:/tether-policy/denied.txt") if sys.platform == "win32" else Path("/tether-policy-denied.txt")
    assert svc.policy.can_write(outside, op="write")[0] is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows drive and system path policy")
def test_full_mode_writes_outside_but_still_protects_system_and_credentials(env, tmp_path: Path) -> None:
    svc: FsService = env["svc"]
    svc.dispatch("policy_set", {"mode": "full"})
    outside = tmp_path / "outside.txt"
    svc.dispatch("write", {"path": str(outside), "text": "full"})
    assert outside.read_text(encoding="utf-8") == "full"

    assert svc.policy.can_write(Path("C:/Windows/tether-test.txt"), op="write")[0] is False
    assert svc.policy.can_write(Path("C:/Program Files/tether-test.txt"), op="write")[0] is False

    secret = env["home"] / ".dsh" / ".credentials.yaml"
    secret.parent.mkdir(parents=True, exist_ok=True)
    secret.write_text("key: secret", encoding="utf-8")
    with pytest.raises(FsError) as caught:
        svc.dispatch("read", {"path": str(secret)})
    assert caught.value.code == "denied"


@pytest.mark.skipif(sys.platform != "linux", reason="Linux filesystem policy")
@pytest.mark.parametrize("mode", ["locked", "readonly", "full"])
def test_linux_protected_roots_take_precedence_over_granted_roots(env, mode):
    svc = env["svc"]
    svc.policy.update({"mode": mode, "allowed_roots": ["/"]})
    for root in ("/", "/etc", "/boot", "/usr", "/bin", "/sbin", "/lib", "/lib64",
                 "/root", "/sys", "/proc", "/dev", "/run"):
        for path in (Path(root), Path(root) / "tether-test" if root != "/" else Path("/")):
            allowed, reason = svc.policy.can_write(path, op="write")
            assert not allowed and "protected system path" in reason, path


@pytest.mark.skipif(sys.platform != "linux", reason="Linux system directories and symlinks")
def test_linux_mutations_reject_protected_destinations_and_symlinks(env, tmp_path, monkeypatch):
    from tether.node import fs_service

    svc = env["svc"]
    protected = tmp_path / "system"
    protected.mkdir()
    target = protected / "config"
    target.write_bytes(b"original")
    workspace = env["workspace"]
    alias = workspace / "alias"
    alias.symlink_to(protected, target_is_directory=True)
    outside = workspace / "allowed"
    outside.write_bytes(b"source")
    part = target.with_name("config.tether-part.deadbeef")
    part.write_bytes(b"partial")
    monkeypatch.setattr(fs_service, "LINUX_SYSTEM_ROOTS", (str(protected),))
    svc.policy.update({"mode": "full"})
    for op, args in [
        ("write", {"path": str(alias / "config"), "text": "changed"}),
        ("mkdir", {"path": str(alias / "newdir")}),
        ("rename", {"path": str(alias / "config"), "dest": str(workspace / "moved")}),
        ("rename", {"path": str(outside), "dest": str(alias / "newfile")}),
        ("delete", {"path": str(alias / "config")}),
        ("copy", {"path": str(outside), "dest": str(alias / "newfile")}),
        ("write_chunk", {"path": str(target), "transfer_id": "deadbeef", "offset": 0,
                         "total": 1, "base64": "YQ==", "overwrite": True}),
        ("transfer_cancel", {"path": str(target), "transfer_id": "deadbeef"}),
    ]:
        with pytest.raises(FsError, match="protected system path"):
            svc.dispatch(op, args)
    upload = workspace / "upload"
    (workspace / "upload.tether-part.deadbeef").symlink_to(protected / "newfile")
    with pytest.raises(FsError, match="partial transfer"):
        svc.open_write_stream(str(upload), "deadbeef", 1, False)
    assert target.read_bytes() == b"original" and part.read_bytes() == b"partial"
    assert outside.read_bytes() == b"source"
    assert sorted(p.name for p in protected.iterdir()) == ["config", "config.tether-part.deadbeef"]


def test_chunked_transfer_resumes_and_finalizes_atomically(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "transfer"
    svc.dispatch("mkdir", {"path": str(folder)})
    target = folder / "big.bin"
    payload = b"a" * 1000 + b"b" * 1000
    transfer = "a1b2c3d4"

    first = svc.dispatch("write_chunk", {
        "path": str(target), "transfer_id": transfer, "offset": 0, "total": len(payload),
        "base64": base64.b64encode(payload[:1000]).decode(),
    })
    assert first["offset"] == 1000 and first["complete"] is False
    assert target.exists() is False
    status = svc.dispatch("transfer_status", {"path": str(target), "transfer_id": transfer})
    assert status["offset"] == 1000 and status["partial"] is True

    second = svc.dispatch("write_chunk", {
        "path": str(target), "transfer_id": transfer, "offset": 1000, "total": len(payload),
        "base64": base64.b64encode(payload[1000:]).decode(), "final": True,
    })
    assert second["complete"] is True and second["size"] == len(payload)
    assert target.read_bytes() == payload
    assert list(folder.glob("*.tether-part.*")) == []
    audit = svc.dispatch("audit_list", {"limit": 20})["entries"]
    assert any(row.get("op") == "transfer" and row.get("bytes") == len(payload) for row in audit)


def test_chunked_transfer_rejects_existing_conflicts_and_bad_offsets(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "transfer"
    svc.dispatch("mkdir", {"path": str(folder)})
    target = folder / "exists.bin"
    target.write_bytes(b"old")
    transfer = "deadbeef"

    with pytest.raises(FsError) as caught:
        svc.dispatch("write_chunk", {
            "path": str(target), "transfer_id": transfer, "offset": 0, "total": 3,
            "base64": base64.b64encode(b"new").decode(), "final": True,
        })
    assert caught.value.code == "exists"

    with pytest.raises(FsError) as caught:
        svc.dispatch("write_chunk", {
            "path": str(target), "transfer_id": transfer, "offset": 5, "total": 10,
            "base64": base64.b64encode(b"x").decode(),
        })
    assert caught.value.code == "offset_mismatch"

    cancelled = svc.dispatch("transfer_cancel", {"path": str(target), "transfer_id": transfer})
    assert cancelled["cancelled"] is True


def test_rclone_batch_rejects_a_source_fingerprint_mismatch_before_publishing(env, tmp_path: Path,
                                                                             monkeypatch: pytest.MonkeyPatch) -> None:
    svc: FsService = env["svc"]
    jobs = svc.transfer_jobs
    operation_id = "fingerprint-mismatch"
    destination_root = env["root"] / "batch-destination"
    destination_root.mkdir()
    files = {"first.bin": b"authorized", "second.bin": b"tampered!"}
    authorized = {"first.bin": b"authorized", "second.bin": b"expected!"}
    state = {"state": "queued", "files_total": 0}
    checked: list[str] = []

    def await_job(_op: str, path: str, body: dict, *_args) -> dict:
        checked.append(path)
        if path == "sync/copy":
            stage_root = Path(body["dstFs"])
            for name, content in files.items():
                target = stage_root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
        return {"success": True}

    monkeypatch.setattr(jobs, "_get", lambda _operation_id: state)
    monkeypatch.setattr(jobs, "_update", lambda _operation_id, **values: state.update(values))
    monkeypatch.setattr(jobs, "_write_rclone_config", lambda *_args: tmp_path / "rclone.conf")
    monkeypatch.setattr(jobs, "_start_rc", lambda op, _config: jobs._rc.setdefault(op, {}))
    monkeypatch.setattr(jobs, "_rc_call", lambda _op, path, _body: {
        "count": len(files), "bytes": sum(len(content) for content in authorized.values())
    } if path == "operations/size" else {})
    monkeypatch.setattr(jobs, "_await_rc_job", await_job)
    monkeypatch.setattr(jobs, "_stop_rc", lambda _op: None)
    monkeypatch.setattr(jobs, "_cleanup_credentials", lambda _op: None)

    jobs._run(operation_id, [
        (name, destination_root / name, "file", "") for name in files
    ], "copy", sum(len(content) for content in authorized.values()), "/source", destination_root,
       {"remote_root": "/"}, tmp_path / "id_ed25519", "fail", {
           name: hashlib.sha256(content).hexdigest() for name, content in authorized.items()
       })

    assert state["state"] == "failed"
    assert json.loads(state["error"])["code"] == "verification_failed"
    assert not (destination_root / "first.bin").exists()
    assert not (destination_root / "second.bin").exists()
    assert "operations/check" not in checked


@pytest.mark.parametrize("valid_digest, cancel_during_close", [(True, False), (False, False), (True, True)])
def test_full_ranges_verify_after_reader_teardown(env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                 valid_digest: bool, cancel_during_close: bool) -> None:
    import subprocess
    import sys

    jobs = env["svc"].transfer_jobs
    destination = env["root"] / "received"
    destination.mkdir()
    target = destination / "file[1].bin"
    size = 32 * 1024**2
    digest = hashlib.sha256(b"x" * size).hexdigest() if valid_digest else "0" * 64
    state = {"state": "queued", "files_total": 0}
    monkeypatch.setattr(jobs, "_get", lambda _op: state)
    monkeypatch.setattr(jobs, "_update", lambda _op, **fields: state.update(fields))
    monkeypatch.setattr(jobs, "_write_rclone_config", lambda *_: tmp_path / "rclone.conf")
    monkeypatch.setattr(jobs, "_start_rc", lambda *_: None)
    replies = {
        "options/get": {"main": {"MultiThreadCutoff": size, "MultiThreadStreams": 2}},
        "operations/stat": {"item": {"Size": size, "IsDir": False, "ModTime": "2026-01-01T00:00:00Z"}},
    }
    stat_requests = []

    def rc(_op, path, body):
        if path == "operations/stat":
            stat_requests.append(body)
        return replies[path]

    monkeypatch.setattr(jobs, "_rc_call", rc)
    popen = subprocess.Popen
    readers = []

    def launch(cmd, **kwargs):
        tail = "sys.exit(9)" if not readers else "time.sleep(5)"
        # Both processes deliver their exact count. One exits with an error, the
        # other keeps its stdout handle open after the last write.
        script = f"import sys,time; sys.stdout.buffer.write(b'x' * {size // 2}); sys.stdout.flush(); {tail}"
        reader = popen([sys.executable, "-c", script], **kwargs)
        readers.append(reader)
        if len(readers) == 2 and cancel_during_close:
            kill = reader.kill

            def cancel_and_kill():
                state["state"] = "cancelling"
                kill()

            monkeypatch.setattr(reader, "kill", cancel_and_kill)
        return reader

    monkeypatch.setattr(subprocess, "Popen", launch)
    grant_stat = (size, 1_770_000_000_000_000_000) if valid_digest else None
    jobs._run("reader-teardown", [(target.name, target, "file", "")], "copy", 0, "/source",
              destination, {}, tmp_path / "key", "fail", {target.name: digest}, grant_stat)
    assert stat_requests == ([] if grant_stat else [{"fs": "transfer:", "remote": target.name}])
    assert len(readers) == 2 and all(reader.returncode is not None for reader in readers)
    assert readers[1].returncode != 0
    if cancel_during_close:
        assert state["state"] == "cancelled"
        assert not target.exists()
    elif valid_digest:
        assert state["state"] == "completed"
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
        assert target.stat().st_mtime_ns == grant_stat[1]
    else:
        assert state["state"] == "failed"
        assert json.loads(state["error"])["code"] == "verification_failed"
        assert not target.exists()


@pytest.fixture
def rclone_sftp_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import os
    import shutil
    import socket
    import subprocess
    import time

    binary = os.environ.get("TETHER_RCLONE") or shutil.which("rclone")
    if not binary:
        pytest.skip("requires the official rclone binary")
    source = tmp_path / "source"
    source.mkdir()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    config = tmp_path / "rclone.conf"
    password = subprocess.check_output([binary, "obscure", "test-only"], text=True).strip()
    config.write_text(f"[transfer]\ntype = sftp\nhost = 127.0.0.1\nport = {port}\n"
                      f"user = fixture\npass = {password}\nshell_type = none\n", encoding="utf-8")
    # Keep the interruptions observable and let the target, rather than the source
    # process, manage reconnects during this test.
    monkeypatch.setenv("RCLONE_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RCLONE_BUFFER_SIZE", "0")
    monkeypatch.setenv("RCLONE_BWLIMIT", "1Mi")
    monkeypatch.setenv("RCLONE_LOW_LEVEL_RETRIES", "1")
    popen = subprocess.Popen

    def serve():
        server = popen([binary, "--config", str(config), "serve", "sftp", str(source),
                        "--addr", f"127.0.0.1:{port}", "--user", "fixture", "--pass", "test-only",
                        "--bwlimit", "off"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    return server
            except OSError:
                time.sleep(0.05)
        server.kill()
        server.wait()
        pytest.fail("isolated SFTP fixture did not start")

    return binary, source, config, serve


def test_exact_stat_retries_refused_sftp_after_startup(env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                    rclone_sftp_source) -> None:
    from urllib.error import HTTPError
    from tether.node import transfer_jobs

    binary, source, config, serve = rclone_sftp_source
    name = "literal[1].txt"
    (source / name).write_bytes(b"authorized")
    op = "cold-sftp"
    jobs = env["svc"].transfer_jobs
    jobs._binary = binary
    (jobs._grant_dir / op).mkdir()
    monkeypatch.setattr(jobs, "_get", lambda _op: {"state": "running"})
    jobs._start_rc(op, config)
    urlopen = transfer_jobs.urlopen
    server = None
    calls = []

    def open_when_ready(request, **kwargs):
        nonlocal server
        if request.full_url.endswith("/operations/stat"):
            calls.append(json.loads(request.data))
        try:
            return urlopen(request, **kwargs)
        except HTTPError:
            # The first real SFTP dial reaches a closed port. Bring the same
            # source online before the retry, under the original RC operation.
            if server is None:
                server = serve()
            raise

    monkeypatch.setattr(transfer_jobs, "urlopen", open_when_ready)
    try:
        assert jobs._stat_source_file(op, name)["Size"] == 10
        assert calls == [{"fs": "transfer:", "remote": name}] * 2
        assert jobs._stat_source_file(op, "missing") is None
        assert len(calls) == 3
    finally:
        jobs._stop_rc(op)
        if server:
            server.kill()
            server.wait()


@pytest.mark.parametrize("status,detail,expected", [
    (500, "NewFs: couldn't connect SSH: ssh: unable to authenticate", "rclone_rc_error"),
    (500, "knownhosts: key mismatch for host connection refused", "rclone_rc_error"),
    (500, "stat /private/connection reset: permission denied", "rclone_rc_error"),
    (500, "unclassified failure", "rclone_rc_error"),
    (403, "connection refused", "rclone_rc_error"),
    (500, "read tcp private.example: read: connection reset by peer", "source_connection_failed"),
])
def test_single_file_stat_retries_only_identified_transport_failures(env, monkeypatch: pytest.MonkeyPatch,
                                                                   status, detail, expected) -> None:
    import io
    from urllib.error import HTTPError
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    op = "stat-classification"
    monkeypatch.setitem(jobs._rc, op, {"url": "http://127.0.0.1:1/", "username": "u", "password": "p"})
    monkeypatch.setattr(jobs, "_get", lambda _op: {"state": "running"})
    sleeps = []
    monkeypatch.setattr(transfer_jobs.time, "sleep", sleeps.append)

    def fail(request, **kwargs):
        body = json.dumps({"error": detail, "input": {"secret": "private-value"}}).encode()
        raise HTTPError(request.full_url, status, "test", {}, io.BytesIO(body))

    monkeypatch.setattr(transfer_jobs, "urlopen", fail)
    with pytest.raises(transfer_jobs.TransferJobError) as error:
        jobs._stat_source_file(op, "file")
    assert error.value.code == expected
    assert sleeps == ([1, 3] if expected == "source_connection_failed" else [])
    assert detail not in str(error.value) and "private-value" not in str(error.value)


def test_local_rc_timeout_does_not_repeat_an_inflight_source_stat(env, monkeypatch: pytest.MonkeyPatch) -> None:
    from urllib.error import URLError
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    op = "slow-local-rc"
    monkeypatch.setitem(jobs._rc, op, {"url": "http://127.0.0.1:1/", "username": "u", "password": "p"})
    monkeypatch.setattr(jobs, "_get", lambda _op: {"state": "authorizing"})
    waits = []

    def timeout(request, *, timeout):
        waits.append(timeout)
        raise URLError(TimeoutError("test private source"))

    monkeypatch.setattr(transfer_jobs, "urlopen", timeout)
    with pytest.raises(transfer_jobs.TransferJobError) as error:
        jobs._stat_source_file(op, "file")
    assert error.value.code == "rclone_stat_wait_timeout"
    assert "private source" not in str(error.value)
    with pytest.raises(transfer_jobs.TransferJobError) as error:
        jobs._rc_call(op, "job/status", {})
    assert error.value.code == "rclone_rc_error"
    assert waits == [65, 10]


@pytest.mark.parametrize("writes, completes", [
    pytest.param((2, 0, 0, 3, 0, 4, 5, 146), True, id="resume-partial-readers"),
    pytest.param((4, 0, 0, 0), False, id="three-empty-readers"),
])
def test_range_reader_retry_budget(env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, writes, completes):
    from types import SimpleNamespace
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    with jobs._connect() as db:
        db.execute("INSERT INTO jobs(operation_id,payload_hash,payload,state,updated_at) "
                   "VALUES('retry-budget','','{}','running',0)")
    payload = bytes(range(160)) * 2
    stage = tmp_path / "stage"
    launches = []
    now = 0.0

    def sleep(seconds):
        nonlocal now
        now += seconds
        assert now < 45, "range copy did not terminate"

    class Reader:
        def __init__(self, cmd, *, stdout, **kwargs):
            offset = int(cmd[cmd.index("--offset") + 1])
            count = int(cmd[cmd.index("--count") + 1])
            assert stdout.tell() == offset
            self.output = stdout
            if offset == 0:
                assert count == 160
                self.end, self.step = 160, 1  # This independent range keeps making progress.
            else:
                i = len(launches)
                assert i < len(writes), "unexpected extra range reader"
                assert (offset, count) == (160 + sum(writes[:i]), 160 - sum(writes[:i]))
                launches.append(now)
                self.end, self.step = offset + writes[i], count

        def poll(self):
            pos = self.output.tell()
            self.output.write(payload[pos:min(pos + self.step, self.end)])
            return None if self.output.tell() < self.end else 1

        def kill(self):
            self.end = self.output.tell()

        def wait(self):
            return 1

    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Reader)
    monkeypatch.setattr(transfer_jobs, "time", SimpleNamespace(monotonic=lambda: now, sleep=sleep,
                                                              time=transfer_jobs.time.time))
    args = ("retry-budget", tmp_path / "unused.conf", "transfer:file", stage, len(payload), 2)
    if completes:
        jobs._copy_file_ranges(*args)
        actual = stage.read_bytes()
        assert actual == payload
        assert hashlib.sha256(actual).digest() == hashlib.sha256(payload).digest()
    else:
        with pytest.raises(transfer_jobs.TransferJobError) as error:
            jobs._copy_file_ranges(*args)
        assert error.value.code == "rclone_failed" and error.value.retryable
        assert stage.read_bytes()[160:] == payload[160:164] + bytes(156)
    assert len(launches) == len(writes)
    # After the first and second empty exits, wait 2 and 10 seconds (plus polling).
    for i, written in enumerate(writes[:-1]):
        if written == 0:
            delay = 10 if i and writes[i - 1] == 0 else 2
            assert delay <= launches[i + 1] - launches[i] < delay + 0.3


def test_sftp_relay_must_match_current_hub_transfer_authority(monkeypatch):
    from tether.node import transfer_jobs

    monkeypatch.setattr(transfer_jobs.time, "time", lambda: 100)
    direction = {"network_id": "another-mesh", "source_device_id": "new-workstation",
                 "executor_device_id": "new-laptop"}
    source = {"host": "10.223.30.45", "port": 20222}
    hint = {**direction, "source_host": source["host"], "host": "10.223.30.9", "port": 52057, "expires_at": 101}
    choose = transfer_jobs._authorized_sftp_relay

    assert choose(direction, source) is None
    assert choose({**direction, "sftp_relay": hint}, source) == ("10.223.30.9", 52057, 101)
    for fields in ({"expires_at": 100}, {"network_id": "other-mesh"}, {"host": "127.0.0.1"},
                   {"host": "8.8.8.8"}, {"port": 0}, {"source_host": "10.223.30.46"},
                   {"source_device_id": "interloper"}, {"executor_device_id": "someone-else"}):
        assert choose({**direction, "sftp_relay": {**hint, **fields}}, source) is None
    reverse = {**direction, "source_device_id": direction["executor_device_id"],
               "executor_device_id": direction["source_device_id"], "sftp_relay": hint}
    assert choose(reverse, {**source, "host": "10.223.30.46"}) is None
    assert choose({**direction, "sftp_relay": hint}, {**source, "port": 2222}) is None


def test_sftp_relay_requires_private_fixed_binding_and_exact_authority(env, monkeypatch):
    from tether.node import transfer_jobs

    monkeypatch.setattr(transfer_jobs.time, "time", lambda: 100)
    service = env["svc"].transfer_jobs
    private = service._grant_dir / "relay-adapter"
    private.mkdir()
    path = private / "binding.json"
    authority = {"network_id": "new-mesh", "source_device_id": "generated-source", "executor_device_id": "generated-receiver"}
    source = {"host": "10.223.30.45", "port": 20222, "host_key_fingerprint": "SHA256:original-source-key"}
    hint = {**authority, "source_host": source["host"], "host": "10.223.30.9", "port": 20223, "expires_at": 120}
    binding = {**hint, "expires_at": 140, "local_host": "127.0.0.1", "local_port": 52131,
               "source_host_key_fingerprint": source["host_key_fingerprint"]}
    route = service._relay_adapter_route

    assert route({**authority, "sftp_relay": hint}, source) is None
    path.write_text(json.dumps(binding), encoding="utf-8")
    monkeypatch.setattr(transfer_jobs, "_private_relay_binding", lambda p: False)
    assert route({**authority, "sftp_relay": hint}, source) is None
    monkeypatch.setattr(transfer_jobs, "_private_relay_binding", lambda p: True)
    assert route({**authority, "sftp_relay": hint}, source) == ("127.0.0.1", 52131, 120)
    assert route(authority, source) is None

    opted_in = {**binding, "local_validation": True}
    path.write_text(json.dumps(opted_in), encoding="utf-8")
    assert route(authority, source) == ("127.0.0.1", 52131, 140)
    assert route({**authority, "sftp_relay": {**hint, "expires_at": 145}}, source) == ("127.0.0.1", 52131, 140)
    assert route({**authority, "sftp_relay": {**hint, "host": "10.223.30.19"}}, source) is None
    assert route({**authority, "sftp_relay": {**hint, "expires_at": 99}}, source) is None
    assert route({**authority, "sftp_relay": None}, source) is None
    assert route({**authority, "executor_device_id": "someone-else"}, source) is None
    assert route(authority, {**source, "host_key_fingerprint": "SHA256:wrong-key"}) is None
    for changed in ({"local_host": "localhost"}, {"local_host": "127.0.0.2"}, {"local_port": 22}, {"expires_at": 99}):
        path.write_text(json.dumps({**opted_in, **changed}), encoding="utf-8")
        assert route(authority, source) is None


def test_sftp_relay_config_pins_original_source_key(env, monkeypatch):
    service = env["svc"].transfer_jobs
    operation = "relay-config"
    directory = service._grant_dir / operation
    directory.mkdir()
    source_public_key = b"original host identity"
    key = base64.b64encode(source_public_key).decode()
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(source_public_key).digest()).decode().rstrip("=")
    endpoint = {"host": "10.223.30.45", "port": 20222, "username": "test",
                "network_id": "test-mesh", "host_key": f"ssh-ed25519 {key}",
                "host_key_fingerprint": fingerprint}
    monkeypatch.setattr(service, "socks_proxy_resolver", lambda network: {"host": "127.0.0.1", "port": 53000})
    grant_key = directory / "id_ed25519"
    direct = service._write_rclone_config(operation, endpoint, grant_key)
    relay = service._write_rclone_config(operation, {**endpoint, "host": "127.0.0.1", "port": 52131},
                                         grant_key, relay=True)
    assert direct != relay
    assert f"[{endpoint['host']}]:20222 ssh-ed25519 {key}" in (directory / "known_hosts").read_text(encoding="utf-8")
    assert f"[127.0.0.1]:52131 ssh-ed25519 {key}" in (directory / "known_hosts-relay").read_text(encoding="utf-8")
    relay_config = relay.read_text(encoding="utf-8")
    assert "socks_proxy = 127.0.0.1:53000" in direct.read_text(encoding="utf-8")
    assert "host = 127.0.0.1\n" in relay_config and "port = 52131\n" in relay_config
    assert "socks_proxy = \n" in relay_config
    assert f"key_file = {grant_key}" in relay_config


@pytest.mark.parametrize("direct,relay,winner", [((0, 2, 0), (0.1, 131072, 0), True),
                                                ((1, 131072, 0), (0, 131072, 1), False),
                                                ((0, 131072, 0), (1, 131072, 0), False),
                                                ((50, 0, 0), (50, 0, 0), False)])
def test_sftp_relay_probe_requires_full_bytes_and_reaps_loser(env, monkeypatch, direct, relay, winner):
    from types import SimpleNamespace
    from tether.node import transfer_jobs

    now = 0.0
    children = []
    service = env["svc"].transfer_jobs
    monkeypatch.setattr(service, "_get", lambda op: {"state": "running"})

    class Probe:
        def __init__(self, cmd, *, stdout, **kwargs):
            self.out = stdout
            self.ready, self.size, self.exit = relay if cmd[2].endswith("relay.conf") else direct
            self.status = None
            self.reaped = False
            children.append(self)
            assert ("--sftp-socks-proxy=" in cmd) == cmd[2].endswith("relay.conf")
            assert cmd[cmd.index("--count") + 1] == str(transfer_jobs.RECEIVE_PROBE_BYTES)
            assert cmd[cmd.index("--offset") + 1] == "0"

        def poll(self):
            if self.status is None and now >= self.ready:
                self.out.write(b"x" * self.size)
                self.status = self.exit
            return self.status

        def kill(self):
            self.status = -9

        def wait(self):
            self.reaped = True
            return self.status

    def sleep(delay):
        nonlocal now
        now += delay

    monkeypatch.setattr(transfer_jobs, "time", SimpleNamespace(monotonic=lambda: now, time=lambda: 100+now, sleep=sleep))
    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Probe)
    direct_route = transfer_jobs.ReceiveRoute(env["data"] / "direct.conf")
    relay_route = transfer_jobs.ReceiveRoute(env["data"] / "relay.conf", 150)
    routes = service._probe_receive_routes("test", [direct_route, relay_route], "transfer:authorized.bin")
    routes = routes or [direct_route]
    assert routes[0] == (relay_route if winner else direct_route)
    assert now <= transfer_jobs.RECEIVE_PROBE_SECONDS + 0.05
    assert len(children) == 2 and all(child.reaped and child.status is not None for child in children)


@pytest.mark.parametrize("expires_at", [101, 200])
@pytest.mark.parametrize("backup_outcome", ["complete", "empty_exit", "trickle"])
def test_sftp_relay_falls_back_without_redownloading_completed_offsets(env, monkeypatch, expires_at, backup_outcome):
    from types import SimpleNamespace
    from tether.node import transfer_jobs

    service = env["svc"].transfer_jobs
    payload = b"a" * 4096 + b"b" * 4096
    stage = env["root"] / "range-stage"
    stage.parent.mkdir(parents=True, exist_ok=True)
    direct, relay = env["data"] / "direct.conf", env["data"] / "relay.conf"
    backup = env["data"] / "backup.conf"
    launched = []
    now = 0.0

    class Range:
        def __init__(self, cmd, *, stdout, **kwargs):
            config = Path(cmd[2])
            assert ("--sftp-socks-proxy=" in cmd) == (config != direct)
            offset = int(cmd[cmd.index("--offset") + 1])
            count = int(cmd[cmd.index("--count") + 1])
            self.status = None if config == relay else 0
            launched.append((config, offset, count))
            written = 1024 if config == relay else count
            self.trickle = config == backup and backup_outcome == "trickle"
            if config == backup and backup_outcome != "complete":
                written = 0
                self.status = None if self.trickle else 1
            self.data = payload[offset:offset + count]
            self.stdout = stdout
            self.position = 0
            stdout.write(self.data[:written])

        def poll(self):
            if self.status is None and self.trickle and self.position < len(self.data):
                self.stdout.write(self.data[self.position:self.position + 1])
                self.position += 1
            return self.status

        def kill(self):
            self.status = -9

        def wait(self):
            return self.status

    def sleep(delay):
        nonlocal now
        now += delay

    monkeypatch.setattr(service, "_get", lambda op: {"state": "running"})
    monkeypatch.setattr(service, "_update", lambda *a, **k: None)
    monkeypatch.setattr(transfer_jobs, "time", SimpleNamespace(monotonic=lambda: now, time=lambda: 100+now, sleep=sleep))
    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Range)
    routes = (entry for entry in [
        (transfer_jobs.ReceiveRoute(relay, expires_at), True),
        (transfer_jobs.ReceiveRoute(backup, 240), True), (transfer_jobs.ReceiveRoute(direct), False),
    ])
    service._copy_file_ranges("test", direct, "transfer:authorized.bin", stage, len(payload), 2,
                              route_factory=lambda _: routes)
    assert launched[:4] == [(relay, 0, 4096), (relay, 4096, 4096), (backup, 1024, 3072), (backup, 5120, 3072)]
    direct_reads = [(offset, count) for config, offset, count in launched if config == direct]
    if backup_outcome == "complete":
        assert direct_reads == []
    elif backup_outcome == "empty_exit":
        assert direct_reads == [(1024, 3072), (5120, 3072)]
    else:
        first, second = direct_reads
        assert 1024 < first[0] < 4096 and 5120 < second[0] < 8192
        assert first[0] + first[1] == 4096 and second[0] + second[1] == 8192
    assert hashlib.sha256(stage.read_bytes()).hexdigest() == hashlib.sha256(payload).hexdigest()


@pytest.mark.parametrize("outcome", ["direct", "relay", "bad_digest"])
def test_small_file_uses_approved_relay_only_after_direct_copy_fails(env, monkeypatch, outcome):
    from contextlib import contextmanager
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    operation_id = "small-file-relay"
    directory = jobs._grant_dir / operation_id
    directory.mkdir()
    target = env["root"] / "small.bin"
    payload = b"authorized small file"
    digest = hashlib.sha256(payload).hexdigest()
    host_key = b"source identity"
    pin = "SHA256:" + base64.b64encode(hashlib.sha256(host_key).digest()).decode().rstrip("=")
    endpoint = dict(host="10.224.1.2", port=20222, username="test", network_id="mesh",
                    host_key="ssh-ed25519 " + base64.b64encode(host_key).decode(), host_key_fingerprint=pin)
    state = {"state": "queued", "files_total": 0}
    bridges, attempts = [], []
    active_bridges, active_readers = set(), set()
    peak = {"bridges": 0, "readers": 0}

    @contextmanager
    def bridge(_data, _proxy, host, *_args):
        relay_index = int(host.rsplit(".", 1)[1])
        bridges.append(relay_index)
        active_bridges.add(relay_index)
        peak["bridges"] = max(peak["bridges"], len(active_bridges))
        try:
            yield 52030 + relay_index
        finally:
            active_bridges.remove(relay_index)

    def direct_copy(_op, _method, body, *_args):
        staging = Path(body["dstFs"]) / target.name
        staging.write_bytes(payload if outcome == "direct" else payload[:3])
        if outcome != "direct":
            raise transfer_jobs.TransferJobError("rclone_failed", "direct SFTP refused", True)

    class Reader:
        def __init__(self, cmd, *, stdout, **_kwargs):
            assert "--sftp-socks-proxy=" in cmd
            config = Path(cmd[2]).read_text(encoding="utf-8")
            port = int(next(line.split(" = ")[1] for line in config.splitlines() if line.startswith("port = ")))
            relay_index = port - 52030
            attempts.append(relay_index)
            active_readers.add(self)
            peak["readers"] = max(peak["readers"], len(active_readers))
            assert cmd[cmd.index("--count") + 1] == str(len(payload))
            assert cmd[cmd.index("--offset") + 1] == "0"
            if relay_index == 9:
                stdout.write(payload if outcome == "relay" else b"x" * len(payload))
            self.exit = 0 if relay_index == 9 else 1

        def poll(self):
            return self.exit

        def wait(self):
            active_readers.remove(self)
            return self.exit

    monkeypatch.setattr(jobs, "_get", lambda _op: state)
    monkeypatch.setattr(jobs, "_update", lambda _op, **values: state.update(values))
    monkeypatch.setattr(jobs, "_await_rc_job", direct_copy)
    monkeypatch.setattr(jobs, "_start_rc", lambda *_args: None)
    monkeypatch.setattr(jobs, "_socks_proxy", lambda _network: ("127.0.0.1", 53000))
    monkeypatch.setattr(transfer_jobs, "local_sftp_relay", bridge)
    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Reader)
    jobs._run(operation_id, [(target.name, target, "file", "")], "copy", 0, "/source", env["root"],
              endpoint, directory / "operation-key", "fail", {target.name: digest},
              (len(payload), 1_770_000_000_000_000_000),
              [(f"10.224.2.{i}", 20223, 9_999_999_999, "pin") for i in range(1, 10)])

    if outcome == "direct":
        assert attempts == bridges == []
    else:
        assert attempts == [*range(1, 10), 9]
        assert bridges == list(range(1, 10))
        assert peak == {"bridges": 2, "readers": 2}
        assert active_bridges == active_readers == set()
    if outcome == "bad_digest":
        assert state["state"] == "failed"
        assert json.loads(state["error"])["code"] == "verification_failed"
        assert not target.exists()
    else:
        assert state["state"] == "completed" and target.read_bytes() == payload


@pytest.mark.parametrize("faster", [True, False])
def test_slow_running_copy_compares_late_candidate_and_restarts_at_written_offset(env, monkeypatch, faster):
    from types import SimpleNamespace
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    direct = env["data"] / "direct.conf"
    stage = env["data"] / "slow-copy.part"
    payload = bytes(range(256)) * 8
    now = 0.0
    opened, sampled, reads, compared, readers = [], [], [], [], []

    def prepare(_job, _endpoint, _key, _directory, offers, _resources):
        opened.extend(offer[0] for offer in offers)
        return [transfer_jobs.ReceiveRoute(env["data"] / (offer[0] + ".conf"), 200) for offer in offers]

    def probe(_job, choices, _remote, **kwargs):
        sampled.append([choice.config.name for choice in choices])
        return [choices[0]]

    def compare(_job, candidate, _remote, request):
        assert len(readers) == 4 and all(reader.status is None for reader in readers)
        assert request.progress()[1] == 4
        assert 512 <= request.offset < request.offset + request.count == len(payload)
        compared.append(candidate.config.name)
        return faster

    class Reader:
        def __init__(self, cmd, *, stdout, **_kwargs):
            offset = int(cmd[cmd.index("--offset") + 1])
            count = int(cmd[cmd.index("--count") + 1])
            reads.append((Path(cmd[2]).name, offset, count))
            self.status = None
            self.data = payload[offset:offset + count]
            self.position = 0
            self.stdout = stdout
            readers.append(self)
            if compared:
                stdout.write(self.data)
                self.status = 0

        def poll(self):
            if self.status is None and self.position < len(self.data):
                if compared and not faster:
                    self.stdout.write(self.data[self.position:])
                    self.position = len(self.data)
                    self.status = 0
                else:
                    self.stdout.write(self.data[self.position:self.position + 8])
                    self.position += 8
            return self.status

        def kill(self):
            self.status = -9

        def wait(self):
            return self.status

    def sleep(delay):
        nonlocal now
        now += delay

    monkeypatch.setattr(jobs, "_get", lambda _op: {"state": "running"})
    monkeypatch.setattr(jobs, "_update", lambda *_a, **_kw: None)
    monkeypatch.setattr(jobs, "_prepare_receive_relays", prepare)
    monkeypatch.setattr(jobs, "_probe_receive_routes", probe)
    monkeypatch.setattr(jobs, "_compare_receive_route", compare)
    monkeypatch.setattr(transfer_jobs, "RECEIVE_PROBE_BYTES", 64)
    monkeypatch.setattr(transfer_jobs, "time", SimpleNamespace(monotonic=lambda: now, time=lambda: 100 + now, sleep=sleep))
    monkeypatch.setattr(transfer_jobs, "RECEIVE_SLOW_WINDOW_SECONDS", 0.2)
    monkeypatch.setattr(transfer_jobs, "RECEIVE_SLOW_MIN_REMAINING", 256)
    monkeypatch.setattr(transfer_jobs, "RECEIVE_SLOW_MIN_SECONDS_LEFT", 1)
    monkeypatch.setattr(transfer_jobs, "RECEIVE_MULTI_MIN_BYTES", 512)
    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Reader)
    offers = [(name, 20223, 200, "pin") for name in ["first", "second", "late", "unused"]]
    def plan(_rank_first):
        return jobs._receive_route_plan("test", {}, direct, direct, offers, "transfer:file", 128, None)

    jobs._copy_file_ranges("test", direct, "transfer:file", stage, len(payload), 4, route_factory=plan)

    assert opened == ["first", "second", "late"]
    assert sampled == [["direct.conf", "first.conf", "second.conf"]]
    assert compared == ["late.conf"]
    assert reads[:4] == [("direct.conf", i * 512, 512) for i in range(4)]
    if faster:
        for (config, offset, count), limit in zip(reads[4:], (512, 1024, 1536, 2048), strict=True):
            assert config == "late.conf"
            assert limit - 512 < offset < limit and offset + count == limit
        assert all(reader.status == -9 for reader in readers[:4])
    else:
        assert len(reads) == 4 and all(reader.status == 0 for reader in readers)
    assert stage.read_bytes() == payload


def test_large_file_start_keeps_late_winning_reader_and_all_partial_ranges(env, monkeypatch):
    from types import SimpleNamespace
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    direct = env["data"] / "direct.conf"
    relay = env["data"] / "relay.conf"
    stage = env["data"] / "stage-late"
    payload = bytes(range(256)) * 8
    now = 0.0
    readers = []

    class Reader:
        def __init__(self, cmd, *, stdout, **_kwargs):
            self.route = Path(cmd[2])
            self.offset = int(cmd[cmd.index("--offset") + 1])
            self.count = int(cmd[cmd.index("--count") + 1])
            self.data = payload[self.offset:self.offset + self.count]
            self.output = stdout
            self.position = 0
            self.exit = None
            self.started = now
            self.killed = None
            self.pilot = len(readers) < 2
            readers.append(self)
            assert "--sftp-concurrency" not in cmd and "--buffer-size" not in cmd

        def poll(self):
            if self.exit is not None:
                return self.exit
            first_at = 8.8 if self.route == direct else 8.4
            if self.pilot and now < self.started + first_at:
                return None
            remaining = len(self.data) - self.position
            amount = min(remaining, 1 if self.route == direct else 8) if len(readers) <= 2 else remaining
            self.output.write(self.data[self.position:self.position + amount])
            self.position += amount
            if self.position == len(self.data):
                self.exit = 0
            return self.exit

        def kill(self):
            self.killed = now
            self.exit = -9

        def wait(self):
            return self.exit

    def sleep(delay):
        nonlocal now
        now += delay

    def prepare(*_):
        return [transfer_jobs.ReceiveRoute(relay, 200)]

    def plan(rank_first):
        return jobs._receive_route_plan(
            "test", {}, direct, direct, [("provider", 20223, 200, "pin")], "transfer:file",
            128, None, rank_first=rank_first)

    monkeypatch.setattr(jobs, "_get", lambda _op: {"state": "running"})
    monkeypatch.setattr(jobs, "_update", lambda *_a, **_kw: None)
    monkeypatch.setattr(jobs, "_prepare_receive_relays", prepare)
    monkeypatch.setattr(transfer_jobs, "time", SimpleNamespace(
        monotonic=lambda: now, time=lambda: 100 + now, sleep=sleep))
    monkeypatch.setattr(transfer_jobs, "RECEIVE_PROBE_BYTES", 128)
    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Reader)
    jobs._copy_file_ranges("test", direct, "transfer:file", stage, len(payload), 4, route_factory=plan)

    first, winner, resumed, *remaining = readers
    assert first.started == winner.started == 0
    assert first.route == direct and first.offset == 0 and first.killed > 8
    assert winner.route == relay and winner.offset == 512 and winner.killed is None and winner.exit == 0
    assert resumed.route == relay and 0 < resumed.offset < 512 and resumed.offset + resumed.count == 512
    assert [(reader.route, reader.offset) for reader in remaining] == [(relay, 1024), (relay, 1536)]
    assert stage.read_bytes() == payload


def test_receive_relays_validate_every_offer_and_accept_old_single_offer(env, monkeypatch):
    from tether.node import transfer_jobs

    service = env["svc"].transfer_jobs
    monkeypatch.setattr(transfer_jobs.time, "time", lambda: 100)
    scope = dict(network_id="mesh", source_device_id="source", executor_device_id="receiver")
    offer = dict(scope, adapter="mtls_sftp", host="10.223.30.9", source_host="10.223.30.2",
                 port=20223, expires_at=200, server_cert_pem="example-pin")
    endpoint = {"host": offer["source_host"], "port": 20222}
    second = {**offer, "host": "10.223.30.10"}
    assert service._receive_relays({**scope, "sftp_relay": offer}, endpoint) == [
        ("10.223.30.9", 20223, 200, "example-pin")]
    alternatives = [offer, {**second, "network_id": "other"}, {**second, "expires_at": 99},
                    second, second, {**second, "host": "203.0.113.1", "executor_device_id": "other"}]
    assert service._receive_relays({**scope, "sftp_relay": offer, "sftp_relays": alternatives}, endpoint) == [
        ("10.223.30.9", 20223, 200, "example-pin"), ("10.223.30.10", 20223, 200, "example-pin")]


@pytest.mark.parametrize("link", ["recovered", "flat", "first-flat", "other-flat", "late-stall",
                                  "exit", "delayed-first-byte", "no-first-byte"])
def test_range_rescue_probes_one_reader_at_a_time(env, tmp_path, monkeypatch, link):
    from types import SimpleNamespace
    from tether.node import transfer_jobs

    jobs = env["svc"].transfer_jobs
    chunk, length = 8192, 1024**2
    payload = (bytes(range(251)) * (2 * length // 251 + 1))[:2 * length]
    stage = tmp_path / "stage"
    now = 0.0
    readers = [[], []]
    wide_handshake = {"delayed-first-byte": 8, "no-first-byte": float("inf")}.get(link, 0)

    class Reader:
        def __init__(self, cmd, *, stdout, **kwargs):
            offset = int(cmd[cmd.index("--offset") + 1])
            self.lane = offset // length
            self.end = offset + int(cmd[cmd.index("--count") + 1])
            assert self.end == (self.lane + 1) * length
            history = readers[self.lane]
            assert offset == stdout.tell() == (history[-1].final if history else self.end - length)
            self.window = int(cmd[cmd.index("--sftp-concurrency") + 1]) if "--sftp-concurrency" in cmd else 0
            self.block = chunk
            if self.window:
                size_arg = cmd[cmd.index("--sftp-chunk-size") + 1]
                assert (self.window, size_arg) in {(1, "8Ki"), (8, "32Ki")}
                self.block = int(size_arg[:-2]) * 1024
            self.output, self.start, self.rounds = stdout, now, 0
            self.ready = now + (wide_handshake if self.window == 8 else 0)
            self.final = None
            history.append(self)

        def write(self, amount):
            pos = self.output.tell()
            self.output.write(payload[pos:min(pos + amount, self.end)])

        def poll(self):
            # One RTT per half virtual second, irrespective of supervisor polls.
            if self.final is not None:
                return 1
            if self.window == 8 and link == "exit":
                self.final = self.output.tell()
                return 1
            if now >= self.ready + (self.rounds + 1) * 0.5 and self.output.tell() < self.end:
                if not self.window and self.rounds or (self.window == 8 and link == "late-stall" and self.rounds >= 24):
                    return None
                # Cap bytes per RTT so the small fixture spans a full wide-rate sample.
                amount = min(self.block * max(1, self.window), chunk if link == "flat" else 4 * chunk)
                if link == "first-flat" and self.lane == 0:
                    amount = chunk
                if link == "other-flat" and self.lane == 1:
                    amount = 2 * chunk  # Faster narrow lane, but no gain from widening it.
                self.write(amount)
                self.rounds += 1
            return None

        def kill(self):
            pass

        def wait(self):
            if self.rounds:  # Only a reader that delivered data has a last byte in flight.
                self.write(1)
            self.final = self.output.tell()
            return 1

    def sleep(delay):
        nonlocal now
        now += delay
        assert now < 140, "reader never completed or fell back"

    monkeypatch.setattr(transfer_jobs, "time", SimpleNamespace(monotonic=lambda: now, sleep=sleep))
    monkeypatch.setattr(transfer_jobs.subprocess, "Popen", Reader)
    monkeypatch.setattr(jobs, "_get", lambda *_: {"state": "running"})
    monkeypatch.setattr(jobs, "_update", lambda *a, **kw: None)
    jobs._copy_file_ranges("probe", tmp_path / "unused.conf", "transfer:file", stage, len(payload), 2)
    assert hashlib.sha256(stage.read_bytes()).digest() == hashlib.sha256(payload).digest()
    tried, other = sorted(readers, key=lambda lane: lane[2].start if len(lane) > 2 else float("inf"))
    recovered = link in {"recovered", "delayed-first-byte"}
    assert [r.window for r in other] == ([0, 1, 8] if recovered or link == "first-flat" else [0, 1, 8, 1])
    assert [r.window for r in tried] == ([0, 1, 8] if recovered or link == "other-flat" else [0, 1, 8, 1])
    if link not in {"exit", "no-first-byte"}:
        # The other narrow reader stays available through handshake AND the first rate window.
        assert other[2].start >= tried[2].ready + 0.5 + 3
    if recovered:
        assert all(sum(r.rounds for r in lane) < length // chunk for lane in readers)
    elif link == "no-first-byte":
        assert 30 <= tried[3].start - tried[2].start < 30.3
        assert other[2].start >= tried[2].start + 30
    elif link in {"flat", "first-flat"}:
        assert 3.5 <= tried[3].start - tried[2].start < 3.9  # First RTT plus a full rate window.
    elif link == "late-stall":
        assert tried[2].rounds == 24 and tried[3].start - tried[2].start < 20


def test_rclone_ranges_resume_after_sftp_disconnect(env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                   rclone_sftp_source) -> None:
    import os
    import subprocess
    import time

    binary, source, config, serve = rclone_sftp_source
    jobs = env["svc"].transfer_jobs
    jobs._binary = binary
    payload = os.urandom(8 * 1024**2)
    (source / "file.bin").write_bytes(payload)
    popen = subprocess.Popen
    server = serve()
    interrupted = False
    restart_at = 0.0
    calls = []
    stage = tmp_path / "stage"
    first_handles = []

    def launch(cmd, **kwargs):
        calls.append((int(cmd[cmd.index("--offset") + 1]), int(cmd[cmd.index("--count") + 1])))
        if len(first_handles) < 4:
            first_handles.append(kwargs["stdout"])
        return popen(cmd, **kwargs)

    def status(_operation_id):
        nonlocal server, interrupted, restart_at
        if len(first_handles) == 4 and not interrupted:
            first_range_done = first_handles[0].tell()
            if 0 < first_range_done < len(payload) // 4:
                server.kill()
                server.wait()
                interrupted = True
                restart_at = time.monotonic() + 10
        if restart_at and time.monotonic() >= restart_at:
            server = serve()
            restart_at = 0.0
        return {"state": "running"}

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setattr(jobs, "_get", status)
    monkeypatch.setattr(jobs, "_update", lambda *args, **kwargs: None)
    try:
        jobs._copy_file_ranges("disconnect", config, "transfer:file.bin", stage, len(payload), 4)
    finally:
        server.kill()
        server.wait()
    assert interrupted
    assert hashlib.sha256(stage.read_bytes()).digest() == hashlib.sha256(payload).digest()
    length = len(payload) // 4
    assert calls[:4] == [(i * length, length) for i in range(4)]
    assert any(offset % length and count == length - offset % length for offset, count in calls[4:])


@pytest.mark.parametrize("slow_lanes, size_mib, slow_rate", [((1,), 32, "160Ki"), ((1, 2), 100, "640Ki")])
def test_rclone_reuses_idle_streams_for_slow_ranges(env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                  rclone_sftp_source, slow_lanes, size_mib, slow_rate) -> None:
    import os
    import subprocess

    binary, source, config, serve = rclone_sftp_source
    payload = os.urandom(size_mib * 1024**2)
    (source / "file.bin").write_bytes(payload)
    jobs = env["svc"].transfer_jobs
    jobs._binary = binary
    monkeypatch.setattr(jobs, "_get", lambda *_: {"state": "running"})
    monkeypatch.setattr(jobs, "_update", lambda *args, **kwargs: None)
    popen = subprocess.Popen
    calls = []
    procs = []
    quarter = len(payload) // 4

    def launch(cmd, **kwargs):
        offset = int(cmd[cmd.index("--offset") + 1])
        count = int(cmd[cmd.index("--count") + 1])
        calls.append((offset, count))
        assert sum(proc.poll() is None for proc in procs) < 4
        # The same per-reader limit applies after subdividing each slow range.
        speed = slow_rate if offset // quarter in slow_lanes else "8Mi"
        proc = popen([*cmd, "--bwlimit", speed], **kwargs)
        procs.append(proc)
        return proc

    server = serve()
    monkeypatch.setattr(subprocess, "Popen", launch)
    stage = tmp_path / "stage"
    try:
        jobs._copy_file_ranges("slow-middle", config, "transfer:file.bin", stage, len(payload), 4)
    finally:
        server.kill()
        server.wait()
    assert hashlib.sha256(stage.read_bytes()).digest() == hashlib.sha256(payload).digest()
    assert len(calls) == 8
    assert {offset // quarter for offset, _ in calls[4:]} == set(slow_lanes)
    for lane in slow_lanes:
        tail = sorted((offset, count) for offset, count in calls[4:] if offset // quarter == lane)
        assert lane * quarter < tail[0][0]
        assert all(start + count == following[0] for (start, count), following in zip(tail, tail[1:]))
        assert tail[-1][0] + tail[-1][1] == (lane + 1) * quarter


def test_hub_transfer_cancel_removes_only_the_requested_partial(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "transfer"
    svc.dispatch("mkdir", {"path": str(folder)})
    target = folder / "cancel.bin"
    payload = base64.b64encode(b"partial").decode()
    transfer = "136cb3739efe1488"
    other_transfer = "e17a9e3f10234abc"

    for transfer_id in (transfer, other_transfer):
        result = svc.dispatch("write_chunk", {
            "path": str(target), "transfer_id": transfer_id, "offset": 0, "total": 20,
            "base64": payload,
        })
        assert result["complete"] is False

    cancelled = svc.dispatch_hub("transfer_cancel", {
        "path": str(target), "transfer_id": transfer,
    })

    assert cancelled["cancelled"] is True
    assert not target.exists()
    assert not target.with_name(target.name + ".tether-part." + transfer).exists()
    assert target.with_name(target.name + ".tether-part." + other_transfer).exists()


def test_audit_uses_sqlite_and_pages_newest_first(env) -> None:
    svc: FsService = env["svc"]
    for index in range(12):
        svc.audit.add(op="probe", path=str(index), phase="result", result="ok")
    first = svc.dispatch("audit_list", {"limit": 5, "offset": 0})
    assert [row["path"] for row in first["entries"]] == ["11", "10", "9", "8", "7"]
    second = svc.dispatch("audit_list", {"limit": 5, "offset": 5})
    assert [row["path"] for row in second["entries"]] == ["6", "5", "4", "3", "2"]
    assert first["count"] >= 12
    assert first["retained"] == 100000
    assert (env["data"] / "audit.db").is_file()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows drive root resolution")
def test_drive_root_without_trailing_separator_resolves(env) -> None:
    svc: FsService = env["svc"]
    resolved = svc._resolve("C:")
    assert resolved.is_absolute()
    assert str(resolved).endswith("\\")


def test_preview_returns_renderable_text_markdown_image_and_pdf(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "preview"
    folder.mkdir()
    (folder / "note.md").write_text("# Title\n\nbody", encoding="utf-8")
    (folder / "plain.txt").write_text("line one", encoding="utf-8")
    (folder / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 16)
    (folder / "doc.pdf").write_bytes(b"%PDF-1.4\n%%EOF")
    (folder / "blob.bin").write_bytes(b"\x00\x01\x02")

    markdown = svc.dispatch("preview", {"path": str(folder / "note.md")})
    assert markdown["kind"] == "markdown" and "# Title" in markdown["text"]
    assert svc.dispatch("preview", {"path": str(folder / "plain.txt")})["kind"] == "text"
    image = svc.dispatch("preview", {"path": str(folder / "pic.png")})
    assert image["kind"] == "image" and image["mime"] == "image/png" and image["base64"]
    pdf = svc.dispatch("preview", {"path": str(folder / "doc.pdf")})
    assert pdf["kind"] == "pdf" and pdf["mime"] == "application/pdf" and pdf["base64"]
    assert svc.dispatch("preview", {"path": str(folder / "blob.bin")})["kind"] == "unsupported"


def test_text_preview_preserves_remote_identity_encoding_newline_and_version(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "editing"
    folder.mkdir()
    target = folder / "legacy.py"
    target.write_bytes("# 中文\r\nprint('ok')\r\n".encode("gb18030"))

    preview = svc.dispatch("preview", {"path": str(target)})
    assert preview["device_id"] == "TEST"
    assert preview["encoding"] == "gb18030"
    assert preview["newline"] == "crlf"
    assert preview["editable"] is True
    assert preview["truncated"] is False
    assert len(preview["version"]) == 64
    stat = svc.dispatch("stat", {"path": str(target)})
    assert stat["device_id"] == "TEST"
    assert stat["version"] == preview["version"]

    saved = svc.dispatch("write", {
        "path": str(target),
        "text": preview["text"].replace("ok", "saved"),
        "expected_version": preview["version"],
        "encoding": preview["encoding"],
        "newline": preview["newline"],
    })
    assert saved["device_id"] == "TEST"
    assert saved["version"] != preview["version"]
    raw = target.read_bytes()
    assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    assert raw.decode("gb18030").endswith("print('saved')\r\n")

    target.write_text("external\n", encoding="utf-8")
    with pytest.raises(FsError) as caught:
        svc.dispatch("write", {
            "path": str(target), "text": "stale", "expected_version": saved["version"],
            "encoding": "gb18030", "newline": "crlf",
        })
    assert caught.value.code == "conflict"
    assert target.read_text(encoding="utf-8") == "external\n"


def test_only_complete_source_text_is_editable(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "editable"
    folder.mkdir()
    unknown = folder / "Dockerfile.custom"
    unknown.write_text("FROM python:3.13\n", encoding="utf-8")
    archive = folder / "sample.zip"
    with __import__("zipfile").ZipFile(archive, "w") as output:
        output.writestr("inside.txt", "data")
    large = folder / "large.txt"
    large.write_text("x" * (MAX_PREVIEW_TEXT + 1), encoding="utf-8")

    unknown_preview = svc.dispatch("preview", {"path": str(unknown)})
    assert unknown_preview["kind"] == "text"
    assert unknown_preview["editable"] is True
    assert unknown_preview["encoding"] == "utf-8"
    assert svc.dispatch("preview", {"path": str(archive)})["editable"] is False
    large_preview = svc.dispatch("preview", {"path": str(large)})
    assert large_preview["truncated"] is True
    assert large_preview["editable"] is False


def test_office_preview_reuses_converted_pdf_until_source_changes(env, monkeypatch: pytest.MonkeyPatch) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "office"
    folder.mkdir()
    doc = folder / "report.docx"
    doc.write_bytes(b"fake-docx")
    calls: list[tuple[str, str]] = []

    def fake_convert(source: Path, kind: str) -> bytes:
        calls.append((str(source), kind))
        return b"%PDF-1.4\nfake-converted"

    monkeypatch.setattr(svc, "_office_pdf", fake_convert)
    first = svc.dispatch("preview", {"path": str(doc)})
    second = svc.dispatch("preview", {"path": str(doc)})
    assert first["converted"] is True and second["converted"] is True
    assert first["base64"] == second["base64"]
    assert len(calls) == 1
    assert len(list(svc.preview_cache_dir.glob("*.pdf"))) == 1
    audit = svc.dispatch("audit_list", {"limit": 20})["entries"]
    assert any(row.get("from_cache") is True for row in audit)

    doc.write_bytes(b"fake-docx-v2")
    third = svc.dispatch("preview", {"path": str(doc)})
    assert third["kind"] == "pdf"
    assert len(calls) == 2


def test_read_base64_returns_exact_non_utf8_bytes(env) -> None:
    svc: FsService = env["svc"]
    target = env["root"] / "legacy.txt"
    payload = "中文附件\r\n".encode("gb18030")
    assert b"\x00" not in payload
    target.write_bytes(payload)

    default = svc.dispatch("read", {"path": str(target), "offset": 0, "limit": 1024})
    assert default["binary"] is False and "text" in default

    exact = svc.dispatch("read", {"path": str(target), "offset": 0, "limit": 1024, "encoding": "base64"})
    assert exact["binary"] is True
    assert base64.b64decode(exact["base64"]) == payload


def test_locked_mode_blocks_all_writes(env) -> None:
    svc: FsService = env["svc"]
    svc.dispatch("policy_set", {"mode": "locked"})
    target = env["root"] / "locked.txt"
    with pytest.raises(FsError) as caught:
        svc.dispatch("write", {"path": str(target), "text": "no"})
    assert caught.value.code == "denied"
    assert not target.exists()
    svc.dispatch("policy_set", {"mode": "readonly"})


def test_delete_moves_to_trash(env) -> None:
    svc: FsService = env["svc"]
    target = env["root"] / "demo" / "gone.txt"
    svc.dispatch("mkdir", {"path": str(env["root"] / "demo")})
    svc.dispatch("write", {"path": str(target), "text": "x"})
    result = svc.dispatch("delete", {"path": str(target)})
    assert not target.exists()
    assert Path(result["trash"]).exists()
    assert Path(result["trash"]).parent.name == ".tether-trash"
