#!/usr/bin/env python3
"""Start a real long-running dsh task, cancel it, and measure process-tree residue."""

from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:18890"
OUT = ROOT / "evidence" / "cancel_probe.json"
PROMPT = (
    "Call the pwsh tool with exactly this command and wait for it to finish: "
    'python -c "import time; time.sleep(120)". Do not do anything else.'
)


def get(path: str):
    return json.load(urllib.request.urlopen(BASE + path, timeout=10))


def post(path: str, body: dict | None = None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.load(urllib.request.urlopen(req, timeout=10))


def node_pid() -> int:
    candidates = []
    for proc in psutil.process_iter(["pid", "cmdline", "create_time"]):
        try:
            cmd = " ".join(proc.info["cmdline"] or [])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if "tether.node.agent" in cmd and "--agent dsh" in cmd:
            candidates.append((proc.info["create_time"], proc.info["pid"]))
    if not candidates:
        raise SystemExit("dsh node process not found")
    return max(candidates)[1]


def tree(pid: int) -> list[dict]:
    try:
        root = psutil.Process(pid)
        procs = [root] + root.children(recursive=True)
    except psutil.NoSuchProcess:
        return []
    rows = []
    for proc in procs:
        try:
            rows.append({"pid": proc.pid, "name": proc.name(),
                         "cmdline": " ".join(proc.cmdline())[:300]})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return rows


def main() -> None:
    for _ in range(40):
        state = get("/api/state")
        device = next(d for d in state["devices"] if d["device_id"] == "DESKTOP-LOCAL")
        if device["online"]:
            break
        time.sleep(0.25)
    session = post("/api/sessions", {"device_id": "DESKTOP-LOCAL", "workspace": "work-local"})
    run = post(f"/api/sessions/{session['session_id']}/runs",
               {"prompt": PROMPT, "request_id": f"cancel-{int(time.time())}"})
    run_id = run["run_id"]
    pid = node_pid()
    started = time.time()
    saw_tool = False
    for _ in range(120):
        events = get(f"/api/runs/{run_id}/events?after_seq=0")["events"]
        if any(e["kind"] == "tool" and "python" in str(e["payload"]) for e in events):
            saw_tool = True
            break
        if run_id and get(f"/api/runs/{run_id}")["state"] in ("completed", "failed", "unknown"):
            break
        time.sleep(0.5)
    deadline = time.time() + 25
    before = tree(pid)
    while time.time() < deadline:
        before = tree(pid)
        if any(p["pid"] != pid and p["name"].lower() in ("pwsh.exe", "python.exe") for p in before):
            break
        time.sleep(0.5)
    cancel = post(f"/api/runs/{run_id}/cancel")
    for _ in range(60):
        state = get(f"/api/runs/{run_id}")
        if state["state"] in ("cancelled", "failed", "completed", "unknown"):
            break
        time.sleep(0.25)
    time.sleep(2.0)
    after = tree(pid)
    residual = [p for p in after if p["pid"] != pid and p["name"].lower() in ("python.exe", "pwsh.exe", "node.exe")]
    result = {
        "run_id": run_id,
        "session_id": session["session_id"],
        "saw_tool_event": saw_tool,
        "cancel_response_state": cancel.get("state"),
        "terminal_state": state.get("state"),
        "terminal_outcome": state.get("outcome"),
        "elapsed_s": round(time.time() - started, 2),
        "tree_before": before,
        "tree_after": after,
        "residual": residual,
        "residual_count": len(residual),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()