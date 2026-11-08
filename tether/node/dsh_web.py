"""Manage an isolated, bundled DeepSeek Harness Web profile on this Node."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import psutil

from .mesh_runtime import MeshRuntimeError, secure_private_directory

DSH_VERSION = "0.2.1-rc.5"
PLUGIN_VERSION = "0.2.93"
PLUGIN_SHA256 = "08f33b371de45895316a3e132f40c11976ed30cdd2fceebc38bcab2608c1f9df"
SUPPORTED_SYSTEMS = {"Windows", "Linux", "Darwin"}
STARTUP_TIMEOUT = 25.0
PLUGIN_TIMEOUT = 300.0
TOKEN_RE = re.compile(r"[?&]token=([A-Za-z0-9_-]{16,512})")
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class DshWeb:
    """Own only the web process and DSH_HOME created under this Node's data dir."""

    def __init__(self, data_dir: Path, workspace: Path | None = None) -> None:
        self.data_dir = Path(data_dir).resolve()
        self.root = self.data_dir / "dsh-web"
        self.dsh_home = self.root / "home"
        self.state_path = self.root / "process.json"
        self.log_path = self.root / "web.log"
        self.descriptor = self.dsh_home / "storages" / "tether" / "native-surface.json"
        self.workspace = Path(workspace or data_dir).resolve()
        runtime_root = os.environ.get("TETHER_DSH_RUNTIME_DIR", "").strip()
        node_executable = os.environ.get("TETHER_NODEJS_EXE", "").strip()
        self.runtime_dir = Path(runtime_root).resolve() if runtime_root and Path(runtime_root).is_absolute() else None
        self.node_executable = (Path(node_executable).resolve()
                                if node_executable and Path(node_executable).is_absolute() else None)
        self.entry = (self.runtime_dir / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"
                      if self.runtime_dir else None)
        self.package_json = (self.runtime_dir / "node_modules" / "@deepseek-ai" / "dsh" / "package.json"
                             if self.runtime_dir else None)
        self.lockfile = self.runtime_dir / "package-lock.json" if self.runtime_dir else None
        self.plugin_archive = (self.runtime_dir.parent / "dsh-plugin" / "tether-plugin-0.2.93.zip"
                               if self.runtime_dir else None)
        self.process: subprocess.Popen[str] | None = None
        self._lock = threading.RLock()
        self._starting = False
        self._error = ""
        self._error_code = ""
        self._reader: threading.Thread | None = None
        self._ready = threading.Event()

    def _bundle_error(self) -> tuple[str, str] | None:
        if platform.system() not in SUPPORTED_SYSTEMS:
            return "unsupported_platform", "DSH Web is not supported on this operating system"
        if self.node_executable is None or not self.node_executable.is_file():
            return "node_runtime_missing", "The bundled Node.js runtime is missing"
        if self.entry is None or self.package_json is None or not self.entry.is_file() or not self.package_json.is_file():
            return "dsh_runtime_missing", "The bundled DeepSeek Harness runtime is missing"
        try:
            package = json.loads(self.package_json.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return "dsh_runtime_invalid", "The bundled DeepSeek Harness package metadata is invalid"
        if package.get("version") != DSH_VERSION:
            return "dsh_runtime_version", "The bundled DeepSeek Harness version does not match this Node"
        if self.lockfile is None or not self.lockfile.is_file():
            return "dsh_lock_missing", "The fixed DeepSeek Harness dependency lock is missing"
        if self.plugin_archive is None or not self.plugin_archive.is_file():
            return "dsh_plugin_bundle_missing", "The frozen Tether DSH plugin bundle is missing"
        digest = hashlib.sha256()
        try:
            with self.plugin_archive.open("rb") as archive:
                for chunk in iter(lambda: archive.read(1024 * 1024), b""):
                    digest.update(chunk)
        except OSError:
            return "dsh_plugin_bundle_unreadable", "The frozen Tether DSH plugin bundle cannot be read"
        if digest.hexdigest() != PLUGIN_SHA256:
            return "dsh_plugin_bundle_invalid", "The frozen Tether DSH plugin bundle failed its SHA-256 check"
        return None

    def status(self) -> dict[str, Any]:
        bundle_error = self._bundle_error()
        running, port = self._owned_status()
        error_code = self._error_code or (bundle_error[0] if bundle_error else "")
        error = self._error or (bundle_error[1] if bundle_error else "")
        return {
            "supported": platform.system() in SUPPORTED_SYSTEMS,
            "installed": bundle_error is None,
            "running": running,
            "installing": self._starting,
            "url": "",
            "port": port,
            "version": DSH_VERSION,
            "device_id": "",
            "error_code": error_code,
            "error": error,
        }

    def install(self) -> dict[str, Any]:
        """Check that the shipped fixed runtime is present; never install from PATH/npm."""
        with self._lock:
            self._error = ""
            self._error_code = ""
            error = self._bundle_error()
            if error:
                self._error_code, self._error = error
            return self.status()

    def start(self) -> dict[str, Any]:
        with self._lock:
            current = self.status()
            if current["running"] or self._starting:
                return current
            self._error = ""
            self._error_code = ""
            error = self._bundle_error()
            if error:
                self._error_code, self._error = error
                return self.status()
            self._starting = True
            self._ready.clear()
            worker = threading.Thread(target=self._start_worker, daemon=True, name="dsh-web-start")
            worker.start()
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._starting:
                self._error_code, self._error = "dsh_start_in_progress", "DeepSeek Harness Web is still starting"
                return self.status()
            if not self._stop_owned():
                return self.status()
            self._error = ""
            self._error_code = ""
            return self.status()

    def repair_plugin(self) -> dict[str, Any]:
        with self._lock:
            current = self.status()
            if self._starting:
                return current
            if not current["running"]:
                self._error_code, self._error = "dsh_not_running", "Start DeepSeek Harness Web before repairing its plugin"
                return self.status()
            if not self._stop_owned():
                return self.status()
            self._error_code = self._error = ""
            self._starting = True
            self._ready.clear()
            worker = threading.Thread(target=self._start_worker, args=(True,), daemon=True,
                                      name="dsh-web-plugin-repair")
            worker.start()
            return self.status()

    def _start_worker(self, repair_plugin: bool = False) -> None:
        try:
            self._prepare_private_home()
            plugin_root = self._extract_frozen_plugin()
            self._install_frozen_plugin(plugin_root, force=repair_plugin)
            env = self._child_env()
            kwargs: dict[str, Any] = {
                "cwd": str(self.workspace), "env": env,
                "stdin": subprocess.DEVNULL, "stderr": subprocess.STDOUT,
            }
            if os.name == "nt":
                kwargs["creationflags"] = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) |
                                           getattr(subprocess, "DETACHED_PROCESS", 0) |
                                           getattr(subprocess, "CREATE_NO_WINDOW", 0))
            else:
                kwargs["start_new_session"] = True
            with self.log_path.open("w", encoding="utf-8") as log_file:
                process = subprocess.Popen(
                    [str(self.node_executable), str(self.entry), "web", "--host", "127.0.0.1",
                     "--no-open", "--port", "0"], stdout=log_file, **kwargs)
            self.process = process
            create_time = psutil.Process(process.pid).create_time()
            self._write_state({"pid": process.pid, "create_time": create_time,
                               "executable": str(self.node_executable.resolve()),
                               "entry": str(self.entry.resolve()), "dsh_home": str(self.dsh_home.resolve())})
            self._reader = threading.Thread(target=self._read_output, args=(process,), daemon=True,
                                            name="dsh-web-output")
            self._reader.start()
            if not self._ready.wait(STARTUP_TIMEOUT):
                raise RuntimeError("dsh_start_timeout")
            if process.poll() is not None or not self._owned_status()[0]:
                raise RuntimeError("dsh_start_failed")
        except RuntimeError as exc:
            code = str(exc) if str(exc).startswith("dsh_") else "dsh_start_failed"
            self._set_error(code, self._message_for(code))
            self._stop_owned()
        except Exception:
            self._set_error("dsh_start_failed", "DeepSeek Harness Web failed to start")
            self._stop_owned()
        finally:
            with self._lock:
                self._starting = False

    def _prepare_private_home(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        secure_private_directory(self.root)
        self.dsh_home.mkdir(parents=True, exist_ok=True)
        secure_private_directory(self.dsh_home)
        self.workspace.mkdir(parents=True, exist_ok=True)

    def _child_env(self) -> dict[str, str]:
        inherited = {
            "PATH", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE",
            "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "HOME", "LANG",
            "LC_ALL", "LC_CTYPE", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
            "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
            "SSL_CERT_FILE", "SSL_CERT_DIR",
        }
        env = {key: value for key, value in os.environ.items() if key in inherited}
        system_root = next((value for key, value in os.environ.items()
                            if key.casefold() in {"systemroot", "windir"}), "")
        if system_root:
            env["SystemRoot"] = system_root
        env["DSH_HOME"] = str(self.dsh_home)
        env.pop("NODE_OPTIONS", None)
        if self.node_executable is None:
            raise RuntimeError("node_runtime_missing")
        node_dir = str(self.node_executable.resolve().parent)
        path = env.get("PATH", "")
        paths = path.split(os.pathsep) if path else []
        if node_dir not in paths:
            env["PATH"] = node_dir + (os.pathsep + path if path else "")
        return env

    def _extract_frozen_plugin(self) -> Path:
        if self.plugin_archive is None:
            raise RuntimeError("dsh_plugin_bundle_missing")
        target = self.root / "plugin-source" / PLUGIN_VERSION
        package = target / "tether-plugin-0.2.93" / "packages" / "dsh-plugin-tether" / "package.json"
        if package.is_file():
            try:
                data = json.loads(package.read_text(encoding="utf-8"))
                if data.get("version") == PLUGIN_VERSION:
                    return package.parent
            except (OSError, ValueError):
                pass
        staging = target.with_name(target.name + ".tmp-" + str(os.getpid()))
        if staging.exists():
            shutil.rmtree(staging)
        staging.mkdir(parents=True)
        try:
            with zipfile.ZipFile(self.plugin_archive) as archive:
                for info in archive.infolist():
                    member = PurePosixPath(info.filename)
                    if (member.is_absolute() or ".." in member.parts or "\\" in info.filename or
                            (info.external_attr >> 16) & 0o170000 == 0o120000):
                        raise RuntimeError("dsh_plugin_bundle_invalid")
                    destination = staging.joinpath(*member.parts)
                    if info.is_dir():
                        destination.mkdir(parents=True, exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(info) as source, destination.open("wb") as output:
                            shutil.copyfileobj(source, output)
            extracted = staging / "tether-plugin-0.2.93" / "packages" / "dsh-plugin-tether" / "package.json"
            data = json.loads(extracted.read_text(encoding="utf-8"))
            if data.get("name") != "tether-dsh-plugin" or data.get("version") != PLUGIN_VERSION:
                raise RuntimeError("dsh_plugin_bundle_invalid")
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.rmtree(target)
            os.replace(staging, target)
            return target / "tether-plugin-0.2.93" / "packages" / "dsh-plugin-tether"
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

    def _install_frozen_plugin(self, plugin_package: Path, *, force: bool = False) -> None:
        installed = self.dsh_home / "profiles" / "web" / "node_modules" / "tether-dsh-plugin" / "package.json"
        if installed.is_file() and not force:
            try:
                if json.loads(installed.read_text(encoding="utf-8")).get("version") == PLUGIN_VERSION:
                    return
            except (OSError, ValueError):
                pass
        command = [str(self.node_executable), str(self.entry), "plugin", "--profile", "web",
                   "add", "file:" + str(plugin_package)]
        try:
            subprocess.run(command, cwd=str(self.workspace), env=self._child_env(),
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=PLUGIN_TIMEOUT, check=True)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("dsh_plugin_install_timeout") from exc
        except (OSError, subprocess.CalledProcessError) as exc:
            raise RuntimeError("dsh_plugin_install_failed") from exc
        if not installed.is_file():
            raise RuntimeError("dsh_plugin_install_failed")
        try:
            version = json.loads(installed.read_text(encoding="utf-8")).get("version")
        except (OSError, ValueError):
            version = None
        if version != PLUGIN_VERSION:
            raise RuntimeError("dsh_plugin_install_failed")

    def _read_output(self, process: subprocess.Popen[str]) -> None:
        try:
            with self.log_path.open("rb") as output:
                while True:
                    line = output.readline()
                    if not line:
                        if process.poll() is not None:
                            return
                        time.sleep(0.1)
                        continue
                    clean = ANSI_RE.sub("", line.decode("utf-8", errors="replace"))
                    match = TOKEN_RE.search(clean)
                    if not match:
                        continue
                    token_bytes = match.group(1).encode("ascii")
                    redacted = line.replace(token_bytes, b"*" * len(token_bytes))
                    if redacted != line:
                        try:
                            with self.log_path.open("r+b") as private_log:
                                private_log.seek(output.tell() - len(line))
                                private_log.write(redacted)
                        except OSError:
                            pass
                    # Parse the startup URL privately; never publish the log line or token.
                    start = clean.find("http")
                    url = clean[start:].strip() if start >= 0 else ""
                    try:
                        url = url.split()[0]
                        parts = urllib.parse.urlsplit(url)
                        query = urllib.parse.parse_qs(parts.query, keep_blank_values=True)
                        port = parts.port
                        if (parts.scheme != "http" or parts.hostname not in {"127.0.0.1", "::1"} or
                                port is None or query.get("token") != [match.group(1)] or
                                set(query) != {"token"} or parts.username or parts.password or parts.fragment):
                            continue
                        origin = f"http://{parts.hostname}:{port}"
                        self._write_descriptor(origin, url, process.pid)
                        self._ready.set()
                    except (ValueError, OSError):
                        continue
        except OSError:
            return

    def _write_descriptor(self, origin: str, auth_url: str, pid: int) -> None:
        self.descriptor.parent.mkdir(parents=True, exist_ok=True)
        secure_private_directory(self.descriptor.parent)
        payload = {"version": 1, "origin": origin, "authenticated_url": auth_url,
                   "profile": "web", "pid": pid, "updated_at": time.time()}
        temporary = self.descriptor.with_name(self.descriptor.name + ".tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, self.descriptor)

    def _write_state(self, payload: dict[str, Any]) -> None:
        temporary = self.state_path.with_name(self.state_path.name + ".tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, self.state_path)

    def _state(self) -> dict[str, Any]:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            if (not isinstance(value, dict) or type(value.get("pid")) is not int or
                    float(value.get("create_time") or 0) <= 0 or
                    Path(str(value.get("dsh_home") or "")).resolve() != self.dsh_home.resolve()):
                return {}
            return value
        except (OSError, ValueError, TypeError):
            return {}

    def _owned_process(self) -> psutil.Process | None:
        state = self._state()
        if not state:
            return None
        try:
            process = psutil.Process(state["pid"])
            if abs(process.create_time() - float(state["create_time"])) > 0.01:
                return None
            if os.path.normcase(os.path.realpath(process.exe())) != os.path.normcase(os.path.realpath(state["executable"])):
                return None
            cmdline = [str(value) for value in process.cmdline()]
            if (not cmdline or os.path.normcase(os.path.realpath(cmdline[0])) != os.path.normcase(os.path.realpath(state["executable"]))
                    or os.path.normcase(os.path.realpath(state["entry"])) not in
                    {os.path.normcase(os.path.realpath(value)) for value in cmdline[1:] if value.lower().endswith(".js")}
                    or "web" not in cmdline or "127.0.0.1" not in cmdline):
                return None
            if os.path.normcase(os.path.realpath(process.environ().get("DSH_HOME", ""))) != os.path.normcase(os.path.realpath(state["dsh_home"])):
                return None
            return process
        except (psutil.Error, OSError, ValueError):
            return None

    def _owned_status(self) -> tuple[bool, int]:
        process = self._owned_process()
        if process is None:
            return False, 0
        try:
            descriptor = json.loads(self.descriptor.read_text(encoding="utf-8"))
            origin = str(descriptor.get("origin") or "")
            pid = int(descriptor.get("pid") or 0)
            parts = urllib.parse.urlsplit(origin)
            if pid != process.pid or parts.hostname not in {"127.0.0.1", "::1"} or not parts.port:
                return False, 0
            with socket.create_connection((parts.hostname, parts.port), timeout=0.5):
                return True, parts.port
        except (OSError, ValueError, TypeError):
            return False, 0

    def _stop_owned(self) -> bool:
        process = self._owned_process()
        if process is None:
            return False
        try:
            process.terminate()
            process.wait(timeout=8)
        except psutil.TimeoutExpired:
            try:
                process = self._owned_process()
                if process is None:
                    return False
                process.kill()
                process.wait(timeout=5)
            except (psutil.Error, OSError):
                self._error_code, self._error = "dsh_stop_failed", "Could not stop the owned DSH Web process"
                return False
        except (psutil.Error, OSError):
            self._error_code, self._error = "dsh_stop_failed", "Could not stop the owned DSH Web process"
            return False
        reader = self._reader
        if reader is not None and reader is not threading.current_thread():
            reader.join(timeout=2)
            if reader.is_alive():
                self._error_code, self._error = "dsh_stop_failed", "Could not close the DSH Web output reader"
                return False
        self._reader = None
        try:
            descriptor = json.loads(self.descriptor.read_text(encoding="utf-8"))
            if descriptor.get("pid") == process.pid:
                self.descriptor.unlink(missing_ok=True)
            self.state_path.unlink(missing_ok=True)
            self.log_path.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
        self.process = None
        self._ready.clear()
        return True

    def _set_error(self, code: str, message: str) -> None:
        with self._lock:
            self._error_code, self._error = code, message

    @staticmethod
    def _message_for(code: str) -> str:
        return {
            "dsh_start_timeout": "DeepSeek Harness Web did not publish its local endpoint in time",
            "dsh_start_failed": "DeepSeek Harness Web failed its local startup check",
            "dsh_plugin_install_timeout": "The frozen Tether DSH plugin install timed out",
            "dsh_plugin_install_failed": "The frozen Tether DSH plugin could not be installed",
            "dsh_plugin_bundle_invalid": "The frozen Tether DSH plugin bundle is invalid",
        }.get(code, "DeepSeek Harness Web failed to start")
