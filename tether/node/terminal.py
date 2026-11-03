"""Owner-scoped remote shell sessions on a Tether node.

The Hub only forwards authenticated messages; the node keeps a persistent
PowerShell (Windows) or POSIX shell per session and returns byte increments so
the UI can poll without a second WebSocket.
"""

from __future__ import annotations

import base64
import os
import secrets
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
    buffer: bytearray = field(default_factory=bytearray)
    lock: threading.Lock = field(default_factory=threading.Lock)
    total: int = 0
    closed: bool = False
    reader: threading.Thread | None = None


def _default_shell() -> list[str]:
    if os.name == "nt":
        return ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"]
    return ["/bin/bash"]


class TerminalService:
    def __init__(self, cwd: Path | str, *, shell: list[str] | None = None,
                 env: dict[str, str] | None = None) -> None:
        self.cwd = Path(cwd)
        self.shell = list(shell or _default_shell())
        self.env = dict(env or os.environ)
        self.sessions: dict[str, _Session] = {}

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

    def start(self, _args: dict[str, Any]) -> dict[str, Any]:
        session_id = secrets.token_hex(12)
        kwargs: dict[str, Any] = {
            "cwd": str(self.cwd),
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
        process = subprocess.Popen(self.shell, **kwargs)
        session = _Session(session_id, process)
        reader = threading.Thread(target=self._read, args=(session,), daemon=True)
        reader.start()
        session.reader = reader
        self.sessions[session_id] = session
        return {"session_id": session_id, "shell": self.shell[0], "cwd": str(self.cwd),
                "pid": process.pid}

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
        handler = getattr(self, action, None)
        if action not in {"start", "write", "poll", "stop"} or not callable(handler):
            raise ValueError("unsupported terminal action")
        return handler(args)