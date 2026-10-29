"""Restart the native DSH desktop host after a plugin update.

The Node cannot swap a plugin bundle inside a running DSH host, so the plugin
apply schedules this detached helper: it closes the desktop app, reopens the
same executable, and waits for the new host to rewrite the surface descriptor.
The Tether update status then sees a new host pid and clears restart_required.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import psutil

DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP


def _log(path: Path | None, message: str) -> None:
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(time.strftime("[%Y-%m-%d %H:%M:%S] ") + message + "\n")
    except OSError:
        pass


def _descriptor(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _host_pid(path: Path) -> int | None:
    data = _descriptor(path) or {}
    pid = data.get("pid")
    if type(pid) is not int or not 0 < pid <= 2_147_483_647:
        return None
    try:
        if not psutil.pid_exists(pid):
            return None
    except (OSError, ValueError):
        return None
    return pid


def _find_host() -> psutil.Process | None:
    for process in psutil.process_iter(["cmdline", "exe"]):
        try:
            cmdline = process.info.get("cmdline") or []
        except (psutil.Error, OSError):
            continue
        if any(isinstance(arg, str) and "dsh-desktop-host" in arg for arg in cmdline):
            return process
    return None


def _root_of(process: psutil.Process) -> psutil.Process:
    root = process
    seen = set()
    while True:
        try:
            parent = root.parent()
        except (psutil.Error, OSError):
            break
        if parent is None or parent.pid in seen:
            break
        try:
            same_exe = parent.exe() == root.exe()
        except (psutil.Error, OSError):
            same_exe = False
        if not same_exe:
            break
        seen.add(parent.pid)
        root = parent
    return root


def _stop_tree(root: psutil.Process) -> None:
    try:
        children = root.children(recursive=True)
    except (psutil.Error, OSError):
        children = []
    for process in children + [root]:
        try:
            process.kill()
        except (psutil.Error, OSError):
            pass
    try:
        psutil.wait_procs(children + [root], timeout=10)
    except (psutil.Error, OSError):
        pass


def _launch(exe: str) -> subprocess.Popen[Any]:
    kwargs: dict[str, Any] = {
        "cwd": str(Path(exe).parent),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = DETACHED
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen([exe], **kwargs)


def restart(descriptor: Path, log: Path | None, *, delay: float = 1.5, wait: float = 60.0) -> int:
    time.sleep(max(0.0, delay))
    before = _host_pid(descriptor)
    host = None
    if before is not None:
        try:
            host = psutil.Process(before)
        except (psutil.Error, OSError):
            host = None
    if host is None:
        host = _find_host()
    if host is None:
        _log(log, "no DSH host process found; leaving the plugin pending")
        return 1
    try:
        root = _root_of(host)
        exe = root.exe()
    except (psutil.Error, OSError):
        _log(log, "could not resolve the DSH executable")
        return 1
    if not exe.lower().endswith("deepseek harness.exe"):
        _log(log, f"refusing to restart unexpected executable: {exe}")
        return 1
    _log(log, f"stopping DSH (host={host.pid} root={root.pid})")
    _stop_tree(root)
    try:
        _launch(exe)
    except OSError as exc:
        _log(log, f"relaunch failed: {exc}")
        return 1
    deadline = time.time() + max(5.0, wait)
    while time.time() < deadline:
        time.sleep(1.0)
        current = _host_pid(descriptor)
        if current is not None and current != before:
            _log(log, f"DSH restarted (host={current})")
            return 0
    _log(log, "timed out waiting for the new DSH host descriptor")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Restart the native DSH desktop host")
    parser.add_argument("--descriptor", required=True)
    parser.add_argument("--log", default="")
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--wait", type=float, default=60.0)
    args = parser.parse_args(argv)
    return restart(Path(args.descriptor), Path(args.log) if args.log else None,
                   delay=args.delay, wait=args.wait)


if __name__ == "__main__":
    sys.exit(main())
