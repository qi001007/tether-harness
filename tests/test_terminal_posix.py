import base64
import os
import time

import pytest

from tether.node.terminal import TerminalService

pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX PTY only")


def test_posix_pty_runs_a_command_and_resizes(tmp_path) -> None:
    terminal = TerminalService(tmp_path)
    catalog = terminal.dispatch("shells", {})
    assert catalog["default"] in [item["id"] for item in catalog["shells"]]
    assert any(item["available"] for item in catalog["shells"])
    session = terminal.start({"cwd": str(tmp_path), "cols": 90, "rows": 24})
    try:
        assert session["pty"] is True
        terminal.write({
            "session_id": session["session_id"],
            "data": base64.b64encode(b"echo TETHER_POSIX_PTY_OK\n").decode(),
        })
        output = b""
        since = 0
        deadline = time.time() + 10
        while time.time() < deadline:
            result = terminal.poll({"session_id": session["session_id"], "since": since})
            since = result["next"]
            output += base64.b64decode(result["data"])
            if b"TETHER_POSIX_PTY_OK" in output:
                break
            time.sleep(0.1)
        assert b"TETHER_POSIX_PTY_OK" in output
        resized = terminal.resize({"session_id": session["session_id"], "cols": 80, "rows": 20})
        assert resized["cols"] == 80
        assert resized["rows"] == 20
    finally:
        terminal.stop({"session_id": session["session_id"]})
