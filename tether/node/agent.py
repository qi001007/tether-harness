"""Tether node: outbound WebSocket, local outbox, fake adapter.

Gate 1 uses a deterministic fake adapter so the controller/replay/cancel path
can be exercised without a model key. The real DeepSeek adapter plugs into the
same `emit`/`run_state` interface in Gate 2.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

import websockets

from . import console as local_console
from .dsh_adapter import DshRun
from .fs_service import FsError, FsService
from .dsh_sessions import DshSessionStore
from .native_surface import NativeSurface, NativeSurfaceError


def os_label() -> str:
    if sys.platform == "win32":
        try:
            version = sys.getwindowsversion()
            name = "Windows 11" if version.build >= 22000 else ("Windows 10" if version.build >= 10240 else f"Windows {version.major}.{version.minor}")
            return f"{name} · {version.build}"
        except Exception:
            pass
    return platform.platform(terse=True)

ROOT = Path(__file__).resolve().parents[2]
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

ACTIVE = ("queued", "dispatching", "running", "cancelling")
TERMINAL = ("completed", "cancelled", "failed", "unknown")


def log(*parts: Any) -> None:
    print(time.strftime("[%H:%M:%S]"), *parts, flush=True)


def default_workspaces_root() -> Path:
    env = os.environ.get("TETHER_WORKSPACES_ROOT")
    if env:
        return Path(env).expanduser()
    if sys.platform == "win32" and Path("D:\\").exists():
        return Path("D:\\TetherWorkspaces")
    return Path.home() / "TetherWorkspaces"


def ensure_sdk_profile(home: Path) -> None:
    """Make the target DSH home able to run the headless SDK profile."""
    profile = home / "profiles" / "sdk"
    if (profile / "package.json").is_file():
        return
    profile.mkdir(parents=True, exist_ok=True)
    (profile / "package.json").write_text(json.dumps({
        "name": "dsh-profile-sdk", "private": True, "dependencies": {},
        "dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-sdk-app"]}},
    }, indent=2), encoding="utf-8")
    (profile / "cordis.yml").write_text("[]\n", encoding="utf-8")
    (profile / "cordis.patch.yml").write_text("[]\n", encoding="utf-8")


class NodeStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS outbox (
          run_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
          ts REAL NOT NULL, payload TEXT NOT NULL, acked INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(run_id, seq));
        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY, session_id TEXT, prompt TEXT, state TEXT NOT NULL,
          finish_reason TEXT, final_response TEXT, outcome TEXT, updated_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          tether_session_id TEXT PRIMARY KEY, dsh_session_id TEXT NOT NULL);
        """)
        self.db.commit()

    def next_seq(self, run_id: str) -> int:
        row = self.db.execute("SELECT COALESCE(MAX(seq),0)+1 FROM outbox WHERE run_id=?", (run_id,)).fetchone()
        return int(row[0])

    def add_event(self, run_id: str, kind: str, payload: dict[str, Any], ts: float | None = None) -> dict[str, Any]:
        seq = self.next_seq(run_id)
        event = {"run_id": run_id, "seq": seq, "kind": kind, "ts": ts or time.time(), "payload": payload}
        self.db.execute("INSERT INTO outbox(run_id,seq,kind,ts,payload) VALUES(?,?,?,?,?)",
                        (run_id, seq, kind, event["ts"], json.dumps(payload, ensure_ascii=False)))
        self.db.commit()
        return event

    def pending(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM outbox WHERE acked=0 ORDER BY run_id, seq").fetchall()
        return [{"run_id": r["run_id"], "seq": r["seq"], "kind": r["kind"], "ts": r["ts"],
                 "payload": json.loads(r["payload"])} for r in rows]

    def ack(self, run_id: str, ack_seq: int) -> None:
        self.db.execute("UPDATE outbox SET acked=1 WHERE run_id=? AND seq<=?", (run_id, ack_seq))
        self.db.commit()

    def upsert_run(self, run_id: str, session_id: str, prompt: str, state: str) -> None:
        self.db.execute(
            """INSERT INTO runs(run_id,session_id,prompt,state,updated_at) VALUES(?,?,?,?,?)
               ON CONFLICT(run_id) DO UPDATE SET session_id=excluded.session_id,
                 prompt=excluded.prompt, state=excluded.state, updated_at=excluded.updated_at""",
            (run_id, session_id, prompt, state, time.time()))
        self.db.commit()

    def set_state(self, run_id: str, state: str, *, finish_reason: str | None = None,
                  final_response: str | None = None, outcome: dict[str, Any] | None = None) -> dict[str, Any]:
        self.db.execute(
            """UPDATE runs SET state=?, finish_reason=COALESCE(?,finish_reason),
               final_response=COALESCE(?,final_response), outcome=COALESCE(?,outcome),
               updated_at=? WHERE run_id=?""",
            (state, finish_reason, final_response,
             json.dumps(outcome, ensure_ascii=False) if outcome else None, time.time(), run_id))
        self.db.commit()
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            return None
        return {"run_id": row["run_id"], "session_id": row["session_id"], "prompt": row["prompt"],
                "state": row["state"], "finish_reason": row["finish_reason"],
                "final_response": row["final_response"],
                "outcome": json.loads(row["outcome"]) if row["outcome"] else None}

    def all_runs(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT run_id FROM runs ORDER BY updated_at DESC").fetchall()
        return [self.get_run(r["run_id"]) for r in rows]  # type: ignore[list-item]

    def snapshot(self, device: str) -> dict[str, Any]:
        runs = self.all_runs()
        events: dict[str, list[dict[str, Any]]] = {}
        for run in runs:
            rows = self.db.execute(
                "SELECT * FROM outbox WHERE run_id=? ORDER BY seq DESC LIMIT 60", (run["run_id"],)
            ).fetchall()
            events[run["run_id"]] = [
                {"run_id": r["run_id"], "seq": r["seq"], "kind": r["kind"], "ts": r["ts"],
                 "payload": json.loads(r["payload"])} for r in reversed(rows)
            ]
        return {"device": device, "runs": runs, "events": events}

    def mark_stale_unknown(self) -> None:
        marks = ",".join("?" for _ in ACTIVE)
        self.db.execute(
            f"UPDATE runs SET state='unknown', outcome=?, updated_at=? WHERE state IN ({marks})",
            (json.dumps({"reason": "node restarted with an unfinished run"}), time.time(), *ACTIVE))
        self.db.commit()

    def get_dsh_session(self, tether_session_id: str) -> str | None:
        row = self.db.execute("SELECT dsh_session_id FROM sessions WHERE tether_session_id=?",
                              (tether_session_id,)).fetchone()
        return str(row[0]) if row else None

    def set_dsh_session(self, tether_session_id: str, dsh_session_id: str) -> None:
        self.db.execute("INSERT OR REPLACE INTO sessions(tether_session_id,dsh_session_id) VALUES(?,?)",
                        (tether_session_id, dsh_session_id))
        self.db.commit()


class Node:
    def __init__(self, *, url: str, token: str, device: str, workspace: Path, store: NodeStore,
                 drop_after: float | None = None, drop_for: float = 0.0,
                 agent: str = "fake", dsh_home: str | None = None,
                 provider: str = "deepseek-official", model: str = "deepseek-v4-flash",
                 workspaces_root: Path | None = None, data_dir: Path | None = None) -> None:
        self.url = url
        self.token = token
        self.device = device
        self.workspace = workspace
        self.store = store
        self.drop_after = drop_after
        self.drop_for = drop_for
        self._block_until = 0.0
        self.agent = agent
        self.dsh_home = dsh_home or str(ROOT / ".runtime" / "dsh-home")
        self.provider = provider
        self.model = model
        self.workspaces_root = workspaces_root or default_workspaces_root()
        self.fs = FsService(device=device, workspace=workspace,
                            data_dir=data_dir or (ROOT / ".runtime"),
                            workspaces_root=self.workspaces_root)
        self.dsh_sessions = DshSessionStore()
        self.native_dsh_home = self.dsh_sessions.home
        ensure_sdk_profile(self.native_dsh_home)
        self.native_surface = NativeSurface(self.native_dsh_home)
        self.dsh_runs: dict[str, DshRun] = {}
        self.ws: Any = None
        self.connected = False
        self.tasks: dict[str, asyncio.Task] = {}
        self.surface_tasks: set[asyncio.Task] = set()
        self.cancels: dict[str, asyncio.Event] = {}
        self._dropped = False

    async def run(self) -> None:
        backoff = 0.5
        while True:
            if self._block_until > time.monotonic():
                await asyncio.sleep(self._block_until - time.monotonic())
            try:
                await self._session()
                backoff = 0.5
            except Exception as exc:  # noqa: BLE001 - reconnect forever
                log(f"[ws] disconnected: {type(exc).__name__}: {exc}")
            self.connected = False
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5.0)

    async def _session(self) -> None:
        async with websockets.connect(self.url, ping_interval=20, ping_timeout=20,
                                      max_size=48 * 1024 * 1024) as ws:
            self.ws = ws
            await self._send({"type": "register", "device_id": self.device, "name": self.device,
                              "token": self.token, "platform": platform.platform(),
                              "capabilities": self.capabilities()})
            first = json.loads(await ws.recv())
            if first.get("type") != "registered":
                raise RuntimeError(f"registration failed: {first}")
            self.connected = True
            log(f"[ws] registered as {self.device} at {self.url}")
            for msg in self._state_messages():
                await self._send(msg)
            for event in self.store.pending():
                await self._send({"type": "event", **event})
            log(f"[ws] replayed {len(self.store.pending())} pending event(s)")
            hb = asyncio.create_task(self._heartbeat())
            try:
                while True:
                    raw = await ws.recv()
                    await self._handle(json.loads(raw))
            finally:
                hb.cancel()
                for task in tuple(self.surface_tasks):
                    task.cancel()
                if self.surface_tasks:
                    await asyncio.gather(*self.surface_tasks, return_exceptions=True)
                self.surface_tasks.clear()
                await self.native_surface.dispose()
                self.ws = None

    async def _drop_later(self) -> None:
        await asyncio.sleep(self.drop_after or 0)
        log(f"[ws] test drop: closing socket for {self.drop_for}s, adapter keeps running")
        self._block_until = time.monotonic() + self.drop_for
        if self.ws is not None:
            await self.ws.close()

    async def _heartbeat(self) -> None:
        while True:
            await asyncio.sleep(2)
            try:
                await self._send({"type": "heartbeat", "ts": time.time()})
            except Exception:
                return

    async def _send(self, msg: dict[str, Any]) -> None:
        if self.ws is None:
            raise RuntimeError("not connected")
        await self.ws.send(json.dumps(msg, ensure_ascii=False))

    async def _handle(self, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "dispatch":
            await self._dispatch(msg)
        elif kind == "cancel":
            await self._cancel(str(msg["run_id"]))
        elif kind == "reconcile":
            await self._reconcile(str(msg["run_id"]))
        elif kind == "event_ack":
            self.store.ack(str(msg["run_id"]), int(msg["ack_seq"]))
        elif kind == "fs_call":
            await self._fs_call(msg)
        elif kind == "dsh_call":
            await self._dsh_call(msg)
        elif kind == "surface_call":
            if len(self.surface_tasks) >= 64:
                await self._send({"type": "surface_result", "req_id": str(msg.get("req_id") or ""),
                                  "ok": False, "error": "too many pending surface requests",
                                  "code": "capacity"})
                return
            task = asyncio.create_task(self._surface_call(msg))
            self.surface_tasks.add(task)
            task.add_done_callback(self.surface_tasks.discard)
        elif kind == "error":
            log(f"[ws] controller error: {msg.get('error')}")

    async def _fs_call(self, msg: dict[str, Any]) -> None:
        req_id = str(msg.get("req_id") or "")
        op = str(msg.get("op") or "")
        args = msg.get("args") or {}
        try:
            result = await asyncio.to_thread(self.fs.dispatch, op, args)
            reply = {"type": "fs_result", "req_id": req_id, "ok": True, "result": result}
        except FsError as exc:
            reply = {"type": "fs_result", "req_id": req_id, "ok": False,
                     "error": str(exc), "code": exc.code}
        except Exception as exc:  # noqa: BLE001 - a failed call must not kill the socket
            log(f"[fs] {op} failed: {exc}")
            reply = {"type": "fs_result", "req_id": req_id, "ok": False,
                     "error": str(exc), "code": "fs_error"}
        try:
            await self._send(reply)
        except Exception:
            self.connected = False

    async def _dsh_call(self, msg: dict[str, Any]) -> None:
        req_id = str(msg.get("req_id") or "")
        op = str(msg.get("op") or "")
        args = msg.get("args") or {}
        try:
            if op == "sessions":
                result = {"sessions": self.dsh_sessions.list(),
                          "home": str(self.dsh_sessions.home)}
            elif op == "transcript":
                result = self.dsh_sessions.transcript(str(args.get("session_id") or ""))
                if result is None:
                    raise FsError("DSH session not found", "not_found")
            elif op == "workspace_register":
                result = self.dsh_sessions.register_workspace(str(args.get("path") or ""),
                                                            str(args.get("title") or ""))
            elif op == "session_attach":
                result = {"attached": self.dsh_sessions.attach_session(
                    str(args.get("path") or ""), str(args.get("session_id") or ""))}
            else:
                raise FsError(f"unknown dsh op: {op}", "bad_op")
            reply = {"type": "dsh_result", "req_id": req_id, "ok": True, "result": result}
        except FsError as exc:
            reply = {"type": "dsh_result", "req_id": req_id, "ok": False,
                     "error": str(exc), "code": exc.code}
        except Exception as exc:  # noqa: BLE001
            log(f"[dsh] {op} failed: {exc}")
            reply = {"type": "dsh_result", "req_id": req_id, "ok": False,
                     "error": str(exc), "code": "dsh_error"}
        try:
            await self._send(reply)
        except Exception:
            self.connected = False

    async def _surface_call(self, msg: dict[str, Any]) -> None:
        req_id = str(msg.get("req_id") or "")
        op = str(msg.get("op") or "")
        args = msg.get("args") or {}
        try:
            result = await self.native_surface.call(op, args)
            reply = {"type": "surface_result", "req_id": req_id, "ok": True, "result": result}
        except NativeSurfaceError as exc:
            reply = {"type": "surface_result", "req_id": req_id, "ok": False,
                     "error": str(exc), "code": exc.code}
        except asyncio.CancelledError:
            raise
        except Exception:
            log(f"[surface] {op} failed")
            reply = {"type": "surface_result", "req_id": req_id, "ok": False,
                     "error": "native surface request failed", "code": "surface_error"}
        try:
            await self._send(reply)
        except Exception:
            self.connected = False

    async def emit(self, run_id: str, kind: str, payload: dict[str, Any]) -> None:
        event = self.store.add_event(run_id, kind, payload)
        log(f"[{run_id}] {kind}: {json.dumps(payload, ensure_ascii=False)[:200]}")
        if self.connected:
            try:
                await self._send({"type": "event", **event})
            except Exception:
                self.connected = False

    async def state(self, run_id: str, state: str, **extra: Any) -> None:
        run = self.store.set_state(run_id, state, **extra)
        log(f"[{run_id}] state={state}")
        if self.connected:
            try:
                await self._send({"type": "run_state", "run_id": run_id, "state": state,
                                  "finish_reason": run.get("finish_reason"),
                                  "final_response": run.get("final_response"),
                                  "outcome": run.get("outcome")})
            except Exception:
                self.connected = False

    def _state_messages(self) -> list[dict[str, Any]]:
        messages = []
        for run in self.store.all_runs():
            if run and run["state"] != "queued":
                messages.append({"type": "run_state", "run_id": run["run_id"], "state": run["state"],
                                 "finish_reason": run.get("finish_reason"),
                                 "final_response": run.get("final_response"),
                                 "outcome": run.get("outcome")})
        return messages

    async def _dispatch(self, msg: dict[str, Any]) -> None:
        run_id = str(msg["run_id"])
        existing = self.store.get_run(run_id)
        if existing and existing["state"] in TERMINAL:
            await self.state(run_id, existing["state"])
            return
        if run_id in self.tasks and not self.tasks[run_id].done():
            return
        self.store.upsert_run(run_id, str(msg.get("session_id") or ""), str(msg.get("prompt") or ""), "running")
        self.cancels[run_id] = asyncio.Event()
        await self._send({"type": "dispatch_ack", "run_id": run_id, "accepted": True})
        await self.state(run_id, "running")
        prompt = str(msg.get("prompt") or "")
        session_id = str(msg.get("session_id") or "")
        workspace = Path(str(msg.get("workspace") or self.workspace)).expanduser()
        if self.agent == "dsh":
            self.tasks[run_id] = asyncio.create_task(self._run_dsh(run_id, session_id, prompt, workspace))
        else:
            self.tasks[run_id] = asyncio.create_task(self._fake_adapter(run_id, prompt))
        if self.drop_after and not self._dropped:
            self._dropped = True
            asyncio.create_task(self._drop_later())

    async def _cancel(self, run_id: str) -> None:
        dsh_run = self.dsh_runs.get(run_id)
        if dsh_run is not None:
            await self.emit(run_id, "log", {"text": "cancel requested (hard close; session will be repaired on resume)"})
            await dsh_run.cancel()
            return
        event = self.cancels.get(run_id)
        if event is not None:
            event.set()
            await self.emit(run_id, "log", {"text": "cancel requested"})
            return
        run = self.store.get_run(run_id)
        if run and run["state"] not in TERMINAL:
            await self.state(run_id, "cancelled", finish_reason="cancelled",
                             outcome={"reason": "cancelled before start"})

    async def _reconcile(self, run_id: str) -> None:
        run = self.store.get_run(run_id)
        task = self.tasks.get(run_id)
        if run and task is not None and not task.done():
            await self.state(run_id, "running")
        elif run and run["state"] in TERMINAL:
            await self.state(run_id, run["state"])
        else:
            await self.state(run_id, "unknown", outcome={"reason": "no local record of a live adapter"})

    async def _fake_adapter(self, run_id: str, prompt: str) -> None:
        cancel = self.cancels[run_id]
        started = time.time()
        try:
            await self.emit(run_id, "assistant", {"text": "fake adapter started"})
            if "slow" in prompt.lower():
                for i in range(60):
                    if cancel.is_set():
                        await self.state(run_id, "cancelled", finish_reason="cancelled",
                                         outcome={"reason": "user cancel", "elapsed": round(time.time() - started, 2)})
                        return
                    await asyncio.sleep(1)
                    if i % 5 == 0:
                        await self.emit(run_id, "log", {"text": f"still working {i}s"})
                await self.state(run_id, "completed", finish_reason="end_turn",
                                 final_response="slow task done")
                return
            if "fail" in prompt.lower():
                await self.emit(run_id, "log", {"text": "simulated tool failure", "exit_code": 1})
                await self.state(run_id, "failed", finish_reason="error",
                                 outcome={"exit_code": 1, "reason": "simulated failure"})
                return
            for step in (1, 2, 3):
                if cancel.is_set():
                    await self.state(run_id, "cancelled", finish_reason="cancelled",
                                     outcome={"reason": "user cancel"})
                    return
                await asyncio.sleep(0.4)
                await self.emit(run_id, "assistant", {"text": f"step {step}"})
            await self.emit(run_id, "tool", {"name": "bash", "command": "echo tether",
                                             "exit_code": 0, "duration": 0.2})
            await self.emit(run_id, "assistant", {"text": "all steps complete"})
            await self.state(run_id, "completed", finish_reason="end_turn",
                             final_response="fake task complete")
        except asyncio.CancelledError:
            await self.state(run_id, "unknown", outcome={"reason": "adapter task cancelled"})
            raise
        except Exception as exc:  # noqa: BLE001
            await self.emit(run_id, "log", {"text": f"adapter error: {exc}"})
            await self.state(run_id, "failed", finish_reason="error", outcome={"error": str(exc)})

    async def _run_dsh(self, run_id: str, session_id: str, prompt: str, workspace: Path) -> None:
        run = DshRun(self, run_id, session_id, prompt, workspace=workspace,
                     dsh_home=str(self.native_dsh_home))
        self.dsh_runs[run_id] = run
        try:
            await run.start()
            if run.dsh_session_id:
                try:
                    self.dsh_sessions.attach_session(str(workspace), run.dsh_session_id)
                except Exception as exc:  # noqa: BLE001
                    log(f"[dsh] workspace attach failed: {exc}")
            if run.cancelled.is_set():
                await self.state(run_id, "cancelled", finish_reason="cancelled",
                                 outcome={"reason": "user cancel", "dsh_session": run.dsh_session_id})
            elif run.error is not None:
                await self.emit(run_id, "log", {"text": f"dsh error: {run.error}"})
                await self.state(run_id, "failed", finish_reason="error",
                                 outcome={"error": str(run.error), "dsh_session": run.dsh_session_id})
            else:
                result = run.result
                finish_reason = getattr(result, "finish_reason", None)
                if str(finish_reason).lower() == "error":
                    await self.state(run_id, "failed", finish_reason=finish_reason,
                                     outcome={"finish_reason": finish_reason,
                                              "dsh_session": run.dsh_session_id})
                else:
                    await self.state(run_id, "completed", finish_reason=finish_reason,
                                     final_response=getattr(result, "final_response", "") or "",
                                     outcome={"events": len(getattr(result, "events", []) or []),
                                              "dsh_session": run.dsh_session_id})
        except asyncio.CancelledError:
            await run.cancel()
            await self.state(run_id, "unknown", outcome={"reason": "adapter task cancelled"})
            raise
        finally:
            self.dsh_runs.pop(run_id, None)

    def capabilities(self) -> dict[str, Any]:
        return {"os": platform.system(), "release": platform.release(), "os_label": os_label(),
                "python": platform.python_version(),
                "workspace": str(self.workspace), "agents": ["fake", "dsh"], "fs": True,
                "policy_mode": self.fs.policy.data.get("mode"),
                "workspaces_root": str(self.workspaces_root),
                "dsh_native": self.dsh_sessions.available(),
                "native_dsh_home": str(self.dsh_sessions.home),
                "surface_protocol": 1,
                "dsh_surface": self.native_surface.available()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--controller", default=os.environ.get("TETHER_CONTROLLER", "ws://127.0.0.1:18890/ws/node"))
    ap.add_argument("--device", default=os.environ.get("TETHER_DEVICE", "DESKTOP-LOCAL"))
    ap.add_argument("--workspace", default=str(ROOT / "work-local"))
    ap.add_argument("--workspaces-root", default=os.environ.get("TETHER_WORKSPACES_ROOT"),
                    help="root for new remote projects (default D:\\TetherWorkspaces)")
    ap.add_argument("--token", default=os.environ.get("TETHER_NODE_TOKEN", "dev-token"))
    ap.add_argument("--db", default=str(ROOT / ".runtime" / "node-local.db"))
    ap.add_argument("--drop-after", type=float, default=None, help="test: close the socket N seconds after the first dispatch")
    ap.add_argument("--drop-for", type=float, default=0.0, help="test: keep the socket down for N seconds")
    ap.add_argument("--agent", choices=["fake", "dsh"], default=os.environ.get("TETHER_AGENT", "fake"))
    ap.add_argument("--dsh-home", default=os.environ.get("DSH_HOME", str(ROOT / ".runtime" / "dsh-home")))
    ap.add_argument("--provider", default=os.environ.get("DSH_PROVIDER", "deepseek-official"))
    ap.add_argument("--model", default=os.environ.get("DSH_MODEL", "deepseek-v4-flash"))
    ap.add_argument("--console-port", type=int, default=int(os.environ.get("TETHER_CONSOLE_PORT", "18893")))
    args = ap.parse_args()
    workspace = Path(args.workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    store = NodeStore(Path(args.db))
    store.mark_stale_unknown()
    workspaces_root = Path(args.workspaces_root).expanduser().resolve() if args.workspaces_root else default_workspaces_root()
    log(f"[node] {args.device} workspace={workspace} db={args.db} workspaces_root={workspaces_root}")
    node = Node(url=args.controller, token=args.token, device=args.device,
                workspace=workspace, store=store, drop_after=args.drop_after, drop_for=args.drop_for,
                agent=args.agent, dsh_home=args.dsh_home, provider=args.provider, model=args.model,
                workspaces_root=workspaces_root, data_dir=Path(args.db).resolve().parent)
    try:
        local_console.start(store, args.device, args.console_port)
        log(f"[console] http://127.0.0.1:{args.console_port} (read-only, local)")
    except OSError as exc:
        log(f"[console] not started: {exc}")
    try:
        asyncio.run(node.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
