"""Run the pruned Agents runtime on this node and publish it through the app gateway."""

from __future__ import annotations

import json
import hashlib
import os
import platform
import secrets
import shutil
import socket
import subprocess
import tarfile
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

NO_WINDOW = 0x08000000
BASE_PORT = 4200
PORT_SPAN = 100
NAME = "Agents"
LINUX_SERVER_URL = "https://github.com/xintaofei/codeg/releases/download/v0.42.0/codeg-server-linux-x64.tar.gz"
LINUX_SERVER_SHA256 = "35928d4b93b5fc65bfc4d330f4d653c738af0b033307cf9d59173539d49bf679"
LINUX_SERVER_ARCHIVE_SIZE = 77466977
LINUX_RUNTIME_MEMBERS = {
    "codeg-server-linux-x64/codeg-server": ("codeg-server", 95337352),
    "codeg-server-linux-x64/codeg-mcp": ("codeg-mcp", 10819192),
    "codeg-server-linux-x64/codeg-computer-helper": ("codeg-computer-helper", 9780696),
}


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
        self.install_thread: threading.Thread | None = None
        self.installing = False
        self.install_error = ""

    def _binary(self) -> str:
        name = "codeg-server.exe" if os.name == "nt" else "codeg-server"
        path = self.root / name
        if path.is_file():
            return str(path)
        if platform.system().lower() == "linux" and platform.machine().lower() in {"x86_64", "amd64"}:
            installed = self.data_dir.parent / "agents-runtime-linux" / "bin" / "codeg-server"
            return str(installed) if installed.is_file() else ""
        return ""

    def _install_linux_binary(self, archive_path: Path | None = None) -> str:
        if platform.system().lower() != "linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
            raise ValueError("the pinned Agents runtime binary is available for Linux x86_64 only")
        runtime_root = self.data_dir.parent / "agents-runtime-linux"
        target = runtime_root / "bin" / "codeg-server"
        if all((runtime_root / "bin" / executable).is_file()
               for executable, _size in LINUX_RUNTIME_MEMBERS.values()):
            return str(target)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="agents-runtime-", dir=self.data_dir) as staging:
            stage = Path(staging)
            downloaded = archive_path
            downloaded_by_us = downloaded is None
            if downloaded is None:
                downloaded = runtime_root / "download" / "codeg-server-linux-x64.tar.gz"
                if not downloaded.is_file():
                    downloaded.parent.mkdir(parents=True, exist_ok=True)
                    partial = downloaded.with_suffix(".part")
                    request = Request(LINUX_SERVER_URL, headers={"User-Agent": "Tether-Node"})
                    try:
                        with urlopen(request, timeout=300) as response, partial.open("wb") as output:
                            written = 0
                            while True:
                                block = response.read(min(1024 * 1024, LINUX_SERVER_ARCHIVE_SIZE + 1 - written))
                                if not block:
                                    break
                                written += len(block)
                                if written > LINUX_SERVER_ARCHIVE_SIZE:
                                    raise ValueError("pinned Agents runtime archive exceeds its expected size")
                                output.write(block)
                        os.replace(partial, downloaded)
                    except (OSError, ValueError) as exc:
                        try:
                            partial.unlink()
                        except OSError:
                            pass
                        if isinstance(exc, ValueError):
                            raise
                        raise ValueError("could not download the pinned Agents runtime") from exc
            if downloaded.stat().st_size != LINUX_SERVER_ARCHIVE_SIZE:
                if downloaded_by_us:
                    downloaded.unlink(missing_ok=True)
                raise ValueError("pinned Agents runtime archive has an unexpected size")
            digest = hashlib.sha256()
            with downloaded.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != LINUX_SERVER_SHA256:
                if downloaded_by_us:
                    downloaded.unlink(missing_ok=True)
                raise ValueError("pinned Agents runtime archive failed SHA-256 verification")
            staged_root = stage / "runtime"
            staged_bin = staged_root / "bin"
            staged_bin.mkdir(parents=True)
            try:
                with tarfile.open(downloaded, mode="r:gz") as archive:
                    members = {member.name: member for member in archive.getmembers()}
                    for member_name, (executable, expected_size) in LINUX_RUNTIME_MEMBERS.items():
                        member = members.get(member_name)
                        if member is None or not member.isfile() or member.size != expected_size:
                            raise ValueError("pinned Agents runtime archive is missing a required executable")
                        source = archive.extractfile(member)
                        if source is None:
                            raise ValueError("pinned Agents runtime executable is unreadable")
                        staged_binary = staged_bin / executable
                        with source, staged_binary.open("wb") as output:
                            shutil.copyfileobj(source, output)
                        if staged_binary.stat().st_size != expected_size:
                            raise ValueError("pinned Agents runtime executable is incomplete")
                        staged_binary.chmod(0o755)
            except (tarfile.TarError, OSError) as exc:
                raise ValueError("pinned Agents runtime archive is invalid") from exc
            runtime_root.parent.mkdir(parents=True, exist_ok=True)
            replacement = runtime_root.with_name(runtime_root.name + ".new")
            if replacement.exists():
                shutil.rmtree(replacement)
            os.replace(staged_root, replacement)
            backup = runtime_root.with_name(runtime_root.name + ".previous")
            if backup.exists():
                shutil.rmtree(backup)
            try:
                if runtime_root.exists():
                    os.replace(runtime_root, backup)
                os.replace(replacement, runtime_root)
            except OSError:
                if backup.exists() and not runtime_root.exists():
                    os.replace(backup, runtime_root)
                raise
            if backup.exists():
                shutil.rmtree(backup)
            if downloaded_by_us:
                try:
                    downloaded.unlink()
                    downloaded.parent.rmdir()
                except OSError:
                    pass
        return str(target)

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

    def _authenticated_ready(self, port: int, token: str) -> bool:
        import urllib.request
        request = urllib.request.Request(
            "http://127.0.0.1:%d/api/health" % port, data=b"{}",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            method="POST")
        try:
            with urllib.request.urlopen(request, timeout=0.8) as response:
                payload = json.loads(response.read(512).decode("utf-8"))
                return response.status == 200 and isinstance(payload, dict) and payload.get("status") == "ok"
        except Exception:
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
            return
        self.external_pid = 0
        if pid or port:
            if port and self._entry_port() == port:
                self._unregister()
            self._clear_state()
        self.process = None
        self.port = 0
        self.token = ""

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
            alive = self._is_running()
            running = alive and self._authenticated_ready(self.port, self.token)
            if running and self._entry_port() != self.port:
                self._register(self.port)
            elif alive and not running and self._entry_port() == self.port:
                self._unregister()
            if not alive:
                if self._entry_port() == self.port:
                    self._unregister()
                self.process = None
                self.external_pid = 0
                self.port = 0
                self.token = ""
                self._clear_state()
            return {"engine": "agents", "available": bool(self._binary()) and bool(self._web_dir()),
                    "installed": bool(self._binary()) and bool(self._web_dir()),
                    "installing": getattr(self, "installing", False),
                    "install_error": getattr(self, "install_error", ""),
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

    def _bootstrap_new_runtime_delegation(self, is_new_state: bool) -> None:
        marker = self.data_dir / "delegation-bootstrap.json"
        if marker.exists():
            return
        pending = self.data_dir / "delegation-bootstrap-pending.json"
        pending_new = False
        try:
            pending_new = json.loads(pending.read_text(encoding="utf-8")).get("new_state") is True
        except (OSError, ValueError, AttributeError):
            pass
        enable_for_new_state = is_new_state or pending_new
        if is_new_state and not pending.exists():
            pending.parent.mkdir(parents=True, exist_ok=True)
            pending.write_text(json.dumps({"new_state": True}) + "\n", encoding="utf-8")
        import urllib.request

        headers = {"Authorization": "Bearer " + self.token,
                   "Content-Type": "application/json"}
        try:
            request = urllib.request.Request(
                "http://127.0.0.1:%d/api/get_delegation_settings" % self.port,
                data=b"{}", headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=10) as response:
                settings = json.loads(response.read().decode("utf-8"))
            if not isinstance(settings, dict):
                return
            if enable_for_new_state and settings.get("enabled") is False:
                updated = dict(settings)
                updated["enabled"] = True
                body = json.dumps({"settings": updated}).encode("utf-8")
                request = urllib.request.Request(
                    "http://127.0.0.1:%d/api/set_delegation_settings" % self.port,
                    data=body, headers=headers, method="POST")
                with urllib.request.urlopen(request, timeout=10) as response:
                    json.loads(response.read().decode("utf-8"))
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(json.dumps({"checked": True}) + "\n", encoding="utf-8")
            pending.unlink(missing_ok=True)
        except Exception:
            # Keep the marker absent so the next start can retry the authenticated bootstrap.
            return

    def _queue_linux_install(self, agent: str, is_new_state: bool) -> dict[str, Any]:
        if self.installing:
            return self.status()
        self.installing = True
        self.install_error = ""

        def install() -> None:
            try:
                self._install_linux_binary()
                result = self.start(agent, _is_new_state=is_new_state, _install_completed=True)
                if not result.get("running"):
                    raise ValueError("Agents runtime did not become ready after installation")
                with self.lock:
                    self.installing = False
            except Exception as exc:
                with self.lock:
                    self.installing = False
                    self.install_error = str(exc)[:500]

        self.install_thread = threading.Thread(target=install, name="agents-runtime-install", daemon=True)
        self.install_thread.start()
        return {"engine": "agents", "available": bool(self._web_dir()), "installed": False,
                "installing": True, "install_error": "", "running": False,
                "port": 0, "token": "", "url": ""}

    def surface_url(self, base: str) -> str:
        if not self.port or not self.token:
            return ""
        root = str(base or "").rstrip("/")
        if not root:
            return ""
        return root + "/token.html?token=" + quote(self.token, safe="")

    def start(self, agent: str = "", *, _is_new_state: bool | None = None,
              _install_completed: bool = False) -> dict[str, Any]:
        with self.lock:
            self._adopt()
            if getattr(self, "installing", False) and not _install_completed:
                return self.status()
            if self._is_running():
                if not self._authenticated_ready(self.port, self.token):
                    if self._entry_port() == self.port:
                        self._unregister()
                    raise ValueError("Agents runtime is running but failed authenticated readiness")
                if agent:
                    self._seed_workspace(agent)
                return self.status()
            is_new_state = (_is_new_state if _is_new_state is not None else
                            not self.data_dir.exists() or not any(self.data_dir.iterdir()))
            binary = self._binary()
            static = self._web_dir()
            if not static:
                raise ValueError("Agents runtime web assets are not installed on this node")
            if not binary and platform.system().lower() == "linux" and not _install_completed:
                return self._queue_linux_install(agent, is_new_state)
            if not binary:
                raise ValueError("Agents runtime is not installed on this node")
            port = self._free_port()
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
            deadline = time.monotonic() + 30.0
            ready = False
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    break
                if self._authenticated_ready(port, token):
                    ready = True
                    break
                time.sleep(0.25)
            if not ready:
                try:
                    process.terminate()
                except OSError:
                    pass
                self.process, self.port, self.token = None, 0, ""
                raise ValueError("Agents runtime did not start")
            self._register(port)
            self._bootstrap_new_runtime_delegation(is_new_state)
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
            if self.port and self._entry_port() == self.port:
                self._unregister()
            self.process, self.external_pid, self.port, self.token = None, 0, 0, ""
            self._clear_state()
            return self.status()
