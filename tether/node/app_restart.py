"""Windowless APP restart helper for remote APP updates."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


def _log(log_path: Path, message: str) -> None:
    try:
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}\n")
    except OSError:
        pass


def electron_executable(root: Path) -> Path:
    return root / "apps" / "tether-app" / "node_modules" / "electron" / "dist" / "electron.exe"


def matching_processes(electron: Path) -> list:
    import psutil

    found = []
    try:
        candidates = list(psutil.process_iter(["pid", "exe"]))
    except (psutil.Error, OSError):
        return found
    for proc in candidates:
        try:
            executable = proc.info.get("exe")
            if executable and Path(executable).resolve() == electron:
                found.append(proc)
        except (psutil.Error, OSError):
            continue
    return found


def stop_app(electron: Path, log_path: Path) -> None:
    import psutil

    for proc in matching_processes(electron):
        try:
            proc.terminate()
        except (psutil.Error, OSError):
            continue
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and matching_processes(electron):
        time.sleep(0.25)
    for proc in matching_processes(electron):
        try:
            proc.kill()
        except (psutil.Error, OSError):
            continue


def launch_app(electron: Path, root: Path, log_path: Path) -> None:
    app_dir = root / "apps" / "tether-app"
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    subprocess.Popen(
        [str(electron), str(app_dir)],
        cwd=str(app_dir), env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Restart the Tether APP after an update")
    parser.add_argument("--root", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args(argv)
    if sys.platform != "win32":
        return 0
    root = Path(args.root).resolve()
    log_path = Path(args.log)
    electron = electron_executable(root)
    _log(log_path, "restart helper started")
    if not electron.is_file():
        _log(log_path, "APP executable missing")
        return 1
    if args.delay > 0:
        time.sleep(args.delay)
    try:
        stop_app(electron, log_path)
        launch_app(electron, root, log_path)
        _log(log_path, "APP launched directly")
        return 0
    except OSError as exc:
        _log(log_path, f"APP restart failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
