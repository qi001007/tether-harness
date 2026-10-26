#!/usr/bin/env python3
"""Gate 0 probe for deepseek-harness-sdk.

Modes:
  init       start runtime + create lazy session (no model call)
  prompt     run one prompt and print every notification/event
  resume     resume the session from `prompt` and continue
  approval   run a write prompt with the approval channel enabled
  cancel     run a prompt in a worker thread, close the runtime mid-run,
             then resume the session and continue

Requires DEEPSEEK_API_KEY (or DEEPSEEK_BASE_URL + key) for modes that call
the model. Everything is isolated under the project .runtime directory.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[1]
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass
HOME = ROOT / ".runtime" / "dsh-home"
WORK = ROOT / "work-local"
SESSION = "gate0-session"
NPM_DSH = ROOT / ".runtime" / "npm" / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"


def launch_args() -> tuple[str, ...] | None:
    import shutil

    if NPM_DSH.is_file() and shutil.which("node"):
        return (shutil.which("node") or "node", str(NPM_DSH), "--profile", "sdk")
    return None


def harness(*, approvals: bool = False) -> DeepSeekHarness:
    HOME.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    return DeepSeekHarness(
        dsh_home=str(HOME),
        cwd=str(WORK),
        provider=os.environ.get("DSH_PROVIDER", "deepseek-official"),
        model=os.environ.get("DSH_MODEL", "deepseek-v4-flash"),
        max_tokens=8192,
        initialize_timeout_seconds=60.0,
        env={"DSH_HOME": str(HOME)},
        _launch_args=launch_args(),
    )


def require_key() -> None:
    if not os.environ.get("DEEPSEEK_API_KEY"):
        print("MISSING DEEPSEEK_API_KEY: set it in the environment or tether/.env", file=sys.stderr)
        raise SystemExit(2)


def on_note(note) -> None:
    payload = note.payload or {}
    kind = ""
    event = payload.get("event")
    if isinstance(event, dict):
        kind = str(event.get("type") or "")
    print(f"[note] {note.method} {kind} {json.dumps(payload, ensure_ascii=False)[:400]}")


def approval_worker(h, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            req = h.client.next_request()
        except Exception as exc:  # transport closed
            print(f"[approval] channel closed: {exc}")
            return
        print(f"[approval] {req.method} {json.dumps(req.payload, ensure_ascii=False)[:500]}")
        try:
            if req.method == "approval/request":
                h.client.respond(req.id, {"outcome": "allowed-once"})
            elif req.method == "user-question/ask":
                h.client.respond(req.id, {"answers": []})
            else:
                h.client.respond_error(req.id, -32601, "unsupported in probe")
        except Exception as exc:
            print(f"[approval] respond failed: {exc}")


def run_prompt(h, text: str) -> None:
    started = time.time()
    result = h.run(text, session_id=SESSION, on_notification=on_note)
    print(json.dumps({
        "session_id": result.session_id,
        "finish_reason": result.finish_reason,
        "final_response": result.final_response,
        "events": len(result.events),
        "notifications": len(result.notifications),
        "duration_s": round(time.time() - started, 2),
    }, ensure_ascii=False, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["init", "prompt", "resume", "approval", "cancel"])
    ap.add_argument("--text", default="Create a file named gate0.txt containing exactly: OK")
    ap.add_argument("--grace", type=float, default=5.0)
    args = ap.parse_args()

    if args.mode == "init":
        h = harness()
        h.start()
        s = h.start_session(SESSION)
        print(json.dumps({"server": "started", "session": s.id, "home": str(HOME), "cwd": str(WORK)}))
        h.close()
        return

    require_key()

    if args.mode == "prompt":
        with harness() as h:
            run_prompt(h, args.text)
        return

    if args.mode == "resume":
        with harness() as h:
            s = h.resume_session(SESSION)
            result = s.run("Continue: report the previous result and your current cwd.",
                           on_notification=on_note)
            print(json.dumps({"resumed": s.id, "final": result.final_response,
                              "events": len(result.events)}, ensure_ascii=False, indent=2))
        return

    if args.mode == "approval":
        stop = threading.Event()
        h = harness(approvals=True)
        h.start()
        t = threading.Thread(target=approval_worker, args=(h, stop), daemon=True)
        t.start()
        try:
            run_prompt(h, args.text)
        finally:
            stop.set()
            h.close()
        return

    if args.mode == "cancel":
        h = harness()
        h.start()
        err: list[str] = []

        def work() -> None:
            try:
                run_prompt(h, "Run this exact shell command and wait for it: "
                              "python -c \"import time; time.sleep(120)\"")
            except Exception as exc:
                err.append(f"{type(exc).__name__}: {exc}")

        t = threading.Thread(target=work, daemon=True)
        t.start()
        time.sleep(args.grace)
        print(f"[cancel] closing runtime after {args.grace}s")
        closed_at = time.time()
        h.close()
        t.join(timeout=30)
        print(json.dumps({"worker_error": err, "close_s": round(time.time() - closed_at, 2),
                          "worker_alive": t.is_alive()}, ensure_ascii=False))
        h2 = harness()
        try:
            s = h2.resume_session(SESSION)
            r = s.run("Resume after interruption: state the current cwd and say RESUMED.",
                      on_notification=on_note)
            print(json.dumps({"resumed": s.id, "final": r.final_response,
                              "events": len(r.events)}, ensure_ascii=False, indent=2))
        finally:
            h2.close()
        return


if __name__ == "__main__":
    main()