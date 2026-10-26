#!/usr/bin/env python3
"""Start the desktop app: controller + local Agent node + an app-style window.

Ctrl+C stops both child processes (and their trees). Logs go to .runtime/logs/.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

LOGS = ROOT / ".runtime" / "logs"
PORT = int(os.environ.get("TETHER_PORT", "18890"))
HOST = os.environ.get("TETHER_HOST", "0.0.0.0")
DEVICE = os.environ.get("TETHER_DEVICE", "DESKTOP-LOCAL")
WORKSPACE = str(ROOT / "work-local")


def find_edge() -> str | None:
    candidates = [
        shutil.which("msedge"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def wait_controller(timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{PORT}/api/state"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        import psutil

        parent = psutil.Process(proc.pid)
        children = parent.children(recursive=True)
        for child in children:
            child.terminate()
        proc.terminate()
        gone, alive = psutil.wait_procs([parent, *children], timeout=3)
        for p in alive:
            p.kill()
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    LOGS.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)
    env["PYTHONIOENCODING"] = "utf-8"
    env["TETHER_HOST"] = HOST
    env["TETHER_PORT"] = str(PORT)
    env["TETHER_DEVICE"] = DEVICE

    controller_log = (LOGS / "controller.log").open("w", encoding="utf-8")
    node_log = (LOGS / "node.log").open("w", encoding="utf-8")

    print(f"[tether] starting controller on {HOST}:{PORT}")
    controller = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "tether.controller.app:app",
         "--host", HOST, "--port", str(PORT), "--log-level", "info"],
        cwd=str(ROOT), env=env, stdout=controller_log, stderr=subprocess.STDOUT,
    )
    if not wait_controller():
        kill_tree(controller)
        raise SystemExit(f"[tether] controller did not start; see {LOGS / 'controller.log'}")

    print(f"[tether] starting local Agent node {DEVICE}")
    node = subprocess.Popen(
        [sys.executable, "-m", "tether.node.agent",
         "--workspace", WORKSPACE, "--agent", "dsh", "--device", DEVICE,
         "--controller", f"ws://127.0.0.1:{PORT}/ws/node"],
        cwd=str(ROOT), env=env, stdout=node_log, stderr=subprocess.STDOUT,
    )

    ui = f"http://127.0.0.1:{PORT}"
    print(f"[tether] UI: {ui}")
    print(f"[tether] local console: http://127.0.0.1:18893")
    print(f"[tether] logs: {LOGS}")
    if not args.no_browser:
        edge = find_edge()
        if edge:
            subprocess.Popen([edge, f"--app={ui}", "--window-size=1500,950"])
        else:
            webbrowser.open(ui)

    print("[tether] Ctrl+C to stop")
    try:
        while True:
            time.sleep(0.5)
            if controller.poll() is not None or node.poll() is not None:
                print("[tether] a child exited; shutting down")
                break
    except KeyboardInterrupt:
        pass
    finally:
        print("[tether] stopping")
        kill_tree(node)
        kill_tree(controller)
        controller_log.close()
        node_log.close()


if __name__ == "__main__":
    main()