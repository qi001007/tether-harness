"""Per-actor native service access through isolated Caddy workers."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import shutil
import ssl
import subprocess
import threading
import time
from contextlib import contextmanager
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .mesh_runtime import MeshRuntimeError, secure_private_directory

SERVICE_IDS = {"dsh", "codeg", "herdr", "files", "desktop"}
MAX_LEASE_SECONDS = 3600
BOOTSTRAP_SECONDS = 60
VIEW_TTL_SECONDS = 15 * 60
LOGGER = logging.getLogger(__name__)


class ServiceAccessError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class _Worker:
    def __init__(self, *, actor_id: str, target_id: str, service_id: str, grant_id: str,
                 revision: str, network_id: str, lease_expires_at: int, mesh_ip: str, port: int, native_port: int,
                 manager_port: int, worker_secret: str, config_path: Path, process: subprocess.Popen) -> None:
        self.actor_id, self.target_id = actor_id, target_id
        self.service_id, self.grant_id = service_id, grant_id
        self.revision, self.network_id, self.lease_expires_at = revision, network_id, lease_expires_at
        self.mesh_ip, self.port, self.native_port, self.manager_port = mesh_ip, port, native_port, manager_port
        self.worker_secret, self.config_path, self.process = worker_secret, config_path, process
        self.publish_lock = threading.RLock()
        self.created_at = time.time()
        self.last_view_at = self.created_at
        self.bootstrap_hashes: dict[str, float] = {}

    @property
    def origin(self) -> str:
        return f"https://{self.mesh_ip}:{self.port}"


class ServiceAccess:
    """Owns native runtime access workers, leases, bootstrap tickets and revocation."""

    _instances: dict[str, "ServiceAccess"] = {}

    def __new__(cls, data_dir: Path | str, **kwargs):
        key = str((Path(data_dir) / "service-access").resolve())
        instance = cls._instances.get(key)
        if instance is None:
            instance = super().__new__(cls)
            instance._instance_key = key
            cls._instances[key] = instance
        return instance

    def __init__(self, data_dir: Path | str, *, target_id: str, native_surface=None,
                 agents_runtime=None, dsh_web=None, files_http=None, network_address=None) -> None:
        if getattr(self, "_initialized", False):
            if self.target_id != str(target_id):
                raise ServiceAccessError("service_store_identity_mismatch", "service manager data directory belongs to another Node")
            if native_surface is not None:
                self.native_surface = native_surface
            if agents_runtime is not None:
                self.agents_runtime = agents_runtime
            if dsh_web is not None:
                self.dsh_web = dsh_web
            if files_http is not None:
                self.files_http = files_http
            if network_address is not None:
                self.network_address = network_address
            return
        self.data_dir = Path(data_dir) / "service-access"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._private_storage_ready = False
        try:
            secure_private_directory(self.data_dir)
            self._private_storage_ready = True
        except (MeshRuntimeError, OSError):
            self._private_storage_error = "private_storage_unavailable"
        self.target_id = str(target_id)
        self.native_surface = native_surface
        self.agents_runtime = agents_runtime
        self.dsh_web = dsh_web
        self.files_http = files_http
        self.network_address = network_address
        self.remote_desktop = None
        self.remote_desktop_error = "meshcentral_runtime_missing"
        self.caddy = os.environ.get("TETHER_CADDY") or shutil.which("caddy") or ""
        self.ca_storage = self.data_dir / "caddy-storage"
        self.workers: dict[str, _Worker] = {}
        self._starting_grants: set[tuple[str, str, str]] = set()
        self.tombstones: dict[str, int] = {}
        self._lock = threading.RLock()
        self._owner_lock = self._take_owner_lock()
        self._httpd: ThreadingHTTPServer | None = None
        self._http_thread: threading.Thread | None = None
        self._load_tombstones()
        self._cleanup_orphan_workers()
        self._sweeper = threading.Thread(target=self._sweep, daemon=True, name="service-access-lease-sweeper")
        self._sweeper.start()
        self._initialized = True

    def _take_owner_lock(self):
        path = self.data_dir / "owner.lock"
        handle = path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                if not handle.read(1):
                    handle.seek(0)
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as exc:
            handle.close()
            raise ServiceAccessError("service_owner_exists", "another Node process owns service access workers") from exc
        return handle

    @staticmethod
    def worker_id(actor_id: str, service_id: str, grant_id: str) -> str:
        return hashlib.sha256((actor_id + "\0" + service_id + "\0" + grant_id).encode()).hexdigest()[:24]

    def catalog(self) -> dict[str, Any]:
        codeg = self._codeg_status()
        desktop = (self.remote_desktop.catalog() if self.remote_desktop is not None else
                   {"state": "missing", "reason": self.remote_desktop_error})
        statuses = {
            "dsh": self._dsh_status(),
            "codeg": codeg,
            "herdr": codeg,
            "files": self.files_http.status() if self.files_http is not None else
                     {"state": "missing", "reason": "files_runtime_missing"},
            "desktop": {"ready": desktop.get("state") == "ready", **desktop},
        }
        if not self._private_storage_ready:
            for service_id in ("dsh", "codeg", "herdr", "files", "desktop"):
                statuses[service_id] = {"ready": False, "state": "failed",
                                        "reason": "private_storage_unavailable"}
        services = []
        for service_id in ("dsh", "codeg", "herdr", "files", "desktop"):
            status = statuses[service_id]
            service_state = status.get("state") or ("ready" if status["ready"] else "missing")
            services.append({"id": service_id, "state": service_state,
                             "endpoint": None, "transport": "caddy-easytier",
                             **({"reason": status["reason"]} if status.get("reason") else {}),
                             **({"agent_busy": bool(status["agent_busy"])} if service_id == "desktop" and "agent_busy" in status else {}),
                             **({"view_only_reason": status["view_only_reason"]} if service_id == "desktop" and status.get("view_only_reason") else {}),
                             "updated_at": time.time()})
        return {"protocol": 1, "target_id": self.target_id, "services": services}

    def issue(self, authority: dict[str, Any], lease_expires_at: int) -> dict[str, Any]:
        self._validate_authority(authority)
        if not self._private_storage_ready:
            raise ServiceAccessError(getattr(self, "_private_storage_error", "private_storage_unavailable"),
                                     "service access secrets cannot be stored privately")
        actor_id, service_id = str(authority["actor_id"]), str(authority["service_id"])
        grant_id, revision = str(authority["grant_id"]), str(authority["authorization_revision"])
        claim = (actor_id, service_id, grant_id)
        lease_expires_at = int(lease_expires_at)
        now = int(time.time())
        if lease_expires_at <= now or lease_expires_at > now + MAX_LEASE_SECONDS:
            raise ServiceAccessError("bad_lease", "service lease must expire within one hour")
        network_id = str(authority["network_id"])
        existing = None
        claimed = False
        with self._lock:
            if grant_id in self.tombstones:
                raise ServiceAccessError("grant_revoked", "this grant has been revoked")
            if claim in self._starting_grants:
                raise ServiceAccessError("grant_start_in_progress", "this service grant is already starting")
            existing = self._worker_for(actor_id, service_id, grant_id)
            if existing and existing.revision != revision:
                raise ServiceAccessError("authorization_changed", "service grant revision changed")
            if existing and existing.network_id != network_id:
                raise ServiceAccessError("network_changed", "service grant is bound to another EasyTier network")
            if (existing and
                    getattr(existing, "authority", {}).get("operation_id") != authority.get("operation_id")):
                raise ServiceAccessError("grant_operation_conflict", "service grant is bound to another operation")
            if existing and self._worker_alive(existing):
                reuse = existing
            else:
                self._starting_grants.add(claim)
                claimed = True

        if not claimed:
            mesh_ip = self._network_ip(network_id)
            if reuse.mesh_ip != mesh_ip:
                raise ServiceAccessError("network_changed", "service worker must be reopened on the current network address")
            if service_id == "desktop":
                try:
                    status = self.remote_desktop.view(authority) if self.remote_desktop is not None else {}
                except Exception as exc:
                    raise ServiceAccessError(getattr(exc, "code", "grant_missing"),
                                             "native desktop share could not be verified") from exc
                if status.get("state") != "ready":
                    raise ServiceAccessError("grant_missing", "native desktop share is no longer active")
                if lease_expires_at > int(status.get("expires_at") or 0):
                    raise ServiceAccessError("native_share_renewal_required",
                                             "native desktop share must be renewed before extending its lease")
            with self._lock:
                if (self._worker_for(actor_id, service_id, grant_id) is not reuse or
                        grant_id in self.tombstones or not self._worker_alive(reuse)):
                    raise ServiceAccessError("grant_missing", "service grant worker is no longer active")
                reuse.lease_expires_at = lease_expires_at
                self._new_bootstrap_ticket(reuse)
                return self._descriptor(reuse, operation_id=str(authority["operation_id"]))

        worker = None
        desktop_share = None
        try:
            mesh_ip = self._network_ip(network_id)
            if not self.caddy or not Path(self.caddy).is_file():
                raise ServiceAccessError("caddy_missing", "Caddy is not installed on this Node")
            self._ensure_manager()
            endpoint_path = "/"
            if service_id == "desktop":
                if self.remote_desktop is None:
                    raise ServiceAccessError(self.remote_desktop_error or "meshcentral_runtime_missing",
                                             "remote desktop runtime is unavailable")
                duration = ((lease_expires_at - now) // 60) * 60
                if duration < 60:
                    raise ServiceAccessError("bad_lease", "desktop grants require at least one full minute")
                try:
                    desktop_share = self.remote_desktop.open(authority, duration_seconds=duration)
                    local = self.remote_desktop.local_upstream()
                except Exception as exc:
                    code = getattr(exc, "code", "desktop_open_failed")
                    raise ServiceAccessError(code, "native desktop share could not be opened") from exc
                upstream, endpoint_path = self._desktop_upstream(local, desktop_share)
                lease_expires_at = min(lease_expires_at, int(desktop_share.get("expires_at") or 0))
                if lease_expires_at <= now:
                    raise ServiceAccessError("bad_lease", "native desktop share expires before its grant")
                upstream_headers, health_url = {}, endpoint_path
            else:
                upstream_port, upstream_headers, health_url = self._open_upstream(service_id)
                upstream = {"scheme": "http", "host": "127.0.0.1", "port": upstream_port}
            worker = self._start_worker(actor_id, service_id, grant_id, revision, lease_expires_at,
                                        network_id, mesh_ip, upstream, upstream_headers, endpoint_path)
            worker.desktop_share = desktop_share
            with self._lock:
                self.workers[self.worker_id(actor_id, service_id, grant_id)] = worker
                worker.authority = dict(authority)
            self._health_check(worker, health_url)
            return self._descriptor(worker, operation_id=str(authority["operation_id"]))
        except Exception as error:
            with self._lock:
                key = self.worker_id(actor_id, service_id, grant_id)
                if self.workers.get(key) is worker:
                    self.workers.pop(key, None)
            if worker is not None:
                self._stop_worker(worker)
            if desktop_share is not None:
                try:
                    self.remote_desktop.close(authority)
                except Exception as close_error:
                    raise ServiceAccessError("desktop_share_cleanup_pending",
                                             "native desktop share cleanup is pending") from close_error
            if isinstance(error, ServiceAccessError):
                raise
            raise ServiceAccessError("service_open_failed", "native service could not be opened") from error
        finally:
            with self._lock:
                if claimed:
                    self._starting_grants.discard(claim)

    def _network_ip(self, network_id: str) -> str:
        try:
            mesh_ip = str(self.network_address(network_id)) if self.network_address is not None else ""
        except Exception as exc:
            raise ServiceAccessError(getattr(exc, "code", "network_not_connected"),
                                     "target is not connected to the selected EasyTier network") from exc
        if not mesh_ip:
            raise ServiceAccessError("network_not_connected", "target has no address on the selected EasyTier network")
        return mesh_ip

    def _desktop_upstream(self, local: dict[str, Any], share: dict[str, Any]) -> tuple[dict[str, Any], str]:
        if (not isinstance(local, dict) or local.get("scheme") != "https" or
                local.get("host") != "127.0.0.1" or type(local.get("port")) is not int or
                not 1 <= local["port"] <= 65535 or local.get("tls_server_name") != "localhost."):
            raise ServiceAccessError("desktop_upstream_invalid", "MeshCentral upstream is not a valid loopback TLS endpoint")
        certificate = Path(str(local.get("trust_certificate_path") or "")).resolve()
        private_root = Path(self.remote_desktop.root).resolve()
        try:
            certificate.relative_to(private_root)
        except ValueError as exc:
            raise ServiceAccessError("desktop_upstream_invalid", "MeshCentral trust certificate is outside its private data directory") from exc
        if not certificate.is_file():
            raise ServiceAccessError("desktop_upstream_invalid", "MeshCentral upstream trust certificate is unavailable")
        guest_path = str(share.get("guest_path") or "")
        parsed = urllib.parse.urlsplit(guest_path)
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        if (parsed.scheme or parsed.netloc or parsed.path not in {"/sharing", "/default/sharing"} or
                not query.get("c") or parsed.fragment):
            raise ServiceAccessError("desktop_guest_path_invalid", "MeshCentral returned an invalid native guest path")
        return ({"scheme": "https", "host": "127.0.0.1", "port": local["port"],
                 "tls_server_name": "localhost.", "trust_certificate_path": str(certificate)}, guest_path)

    def renew(self, authority: dict[str, Any], lease_expires_at: int) -> dict[str, Any]:
        self._validate_authority(authority)
        lease_expires_at = int(lease_expires_at)
        now = int(time.time())
        if lease_expires_at <= now or lease_expires_at > now + MAX_LEASE_SECONDS:
            raise ServiceAccessError("bad_lease", "service lease must expire within one hour")
        with self._lock:
            worker = self._worker_for(str(authority["actor_id"]), str(authority["service_id"]),
                                      str(authority["grant_id"]))
            if (not worker or
                    worker.revision != str(authority["authorization_revision"])
                    or not self._worker_alive(worker)):
                raise ServiceAccessError("grant_missing", "service grant worker is not active")
            if worker.network_id != str(authority["network_id"]):
                raise ServiceAccessError("network_changed", "service grant is bound to another EasyTier network")
            if worker.service_id == "desktop":
                try:
                    if self.remote_desktop is None:
                        raise ServiceAccessError(self.remote_desktop_error or "meshcentral_runtime_missing",
                                                 "native desktop runtime is unavailable")
                    duration = ((lease_expires_at - now) // 60) * 60
                    if duration < 60:
                        raise ServiceAccessError("bad_lease", "desktop grants require at least one full minute")
                    local = self.remote_desktop.local_upstream()
                    share = self.remote_desktop.renew(authority, duration_seconds=duration)
                except Exception as exc:
                    if isinstance(exc, ServiceAccessError):
                        raise
                    raise ServiceAccessError(getattr(exc, "code", "grant_missing"),
                                             "native desktop share could not be renewed") from exc
                _upstream, endpoint_path = self._desktop_upstream(local, share)
                worker.endpoint_path = endpoint_path
                worker.desktop_share = share
                lease_expires_at = min(lease_expires_at, int(share.get("expires_at") or 0))
                self._new_bootstrap_ticket(worker)
            worker.lease_expires_at = lease_expires_at
            worker.authority = dict(authority)
            if worker.service_id == "desktop":
                return self._descriptor(worker, operation_id=str(authority["operation_id"]))
            return {"grant_id": worker.grant_id, "authorization_revision": worker.revision,
                    "lease_expires_at": lease_expires_at, "state": "ready"}

    def revoke(self, authority: dict[str, Any], reason: str = "") -> dict[str, Any]:
        self._validate_authority(authority)
        actor_id, service_id = str(authority["actor_id"]), str(authority["service_id"])
        grant_id = str(authority["grant_id"])
        with self._lock:
            worker = self._worker_for(actor_id, service_id, grant_id)
        if worker:
            with worker.publish_lock:
                with self._lock:
                    self.tombstones[grant_id] = int(time.time())
                    self._save_tombstones()
                    key = self.worker_id(actor_id, service_id, grant_id)
                    if self.workers.get(key) is worker:
                        self.workers.pop(key, None)
                self._stop_worker(worker)
                stopped = worker.process.poll() is not None
        else:
            with self._lock:
                self.tombstones[grant_id] = int(time.time())
                self._save_tombstones()
            stopped = self._stop_worker_record(
                self.data_dir / "workers" / self.worker_id(actor_id, service_id, grant_id))
        if not stopped:
            raise ServiceAccessError("revoke_pending", "service worker could not yet be confirmed stopped")
        if service_id == "desktop":
            if self.remote_desktop is None:
                raise ServiceAccessError(self.remote_desktop_error or "meshcentral_runtime_missing",
                                         "native desktop revocation cannot be confirmed")
            try:
                self.remote_desktop.close(authority)
            except Exception as exc:
                raise ServiceAccessError(getattr(exc, "code", "revoke_pending"),
                                         "native desktop share has not confirmed revocation") from exc
        return {"grant_id": grant_id, "authorization_revision": authority["authorization_revision"],
                "state": "revoked", "connections_closed": True}

    def _validate_authority(self, authority: dict[str, Any]) -> None:
        required = ("actor_id", "target_id", "service_id", "grant_id", "operation_id",
                    "authorization_revision", "network_id")
        if (not isinstance(authority, dict) or authority.get("kind") != "hub_service" or
                any(not authority.get(name) for name in required) or authority.get("target_id") != self.target_id):
            raise ServiceAccessError("trusted_hub_required", "invalid Hub service authority")
        revision = authority.get("authorization_revision")
        if isinstance(revision, bool) or not isinstance(revision, (str, int)) or not str(revision).strip():
            raise ServiceAccessError("trusted_hub_required", "invalid service authorization revision")
        if authority.get("service_id") not in SERVICE_IDS:
            raise ServiceAccessError("service_unavailable", "requested native service is unavailable")
        if authority.get("service_id") == "files":
            has_read, has_write = "read_roots" in authority, "write_roots" in authority
            if has_read != has_write:
                raise ServiceAccessError("shared_scope_denied", "files grant roots are incomplete")
            if has_read and (not isinstance(authority.get("read_roots"), list) or
                             not isinstance(authority.get("write_roots"), list)):
                raise ServiceAccessError("shared_scope_denied", "files grant roots are invalid")
        elif "read_roots" in authority or "write_roots" in authority:
            raise ServiceAccessError("trusted_hub_required", "file roots cannot authorize another service")
        issued_at, expires_at = int(authority.get("issued_at") or 0), int(authority.get("expires_at") or 0)
        if issued_at > int(time.time()) + 5 or expires_at <= int(time.time()) or expires_at > issued_at + 60:
            raise ServiceAccessError("authorization_expired", "Hub service command expired")

    def _worker_for(self, actor_id: str, service_id: str, grant_id: str) -> _Worker | None:
        return self.workers.get(self.worker_id(actor_id, service_id, grant_id))

    def has_active_workers(self) -> bool:
        now = time.time()
        with self._lock:
            return any(worker.lease_expires_at > now and self._worker_alive(worker)
                       for worker in self.workers.values())

    def assert_active_worker(self, worker: _Worker) -> None:
        with self._lock:
            current = self.workers.get(self.worker_id(worker.actor_id, worker.service_id, worker.grant_id))
            if (current is not worker or worker.grant_id in self.tombstones or
                    worker.lease_expires_at <= time.time()
                    or worker.revision != str(worker.authority.get("authorization_revision", "")) or
                    not self._worker_alive(worker)):
                raise ServiceAccessError("grant_revoked", "file service grant is no longer active")

    @contextmanager
    def publish_guard(self, worker: _Worker):
        with worker.publish_lock:
            self.assert_active_worker(worker)
            yield

    def authenticated_files_worker(self, headers: Any, forwarded_host: str, method: str) -> _Worker | None:
        worker = self._authenticated_worker(headers, forwarded_host, request_method=method)
        return worker if worker is not None and worker.service_id == "files" else None

    def _dsh_status(self) -> dict[str, Any]:
        surface = self.native_surface
        if surface is None or not surface._load():
            managed = self.dsh_web.status() if self.dsh_web is not None else {}
            if managed.get("installing"):
                return {"ready": False, "state": "starting", "reason": "service_starting"}
            if managed.get("installed"):
                if managed.get("error_code"):
                    return {"ready": False, "state": "failed", "reason": managed["error_code"]}
                return {"ready": False, "state": "stopped", "reason": "dsh_stopped"}
            return {"ready": False, "state": "missing",
                    "reason": managed.get("error_code") or "dsh_missing"}
        try:
            surface._ensure_authenticated()
            cookie = surface._cookie_header()
            request = urllib.request.Request(surface._origin + "/", headers={"Cookie": cookie})
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    if 200 <= response.status < 400:
                        return {"ready": True, "port": urllib.parse.urlsplit(surface._origin).port,
                                "headers": {"Cookie": cookie}}
            except urllib.error.HTTPError as exc:
                if 300 <= exc.code < 400:
                    return {"ready": True, "port": urllib.parse.urlsplit(surface._origin).port,
                            "headers": {"Cookie": cookie}}
        except Exception:
            pass
        return {"ready": False, "state": "failed", "reason": "dsh_health_failed"}

    def _codeg_status(self) -> dict[str, Any]:
        runtime = self.agents_runtime
        if runtime is None:
            return {"ready": False, "reason": "codeg_missing"}
        try:
            status = runtime.status()
            if not status.get("running"):
                return {"ready": False, "reason": "codeg_stopped"}
            port, token = int(status.get("port") or 0), str(status.get("token") or "")
            if not port or not token or not runtime._authenticated_ready(port, token):
                return {"ready": False, "reason": "codeg_health_failed"}
            return {"ready": True, "port": port, "headers": {"Authorization": "Bearer " + token}}
        except Exception:
            return {"ready": False, "reason": "codeg_health_failed"}

    def _open_upstream(self, service_id: str) -> tuple[int, dict[str, str], str]:
        if service_id == "dsh":
            status = self._dsh_status()
            if not status.get("ready") and self.dsh_web is not None:
                managed = self.dsh_web.status()
                if managed.get("installing"):
                    raise ServiceAccessError("service_starting", "DeepSeek Harness Web is still starting")
                if managed.get("installed") and not managed.get("running"):
                    started = self.dsh_web.start()
                    if started.get("error_code"):
                        raise ServiceAccessError(str(started["error_code"]),
                                                 str(started.get("error") or "DeepSeek Harness Web could not start"))
                    if started.get("installing"):
                        raise ServiceAccessError("service_starting", "DeepSeek Harness Web is starting")
                    status = self._dsh_status()
        elif service_id == "files":
            if self.files_http is None:
                raise ServiceAccessError("files_runtime_missing", "private files API is unavailable")
            try:
                return self.files_http.start(), {}, "/"
            except Exception as exc:
                raise ServiceAccessError(getattr(exc, "code", "files_server_start_failed"),
                                         "private files API could not start") from exc
        else:
            if service_id == "codeg":
                status = self._codeg_status()
                if not status.get("ready") and self.agents_runtime is not None:
                    try:
                        self.agents_runtime.start("codex")
                    except Exception:
                        pass
                    status = self._codeg_status()
            else:
                status = self._codeg_status()
        if not status.get("ready"):
            raise ServiceAccessError(str(status.get("reason") or "service_missing"), "native service is not healthy")
        return int(status["port"]), status.get("headers", {}), "/"

    def _ensure_manager(self) -> None:
        with self._lock:
            if self._httpd is not None:
                return
            access = self

            class Handler(BaseHTTPRequestHandler):
                protocol_version = "HTTP/1.1"

                def log_message(self, *_args):
                    return

                def _reply(self, status: int, body: bytes = b"", headers: dict[str, str] | None = None) -> None:
                    self.send_response(status)
                    for key, value in (headers or {}).items():
                        self.send_header(key, value)
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    if body:
                        self.wfile.write(body)

                def _json(self) -> dict[str, Any]:
                    try:
                        length = int(self.headers.get("Content-Length") or 0)
                        if length < 1 or length > 8192:
                            return {}
                        value = json.loads(self.rfile.read(length))
                        return value if isinstance(value, dict) else {}
                    except (ValueError, OSError):
                        return {}

                def do_POST(self):
                    path = urllib.parse.urlsplit(self.path).path
                    if path == "/__tether/bootstrap":
                        if self.headers.get("Origin"):
                            self._reply(403)
                            return
                        data = self._json()
                        result = access._bootstrap(str(data.get("ticket") or ""), self.headers.get("X-Forwarded-Host", ""))
                        if not result:
                            self._reply(401)
                            return
                        name, value, age = result
                        self._reply(204, headers={"Set-Cookie": f"{name}={value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={age}",
                                                  "Cache-Control": "no-store"})
                        return
                    if path == "/__tether/view":
                        worker = access._authenticated_worker(self.headers, self.headers.get("X-Forwarded-Host", ""),
                                                              require_worker_secret=False, require_origin=True)
                        if not worker:
                            self._reply(401)
                            return
                        worker.last_view_at = time.time()
                        self._reply(204, headers={"Cache-Control": "no-store"})
                        return
                    self._reply(404)

                def do_GET(self):
                    if urllib.parse.urlsplit(self.path).path != "/internal/service/authorize":
                        self._reply(404)
                        return
                    forwarded_host = self.headers.get("X-Forwarded-Host", "")
                    worker = access._authenticated_worker(
                        self.headers, forwarded_host,
                        request_method=self.headers.get("X-Forwarded-Method", "GET"))
                    if not worker:
                        self._reply(401)
                        return
                    upstream = access._upstream_headers(worker)
                    if upstream is None:
                        self._reply(503)
                        return
                    self._reply(200, headers={"X-Tether-Upstream-Cookie": upstream.get("Cookie", ""),
                                              "X-Tether-Upstream-Authorization": upstream.get("Authorization", ""),
                                              "Cache-Control": "no-store"})

            self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            self._httpd.daemon_threads = True
            port = int(self._httpd.server_address[1])
            self._http_thread = threading.Thread(target=self._httpd.serve_forever, daemon=True,
                                                 name="service-access-loopback")
            self._http_thread.start()
            self._manager_port = port

    @staticmethod
    def _upstream_headers(worker: _Worker) -> dict[str, str] | None:
        if not getattr(worker, "upstream_ready", False):
            return None
        return dict(getattr(worker, "upstream_headers", {}))

    def _refresh_worker_upstream(self, worker: _Worker) -> None:
        if worker.service_id == "desktop":
            try:
                status = self.remote_desktop.view(worker.authority) if self.remote_desktop is not None else {}
                ready = status.get("state") == "ready"
                headers = {}
            except Exception:
                ready, headers = False, {}
        elif worker.service_id == "files":
            status = self.files_http.status() if self.files_http is not None else {}
            ready, headers = status.get("state") == "ready", {}
        else:
            status = self._dsh_status() if worker.service_id == "dsh" else self._codeg_status()
            ready = bool(status.get("ready"))
            headers = status.get("headers", {}) if ready else {}
        with self._lock:
            if self.workers.get(self.worker_id(worker.actor_id, worker.service_id, worker.grant_id)) is not worker:
                return
            worker.upstream_checked_at = time.time()
            worker.upstream_ready = ready
            worker.upstream_headers = headers

    @staticmethod
    def _cookie_name(grant_id: str) -> str:
        safe = "".join(c for c in grant_id if c.isalnum() or c in "_- ").replace(" ", "")[:64]
        if not safe:
            safe = hashlib.sha256(grant_id.encode()).hexdigest()[:24]
        return "__Host-tether_" + safe

    def _authenticated_worker(self, headers, forwarded_host: str, *, require_worker_secret: bool = True,
                              require_origin: bool = False, request_method: str | None = None) -> _Worker | None:
        worker_secret = headers.get("X-Tether-Worker", "")
        origin = headers.get("Origin", "")
        with self._lock:
            if require_worker_secret:
                worker = next((item for item in self.workers.values()
                               if secrets.compare_digest(item.worker_secret, worker_secret)), None)
            else:
                worker = next((item for item in self.workers.values()
                               if forwarded_host.lower() == f"{item.mesh_ip}:{item.port}".lower()), None)
            if not worker or not self._worker_alive(worker) or worker.lease_expires_at <= time.time():
                return None
            if require_worker_secret and not secrets.compare_digest(worker.worker_secret, worker_secret):
                return None
            if forwarded_host and forwarded_host.lower() != f"{worker.mesh_ip}:{worker.port}".lower():
                return None
            method = (request_method or headers.get("X-Forwarded-Method", "GET")).upper()
            websocket = headers.get("Upgrade", "").lower() == "websocket"
            if (origin and origin.rstrip("/") != worker.origin) or (require_origin and origin.rstrip("/") != worker.origin):
                return None
            if (method not in {"GET", "HEAD", "OPTIONS"} or websocket) and (
                    origin.rstrip("/") != worker.origin or
                    (headers.get("Sec-Fetch-Site") and headers.get("Sec-Fetch-Site") not in {"same-origin", "none"})):
                return None
            expected_cookie = self._cookie_name(worker.grant_id)
            cookies = {}
            get_all = getattr(headers, "get_all", None)
            cookie_headers = get_all("Cookie") if callable(get_all) else headers.getlist("cookie")
            for value in cookie_headers or []:
                for part in value.split(";"):
                    name, sep, token = part.strip().partition("=")
                    if sep:
                        cookies[name] = token
            token = cookies.get(expected_cookie, "")
            token_hash = hashlib.sha256(token.encode()).hexdigest() if token else ""
            cookie_hashes = getattr(worker, "cookie_hashes", {})
            if not token_hash or cookie_hashes.get(token_hash, 0) <= time.time():
                return None
            return worker

    def _bootstrap(self, ticket: str, forwarded_host: str) -> tuple[str, str, int] | None:
        ticket_hash = hashlib.sha256(ticket.encode()).hexdigest() if ticket else ""
        with self._lock:
            for worker in self.workers.values():
                expires = worker.bootstrap_hashes.get(ticket_hash, 0)
                if (expires and expires >= time.time() and self._worker_alive(worker) and
                        forwarded_host.lower() == f"{worker.mesh_ip}:{worker.port}".lower()):
                    worker.bootstrap_hashes.pop(ticket_hash, None)
                    value = secrets.token_urlsafe(32)
                    age = 86400
                    worker.cookie_hashes[hashlib.sha256(value.encode()).hexdigest()] = time.time() + age
                    return self._cookie_name(worker.grant_id), value, age
        return None

    @staticmethod
    def _new_bootstrap_ticket(worker: _Worker) -> None:
        worker.bootstrap_ticket = secrets.token_urlsafe(32)
        worker.bootstrap_hashes[hashlib.sha256(worker.bootstrap_ticket.encode()).hexdigest()] = time.time() + BOOTSTRAP_SECONDS

    def _start_worker(self, actor_id: str, service_id: str, grant_id: str, revision: str,
                      lease_expires_at: int, network_id: str, mesh_ip: str, upstream: dict[str, Any],
                      upstream_headers: dict[str, str], endpoint_path: str) -> _Worker:
        port = self._free_port(mesh_ip)
        config_dir = self.data_dir / "workers" / self.worker_id(actor_id, service_id, grant_id)
        config_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(config_dir, 0o700)
        except OSError:
            pass
        self.ca_storage.mkdir(parents=True, exist_ok=True)
        worker_secret = secrets.token_urlsafe(32)
        manager_port = int(getattr(self, "_manager_port", 0))
        config_path = config_dir / "Caddyfile"
        config = self._render_caddyfile(mesh_ip, port, upstream, manager_port,
                                       worker_secret, self.ca_storage, service_id=service_id)
        config_path.write_text(config, encoding="utf-8")
        try:
            os.chmod(config_path, 0o600)
        except OSError:
            pass
        env = {**os.environ, "CADDY_SKIP_INSTALL_TRUST": "1"}
        process = subprocess.Popen([self.caddy, "run", "--config", str(config_path), "--adapter", "caddyfile"],
                                   cwd=str(config_dir), env=env, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            import psutil
            process_metadata = {"pid": process.pid, "create_time": psutil.Process(process.pid).create_time(),
                                "executable": str(Path(self.caddy).resolve())}
            (config_dir / "worker-process.json").write_text(json.dumps(process_metadata), encoding="utf-8")
        except Exception:
            process.terminate()
            raise ServiceAccessError("caddy_identity_failed", "cannot safely track the Caddy worker process")
        worker = _Worker(actor_id=actor_id, target_id=self.target_id, service_id=service_id,
                         grant_id=grant_id, revision=revision, network_id=network_id,
                         lease_expires_at=lease_expires_at,
                         mesh_ip=mesh_ip, port=port, native_port=int(upstream.get("port") or 0), manager_port=manager_port,
                         worker_secret=worker_secret, config_path=config_path, process=process)
        worker.cookie_hashes = {}
        worker.bootstrap_hashes = {}
        worker.endpoint_path = endpoint_path
        worker.authority = {}
        # The secret is scoped to this worker and never exposed in descriptors or logs.
        worker.worker_secret = worker_secret
        worker.upstream_headers = upstream_headers
        worker.upstream_checked_at = time.time()
        worker.upstream_ready = True
        worker.health_url = "/"
        self._new_bootstrap_ticket(worker)
        return worker

    @staticmethod
    def _render_caddyfile(mesh_ip: str, worker_port: int, upstream: dict[str, Any], manager_port: int,
                          worker_secret: str, ca_storage: Path, *, service_id: str = "") -> str:
        quoted_storage = json.dumps(str(ca_storage).replace("\\", "/"), ensure_ascii=False)
        upstream_address = f"{upstream['scheme']}://{upstream['host']}:{int(upstream['port'])}"
        transport = ""
        if upstream["scheme"] == "https":
            quoted_cert = json.dumps(str(upstream["trust_certificate_path"]).replace("\\", "/"), ensure_ascii=False)
            server_name = str(upstream["tls_server_name"])
            transport = ("\n   transport http {\n    tls_trust_pool file " + quoted_cert +
                         "\n    tls_server_name " + server_name + "\n   }")
        header_injection = ""
        strip_worker = "   header_up -X-Tether-Worker\n"
        if service_id == "files":
            header_injection = f"   header_up X-Tether-Worker {worker_secret}\n"
            strip_worker = ""
        elif service_id != "desktop":
            header_injection = ("   header_up Cookie {http.request.header.X-Tether-Upstream-Cookie}\n"
                                "   header_up Authorization {http.request.header.X-Tether-Upstream-Authorization}\n")
        strip_set_cookie = "" if service_id == "desktop" else "   header_down -Set-Cookie\n"
        upstream_host = ("{http.request.hostport}" if service_id == "files"
                         else "{http.request.host}")
        return ("{\n admin off\n auto_https disable_redirects\n skip_install_trust\n storage file_system {\n"
                f"  root {quoted_storage}\n }}\n}}\n"
                f"https://{mesh_ip}:{worker_port} {{\n bind {mesh_ip}\n tls internal\n"
                f" route /__tether/bootstrap {{\n  reverse_proxy 127.0.0.1:{manager_port}\n }}\n"
                f" route /__tether/view {{\n  reverse_proxy 127.0.0.1:{manager_port}\n }}\n"
                " route {\n"
                f"  forward_auth 127.0.0.1:{manager_port} {{\n   uri /internal/service/authorize\n"
                f"   header_up X-Tether-Worker {worker_secret}\n"
                "   header_up X-Forwarded-Method {http.request.method}\n"
                "   copy_headers X-Tether-Upstream-Cookie X-Tether-Upstream-Authorization\n  }\n"
                f"  reverse_proxy {upstream_address} {{{transport}\n"
                f"{header_injection}"
                f"{strip_worker}   header_up -X-Tether-Upstream-Cookie\n"
                "   header_up -X-Tether-Upstream-Authorization\n   header_up -X-Forwarded-User\n"
                "   header_up -X-Auth-Request-User\n   header_up -X-Auth-Request-Email\n"
                f"   header_up Host {upstream_host}\n" + strip_set_cookie + "  }\n"
                " }\n}\n")

    def _descriptor(self, worker: _Worker, operation_id: str) -> dict[str, Any]:
        root_ca = self.ca_storage / "pki" / "authorities" / "local" / "root.crt"
        deadline = time.monotonic() + 10
        while not root_ca.is_file() and time.monotonic() < deadline and self._worker_alive(worker):
            time.sleep(0.1)
        if not root_ca.is_file():
            raise ServiceAccessError("caddy_ca_missing", "Caddy internal CA root certificate is unavailable")
        pem = root_ca.read_text(encoding="ascii")
        digest = hashlib.sha256(root_ca.read_bytes()).hexdigest()
        descriptor = {"protocol": 1, "target_id": self.target_id, "id": worker.service_id, "state": "ready",
                "transport": "caddy-easytier", "endpoint": worker.origin + getattr(worker, "endpoint_path", "/"), "grant_id": worker.grant_id,
                "authorization_revision": worker.revision, "lease_expires_at": worker.lease_expires_at,
                "network_id": worker.network_id, "operation_id": operation_id,
                "bootstrap": {"method": "POST", "url": worker.origin + "/__tether/bootstrap",
                              "ticket": worker.bootstrap_ticket, "expires_at": int(time.time()) + BOOTSTRAP_SECONDS},
                "tls": {"epoch": digest[:16], "root_ca_pem": pem, "root_ca_sha256": digest}}
        share = getattr(worker, "desktop_share", None)
        if worker.service_id == "desktop" and isinstance(share, dict):
            descriptor.update({"consent": share.get("consent", "prompt"),
                               "view_only": bool(share.get("view_only")),
                               "view_only_reason": share.get("view_only_reason", "")})
        return descriptor

    def _health_check(self, worker: _Worker, _url: str) -> None:
        deadline = time.monotonic() + 20
        root_ca = self.ca_storage / "pki" / "authorities" / "local" / "root.crt"
        unverified = ssl._create_unverified_context()
        while time.monotonic() < deadline and self._worker_alive(worker):
            try:
                request = urllib.request.Request(worker.origin + "/", headers={"X-Tether-Worker": worker.worker_secret})
                try:
                    with urllib.request.urlopen(request, timeout=1, context=unverified) as response:
                        if response.status == 401:
                            break
                except urllib.error.HTTPError as exc:
                    if exc.code == 401:
                        break
            except Exception:
                time.sleep(0.25)
        else:
            raise ServiceAccessError("caddy_health_failed", "Caddy worker did not become ready")
        if not root_ca.is_file():
            raise ServiceAccessError("caddy_ca_missing", "Caddy did not persist its internal root CA")
        context = ssl.create_default_context(cafile=str(root_ca))
        try:
            request = urllib.request.Request(worker.origin + "/", headers={"X-Tether-Worker": worker.worker_secret})
            try:
                urllib.request.urlopen(request, timeout=2, context=context).close()
            except urllib.error.HTTPError as exc:
                if exc.code != 401:
                    raise
        except Exception as exc:
            raise ServiceAccessError("caddy_tls_failed", "Caddy listener failed trusted internal TLS verification") from exc

    def _free_port(self, mesh_ip: str) -> int:
        import socket
        with socket.socket() as sock:
            sock.bind((mesh_ip, 0))
            return int(sock.getsockname()[1])

    @staticmethod
    def _worker_alive(worker: _Worker) -> bool:
        return worker.process.poll() is None

    def _stop_worker(self, worker: _Worker) -> None:
        if worker.process.poll() is None:
            try:
                worker.process.terminate()
                worker.process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    worker.process.kill()
                    worker.process.wait(timeout=2)
                except (OSError, subprocess.TimeoutExpired):
                    pass
        if worker.process.poll() is not None:
            try:
                (worker.config_path.parent / "worker-process.json").unlink(missing_ok=True)
            except OSError:
                pass

    @staticmethod
    def _stop_worker_record(config_dir: Path) -> bool:
        manifest = config_dir / "worker-process.json"
        if not manifest.exists():
            return True
        try:
            import psutil
            record = json.loads(manifest.read_text(encoding="utf-8"))
            process = psutil.Process(int(record["pid"]))
            if (abs(process.create_time() - float(record["create_time"])) >= 0.01 or
                    str(Path(process.exe()).resolve()).lower() != str(Path(record["executable"]).resolve()).lower()):
                return False
            process.terminate()
            try:
                process.wait(timeout=2)
            except psutil.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
            manifest.unlink(missing_ok=True)
            return True
        except psutil.NoSuchProcess:
            manifest.unlink(missing_ok=True)
            return True
        except (OSError, ValueError, KeyError, psutil.Error):
            return False

    def _cleanup_orphan_workers(self) -> None:
        try:
            import psutil
        except ImportError:
            return
        for manifest in (self.data_dir / "workers").glob("*/worker-process.json"):
            try:
                record = json.loads(manifest.read_text(encoding="utf-8"))
                process = psutil.Process(int(record["pid"]))
                if (abs(process.create_time() - float(record["create_time"])) < 0.01 and
                        str(Path(process.exe()).resolve()).lower() == str(Path(record["executable"]).resolve()).lower()):
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except psutil.TimeoutExpired:
                        process.kill()
                manifest.unlink(missing_ok=True)
            except (OSError, ValueError, KeyError, psutil.Error):
                continue

    def _sweep(self) -> None:
        while True:
            time.sleep(1)
            now = time.time()
            expired: list[_Worker] = []
            refresh: list[_Worker] = []
            with self._lock:
                for key, worker in list(self.workers.items()):
                    for ticket_hash, expires in list(worker.bootstrap_hashes.items()):
                        if expires < now:
                            worker.bootstrap_hashes.pop(ticket_hash, None)
                    if worker.lease_expires_at <= now or now - worker.last_view_at > VIEW_TTL_SECONDS:
                        self.workers.pop(key, None)
                        expired.append(worker)
                    elif now - getattr(worker, "upstream_checked_at", 0) >= 30:
                        refresh.append(worker)
            for worker in expired:
                self._stop_worker(worker)
                if worker.service_id == "desktop" and self.remote_desktop is not None:
                    try:
                        self.remote_desktop.close(worker.authority)
                    except Exception as exc:
                        LOGGER.warning("desktop share cleanup remains pending (%s)",
                                       getattr(exc, "code", type(exc).__name__))
            for worker in refresh:
                self._refresh_worker_upstream(worker)

    def _load_tombstones(self) -> None:
        try:
            raw = json.loads((self.data_dir / "tombstones.json").read_text(encoding="utf-8"))
            self.tombstones = {str(key): int(value) for key, value in raw.items()}
        except (OSError, ValueError, TypeError):
            self.tombstones = {}

    def _save_tombstones(self) -> None:
        path = self.data_dir / "tombstones.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.tombstones, separators=(",", ":")), encoding="utf-8")
        try:
            os.chmod(temp, 0o600)
        except OSError:
            pass
        os.replace(temp, path)
