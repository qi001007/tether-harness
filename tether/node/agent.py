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
import random
import sqlite3
import ssl
import sys
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import websockets
from dotenv import load_dotenv

from . import console as local_console
from .dsh_adapter import DshRun
from .fs_service import FsError, FsService
from .direct_api import DirectApi
from .terminal import TerminalService
from .apps import AppCatalog
from .acp import AcpService
from .dsh_sessions import DshSessionStore
from .debian_package_update import (DebianPackageUpdateError, DebianPackageUpdater,
                                    OWNER as DEBIAN_PACKAGE_UPDATE_OWNER)
from .native_surface import NativeSurface, NativeSurfaceError
from .croc_transfer import CrocTransfer
from .local_identity import remove_identity, write_identity
from ..updates import (MAX_UPDATE_PROTOCOL, MIN_UPDATE_PROTOCOL, UPDATE_PROTOCOL, UpdateManager,
                       UpdateError, _controller_origin, _semver, _versions_from_root,
                       load_app_installation, select_profile)


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


class _RejectUpdateBridgeRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> None:
        return None


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
            close_fds=True,
            creationflags=(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW),
        )
        record("restart helper started")
        return True
    except Exception as exc:  # noqa: BLE001 - restart failure must not crash the update reader
        record(f"restart helper could not be started: {type(exc).__name__}: {exc}")
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
                 workspaces_root: Path | None = None, data_dir: Path | None = None,
                 user_token: str = "") -> None:
        self.url = url
        self.token = token
        self.user_token = user_token
        self.device_token = ""
        self.device = device
        self.workspace = workspace
        self.store = store
        self.drop_after = drop_after
        self.drop_for = drop_for
        self._block_until = 0.0
        self.agent = agent
        self.data_dir = Path(data_dir or (ROOT / ".runtime")).expanduser().resolve()
        self.app_update_bridge_state_path = self.data_dir / "app-update-bridge.json"
        self.app_update_bridge_state = self._load_app_update_bridge_state()
        legacy_app_owner = os.environ.get("TETHER_NODE_UPDATE_OWNER", "").strip().lower() == "app_installer"
        self.app_update_owner = os.environ.get(
            "TETHER_APP_UPDATE_OWNER", "app_installer" if legacy_app_owner else "node_zip").strip().lower()
        if self.app_update_bridge_state:
            self.app_update_owner = str(self.app_update_bridge_state["owner"])
        self.app_update_verified_version = str(
            (self.app_update_bridge_state or {}).get("verified_app_version") or "")
        self.device_token_path = self.data_dir / "device-token.json"
        try:
            saved = json.loads(self.device_token_path.read_text(encoding="utf-8"))
            saved_token = str(saved.get("token") or "")
            if saved.get("device_id") == self.device and saved_token:
                self.device_token = saved_token
                self.token = saved_token
        except (OSError, ValueError, TypeError):
            pass
        self.provider = provider
        self.model = model
        self.workspaces_root = workspaces_root or default_workspaces_root()
        self.dsh_sessions = DshSessionStore(dsh_home)
        self.native_dsh_home = self.dsh_sessions.home
        self.dsh_home = str(self.native_dsh_home)
        self.fs = FsService(device=device, workspace=workspace,
                            data_dir=self.data_dir,
                            workspaces_root=self.workspaces_root,
                            dsh_home=self.native_dsh_home)
        self.direct = DirectApi(self.fs.dispatch, stream=self.fs)
        self._direct_started = False
        self.fs.direct = self.direct
        self.terminal = TerminalService(self.workspace)
        self.fs.terminal = self.terminal
        self.apps = AppCatalog(self.data_dir)
        self.fs.apps = self.apps
        threading.Thread(target=self.fs.agents.catalog, kwargs={'force': True}, daemon=True).start()
        self.acp = AcpService(self.workspace)
        self.fs.acp = self.acp
        self.croc = CrocTransfer()
        self.fs.croc = self.croc
        ensure_sdk_profile(self.native_dsh_home)
        web_home = self.fs.dsh_web.dsh_home if self.fs.dsh_web is not None else None
        self.native_surface = NativeSurface(
            self.native_dsh_home, device_fs=self.fs,
            fallback_homes=(web_home,) if web_home is not None else ())
        self.fs.service_access.native_surface = self.native_surface
        self.remote_desktop = None
        self.remote_desktop_error = "meshcentral_runtime_missing"
        node_executable = os.environ.get("TETHER_NODEJS_EXE", "")
        meshcentral_root = os.environ.get("TETHER_MESHCENTRAL_ROOT", "")
        meshagent_executable = os.environ.get("TETHER_MESHAGENT_EXE", "")
        if node_executable and meshcentral_root and meshagent_executable:
            try:
                from .remote_desktop import MeshCentralDesktop
                self.remote_desktop = MeshCentralDesktop(
                    node_executable=node_executable, meshcentral_root=meshcentral_root,
                    meshagent_executable=meshagent_executable, data_dir=self.data_dir,
                    target_id=self.device, get_device_state=self._remote_desktop_device_state)
                self.remote_desktop_error = ""
            except Exception as exc:
                self.remote_desktop_error = getattr(exc, "code", "meshcentral_runtime_missing")
        self.fs.service_access.remote_desktop = self.remote_desktop
        self.fs.service_access.remote_desktop_error = self.remote_desktop_error
        update_state_dir = self.data_dir / "updates"
        manifest_url = release_manifest_url()
        plugin_profile = select_profile(Path(self.native_dsh_home), "desktop") or "desktop"
        self.update_managers = {
            component: UpdateManager(ROOT, component, dsh_home=self.native_dsh_home,
                                     manifest_url=manifest_url, state_dir=update_state_dir / component,
                                     device=self.device, profile=plugin_profile if component == "plugin" else "desktop")
              for component in ("node", "plugin")
        }
        self.update_managers["app"] = self._make_app_update_manager(manifest_url)
        self.app_update_bridge_url = os.environ.get("TETHER_APP_UPDATE_BRIDGE_URL", "").strip()
        self.app_update_bridge_token = os.environ.get("TETHER_APP_UPDATE_BRIDGE_TOKEN", "").strip()
        self.app_update_bridge_legacy = bool(legacy_app_owner and self.app_update_bridge_url and self.app_update_bridge_token)
        self.debian_package_updater = DebianPackageUpdater(self.data_dir)
        self.debian_package_update_status = None
        self.debian_package_update_capability = None
        if os.environ.get("TETHER_NODE_UPDATE_OWNER", "").strip().lower() == DEBIAN_PACKAGE_UPDATE_OWNER:
            try:
                self.debian_package_update_capability = self.debian_package_updater.availability()
                self.debian_package_update_status = self.debian_package_update_capability.get("transaction")
            except DebianPackageUpdateError as exc:
                log(f"[update] package transaction reconciliation failed: {exc.code}")
                self.debian_package_update_capability = {"available": False, "reason": exc.code}
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

    def _remote_desktop_device_state(self) -> dict[str, Any]:
        system = platform.system()
        display_supported = False
        try:
            if system == "Windows":
                import ctypes
                user32 = ctypes.WinDLL("user32", use_last_error=True)
                user32.OpenInputDesktop.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
                user32.OpenInputDesktop.restype = ctypes.c_void_p
                user32.GetSystemMetrics.argtypes = [ctypes.c_int]
                user32.GetSystemMetrics.restype = ctypes.c_int
                user32.CloseDesktop.argtypes = [ctypes.c_void_p]
                user32.CloseDesktop.restype = ctypes.c_bool
                desktop = user32.OpenInputDesktop(0, False, 0x0100)
                if desktop:
                    try:
                        display_supported = bool(user32.GetSystemMetrics(0) and user32.GetSystemMetrics(1))
                    finally:
                        user32.CloseDesktop(desktop)
            elif system == "Darwin":
                import ctypes
                graphics = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
                graphics.CGMainDisplayID.restype = ctypes.c_uint32
                display_supported = bool(graphics.CGMainDisplayID())
            else:
                display_supported = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        except (AttributeError, OSError, ValueError):
            display_supported = False
        desktop_reason = "" if display_supported else "display_unavailable"
        busy_reason = ""
        try:
            if (any(run.get("state") in ACTIVE for run in self.store.all_runs()) or
                    any(not task.done() for task in self.tasks.values())):
                busy_reason = "tether_agent_task_active"
            session_files = self.dsh_sessions._files()
            if any(path.name.endswith(".zstd") for path in session_files) and not self.dsh_sessions.available():
                busy_reason = busy_reason or "dsh_activity_unknown"
            if any(item.get("status") == "running" for item in self.dsh_sessions.list()):
                busy_reason = busy_reason or "dsh_turn_active"
            activity = self.fs.agents_runtime.activity()
            if activity.get("ok") is not True or not isinstance(activity.get("busy"), bool):
                busy_reason = busy_reason or "agents_activity_unknown"
            else:
                if activity["busy"]:
                    busy_reason = busy_reason or str(activity.get("reason") or "agents_runtime_active")
        except Exception:
            busy_reason = busy_reason or "agent_activity_unknown"
        return {"desktop_supported": display_supported, "desktop_reason": desktop_reason,
                "busy": bool(busy_reason),
                "busy_reason": busy_reason}

    def _active_plugin_profile(self, preferred: str) -> str | None:
        return self.native_surface.active_profile() or select_profile(self._active_plugin_home(), preferred)

    def _active_plugin_home(self) -> Path:
        return self.native_surface.active_home() or Path(self.native_dsh_home)

    async def _warm_updates(self) -> None:
        await asyncio.sleep(2)
        while True:
            try:
                if not self.update_applying:
                    manager = self.update_managers["node"]
                    await asyncio.to_thread(manager.check)
                    plugin = self.update_managers["plugin"]
                    profile = await asyncio.to_thread(self._active_plugin_profile, plugin.profile)
                    if profile:
                        plugin_home = await asyncio.to_thread(self._active_plugin_home)
                        active_plugin = UpdateManager(
                            getattr(plugin, "root", ROOT), "plugin", dsh_home=plugin_home,
                            manifest_url=getattr(plugin, "manifest_url", None),
                            state_dir=getattr(plugin, "state_dir", None), profile=profile,
                            device=self.device)
                        await asyncio.to_thread(active_plugin.check)
            except Exception:
                pass
            await asyncio.sleep(600)

    async def run(self) -> None:
        if self.direct is not None and not self._direct_started:
            try:
                self.direct.start()
                self._direct_started = True
            except OSError:
                self.direct = None
                self.fs.direct = None
        try:
            await asyncio.to_thread(self.apps.ensure)
        except Exception:
            pass
        warm = asyncio.create_task(self._warm_updates())
        backoff = 0.1
        while True:
            if self._block_until > time.monotonic():
                await asyncio.sleep(self._block_until - time.monotonic())
            try:
                await self._session()
                backoff = 0.1
            except Exception as exc:  # noqa: BLE001 - reconnect forever
                log(f"[ws] disconnected: {type(exc).__name__}: {exc}")
            self.connected = False
            if self.restart_requested:
                return
            # A phone waking from sleep or a brief network blip should reconnect
            # immediately; repeated failures still back off to a two-second cap.
            await asyncio.sleep(backoff * (0.8 + random.random() * 0.4))
            backoff = min(backoff * 2, 2.0)

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
            register = {"type": "register", "device_id": self.device, "name": self.device,
                        "token": self.token, "platform": platform.platform(),
                        "capabilities": self.capabilities()}
            if self.user_token and not self.device_token:
                register["user_token"] = self.user_token
            await self._send(register)
            first = json.loads(await ws.recv())
            if first.get("type") != "registered":
                raise RuntimeError(f"registration failed: {first}")
            issued = first.get("device_token")
            if isinstance(issued, str) and issued and not self.device_token:
                self._persist_device_token(issued)
            self.connected = True
            log(f"[ws] registered as {self.device} at {self.url}")
            for msg in self._state_messages():
                await self._send(msg)
            for event in self.store.pending():
                await self._send({"type": "event", **event})
            log(f"[ws] replayed {len(self.store.pending())} pending event(s)")
            hb = asyncio.create_task(self._heartbeat())
            lag = asyncio.create_task(self._watch_loop_lag())
            ticket = first.get("surface_ticket")
            surface_channel = (asyncio.create_task(self._surface_channel(ws, ticket, connect_options))
                               if isinstance(ticket, str) and 0 < len(ticket) <= 128 else None)
            try:
                while True:
                    raw = await ws.recv()
                    await self._handle(json.loads(raw))
            finally:
                hb.cancel()
                lag.cancel()
                if surface_channel is not None:
                    surface_channel.cancel()
                    await asyncio.gather(surface_channel, return_exceptions=True)
                for tasks in (self.fs_tasks, self.dsh_tasks, self.surface_tasks):
                    for task in tuple(tasks):
                        task.cancel()
                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)
                    tasks.clear()
                await self.native_surface.dispose()
                self.ws = None

    async def _surface_channel(self, control: Any, ticket: str, options: dict[str, Any]) -> None:
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(self.url)
        if not parts.path.endswith("/ws/node"):
            return
        endpoint = urlunsplit(parts._replace(path=parts.path[:-4] + "node-surface"))
        delay = 0.1
        while self.ws is control:
            owned: set[asyncio.Task] = set()
            try:
                async with websockets.connect(endpoint, **options) as channel:
                    await channel.send(json.dumps({"type": "register_surface",
                                                   "device_id": self.device, "ticket": ticket}))
                    first = json.loads(await asyncio.wait_for(channel.recv(), timeout=10))
                    if not isinstance(first, dict) or first.get("type") != "surface_registered":
                        raise RuntimeError("surface registration failed")
                    delay = 0.1
                    while self.ws is control:
                        message = json.loads(await channel.recv())
                        if not isinstance(message, dict) or message.get("type") != "surface_call":
                            raise RuntimeError("unexpected surface channel message")
                        if len(self.surface_tasks) >= 64:
                            await channel.send(json.dumps({
                                "type": "surface_result", "req_id": str(message.get("req_id") or ""),
                                "ok": False, "code": "capacity", "error": "too many pending surface requests",
                            }))
                            continue
                        task = asyncio.create_task(self._surface_call(message, response_ws=channel))
                        self.surface_tasks.add(task)
                        owned.add(task)
                        task.add_done_callback(self.surface_tasks.discard)
                        task.add_done_callback(owned.discard)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - the control channel owns node presence
                log(f"[surface] channel disconnected: {type(exc).__name__}")
            finally:
                for task in tuple(owned):
                    task.cancel()
                if owned:
                    await asyncio.gather(*owned, return_exceptions=True)
            if self.ws is control:
                await asyncio.sleep(delay)
                delay = min(delay * 2, 2.0)

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
                app_fields = await asyncio.to_thread(self._app_heartbeat_fields)
                await self._send({"type": "heartbeat", "ts": time.time(), **app_fields})
            except Exception as exc:  # noqa: BLE001 - a dead socket is handled by the reconnect loop
                log(f"[ws] heartbeat send failed: {exc!r}")
                return

    async def _watch_loop_lag(self) -> None:
        while True:
            started = time.monotonic()
            await asyncio.sleep(2)
            lag = time.monotonic() - started - 2
            if lag > 0.5:
                log(f"[ws] event loop blocked for {lag:.1f}s")

    def _persist_device_token(self, token: str) -> None:
        self.device_token = token
        self.token = token
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            temp = self.device_token_path.with_suffix(".tmp")
            temp.write_text(json.dumps({"schema": 1, "device_id": self.device, "token": token}),
                            encoding="utf-8")
            os.replace(temp, self.device_token_path)
            try:
                os.chmod(self.device_token_path, 0o600)
            except OSError:
                pass
            log("[ws] device token issued and saved")
        except OSError as exc:
            log(f"[ws] could not save the device token: {exc}")

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
        elif kind == "restart_node":
            if any(run and run.get("state") in ACTIVE for run in self.store.all_runs()):
                await self._send({"type": "restart_denied", "reason": "tether_task_active"})
                return
            log("[ws] restart requested by controller")
            self.restart_requested = True
            try:
                await self._send({"type": "restart_ack"})
            except Exception:  # noqa: BLE001 - the socket may already be closing
                pass
            try:
                await self.ws.close()
            except Exception:  # noqa: BLE001 - closing is best effort
                pass
            return
        elif kind == "error":
            log(f"[ws] controller error: {msg.get('error')}")

    async def _fs_call(self, msg: dict[str, Any]) -> None:
        req_id = str(msg.get("req_id") or "")
        op = str(msg.get("op") or "")
        args = msg.get("args") or {}
        try:
            result = await asyncio.to_thread(self.fs.dispatch_hub, op, args, msg.get("authority"))
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

    async def _surface_call(self, msg: dict[str, Any], response_ws: Any = None) -> None:
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
            if response_ws is None:
                await self._send(reply)
            else:
                await response_ws.send(json.dumps(reply, ensure_ascii=False))
        except Exception:
            if response_ws is None or response_ws is self.ws:
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
        if (manager is None or os.environ.get("TETHER_NODE_MANAGED") != "1"
                or Path(getattr(manager, "root", ROOT)).resolve() != ROOT.resolve()):
            return False
        try:
            status = manager.status()
        except Exception:  # noqa: BLE001 - deferral is best effort
            return False
        return bool(status.get("ok") and status.get("prepared"))

    def _update_busy_reason(self, component: str | None = None) -> str | None:
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
        if component == "node":
            try:
                transfer = self.croc.status()
            except Exception:
                return "transfer_activity_unknown"
            if not isinstance(transfer, dict) or not isinstance(transfer.get("state"), str):
                return "transfer_activity_unknown"
            if transfer["state"] == "running":
                return "croc_transfer_active"
            if transfer["state"] not in {"idle", "completed", "failed", "cancelled"}:
                return "transfer_activity_unknown"
            try:
                if self.fs.transfer_jobs.has_active_jobs():
                    return "transfer_job_active"
                if self.fs.sftpgo_grants.has_active_grants():
                    return "transfer_grant_active"
                if self.fs.service_access.has_active_workers():
                    return "service_grant_active"
            except Exception:
                return "node_business_activity_unknown"
            try:
                agents = self.fs.agents_runtime.activity()
            except Exception:
                return "agents_activity_unknown"
            if not isinstance(agents, dict) or agents.get("ok") is not True or not isinstance(agents.get("busy"), bool):
                return "agents_activity_unknown"
            if agents["busy"]:
                return "agents_activity_unknown" if agents.get("reason") == "activity_unknown" else str(
                    agents.get("reason") or "agents_runtime_active")
        return None

    async def _update_call(self, msg: dict[str, Any], response_ws: Any = None) -> None:
        if response_ws is None:
            response_ws = self.ws
        req_id = str(msg.get("req_id") or "")
        component = msg.get("component")
        action = msg.get("action")
        registration = action == "register_app_bridge"
        allowed = ({"type", "req_id", "action", "component", "bridge_url", "bridge_token"}
                   if registration else {"type", "req_id", "action", "component", "prepared_id"})
        if (set(msg) - allowed or not isinstance(component, str) or component not in self.update_managers
                or not isinstance(action, str) or action not in {"check", "status", "prepare", "apply", "commit", "rollback", "restart", "register_app_bridge"}
                or (action in {"apply", "commit", "rollback"}) != ("prepared_id" in msg)
                or (action == "restart" and component != "plugin")
                or (registration and (component != "app" or set(msg) != {
                    "type", "req_id", "action", "component", "bridge_url", "bridge_token"}))):
            await self._send_update_result(
                response_ws,
                {"type": "update_result", "req_id": req_id, "ok": False,
                 "error_code": "invalid_update_request", "error": "invalid update request"},
            )
            return
        component = str(component)
        if registration:
            await self._register_app_update_bridge(msg, response_ws, req_id)
            return
        node_update_owner = os.environ.get("TETHER_NODE_UPDATE_OWNER", "").strip().lower()
        if (component == "node" and os.environ.get("TETHER_NODE_SELF_UPDATE_ENABLED") == "0"
                and action != "status"):
            await self._send_update_result(
                response_ws,
                {"type": "update_result", "req_id": req_id, "ok": False,
                 "error_code": "node_update_disabled",
                 "error": "该节点已禁用自动更新。"},
            )
            return
        if (component == "node" and node_update_owner in {"app_installer", "bundle_installer"}
                and action != "status"):
            owner_label = ("Tether APP installer" if node_update_owner == "app_installer"
                           else "the complete Node runtime bundle installer")
            owner_error_code = ("node_update_managed_by_app_installer"
                                if node_update_owner == "app_installer"
                                else "node_update_managed_by_bundle_installer")
            await self._send_update_result(
                response_ws,
                {"type": "update_result", "req_id": req_id, "ok": False,
                 "error_code": owner_error_code,
                 "error": f"Node runtime updates are managed by {owner_label}"},
            )
            return
        if component == "app" and self.app_update_owner == "app_installer":
            await self._electron_app_update_call(msg, response_ws, action, req_id)
            return
        debian_node_update = (component == "node" and node_update_owner == DEBIAN_PACKAGE_UPDATE_OWNER)
        if debian_node_update and action not in {"status"}:
            try:
                availability = await asyncio.to_thread(self.debian_package_updater.availability)
            except DebianPackageUpdateError as exc:
                await self._send_update_result(
                    response_ws,
                    {"type": "update_result", "req_id": req_id, "ok": False,
                     "error_code": exc.code, "error": exc.message},
                )
                return
            self.debian_package_update_capability = availability
            if not availability["available"]:
                reason = str(availability.get("reason") or "debian_update_unavailable")
                await self._send_update_result(
                    response_ws,
                    {"type": "update_result", "req_id": req_id, "ok": False,
                     "error_code": reason,
                     "error": "Native Debian package updates are unavailable on this Node"},
                )
                return
        if component == "app":
            self._refresh_app_update_manager()
        applying = action == "apply"
        app_restart_scheduled = False
        guard_node_runtime = component == "node"
        if applying and component == "app":
            app_manager = self.update_managers["app"]
            guard_node_runtime = (os.environ.get("TETHER_NODE_MANAGED") == "1"
                                  and Path(getattr(app_manager, "root", ROOT)).resolve()
                                  == ROOT.resolve())
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
                    self._active_plugin_home(), getattr(manager, "profile", "desktop"))
                if not profile:
                    await self._send_update_result(
                        response_ws,
                        {"type": "update_result", "req_id": req_id, "ok": False,
                         "error_code": "plugin_package_missing",
                         "error": "未找到已安装的 Tether DSH 插件 profile，无法检测插件更新。"},
                    )
                    return
                manager = UpdateManager(getattr(manager, "root", ROOT), component,
                                        dsh_home=self._active_plugin_home(),
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
                     "error_code": getattr(exc, "code", "update_failed"),
                     "error": getattr(exc, "message", "update operation failed")},
                )
            else:
                if component == "node" and result.get("ok"):
                    runtime_version = self.node_version
                    try:
                        versions_match = _semver(runtime_version) == _semver(result.get("current_version"))
                    except UpdateError:
                        versions_match = False
                    result = {**result, "runtime_version": runtime_version,
                              "restart_required": not versions_match}
                if debian_node_update and action == "status":
                    package_status = await asyncio.to_thread(self.debian_package_updater.availability)
                    self.debian_package_update_capability = package_status
                    result = {**result, "package_update": package_status,
                              "node_self_update_enabled": bool(package_status.get("available"))}
                await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id, **result}
                )
            return
        async with self.update_lock:
            if component == "plugin":
                profile = self.native_surface.active_profile() or select_profile(
                    self._active_plugin_home(), getattr(self.update_managers[component], "profile", "desktop"))
                if not profile:
                    await self._send_update_result(
                        response_ws,
                        {"type": "update_result", "req_id": req_id, "ok": False,
                         "error_code": "plugin_package_missing",
                         "error": "未找到已安装的 Tether DSH 插件 profile，无法更新插件。"},
                    )
                    return
                self.update_managers[component].dsh_home = self._active_plugin_home()
                self.update_managers[component].profile = profile
            if applying:
                # Block new dispatches before inspecting native DSH logs off-loop.
                self.update_applying = True
                busy_component = "node" if guard_node_runtime else component
                busy = await asyncio.to_thread(self._update_busy_reason, busy_component)
                if busy:
                    self.update_applying = False
                    busy_error = ("正在执行任务或文件传输，完成或取消后重试。"
                                  if busy in {"tether_task_active", "native_dsh_turn_active",
                                              "croc_transfer_active", "agent_turn_active",
                                              "agent_interaction_pending", "agent_delegation_active",
                                              "transfer_job_active", "transfer_grant_active", "service_grant_active",
                                              "agent_background_task_active"}
                                  else "无法确认任务或文件传输状态，请稍后重试。")
                    await self._send_update_result(
                        response_ws,
                        {"type": "update_result", "req_id": req_id, "ok": False,
                         "error_code": "update_busy", "error": busy_error,
                         "busy_reason": busy},
                    )
                    await self._send_update_result(response_ws, {"type": "update_ready"})
                    return
            manager = self.update_managers[component]
            result: dict[str, Any] | None = None
            try:
                if action == "apply":
                    if component == "node":
                        if debian_node_update:
                            result = await asyncio.to_thread(self.debian_package_updater.apply,
                                                             manager, msg["prepared_id"])
                            if result.get("ok"):
                                package_capability = dict(self.debian_package_update_capability or {})
                                package_capability["transaction"] = {
                                    "prepared_id": msg["prepared_id"],
                                    "state": result.get("status", "in_progress"),
                                    "unit": result.get("unit"),
                                    "target_version": result.get("target_version")}
                                self.debian_package_update_capability = package_capability
                        else:
                            try:
                                await asyncio.to_thread(self.fs.agents_runtime.stop)
                            except Exception as exc:  # noqa: BLE001 - best effort; apply reports locks
                                log(f"[update] agents runtime stop failed before node update: {exc!r}")
                            result = await asyncio.to_thread(manager.apply, msg["prepared_id"])
                    else:
                        result = await asyncio.to_thread(manager.apply, msg["prepared_id"])
                elif action in {"commit", "rollback"}:
                    result = await asyncio.to_thread(getattr(manager, action), msg["prepared_id"])
                else:
                    result = await asyncio.to_thread(getattr(manager, str(action)))
                applied = (not debian_node_update and bool(result.get("ok"))
                           and result.get("status") != "in_progress"
                           and result.get("in_progress") is not True)
                node_deferred = False
                if applied and component == "plugin" and action == "apply":
                    result["restart_required"] = True
                rollback_node = action == "rollback" and component == "node" and applied
                if rollback_node:
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
                if applying and applied and component == "app":
                    app_manager = self.update_managers["app"]
                    app_root = Path(getattr(app_manager, "root", ROOT)).resolve()
                    same_managed_root = (os.environ.get("TETHER_NODE_MANAGED") == "1"
                                         and app_root == ROOT.resolve())
                    restart_scheduled = await asyncio.to_thread(schedule_app_restart, app_root)
                    if restart_scheduled and same_managed_root:
                        app_restart_scheduled = True
                        self.update_applying = True
                        result["restart_scheduled"] = True
                    elif restart_scheduled:
                        result["restart_scheduled"] = True
                    else:
                        applied = False
                        result = {"ok": False, "error_code": "restart_failed",
                                  "error": "APP restart helper could not be started"}
                response_sent = await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id, **result}
                )
                if applying and applied and component == "node" and not node_deferred:
                    if self.ws is not None:
                        try:
                            await self.ws.close(code=1012, reason="node update applied")
                        except Exception:
                            pass
                    return
                if rollback_node:
                    self.restart_requested = True
                    self.update_applying = True
                    if self.ws is not None:
                        try:
                            await self.ws.close(code=1012, reason="node update rolled back")
                        except Exception:
                            pass
                    return
            except Exception as exc:  # noqa: BLE001 - updater errors do not take down the WS reader
                log(f"[update] {action} {component} failed: {type(exc).__name__}: {exc}")
                log(traceback.format_exc())
                await self._send_update_result(
                    response_ws,
                    {"type": "update_result", "req_id": req_id, "ok": False,
                     "error_code": getattr(exc, "code", "update_failed"),
                     "error": getattr(exc, "message", "update operation failed")},
                )
            finally:
                if applying and not self.restart_requested and not app_restart_scheduled:
                    self.update_applying = False
                    await self._send_update_result(response_ws, {"type": "update_ready"})

    async def _electron_app_update_call(self, msg: dict[str, Any], response_ws: Any,
                                        action: str, req_id: str) -> None:
        """Route installer-owned APP updates through its authenticated Electron updater bridge."""
        accepted_sent = False
        try:
            if action in {"status", "check", "prepare"}:
                result = await asyncio.to_thread(self._app_update_bridge_request_sync, action)
                await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id, **result})
                last_result = result.get("last_result")
                if (action == "status" and self.update_applying and isinstance(last_result, dict)
                        and last_result.get("source") == "electron-updater"
                        and last_result.get("ok") is False):
                    self.update_applying = False
                    await self._send_update_result(response_ws, {"type": "update_ready"})
                return
            if action != "apply":
                raise UpdateError("invalid_update_request")
            if self.update_applying:
                await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id,
                                  **self._update_in_progress("app")})
                return
            async with self.update_lock:
                self.update_applying = True
                busy = await asyncio.to_thread(self._update_busy_reason, "node")
                if busy:
                    self.update_applying = False
                    await self._send_update_result(response_ws, {
                        "type": "update_result", "req_id": req_id, "ok": False,
                        "error_code": "update_busy",
                        "error": "目标 Node 正在执行任务或传输，完成后重试。",
                        "busy_reason": busy})
                    await self._send_update_result(response_ws, {"type": "update_ready"})
                    return
                prepared_id = msg["prepared_id"]
                accepted = await asyncio.to_thread(
                    self._app_update_bridge_request_sync, "apply", prepared_id, "accept")
                accepted["status"] = "installing"
                accepted["restart_required"] = True
                sent = await self._send_update_result(
                    response_ws, {"type": "update_result", "req_id": req_id, **accepted})
                if not sent:
                    self.update_applying = False
                    return
                accepted_sent = True
                # Controller has now received the accepted job result. The APP bridge
                # flushes its acknowledgement before stopping this managed Node.
                await asyncio.to_thread(
                    self._app_update_bridge_request_sync, "apply", prepared_id, "commit")
        except Exception as exc:  # noqa: BLE001 - keep the Node reader alive on updater failures
            code = getattr(exc, "code", "update_failed")
            message = getattr(exc, "message", "目标桌面 APP 更新失败。")
            log(f"[update] {action} app failed: {code}")
            if not accepted_sent:
                await self._send_update_result(response_ws, {
                    "type": "update_result", "req_id": req_id, "ok": False,
                    "error_code": code, "error": message})
            if action == "apply" and self.update_applying:
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

    async def _register_app_update_bridge(self, msg: dict[str, Any], response_ws: Any, req_id: str) -> None:
        bridge_url = msg.get("bridge_url")
        bridge_token = msg.get("bridge_token")
        try:
            status = await asyncio.to_thread(
                self._app_update_bridge_request_sync, "status", timeout=5.0,
                bridge_url=bridge_url, bridge_token=bridge_token, allow_unowned=True)
            version = str(status.get("current_version") or "")
            _semver(version)
            controller_origin = self._app_controller_origin()
            if (status.get("device_id") != self.device
                    or status.get("controller_origin") != controller_origin):
                raise UpdateError("app_update_bridge_identity_mismatch")
            state = {"schema": 1, "device_id": self.device,
                     "controller_origin": controller_origin, "owner": "app_installer",
                     "verified_app_version": version}
            self.data_dir.mkdir(parents=True, exist_ok=True)
            temp = self.app_update_bridge_state_path.with_suffix(".tmp")
            temp.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
            os.replace(temp, self.app_update_bridge_state_path)
            try:
                os.chmod(self.app_update_bridge_state_path, 0o600)
            except OSError:
                pass
        except Exception as exc:
            code = getattr(exc, "code", "app_update_bridge_invalid")
            await self._send_update_result(response_ws, {
                "type": "update_result", "req_id": req_id, "ok": False,
                "error_code": code if isinstance(code, str) and code.islower() else "app_update_bridge_invalid",
                "error": "APP 更新桥身份验证失败；现有绑定未更改。"})
            return
        self.app_update_bridge_url = str(bridge_url)
        self.app_update_bridge_token = str(bridge_token)
        self.app_update_owner = "app_installer"
        self.app_update_verified_version = version
        self.app_update_bridge_state = state
        self.app_update_bridge_legacy = False
        await self._send_update_result(response_ws, {
            "type": "update_result", "req_id": req_id, "ok": True,
            "app_update_owner": "app_installer", "app_version": version,
            "app_update_bridge_available": True})

    def _app_controller_origin(self) -> str:
        return _controller_origin(self.url)

    def _load_app_update_bridge_state(self) -> dict[str, Any] | None:
        path = self.data_dir / "app-update-bridge.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if (not isinstance(value, dict) or set(value) != {
                    "schema", "device_id", "controller_origin", "owner", "verified_app_version"}
                    or value.get("schema") != 1 or value.get("device_id") != self.device
                    or value.get("controller_origin") != self._app_controller_origin()
                    or value.get("owner") != "app_installer"):
                return None
            _semver(str(value.get("verified_app_version") or ""))
            return value
        except (OSError, ValueError, TypeError, UpdateError):
            return None

    def _app_update_bridge_request_sync(self, action: str, prepared_id: str | None = None,
                                        phase: str | None = None, *, timeout: float | None = None,
                                        bridge_url: str | None = None, bridge_token: str | None = None,
                                        allow_unowned: bool = False) -> dict[str, Any]:
        endpoint = bridge_url if bridge_url is not None else self.app_update_bridge_url
        url = urllib.parse.urlsplit(endpoint)
        token = bridge_token if bridge_token is not None else self.app_update_bridge_token
        try:
            valid_port = bool(url.port and 1 <= url.port <= 65535)
        except ValueError:
            valid_port = False
        if ((not allow_unowned and self.app_update_owner != "app_installer")
                or url.scheme != "http" or url.hostname != "127.0.0.1"
                or not valid_port or url.path != "/v1/update" or url.query or url.fragment
                or url.username or url.password or len(token) != 64
                or any(char not in "0123456789abcdef" for char in token)):
            error = UpdateError("app_update_bridge_unavailable")
            error.message = "目标桌面 APP 未运行或更新服务暂不可用。"
            raise error
        if action not in {"status", "check", "prepare", "apply"}:
            raise UpdateError("invalid_update_request")
        payload: dict[str, Any] = {"action": action}
        if action == "apply":
            if not isinstance(prepared_id, str) or not prepared_id:
                raise UpdateError("prepared_id_required")
            payload["prepared_id"] = prepared_id
            if phase is not None:
                if phase not in {"accept", "commit"}:
                    raise UpdateError("invalid_update_request")
                payload["phase"] = phase
        elif prepared_id is not None or phase is not None:
            raise UpdateError("invalid_update_request")
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            endpoint, data=body, method="POST",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        )
        limits = {"status": 5.0, "check": 45.0, "prepare": 300.0, "apply": 150.0}
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _RejectUpdateBridgeRedirects())
        try:
            with opener.open(request, timeout=timeout or limits[action]) as response:
                raw = response.read(256 * 1024 + 1)
                if len(raw) > 256 * 1024:
                    raise UpdateError("app_update_reply_too_large")
                result = json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                result = json.loads(exc.read(16 * 1024).decode("utf-8"))
            except (ValueError, UnicodeError):
                result = {}
            code = str(result.get("error_code") or "app_update_bridge_failed")
            message = str(result.get("error") or "目标桌面 APP 更新失败。")[:240]
            error = UpdateError(code if code and all(ch.islower() or ch.isdigit() or ch == "_" for ch in code) else "app_update_bridge_failed")
            error.message = message
            raise error from None
        except (OSError, TimeoutError, ValueError, UnicodeError):
            error = UpdateError("app_update_bridge_unavailable")
            error.message = "目标桌面 APP 未运行或更新服务暂不可用。"
            raise error from None
        if not isinstance(result, dict):
            raise UpdateError("invalid_update_reply")
        if result.get("ok") is not True:
            code = str(result.get("error_code") or "app_update_bridge_failed")
            message = str(result.get("error") or "目标桌面 APP 更新失败。")[:240]
            error = UpdateError(code if code and all(ch.islower() or ch.isdigit() or ch == "_" for ch in code) else "app_update_bridge_failed")
            error.message = message
            raise error
        return result

    def _make_app_update_manager(self, manifest_url: str | None = None) -> UpdateManager:
        binding = load_app_installation(self.url, self.device, self.token)
        root = binding["root"] if binding else ROOT
        managed_same_root = (os.environ.get("TETHER_NODE_MANAGED") == "1" and root == ROOT)
        state_dir = root / "apps" / "tether-app" / "data" / "updates" / "app"
        return UpdateManager(root, "app", dsh_home=self.native_dsh_home,
                             manifest_url=manifest_url, state_dir=state_dir,
                             device=self.device, profile="desktop",
                             app_binding_required=not managed_same_root,
                             app_credential=self.token, controller_url=self.url,
                             installation_device=self.device)

    def _refresh_app_update_manager(self) -> None:
        current = self.update_managers.get("app")
        if current is not None and not isinstance(current, UpdateManager):
            return
        manager = self._make_app_update_manager(getattr(current, "manifest_url", None))
        self.update_managers["app"] = manager

    def _app_heartbeat_fields(self) -> dict[str, Any]:
        if self.app_update_owner == "app_installer":
            try:
                status = self._app_update_bridge_request_sync("status", timeout=2.0)
                version = str(status.get("current_version") or "")
                _semver(version)
                bridge_device = status.get("device_id")
                bridge_controller = status.get("controller_origin")
                if bridge_device is None and bridge_controller is None and self.app_update_bridge_legacy:
                    pass
                elif (bridge_device != self.device or bridge_controller != self._app_controller_origin()):
                    raise UpdateError("app_update_bridge_identity_mismatch")
                if version != self.app_update_verified_version:
                    state = {"schema": 1, "device_id": self.device,
                             "controller_origin": self._app_controller_origin(), "owner": "app_installer",
                             "verified_app_version": version}
                    self.data_dir.mkdir(parents=True, exist_ok=True)
                    temp = self.app_update_bridge_state_path.with_suffix(".tmp")
                    temp.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
                    os.replace(temp, self.app_update_bridge_state_path)
                    try:
                        os.chmod(self.app_update_bridge_state_path, 0o600)
                    except OSError:
                        pass
                    self.app_update_bridge_state = state
                    self.app_update_verified_version = version
                return {"app_version": version, "app_installed": True,
                        "app_update_owner": "electron_updater", "app_update_bridge_available": True,
                        "app_update_bridge_registration": 1}
            except Exception:
                return {"app_version": self.app_update_verified_version, "app_installed": bool(self.app_update_verified_version),
                        "app_update_owner": "electron_updater", "app_update_bridge_available": False,
                        "app_update_bridge_registration": 1}
        self._refresh_app_update_manager()
        manager = self.update_managers["app"]
        binding = load_app_installation(self.url, self.device, self.token, manager.root)
        if binding is None and manager.app_binding_required:
            return {"app_version": "", "app_installed": False,
                    "app_update_owner": "node_zip", "app_update_bridge_available": False}
        try:
            installed = str((binding or {}).get("installed_version") or _versions_from_root(manager.root).get("app", ""))
            manager._app_restart_state()
            version = manager._app_current_version(installed) if installed else ""
        except Exception:
            version = ""
            installed = ""
        return {"app_version": version,
                "app_installed": bool(binding) or (bool(installed) and not manager.app_binding_required),
                "app_update_owner": "node_zip", "app_update_bridge_available": False}

    def _managed_app_version(self) -> str:
        return str(self._app_heartbeat_fields().get("app_version") or "")

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
        app_fields = self._app_heartbeat_fields()
        app_version = str(app_fields.get("app_version") or "")
        plugin_version = self._managed_plugin_version()
        node_update_owner = os.environ.get("TETHER_NODE_UPDATE_OWNER", "node").strip().lower()
        debian_package_update = None
        if node_update_owner == DEBIAN_PACKAGE_UPDATE_OWNER:
            debian_package_update = self.debian_package_update_capability or {
                "available": False, "reason": "not_checked",
                "transaction": self.debian_package_update_status}
        node_self_update_enabled = (os.environ.get("TETHER_NODE_SELF_UPDATE_ENABLED") != "0"
                                    and node_update_owner not in {"app_installer", "bundle_installer"})
        if node_update_owner == DEBIAN_PACKAGE_UPDATE_OWNER:
            node_self_update_enabled = bool(debian_package_update and debian_package_update.get("available"))
        installed = [name for name, version in (("app", app_version), ("plugin", plugin_version)) if version]
        if app_fields["app_installed"] and "app" not in installed:
            installed.append("app")
        dsh_desktop = self.fs.dsh_desktop.status()
        return {"os": platform.system(), "release": platform.release(), "os_label": os_label(),
                "python": platform.python_version(),
                "node_version": self.node_version, "update_protocol": UPDATE_PROTOCOL,
                "min_update_protocol": MIN_UPDATE_PROTOCOL,
                "max_update_protocol": MAX_UPDATE_PROTOCOL,
                "node_update_owner": node_update_owner or "node",
                "node_self_update_enabled": node_self_update_enabled,
                **({"debian_package_update": debian_package_update}
                   if debian_package_update is not None else {}),
                "update_features": ["check", "prepare", "apply", "app_restart", "plugin_profile_fallback"],
                "update_manifest": "hub-or-github",
                "workspace": str(self.workspace), "agents": ["fake", "dsh"], "fs": True,
                "terminal": True,
                "terminal_shells": self.terminal.shells(),
                "apps": True,
                "acp": True,
                "policy_mode": self.fs.policy.data.get("mode"),
                "workspaces_root": str(self.workspaces_root),
                "dsh_native": self.dsh_sessions.available(),
                "native_dsh_home": str(self.dsh_sessions.home),
                "surface_protocol": 1,
                "surface_data_protocol": 1,
                "app_version": app_version,
                "app_installed": app_fields["app_installed"],
                "app_update_owner": app_fields.get("app_update_owner", "node_zip"),
                "app_update_bridge_available": app_fields.get("app_update_bridge_available", False),
                "app_update_bridge_registration": app_fields.get("app_update_bridge_registration", 1),
                "plugin_version": plugin_version,
                "installed_products": installed,
                "dsh_installed": dsh_desktop["installed"],
                "dsh_running": dsh_desktop["running"],
                "dsh_version": dsh_desktop["version"],
                "dsh_installing": dsh_desktop["installing"],
                "dsh_install_supported": platform.system() == "Windows",
                "dsh_web_supported": bool(self.fs.dsh_web and self.fs.dsh_web.status().get("supported")),
                "terminal_user": _current_user(),
                "terminal_privileged": _is_privileged(),
                "dsh_surface": self.native_surface.available(),
                **self.fs._transfer_capabilities(),
                "croc": {**self.croc.info(), "legacy": True},
                "direct_api": self.direct.info() if self.direct else None}


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
    ap.add_argument("--user-token", default=os.environ.get("TETHER_USER_TOKEN", ""))
    ap.add_argument("--db", default=str(ROOT / ".runtime" / "node-local.db"))
    ap.add_argument("--drop-after", type=float, default=None, help="test: close the socket N seconds after the first dispatch")
    ap.add_argument("--drop-for", type=float, default=0.0, help="test: keep the socket down for N seconds")
    ap.add_argument("--agent", choices=["fake", "dsh"], default=os.environ.get("TETHER_AGENT", "fake"))
    ap.add_argument("--dsh-home", default=None)
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
                workspaces_root=workspaces_root, data_dir=Path(args.db).resolve().parent,
                user_token=args.user_token)
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
        def publish_dsh_identity() -> None:
            write_identity(node.native_dsh_home, args.device)
            web = node.fs.dsh_web
            if web is not None and web.dsh_home.is_dir():
                write_identity(web.dsh_home, args.device)

        async def refresh_identity() -> None:
            while True:
                await asyncio.sleep(3)
                try:
                    publish_dsh_identity()
                except Exception as exc:  # noqa: BLE001 - keep the identity heartbeat auxiliary
                    log(f"[node] local identity refresh failed: {exc}")

        refresher = asyncio.create_task(refresh_identity()) if identity_published else None
        try:
            await node.run()
        finally:
            try:
                node.apps.stop()
            except Exception:
                pass
            try:
                node.acp.close_all()
            except Exception:
                pass
            try:
                node.fs.sftpgo_grants.stop_owned()
            except Exception:
                pass
            if refresher is not None:
                refresher.cancel()
                await asyncio.gather(refresher, return_exceptions=True)
            if identity_published:
                remove_identity(node.native_dsh_home, args.device)
                web = node.fs.dsh_web
                if web is not None and web.dsh_home.is_dir():
                    remove_identity(web.dsh_home, args.device)

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
