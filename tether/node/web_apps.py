"""Start a local OpenCode web instance and publish it through the app gateway."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from .acp import resolve_executable

NO_WINDOW = 0x08000000
BASE_PORT = 4096
PORT_SPAN = 100
NAME = "OpenCode"


class OpenCodeWeb:
    def __init__(self, data_dir: Path, workspace: Path) -> None:
        self.data_dir = Path(data_dir)
        self.workspace = Path(workspace)
        self.process: subprocess.Popen[bytes] | None = None
        self.external_pid = 0
        self.port = 0
        self.lock = threading.RLock()

    def _binary(self) -> str:
        return resolve_executable("opencode")

    def _argv(self, binary: str, port: int) -> list[str]:
        # `serve` is the headless flavor of `web`: same native UI, no browser launch.
        return [binary, "serve", "--hostname", "127.0.0.1", "--port", str(port)]

    def _state_path(self) -> Path:
        return self.data_dir / "opencode.json"

    def _read_state(self) -> tuple[int, int]:
        try:
            data = json.loads(self._state_path().read_text(encoding="utf-8"))
            return int(data.get("pid") or 0), int(data.get("port") or 0)
        except (OSError, ValueError, TypeError):
            return 0, 0

    def _write_state(self, pid: int, port: int) -> None:
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self._state_path().write_text(
                json.dumps({"pid": pid, "port": port}) + "\n", encoding="utf-8")
        except OSError:
            pass

    def _clear_state(self) -> None:
        try:
            self._state_path().unlink()
        except OSError:
            pass

    def _pid_matches(self, pid: int) -> bool:
        try:
            import psutil
        except Exception:
            return True
        try:
            return "opencode" in (psutil.Process(pid).name() or "").lower()
        except Exception:
            return False

    def _port_open(self, port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.4):
                return True
        except OSError:
            return False

    def _is_running(self) -> bool:
        if self.process is not None and self.process.poll() is None:
            return True
        return bool(self.external_pid) and self._pid_matches(self.external_pid) and self._port_open(self.port)

    def _adopt(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        pid, port = self._read_state()
        if pid and port and self._pid_matches(pid) and self._port_open(port):
            self.external_pid, self.port = pid, port
            if self._entry_port() != port:
                self._register(port)
            return
        self.external_pid = 0
        if pid or port:
            self._clear_state()

    def _free_port(self) -> int:
        for port in range(BASE_PORT, BASE_PORT + PORT_SPAN):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    probe.bind(("127.0.0.1", port))
                except OSError:
                    continue
                return port
        raise ValueError("no free port for OpenCode Web")

    def _wait_port(self, port: int, timeout: float = 25.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.process is not None and self.process.poll() is not None:
                return False
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.4):
                    return True
            except OSError:
                time.sleep(0.25)
        return False

    def _apps_path(self) -> Path:
        return self.data_dir / "apps.json"

    def _read_apps(self) -> dict[str, Any]:
        try:
            data = json.loads(self._apps_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        if not isinstance(data.get("apps"), list):
            data["apps"] = []
        return data

    def _write_apps(self, data: dict[str, Any]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        temp = self._apps_path().with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp, self._apps_path())

    def _register(self, port: int) -> None:
        data = self._read_apps()
        data["apps"] = [item for item in data["apps"]
                        if not (isinstance(item, dict) and str(item.get("name")) == NAME)]
        data["apps"].append({"name": NAME, "port": port, "path": "/"})
        self._write_apps(data)

    def _unregister(self) -> None:
        data = self._read_apps()
        remaining = [item for item in data["apps"]
                     if not (isinstance(item, dict) and str(item.get("name")) == NAME)]
        if len(remaining) != len(data["apps"]):
            data["apps"] = remaining
            self._write_apps(data)

    def status(self) -> dict[str, Any]:
        with self.lock:
            self._adopt()
            running = self._is_running()
            if not running:
                self.process = None
                self.external_pid = 0
                self.port = 0
                self._clear_state()
                if self._has_entry():
                    self._unregister()
        return {"engine": "opencode", "available": bool(self._binary()), "installed": bool(self._binary()),
                "running": running, "port": self.port if running else 0,
                "url": "http://127.0.0.1:%d/" % self.port if running else ""}

    def _has_entry(self) -> bool:
        return any(isinstance(item, dict) and str(item.get("name")) == NAME
                   for item in self._read_apps()["apps"])

    def _entry_port(self) -> int:
        for item in self._read_apps()["apps"]:
            if isinstance(item, dict) and str(item.get("name")) == NAME:
                try:
                    return int(item.get("port") or 0)
                except (TypeError, ValueError):
                    return 0
        return 0

    def start(self) -> dict[str, Any]:
        with self.lock:
            self._adopt()
            if self._is_running():
                return self.status()
            binary = self._binary()
            if not binary:
                raise ValueError("OpenCode is not installed on this node")
            port = self._free_port()
            argv = self._argv(binary, port)
            if os.name == "nt" and binary.lower().endswith((".cmd", ".bat")):
                argv = ["cmd.exe", "/d", "/s", "/c", subprocess.list2cmdline(argv)]
            kwargs: dict[str, Any] = {
                "cwd": str(self.workspace), "stdin": subprocess.DEVNULL,
                "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                "env": {**os.environ, "BROWSER": "none"}, "text": True,
            }
            if os.name == "nt":
                kwargs["creationflags"] = NO_WINDOW
            process = subprocess.Popen(argv, **kwargs)
            self.process, self.port = process, port
            if not self._wait_port(port):
                try:
                    process.terminate()
                except OSError:
                    pass
                self.process, self.port = None, 0
                raise ValueError("OpenCode Web did not start")
            self._register(port)
            self._write_state(process.pid, port)
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self.lock:
            self._adopt()
            if self.process is not None:
                try:
                    self.process.terminate()
                    self.process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    try:
                        self.process.kill()
                    except OSError:
                        pass
            elif self.external_pid:
                try:
                    import psutil
                    proc = psutil.Process(self.external_pid)
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    pass
            self.process, self.external_pid, self.port = None, 0, 0
            self._clear_state()
            self._unregister()
            return self.status()