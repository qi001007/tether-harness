"""Tether controller: device registry, sessions, runs, events, SSE.

Gate 1 keeps auth at "loopback + shared node token". Pairing and browser auth
are deliberately deferred; do not expose this port to an untrusted network.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .store import Conflict, NotFound, Store

ROOT = Path(__file__).resolve().parents[2]
STATIC = Path(__file__).resolve().parents[1] / "static"
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass
DB_PATH = Path(os.environ.get("TETHER_DB", ROOT / ".runtime" / "controller.db"))
NODE_TOKEN = os.environ.get("TETHER_NODE_TOKEN", "dev-token")
STORE = Store(DB_PATH)


class Hub:
    def __init__(self) -> None:
        self.nodes: dict[str, WebSocket] = {}
        self.subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self.pending: dict[str, tuple[str, asyncio.Future[dict[str, Any]]]] = {}

    def broadcast(self, message: dict[str, Any]) -> None:
        dead: list[asyncio.Queue] = []
        for queue in self.subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                dead.append(queue)
        for queue in dead:
            self.subscribers.discard(queue)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        self.subscribers.add(queue)
        return queue

    async def request(self, device_id: str, payload: dict[str, Any],
                      timeout: float = 20.0) -> dict[str, Any]:
        ws = self.nodes.get(device_id)
        if ws is None:
            raise NodeOffline(device_id)
        req_id = uuid.uuid4().hex
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.pending[req_id] = (device_id, future)
        try:
            await ws.send_json({**payload, "req_id": req_id})
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise NodeTimeout(device_id) from exc
        finally:
            self.pending.pop(req_id, None)

    def resolve(self, req_id: str, result: dict[str, Any]) -> None:
        entry = self.pending.get(req_id)
        if entry is not None and not entry[1].done():
            entry[1].set_result(result)

    def fail_device(self, device_id: str, error: Exception) -> None:
        for req_id, (dev, future) in list(self.pending.items()):
            if dev == device_id and not future.done():
                future.set_exception(error)


class NodeOffline(Exception):
    pass


class NodeTimeout(Exception):
    pass


HUB = Hub()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    STORE.close()


app = FastAPI(title="Tether Controller", lifespan=lifespan)
# Only the DeepSeek Harness client page may call the loopback API from another origin.
# Keeping this narrow prevents a random website in the user's browser from using
# 127.0.0.1:18890 to read or write files through an online node.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["dsh-app://app"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    max_age=600,
)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.middleware("http")
async def loopback_only(request: Request, call_next):
    """Keep the human UI/API on this machine; remote nodes use /ws/node + token."""
    client = request.client.host if request.client else ""
    if client not in ("127.0.0.1", "::1", "localhost"):
        return JSONResponse({"error": "controller UI/API is loopback-only"}, status_code=403)
    return await call_next(request)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/state")
async def state() -> dict[str, Any]:
    return {"devices": STORE.list_devices(), "sessions": STORE.list_sessions(), "runs": STORE.list_runs(),
            "local_device": os.environ.get("TETHER_DEVICE", "DESKTOP-LOCAL")}


@app.post("/api/sessions")
async def create_session(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return STORE.create_session(str(body["device_id"]), str(body["workspace"]))
    except (KeyError, NotFound) as exc:
        raise HTTPException(400, f"bad session: {exc}") from exc


@app.post("/api/sessions/{session_id}/runs")
async def create_run(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        run, cached = STORE.create_run(session_id, str(body["request_id"]), str(body["prompt"]))
    except KeyError as exc:
        raise HTTPException(400, f"missing field: {exc}") from exc
    except (Conflict, NotFound) as exc:
        raise HTTPException(409 if isinstance(exc, Conflict) else 404, str(exc)) from exc
    if not cached:
        await _dispatch(run)
    return {**STORE.get_run(run["run_id"]), "cached": cached}


@app.get("/api/sessions/{session_id}/transcript")
async def transcript(session_id: str) -> dict[str, Any]:
    try:
        session = STORE.get_session(session_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    runs = STORE.runs_for_session(session_id)
    return {"session": session,
            "runs": [{"run": run, "events": STORE.get_events(run["run_id"])} for run in runs]}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    try:
        return STORE.get_run(run_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/runs/{run_id}/events")
async def get_events(run_id: str, after_seq: int = 0) -> dict[str, Any]:
    try:
        STORE.get_run(run_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"run_id": run_id, "events": STORE.get_events(run_id, after_seq)}


@app.post("/api/runs/{run_id}/cancel")
async def cancel(run_id: str) -> dict[str, Any]:
    try:
        run = STORE.get_run(run_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    if run["state"] in ("completed", "cancelled", "failed", "unknown"):
        raise HTTPException(409, f"run already terminal ({run['state']})")
    run = STORE.set_run_state(run_id, "cancelling")
    ws = HUB.nodes.get(run["device_id"])
    if ws is not None:
        await ws.send_json({"type": "cancel", "run_id": run_id})
    else:
        run = STORE.set_run_state(run_id, "unknown", outcome={"reason": "cancel requested while node offline"})
    HUB.broadcast({"kind": "run", "run": run})
    return run


@app.post("/api/runs/{run_id}/reconcile")
async def reconcile(run_id: str) -> dict[str, Any]:
    run = STORE.get_run(run_id)
    ws = HUB.nodes.get(run["device_id"])
    if ws is None:
        raise HTTPException(409, "node offline; cannot reconcile")
    await ws.send_json({"type": "reconcile", "run_id": run_id})
    return {"run_id": run_id, "status": "requested"}


def _capabilities(device_id: str) -> dict[str, Any]:
    try:
        return STORE.get_device(device_id).get("capabilities") or {}
    except NotFound:
        return {}


async def _device_fs(device_id: str, op: str, args: dict[str, Any] | None = None) -> Any:
    if not _capabilities(device_id).get("fs"):
        raise HTTPException(409, {"error": "node update required for files and projects",
                                 "code": "node_update_required"})
    try:
        reply = await HUB.request(device_id, {"type": "fs_call", "op": op, "args": args or {}})
    except NodeOffline as exc:
        raise HTTPException(409, f"device offline: {device_id}") from exc
    except NodeTimeout as exc:
        raise HTTPException(504, "device did not answer the file request") from exc
    if not reply.get("ok"):
        raise HTTPException(400, {"error": reply.get("error"), "code": reply.get("code")})
    return reply.get("result")


@app.post("/api/devices/{device_id}/fs/{op}")
async def device_fs(device_id: str, op: str, body: dict[str, Any] | None = None) -> Any:
    return await _device_fs(device_id, op, body)


@app.get("/api/devices/{device_id}/workspaces")
async def device_workspaces(device_id: str) -> Any:
    return await _device_fs(device_id, "workspaces")


@app.get("/api/devices/{device_id}/drives")
async def device_drives(device_id: str) -> Any:
    return await _device_fs(device_id, "drives")


@app.get("/api/devices/{device_id}/policy")
async def device_policy(device_id: str) -> Any:
    return await _device_fs(device_id, "policy_get")


@app.post("/api/devices/{device_id}/policy")
async def set_device_policy(device_id: str, body: dict[str, Any]) -> Any:
    return await _device_fs(device_id, "policy_set", body)


@app.get("/api/devices/{device_id}/audit")
async def device_audit(device_id: str, limit: int = 100) -> Any:
    return await _device_fs(device_id, "audit_list", {"limit": limit})


async def _device_dsh(device_id: str, op: str, args: dict[str, Any] | None = None) -> Any:
    if not _capabilities(device_id).get("dsh_native"):
        raise HTTPException(409, {"error": "node update required for native DSH sessions",
                                 "code": "node_update_required"})
    try:
        reply = await HUB.request(device_id, {"type": "dsh_call", "op": op, "args": args or {}})
    except NodeOffline as exc:
        raise HTTPException(409, f"device offline: {device_id}") from exc
    except NodeTimeout as exc:
        raise HTTPException(504, "device did not answer the DSH request") from exc
    if not reply.get("ok"):
        raise HTTPException(404 if reply.get("code") == "not_found" else 400,
                            {"error": reply.get("error"), "code": reply.get("code")})
    return reply.get("result")


@app.get("/api/devices/{device_id}/dsh/sessions")
async def device_dsh_sessions(device_id: str) -> Any:
    return await _device_dsh(device_id, "sessions")


@app.get("/api/devices/{device_id}/dsh/sessions/{session_id}")
async def device_dsh_transcript(device_id: str, session_id: str) -> Any:
    return await _device_dsh(device_id, "transcript", {"session_id": session_id})


@app.post("/api/devices/{device_id}/dsh/workspaces/register")
async def device_dsh_register_workspace(device_id: str, body: dict[str, Any]) -> Any:
    return await _device_dsh(device_id, "workspace_register", body)


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    async def stream():
        queue = HUB.subscribe()
        try:
            yield "data: " + json.dumps({"kind": "hello"}) + "\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15)
                    yield "data: " + json.dumps(message, ensure_ascii=False) + "\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            HUB.subscribers.discard(queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.websocket("/ws/node")
async def node_socket(ws: WebSocket) -> None:
    await ws.accept()
    device_id: str | None = None
    try:
        first = json.loads(await ws.receive_text())
        if first.get("type") != "register":
            await ws.close(code=4400, reason="register required")
            return
        device_id = str(first["device_id"])
        if first.get("token") != NODE_TOKEN:
            await ws.close(code=4401, reason="bad token")
            return
        device = STORE.register_device(device_id, str(first.get("name") or device_id),
                                       str(first.get("platform") or "unknown"),
                                       first.get("capabilities") or {}, NODE_TOKEN)
        HUB.nodes[device_id] = ws
        await ws.send_json({"type": "registered", "device": device})
        HUB.broadcast({"kind": "device", "device": device})
        await _dispatch_queued(device_id)
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            await _handle_node(device_id, msg)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - report and close, never crash the app
        try:
            await ws.send_json({"type": "error", "error": str(exc)})
        except Exception:
            pass
    finally:
        if device_id is not None:
            HUB.nodes.pop(device_id, None)
            HUB.fail_device(device_id, NodeOffline(device_id))
            STORE.set_online(device_id, False)
            changed = STORE.mark_device_unknown(device_id)
            HUB.broadcast({"kind": "device", "device": STORE.get_device(device_id)})
            for run_id in changed:
                HUB.broadcast({"kind": "run", "run": STORE.get_run(run_id)})


async def _handle_node(device_id: str, msg: dict[str, Any]) -> None:
    kind = msg.get("type")
    if kind == "heartbeat":
        STORE.heartbeat(device_id)
        return
    if kind == "event":
        run_id = str(msg["run_id"])
        seq = int(msg["seq"])
        ack = STORE.add_event(run_id, seq, str(msg.get("kind") or "event"),
                              msg.get("payload") or {}, float(msg.get("ts") or 0) or None)
        ws = HUB.nodes.get(device_id)
        if ws is not None:
            await ws.send_json({"type": "event_ack", "run_id": run_id, "ack_seq": ack})
        event = {"run_id": run_id, "seq": seq, "kind": msg.get("kind") or "event",
                 "ts": msg.get("ts"), "payload": msg.get("payload") or {}}
        HUB.broadcast({"kind": "event", "event": event})
        return
    if kind == "run_state":
        run_id = str(msg["run_id"])
        run = STORE.set_run_state(run_id, str(msg["state"]),
                                  finish_reason=msg.get("finish_reason"),
                                  final_response=msg.get("final_response"),
                                  outcome=msg.get("outcome"))
        HUB.broadcast({"kind": "run", "run": run})
        return
    if kind == "dispatch_ack":
        return
    if kind == "fs_result" or kind == "dsh_result":
        HUB.resolve(str(msg.get("req_id") or ""), msg)
        return
    if kind == "reconcile_result":
        run_id = str(msg["run_id"])
        state = str(msg.get("state") or "unknown")
        run = STORE.set_run_state(run_id, state, finish_reason=msg.get("finish_reason"),
                                  final_response=msg.get("final_response"),
                                  outcome=msg.get("outcome") or {"source": "reconcile"})
        HUB.broadcast({"kind": "run", "run": run})


async def _dispatch(run: dict[str, Any]) -> bool:
    ws = HUB.nodes.get(run["device_id"])
    if ws is None:
        return False
    session = STORE.get_session(run["session_id"])
    await ws.send_json({
        "type": "dispatch",
        "run_id": run["run_id"],
        "session_id": run["session_id"],
        "request_id": run["request_id"],
        "prompt": run["prompt"],
        "workspace": session["workspace"],
    })
    STORE.set_run_state(run["run_id"], "dispatching")
    HUB.broadcast({"kind": "run", "run": STORE.get_run(run["run_id"])})
    return True


async def _dispatch_queued(device_id: str) -> None:
    for run in STORE.list_runs(200):
        if run["device_id"] == device_id and run["state"] == "queued":
            await _dispatch(run)


@app.exception_handler(NotFound)
async def not_found(_request: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=404)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("TETHER_HOST", "127.0.0.1"),
                port=int(os.environ.get("TETHER_PORT", "18890")))