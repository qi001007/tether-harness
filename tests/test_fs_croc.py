import errno
import hashlib
import os
from pathlib import Path

import pytest

from tether.node import fs_service
from tether.node.fs_service import FsService, FsError
from tether.node.croc_transfer import CrocJob, CrocTransfer


class FakeJob:
    def __init__(self, state="completed"):
        self.state = state
        self.pid = 100

    def status(self):
        return {"state": self.state, "percent": 100 if self.state == "completed" else 12,
                "speed": 1024, "line": "", "error": "", "pid": self.pid}

    def cancel(self):
        self.state = "cancelled"
        return self.status()


class FakeCroc:
    def __init__(self):
        self.job = None
        self.calls = []

    def available(self):
        return True

    def send(self, path, code, transfers=4):
        self.calls.append(("send", path, code, transfers))
        self.job = FakeJob()
        return self.job

    def receive(self, code, out_dir):
        self.calls.append(("receive", code, out_dir))
        target = Path(out_dir)
        target.mkdir(parents=True, exist_ok=True)
        (target / "payload.bin").write_bytes(b"hello croc")
        self.job = FakeJob()
        return self.job

    def status(self):
        return self.job.status() if self.job else {"state": "idle"}


def test_croc_job_reports_fresh_activity_sequence():
    class Process:
        pid = 123
        stdout = iter(["0% 10MB/s\n", "0% 11MB/s\n", "1% 11MB/s\n"])

        def wait(self):
            return 1

    job = CrocJob(Process(), direction="receive")
    job._reader.join(timeout=1)
    status = job.status()
    assert status["progress_seq"] >= 3
    assert status["percent"] == 1


@pytest.fixture
def service(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    fs = FsService(device="dev-a", workspace=workspace,
                   data_dir=tmp_path / "data", workspaces_root=workspace)
    fs.policy.update({"mode": "full"})
    monkeypatch.setattr(fs.policy, "can_write", lambda path, op="write": (True, "test policy"))
    fs.croc = FakeCroc()
    return fs


def test_send_validates_the_source_and_returns_a_transfer_id(service, tmp_path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"payload")
    result = service.dispatch("transfer_send", {"path": str(source), "code": "long-enough-code"})
    assert result["engine"] == "croc"
    assert result["direction"] == "send"
    assert result["transfer_id"]
    assert "sha256" not in result
    assert service.croc.calls[0][0] == "send"
    assert service.croc.calls[0][2] == "long-enough-code"


def test_verified_send_hashes_the_actual_source_and_rejects_change_during_hash(service, monkeypatch):
    source = service.workspace / "source.bin"
    source.write_bytes(b"original payload")
    args = {"path": str(source), "code": "long-enough-code", "verify_sha256": True}
    sent = service.dispatch("transfer_send", args)
    assert sent["sha256"] == hashlib.sha256(b"original payload").hexdigest()
    original_hash = fs_service._path_version

    def hash_then_modify(path):
        digest = original_hash(path)
        path.write_bytes(b"changed length")
        return digest

    monkeypatch.setattr(fs_service, "_path_version", hash_then_modify)
    with pytest.raises(FsError) as changed:
        service.dispatch("transfer_send", args)
    assert changed.value.code == "source_changed"
    assert len(service.croc.calls) == 1


def test_receive_then_finish_moves_the_file_out_of_staging(service, tmp_path):
    destination = tmp_path / "destination"
    destination.mkdir()
    started = service.dispatch("transfer_receive", {
        "path": str(destination), "code": "long-enough-code"
    })
    assert started["direction"] == "receive"
    staging = Path(started["staging"])
    assert (staging / "payload.bin").read_bytes() == b"hello croc"

    finished = service.dispatch("transfer_finish", {"overwrite": False})
    target = destination / "payload.bin"
    assert finished["path"] == str(target)
    assert target.read_bytes() == b"hello croc"
    assert not staging.exists()


def test_finish_refuses_an_unfinished_or_missing_transfer(service):
    with pytest.raises(FsError) as missing:
        service.dispatch("transfer_finish", {})
    assert missing.value.code == "croc_no_transfer"

    service.croc.receive("long-enough-code", str(service.workspace / "incoming"))
    service.dispatch("transfer_receive", {
        "path": str(service.workspace), "code": "long-enough-code"
    })
    service.croc.job.state = "running"
    with pytest.raises(FsError) as unfinished:
        service.dispatch("transfer_finish", {})
    assert unfinished.value.code == "croc_not_complete"


def test_finish_rejects_a_stale_transfer_id_without_publishing(service):
    started = service.dispatch("transfer_receive", {
        "path": str(service.workspace), "code": "long-enough-code", "transfer_id": "current"
    })

    with pytest.raises(FsError) as stale:
        service.dispatch("transfer_finish", {"transfer_id": "stale", "overwrite": False})
    assert stale.value.code == "croc_no_transfer"
    assert not (service.workspace / "payload.bin").exists()
    assert (Path(started["staging"]) / "payload.bin").is_file()
    assert service.dispatch("transfer_status", {})["transfer_id"] == "current"

    target = service.workspace / "payload.bin"
    target.write_bytes(b"existing")
    with pytest.raises(FsError) as conflict:
        service.dispatch("transfer_finish", {"transfer_id": "current", "overwrite": False})
    assert conflict.value.code == "exists"
    assert target.read_bytes() == b"existing"
    target.unlink()

    finished = service.dispatch("transfer_finish", {"transfer_id": "current", "overwrite": False})
    assert Path(finished["path"]).read_bytes() == b"hello croc"


def test_verified_finish_never_publishes_a_corrupt_preallocated_file(service):
    started = service.dispatch("transfer_receive", {
        "path": str(service.workspace), "code": "long-enough-code", "verify_sha256": True,
    })
    staging = Path(started["staging"])
    staged_file = staging / "payload.bin"
    payload = staged_file.read_bytes()
    staged_file.write_bytes(payload[:4].ljust(len(payload), b"\0"))
    args = {"transfer_id": started["transfer_id"], "overwrite": False}
    with pytest.raises(FsError) as unchecked:
        service.dispatch("transfer_finish", args)
    assert unchecked.value.code == "bad_args"

    args["expected_sha256"] = hashlib.sha256(payload).hexdigest()
    with pytest.raises(FsError) as corrupt:
        service.dispatch("transfer_finish", args)
    assert corrupt.value.code == "croc_integrity_mismatch"
    assert not (service.workspace / "payload.bin").exists()
    assert staged_file.exists()

    staged_file.write_bytes(payload)
    finished = service.dispatch("transfer_finish", args)
    assert Path(finished["path"]).read_bytes() == payload
    assert not staging.exists()


def test_verified_finish_across_volumes_keeps_a_concurrently_created_target(service, monkeypatch):
    started = service.dispatch("transfer_receive", {
        "path": str(service.workspace), "code": "long-enough-code", "verify_sha256": True,
    })
    stage = Path(started["staging"]) / "payload.bin"
    target = service.workspace / "payload.bin"
    publish_name = "rename" if os.name == "nt" else "link"
    publish = getattr(os, publish_name)

    def cross_volume_publish(source, destination):
        if source == stage:
            raise OSError(errno.EXDEV, "cross-volume test")
        assert source.parent == target.parent
        assert source.read_bytes() == stage.read_bytes()
        target.write_bytes(b"concurrent writer")
        publish(source, destination)

    monkeypatch.setattr(os, publish_name, cross_volume_publish)
    with pytest.raises(FsError) as conflict:
        service.dispatch("transfer_finish", {"transfer_id": started["transfer_id"], "overwrite": False,
                         "expected_sha256": hashlib.sha256(stage.read_bytes()).hexdigest()})
    assert conflict.value.code == "exists"
    assert target.read_bytes() == b"concurrent writer"
    assert stage.exists()
    assert list(service.workspace.glob(".tether-croc-*.part")) == []


def test_finish_checks_the_receive_job_and_transfer_info_only_reports_capabilities(service, monkeypatch):
    croc = CrocTransfer(relay="private-relay.example:9009")
    monkeypatch.setattr(croc, "available", lambda: True)
    monkeypatch.setattr(croc, "version", lambda: "11.0.0")
    monkeypatch.setattr(croc, "receive", service.croc.receive)
    service.croc = croc
    assert service.dispatch("transfer_info", {}) == {
        "engine": "croc", "legacy": True, "default_engine": "rclone-sftpgo", "available": True,
        "version": "11.0.0", "relay": True, "cancel_by_transfer_id": True,
        "finish_by_transfer_id": True, "verify_sha256_before_finish": True, "device_id": "dev-a",
    }
    started = service.dispatch("transfer_receive", {
        "path": str(service.workspace), "code": "long-enough-code"
    })
    receive_job = service._croc_context["job"]
    receive_job.state = "running"
    croc.job = FakeJob("completed")

    with pytest.raises(FsError) as unfinished:
        service.dispatch("transfer_finish", {"transfer_id": started["transfer_id"]})
    assert unfinished.value.code == "croc_not_complete"
    assert not (service.workspace / "payload.bin").exists()
    assert (Path(started["staging"]) / "payload.bin").is_file()


def test_cancel_removes_staging(service):
    destination = service.workspace
    started = service.dispatch("transfer_receive", {
        "path": str(destination), "code": "long-enough-code"
    })
    staging = Path(started["staging"])
    assert staging.exists()
    cancelled = service.dispatch("transfer_cancel", {})
    assert cancelled["state"] == "cancelled"
    assert not staging.exists()


def test_cancel_with_transfer_id_only_cancels_matching_owned_job(service):
    destination = service.workspace
    started = service.dispatch("transfer_receive", {
        "path": str(destination), "code": "long-enough-code", "transfer_id": "owned-transfer"
    })
    owned_job = service._croc_context["job"]
    newer_job = FakeJob("running")
    service.croc.job = newer_job
    cancelled = service.dispatch("transfer_cancel", {"transfer_id": started["transfer_id"]})
    assert cancelled["state"] == "cancelled"
    assert owned_job.state == "cancelled"
    assert newer_job.state == "running"
    assert service._croc_context == {}


def test_cancel_with_stale_transfer_id_does_not_touch_current_job(service):
    job = FakeJob("running")
    service.croc.job = job
    service._croc_context = {"transfer_id": "current", "direction": "send", "job": job}
    cancelled = service.dispatch("transfer_cancel", {"transfer_id": "stale"})
    assert cancelled["cancelled"] is False
    assert job.state == "running"
    assert service._croc_context["transfer_id"] == "current"


def test_missing_croc_engine_is_reported(service, tmp_path):
    service.croc = None
    source = tmp_path / "source.bin"
    source.write_bytes(b"payload")
    with pytest.raises(FsError) as error:
        service.dispatch("transfer_send", {"path": str(source), "code": "long-enough-code"})
    assert error.value.code == "croc_missing"


@pytest.mark.parametrize("op", ["transfer_info", "transfer_send", "transfer_receive", "transfer_status",
                                "transfer_cancel", "transfer_finish"])
def test_shared_files_authority_cannot_use_owner_croc_ops(service, op):
    with pytest.raises(FsError) as caught:
        service.dispatch_hub(op, {}, {"kind": "hub_files"})
    assert caught.value.code == "trusted_hub_required"
