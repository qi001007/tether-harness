import sys
import time
from pathlib import Path

import pytest

from tether.node.acp import AcpService


FAKE = Path(__file__).with_name("fake_acp_agent.py")


def _service(tmp_path):
    return AcpService(tmp_path, harnesses={
        "fake": {"name": "Fake Agent", "command": [sys.executable, str(FAKE)]}
    })


def _poll_until(service, session_id, predicate, timeout=10.0):
    since = 0
    deadline = time.monotonic() + timeout
    events = []
    while time.monotonic() < deadline:
        result = service.poll({"session_id": session_id, "since": since})
        events.extend(result["events"])
        since = result["next"]
        if predicate(events):
            return events
        time.sleep(0.05)
    raise AssertionError("events not observed: " + repr(events))


def test_detect_lists_only_installed_harnesses(tmp_path):
    service = AcpService(tmp_path, harnesses={
        "fake": {"name": "Fake Agent", "command": [sys.executable]},
        "missing": {"name": "Missing", "command": ["tether-no-such-binary"]},
    })
    found = service.detect()["harnesses"]
    assert [item["id"] for item in found] == ["fake"]


def test_unknown_or_missing_harness_is_rejected(tmp_path):
    service = _service(tmp_path)
    with pytest.raises(ValueError):
        service.start({"harness": "nope"})
    service.harnesses["missing"] = {"name": "Missing", "command": ["tether-no-such-binary"]}
    with pytest.raises(ValueError):
        service.start({"harness": "missing"})


def test_prompt_streams_updates_and_permission_request(tmp_path):
    service = _service(tmp_path)
    started = service.start({"harness": "fake", "cwd": str(tmp_path)})
    session_id = started["session_id"]
    try:
        service.prompt({"session_id": session_id, "text": "hi"})
        events = _poll_until(service, session_id, lambda items: any(
            item["event"].get("type") == "request" for item in items))
        texts = [item["event"]["params"]["update"]["content"]["text"]
                 for item in events if item["event"].get("type") == "notification"]
        assert texts == ["hello"]
        request = next(item["event"] for item in events if item["event"].get("type") == "request")
        assert request["method"] == "session/request_permission"
        service.reply({"session_id": session_id, "request_id": request["id"],
                       "outcome": {"outcome": "selected", "optionId": "allow"}})
        events = _poll_until(service, session_id, lambda items: any(
            item["event"].get("type") == "result" for item in items))
        texts = [item["event"]["params"]["update"]["content"]["text"]
                 for item in events if item["event"].get("type") == "notification"]
        assert texts == ["hello", "bye"]
        result = next(item["event"]["result"] for item in events if item["event"].get("type") == "result")
        assert result == {"stopReason": "end_turn"}
    finally:
        service.stop({"session_id": session_id})


def test_stop_removes_session(tmp_path):
    service = _service(tmp_path)
    started = service.start({"harness": "fake"})
    service.stop({"session_id": started["session_id"]})
    assert service.sessions == {}
    with pytest.raises(ValueError):
        service.poll({"session_id": started["session_id"], "since": 0})


def test_fs_service_exposes_acp_ops(tmp_path):
    from types import SimpleNamespace

    from tether.node.fs_service import FsError, FsService

    fs = FsService.__new__(FsService)
    fs.acp = _service(tmp_path)
    fs.policy = SimpleNamespace(device="device-a")
    result = fs.dispatch("acp_detect", {})
    assert result["harnesses"][0]["id"] == "fake"
    assert result["device_id"] == "device-a"
    with pytest.raises(FsError):
        fs.dispatch("acp_poll", {"session_id": "missing"})