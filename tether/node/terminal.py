"""Owner-scoped remote shell sessions on a Tether node.

The Node picks a shell that exists on the target OS (PowerShell/cmd/Git Bash on
Windows; login shell/bash/zsh/sh on POSIX).  Each session keeps its own working
directory and returns byte increments so the UI can poll without a second
WebSocket.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MAX_BUFFER = 512 * 1024
MAX_POLL = 128 * 1024
NO_WINDOW = 0x08000000
DEFAULT_COLS = 120
DEFAULT_ROWS = 30
HERDR_AGENT_KINDS = {
    "codex": "codex", "claude_code": "claude", "gemini": "gemini",
    "open_code": "opencode", "cursor": "cursor", "kimi_code": "kimi",
    "qwen_code": "qwen", "qoder": "qodercli",
}
HERDR_AGENT_CLI_ALIASES = {
    "codex": ("codex",), "claude_code": ("claude",), "gemini": ("gemini",),
    "open_code": ("opencode",), "cursor": ("cursor-agent", "cursor"),
    "kimi_code": ("kimi",), "qwen_code": ("qwen",),
    "qoder": ("qodercli", "qoder", "qoder-cli"),
}
RUNTIME_AGENT_CLI_ALIASES = {
    **{key: value for key, value in HERDR_AGENT_CLI_ALIASES.items()
       if key != "qwen_code"},
    "open_claw": ("openclaw",), "code_buddy": ("codebuddy",),
    "minimax_code": ("mcode",), "command_code": ("command-code",),
}
_HERDR_ERROR_PHASES = {
    "server_not_running", "workspace_command_failed", "workspace_command_timeout",
    "invalid_response", "agent_cli_unavailable", "agent_start_failed",
    "agent_start_timeout",
}
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def herdr_agent_kind(agent_type: str) -> str | None:
    return HERDR_AGENT_KINDS.get(agent_type)


def _path_join(*values: str) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for value in values:
        for raw in value.split(os.pathsep):
            item = raw.strip()
            if not item:
                continue
            key = os.path.normcase(os.path.normpath(item))
            if key not in seen:
                seen.add(key)
                parts.append(item)
    return os.pathsep.join(parts)


def _agent_command_path(agent_type: str, records: list[dict[str, Any]],
                        aliases: tuple[str, ...]) -> str:
    for alias in aliases:
        for record in records:
            command = record.get("command") if isinstance(record, dict) else None
            if not isinstance(command, str) or not command:
                continue
            candidate = Path(command)
            if candidate.stem.lower() == alias.lower() and candidate.is_file():
                return str(candidate)
    return ""


def herdr_agent_command_path(agent_type: str, records: list[dict[str, Any]]) -> str:
    return _agent_command_path(agent_type, records, HERDR_AGENT_CLI_ALIASES.get(agent_type, ()))


def runtime_agent_command_path(agent_type: str, env: dict[str, str],
                               records: list[dict[str, Any]]) -> str:
    path = env.get("PATH", "")
    aliases = RUNTIME_AGENT_CLI_ALIASES.get(agent_type, ())
    for alias in aliases:
        command = shutil.which(alias, path=path)
        if command:
            return command
    return _agent_command_path(agent_type, records, aliases)


def _agent_environment(agent_type: str, configured: dict[str, str],
                        node_env: dict[str, str], records: list[dict[str, Any]] | None,
                        aliases: tuple[str, ...]) -> dict[str, str] | None:
    if not aliases:
        return None
    env = {
        "APPDATA": node_env.get("APPDATA") or
            (str(Path.home() / "AppData" / "Roaming") if os.name == "nt" else ""),
        "XDG_CONFIG_HOME": node_env.get("XDG_CONFIG_HOME") or str(Path.home() / ".config"),
        "XDG_STATE_HOME": node_env.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state"),
    }
    env.update(configured)
    path = _path_join(env.get("PATH", ""), node_env.get("PATH", ""))
    if path:
        env["PATH"] = path
    if any(shutil.which(alias, path=path) for alias in aliases):
        return env
    command = _agent_command_path(agent_type, records or [], aliases)
    if not command:
        return None
    env["PATH"] = _path_join(path, str(Path(command).parent))
    return env


def herdr_agent_environment(agent_type: str, configured: dict[str, str],
                            node_env: dict[str, str],
                            records: list[dict[str, Any]] | None = None) -> dict[str, str] | None:
    return _agent_environment(agent_type, configured, node_env, records,
                              HERDR_AGENT_CLI_ALIASES.get(agent_type, ()))


def runtime_agent_environment(agent_type: str, configured: dict[str, str],
                              node_env: dict[str, str],
                              records: list[dict[str, Any]] | None = None) -> dict[str, str] | None:
    return _agent_environment(agent_type, configured, node_env, records,
                              RUNTIME_AGENT_CLI_ALIASES.get(agent_type, ()))


PS_INIT = (
    "chcp 65001 > $null; "
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; "
    "[Console]::InputEncoding=[Text.Encoding]::UTF8; "
    "$OutputEncoding=[Text.Encoding]::UTF8"
)


def _current_user() -> str:
    try:
        import getpass
        return getpass.getuser()
    except Exception:
        return str(os.environ.get("USERNAME") or os.environ.get("USER") or "")


def _is_privileged() -> bool:
    if os.name == "nt":
        try:
            import ctypes
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            return False
    try:
        return os.geteuid() == 0
    except AttributeError:
        return False


@dataclass
class _Session:
    id: str
    cwd: str
    shell: str
    process: subprocess.Popen[bytes] | None = None
    pty: Any | None = None
    fd: int | None = None
    pty_mode: bool = False
    cols: int = DEFAULT_COLS
    rows: int = DEFAULT_ROWS
    buffer: bytearray = field(default_factory=bytearray)
    lock: threading.Lock = field(default_factory=threading.Lock)
    total: int = 0
    closed: bool = False
    reader: threading.Thread | None = None

    @property
    def pid(self) -> int | None:
        if self.pty is not None:
            return getattr(self.pty, "pid", None)
        return self.process.pid if self.process is not None else None


def _herdr_binary() -> str:
    import platform
    name = ""
    if os.name == "nt":
        name = "herdr.exe"
    else:
        machine = platform.machine().lower()
        if machine in ("arm64", "aarch64"):
            name = "herdr-macos-aarch64" if platform.system() == "Darwin" else "herdr-linux-aarch64"
        else:
            name = "herdr-macos-x86_64" if platform.system() == "Darwin" else "herdr-linux-x86_64"
    runtime_dir = os.environ.get("TETHER_HERDR_RUNTIME_DIR")
    bundled_root = Path(runtime_dir).resolve() if runtime_dir else Path(__file__).with_name("bin")
    bundled = bundled_root / name
    if bundled.is_file():
        if os.name != "nt":
            try:
                os.chmod(bundled, 0o755)
            except OSError:
                pass
        return str(bundled)
    if runtime_dir:
        return ""
    return shutil.which("herdr") or ""


def _herdr_wrapper(herdr: str) -> str:
    from .agent_registry import agent_home
    home = agent_home()
    wrapper = Path.home() / ".tether" / "herdr" / "herdr.cmd"
    try:
        wrapper.parent.mkdir(parents=True, exist_ok=True)
        local = wrapper.parent / "herdr.exe"
        if not local.is_file() or local.stat().st_size != Path(herdr).stat().st_size:
            import shutil as _shutil
            _shutil.copy2(herdr, local)
        state = wrapper.parent
        lines = [
            "@echo off",
            'set "HERDR_HOME=' + str(state) + '"',
            'set "XDG_CONFIG_HOME=' + str(state / "config") + '"',
            'set "XDG_STATE_HOME=' + str(state / "state") + '"',
            'set "APPDATA=' + str(state / "appdata") + '"',
            'set "PATH=' + str(home) + ';' + str(home / "node_modules" / ".bin") + ';%PATH%"',
            'if not defined TETHER_HERDR_SESSION set "TETHER_HERDR_SESSION=tether"',
            '"%~dp0herdr.exe" --session "%TETHER_HERDR_SESSION%" %*',
            "",
        ]
        wrapper.write_text(chr(10).join(lines), encoding="ascii")
    except OSError:
        return herdr
    return str(wrapper)


def _herdr_project_launch(shell_id: str, command: list[str], cwd: Path,
                          extra_env: dict[str, str] | None, *, windows: bool) -> tuple[list[str], dict[str, str] | None]:
    if shell_id != "herdr":
        return command, extra_env
    digest = hashlib.sha256(os.fsencode(str(cwd.resolve()))).hexdigest()[:20]
    session = "tether-project-" + digest
    session_env = {**(extra_env or {}), "TETHER_HERDR_SESSION": session}
    if windows:
        return command, session_env
    return [command[0], "--session", session], session_env


def _windows_shells() -> dict[str, tuple[str, list[str], str]]:
    specs = {
        "powershell": ("Windows PowerShell",
                       ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"],
                       "powershell.exe"),
        "pwsh": ("PowerShell 7",
                 ["pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"], "pwsh.exe"),
        "cmd": ("命令提示符", ["cmd.exe", "/Q"], "cmd.exe"),
        "bash": ("Git Bash", ["bash.exe", "--noprofile", "--norc"], "bash.exe"),
    }
    herdr = _herdr_binary()
    if herdr:
        specs["herdr"] = ("Herdr 工作区", ["cmd.exe", "/d", "/s", "/c", _herdr_wrapper(herdr)], herdr)
    return specs


def _posix_shells() -> dict[str, tuple[str, list[str], str]]:
    specs = {
        "bash": ("bash", ["/bin/bash"], "/bin/bash"),
        "zsh": ("zsh", ["/bin/zsh"], "/bin/zsh"),
        "sh": ("sh", ["/bin/sh"], "/bin/sh"),
        "fish": ("fish", ["/usr/bin/fish"], "fish"),
    }
    herdr = _herdr_binary()
    if herdr:
        specs["herdr"] = ("Herdr 工作区", [herdr, "--session", "tether"], herdr)
    return specs


def _windows_pty_command(shell_id: str, command: list[str]) -> list[str]:
    exe = command[0]
    if shell_id == "agent":
        if exe.lower().endswith((".cmd", ".bat")):
            return ["cmd.exe", "/d", "/s", "/c", subprocess.list2cmdline(command)]
        return list(command)
    if shell_id == "herdr":
        return list(command)
    if shell_id in {"powershell", "pwsh"}:
        return [exe, "-NoLogo", "-NoExit", "-Command", PS_INIT]
    if shell_id == "cmd":
        return [exe, "/Q", "/K", "chcp 65001>NUL"]
    if shell_id == "bash":
        return [exe, "-i", "-l"]
    return [exe, "-i"]


def _posix_pty_command(command: list[str]) -> list[str]:
    exe = command[0]
    if exe.endswith(("bash", "zsh", "sh", "fish")):
        return [exe, "-l"]
    return list(command)


class _HerdrServerNotReady(Exception):
    pass


class _HerdrAgentNotReady(Exception):
    def __init__(self, state: str = "blocked") -> None:
        super().__init__()
        self.state = state


class TerminalService:
    def __init__(self, cwd: Path | str, *, shell: list[str] | None = None,
                 env: dict[str, str] | None = None,
                 shells: dict[str, tuple[str, list[str], str]] | None = None) -> None:
        self.cwd = Path(cwd)
        self.env = dict(env or os.environ)
        self.specs = shells or (_windows_shells() if os.name == "nt" else _posix_shells())
        self.forced_shell = list(shell) if shell else None
        self.sessions: dict[str, _Session] = {}
        if "herdr" in self.specs:
            home = Path.home() / ".tether" / "herdr"
            try:
                home.mkdir(parents=True, exist_ok=True)
            except OSError:
                pass
            os.environ.setdefault("HERDR_HOME", str(home))

    def _available(self, spec: tuple[str, list[str], str]) -> bool:
        candidate = spec[2]
        if os.path.isabs(candidate):
            return Path(candidate).is_file()
        return bool(shutil.which(candidate))

    def shells(self) -> list[dict[str, Any]]:
        default = self.default_shell_id()
        return [{"id": shell_id, "name": spec[0], "default": shell_id == default,
                 "available": self._available(spec), "project_sessions": shell_id == "herdr"}
                for shell_id, spec in self.specs.items()]

    def default_shell_id(self) -> str:
        forced = str(self.env.get("TETHER_TERMINAL_SHELL") or "").strip()
        candidates = ([forced] if forced else []) + list(self.specs)
        if os.name != "nt":
            login = Path(self.env.get("SHELL") or "").name
            if login in self.specs:
                candidates.insert(0, login)
        for shell_id in candidates:
            spec = self.specs.get(shell_id)
            if spec and self._available(spec):
                return shell_id
        return next(iter(self.specs))

    def _resolve_shell(self, shell_id: str | None) -> tuple[str, list[str]]:
        if self.forced_shell:
            name = (shell_id or "custom")
            return name, list(self.forced_shell)
        chosen = (shell_id or self.default_shell_id()).strip()
        spec = self.specs.get(chosen)
        if spec is None:
            raise ValueError("unknown terminal shell")
        if not self._available(spec):
            raise ValueError("terminal shell is not installed on this node")
        return chosen, list(spec[1])

    def _append(self, session: _Session, data: bytes) -> None:
        if not data:
            return
        with session.lock:
            session.buffer.extend(data)
            session.total += len(data)
            if len(session.buffer) > MAX_BUFFER:
                del session.buffer[:len(session.buffer) - MAX_BUFFER]

    def _read_pty_win(self, session: _Session) -> None:
        pty = session.pty
        try:
            while True:
                try:
                    chunk = pty.read(blocking=True)
                except Exception:
                    break
                if chunk is None:
                    continue
                if isinstance(chunk, str):
                    if not chunk:
                        break
                    data = chunk.encode("utf-8", "replace")
                else:
                    data = bytes(chunk)
                if not data:
                    continue
                self._append(session, data)
        finally:
            session.closed = True

    def _read_pty_posix(self, session: _Session) -> None:
        fd = session.fd
        if fd is None:
            session.closed = True
            return
        try:
            while not session.closed:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                self._append(session, data)
        finally:
            session.closed = True

    def _read_pipe(self, session: _Session) -> None:
        stream = session.process.stdout
        if stream is None:
            session.closed = True
            return
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                self._append(session, chunk)
        finally:
            session.closed = True

    def _session_env(self, shell_id: str, extra: dict[str, str] | None = None) -> dict[str, str]:
        env = dict(self.env)
        if extra:
            env.update({str(key): str(value) for key, value in extra.items()})
        if shell_id == "herdr":
            try:
                from .agent_registry import agent_home
                home = agent_home()
                parts = [str(home), str(home / "node_modules" / ".bin")]
                env["PATH"] = os.pathsep.join(parts + [env.get("PATH", "")])
            except Exception:
                pass
            home = Path.home() / ".tether" / "herdr"
            for name in ("config", "state", "appdata"):
                try:
                    (home / name).mkdir(parents=True, exist_ok=True)
                except OSError:
                    pass
            env.update({"HERDR_HOME": str(home), "XDG_CONFIG_HOME": str(home / "config"),
                        "XDG_STATE_HOME": str(home / "state")})
            if os.name == "nt":
                env["APPDATA"] = str(home / "appdata")
        return env

    def _start_pty(self, command: list[str], shell_id: str, cwd: Path,
                   cols: int, rows: int, extra_env: dict[str, str] | None = None) -> _Session | None:
        if os.name == "nt":
            try:
                from winpty import PTY
            except Exception:
                return None
            pty_command = _windows_pty_command(shell_id, command)
            try:
                pty = PTY(cols, rows)
                cmdline = subprocess.list2cmdline(pty_command[1:])
                saved = {}
                scoped = self._session_env(shell_id, extra_env) if (shell_id == "herdr" or extra_env) else {}
                for key, value in scoped.items():
                    saved[key] = os.environ.get(key)
                    os.environ[key] = value
                try:
                    ok = pty.spawn(pty_command[0], cmdline, cwd=str(cwd), env=None)
                finally:
                    for key, value in saved.items():
                        if value is None:
                            os.environ.pop(key, None)
                        else:
                            os.environ[key] = value
                if not ok:
                    return None
            except Exception:
                return None
            return _Session(secrets.token_hex(12), str(cwd), shell_id,
                            pty=pty, pty_mode=True, cols=cols, rows=rows)

        try:
            import fcntl
            import pty as pty_module
            import struct
            import termios
        except Exception:
            return None
        try:
            master, slave = pty_module.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            env = self._session_env(shell_id, extra_env)
            env.setdefault("TERM", "xterm-256color")
            env.setdefault("COLORTERM", "truecolor")
            pty_command = _posix_pty_command(command)
            process = subprocess.Popen(pty_command, cwd=str(cwd), env=env,
                                       stdin=slave, stdout=slave, stderr=slave,
                                       start_new_session=True, close_fds=True)
            os.close(slave)
        except Exception:
            return None
        return _Session(secrets.token_hex(12), str(cwd), shell_id,
                        process=process, fd=master, pty_mode=True,
                        cols=cols, rows=rows)

    def _herdr_cli(self, session: str, cwd: Path, env: dict[str, str],
                   arguments: list[str], timeout: float) -> dict[str, Any]:
        binary = _herdr_binary()
        if not binary:
            raise ValueError("Herdr is not installed on this node")
        agent_start = arguments[:2] == ["agent", "start"]
        kwargs: dict[str, Any] = {
            "cwd": str(cwd), "env": env, "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE, "stderr": subprocess.PIPE,
            "text": True, "encoding": "utf-8", "errors": "replace", "timeout": timeout,
        }
        if os.name == "nt":
            kwargs["creationflags"] = NO_WINDOW
        try:
            result = subprocess.run([binary, "--session", session, *arguments], **kwargs)
        except subprocess.TimeoutExpired:
            phase = "agent_start_timeout" if agent_start else "workspace_command_timeout"
            raise ValueError("Herdr command failed [" + phase + "]") from None
        except OSError:
            phase = "agent_cli_unavailable" if agent_start else "workspace_command_failed"
            raise ValueError("Herdr command failed [" + phase + "]") from None
        try:
            payload = json.loads(result.stdout or result.stderr)
        except (ValueError, TypeError):
            raise ValueError("Herdr command failed [invalid_response]") from None
        if result.returncode or not isinstance(payload, dict) or payload.get("error"):
            error = payload.get("error") if isinstance(payload, dict) else None
            code = error.get("code") if isinstance(error, dict) else ""
            if code == "server_not_running":
                raise _HerdrServerNotReady()
            if agent_start:
                if code == "agent_not_ready":
                    raise _HerdrAgentNotReady()
                if code == "timeout":
                    raise _HerdrAgentNotReady("unverified")
                phase = ("agent_cli_unavailable" if code in {
                    "command_not_found", "executable_not_found", "agent_not_found"}
                    else "agent_start_timeout" if code == "agent_wait_timeout"
                    else "agent_start_failed")
            else:
                phase = "workspace_command_failed"
            if phase not in _HERDR_ERROR_PHASES:
                phase = "workspace_command_failed"
            raise ValueError("Herdr command failed [" + phase + "]")
        result_data = payload.get("result")
        if not isinstance(result_data, dict):
            raise ValueError("Herdr command failed [invalid_response]")
        return result_data

    def _herdr_agent_environment(self, configured: dict[str, str]) -> dict[str, str]:
        env = {
            "APPDATA": self.env.get("APPDATA") or
                (str(Path.home() / "AppData" / "Roaming") if os.name == "nt" else ""),
            "XDG_CONFIG_HOME": self.env.get("XDG_CONFIG_HOME") or str(Path.home() / ".config"),
            "XDG_STATE_HOME": self.env.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state"),
        }
        env.update(configured)
        return env

    def _herdr_project_pane(self, session: str, cwd: Path, env: dict[str, str],
                            agent_type: str, agent_kind: str,
                            agent_env: dict[str, str]) -> tuple[str, str | None, str]:
        deadline = time.monotonic() + 1.5
        workspaces: list[dict[str, Any]] | None = None
        while time.monotonic() < deadline:
            try:
                result = self._herdr_cli(session, cwd, env, ["workspace", "list"], 0.5)
                raw = result.get("workspaces")
                if not isinstance(raw, list) or any(not isinstance(item, dict) for item in raw):
                    raise ValueError("Herdr workspace list is invalid")
                workspaces = raw
                break
            except _HerdrServerNotReady:
                time.sleep(0.25)
        if workspaces is None:
            raise ValueError("Herdr project session did not become ready")

        label = "Tether " + (cwd.name or "workspace")
        create_env = [item for key, value in sorted(agent_env.items()) for item in ("--env", key + "=" + value)]
        created_tab: str | None = None
        try:
            if workspaces:
                workspace_id = workspaces[0].get("workspace_id")
                if not isinstance(workspace_id, str) or not workspace_id:
                    raise ValueError("Herdr workspace list is invalid")
                created = self._herdr_cli(session, cwd, env,
                    ["tab", "create", "--workspace", workspace_id, "--cwd", str(cwd),
                     "--label", label, "--focus", *create_env], 1.5)
                root_pane = created.get("root_pane")
                tab = created.get("tab")
                pane_id = root_pane.get("pane_id") if isinstance(root_pane, dict) else None
                tab_id = tab.get("tab_id") if isinstance(tab, dict) else None
                if isinstance(tab_id, str) and tab_id.startswith(workspace_id + ":t"):
                    created_tab = tab_id
                if (not isinstance(pane_id, str) or not pane_id.startswith(workspace_id + ":p")
                        or not created_tab or root_pane.get("workspace_id") != workspace_id
                        or root_pane.get("tab_id") != tab_id):
                    raise ValueError("Herdr tab creation returned invalid pane identity")
            else:
                created = self._herdr_cli(session, cwd, env,
                    ["workspace", "create", "--cwd", str(cwd), "--label", label,
                     "--focus", *create_env], 1.5)
                root_pane = created.get("root_pane")
                workspace = created.get("workspace")
                tab = created.get("tab")
                pane_id = root_pane.get("pane_id") if isinstance(root_pane, dict) else None
                workspace_id = workspace.get("workspace_id") if isinstance(workspace, dict) else None
                tab_id = tab.get("tab_id") if isinstance(tab, dict) else None
                if isinstance(workspace_id, str) and isinstance(tab_id, str) and tab_id.startswith(workspace_id + ":t"):
                    created_tab = tab_id
                if (not isinstance(workspace_id, str) or not isinstance(tab_id, str)
                        or not isinstance(pane_id, str) or not pane_id.startswith(workspace_id + ":p")
                        or not created_tab or root_pane.get("workspace_id") != workspace_id
                        or root_pane.get("tab_id") != tab_id):
                    raise ValueError("Herdr workspace creation returned invalid pane identity")

            try:
                self._herdr_cli(session, cwd, env,
                    ["agent", "start", agent_type, "--kind", agent_kind, "--pane", pane_id,
                     "--timeout", "6000"], 7.0)
            except _HerdrAgentNotReady as not_ready:
                return pane_id, created_tab, not_ready.state
            return pane_id, created_tab, "ready"
        except Exception:
            if created_tab:
                try:
                    self._herdr_cli(session, cwd, env, ["tab", "close", created_tab], 0.8)
                except Exception:
                    pass
            raise

    def start(self, args: dict[str, Any]) -> dict[str, Any]:
        requested_cwd = args.get("cwd")
        cwd = Path(str(requested_cwd or self.cwd)).expanduser()
        runtime_agent_type = args.get("runtime_agent_type")
        runtime_agent_env = args.get("_runtime_agent_env")
        runtime_agent_start = runtime_agent_type is not None or "_runtime_agent_env" in args
        herdr_agent_request = args.get("herdr_agent_type") is not None or "_herdr_agent_env" in args
        if runtime_agent_start and (not requested_cwd or not cwd.is_dir()):
            raise ValueError("Agent project directory is unavailable")
        if herdr_agent_request and (not requested_cwd or not cwd.is_dir()):
            raise ValueError("Herdr project directory is unavailable")
        if args.get("herdr_project") is True and args.get("shell") == "herdr" and (not requested_cwd or not cwd.is_dir()):
            raise ValueError("Herdr project directory is unavailable")
        if not cwd.is_dir():
            fallback = Path(self.cwd).expanduser()
            cwd = fallback if fallback.is_dir() else Path.home()
        if not cwd.is_dir():
            raise ValueError("terminal cwd is not a directory")
        herdr_agent_type = args.get("herdr_agent_type")
        herdr_agent_env = args.get("_herdr_agent_env")
        herdr_agent_start = herdr_agent_type is not None or "_herdr_agent_env" in args
        raw_command = args.get("command")
        if runtime_agent_start:
            if (not isinstance(runtime_agent_type, str) or runtime_agent_type not in RUNTIME_AGENT_CLI_ALIASES
                    or args.get("shell") != "agent" or not isinstance(raw_command, list)
                    or not raw_command or not all(isinstance(item, str) for item in raw_command)
                    or not isinstance(runtime_agent_env, dict)
                    or any(not isinstance(key, str) or not _ENV_NAME_RE.fullmatch(key)
                           or not isinstance(value, str) for key, value in runtime_agent_env.items())
                    or any(key in args for key in ("agent", "env", "herdr_agent_type", "herdr_project",
                                                   "_herdr_agent_env"))):
                raise ValueError("invalid runtime agent start request")
        if herdr_agent_start:
            if (args.get("shell") != "herdr" or args.get("herdr_project") is not True
                    or "command" in args or "agent" in args or "env" in args
                    or not isinstance(herdr_agent_type, str) or not herdr_agent_type
                    or herdr_agent_kind(herdr_agent_type) is None
                    or not isinstance(herdr_agent_env, dict)
                    or any(not isinstance(key, str) or not _ENV_NAME_RE.fullmatch(key)
                           or not isinstance(value, str) for key, value in herdr_agent_env.items())):
                raise ValueError("invalid Herdr agent start request")
        if isinstance(raw_command, list) and raw_command and all(isinstance(item, str) for item in raw_command):
            shell_id, command = "agent", list(raw_command)
        else:
            shell_id, command = self._resolve_shell(args.get("shell"))
        try:
            cols = max(2, min(500, int(args.get("cols") or DEFAULT_COLS)))
            rows = max(1, min(300, int(args.get("rows") or DEFAULT_ROWS)))
        except (TypeError, ValueError):
            cols, rows = DEFAULT_COLS, DEFAULT_ROWS
        raw_env = args.get("env")
        extra_env = {str(k): str(v) for k, v in raw_env.items()} if isinstance(raw_env, dict) else None
        if runtime_agent_start:
            extra_env = dict(runtime_agent_env)
        if args.get("herdr_project") is True:
            command, extra_env = _herdr_project_launch(shell_id, command, cwd, extra_env,
                                                       windows=os.name == "nt")
        session = self._start_pty(command, shell_id, cwd, cols, rows, extra_env)
        if session is None:
            kwargs: dict[str, Any] = {
                "cwd": str(cwd),
                "env": self._session_env(shell_id, extra_env),
                "stdin": subprocess.PIPE,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.STDOUT,
                "bufsize": 0,
            }
            if os.name == "nt":
                kwargs["creationflags"] = NO_WINDOW
            else:
                kwargs["start_new_session"] = True
            process = subprocess.Popen(command, **kwargs)
            session = _Session(secrets.token_hex(12), str(cwd), shell_id,
                               process=process, cols=cols, rows=rows)
            reader = threading.Thread(target=self._read_pipe, args=(session,), daemon=True)
        else:
            target = self._read_pty_win if os.name == "nt" else self._read_pty_posix
            reader = threading.Thread(target=target, args=(session,), daemon=True)
        reader.start()
        session.reader = reader
        self.sessions[session.id] = session
        agent_state = None
        if herdr_agent_start:
            project_session = (extra_env or {}).get("TETHER_HERDR_SESSION", "")
            try:
                if not project_session:
                    raise ValueError("Herdr project session is unavailable")
                _, _, agent_state = self._herdr_project_pane(project_session, cwd,
                    self._session_env("herdr", extra_env), herdr_agent_type,
                    herdr_agent_kind(herdr_agent_type),
                    self._herdr_agent_environment(herdr_agent_env))
            except Exception:
                self.stop({"session_id": session.id})
                raise
        result = {"session_id": session.id, "shell": shell_id, "command": command[0],
                  "cwd": str(cwd), "pid": session.pid, "pty": session.pty_mode,
                  "cols": cols, "rows": rows, "user": _current_user(),
                  "privileged": _is_privileged()}
        if agent_state is not None:
            result["agent_state"] = agent_state
        return result

    def _find(self, args: dict[str, Any]) -> _Session:
        session = self.sessions.get(str(args.get("session_id") or ""))
        if session is None:
            raise ValueError("terminal session not found")
        return session

    def _is_alive(self, session: _Session) -> bool:
        if session.closed:
            return False
        if session.pty is not None:
            try:
                return bool(session.pty.isalive())
            except Exception:
                return False
        if session.process is not None:
            return session.process.poll() is None
        return False

    def write(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        try:
            data = base64.b64decode(str(args.get("data") or ""), validate=True)
        except (ValueError, TypeError):
            raise ValueError("terminal input must be base64") from None
        if session.closed or not self._is_alive(session):
            raise ValueError("terminal session is closed")
        if session.pty is not None:
            try:
                count = session.pty.write(data.decode("utf-8", "replace"))
            except Exception as exc:
                raise ValueError("terminal session is closed") from exc
            return {"session_id": session.id, "written": int(count or 0)}
        if session.fd is not None:
            try:
                count = os.write(session.fd, data)
            except OSError as exc:
                raise ValueError("terminal session is closed") from exc
            return {"session_id": session.id, "written": count}
        if session.process is None or session.process.stdin is None:
            raise ValueError("terminal session is closed")
        try:
            session.process.stdin.write(data)
            session.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise ValueError("terminal session is closed") from exc
        return {"session_id": session.id, "written": len(data)}

    def resize(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        try:
            cols = int(args.get("cols") or 0)
            rows = int(args.get("rows") or 0)
        except (TypeError, ValueError):
            raise ValueError("terminal size is invalid") from None
        if cols < 2 or cols > 500 or rows < 1 or rows > 300:
            raise ValueError("terminal size is invalid")
        if not self._is_alive(session):
            raise ValueError("terminal session is closed")
        if session.pty is not None:
            try:
                session.pty.set_size(cols, rows)
            except Exception as exc:
                raise ValueError("terminal resize failed") from exc
        elif session.fd is not None:
            try:
                import fcntl
                import struct
                import termios
                fcntl.ioctl(session.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            except Exception as exc:
                raise ValueError("terminal resize failed") from exc
        session.cols, session.rows = cols, rows
        return {"session_id": session.id, "cols": cols, "rows": rows}

    def poll(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        try:
            since = max(0, int(args.get("since") or 0))
        except (TypeError, ValueError):
            since = 0
        with session.lock:
            base = session.total - len(session.buffer)
            reset = since < base
            if reset:
                since = base
            start = since - base
            data = bytes(session.buffer[start:start + MAX_POLL])
            next_offset = since + len(data)
            total = session.total
        exit_code = None
        if session.pty is not None:
            try:
                exit_code = session.pty.get_exitstatus()
            except Exception:
                exit_code = None
        elif session.process is not None:
            exit_code = session.process.poll()
        closed = session.closed or not self._is_alive(session)
        if closed:
            session.closed = True
        return {
            "session_id": session.id,
            "data": base64.b64encode(data).decode("ascii"),
            "next": next_offset,
            "total": total,
            "reset": reset,
            "closed": closed,
            "exit_code": exit_code,
        }

    def stop(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        self.sessions.pop(session.id, None)
        session.closed = True
        if session.pty is not None:
            try:
                session.pty.cancel_io()
            except Exception:
                pass
        if session.fd is not None:
            fd = session.fd
            session.fd = None
            try:
                os.close(fd)
            except OSError:
                pass
        self._kill(session.process, session.pid)
        return {"session_id": session.id, "stopped": True}

    @staticmethod
    def _kill(process: subprocess.Popen[bytes] | None, pid: int | None) -> None:
        if pid:
            try:
                import psutil
                root = psutil.Process(pid)
                for child in root.children(recursive=True):
                    try:
                        child.kill()
                    except (psutil.Error, OSError):
                        pass
                try:
                    root.kill()
                except (psutil.Error, OSError):
                    pass
            except Exception:
                pass
        if process is not None:
            try:
                process.kill()
            except OSError:
                pass
            try:
                process.wait(timeout=5)
            except Exception:
                pass
        elif pid and os.name != "nt":
            try:
                os.killpg(pid, signal.SIGKILL)
            except OSError:
                pass

    def dispatch(self, action: str, args: dict[str, Any]) -> Any:
        if action == "shells":
            shells = self.shells()
            return {"shells": shells, "default": self.default_shell_id(),
                    "herdr_agent_start": any(item["id"] == "herdr" and item["available"]
                                              for item in shells),
                    "runtime_agent_start": True}
        handler = getattr(self, action, None)
        if action not in {"start", "write", "poll", "resize", "stop"} or not callable(handler):
            raise ValueError("unsupported terminal action")
        return handler(args)
