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
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MAX_BUFFER = 512 * 1024
MAX_POLL = 128 * 1024
NO_WINDOW = 0x08000000


@dataclass
class _Session:
    id: str
    process: subprocess.Popen[bytes]
    cwd: str
    shell: str
    buffer: bytearray = field(default_factory=bytearray)
    lock: threading.Lock = field(default_factory=threading.Lock)
    total: int = 0
    closed: bool = False
    reader: threading.Thread | None = None


def _windows_shells() -> dict[str, tuple[str, list[str], str]]:
    return {
        "powershell": ("Windows PowerShell",
                       ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"],
                       "powershell.exe"),
        "pwsh": ("PowerShell 7",
                 ["pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"], "pwsh.exe"),
        "cmd": ("命令提示符", ["cmd.exe", "/Q"], "cmd.exe"),
        "bash": ("Git Bash", ["bash.exe", "--noprofile", "--norc"], "bash.exe"),
    }


def _posix_shells() -> dict[str, tuple[str, list[str], str]]:
    return {
        "bash": ("bash", ["/bin/bash"], "/bin/bash"),
        "zsh": ("zsh", ["/bin/zsh"], "/bin/zsh"),
        "sh": ("sh", ["/bin/sh"], "/bin/sh"),
        "fish": ("fish", ["/usr/bin/fish"], "fish"),
    }


class TerminalService:
    def __init__(self, cwd: Path | str, *, shell: list[str] | None = None,
                 env: dict[str, str] | None = None,
                 shells: dict[str, tuple[str, list[str], str]] | None = None) -> None:
        self.cwd = Path(cwd)
        self.env = dict(env or os.environ)
        self.specs = shells or (_windows_shells() if os.name == "nt" else _posix_shells())
        self.forced_shell = list(shell) if shell else None
        self.sessions: dict[str, _Session] = {}

    def _available(self, spec: tuple[str, list[str], str]) -> bool:
        return bool(shutil.which(spec[2]))

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

    def _read(self, session: _Session) -> None:
        stream = session.process.stdout
        if stream is None:
            session.closed = True
            return
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            with session.lock:
                session.buffer.extend(chunk)
                session.total += len(chunk)
                if len(session.buffer) > MAX_BUFFER:
                    del session.buffer[:len(session.buffer) - MAX_BUFFER]
        session.closed = True

    def start(self, args: dict[str, Any]) -> dict[str, Any]:
        cwd = Path(str(args.get("cwd") or self.cwd)).expanduser()
        if not cwd.is_dir():
            raise ValueError("terminal cwd is not a directory")
        shell_id, command = self._resolve_shell(args.get("shell"))
        session_id = secrets.token_hex(12)
        kwargs: dict[str, Any] = {
            "cwd": str(cwd),
            "env": self.env,
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
        session = _Session(session_id, process, str(cwd), shell_id)
        reader = threading.Thread(target=self._read, args=(session,), daemon=True)
        reader.start()
        session.reader = reader
        self.sessions[session_id] = session
        return {"session_id": session_id, "shell": shell_id, "command": command[0],
                "cwd": str(cwd), "pid": process.pid}

    def _find(self, args: dict[str, Any]) -> _Session:
        session = self.sessions.get(str(args.get("session_id") or ""))
        if session is None:
            raise ValueError("terminal session not found")
        return session

    def write(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        try:
            data = base64.b64decode(str(args.get("data") or ""), validate=True)
        except (ValueError, TypeError):
            raise ValueError("terminal input must be base64") from None
        if session.closed or session.process.stdin is None:
            raise ValueError("terminal session is closed")
        session.process.stdin.write(data)
        session.process.stdin.flush()
        return {"session_id": session.id, "written": len(data)}

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
        return {
            "session_id": session.id,
            "data": base64.b64encode(data).decode("ascii"),
            "next": next_offset,
            "total": total,
            "reset": reset,
            "closed": session.closed,
            "exit_code": session.process.poll(),
        }

    def stop(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        self.sessions.pop(session.id, None)
        self._kill(session.process)
        return {"session_id": session.id, "stopped": True}

    @staticmethod
    def _kill(process: subprocess.Popen[bytes]) -> None:
        try:
            import psutil
            root = psutil.Process(process.pid)
            for child in root.children(recursive=True):
                try:
                    child.kill()
                except (psutil.Error, OSError):
                    pass
        except Exception:
            pass
        try:
            process.kill()
        except OSError:
            pass
        try:
            process.wait(timeout=5)
        except Exception:
            pass

    def dispatch(self, action: str, args: dict[str, Any]) -> Any:
        if action == "shells":
            return {"shells": self.shells(), "default": self.default_shell_id()}
        handler = getattr(self, action, None)
        if action not in {"start", "write", "poll", "stop"} or not callable(handler):
            raise ValueError("unsupported terminal action")
        return handler(args)