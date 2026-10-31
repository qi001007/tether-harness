"""Tether node: outbound WebSocket, local outbox, fake adapter.

Gate 1 uses a deterministic fake adapter so the controller/replay/cancel path
can be exercised without a model key. The real DeepSeek adapter plugs into the
same `emit`/`run_state` interface in Gate 2.
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import platform
import sqlite3
import ssl
import sys
import subprocess
import time
import traceback
from pathlib import Path
from typing import Any

import websockets
from dotenv import load_dotenv

from . import console as local_console
from .dsh_adapter import DshRun
from .fs_service import FsError, FsService
from .dsh_sessions import DshSessionStore
from .native_surface import NativeSurface, NativeSurfaceError
from .local_identity import remove_identity, write_identity
from ..updates import MAX_UPDATE_PROTOCOL, MIN_UPDATE_PROTOCOL, UPDATE_PROTOCOL, UpdateManager, select_profile


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
load_dotenv(ROOT / ".env")

ACTIVE = ("queued", "dispatching", "running", "cancelling")
TERMINAL = ("completed", "cancelled", "failed", "unknown")


def log(*parts: Any) -> None:
    print(time.strftime("[%H:%M:%S]"), *parts, flush=True)


def release_manifest_url() -> str | None:
    explicit = os.environ.get("TETHER_UPDATE_MANIFEST_URL", "").strip()
    if explicit:
        return explicit
    controller = os.environ.get("TETHER_CONTROLLER_URL", "").strip() or os.environ.get("TETHER_CONTROLLER", "").strip()
    try:
        from urllib.parse import urlsplit

        parts = urlsplit(controller)
        host = (parts.hostname or "").lower()
        if not host or host in {"127.0.0.1", "::1", "localhost"}:
            return None
        scheme = "https" if parts.scheme in {"wss", "https"} else "http"
        return f"{scheme}://{parts.netloc}/releases/manifest"
    except ValueError:
        return None


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


CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


def schedule_app_restart(root: Path) -> bool:
    """Start a windowless helper that relaunches the APP executable directly."""
    if sys.platform != "win32":
        return False
    root = Path(root).resolve()
    executable = (root / "apps" / "tether-app" / "node_modules" / "electron"
                  / "dist" / "electron.exe")
    log_path = root / ".runtime" / "updates" / "remote-app-restart.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    def record(message: str) -> None:
        try:
            with log_path.open("a", encoding="utf-8") as log_file:
                log_file.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}\n")
        except OSError:
            pass

    if not executable.is_file():
        record("APP executable missing")
        return False
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    try:
        subprocess.Popen(
            [sys.executable, "-m", "tether.node.app_restart", "--root", str(root),
             "--log", str(log_path), "--delay", "2"],
            cwd=str(ROOT), env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            close_fds=True, windowsHide=True,
            creationflags=(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW),
        )
        record("restart helper started")
        return True
    except OSError:
        record("restart helper could not be started")
        return False


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
        self.data_dir = Path(data_dir or (ROOT / ".runtime")).expanduser().resolve()
        self.provider = provider
        self.model = model
        self.workspaces_root = workspaces_root or default_workspaces_root()
        self.fs = FsService(device=device, workspace=workspace,
                            data_dir=self.data_dir,
                            workspaces_root=self.workspaces_root)
        self.dsh_sessions = DshSessionStore()
        self.native_dsh_home = self.dsh_sessions.home
        ensure_sdk_profile(self.native_dsh_home)
        self.native_surface = NativeSurface(self.native_dsh_home, device_fs=self.fs)
        update_state_dir = self.data_dir / "updates"
        manifest_url = release_manifest_url()
        plugin_profile = select_profile(Path(self.native_dsh_home), "desktop") or "desktop"
        self.update_managers = {
            component: UpdateManager(ROOT, component, dsh_home=self.native_dsh_home,
                                     manifest_url=manifest_url, state_dir=update_state_dir / component,
                                     device=self.device, profile=plugin_profile if component == "plugin" else "desktop")
              for component in ("node", "plugin", "app")
        }
        node_status = self.update_managers["node"].status()
        self.node_version = ((node_status.get("current_version") or "unknown")
                             if node_status.get("ok") else "unknown")
        self.dsh_runs: dict[str, DshRun] = {}
        self.ws: Any = None
        self.connected = False
        self.tasks: dict[str, asyncio.Task] = {}
        self.fs_tasks: set[asyncio.Task] = set()
        self.dsh_tasks: set[asyncio.Task] = set()
        self.surface_tasks: set[asyncio.Task] = set()
        self.update_tasks: set[asyncio.Task] = set()
        self.update_lock = asyncio.Lock()
        self.update_applying = False
        self.restart_requested = False
        self.cancels: dict[str, asyncio.Event] = {}
        self._dropped = False

    async def _warm_updates(self) -> None:
        await asyncio.sleep(2)
        while True:
            try:
                if not self.update_applying:
                    manager = self.update_managers["node"]
                    await asyncio.to_thread(manager.check)
                    plugin = self.update_managers["plugin"]
                    profile = self.native_surface.active_profile() or select_profile(Path(self.native_dsh_home), plugin.profile)
                    if profile:
                        plugin.profile = profile
                        await asyncio.to_thread(plugin.check)
            except Exception:
                pass
            await asyncio.sleep(600)

    async def run(self) -> None:
        warm = asyncio.create_task(self._warm_updates())
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
            if self.restart_requested:
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5.0)

    async def _session(self) -> None:
        ssl_context = None
        if self.url.startswith("wss://"):
            ca_file = os.environ.get("TETHER_CA_FILE", "")
            if ca_file:
                ssl_context = ssl.create_default_context(cafile=ca_file)
            elif os.environ.get("TETHER_INSECURE_TLS", "") in ("1", "true", "yes"):
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
        connect_options = {
            "ping_interval": 20,
            "ping_timeout": 20,
            "max_size": 48 * 1024 * 1024,
        }
        if "proxy" in inspect.signature(websockets.connect).parameters:
            # Since websockets 15, clients inherit desktop HTTP/SOCKS proxies.
            # Proxy restarts can black-hole this long-lived control tunnel.
            connect_options["proxy"] = None
        if ssl_context is not None:
            connect_options["ssl"] = ssl_context
        async with websockets.connect(self.url, **connect_options) as ws:
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
                for tasks in (self.fs_tasks, self.dsh_tasks, self.surface_tasks):
                    for task in tuple(tasks):
                        task.cancel()
                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)
                    tasks.clear()
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

    async def _send_update_result(self, ws: Any, msg: dict[str, Any]) -> bool:
        """Send an update reply only on the session that received its request."""
        if self.ws is not ws:
            return False
        try:
            await self._send(msg)
        except (asyncio.InvalidStateError, OSError, RuntimeError, websockets.ConnectionClosed):
            self.connected = False
            return False
        return True

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
            if len(self.fs_tasks) >= 128:
                await self._send({"type": "fs_result", "req_id": str(msg.get("req_id") or ""),
                                  "ok": False, "error": "too many pending file requests",
                                  "code": "capacity"})
                return
            task = asyncio.create_task(self._fs_call(msg))
            self.fs_tasks.add(task)
            task.add_done_callback(self.fs_tasks.discard)
        elif kind == "dsh_call":
            if len(self.dsh_tasks) >= 64:
                await self._send({"type": "dsh_result", "req_id": str(msg.get("req_id") or ""),
                                  "ok": False, "error": "too many pending dsh requests",
                                  "code": "capacity"})
                return
            task = asyncio.create_task(self._dsh_call(msg))
            self.dsh_tasks.add(task)
            task.add_done_callback(self.dsh_tasks.discard)
        elif kind == "surface_call":
            if len(self.surface_tasks) >= 64:
                await self._send({"type": "surface_result", "req_id": str(msg.get("req_id") or ""),
                                  "ok": False, "error": "too many pending surface requests",
                                  "code": "capacity"})
                return
            task = asyncio.create_task(self._surface_call(msg))
            self.surface_tasks.add(task)
            task.add_done_callback(self.surface_tasks.discard)
        elif kind == "update_call":
            task = asyncio.create_task(self._update_call(msg, self.ws))
            self.update_tasks.add(task)
            task.add_done_callback(self.update_tasks.discard)
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

    def _update_in_progress(self, component: str) -> dict[str, Any]:
        result: dict[str, Any] = {"ok": True, "component": component,
                                  "status": "in_progress", "in_progress": True,
                                  "restart_required": False, "error": ""}
        manager = self.update_managers.get(component)
        progress = None
        if manager is not None:
            try:
                progress = manager.progress()
            except Exception:  # noqa: BLE001 - progress is best effort
                progress = None
        if progress:
            result["progress"] = progress
        return result

    def _app_update_prepared(self) -> bool:
        manager = self.update_managers.get("app")
        if manager is None:
            return False
        try:
            status = manager.status()
        except Exception:  # noqa: BLE001 - deferral is best effort
            return False
        return bool(status.get("ok") and status.get("prepared"))

    def _update_busy_reason(self) -> str | None:
        if any(run and run.get("state") in ACTIVE for run in self.store.all_runs()):
            return "tether_task_active"
        if any(not task.done() for task in self.tasks.values()):
            return "tether_task_active"
        session_files = self.dsh_sessions._files()
        if (any(path.name.endswith(".zstd") for path in session_files)
                and not self.dsh_sessions.available()):
            return "native_activity_unknown"
        if any(item.get("status") == "running" for item in self.dsh_sessions.list()):
            return "native_dsh_turn_active"
        return None

    async def _update_call(self, msg: dict[str, Any], response_ws: Any = None) -> None:
        if response_ws is None:
            response_ws = self.ws
        req_id = str(msg.get("req_id") or "")
        component = msg.get("component")
        action = msg.get("action")
        allowed = {"type", "req_id", "action", "component", "prepared_id"}
        if (set(msg) - allowed or not isinstance(component, str) or component not in self.update_managers
                or not isinstance(action, str) or action not in {"check", "status", "prepare", "apply"}
                or (action == "apply") != ("prepared_id" in msg)):
            await self._send_update_result(
                response_ws,
                {"type": "update_result", "req_id": req_id, "ok": False,
                 "error_code": "invalid_update_request", "error": "invalid update request"},
            )
            return
        component = str(component)
        applying = action == "apply"
        app_restart_scheduled = False
        if self.update_applying:
            # A second window or a repeated click attaches to the run that is
            # already installing instead of failing with update_busy.
            await self._send_update_result(
                response_ws,
                {"type": "update_result", "req_id": req_id,
                 **self._update_in_progress(component)},
            )
            return
        if action in {"check", "status"}:
            manager = self.update_managers[component]
            if component == "plugin":
                profile = self.native_surface.active_profile() or select_profile(
                    Path(self.native_dsh_home), getattr(manager, "profile", "desktop"))
                if not profile:
                    await self._send_update_result(
                        response_ws,
                        {"type": "update_result", "req_id": req_id, "ok": False,
                         "error_code": "plugin_package_missing",
                         "error": "未找到已安装的 Tether DSH 插件 profile，无法检测插件更新。"},
                    )
                    return
                manager = UpdateManager(getattr(manager, "root", ROOT), component,
                                        dsh_home=getattr(manager, "dsh_home", Path(self.native_dsh_home)),
                                        manifest_url=getattr(manager, "manifest_url", None),
                                        state_dir=getattr(manager, "state_dir", None),
                                        profile=profile, device=self.device)
            try:
                if action == "check":
                    # A user-triggered check must see a just-published release;
                    # status keeps the short-lived cache for polling.
                    result = await asyncio.to_thread(manager.check, True)
                else:
                    result = await asyncio.to_thread(manager.status)
            except Exception as exc:  # noqa: BLE001 - failed reads must not stop the Node reader
                log(f"[update] {action} {component} failed: {type(exc).__name__}: {exc}")
                log(traceback.format_exc())
                await self._send_update_result(
                    response_ws,
                    {"type": "update_result", "req_id": req_id, "ok": False,
                     "error_code": "update_failed", "error": "update operation failed"},
                )
            else:
                await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id, **result}
                )
            return
        async with self.update_lock:
            if component == "plugin":
                profile = self.native_surface.active_profile() or select_profile(
                    Path(self.native_dsh_home), getattr(self.update_managers[component], "profile", "desktop"))
                if not profile:
                    await self._send_update_result(
                        response_ws,
                        {"type": "update_result", "req_id": req_id, "ok": False,
                         "error_code": "plugin_package_missing",
                         "error": "未找到已安装的 Tether DSH 插件 profile，无法更新插件。"},
                    )
                    return
                self.update_managers[component].profile = profile
            if applying:
                # Block new dispatches before inspecting native DSH logs off-loop.
                self.update_applying = True
                busy = await asyncio.to_thread(self._update_busy_reason)
                if busy:
                    self.update_applying = False
                    await self._send_update_result(
                        response_ws,
                        {"type": "update_result", "req_id": req_id, "ok": False,
                         "error_code": "update_busy", "error": busy},
                    )
                    await self._send_update_result(response_ws, {"type": "update_ready"})
                    return
            manager = self.update_managers[component]
            result: dict[str, Any] | None = None
            try:
                if action == "apply":
                    result = await asyncio.to_thread(manager.apply, msg["prepared_id"])
                else:
                    result = await asyncio.to_thread(getattr(manager, str(action)))
                applied = (bool(result.get("ok")) and result.get("status") != "in_progress"
                           and result.get("in_progress") is not True)
                node_deferred = False
                if applied and component == "plugin" and action == "apply":
                    result["restart_required"] = True
                if applying and applied and component == "node":
                    node_deferred = await asyncio.to_thread(self._app_update_prepared)
                    result["restart_required"] = True
                    if node_deferred:
                        # The APP apply that follows restarts this node too; it
                        # must not bounce between the plugin and APP updates.
                        result["restart_deferred"] = True
                    else:
                        self.restart_requested = True
                        self.update_applying = True
                response_sent = await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id, **result}
                )
                if (applying and applied and component == "app" and response_sent
                        and os.environ.get("TETHER_NODE_MANAGED") == "1"):
                    app_restart_scheduled = await asyncio.to_thread(schedule_app_restart, ROOT)
                    if app_restart_scheduled:
                        self.update_applying = True
                    else:
                        log("[update] APP restart helper could not be scheduled")
                if applying and applied and component == "node" and not node_deferred:
                    if self.ws is not None:
                        try:
                            await self.ws.close(code=1012, reason="node update applied")
                        except Exception:
                            pass
                    return
            except Exception as exc:  # noqa: BLE001 - updater errors do not take down the WS reader
                log(f"[update] {action} {component} failed: {type(exc).__name__}: {exc}")
                log(traceback.format_exc())
                await self._send_update_result(
                    response_ws,
                    {"type": "update_result", "req_id": req_id, "ok": False,
                     "error_code": "update_failed", "error": "update operation failed"},
                )
            finally:
                if applying and not self.restart_requested and not app_restart_scheduled:
                    self.update_applying = False
                    await self._send_update_result(response_ws, {"type": "update_ready"})

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
        if self.update_applying:
            await self._send({"type": "dispatch_ack", "run_id": run_id, "accepted": False})
            return
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

    def _managed_app_version(self) -> str:
        if os.environ.get("TETHER_NODE_MANAGED") != "1":
            return ""
        try:
            data = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))
            return str((data.get("components") or {}).get("app") or "")
        except (OSError, ValueError):
            return ""

    def _managed_plugin_version(self) -> str:
        manager = self.update_managers.get("plugin")
        if manager is None:
            return ""
        try:
            status = manager.status()
            return str(status.get("current_version") or "") if status.get("ok") else ""
        except Exception:
            return ""

    def capabilities(self) -> dict[str, Any]:
        app_version = self._managed_app_version()
        plugin_version = self._managed_plugin_version()
        installed = [name for name, version in (("app", app_version), ("plugin", plugin_version)) if version]
        return {"os": platform.system(), "release": platform.release(), "os_label": os_label(),
                "python": platform.python_version(),
                "node_version": self.node_version, "update_protocol": UPDATE_PROTOCOL,
                "min_update_protocol": MIN_UPDATE_PROTOCOL,
                "max_update_protocol": MAX_UPDATE_PROTOCOL,
                "update_features": ["check", "prepare", "apply", "app_restart", "plugin_profile_fallback"],
                "update_manifest": "hub-or-github",
                "workspace": str(self.workspace), "agents": ["fake", "dsh"], "fs": True,
                "policy_mode": self.fs.policy.data.get("mode"),
                "workspaces_root": str(self.workspaces_root),
                "dsh_native": self.dsh_sessions.available(),
                "native_dsh_home": str(self.dsh_sessions.home),
                "surface_protocol": 1,
                "app_version": app_version,
                "plugin_version": plugin_version,
                "installed_products": installed,
                "dsh_surface": self.native_surface.available()}


def restart_node_process() -> None:
    if os.environ.get("TETHER_NODE_MANAGED") == "1":
        raise SystemExit(75)
    original = getattr(sys, "orig_argv", None)
    if original and len(original) > 1:
        os.execv(sys.executable, [sys.executable, *original[1:]])
    os.execv(sys.executable, [sys.executable, "-m", "tether.node.agent", *sys.argv[1:]])


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
    ap.add_argument("--local-api-token", default=os.environ.get("TETHER_LOCAL_API_TOKEN", ""))
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
    console_server = None
    try:
        console_server = local_console.start(store, args.device, args.console_port,
                                             api=node, token=args.local_api_token)
        mode = "local API" if args.local_api_token else "read-only"
        log(f"[console] http://127.0.0.1:{args.console_port} ({mode}, local)")
    except OSError as exc:
        log(f"[console] not started: {exc}")
    identity_published = False
    try:
        write_identity(node.native_dsh_home, args.device)
        identity_published = True
    except Exception as exc:  # noqa: BLE001 - identity metadata must not block the Node service
        log(f"[node] local identity descriptor not published: {exc}")

    async def run_with_identity() -> None:
        async def refresh_identity() -> None:
            while True:
                await asyncio.sleep(3)
                try:
                    write_identity(node.native_dsh_home, args.device)
                except Exception as exc:  # noqa: BLE001 - keep the identity heartbeat auxiliary
                    log(f"[node] local identity refresh failed: {exc}")

        refresher = asyncio.create_task(refresh_identity()) if identity_published else None
        try:
            await node.run()
        finally:
            if refresher is not None:
                refresher.cancel()
                await asyncio.gather(refresher, return_exceptions=True)
            if identity_published:
                remove_identity(node.native_dsh_home, args.device)

    try:
        asyncio.run(run_with_identity())
    except KeyboardInterrupt:
        pass
    if node.restart_requested:
        if console_server is not None:
            console_server.shutdown()
            console_server.server_close()
        store.db.close()
        restart_node_process()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
