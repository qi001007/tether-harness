"""Tether MCP server: the tool layer an Agent uses to delegate to peer machines.

The Agent (DeepSeek Harness desktop, Qoder, Codex, ...) stays the interaction
surface and keeps its own memory/plugins. This server only exposes:
  - list_peers
  - remote_task
  - remote_status
  - remote_cancel

It talks to the local Tether Controller over HTTP; the Controller routes the run
to the target Node. The server never executes shell commands itself.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid

from mcp.server.mcpserver import MCPServer

BASE = os.environ.get("TETHER_CONTROLLER_HTTP", "http://127.0.0.1:18890").rstrip("/")
TERMINAL = {"completed", "failed", "cancelled", "unknown"}

server = MCPServer(
    "tether",
    instructions=(
        "Tether lets this Agent delegate work to other paired machines. "
        "Call list_peers first to see device ids and online state. "
        "Then call remote_task(device, prompt) to run a task on that machine; "
        "the remote Agent uses its own workspace, shell, and model key. "
        "Use remote_status for a run that is still in progress, and remote_cancel "
        "to stop it. Never guess a device id; use the ids from list_peers."
    ),
)


def _request(path: str, body: dict | None = None, method: str = "GET") -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"controller unreachable at {BASE}: {exc}") from exc


def _device(device: str) -> dict:
    state = _request("/api/state")
    for item in state.get("devices", []):
        if device in (item.get("device_id"), item.get("name")):
            return item
    raise RuntimeError(f"unknown device {device!r}; use list_peers first")


def _session_for(device_id: str, workspace: str) -> dict:
    state = _request("/api/state")
    for item in state.get("sessions", []):
        if item.get("device_id") == device_id:
            return item
    return _request("/api/sessions", {"device_id": device_id, "workspace": workspace}, "POST")


@server.tool()
def list_peers() -> str:
    """List paired Tether machines with their online state, workspace, and agents."""
    state = _request("/api/state")
    peers = [
        {
            "device_id": d.get("device_id"),
            "name": d.get("name"),
            "online": d.get("online"),
            "platform": d.get("platform"),
            "workspace": (d.get("capabilities") or {}).get("workspace"),
            "agents": (d.get("capabilities") or {}).get("agents"),
        }
        for d in state.get("devices", [])
    ]
    return json.dumps(peers, ensure_ascii=False, indent=2)


@server.tool()
def remote_task(device: str, prompt: str, wait_seconds: int = 120) -> str:
    """Run a task on a paired machine and return its final state/answer.

    device: id from list_peers. prompt: the task. If it exceeds wait_seconds,
    the result contains a run_id; call remote_status(run_id) later.
    """
    target = _device(device)
    workspace = (target.get("capabilities") or {}).get("workspace") or "."
    session = _session_for(str(target["device_id"]), workspace)
    run = _request(
        f"/api/sessions/{session['session_id']}/runs",
        {"prompt": prompt, "request_id": f"mcp-{uuid.uuid4().hex[:12]}"},
        "POST",
    )
    run_id = run["run_id"]
    deadline = time.time() + max(1, min(int(wait_seconds), 600))
    current = run
    while time.time() < deadline:
        current = _request(f"/api/runs/{run_id}")
        if current.get("state") in TERMINAL:
            break
        time.sleep(0.5)
    return json.dumps(
        {
            "run_id": run_id,
            "device_id": target["device_id"],
            "state": current.get("state"),
            "finish_reason": current.get("finish_reason"),
            "final_response": current.get("final_response"),
            "outcome": current.get("outcome"),
            "note": None if current.get("state") in TERMINAL else "still running; use remote_status",
        },
        ensure_ascii=False,
        indent=2,
    )


@server.tool()
def remote_status(run_id: str, max_events: int = 20) -> str:
    """Get a run's state and the most recent events."""
    run = _request(f"/api/runs/{run_id}")
    events = _request(f"/api/runs/{run_id}/events?after_seq=0").get("events", [])
    tail = events[-max(1, min(int(max_events), 100)):]
    return json.dumps({"run": run, "events": tail}, ensure_ascii=False, indent=2)


@server.tool()
def remote_cancel(run_id: str) -> str:
    """Cancel a run on its target machine."""
    return json.dumps(_request(f"/api/runs/{run_id}/cancel", {}, "POST"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    server.run(transport="stdio")