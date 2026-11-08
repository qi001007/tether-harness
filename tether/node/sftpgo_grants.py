"""Short-lived, read-only SFTPGo accounts for an authorized transfer."""

from __future__ import annotations

import base64
import json
import hashlib
import os
import posixpath
import secrets
import shutil
import socket
import stat
import subprocess
import threading
import time
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

class GrantError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class SftpGoGrants:
    MAX_GRANT_LEASE_SECONDS = 3600

    def __init__(self, data_dir: Path | str, *, device_id: str, resolve, read_guard, write_guard) -> None:
        self.data_dir = Path(data_dir)
        self.device_id = str(device_id)
        self._resolve = resolve
        self._read_guard = read_guard
        self._write_guard = write_guard
        self.instance_dir = self.data_dir / "sftpgo"
        self.owner_path = self.instance_dir / "owner.json"
        self.admin_path = self.instance_dir / "admin.json"
        self._process: subprocess.Popen[bytes] | None = None
        self._managed_lock = threading.RLock()
        self._external = bool(os.environ.get("TETHER_SFTPGO_ADMIN_URL"))
        self.component_dir = Path(os.environ.get("TETHER_SFTPGO_COMPONENT_DIR") or
                                  (Path(__file__).resolve().parents[3] / "tether-runtime" / "components" / "sftpgo"))
        self.binary = self.component_dir / ("sftpgo.exe" if os.name == "nt" else "sftpgo")
        self.admin_url = os.environ.get("TETHER_SFTPGO_ADMIN_URL", "").rstrip("/")
        self.admin_user = os.environ.get("TETHER_SFTPGO_ADMIN_USER", "")
        self.admin_password = os.environ.get("TETHER_SFTPGO_ADMIN_PASSWORD", "")
        self.sftp_port = int(os.environ.get("TETHER_SFTPGO_SFTP_PORT", "2022" if self._external else "0"))
        self.sftp_host = os.environ.get("TETHER_SFTPGO_SFTP_HOST", "127.0.0.1")
        self._availability_lock = threading.Lock()
        self._availability_at = 0.0
        self._availability = False
        self._availability_checking = False
        self.transfer_jobs = None

    def available(self) -> bool:
        """Return a cached status and refresh it off the Node request path."""
        now = time.monotonic()
        with self._availability_lock:
            if now - self._availability_at >= 15 and not self._availability_checking:
                self._availability_checking = True
                threading.Thread(target=self._probe_available, daemon=True,
                                 name="sftpgo-health-probe").start()
            return self._availability

    def _probe_available(self) -> None:
        ready = False
        try:
            if not self._external:
                if not self._owned_process():
                    return
            self._api("GET", "/version")
            with socket.create_connection((self.sftp_host, self.sftp_port), timeout=1.5):
                ready = True
        except (GrantError, OSError, ValueError, subprocess.SubprocessError):
            pass
        finally:
            with self._availability_lock:
                self._availability = ready
                self._availability_at = time.monotonic()
                self._availability_checking = False

    @staticmethod
    def _free_port(host: str) -> int:
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.bind((host, 0))
            return int(sock.getsockname()[1])

    def _load_admin(self) -> dict[str, Any] | None:
        try:
            value = json.loads(self.admin_path.read_text(encoding="utf-8"))
            if value.get("version") == 1 and value.get("username") and value.get("password"):
                return value
        except (OSError, ValueError, AttributeError):
            pass
        return None

    @staticmethod
    def _same_path(left: str, right: str) -> bool:
        return os.path.normcase(os.path.realpath(left)) == os.path.normcase(os.path.realpath(right))

    def _owned_process(self) -> bool:
        try:
            state = json.loads(self.owner_path.read_text(encoding="utf-8"))
            pid = int(state.get("pid") or 0)
            import psutil
            process = psutil.Process(pid)
            executable = str(state.get("exe") or "")
            if (abs(float(state.get("create_time") or 0) - process.create_time()) > 0.01 or
                    not self._same_path(process.exe(), executable) or
                    Path(executable).name.lower() not in {"sftpgo", "sftpgo.exe"}):
                return False
            command = process.cmdline()
            if not any(self._same_path(command[index + 1], str(self.instance_dir))
                       for index, arg in enumerate(command[:-1]) if arg in ("--config-dir", "-c")):
                return False
            admin = self._load_admin()
            self._process = None
            self.admin_url = "http://127.0.0.1:" + str(int(state["admin_port"]))
            self.admin_user = str((admin or {}).get("username") or "")
            self.admin_password = str((admin or {}).get("password") or "")
            self.sftp_host = str(state["sftp_host"])
            self.sftp_port = int(state["sftp_port"])
            return True
        except Exception:
            return False

    def _ensure_managed(self, mesh_host: str | None = None) -> None:
        with self._managed_lock:
            if self._owned_process():
                if mesh_host is None or self.sftp_host == mesh_host:
                    return
                if self.has_active_grants() or (self.transfer_jobs is not None and self.transfer_jobs.has_active_jobs()):
                    raise GrantError("mesh_busy", "SFTPGo cannot change its network binding during an active transfer")
                self.stop_owned()
            if not self.binary.is_file():
                raise GrantError("sftpgo_missing", "the bundled SFTPGo core executable is not installed")
            if not mesh_host:
                raise GrantError("mesh_unavailable", "SFTPGo requires the selected EasyTier network address")
            template = self.component_dir / "sftpgo.json"
            try:
                config = json.loads(template.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise GrantError("sftpgo_missing", "the bundled SFTPGo configuration is unavailable") from exc
            self.instance_dir.mkdir(parents=True, exist_ok=True)
            try:
                from .mesh_runtime import MeshRuntimeError, secure_private_directory
                secure_private_directory(self.instance_dir)
            except (OSError, MeshRuntimeError) as exc:
                raise GrantError("private_storage_unavailable", "SFTPGo credentials cannot be stored privately") from exc
            admin = self._load_admin()
            if not admin:
                admin = {"version": 1, "username": "tether_" + secrets.token_hex(8),
                         "password": secrets.token_urlsafe(40)}
                temp_admin = self.admin_path.with_suffix(".json.tmp")
                temp_admin.write_text(json.dumps(admin, separators=(",", ":")), encoding="utf-8")
                try:
                    os.chmod(temp_admin, stat.S_IRUSR | stat.S_IWUSR)
                except OSError:
                    pass
                os.replace(temp_admin, self.admin_path)
            admin_port = self._free_port("127.0.0.1")
            self.sftp_host = mesh_host
            self.sftp_port = self._free_port(mesh_host)
            provider = config.setdefault("data_provider", {})
            provider.update({"driver": "sqlite", "name": str(self.instance_dir / "sftpgo.db"),
                             "create_default_admin": True, "update_mode": 0})
            config.setdefault("sftpd", {}).update({
                "bindings": [{"address": mesh_host, "port": self.sftp_port}],
                "host_keys": [str(self.instance_dir / "id_ed25519")],
                "password_authentication": False,
                "keyboard_interactive_authentication": False, "enabled_ssh_commands": [],
            })
            config.setdefault("ftpd", {}).update({"bindings": [{"address": "127.0.0.1", "port": 0}]})
            config.setdefault("webdavd", {}).update({"bindings": [{"address": "127.0.0.1", "port": 0}]})
            config.setdefault("httpd", {}).update({
                "bindings": [{"address": "127.0.0.1", "port": admin_port,
                              "enable_web_admin": False, "enable_web_client": False,
                              "enable_rest_api": True, "enable_https": False}],
            })
            config.setdefault("telemetry", {}).update({"bind_address": "127.0.0.1", "bind_port": 0})
            email_templates = self.instance_dir / "templates" / "email"
            email_templates.mkdir(parents=True, exist_ok=True)
            for name in ("reset-password.html", "password-expiration.html"):
                template = email_templates / name
                if not template.exists():
                    template.write_text("<!-- Tether-owned SFTPGo startup template; SMTP is disabled. -->\n"
                                        "<!doctype html><html><body><p>Email is disabled for this transfer service.</p></body></html>\n",
                                        encoding="utf-8")
            config_path = self.instance_dir / "sftpgo.json"
            config_tmp = config_path.with_suffix(".json.tmp")
            config_tmp.write_text(json.dumps(config, separators=(",", ":")), encoding="utf-8")
            os.replace(config_tmp, config_path)
            child_env = {key: value for key, value in os.environ.items()
                         if not key.upper().startswith("SFTPGO_")}
            child_env.update({"SFTPGO_DEFAULT_ADMIN_USERNAME": admin["username"],
                              "SFTPGO_DEFAULT_ADMIN_PASSWORD": admin["password"]})
            self.admin_url = "http://127.0.0.1:" + str(admin_port)
            self.admin_user, self.admin_password = admin["username"], admin["password"]
            try:
                self._process = subprocess.Popen(
                    [str(self.binary), "serve", "--config-dir", str(self.instance_dir),
                     "--config-file", str(config_path), "--log-level", "error", "--log-file-path", ""],
                    cwd=str(self.instance_dir), env=child_env, stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError as exc:
                raise GrantError("sftpgo_start_failed", "the bundled SFTPGo core could not be started") from exc
            try:
                import psutil
                identity = psutil.Process(self._process.pid)
                state = {"version": 1, "pid": identity.pid, "create_time": identity.create_time(),
                         "exe": identity.exe(), "admin_port": admin_port,
                         "sftp_host": mesh_host, "sftp_port": self.sftp_port}
            except (OSError, ImportError) as exc:
                self._process.terminate()
                raise GrantError("sftpgo_start_failed", "SFTPGo process identity could not be recorded") from exc
            temp_state = self.owner_path.with_suffix(".json.tmp")
            temp_state.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
            try:
                os.chmod(temp_state, stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                pass
            os.replace(temp_state, self.owner_path)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if self._process.poll() is not None:
                    raise GrantError("sftpgo_start_failed", "the owned SFTPGo core exited before becoming ready")
                try:
                    self._api("GET", "/version")
                    with socket.create_connection((mesh_host, self.sftp_port), timeout=0.5):
                        return
                except (GrantError, OSError, ValueError):
                    time.sleep(0.2)
            self.stop_owned()
            raise GrantError("sftpgo_start_failed", "the owned SFTPGo core did not become healthy")

    def stop_owned(self) -> None:
        if self._external:
            return
        with self._managed_lock:
            if not self._owned_process():
                return
            try:
                import psutil
                state = json.loads(self.owner_path.read_text(encoding="utf-8"))
                process = psutil.Process(int(state["pid"]))
                process.terminate()
                process.wait(timeout=5)
                self.owner_path.unlink(missing_ok=True)
                self._process = None
            except psutil.TimeoutExpired:
                try:
                    process.kill()
                    process.wait(timeout=3)
                    self.owner_path.unlink(missing_ok=True)
                    self._process = None
                except (OSError, psutil.Error):
                    pass
            except (OSError, ValueError, KeyError, ImportError):
                pass

    def _api(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        parsed = urlsplit(self.admin_url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "::1", "localhost"):
            raise GrantError("sftpgo_admin_not_loopback", "SFTPGo admin API must be configured on loopback HTTP")
        if not self.admin_user or not self.admin_password:
            raise GrantError("sftpgo_unconfigured", "SFTPGo admin credentials are not configured")
        basic = base64.b64encode((self.admin_user + ":" + self.admin_password).encode()).decode()
        token_req = Request(self.admin_url + "/api/v2/token", headers={"Authorization": "Basic " + basic})
        try:
            with urlopen(token_req, timeout=3) as response:
                token = json.loads(response.read()).get("access_token", "")
        except (OSError, ValueError, URLError, HTTPError) as exc:
            raise GrantError("sftpgo_unavailable", "SFTPGo loopback API could not authenticate") from exc
        if not token:
            raise GrantError("sftpgo_unavailable", "SFTPGo did not return an admin token")
        data = json.dumps(body).encode() if body is not None else None
        request = Request(self.admin_url + "/api/v2" + path, data=data, method=method,
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=5) as response:
                content = response.read()
                return json.loads(content) if content else {}
        except HTTPError as exc:
            if exc.code == 404 and method == "DELETE":
                return {}
            raise GrantError("sftpgo_api_error", f"SFTPGo API returned HTTP {exc.code}") from exc
        except (OSError, ValueError, URLError) as exc:
            raise GrantError("sftpgo_unavailable", "SFTPGo API request failed") from exc

    @staticmethod
    def _escape_pattern(name: str) -> str:
        return "".join("\\" + char if char in "\\*?[]" else char for char in name.lower())

    def _selected_file_filters(self, root: Path, selected: list[tuple[str, bool]]) -> list[dict[str, Any]]:
        selected_dirs = {path for path, is_dir in selected if is_dir}
        allowed: dict[str, set[str]] = {}
        exact_names: dict[str, set[str]] = {}
        open_directories: set[str] = set()
        for relative, is_dir in selected:
            if any(relative.startswith(directory + "/") for directory in selected_dirs):
                continue
            parts = relative.split("/")
            parent = "/"
            for index, name in enumerate(parts):
                allowed.setdefault(parent, set()).add(name)
                exact_names.setdefault(parent, set()).add(name)
                child = posixpath.join(parent, name)
                if index == len(parts) - 1 and is_dir:
                    open_directories.add(child)
                parent = child
        for directory in open_directories:
            allowed[directory] = set()
        for parent, names in exact_names.items():
            parent_path = root if parent == "/" else root.joinpath(*parent.strip("/").split("/"))
            try:
                children = list(parent_path.iterdir())
            except OSError as exc:
                raise GrantError("source_unavailable", "a selected source directory could not be listed") from exc
            wanted = {name.lower() for name in names}
            for child in children:
                if child.name.lower() in wanted and child.name not in names:
                    raise GrantError("ambiguous_source_name", "SFTPGo's case-insensitive path filter cannot isolate this selected name")
        filters = []
        for virtual_path in sorted(allowed, key=lambda value: (value.count("/"), value)):
            filters.append({"path": virtual_path,
                            "allowed_patterns": sorted(self._escape_pattern(name) for name in allowed[virtual_path]),
                            "denied_patterns": [], "deny_policy": 1})
        return filters

    def _reject_symlink_components(self, root: Path, candidate: Path) -> None:
        relative = candidate.relative_to(root)
        current = root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise GrantError("unsupported_source", "symbolic links are not allowed in transfer grants")

    def issue(self, args: dict[str, Any]) -> dict[str, Any]:
        operation_id = str(args.get("operation_id") or "")
        if not operation_id or len(operation_id) > 128 or not operation_id.replace("-", "").replace("_", "").isalnum():
            raise GrantError("bad_operation_id", "operation_id is invalid")
        if str(args.get("source_device_id") or "") != self.device_id:
            raise GrantError("wrong_target", "grant must be issued by its source device")
        now = int(time.time())
        expires_at = args.get("expires_at")
        if (not args.get("actor_id") or not args.get("authorization_revision") or
                type(expires_at) is not int or expires_at <= now or
                expires_at > now + self.MAX_GRANT_LEASE_SECONDS):
            raise GrantError("authorization_required", "actor, current authorization revision and future expiry are required")
        if args.get("permissions") != ["list", "download"]:
            raise GrantError("bad_permissions", "transfer grants are limited to list and download")
        root = self._resolve(str(args.get("source_root") or ""))
        self._read_guard(root)
        if not root.exists() or not root.is_dir():
            raise GrantError("source_missing", "source grant root must be an existing directory")
        key = str(args.get("public_key") or "").strip()
        if not key.startswith(("ssh-ed25519 ", "ssh-rsa ", "ecdsa-sha2-")):
            raise GrantError("bad_public_key", "an OpenSSH public key is required")
        mesh_host = str(args.get("mesh_host") or "")
        network_id = str(args.get("network_id") or "")
        if not mesh_host or not network_id:
            raise GrantError("network_not_connected", "a Hub-selected EasyTier network address is required")
        try:
            import ipaddress
            mesh_host = str(ipaddress.IPv4Address(mesh_host))
        except ipaddress.AddressValueError as exc:
            raise GrantError("network_not_connected", "selected EasyTier address is not a valid IPv4 address") from exc
        if not self._external:
            self._ensure_managed(mesh_host)
        else:
            self.sftp_host = mesh_host
        host_key, fingerprint = self._host_key()
        items = args.get("items") if isinstance(args.get("items"), list) else []
        manifest: list[dict[str, str]] = []
        selected: list[tuple[str, bool]] = []
        for item in items:
            relative = self._relative(str(item.get("path") or ""))
            candidate = root / Path(*relative.split("/"))
            self._reject_symlink_components(root, candidate)
            item_path = self._resolve(str(candidate))
            if os.path.commonpath([str(root), str(item_path)]) != str(root):
                raise GrantError("bad_path", "source item escapes the authorized root")
            self._read_guard(item_path)
            is_dir = item_path.is_dir()
            if item_path.is_file() == is_dir or (item.get("kind") == "directory") != is_dir:
                raise GrantError("source_missing", "selected source type changed before grant creation")
            manifest.append({"path": relative, "sha256": self._fingerprint(item_path, read_guard=self._read_guard)})
            selected.append((relative, is_dir))
        if not manifest:
            raise GrantError("bad_args", "at least one source item is required")
        file_patterns = self._selected_file_filters(root, selected)
        username = "tether_" + operation_id
        expires_at = int(args["expires_at"])
        self._api("POST", "/users", {
            "status": 1, "username": username, "expiration_date": expires_at * 1000,
            "public_keys": [key], "home_dir": str(root),
            "permissions": {"/": ["list", "download"]},
            "filters": {"file_patterns": file_patterns},
            "max_sessions": 16, "quota_size": 0, "quota_files": 0,
            "upload_bandwidth": 0, "download_bandwidth": 0,
        })
        host = mesh_host
        grant_dir = self.data_dir / "transfer-grants"
        grant_dir.mkdir(mode=0o700, exist_ok=True)
        try:
            from .mesh_runtime import MeshRuntimeError, secure_private_directory
            secure_private_directory(grant_dir)
        except (OSError, MeshRuntimeError) as exc:
            self.revoke({"operation_id": operation_id})
            raise GrantError("private_storage_unavailable", "transfer grant metadata cannot be stored privately") from exc
        grant_file = grant_dir / (operation_id + ".json")
        try:
            grant_file.write_text(json.dumps({"username": username, "source_root": str(root),
                                              "items": manifest, "authorization_revision": str(args["authorization_revision"]),
                                              "actor_id": str(args.get("actor_id") or ""),
                                              "executor_device_id": str(args.get("executor_device_id") or ""),
                                              "network_id": network_id,
                                              "public_key": key,
                                              "expires_at": expires_at}, separators=(",", ":")), encoding="utf-8")
            os.chmod(grant_file, stat.S_IRUSR | stat.S_IWUSR)
        except OSError as exc:
            self.revoke({"operation_id": operation_id})
            raise GrantError("grant_store_failed", "temporary source grant metadata could not be stored") from exc
        return {"grant_id": operation_id, "operation_id": operation_id,
                "source_device_id": self.device_id, "executor_device_id": str(args.get("executor_device_id") or ""),
                "endpoint": {"host": host, "port": self.sftp_port, "username": username,
                             "host_key_fingerprint": fingerprint, "host_key": host_key},
                "remote_root": "/", "expires_at": expires_at, "network_id": network_id,
                "authorization_revision": str(args["authorization_revision"]),
                "source_fingerprints": manifest}

    def has_active_grants(self, *, network_id: str | None = None) -> bool:
        grant_dir = self.data_dir / "transfer-grants"
        try:
            files = tuple(grant_dir.glob("*.json"))
        except OSError:
            return True
        now = int(time.time())
        for grant_file in files:
            try:
                grant = json.loads(grant_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return True
            if int(grant.get("expires_at") or 0) <= now:
                continue
            saved_network = str(grant.get("network_id") or "")
            if network_id is None or not saved_network or saved_network == network_id:
                return True
        return False

    def finalize_move(self, args: dict[str, Any]) -> dict[str, Any]:
        operation_id = str(args.get("operation_id") or "")
        grant_file = self.data_dir / "transfer-grants" / (operation_id + ".json")
        journal_file = self.data_dir / "transfer-grants" / (operation_id + ".move-finalize.json")
        try:
            grant = json.loads(grant_file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise GrantError("grant_missing", "source grant metadata is unavailable") from exc
        if str(args.get("authorization_revision") or "") != grant.get("authorization_revision"):
            raise GrantError("authorization_changed", "source authorization changed before move finalization")
        expected = grant.get("items") if isinstance(grant.get("items"), list) else []
        supplied = args.get("source_fingerprints") if isinstance(args.get("source_fingerprints"), list) else []
        if supplied != expected:
            raise GrantError("manifest_mismatch", "move manifest does not match the original source snapshot")
        journal: dict[str, Any] = {"operation_id": operation_id, "authorization_revision": grant["authorization_revision"],
                                   "source_fingerprints": expected, "items": {}, "complete": False}
        try:
            previous = json.loads(journal_file.read_text(encoding="utf-8"))
            if (previous.get("operation_id") == operation_id and
                    previous.get("authorization_revision") == grant["authorization_revision"] and
                    previous.get("source_fingerprints") == expected):
                journal = previous
        except (OSError, ValueError):
            pass
        if journal.get("complete"):
            return journal["result"]
        if int(grant.get("expires_at") or 0) <= int(time.time()):
            raise GrantError("authorization_expired", "source grant expired before move finalization")
        root = self._resolve(str(grant.get("source_root") or ""))
        paths: list[Path] = []
        for item in expected:
            relative = self._relative(str(item.get("path") or ""))
            path = self._resolve(str(root / Path(*relative.split("/"))))
            self._reject_symlink_components(root, root / Path(*relative.split("/")))
            if os.path.commonpath([str(root), str(path)]) != str(root):
                raise GrantError("bad_path", "source item escapes its original root")
            prior = journal["items"].get(relative)
            if prior == "deleted" or (prior == "deleting" and not path.exists()):
                paths.append(path)
                continue
            self._read_guard(path)
            self._write_guard(path, "delete")
            if not path.exists():
                raise GrantError("source_changed", "source item disappeared before move finalization")
            if self._fingerprint(path, read_guard=self._read_guard) != item.get("sha256"):
                raise GrantError("source_changed", "source item changed after copy; it was kept")
            paths.append(path)
        deleted: list[str] = []
        retained: list[str] = []
        errors: list[dict[str, str]] = []
        for item, path in zip(expected, paths):
            relative = str(item["path"])
            prior = journal["items"].get(relative)
            if prior == "deleted":
                deleted.append(relative)
                continue
            try:
                if not path.exists() and prior == "deleting":
                    journal["items"][relative] = "deleted"
                    self._write_journal(journal_file, journal)
                    deleted.append(relative)
                    continue
                if not path.exists():
                    raise FileNotFoundError("source was removed before move finalization")
                if self._fingerprint(path, read_guard=self._read_guard) != item.get("sha256"):
                    raise GrantError("source_changed", "source item changed after copy; it was kept")
                journal["items"][relative] = "deleting"
                self._write_journal(journal_file, journal)
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
                journal["items"][relative] = "deleted"
                self._write_journal(journal_file, journal)
                deleted.append(relative)
            except GrantError as exc:
                retained.append(relative)
                errors.append({"path": relative, "message": str(exc)[:200]})
            except OSError as exc:
                retained.append(relative)
                errors.append({"path": relative, "message": str(exc)[:200]})
        result = {"operation_id": operation_id, "deleted": deleted, "retained": retained,
                  "errors": errors, "source_fingerprints": expected, "source_device_id": self.device_id}
        journal["result"] = result
        journal["complete"] = not retained
        self._write_journal(journal_file, journal)
        return result

    @staticmethod
    def _write_journal(path: Path, value: dict[str, Any]) -> None:
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
        try:
            os.chmod(temp, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        os.replace(temp, path)

    def revoke(self, args: dict[str, Any]) -> dict[str, Any]:
        operation_id = str(args.get("operation_id") or "")
        if args.get("grant_id") and str(args.get("grant_id")) != operation_id:
            raise GrantError("grant_mismatch", "grant_id does not match operation_id")
        username = "tether_" + operation_id
        if not operation_id or len(operation_id) > 128 or not operation_id.replace("-", "").replace("_", "").isalnum():
            raise GrantError("bad_operation_id", "operation_id is invalid")
        connections = self._api("GET", "/connections")
        for connection in connections if isinstance(connections, list) else []:
            if str(connection.get("username") or "") == username and connection.get("connection_id"):
                self._api("DELETE", "/connections/" + quote(str(connection["connection_id"]), safe=""))
        self._api("DELETE", "/users/" + quote(username, safe=""))
        (self.data_dir / "transfer-grants" / (operation_id + ".json")).unlink(missing_ok=True)
        return {"operation_id": operation_id, "revoked": True, "source_device_id": self.device_id}

    def renew(self, args: dict[str, Any]) -> dict[str, Any]:
        operation_id = str(args.get("operation_id") or "")
        if not operation_id or str(args.get("grant_id") or "") != operation_id:
            raise GrantError("grant_mismatch", "grant_id does not match operation_id")
        grant_file = self.data_dir / "transfer-grants" / (operation_id + ".json")
        try:
            grant = json.loads(grant_file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise GrantError("grant_missing", "source grant metadata is unavailable") from exc
        if (grant.get("actor_id") != args.get("actor_id") or
                grant.get("executor_device_id") != args.get("executor_device_id") or
                grant.get("authorization_revision") != args.get("authorization_revision") or
                grant.get("network_id") != args.get("network_id")):
            raise GrantError("authorization_changed", "renewal does not match the source grant identity or revision")
        expires_at = args.get("expires_at")
        now = int(time.time())
        if (type(expires_at) is not int or expires_at <= now or
                expires_at > now + self.MAX_GRANT_LEASE_SECONDS or
                expires_at <= int(grant.get("expires_at") or 0)):
            raise GrantError("bad_expiry", "renewal expiry must extend the current grant")
        username = str(grant.get("username") or "")
        user = self._api("GET", "/users/" + quote(username, safe=""))
        if not user or user.get("username") != username or user.get("home_dir") != grant.get("source_root"):
            raise GrantError("grant_mismatch", "SFTPGo user no longer matches the stored grant")
        if "public_keys" not in user or not user.get("public_keys"):
            raise GrantError("grant_mismatch", "SFTPGo user key is missing")
        if set(user["public_keys"]) != {grant.get("public_key")}:
            raise GrantError("grant_mismatch", "SFTPGo user key changed; renewal is refused")
        permissions = user.get("permissions")
        if (not isinstance(permissions, dict) or set(permissions) != {"/"} or
                set(permissions.get("/", [])) != {"list", "download"}):
            raise GrantError("grant_mismatch", "SFTPGo user ACL changed; renewal is refused")
        user["expiration_date"] = expires_at * 1000
        self._api("PUT", "/users/" + quote(username, safe=""), user)
        grant["expires_at"] = expires_at
        temp = grant_file.with_suffix(".json.tmp")
        temp.write_text(json.dumps(grant, separators=(",", ":")), encoding="utf-8")
        os.replace(temp, grant_file)
        return {"operation_id": operation_id, "grant_id": operation_id,
                "source_device_id": self.device_id, "expires_at": expires_at,
                "authorization_revision": grant["authorization_revision"],
                "network_id": grant["network_id"]}

    def _host_key(self) -> tuple[str, str]:
        # SFTPGo publishes its host key through the standard SSH host-key exchange;
        # without a configured, independently known pin we refuse to issue grants.
        pin = os.environ.get("TETHER_SFTPGO_HOST_KEY", "").strip()
        if not pin and not self._external:
            public_key = self.instance_dir / "id_ed25519.pub"
            try:
                pin = public_key.read_text(encoding="ascii").strip()
            except OSError as exc:
                raise GrantError("host_key_unpinned", "the owned SFTPGo host public key is unavailable") from exc
        if not pin or " " not in pin:
            raise GrantError("host_key_unpinned", "SFTPGo SSH host public key pin is not configured")
        import hashlib
        import base64 as b64
        try:
            raw = b64.b64decode(pin.split()[1] + "===", validate=False)
        except (ValueError, IndexError) as exc:
            raise GrantError("host_key_unpinned", "SFTPGo SSH host public key pin is invalid") from exc
        import base64
        fingerprint = base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
        return pin.split()[0] + " " + pin.split()[1], "SHA256:" + fingerprint

    @staticmethod
    def _relative(value: str) -> str:
        normalized = value.replace("\\", "/")
        windows = PureWindowsPath(value)
        if (not normalized or normalized.startswith("/") or normalized.startswith("//") or
                windows.is_absolute() or windows.drive or "\x00" in normalized or
                any(part in ("", ".", "..") or ":" in part for part in normalized.split("/"))):
            raise GrantError("bad_path", "item path must be a normalized relative POSIX path")
        return normalized

    @staticmethod
    def _fingerprint(path: Path, *, read_guard=None) -> str:
        if path.is_symlink():
            raise GrantError("unsupported_source", "symbolic links are not allowed in transfer grants")
        if read_guard:
            read_guard(path.resolve())
        digest = hashlib.sha256()
        if path.is_file():
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            return digest.hexdigest()
        if not path.is_dir():
            raise GrantError("source_missing", "source item is not a regular file or directory")
        for child in sorted(path.rglob("*")):
            if child.is_symlink():
                raise GrantError("unsupported_source", "symbolic links are not allowed in transfer grants")
            if read_guard:
                read_guard(child.resolve())
            digest.update(child.relative_to(path).as_posix().encode("utf-8"))
            digest.update(b"\0")
            if child.is_file():
                with child.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
            digest.update(b"\0")
        return digest.hexdigest()

