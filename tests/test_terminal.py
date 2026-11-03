import base64
import os
import time

import pytest

from tether.node.terminal import TerminalService


def _command(text: str) -> str:
    return ("Write-Output '" + text + "'\n") if os.name == "nt" else ("echo " + text + "\n")


def test_terminal_runs_a_command_and_returns_output(tmp_path) -> None:
    terminal = TerminalService(tmp_path)
    session = terminal.start({})
    try:
        terminal.write({"session_id": session["session_id"],
                        "data": base64.b64encode(_command("tether-terminal").encode()).decode()})
        output = b""
        since = 0
        deadline = time.time() + 15
        while time.time() < deadline:
            result = terminal.poll({"session_id": session["session_id"], "since": since})
            since = result["next"]
            output += base64.b64decode(result["data"])
            if b"tether-terminal" in output:
                break
            time.sleep(0.1)
        assert b"tether-terminal" in output
    finally:
        terminal.stop({"session_id": session["session_id"]})


def test_terminal_fs_ops_delegate_to_the_shell(tmp_path) -> None:
    from tether.node.fs_service import FsError, FsService

    fs = FsService.__new__(FsService)
    fs.policy = type("Policy", (), {"device": "TEST"})()
    fs.terminal = TerminalService(tmp_path)
    session = fs.dispatch("terminal_start", {})
    try:
        assert session["session_id"]
    finally:
        fs.dispatch("terminal_stop", {"session_id": session["session_id"]})

    missing = FsService.__new__(FsService)
    with pytest.raises(FsError):
        missing.dispatch("terminal_start", {})


def test_terminal_rejects_unknown_sessions_and_actions(tmp_path) -> None:
    terminal = TerminalService(tmp_path)
    with pytest.raises(ValueError):
        terminal.write({"session_id": "missing", "data": ""})
    with pytest.raises(ValueError):
        terminal.poll({"session_id": "missing"})
    with pytest.raises(ValueError):
        terminal.dispatch("restart", {})


def test_terminal_lists_shells_and_starts_in_requested_cwd(tmp_path) -> None:
    terminal = TerminalService(tmp_path)
    catalog = terminal.dispatch("shells", {})
    ids = [item["id"] for item in catalog["shells"]]
    assert catalog["default"] in ids
    assert any(item["available"] for item in catalog["shells"])
    nested = tmp_path / "nested"
    nested.mkdir()
    session = terminal.start({"cwd": str(nested)})
    try:
        assert session["cwd"].endswith("nested")
        assert session["shell"] == catalog["default"]
    finally:
        terminal.stop({"session_id": session["session_id"]})


def test_terminal_rejects_bad_cwd_and_shell(tmp_path) -> None:
    terminal = TerminalService(tmp_path)
    with pytest.raises(ValueError):
        terminal.start({"cwd": str(tmp_path / "missing")})
    with pytest.raises(ValueError):
        terminal.start({"shell": "tether-no-such-shell"})