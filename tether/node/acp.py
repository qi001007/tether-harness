"""Minimal ACP (Agent Client Protocol) client for locally installed harnesses.

ACP is JSON-RPC 2.0 over newline-delimited stdio.  Tether only acts as the
client: harnesses are started from a fixed whitelist and the UI renders the
streamed ``session/update`` events and permission requests.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

NO_WINDOW = 0x08000000
PROTOCOL_VERSION = 1
MAX_EVENTS = 4096

HARNESSES: dict[str, dict[str, Any]] = {
    "gemini": {"name": "Gemini CLI", "command": ["gemini", "--experimental-acp"]},
    "opencode": {"name": "OpenCode", "command": ["opencode", "acp"]},
    "claude": {"name": "Claude Code", "command": ["claude-code-acp"]},
    "codex": {"name": "Codex CLI", "command": ["codex-acp"]},
    "cursor": {"name": "Cursor Agent", "command": ["cursor-agent", "acp"]},
}

EXECUTABLE_SUFFIXES = (".exe", ".cmd", ".bat", ".com")


def resolve_executable(name: str) -> str:
    """Prefer a Windows-executable shim over extensionless npm/shell wrappers."""
    found = shutil.which(name)
    if found and os.name == "nt" and not found.lower().endswith(EXECUTABLE_SUFFIXES):
        for suffix in (".cmd", ".bat", ".exe"):
            candidate = shutil.which(name + suffix)
            if candidate:
                return candidate
    return found or ""


class AcpSession:
    def __init__(self, session_id: str, process: subprocess.Popen[bytes], cwd: Path,
                 command: list[str]) -> None:
        self.id = session_id
        self.process = process
        self.cwd = cwd
        self.command = command
        self.events: list[dict[str, Any]] = []
        self.cond = threading.Condition()
        self.pending: dict[int, dict[str, Any]] = {}
        self.seq = 0
        self.next_id = 1
        self.closed = False
        self.native_id = ""
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _send(self, payload: dict[str, Any]) -> None:
        if self.closed or self.process.stdin is None:
            raise ValueError("ACP session is closed")
        self.process.stdin.write((json.dumps(payload) + "\n").encode())
        self.process.stdin.flush()

    def _record(self, item: dict[str, Any]) -> None:
        with self.cond:
            self.seq += 1
            self.events.append({"seq": self.seq, "event": item})
            if len(self.events) > MAX_EVENTS:
                del self.events[:len(self.events) - MAX_EVENTS]
            self.cond.notify_all()

    def _read(self) -> None:
        stream = self.process.stdout
        if stream is None:
            with self.cond:
                self.closed = True
                self.cond.notify_all()
            return
        while True:
            line = stream.readline()
            if not line:
                break
            try:
                message = json.loads(line.decode("utf-8", "replace").strip())
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if "id" in message and ("result" in message or "error" in message):
                with self.cond:
                    entry = self.pending.pop(int(message["id"]), None)
                    if entry is not None:
                        entry["message"] = message
                        entry["event"].set()
                continue
            if "id" in message and "method" in message:
                self._record({"type": "request", "id": message["id"],
                              "method": message.get("method"), "params": message.get("params")})
                continue
            if "method" in message:
                self._record({"type": "notification", "method": message.get("method"),
                              "params": message.get("params")})
        with self.cond:
            self.closed = True
            for entry in self.pending.values():
                entry["message"] = {"error": {"message": "ACP agent exited"}}
                entry["event"].set()
            self.pending.clear()
            self.cond.notify_all()
        self._record({"type": "closed"})

    def request(self, method: str, params: dict[str, Any], timeout: float = 30.0) -> Any:
        with self.cond:
            request_id = self.next_id
            self.next_id += 1
            entry = {"event": threading.Event(), "message": None}
            self.pending[request_id] = entry
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        if not entry["event"].wait(timeout):
            with self.cond:
                self.pending.pop(request_id, None)
            raise ValueError("ACP request timed out: " + method)
        message = entry["message"] or {}
        if "error" in message:
            error = message.get("error") or {}
            raise ValueError(str(error.get("message") or "ACP request failed"))
        return message.get("result")

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def reply(self, request_id: Any, result: dict[str, Any]) -> None:
        self._send({"jsonrpc": "2.0", "id": request_id, "result": result})

    def prompt(self, text: str) -> None:
        def worker() -> None:
            try:
                result = self.request("session/prompt", {
                    "sessionId": self.native_id,
                    "prompt": [{"type": "text", "text": text}],
                }, timeout=3600.0)
                self._record({"type": "result", "result": result})
            except Exception as exc:  # noqa: BLE001 - surfaced to the UI
                self._record({"type": "error", "error": str(exc)})
        threading.Thread(target=worker, daemon=True).start()

    def poll(self, since: int) -> dict[str, Any]:
        with self.cond:
            items = [item for item in self.events if item["seq"] > since]
            next_seq = self.seq
            closed = self.closed
        return {"session_id": self.id, "events": items, "next": next_seq, "closed": closed,
                "exit_code": self.process.poll()}

    def stop(self) -> None:
        self.close()

    def close(self) -> None:
        self.closed = True
        try:
            if self.process.stdin is not None:
                self.process.stdin.close()
        except OSError:
            pass
        try:
            import psutil
            root = psutil.Process(self.process.pid)
            for child in root.children(recursive=True):
                try:
                    child.kill()
                except (psutil.Error, OSError):
                    pass
        except Exception:
            pass
        try:
            self.process.kill()
        except OSError:
            pass
        try:
            self.process.wait(timeout=5)
        except Exception:
            pass


class AcpService:
    def __init__(self, workspace: Path | str, *, harnesses: dict[str, dict[str, Any]] | None = None,
                 env: dict[str, str] | None = None) -> None:
        self.workspace = Path(workspace)
        self.harnesses = harnesses or HARNESSES
        self.env = dict(env or os.environ)
        self.sessions: dict[str, AcpSession] = {}

    def detect(self, _args: dict[str, Any] | None = None) -> dict[str, Any]:
        found = []
        for harness_id, item in self.harnesses.items():
            executable = resolve_executable(item["command"][0])
            if not executable:
                continue
            found.append({"id": harness_id, "name": item["name"], "command": item["command"][0]})
        return {"harnesses": found}

    def start(self, args: dict[str, Any]) -> dict[str, Any]:
        harness_id = str(args.get("harness") or "")
        item = self.harnesses.get(harness_id)
        if item is None:
            raise ValueError("unknown ACP harness")
        executable = resolve_executable(item["command"][0])
        if not executable:
            raise ValueError("ACP harness is not installed")
        cwd = Path(str(args.get("cwd") or self.workspace)).expanduser()
        if not cwd.is_dir():
            raise ValueError("ACP cwd is not a directory")
        command = list(item["command"])
        launch = [executable] + command[1:]
        if executable.lower().endswith((".cmd", ".bat")):
            launch = ["cmd.exe", "/c", executable] + command[1:]
        kwargs: dict[str, Any] = {
            "cwd": str(cwd), "env": self.env, "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE, "stderr": subprocess.DEVNULL, "bufsize": 0,
        }
        if os.name == "nt":
            kwargs["creationflags"] = NO_WINDOW
        process = subprocess.Popen(launch, **kwargs)
        session = AcpSession(harness_id + "-" + str(int(time.time() * 1000)), process, cwd, command)
        try:
            initialized = session.request("initialize", {
                "protocolVersion": PROTOCOL_VERSION,
                "clientInfo": {"name": "tether", "version": "1"},
                "clientCapabilities": {},
            })
            created = session.request("session/new", {"cwd": str(cwd), "mcpServers": [],
                                                      "additionalDirectories": []})
            session.native_id = str((created or {}).get("sessionId") or "")
            if not session.native_id:
                raise ValueError("ACP agent did not return a session id")
        except Exception:
            session.close()
            raise
        self.sessions[session.id] = session
        return {"session_id": session.id, "harness": harness_id, "cwd": str(cwd),
                "protocol": (initialized or {}).get("protocolVersion"), "native_id": session.native_id}

    def _find(self, args: dict[str, Any]) -> AcpSession:
        session = self.sessions.get(str(args.get("session_id") or ""))
        if session is None:
            raise ValueError("ACP session not found")
        return session

    def prompt(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        text = str(args.get("text") or "")
        if not text.strip():
            raise ValueError("ACP prompt is empty")
        session.prompt(text)
        return {"session_id": session.id, "accepted": True}

    def poll(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        try:
            since = max(0, int(args.get("since") or 0))
        except (TypeError, ValueError):
            since = 0
        return session.poll(since)

    def reply(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        request_id = args.get("request_id")
        outcome = args.get("outcome")
        if request_id is None or not isinstance(outcome, dict):
            raise ValueError("ACP reply needs request_id and outcome")
        session.reply(request_id, outcome)
        return {"session_id": session.id, "replied": True}

    def cancel(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self._find(args)
        session.notify("session/cancel", {"sessionId": session.native_id})
        return {"session_id": session.id, "cancelled": True}

    def stop(self, args: dict[str, Any]) -> dict[str, Any]:
        session = self.sessions.pop(str(args.get("session_id") or ""), None)
        if session is None:
            return {"stopped": False}
        session.stop()
        return {"session_id": session.id, "stopped": True}

    def close_all(self) -> None:
        for session in list(self.sessions.values()):
            session.close()
        self.sessions.clear()

    def dispatch(self, action: str, args: dict[str, Any]) -> Any:
        handler = getattr(self, action, None)
        if action not in {"detect", "start", "prompt", "poll", "reply", "cancel", "stop"} or not callable(handler):
            raise ValueError("unsupported acp action")
        return handler(args)