import os
import time

import pytest

from tether.node import croc_transfer


class FakeProcess:
    def __init__(self, lines=(), return_code=0, pid=4242, blocking=False):
        self.stdout = iter(lines)
        self.return_code = return_code
        self.pid = pid
        self.blocking = blocking
        self.terminated = False

    def wait(self, timeout=None):
        if self.blocking and not self.terminated:
            time.sleep(0.05)
        return self.return_code

    def poll(self):
        return None if self.blocking and not self.terminated else self.return_code

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.terminated = True


def wait_for_state(job, state, timeout=2.0):
    end = time.time() + timeout
    while time.time() < end:
        if job.status()["state"] == state:
            return job.status()
        time.sleep(0.01)
    raise AssertionError("job did not reach " + state)


def test_send_uses_official_croc_flags_and_parses_progress(tmp_path, monkeypatch):
    source = tmp_path / "payload.bin"
    source.write_bytes(b"x" * 1024)
    calls = []

    def fake_popen(args, **kwargs):
        calls.append((args, kwargs))
        return FakeProcess([
            "payload.bin   0% |          | ( 0 B/16 MB) [0s:0s]\n",
            "payload.bin  42% |====      | ( 6.7/16 MB, 12.5 MB/s)\n",
            "payload.bin 100% |==========| (16/16 MB, 20.0 MB/s)\n",
        ])

    monkeypatch.setattr(croc_transfer.subprocess, "Popen", fake_popen)
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="127.0.0.1:19009")
    job = transfer.send(str(source), "tether-code-123", transfers=6)
    status = wait_for_state(job, "completed")

    args, kwargs = calls[0]
    assert args[:2] == ["croc", "--relay"]
    assert "127.0.0.1:19009" in args
    assert "send" in args
    assert "--code" in args and "tether-code-123" in args
    assert "--transfers" in args and "6" in args
    assert "--no-local" in args
    assert "--transport" in args and "relay" in args
    assert "--ignore-stdin" in args
    assert kwargs["creationflags"] == getattr(croc_transfer.subprocess, "CREATE_NO_WINDOW", 0)
    assert status["percent"] == 100
    assert status["speed"] == 20 * 1024 * 1024
    assert status["state"] == "completed"


def test_posix_send_passes_code_through_environment(tmp_path, monkeypatch):
    source = tmp_path / "payload.bin"
    source.write_bytes(b"x")
    calls = []

    def fake_popen(args, **kwargs):
        calls.append((args, kwargs))
        return FakeProcess(["100% (1/1 MB, 1.0 MB/s)\n"])

    monkeypatch.setattr(croc_transfer.subprocess, "Popen", fake_popen)
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="127.0.0.1:19009", platform="posix")
    job = transfer.send(str(source), "long-enough-code")
    wait_for_state(job, "completed")
    args, kwargs = calls[0]
    assert "--code" not in args
    assert kwargs["env"]["CROC_SECRET"] == "long-enough-code"


def test_receive_passes_code_only_through_environment(tmp_path, monkeypatch):
    calls = []

    def fake_popen(args, **kwargs):
        calls.append((args, kwargs))
        return FakeProcess(["receiving 100% (16/16 MB, 8.0 MB/s)\n"])

    monkeypatch.setattr(croc_transfer.subprocess, "Popen", fake_popen)
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="relay.local:9009")
    out = tmp_path / "out"
    job = transfer.receive("tether-code-123", str(out))
    wait_for_state(job, "completed")

    args, kwargs = calls[0]
    assert "tether-code-123" not in args
    assert "--ignore-stdin" in args
    assert kwargs["env"]["CROC_SECRET"] == "tether-code-123"
    assert "--out" in args and str(out) in args
    assert out.is_dir()


def test_a_relay_is_required_and_short_codes_are_rejected(tmp_path, monkeypatch):
    monkeypatch.delenv("TETHER_CROC_RELAY", raising=False)
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="")
    source = tmp_path / "payload.bin"
    source.write_bytes(b"x")
    with pytest.raises(croc_transfer.CrocError) as missing:
        transfer.send(str(source), "long-enough-code")
    assert missing.value.code == "croc_relay_required"

    monkeypatch.setattr(croc_transfer.subprocess, "Popen", lambda *a, **k: FakeProcess())
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="127.0.0.1:9009")
    with pytest.raises(croc_transfer.CrocError) as short:
        transfer.send(str(source), "short")
    assert short.value.code == "croc_bad_code"


def test_missing_source_is_rejected_before_spawning(tmp_path):
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="127.0.0.1:9009")
    with pytest.raises(croc_transfer.CrocError) as error:
        transfer.send(str(tmp_path / "missing.bin"), "long-enough-code")
    assert error.value.code == "croc_source_missing"


def test_cancel_marks_the_job_and_stops_the_process(monkeypatch):
    process = FakeProcess(["payload.bin 10% (1/10 MB)\n"], blocking=True)
    monkeypatch.setattr(croc_transfer.subprocess, "Popen", lambda *a, **k: process)
    transfer = croc_transfer.CrocTransfer(binary="croc", relay="127.0.0.1:9009")
    job = transfer.receive("long-enough-code", os.getcwd())
    job.cancel()
    assert process.terminated is True
    assert job.status()["state"] == "cancelled"


def test_default_platform_uses_sys_platform_and_maps_posix(monkeypatch):
    monkeypatch.setattr(croc_transfer.sys, "platform", "linux")
    assert croc_transfer.CrocTransfer(binary="croc", relay="r:1").platform == "linux"
    monkeypatch.setattr(croc_transfer.sys, "platform", "darwin")
    assert croc_transfer.CrocTransfer(binary="croc", relay="r:1").platform == "darwin"
    monkeypatch.setattr(croc_transfer.sys, "platform", "win32")
    assert croc_transfer.CrocTransfer(binary="croc", relay="r:1").platform == "nt"
