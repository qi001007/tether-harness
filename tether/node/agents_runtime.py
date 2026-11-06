"""Run the pruned Agents runtime on this node and publish it through the app gateway."""

from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

NO_WINDOW = 0x08000000
BASE_PORT = 4200
PORT_SPAN = 100
NAME = "Agents"


def _runtime_dir() -> Path:
    override = os.environ.get("TETHER_AGENTS_RUNTIME_DIR")
    if override:
        return Path(override).resolve()
    return (Path(__file__).with_name("bin") / "agents-runtime").resolve()


class AgentsRuntime:
    def __init__(self, data_dir: Path, workspace: Path) -> None:
        self.data_dir = (Path(data_dir) / "agents-runtime").resolve()
        self.workspace = Path(workspace).resolve()
        self.root = _runtime_dir()
        self.process: subprocess.Popen[bytes] | None = None
        self.external_pid = 0
        self.port = 0
        self.token = ""
        self.lock = threading.RLock()
        try:
            self._ensure_entry()
        except OSError:
            pass

    def _binary(self) -> str:
        name = "codeg-server.exe" if os.name == "nt" else "codeg-server"
        path = self.root / name
        return str(path) if path.is_file() else ""

    def _web_dir(self) -> str:
        path = self.root / "web"
        return str(path) if (path / "index.html").is_file() else ""

    def _state_path(self) -> Path:
        return self.data_dir / "runtime.json"

    def _log_path(self) -> Path:
        return self.data_dir / "server.log"

    def _read_state(self) -> dict[str, Any]:
        try:
            return json.loads(self._state_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _write_state(self) -> None:
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self._state_path().write_text(
                json.dumps({"pid": self.process.pid if self.process else self.external_pid,
                            "port": self.port, "token": self.token}) + "\n",
                encoding="utf-8")
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
            return "codeg-server" in (psutil.Process(pid).name() or "").lower()
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
        state = self._read_state()
        pid = int(state.get("pid") or 0)
        port = int(state.get("port") or 0)
        token = str(state.get("token") or "")
        if pid and port and token and self._pid_matches(pid) and self._port_open(port):
            self.external_pid, self.port, self.token = pid, port, token
            self._ensure_entry()
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
        raise ValueError("no free port for the Agents runtime")

    def _wait_port(self, port: int, timeout: float = 30.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.process is not None and self.process.poll() is not None:
                return False
            if self._port_open(port):
                return True
            time.sleep(0.25)
        return False

    def _apps_path(self) -> Path:
        return self.data_dir.parent / "apps.json"

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
        self._apps_path().parent.mkdir(parents=True, exist_ok=True)
        temp = self._apps_path().with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp, self._apps_path())

    def _ensure_entry(self) -> None:
        data = self._read_apps()
        for item in data["apps"]:
            if isinstance(item, dict) and str(item.get("name")) == NAME:
                try:
                    port = int(item.get("port") or 0)
                except (TypeError, ValueError):
                    port = 0
                if port != BASE_PORT:
                    item["port"] = BASE_PORT
                    item["path"] = "/"
                    self._write_apps(data)
                return
        data["apps"].append({"name": NAME, "port": BASE_PORT, "path": "/"})
        self._write_apps(data)

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

    def status(self) -> dict[str, Any]:
        with self.lock:
            self._adopt()
            running = self._is_running()
            if not running:
                self.process = None
                self.external_pid = 0
                self.port = 0
                self.token = ""
                self._clear_state()
            return {"engine": "agents", "available": bool(self._binary()) and bool(self._web_dir()),
                    "installed": bool(self._binary()) and bool(self._web_dir()),
                    "running": running, "port": self.port if running else 0,
                    "token": self.token if running else "",
                    "url": "http://127.0.0.1:%d/" % self.port if running else ""}

    def _seed_workspace(self, agent: str = "codex") -> None:
        import urllib.request
        try:
            body = json.dumps({"path": str(self.workspace)}).encode()
            request = urllib.request.Request(
                "http://127.0.0.1:%d/api/open_folder" % self.port, data=body,
                headers={"Authorization": "Bearer " + self.token,
                         "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=10) as response:
                folder = json.loads(response.read().decode("utf-8"))
            folder_id = int(folder.get("id") or 0)
            if folder_id:
                body = json.dumps({"folderId": folder_id, "defaultAgentType": agent or "codex"}).encode()
                request = urllib.request.Request(
                    "http://127.0.0.1:%d/api/update_folder_default_agent" % self.port, data=body,
                    headers={"Authorization": "Bearer " + self.token,
                             "Content-Type": "application/json"}, method="POST")
                try:
                    urllib.request.urlopen(request, timeout=10).read()
                except Exception:
                    pass
        except Exception:
            pass

    def surface_url(self, base: str) -> str:
        if not self.port or not self.token:
            return ""
        root = str(base or "").rstrip("/")
        if not root:
            return ""
        return root + "/token.html?token=" + quote(self.token, safe="")

    def start(self, agent: str = "") -> dict[str, Any]:
        with self.lock:
            self._adopt()
            if self._is_running():
                if agent:
                    self._seed_workspace(agent)
                return self.status()
            binary = self._binary()
            static = self._web_dir()
            if not binary or not static:
                raise ValueError("Agents runtime is not installed on this node")
            if self._port_open(BASE_PORT):
                raise ValueError("Agents runtime port is already in use")
            port = BASE_PORT
            token = secrets.token_urlsafe(32)
            self.data_dir.mkdir(parents=True, exist_ok=True)
            extra_paths: list[str] = []
            try:
                from .agent_registry import agent_home
                home = agent_home()
                extra_paths = [str(candidate) for candidate in
                               (home, home / "bin", home / "node_modules" / ".bin")
                               if candidate.is_dir()]
            except Exception:
                extra_paths = []
            env = {
                **os.environ,
                "CODEG_HOST": "127.0.0.1",
                "CODEG_PORT": str(port),
                "CODEG_TOKEN": token,
                "CODEG_DATA_DIR": str(self.data_dir),
                "CODEG_STATIC_DIR": static,
                "CODEG_BRIDGE_PORTS": "4311-4320",
                "NO_COLOR": "1",
            }
            if extra_paths:
                env["PATH"] = os.pathsep.join(extra_paths + [str(env.get("PATH") or "")])
            kwargs: dict[str, Any] = {
                "cwd": str(self.workspace), "stdin": subprocess.DEVNULL,
                "stdout": open(self._log_path(), "ab"), "stderr": subprocess.STDOUT,
                "env": env,
            }
            if os.name == "nt":
                kwargs["creationflags"] = NO_WINDOW
            process = subprocess.Popen([binary], **kwargs)
            self.process, self.port, self.token = process, port, token
            if not self._wait_port(port):
                try:
                    process.terminate()
                except OSError:
                    pass
                self.process, self.port, self.token = None, 0, ""
                raise ValueError("Agents runtime did not start")
            self._ensure_entry()
            self._write_state()
            self._seed_workspace(agent or "codex")
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
            self.process, self.external_pid, self.port, self.token = None, 0, 0, ""
            self._clear_state()
            return self.status()