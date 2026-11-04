"""Owner-scoped remote shell sessions on a Tether node.

The Node picks a shell that exists on the target OS (PowerShell/cmd/Git Bash on
Windows; login shell/bash/zsh/sh on POSIX).  Each session keeps its own working
directory and returns byte increments so the UI can poll without a second
WebSocket.
"""

from __future__ import annotations

import base64
import os
import secrets
import shutil
import signal
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MAX_BUFFER = 512 * 1024
MAX_POLL = 128 * 1024
NO_WINDOW = 0x08000000
DEFAULT_COLS = 120
DEFAULT_ROWS = 30
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
    bundled = Path(__file__).with_name("bin") / name
    if bundled.is_file():
        if os.name != "nt":
            try:
                os.chmod(bundled, 0o755)
            except OSError:
                pass
        return str(bundled)
    return shutil.which("herdr") or ""


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
        specs["herdr"] = ("Herdr 工作区", [herdr, "--session", "tether"], herdr)
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
    if shell_id == "herdr":
        return [exe]
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
                 "available": self._available(spec)}
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

    def _session_env(self, shell_id: str) -> dict[str, str]:
        env = dict(self.env)
        if shell_id == "herdr":
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
                   cols: int, rows: int) -> _Session | None:
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
                scoped = self._session_env(shell_id) if shell_id == "herdr" else {}
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
            env = self._session_env(shell_id)
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

    def start(self, args: dict[str, Any]) -> dict[str, Any]:
        cwd = Path(str(args.get("cwd") or self.cwd)).expanduser()
        if not cwd.is_dir():
            fallback = Path(self.cwd).expanduser()
            cwd = fallback if fallback.is_dir() else Path.home()
        if not cwd.is_dir():
            raise ValueError("terminal cwd is not a directory")
        shell_id, command = self._resolve_shell(args.get("shell"))
        try:
            cols = max(2, min(500, int(args.get("cols") or DEFAULT_COLS)))
            rows = max(1, min(300, int(args.get("rows") or DEFAULT_ROWS)))
        except (TypeError, ValueError):
            cols, rows = DEFAULT_COLS, DEFAULT_ROWS
        session = self._start_pty(command, shell_id, cwd, cols, rows)
        if session is None:
            kwargs: dict[str, Any] = {
                "cwd": str(cwd),
                "env": self._session_env(shell_id),
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
        return {"session_id": session.id, "shell": shell_id, "command": command[0],
                "cwd": str(cwd), "pid": session.pid, "pty": session.pty_mode,
                "cols": cols, "rows": rows, "user": _current_user(),
                "privileged": _is_privileged()}

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
            return {"shells": self.shells(), "default": self.default_shell_id()}
        handler = getattr(self, action, None)
        if action not in {"start", "write", "poll", "resize", "stop"} or not callable(handler):
            raise ValueError("unsupported terminal action")
        return handler(args)