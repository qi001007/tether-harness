import os
from pathlib import Path

import pytest

from tether.node.fs_service import FsService, FsError


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
    assert service.croc.calls[0][0] == "send"
    assert service.croc.calls[0][2] == "long-enough-code"


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


def test_missing_croc_engine_is_reported(service, tmp_path):
    service.croc = None
    source = tmp_path / "source.bin"
    source.write_bytes(b"payload")
    with pytest.raises(FsError) as error:
        service.dispatch("transfer_send", {"path": str(source), "code": "long-enough-code"})
    assert error.value.code == "croc_missing"
