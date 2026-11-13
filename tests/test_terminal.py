import base64
import os
import time
from pathlib import Path

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
    herdr = next((item for item in catalog["shells"] if item["id"] == "herdr"), None)
    assert catalog["herdr_agent_start"] is bool(herdr and herdr["available"])
    assert catalog["runtime_agent_start"] is True
    assert all(item["project_sessions"] == (item["id"] == "herdr") for item in catalog["shells"])
    nested = tmp_path / "nested"
    nested.mkdir()
    session = terminal.start({"cwd": str(nested)})
    try:
        assert session["cwd"].endswith("nested")
        assert session["shell"] == catalog["default"]
    finally:
        terminal.stop({"session_id": session["session_id"]})


def test_herdr_project_agent_uses_the_verified_root_pane_from_cli(tmp_path, monkeypatch) -> None:
    terminal = TerminalService(tmp_path, env={"APPDATA": "C:/Users/test/AppData/Roaming",
                                                "XDG_CONFIG_HOME": "/home/test/.config"}, shells={
        "herdr": ("Herdr", ["herdr"], "herdr")
    })
    calls = []
    timeouts = []

    def cli(_session, _cwd, _env, arguments, timeout):
        calls.append(arguments)
        timeouts.append(timeout)
        if arguments[:2] == ["workspace", "list"]:
            return {"workspaces": [{"workspace_id": "w7"}]}
        if arguments[:2] == ["tab", "create"]:
            return {"root_pane": {"pane_id": "w7:p9", "tab_id": "w7:t4", "workspace_id": "w7"},
                    "tab": {"tab_id": "w7:t4"}}
        if arguments[:2] == ["agent", "start"]:
            return {"type": "agent_started"}
        raise AssertionError(arguments)

    monkeypatch.setattr(terminal, "_herdr_cli", cli)
    pane_id, tab_id, agent_state = terminal._herdr_project_pane(
        "project-session", tmp_path, {}, "qoder", "qodercli",
        terminal._herdr_agent_environment({"QODER_HOME": "user-config"}))

    assert (pane_id, tab_id) == ("w7:p9", "w7:t4")
    assert agent_state == "ready"
    start = calls[-1]
    assert start[start.index("--pane") + 1] == "w7:p9"
    assert start[start.index("--kind") + 1] == "qodercli"
    assert "w7:t4" not in start
    assert start[start.index("--timeout") + 1] == "6000"
    assert timeouts == [0.5, 1.5, 7.0]
    create = calls[1]
    env_pairs = [create[index + 1] for index, value in enumerate(create[:-1]) if value == "--env"]
    assert env_pairs == ["APPDATA=C:/Users/test/AppData/Roaming",
                         "QODER_HOME=user-config", "XDG_CONFIG_HOME=/home/test/.config",
                         "XDG_STATE_HOME=" + str(Path.home() / ".local" / "state")]


def test_herdr_project_agent_failure_closes_only_the_tab_created_for_this_start(tmp_path, monkeypatch) -> None:
    terminal = TerminalService(tmp_path, shells={
        "herdr": ("Herdr", ["herdr"], "herdr")
    })
    calls = []

    def cli(_session, _cwd, _env, arguments, _timeout):
        calls.append(arguments)
        if arguments[:2] == ["workspace", "list"]:
            return {"workspaces": [{"workspace_id": "w8"}]}
        if arguments[:2] == ["tab", "create"]:
            return {"root_pane": {"pane_id": "w8:p3", "tab_id": "w8:t2", "workspace_id": "w8"},
                    "tab": {"tab_id": "w8:t2"}}
        if arguments[:2] == ["agent", "start"]:
            raise ValueError("Herdr agent timed out")
        if arguments[:2] == ["tab", "close"]:
            return {"type": "ok"}
        raise AssertionError(arguments)

    monkeypatch.setattr(terminal, "_herdr_cli", cli)

    with pytest.raises(ValueError, match="Herdr agent timed out"):
        terminal._herdr_project_pane("project-session", tmp_path, {}, "codex", "codex", {})

    assert calls[-1] == ["tab", "close", "w8:t2"]
    assert calls[-2][calls[-2].index("--timeout") + 1] == "6000"


@pytest.mark.parametrize("agent_failure,expected_state", [
    ("agent_not_ready", "blocked"),
    ("agent_timeout", "unverified"),
    ("agent_start_failed", None),
])
def test_herdr_agent_unready_keeps_user_action_prompt_and_fatal_still_cleans_up(
        tmp_path, monkeypatch, agent_failure, expected_state) -> None:
    import tether.node.terminal as terminal_module

    class FakePty:
        cancelled = 0

        def isalive(self):
            return True

        def cancel_io(self):
            self.cancelled += 1

    class NoopThread:
        def __init__(self, *_args, **_kwargs):
            pass

        def start(self):
            pass

    fake_pty = FakePty()
    session = terminal_module._Session("session-herdr", str(tmp_path), "herdr",
                                       pty=fake_pty, pty_mode=True)
    terminal = TerminalService.__new__(TerminalService)
    terminal.cwd = tmp_path
    terminal.env = {}
    terminal.specs = {"herdr": ("Herdr", ["herdr"], "herdr")}
    terminal.forced_shell = ["herdr"]
    terminal.sessions = {}
    terminal._start_pty = lambda *_args, **_kwargs: session
    calls = []

    def herdr_cli(_session, _cwd, _env, arguments, _timeout):
        calls.append(arguments)
        if arguments[:2] == ["workspace", "list"]:
            return {"workspaces": [{"workspace_id": "w3"}]}
        if arguments[:2] == ["tab", "create"]:
            return {"root_pane": {"pane_id": "w3:p4", "tab_id": "w3:t5",
                                  "workspace_id": "w3"},
                    "tab": {"tab_id": "w3:t5"}}
        if arguments[:2] == ["agent", "start"]:
            if agent_failure == "agent_not_ready":
                raise terminal_module._HerdrAgentNotReady()
            if agent_failure == "agent_timeout":
                raise terminal_module._HerdrAgentNotReady("unverified")
            raise ValueError("Herdr command failed [agent_start_failed]")
        if arguments[:2] == ["tab", "close"]:
            return {"type": "ok"}
        raise AssertionError(arguments)

    terminal._herdr_cli = herdr_cli
    monkeypatch.setattr(terminal_module.threading, "Thread", NoopThread)
    request = {"shell": "herdr", "herdr_project": True,
               "herdr_agent_type": "codex", "_herdr_agent_env": {},
               "cwd": str(tmp_path)}

    if expected_state in {"blocked", "unverified"}:
        result = terminal.start(request)
        assert result["session_id"] == session.id
        assert result["agent_state"] == expected_state
        assert session.id in terminal.sessions
        assert terminal._is_alive(session)
        assert fake_pty.cancelled == 0
        assert not any(call[:2] == ["tab", "close"] for call in calls)
    else:
        with pytest.raises(ValueError, match=r"agent_start_failed"):
            terminal.start(request)
        assert session.id not in terminal.sessions
        assert session.closed
        assert fake_pty.cancelled == 1
        assert calls[-1] == ["tab", "close", "w3:t5"]


def test_herdr_capability_matches_the_current_codeg_agent_types() -> None:
    from tether.node.terminal import HERDR_AGENT_CLI_ALIASES, HERDR_AGENT_KINDS

    assert HERDR_AGENT_KINDS == {
        "codex": "codex", "claude_code": "claude", "gemini": "gemini",
        "open_code": "opencode", "cursor": "cursor", "kimi_code": "kimi",
        "qwen_code": "qwen", "qoder": "qodercli",
    }
    assert set(HERDR_AGENT_CLI_ALIASES) == set(HERDR_AGENT_KINDS)


def test_runtime_agent_cli_aliases_cover_home_terminal_actions() -> None:
    from tether.node.terminal import RUNTIME_AGENT_CLI_ALIASES

    assert set(RUNTIME_AGENT_CLI_ALIASES) == {
        "codex", "qoder", "gemini", "claude_code", "open_code", "open_claw",
        "code_buddy", "kimi_code", "minimax_code", "command_code", "cursor",
    }


@pytest.mark.parametrize("agent_type,command", [
    ("codex", "codex"), ("claude_code", "claude"), ("gemini", "gemini"),
    ("open_code", "opencode"), ("cursor", "cursor-agent"), ("kimi_code", "kimi"),
    ("qwen_code", "qwen"), ("qoder", "qodercli"),
])
def test_herdr_agent_environment_discovers_installed_cli_without_using_registry_state(
        tmp_path, agent_type, command) -> None:
    from tether.node.terminal import herdr_agent_environment

    installed = tmp_path / "vendor-cli" / (command + ".CMD")
    installed.parent.mkdir()
    installed.touch()
    env = herdr_agent_environment(agent_type, {"OPENAI_MODEL": "selected"},
                                  {"PATH": "node-task-path"},
                                  [{"id": "unrelated", "command": str(installed),
                                    "enabled": False, "available": False}])

    assert env is not None
    assert env["OPENAI_MODEL"] == "selected"
    assert str(installed.parent) in env["PATH"].split(os.pathsep)
    assert "node-task-path" in env["PATH"].split(os.pathsep)


def test_herdr_agent_environment_fails_when_cli_cannot_be_resolved(tmp_path) -> None:
    from tether.node.terminal import herdr_agent_environment

    env = herdr_agent_environment("codex", {"OPENAI_MODEL": "selected"},
                                  {"PATH": str(tmp_path)}, [])

    assert env is None


def test_herdr_agent_environment_keeps_codeg_and_node_paths_when_cli_is_resolvable(tmp_path) -> None:
    from tether.node.terminal import herdr_agent_environment

    codeg_path = tmp_path / "codeg-bin"
    node_path = tmp_path / "node-bin"
    codeg_path.mkdir()
    node_path.mkdir()
    cli = codeg_path / ("codex.CMD" if os.name == "nt" else "codex")
    cli.touch()
    if os.name != "nt":
        cli.chmod(0o755)
    env = herdr_agent_environment("codex", {"PATH": str(codeg_path)},
                                  {"PATH": str(node_path)}, None)

    assert env is not None
    assert str(codeg_path) in env["PATH"].split(os.pathsep)
    assert str(node_path) in env["PATH"].split(os.pathsep)


@pytest.mark.parametrize("error_code,phase", [
    ("command_not_found", "agent_cli_unavailable"),
    ("agent_wait_timeout", "agent_start_timeout"),
])
def test_herdr_cli_reports_only_an_allowlisted_agent_failure_phase(
        tmp_path, monkeypatch, error_code, phase) -> None:
    from types import SimpleNamespace
    import tether.node.terminal as terminal_module

    terminal = TerminalService(tmp_path)
    monkeypatch.setattr(terminal_module, "_herdr_binary", lambda: "herdr.exe")
    monkeypatch.setattr(terminal_module.subprocess, "run", lambda *_args, **_kwargs:
                        SimpleNamespace(returncode=1,
                                        stdout='{"error":{"code":"' + error_code + '",'
                                               '"message":"secret payload"}}',
                                        stderr="secret stderr"))

    with pytest.raises(ValueError, match=rf"Herdr command failed \[{phase}\]") as exc:
        terminal._herdr_cli("qa-session", tmp_path, {}, ["agent", "start", "codex"], 1.0)

    assert "secret" not in str(exc.value)


def test_herdr_cli_timeout_code_returns_unverified_without_error_text(tmp_path, monkeypatch) -> None:
    from types import SimpleNamespace
    import tether.node.terminal as terminal_module

    terminal = TerminalService(tmp_path)
    monkeypatch.setattr(terminal_module, "_herdr_binary", lambda: "herdr.exe")
    monkeypatch.setattr(terminal_module.subprocess, "run", lambda *_args, **_kwargs:
        SimpleNamespace(returncode=1,
                        stdout='{"error":{"code":"timeout","message":"secret payload"}}',
                        stderr="secret stderr"))

    with pytest.raises(terminal_module._HerdrAgentNotReady) as exc:
        terminal._herdr_cli("qa-session", tmp_path, {}, ["agent", "start", "codex"], 7.0)

    assert exc.value.state == "unverified"
    assert "secret" not in str(exc.value)


def test_herdr_cli_subprocess_timeout_remains_fatal(tmp_path, monkeypatch) -> None:
    import tether.node.terminal as terminal_module

    terminal = TerminalService(tmp_path)
    monkeypatch.setattr(terminal_module, "_herdr_binary", lambda: "herdr.exe")
    def subprocess_timeout(*_args, **_kwargs):
        raise terminal_module.subprocess.TimeoutExpired("herdr", timeout=7.0)
    monkeypatch.setattr(terminal_module.subprocess, "run", subprocess_timeout)

    with pytest.raises(ValueError, match="agent_start_timeout"):
        terminal._herdr_cli("qa-session", tmp_path, {}, ["agent", "start", "codex"], 7.0)


def test_herdr_project_session_metadata_exists_on_posix(tmp_path) -> None:
    from tether.node.terminal import _herdr_project_launch

    command, env = _herdr_project_launch("herdr", ["herdr"], tmp_path, None, windows=False)

    assert command == ["herdr", "--session", env["TETHER_HERDR_SESSION"]]
    assert env["TETHER_HERDR_SESSION"].startswith("tether-project-")


def test_herdr_agent_rejects_missing_project_cwd_before_terminal_fallback(tmp_path) -> None:
    terminal = TerminalService(tmp_path, shells={"herdr": ("Herdr", ["herdr"], "herdr")})

    with pytest.raises(ValueError, match="Herdr project directory is unavailable"):
        terminal.start({"shell": "herdr", "herdr_project": True,
                        "herdr_agent_type": "codex", "_herdr_agent_env": {},
                        "cwd": str(tmp_path / "missing")})


def test_herdr_agent_environment_overrides_private_xdg_with_user_defaults(tmp_path) -> None:
    terminal = TerminalService(tmp_path, env={}, shells={"herdr": ("Herdr", ["herdr"], "herdr")})

    env = terminal._herdr_agent_environment({})

    assert env["APPDATA"] == (str(Path.home() / "AppData" / "Roaming") if os.name == "nt" else "")
    assert env["XDG_CONFIG_HOME"] == str(Path.home() / ".config")
    assert env["XDG_STATE_HOME"] == str(Path.home() / ".local" / "state")


def test_herdr_project_agent_uses_workspace_create_root_pane_when_new(tmp_path, monkeypatch) -> None:
    terminal = TerminalService(tmp_path, shells={
        "herdr": ("Herdr", ["herdr"], "herdr")
    })
    calls = []

    def cli(_session, _cwd, _env, arguments, _timeout):
        calls.append(arguments)
        if arguments[:2] == ["workspace", "list"]:
            return {"workspaces": []}
        if arguments[:2] == ["workspace", "create"]:
            return {"root_pane": {"pane_id": "w2:p1", "tab_id": "w2:t1", "workspace_id": "w2"},
                    "tab": {"tab_id": "w2:t1"}, "workspace": {"workspace_id": "w2"}}
        if arguments[:2] == ["agent", "start"]:
            return {"type": "agent_started"}
        raise AssertionError(arguments)

    monkeypatch.setattr(terminal, "_herdr_cli", cli)
    pane_id, tab_id, agent_state = terminal._herdr_project_pane(
        "project-session", tmp_path, {}, "codex", "codex", {})

    assert (pane_id, tab_id) == ("w2:p1", "w2:t1")
    assert agent_state == "ready"
    assert not any(call[:2] == ["tab", "create"] for call in calls)
    assert calls[-1][calls[-1].index("--pane") + 1] == "w2:p1"


def test_fs_terminal_start_uses_authenticated_record_and_registry_only_for_cli_path(tmp_path) -> None:
    from tether.node.fs_service import FsError, FsService

    class Runtime:
        calls = 0

        def agent_record(self, agent_type):
            self.calls += 1
            assert agent_type == "codex"
            return {"agent_type": agent_type, "env": {"CODEX_PROFILE": "default"}}

    class Terminal:
        args = None
        env = {"PATH": "node-task-path"}

        def dispatch(self, action, args):
            assert action == "start"
            self.args = args
            return {"session_id": "session-1", "shell": "herdr"}

    class Agents:
        def catalog(self):
            return {"agents": [{"id": "unrelated", "command": str(cli_path),
                                "enabled": False, "available": False}]}

    cli_path = tmp_path / "codex.CMD"
    cli_path.touch()

    runtime = Runtime()
    terminal = Terminal()
    fs = FsService.__new__(FsService)
    fs.agents_runtime = runtime
    fs.terminal = terminal
    fs.agents = Agents()
    request = {"shell": "herdr", "herdr_project": True, "herdr_agent_type": "codex",
               "cwd": "D:/workspace"}

    result = fs._op_terminal_start(request)

    assert result == {"session_id": "session-1", "shell": "herdr"}
    assert runtime.calls == 1
    assert terminal.args["_herdr_agent_env"]["CODEX_PROFILE"] == "default"
    assert str(tmp_path) in terminal.args["_herdr_agent_env"]["PATH"].split(os.pathsep)
    assert "node-task-path" in terminal.args["_herdr_agent_env"]["PATH"].split(os.pathsep)
    assert "_herdr_agent_env" not in result
    with pytest.raises(FsError, match="invalid Herdr agent start request"):
        fs._op_terminal_start({**request, "command": ["cmd.exe"]})
    assert runtime.calls == 1


def test_fs_runtime_agent_cli_uses_codeg_record_and_registry_only_for_path(tmp_path) -> None:
    from tether.node.fs_service import FsError, FsService

    class Runtime:
        calls = 0

        def agent_record(self, agent_type):
            self.calls += 1
            assert agent_type == "codex"
            return {"agent_type": agent_type, "env": {"CODEX_PROFILE": "shared-account"}}

    class Terminal:
        args = None
        env = {"PATH": "node-task-path"}

        def dispatch(self, action, args):
            assert action == "start"
            self.args = args
            return {"session_id": "session-cli", "shell": "agent"}

    class Agents:
        def catalog(self):
            return {"agents": [{"id": "local-record", "command": str(cli_path),
                                "enabled": False, "available": False}]}

    cli_path = tmp_path / "codex.CMD"
    cli_path.touch()
    runtime = Runtime()
    terminal = Terminal()
    fs = FsService.__new__(FsService)
    fs.agents_runtime = runtime
    fs.terminal = terminal
    fs.agents = Agents()
    request = {"runtime_agent_type": "codex", "cwd": str(tmp_path)}

    result = fs._op_terminal_start(request)

    assert result == {"session_id": "session-cli", "shell": "agent"}
    assert runtime.calls == 1
    assert terminal.args["shell"] == "agent"
    assert terminal.args["command"] == [str(cli_path)]
    assert terminal.args["_runtime_agent_env"]["CODEX_PROFILE"] == "shared-account"
    assert str(tmp_path) in terminal.args["_runtime_agent_env"]["PATH"].split(os.pathsep)
    assert "_runtime_agent_env" not in result
    with pytest.raises(FsError, match="invalid runtime agent start request"):
        fs._op_terminal_start({**request, "command": ["cmd.exe"]})
    with pytest.raises(FsError, match="invalid runtime agent start request"):
        fs._op_terminal_start({**request, "env": {"TOKEN": "must-not-pass"}})
    assert runtime.calls == 1


def test_fs_runtime_agent_cli_skips_registry_catalog_when_path_resolves(tmp_path, monkeypatch) -> None:
    from tether.node.fs_service import FsService
    from tether.node import terminal as terminal_module

    cli_path = tmp_path / "codex"
    cli_path.touch()

    class Runtime:
        calls = 0

        def agent_record(self, agent_type):
            self.calls += 1
            assert agent_type == "codex"
            return {"agent_type": agent_type, "env": {"CODEX_PROFILE": "shared-account"}}

    class Terminal:
        env = {"PATH": "node-path"}
        args = None

        def dispatch(self, action, args):
            assert action == "start"
            self.args = args
            return {"session_id": "session-path", "shell": "agent"}

    class Agents:
        def catalog(self):
            raise AssertionError("Node registry catalog must not run for PATH-resolved CLIs")

    monkeypatch.setattr(
        terminal_module.shutil, "which",
        lambda alias, path=None: str(cli_path) if alias == "codex" else None,
    )
    runtime = Runtime()
    terminal = Terminal()
    fs = FsService.__new__(FsService)
    fs.agents_runtime = runtime
    fs.terminal = terminal
    fs.agents = Agents()

    result = fs._op_terminal_start({"runtime_agent_type": "codex", "cwd": str(tmp_path)})

    assert result["session_id"] == "session-path"
    assert runtime.calls == 1
    assert terminal.args["command"] == [str(cli_path)]
    assert terminal.args["_runtime_agent_env"]["CODEX_PROFILE"] == "shared-account"
    assert "node-path" in terminal.args["_runtime_agent_env"]["PATH"]


def test_runtime_agent_cli_requires_real_project_cwd_and_uses_agent_pty(tmp_path) -> None:
    import sys

    terminal = TerminalService(tmp_path)
    with pytest.raises(ValueError, match="Agent project directory is unavailable"):
        terminal.start({"runtime_agent_type": "codex", "shell": "agent",
                        "command": [sys.executable], "_runtime_agent_env": {},
                        "cwd": str(tmp_path / "missing")})
    session = terminal.start({"runtime_agent_type": "codex", "shell": "agent",
                              "command": [sys.executable, "-c", "import os; print(os.environ['CODEX_PROFILE'])"],
                              "_runtime_agent_env": {"CODEX_PROFILE": "shared-account"},
                              "cwd": str(tmp_path)})
    try:
        output = b""
        since = 0
        deadline = time.time() + 10
        while time.time() < deadline:
            result = terminal.poll({"session_id": session["session_id"], "since": since})
            since = result["next"]
            output += base64.b64decode(result["data"])
            if b"shared-account" in output:
                break
            time.sleep(0.1)
        assert b"shared-account" in output
        assert session["shell"] == "agent"
        assert session["cwd"] == str(tmp_path)
    finally:
        terminal.stop({"session_id": session["session_id"]})


def test_runtime_agent_windows_cmd_shim_remains_in_agent_pty() -> None:
    from tether.node.terminal import _windows_pty_command

    assert _windows_pty_command("agent", ["codex.cmd", "--help"]) == [
        "cmd.exe", "/d", "/s", "/c", 'codex.cmd --help'
    ]


def test_terminal_falls_back_for_bad_cwd_and_rejects_bad_shell(tmp_path) -> None:
    terminal = TerminalService(tmp_path)
    with pytest.raises(ValueError, match="Herdr project directory is unavailable"):
        terminal.start({"shell": "herdr", "herdr_project": True, "cwd": str(tmp_path / "missing")})
    session = terminal.start({"cwd": str(tmp_path / "missing")})
    try:
        assert Path(session["cwd"]).resolve() == tmp_path.resolve()
    finally:
        terminal.stop({"session_id": session["session_id"]})
    with pytest.raises(ValueError):
        terminal.start({"shell": "tether-no-such-shell"})


def test_terminal_reports_pty_and_resizes(tmp_path) -> None:
    if os.name == "nt":
        pytest.importorskip("winpty")
    terminal = TerminalService(tmp_path)
    session = terminal.start({})
    try:
        assert session["pty"] is True
        result = terminal.resize({"session_id": session["session_id"], "cols": 92, "rows": 26})
        assert result["cols"] == 92
        assert result["rows"] == 26
        with pytest.raises(ValueError):
            terminal.resize({"session_id": session["session_id"], "cols": 0, "rows": 0})
    finally:
        terminal.stop({"session_id": session["session_id"]})
