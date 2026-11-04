"""Codex app-server bridge for native account login, switching and usage."""

from __future__ import annotations

import base64
import json
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def resolve_codex_command() -> list[str]:
    override = os.environ.get("TETHER_CODEX_COMMAND")
    if override:
        return [override]
    found = shutil.which("codex")
    if not found:
        for candidate in (
            Path.home() / "AppData/Roaming/npm/codex.cmd",
            Path("E:/npm-global/codex.CMD"),
        ):
            if candidate.is_file():
                found = str(candidate)
                break
    if not found:
        raise RuntimeError("codex is not installed on this node")
    path = Path(found)
    if os.name == "nt" and path.suffix.lower() in (".cmd", ".bat"):
        prefix = path.parent
        candidates = [
            prefix / "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
            prefix / "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return [str(candidate)]
    return [str(path)]


def _b64_json(part: str) -> dict[str, Any]:
    padded = part + "=" * (-len(part) % 4)
    try:
        value = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def identity(home: Path) -> dict[str, Any]:
    path = Path(home) / "auth.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    id_token = str(tokens.get("id_token") or "")
    claims = _b64_json(id_token.split(".")[1]) if id_token.count(".") >= 2 else {}
    auth = claims.get("https://api.openai.com/auth") if isinstance(claims, dict) else {}
    auth = auth if isinstance(auth, dict) else {}
    return {
        "email": claims.get("email") or "",
        "name": claims.get("name") or "",
        "plan": auth.get("chatgpt_plan_type") or "",
        "account_id": auth.get("chatgpt_account_id") or tokens.get("account_id") or "",
        "auth_mode": data.get("auth_mode") or "",
        "last_refresh": data.get("last_refresh") or "",
        "has_tokens": bool(tokens.get("access_token")),
    }


def _window(raw: Any, default_mins: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    used = raw.get("usedPercent")
    reset = raw.get("resetsAt")
    if not isinstance(used, (int, float)):
        return None
    return {
        "usedPercent": max(0, min(100, float(used))),
        "windowMins": int(raw.get("windowDurationMins") or default_mins),
        "resetsAt": int(reset) if isinstance(reset, (int, float)) else None,
    }


def normalize_usage(result: dict[str, Any]) -> dict[str, Any]:
    rate = result.get("rateLimits") if isinstance(result.get("rateLimits"), dict) else {}
    if not rate:
        by_id = result.get("rateLimitsByLimitId")
        if isinstance(by_id, dict) and isinstance(by_id.get("codex"), dict):
            rate = by_id["codex"]
    primary = _window(rate.get("primary"), 300)
    secondary = _window(rate.get("secondary"), 10080)
    credits = rate.get("credits") if isinstance(rate.get("credits"), dict) else {}
    return {
        "primary": primary,
        "secondary": secondary,
        "plan": rate.get("planType") or result.get("planType") or "",
        "credits": credits,
        "checkedAt": int(time.time()),
    }


class CodexAppServer:
    def __init__(self, home: Path, command: list[str] | None = None, timeout: float = 12.0) -> None:
        self.home = Path(home)
        self.command = command or resolve_codex_command()
        self.timeout = timeout
        self.lines: queue.Queue[str | None] = queue.Queue()
        self.stderr: list[str] = []
        env = os.environ.copy()
        env["CODEX_HOME"] = str(self.home)
        env.setdefault("RUST_LOG", "error")
        self.proc = subprocess.Popen(
            self.command + ["app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
            creationflags=CREATE_NO_WINDOW,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()
        self.counter = 0
        self.lock = threading.Lock()

    def _read_stdout(self) -> None:
        try:
            assert self.proc.stdout is not None
            for line in self.proc.stdout:
                self.lines.put(line)
        finally:
            self.lines.put(None)

    def _read_stderr(self) -> None:
        try:
            assert self.proc.stderr is not None
            for line in self.proc.stderr:
                self.stderr.append(line.rstrip())
                if len(self.stderr) > 80:
                    self.stderr.pop(0)
        except Exception:
            pass

    def _send(self, method: str, params: Any) -> int:
        with self.lock:
            self.counter += 1
            request_id = self.counter
            assert self.proc.stdin is not None
            self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method,
                                              "params": params}) + "\n")
            self.proc.stdin.flush()
            return request_id

    def request(self, method: str, params: Any = None, timeout: float | None = None) -> Any:
        request_id = self._send(method, params)
        end = time.time() + (timeout or self.timeout)
        while time.time() < end:
            try:
                line = self.lines.get(timeout=max(0.05, end - time.time()))
            except queue.Empty:
                break
            if line is None:
                detail = " | ".join(self.stderr[-3:])
                raise RuntimeError("codex app-server exited" + (": " + detail if detail else ""))
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if message.get("id") != request_id:
                continue
            if "error" in message:
                error = message["error"] or {}
                raise RuntimeError(str(error.get("message") or error))
            return message.get("result")
        raise RuntimeError("codex app-server timed out")

    def wait_notification(self, method: str, timeout: float) -> dict[str, Any] | None:
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = self.lines.get(timeout=max(0.05, end - time.time()))
            except queue.Empty:
                return None
            if line is None:
                return None
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if message.get("method") == method:
                params = message.get("params")
                return params if isinstance(params, dict) else {}
        return None

    def initialize(self) -> None:
        self.request("initialize", {
            "clientInfo": {"name": "tether", "title": "Tether", "version": "0.3.6"},
            "capabilities": None,
        })

    def account_read(self) -> dict[str, Any]:
        result = self.request("account/read", {"refreshToken": True})
        return result if isinstance(result, dict) else {}

    def rate_limits(self) -> dict[str, Any]:
        result = self.request("account/rateLimits/read")
        return result if isinstance(result, dict) else {}

    def login_start(self) -> dict[str, Any]:
        result = self.request("account/login/start", {"type": "chatgptDeviceCode"})
        return result if isinstance(result, dict) else {}

    def login_cancel(self, login_id: str) -> None:
        try:
            self.request("account/login/cancel", {"loginId": login_id}, timeout=5)
        except Exception:
            pass

    def logout(self) -> None:
        self.request("account/logout")

    def close(self) -> None:
        try:
            if self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
        except Exception:
            pass


def probe(home: Path, command: list[str] | None = None) -> dict[str, Any]:
    home = Path(home)
    info = identity(home)
    server = None
    try:
        server = CodexAppServer(home, command)
        server.initialize()
        read = server.account_read()
        account = read.get("account")
        routing = read.get("workspaceRouting") if isinstance(read.get("workspaceRouting"), dict) else {}
        if not isinstance(account, dict):
            return {"loggedIn": False, "identity": info}
        try:
            usage = normalize_usage(server.rate_limits())
        except Exception:
            usage = {}
        return {
            "loggedIn": True,
            "email": account.get("email") or info.get("email") or "",
            "plan": account.get("planType") or info.get("plan") or "",
            "accountId": routing.get("chatgptAccountId") or info.get("account_id") or "",
            "usage": usage,
        }
    except Exception as exc:
        return {"loggedIn": False, "identity": info, "error": str(exc)[:200]}
    finally:
        if server is not None:
            server.close()
