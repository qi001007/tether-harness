"""Durable, target-owned transfer jobs executed by the official rclone CLI."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import ntpath
import os
import posixpath
import re
import shutil
import secrets
import socket
import stat
import sqlite3
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable, Generator
from contextlib import ExitStack, closing, contextmanager
from contextvars import copy_context
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from pathlib import PureWindowsPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .route_selection import rank_routes
from .sftp_relay_client import local_sftp_relay
from .sftp_service_port import SHARED_PORT_VERSION, SFTP_SERVICE_PORT


ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
TERMINAL = {"completed", "cancelled", "failed", "interrupted"}
RECEIVE_PROBE_BYTES = 128 * 1024
RECEIVE_PROBE_SECONDS = 8
RECEIVE_PROBE_SETTLE_SECONDS = 1
RECEIVE_RELAYS_PER_BATCH = 2
RECEIVE_SLOW_WINDOW_SECONDS = 15
RECEIVE_SLOW_BYTES_PER_SECOND = 5_000_000
RECEIVE_SLOW_MIN_SECONDS_LEFT = 40
# Parallel ranges beat a single SFTP stream on lossy/high-latency paths:
# 24 MiB measured 0.53 MB/s single-stream against 1.85 MB/s over four ranges.
RECEIVE_MULTI_MIN_BYTES = 8 * 1024**2
RECEIVE_SLOW_MIN_REMAINING = 8 * 1024**2
RECEIVE_RECHECK_BYTES = 4 * 1024**2
RECEIVE_RECHECK_SECONDS = 3
RECEIVE_START_OBSERVATION_SECONDS = 2
RELAY_ADAPTER_HOST = "127.0.0.1"
RELAY_ADAPTER_PORT = 52131
MANAGED_RELAY_PORT = 20223
_INSTANCES: dict[str, "RcloneJobs"] = {}


SftpRelay = tuple[str, int, int, str | None]


@dataclass(frozen=True)
class ReceiveRecheck:
    offset: int
    count: int
    progress: Callable[[], tuple[int, int]]


@dataclass(frozen=True)
class ReceiveRoute:
    config: Path
    expires_at: int | None = None

    @property
    def rclone_options(self) -> tuple[str, ...]:
        return ("--sftp-socks-proxy=",) if self.expires_at is not None else ()


ReceiveRouteOrder = Callable[[list[ReceiveRoute]], list[ReceiveRoute]]
ReceiveRoutePlan = Generator[tuple[ReceiveRoute, bool], ReceiveRecheck | None, None]


def _file_fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _tree_fingerprint(path: Path) -> tuple[str, int, int]:
    digest = hashlib.sha256()
    files = 0
    total = 0
    for entry in sorted(path.rglob("*"), key=lambda item: item.relative_to(path).as_posix().casefold()):
        if entry.is_symlink():
            raise TransferJobError("bad_path", "directory fingerprints do not follow symbolic links")
        relative = entry.relative_to(path).as_posix()
        if entry.is_dir():
            digest.update(b"D\0" + relative.encode("utf-8", errors="surrogatepass") + b"\0")
            continue
        if not entry.is_file():
            raise TransferJobError("unsupported_entry", "directory contains a non-regular filesystem entry")
        size = entry.stat().st_size
        content_hash = _file_fingerprint(entry)
        digest.update(b"F\0" + relative.encode("utf-8", errors="surrogatepass") + b"\0" +
                      str(size).encode("ascii") + b"\0" + content_hash.encode("ascii") + b"\0")
        files += 1
        total += size
    return "tree-sha256:" + digest.hexdigest(), files, total


def _destination_version(path: Path) -> str:
    if path.is_dir():
        return _tree_fingerprint(path)[0]
    if path.is_file():
        return _file_fingerprint(path)
    return ""


def _inside(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def _safe_relative(value: str) -> str:
    path = value.replace("\\", "/")
    windows = PureWindowsPath(value)
    if (not path or path.startswith("/") or path.startswith("//") or windows.is_absolute() or windows.drive or
            any(part in ("", ".", "..") or ":" in part for part in path.split("/"))):
        raise TransferJobError("bad_path", "item path must be a normalized relative POSIX path")
    return path


def _rclone_include_rule(value: str) -> str:
    """Return an anchored rclone glob matching one literal relative path."""
    escaped = "".join("\\" + char if char in "*?\\[{}]" else char for char in value)
    return "/" + escaped


def _authorized_sftp_relay(authority: dict[str, Any], endpoint: dict[str, Any]) -> tuple[str, int, int] | None:
    relay = authority.get("sftp_relay")
    if not isinstance(relay, dict) or endpoint.get("port") != 20222:
        return None
    if (not all(relay.get(key) and relay[key] == authority.get(key)
                for key in ("network_id", "source_device_id", "executor_device_id")) or
            relay.get("source_host") != endpoint.get("host")):
        return None
    port, expires_at = relay.get("port"), relay.get("expires_at")
    if (type(port) is not int or not 1 <= port <= 65535 or
            type(expires_at) is not int or expires_at <= time.time()):
        return None
    try:
        host = ipaddress.IPv4Address(relay.get("host"))
    except (ipaddress.AddressValueError, TypeError):
        return None
    if (not isinstance(relay.get("host"), str) or not host.is_private or host.is_loopback or
            host.is_link_local or host.is_unspecified or host.is_reserved or str(host) == endpoint["host"]):
        return None
    return str(host), port, expires_at


def _managed_sftp_relay(authority: dict[str, Any], endpoint: dict[str, Any]) -> tuple[str, int, int, str] | None:
    offer = authority.get("sftp_relay")
    if not isinstance(offer, dict) or offer.get("adapter") != "mtls_sftp":
        return None
    route = _authorized_sftp_relay(authority, endpoint)
    cert = offer.get("server_cert_pem")
    version = offer.get("relay_shared_port_version")
    port = (MANAGED_RELAY_PORT if version is None else
            SFTP_SERVICE_PORT if type(version) is int and version == SHARED_PORT_VERSION else None)
    if route and route[1] == port and isinstance(cert, str) and 0 < len(cert) <= 4096:
        return (*route, cert)
    return None


def _private_relay_binding(path: Path) -> bool:
    if os.name != "nt":
        return all(p.stat().st_uid == os.geteuid() and not p.stat().st_mode & 0o077
                   for p in (path, path.parent))
    # Review the effective leaf and parent ACL rather than trusting inherited permissions by name.
    check = """
    $ErrorActionPreference = 'Stop'
    $path = $env:TETHER_RELAY_BINDING_ACL_PATH
    $sidType = [Security.Principal.SecurityIdentifier]
    $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
    foreach ($acl in @([IO.File]::GetAccessControl($path),
                       [IO.Directory]::GetAccessControl([IO.Path]::GetDirectoryName($path)))) {
        $rules = @($acl.GetAccessRules($true, $true, $sidType))
        if ($acl.GetOwner($sidType).Value -notin $allowed -or $rules.Count -eq 0 -or
            @($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed }).Count) {
            exit 1
        }
    }
    exit 0
    """
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", check],
                            env={**os.environ, "TETHER_RELAY_BINDING_ACL_PATH": str(path)},
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=5)
    return result.returncode == 0


class TransferJobError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class RcloneJobs:
    """Runs one rclone task at a time and persists identity and final status."""

    shared_port_version = SHARED_PORT_VERSION
    def __new__(cls, data_dir: Path | str, **kwargs):
        key = str(Path(data_dir).resolve())
        instance = _INSTANCES.get(key)
        if instance is None:
            instance = super().__new__(cls)
            instance._instance_key = key
            _INSTANCES[key] = instance
        return instance

    def __init__(self, data_dir: Path | str, *, target_id: str, resolver, read_guard, write_guard,
                 binary: str | None = None) -> None:
        if getattr(self, "_initialized", False):
            return
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.target_id = str(target_id)
        self._resolve = resolver
        self._read_guard = read_guard
        self._write_guard = write_guard
        self.socks_proxy_resolver = None
        self._binary = binary or os.environ.get("TETHER_RCLONE") or shutil.which("rclone") or ""
        self._db_path = self.data_dir / "transfer-jobs.sqlite3"
        self._grant_dir = self.data_dir / "transfer-grants"
        self._grant_dir.mkdir(mode=0o700, exist_ok=True)
        from .mesh_runtime import MeshRuntimeError, secure_private_directory
        try:
            secure_private_directory(self._grant_dir)
        except MeshRuntimeError as exc:
            raise TransferJobError("private_storage_unavailable", "transfer credentials cannot be stored privately") from exc
        self._lock = threading.RLock()
        self._active: dict[str, subprocess.Popen[str]] = {}
        self._rc: dict[str, dict[str, Any]] = {}
        self._operation_lock = threading.RLock()
        self._owner_lock = self._take_owner_lock()
        self._init_db()
        with self._connect() as db:
            # The lock makes this process the sole owner for this data directory.
            # Reconcile unfinished jobs explicitly; do not turn them into errors
            # just because another FsService object was constructed in-process.
            rows = db.execute("SELECT operation_id,rc_job_id,rc_execute_id FROM jobs WHERE state IN ('queued','authorizing','running','verifying','cancelling')").fetchall()
            for row in rows:
                rc_file = self._grant_dir / row["operation_id"] / "rclone-rc.json"
                if row["rc_job_id"] and row["rc_execute_id"] and rc_file.exists():
                    try:
                        config = json.loads(rc_file.read_text(encoding="utf-8"))
                        self._rc[row["operation_id"]] = config
                        status = self._rc_call(row["operation_id"], "job/status", {"jobid": row["rc_job_id"]})
                        if status.get("executeId") == row["rc_execute_id"] and not status.get("finished"):
                            self._rc_call(row["operation_id"], "job/stop", {"jobid": row["rc_job_id"]})
                        try:
                            self._rc_call(row["operation_id"], "core/quit", {})
                        except TransferJobError:
                            pass
                    except (OSError, ValueError, TransferJobError):
                        pass
                    finally:
                        self._rc.pop(row["operation_id"], None)
                db.execute("UPDATE jobs SET state='interrupted', updated_at=?, error=? WHERE operation_id=?",
                           (time.time(), json.dumps({"code": "node_restarted", "message": "Node restarted; in-flight rclone work was reconciled and marked interrupted", "retryable": True}), row["operation_id"]))
        self._initialized = True

    def _take_owner_lock(self):
        lock_path = self.data_dir / "transfer-jobs.lock"
        handle = lock_path.open("a+b")
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
            raise TransferJobError("job_owner_exists", "another Node process owns this transfer job store") from exc
        return handle

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self._db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def _init_db(self) -> None:
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, payload TEXT NOT NULL,
                state TEXT NOT NULL, bytes_done INTEGER NOT NULL DEFAULT 0,
                bytes_total INTEGER NOT NULL DEFAULT 0, files_done INTEGER NOT NULL DEFAULT 0,
                files_total INTEGER NOT NULL DEFAULT 0, rate INTEGER NOT NULL DEFAULT 0,
                rc_job_id INTEGER, rc_execute_id TEXT,
                attempts INTEGER NOT NULL DEFAULT 1,
                error TEXT, updated_at REAL NOT NULL
            )""")
            columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
            for name, sql_type in (("rc_job_id", "INTEGER"), ("rc_execute_id", "TEXT"), ("attempts", "INTEGER NOT NULL DEFAULT 1")):
                if name not in columns:
                    db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {sql_type}")

    def _snapshot(self, row: sqlite3.Row) -> dict[str, Any]:
        error = json.loads(row["error"]) if row["error"] else None
        return {"protocol": 1, "target_id": self.target_id,
                "operation_id": row["operation_id"], "state": row["state"],
                "bytes_done": row["bytes_done"], "bytes_total": row["bytes_total"],
                "files_done": row["files_done"], "files_total": row["files_total"],
                "rate_bytes_per_second": row["rate"], "error": error,
                "updated_at": row["updated_at"]}

    def _get(self, operation_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE operation_id=?", (operation_id,)).fetchone()
        return self._snapshot(row) if row else None

    def start(self, args: dict[str, Any], *, retry: bool = False) -> dict[str, Any]:
        with self._operation_lock:
            return self._start_locked(args, retry=retry)

    def _start_locked(self, args: dict[str, Any], *, retry: bool = False) -> dict[str, Any]:
        operation_id = str(args.get("operation_id") or "")
        if not ID_RE.fullmatch(operation_id):
            raise TransferJobError("bad_operation_id", "operation_id is required and must be 1-128 safe characters")
        payload = {key: args.get(key) for key in ("source", "destination", "items", "mode", "conflict_policy")}
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        payload_hash = hashlib.sha256(payload_json.encode()).hexdigest()
        previous = self._get(operation_id)
        if previous:
            with self._connect() as db:
                stored = db.execute("SELECT payload_hash FROM jobs WHERE operation_id=?", (operation_id,)).fetchone()[0]
            if stored != payload_hash:
                raise TransferJobError("operation_conflict", "operation_id is already bound to different job parameters")
            if not retry:
                return previous
            if previous["state"] not in {"failed", "interrupted"}:
                raise TransferJobError("not_retryable", "only failed or interrupted jobs can be retried")

        source, destination = payload.get("source"), payload.get("destination")
        items, mode = payload.get("items"), payload.get("mode")
        if not isinstance(source, dict) or not isinstance(destination, dict) or not isinstance(items, list) or not items:
            raise TransferJobError("bad_args", "source, destination and at least one item are required")
        if mode not in ("copy", "move"):
            raise TransferJobError("bad_args", "mode must be copy or move")
        if str(destination.get("device_id") or "") != self.target_id:
            raise TransferJobError("wrong_target", "destination job must run on the destination device")
        grant = args.get("source_grant")
        if not isinstance(grant, dict) or grant.get("operation_id") != operation_id:
            raise TransferJobError("authorization_required", "a source-node grant for this operation is required")
        authority = args.get("_hub_authority")
        if (not isinstance(authority, dict) or authority.get("kind") != "hub_transfer" or
                authority.get("operation_id") != operation_id or
                authority.get("authorization_revision") != grant.get("authorization_revision") or
                authority.get("network_id") != grant.get("network_id") or
                authority.get("source_device_id") != source.get("device_id") or
                authority.get("executor_device_id") != self.target_id):
            raise TransferJobError("authorization_required", "source grant does not match the current Hub authority")
        if str(grant.get("source_device_id") or "") != str(source.get("device_id") or ""):
            raise TransferJobError("authorization_required", "source grant belongs to another source device")
        if mode == "move":
            fingerprints = grant.get("source_fingerprints", [])
            granted_paths = {str(entry.get("path") or "") for entry in fingerprints if isinstance(entry, dict)}
            selected_paths = {str(item.get("path") or "") for item in items if isinstance(item, dict)}
            if granted_paths != selected_paths:
                raise TransferJobError("manifest_mismatch", "move source fingerprints do not cover the selected items")
            if any(not re.fullmatch(r"[a-f0-9]{64}", str(entry.get("sha256") or "")) for entry in fingerprints if isinstance(entry, dict)):
                raise TransferJobError("manifest_mismatch", "move source fingerprints are invalid")
        endpoint = grant.get("endpoint") if isinstance(grant.get("endpoint"), dict) else {}
        if (grant.get("executor_device_id") != self.target_id or not endpoint.get("host") or
                not endpoint.get("host_key") or not endpoint.get("username") or
                int(grant.get("expires_at") or 0) <= int(time.time())):
            raise TransferJobError("authorization_required", "source grant is expired or lacks pinned SFTP credentials")
        prepared = self._prepared(operation_id)
        if not prepared or prepared.get("payload_hash") != payload_hash:
            raise TransferJobError("authorization_required", "destination has no matching prepared key for this payload")
        if prepared.get("authorization_revision") != authority.get("authorization_revision"):
            raise TransferJobError("authorization_changed", "destination preparation was made under a different authorization revision")
        if prepared.get("network_id") != authority.get("network_id"):
            raise TransferJobError("network_changed", "destination preparation was made for another common network")
        if not self._binary or not Path(self._binary).is_file():
            raise TransferJobError("rclone_missing", "rclone is not installed on this Node", retryable=True)

        prepared: list[tuple[str, Path, str, str]] = []
        bytes_total = 0
        dest_root = self._resolve(str(destination.get("path") or ""))
        source_root = str(source.get("path") or "")
        if not source_root:
            raise TransferJobError("bad_path", "source root is required")
        endpoint = {**endpoint, "remote_root": str(grant.get("remote_root") or "/"),
                    "network_id": str(grant.get("network_id") or "")}
        for item in items:
            if not isinstance(item, dict) or item.get("kind") not in ("file", "directory"):
                raise TransferJobError("bad_args", "each item must contain a path and kind=file|directory")
            item_path = str(item.get("path") or "")
            if not item_path:
                raise TransferJobError("bad_args", "each item must have a path")
            relative = _safe_relative(item_path)
            destination_relative = _safe_relative(str(item.get("destination_path") or relative))
            dst = self._resolve(str(dest_root / Path(*destination_relative.split("/"))))
            if not _inside(dst, dest_root):
                raise TransferJobError("bad_path", "destination item escapes its authorized root")
            self._write_guard(dst, "write")
            if dst.exists():
                if payload.get("conflict_policy", "fail") != "overwrite":
                    raise TransferJobError("destination_exists", "destination item already exists", True)
                expected = str(item.get("destination_version") or "")
                if (not expected or (dst.is_dir() != (item.get("kind") == "directory")) or
                        _destination_version(dst) != expected):
                    raise TransferJobError("conflict", "destination changed or has no confirmed version", True)
            prepared.append((relative, dst, str(item.get("kind")), str(item.get("destination_version") or "")))

        trusted_file_fingerprints: dict[str, str] | None = None
        source_fingerprints = grant.get("source_fingerprints")
        if isinstance(source_fingerprints, list):
            fingerprints_by_path: dict[str, str] = {}
            valid_manifest = True
            for entry in source_fingerprints:
                if not isinstance(entry, dict):
                    valid_manifest = False
                    break
                try:
                    fingerprint_path = _safe_relative(str(entry.get("path") or ""))
                except TransferJobError:
                    valid_manifest = False
                    break
                fingerprint = str(entry.get("sha256") or "")
                if (fingerprint_path in fingerprints_by_path or
                        not re.fullmatch(r"[a-f0-9]{64}", fingerprint)):
                    valid_manifest = False
                    break
                fingerprints_by_path[fingerprint_path] = fingerprint
            if valid_manifest and set(fingerprints_by_path) == {item[0] for item in prepared}:
                trusted_file_fingerprints = {
                    relative: fingerprints_by_path[relative]
                    for relative, _, kind, _ in prepared if kind == "file"
                }

        single_file_stat = None
        sftp_relays = []
        info = grant.get("single_file_stat")
        if (mode == "copy" and len(prepared) == 1 and trusted_file_fingerprints
                and isinstance(info, dict) and info.get("path") == prepared[0][0]
                and type(info.get("size")) is int and info["size"] >= 0
                and type(info.get("mtime_ns")) is int):
            single_file_stat = (info["size"], info["mtime_ns"])
            if single_file_stat[0]:
                sftp_relays = self._receive_relays(
                    authority, endpoint, allow_local_adapter=single_file_stat[0] >= RECEIVE_MULTI_MIN_BYTES)

        timestamp = time.time()
        if previous:
            self._update(operation_id, state="queued", bytes_done=0, bytes_total=0, files_done=0,
                         files_total=0, rate=0, rc_job_id=None, rc_execute_id=None, error=None, updated_at=timestamp)
            with self._connect() as db:
                db.execute("UPDATE jobs SET attempts=attempts+1 WHERE operation_id=?", (operation_id,))
        else:
            with self._connect() as db:
                db.execute("INSERT INTO jobs(operation_id,payload_hash,payload,state,bytes_total,files_total,updated_at) VALUES(?,?,?,?,?,?,?)",
                           (operation_id, payload_hash, payload_json, "queued", bytes_total, 0, timestamp))
        context = copy_context()
        thread = threading.Thread(target=context.run, args=(self._run, operation_id, prepared, mode, bytes_total, source_root, dest_root, endpoint, self._key_paths(operation_id)[0], payload.get("conflict_policy", "fail"), trusted_file_fingerprints, single_file_stat, sftp_relays), daemon=True,
                                  name="rclone-job-" + operation_id[:24])
        thread.start()
        return self._get(operation_id) or {}

    def retry(self, args: dict[str, Any]) -> dict[str, Any]:
        with self._operation_lock:
            operation_id = str(args.get("operation_id") or "")
            current = self._get(operation_id) if ID_RE.fullmatch(operation_id) else None
            # Controller may retry the same operation after prepare/grant_issue succeeded
            # but before this destination persisted its job row. Fresh authorization and
            # the matching prepared payload make that a first start, not a new operation.
            # Existing jobs still pass through start() so payload conflicts and terminal
            # states retain their normal idempotency checks.
            return self.start(args, retry=bool(current and current["state"] in {"failed", "interrupted"}))

    def prepare(self, args: dict[str, Any]) -> dict[str, Any]:
        with self._operation_lock:
            return self._prepare_locked(args)

    def _prepare_locked(self, args: dict[str, Any]) -> dict[str, Any]:
        operation_id = str(args.get("operation_id") or "")
        if not ID_RE.fullmatch(operation_id):
            raise TransferJobError("bad_operation_id", "operation_id is invalid")
        if str(args.get("executor_device_id") or self.target_id) != self.target_id:
            raise TransferJobError("wrong_target", "prepare must run on the destination device")
        destination = args.get("destination")
        if not isinstance(destination, dict) or str(destination.get("device_id") or "") != self.target_id:
            raise TransferJobError("wrong_target", "destination path is not owned by this device")
        dest_root = self._resolve(str(destination.get("path") or ""))
        self._write_guard(dest_root, "write")
        source = args.get("source") if isinstance(args.get("source"), dict) else {}
        items = args.get("items") if isinstance(args.get("items"), list) else []
        if not items or args.get("mode") not in ("copy", "move"):
            raise TransferJobError("bad_args", "prepare requires items and a copy or move mode")
        for item in items:
            if not isinstance(item, dict) or item.get("kind") not in ("file", "directory"):
                raise TransferJobError("bad_args", "each item must contain kind=file|directory")
            _safe_relative(str(item.get("path") or ""))
            _safe_relative(str(item.get("destination_path") or item.get("path") or ""))
        payload = {key: args.get(key) for key in ("source", "destination", "items", "mode", "conflict_policy")}
        payload_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        requested_fingerprint = str(args.get("payload_fingerprint") or "")
        if requested_fingerprint and requested_fingerprint != payload_hash:
            raise TransferJobError("payload_fingerprint_mismatch", "Hub payload fingerprint does not match the normalized job payload")
        existing = self._prepared(operation_id)
        if existing and existing.get("payload_hash") != payload_hash:
            raise TransferJobError("operation_conflict", "operation_id is already prepared for a different payload")
        if existing and existing.get("authorization_revision") != str(args.get("authorization_revision") or ""):
            previous = self._get(operation_id)
            if not previous or previous["state"] not in {"failed", "interrupted"}:
                raise TransferJobError("authorization_changed", "cannot replace authorization while the job is active")
        network_id = str(args.get("network_id") or "")
        if not network_id:
            raise TransferJobError("network_not_connected", "prepare requires the Hub-selected common network")
        if existing and existing.get("network_id") != network_id:
            raise TransferJobError("network_changed", "transfer operation is bound to another common network")
        base = self._grant_dir / operation_id
        base.mkdir(mode=0o700, exist_ok=True)
        private, public = self._key_paths(operation_id)
        if not private.exists() or not public.exists():
            try:
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
                private_key = Ed25519PrivateKey.generate()
                private_data = private_key.private_bytes(
                    serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH,
                    serialization.NoEncryption())
                public_data = private_key.public_key().public_bytes(
                    serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH)
            except ImportError as exc:
                raise TransferJobError("ssh_key_crypto_missing", "the bundled cryptography dependency is unavailable", True) from exc
            private_tmp = private.with_name(private.name + ".tmp")
            public_tmp = public.with_name(public.name + ".tmp")
            try:
                private_tmp.write_bytes(private_data)
                public_tmp.write_text(public_data.decode("ascii") + " tether:" + operation_id + "\n", encoding="utf-8")
                try:
                    os.chmod(private_tmp, stat.S_IRUSR | stat.S_IWUSR)
                    os.chmod(public_tmp, stat.S_IRUSR | stat.S_IWUSR)
                except OSError:
                    pass
                os.replace(private_tmp, private)
                os.replace(public_tmp, public)
            finally:
                private_tmp.unlink(missing_ok=True)
                public_tmp.unlink(missing_ok=True)
        public_key = public.read_text(encoding="utf-8").strip()
        metadata = {"payload_hash": payload_hash, "source": source, "destination": destination,
                    "items": items, "mode": args.get("mode"), "public_key": public_key,
                    "network_id": network_id,
                    "expires_at": int(args.get("expires_at") or (time.time() + 900)),
                    "authorization_revision": str(args.get("authorization_revision") or "")}
        temp = base / "metadata.json.tmp"
        temp.write_text(json.dumps(metadata, separators=(",", ":")), encoding="utf-8")
        os.replace(temp, base / "metadata.json")
        return {"protocol": 1, "target_id": self.target_id, "operation_id": operation_id,
                "public_key": public_key, "executor_device_id": self.target_id,
                "destination_root": str(dest_root), "state": "authorizing"}

    def _key_paths(self, operation_id: str) -> tuple[Path, Path]:
        base = self._grant_dir / operation_id
        return base / "id_ed25519", base / "id_ed25519.pub"

    def _prepared(self, operation_id: str) -> dict[str, Any] | None:
        try:
            return json.loads((self._grant_dir / operation_id / "metadata.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _update(self, operation_id: str, **values: Any) -> None:
        values["updated_at"] = time.time()
        columns = ",".join(f"{name}=?" for name in values)
        with self._connect() as db:
            db.execute(f"UPDATE jobs SET {columns} WHERE operation_id=?", (*values.values(), operation_id))

    def _run(self, operation_id: str, items: list[tuple[str, Path, str, str]], mode: str, bytes_total: int,
             source_root: str, dest_root: Path, endpoint: dict[str, Any], key_file: Path,
             conflict_policy: str, trusted_file_fingerprints: dict[str, str] | None = None,
             single_file_stat: tuple[int, int] | None = None,
             sftp_relays: list[SftpRelay] | None = None) -> None:
        with self._lock:
            current = self._get(operation_id)
            if current and current["state"] == "cancelling":
                self._update(operation_id, state="cancelled")
                self._cleanup_credentials(operation_id)
                return
            self._update(operation_id, state="authorizing")
        bytes_done = files_done = 0
        try:
            config_path = self._write_rclone_config(operation_id, endpoint, key_file)
            file_items = [item for item in items if item[2] == "file"]
            batch_files = file_items
            batch_rules = [_rclone_include_rule(item[0]) for item in batch_files]
            if batch_files:
                self._start_rc(operation_id, config_path)
                if self._get(operation_id)["state"] == "cancelling":
                    self._update(operation_id, state="cancelled", rate=0)
                    return
            for relative, _, kind, _ in items:
                if self._get(operation_id)["state"] == "cancelling":
                    self._update(operation_id, state="cancelled", rate=0)
                    return
                if batch_files and kind == "file":
                    continue
                remote = "transfer:" + posixpath.join(str(endpoint.get("remote_root") or "/").strip("/"), relative)
                size_result = subprocess.run([self._binary, "--config", str(config_path), "size", remote, "--json"],
                                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
                                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if size_result.returncode:
                    raise TransferJobError("source_unavailable", "rclone could not inspect the authorized source", True)
                if self._get(operation_id)["state"] == "cancelling":
                    self._update(operation_id, state="cancelled", rate=0)
                    return
                size_data = json.loads(size_result.stdout)
                bytes_total += int(size_data.get("bytes", 0))
                files_done += 0
                # file counts include all files inside selected directories
                files_total = int(size_data.get("count", 0)) + int(self._get(operation_id)["files_total"])
                self._update(operation_id, bytes_total=bytes_total, files_total=files_total)
            if batch_files:
                if len(items) == 1:
                    if single_file_stat is None:
                        info = self._stat_source_file(operation_id, batch_files[0][0])
                        if not info or info["IsDir"] or info["Size"] < 0:
                            raise TransferJobError("source_changed", "rclone could not stat the selected file", True)
                        mtime = datetime.fromisoformat(info["ModTime"].replace("Z", "+00:00"))
                        single_file_stat = (info["Size"], int(mtime.timestamp() * 1_000_000_000))
                    bytes_total += single_file_stat[0]
                else:
                    batch_size = self._rc_call(operation_id, "operations/size", {
                        "fs": "transfer:", "_filter": {"IncludeRule": batch_rules},
                    })
                    if int(batch_size.get("count", -1)) != len(batch_files):
                        raise TransferJobError("source_changed", "rclone filter did not resolve exactly the selected files", True)
                    bytes_total += int(batch_size.get("bytes", 0))
                files_total = int(self._get(operation_id)["files_total"]) + len(batch_files)
                self._update(operation_id, bytes_total=bytes_total, files_total=files_total)
            with self._lock:
                if self._get(operation_id)["state"] == "cancelling":
                    self._update(operation_id, state="cancelled", rate=0)
                    return
                self._update(operation_id, state="running")
            batch_published = False
            for relative, dst, kind, expected_version in items:
                with self._lock:
                    if self._get(operation_id)["state"] == "cancelling":
                        self._update(operation_id, state="cancelled")
                        return
                if batch_files and kind == "file":
                    if batch_published:
                        continue
                    batch_stage_root = dest_root / ".tether-incoming" / operation_id
                    self._write_guard(batch_stage_root, "write")
                    batch_stage_root.mkdir(parents=True, exist_ok=True)
                    streams = 0
                    if single_file_stat and trusted_file_fingerprints and bytes_total >= RECEIVE_MULTI_MIN_BYTES:
                        options = self._rc_call(operation_id, "options/get", {"blocks": "main"})["main"]
                        if bytes_total >= options["MultiThreadCutoff"]:
                            streams = options["MultiThreadStreams"]
                    direct_failure = None
                    if not 2 <= streams <= 8:
                        try:
                            self._await_rc_job(operation_id, "sync/copy", {
                                "srcFs": "transfer:", "dstFs": str(batch_stage_root),
                                "_filter": {"IncludeRule": batch_rules}, "_async": True,
                            }, bytes_total, files_total)
                        except TransferJobError as exc:
                            if exc.code != "rclone_failed" or not sftp_relays:
                                raise
                            direct_failure = exc
                        streams = 1 if direct_failure else 0
                    if streams:
                        stage = batch_stage_root / Path(*relative.split("/"))
                        if not _inside(batch_stage_root, dest_root) or not _inside(stage, batch_stage_root):
                            raise TransferJobError("bad_path", "staging path escapes the destination")
                        self._write_guard(stage, "write")
                        stage.parent.mkdir(parents=True, exist_ok=True)
                        remote = "transfer:" + relative
                        route_factory = None
                        if sftp_relays:
                            def route_factory(rank_first):
                                return self._receive_route_plan(
                                    operation_id, endpoint, key_file, config_path, sftp_relays, remote,
                                    min(RECEIVE_PROBE_BYTES, bytes_total), direct_failure, rank_first=rank_first)
                        self._copy_file_ranges(operation_id, config_path, remote, stage,
                                               bytes_total, streams, route_factory=route_factory)
                        mtime_ns = single_file_stat[1]
                        os.utime(stage, ns=(mtime_ns, mtime_ns))
                    with self._lock:
                        if self._get(operation_id)["state"] == "cancelling":
                            raise TransferJobError("cancelled", "transfer was cancelled")
                        self._update(operation_id, state="verifying")
                    verify_locally = bool(trusted_file_fingerprints) and all(
                        relative in trusted_file_fingerprints for relative, _, _, _ in batch_files)
                    if not verify_locally:
                        check_output = self._await_rc_job(operation_id, "operations/check", {
                            "srcFs": "transfer:", "dstFs": str(batch_stage_root), "download": True,
                            "oneWay": True, "_filter": {"IncludeRule": batch_rules}, "_async": True,
                        }, bytes_total, files_total)
                        if (check_output.get("success") is False or check_output.get("differ") or
                                check_output.get("error") or check_output.get("missingOnSrc") or
                                check_output.get("missingOnDst")):
                            raise TransferJobError("verification_failed", "rclone content verification failed", True)
                    staged_files = []
                    for batch_relative, batch_dst, _, version in batch_files:
                        if self._get(operation_id)["state"] == "cancelling":
                            self._update(operation_id, state="cancelled", rate=0)
                            return
                        stage_file = self._resolve(str(batch_stage_root / Path(*batch_relative.split("/"))))
                        self._write_guard(stage_file, "write")
                        if (not _inside(stage_file, batch_stage_root) or not stage_file.is_file() or
                                (verify_locally and stage_file.is_symlink())):
                            raise TransferJobError("verification_failed", "rclone did not stage a selected file", True)
                        if verify_locally and _destination_version(stage_file) != trusted_file_fingerprints[batch_relative]:
                            raise TransferJobError("verification_failed", "staged file does not match the authorized source fingerprint", True)
                        staged_files.append((batch_relative, stage_file, batch_dst, version))
                    for _, stage_file, batch_dst, version in staged_files:
                        if self._get(operation_id)["state"] == "cancelling":
                            self._update(operation_id, state="cancelled", rate=0)
                            return
                        if batch_dst.exists():
                            self._write_guard(batch_dst, "write")
                            if conflict_policy != "overwrite" or not version or _destination_version(batch_dst) != version:
                                raise TransferJobError("conflict", "destination changed before transfer publication", True)
                        else:
                            self._write_guard(batch_dst, "write")
                        batch_dst.parent.mkdir(parents=True, exist_ok=True)
                        os.replace(stage_file, batch_dst)
                        bytes_done += batch_dst.stat().st_size
                        files_done += 1
                        self._update(operation_id, state="running", bytes_done=min(bytes_total, bytes_done),
                                     files_done=files_done)
                    batch_published = True
                    continue
                stage_root = dest_root / ".tether-incoming" / operation_id
                stage = self._resolve(str(stage_root / Path(*relative.split("/"))))
                self._write_guard(stage, "write")
                stage.parent.mkdir(parents=True, exist_ok=True)
                if kind == "directory":
                    stage.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    if conflict_policy != "overwrite" or not expected_version:
                        raise TransferJobError("conflict", "destination changed before transfer publication", True)
                    if dst.is_dir() != (kind == "directory") or _destination_version(dst) != expected_version:
                        raise TransferJobError("conflict", "destination changed before transfer publication", True)
                remote = "transfer:" + posixpath.join(str(endpoint.get("remote_root") or "/").strip("/"), relative)
                if operation_id not in self._rc:
                    self._start_rc(operation_id, config_path)
                if kind == "directory":
                    response = self._rc_call(operation_id, "sync/copy", {
                        "srcFs": remote, "dstFs": str(stage), "createEmptySrcDirs": True, "_async": True,
                    })
                else:
                    source_parent, source_name = posixpath.split(relative)
                    response = self._rc_call(operation_id, "operations/copyfile", {
                        "srcFs": "transfer:" + source_parent if source_parent else "transfer:",
                        "srcRemote": source_name,
                        "dstFs": str(stage.parent), "dstRemote": stage.name, "_async": True,
                    })
                job_id = int(response.get("jobid") or 0)
                execute_id = str(response.get("executeId") or "")
                if not job_id or not execute_id:
                    raise TransferJobError("rclone_rc_error", "rclone RC did not return a background job id", True)
                self._update(operation_id, rc_job_id=job_id, rc_execute_id=execute_id)
                with self._lock:
                    if operation_id in self._rc:
                        self._rc[operation_id]["job_id"] = job_id
                while True:
                    current = self._get(operation_id)
                    if current and current["state"] == "cancelling":
                        self._rc_call(operation_id, "job/stop", {"jobid": job_id})
                        self._update(operation_id, state="cancelled", rate=0)
                        return
                    status = self._rc_call(operation_id, "job/status", {"jobid": job_id})
                    stats = self._rc_call(operation_id, "core/stats", {})
                    self._update(operation_id, bytes_done=min(bytes_total, int(stats.get("bytes", 0))),
                                 rate=int(float(stats.get("speed", 0))),
                                 files_done=min(self._get(operation_id)["files_total"], int(stats.get("transfers", 0))))
                    if status.get("finished"):
                        if status.get("executeId") != execute_id or not status.get("success"):
                            raise TransferJobError("rclone_failed", str(status.get("error") or "rclone job failed"), True)
                        output = status.get("output")
                        if isinstance(output, dict) and output.get("error"):
                            detail = str(output.get("result") or "rclone command reported an error")
                            for sensitive in (str(endpoint.get("username") or ""), str(endpoint.get("host") or ""),
                                              str(dest_root), str(key_file), str(config_path)):
                                if sensitive:
                                    detail = detail.replace(sensitive, "<redacted>")
                            raise TransferJobError("rclone_failed", detail[:300], True)
                        break
                    time.sleep(0.5)
                self._update(operation_id, state="verifying")
                check = [self._binary, "--config", str(config_path), "--checkers", "4",
                         "check", remote, str(stage), "--download", "--one-way"]
                checker = subprocess.Popen(check, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, encoding="utf-8", errors="replace",
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                with self._lock:
                    self._active[operation_id] = checker
                deadline = time.monotonic() + 3600
                while checker.poll() is None:
                    if self._get(operation_id)["state"] == "cancelling":
                        checker.terminate()
                        try:
                            checker.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            checker.kill()
                        self._update(operation_id, state="cancelled", rate=0)
                        return
                    if time.monotonic() >= deadline:
                        checker.kill()
                        raise TransferJobError("verification_timeout", "content verification exceeded one hour", True)
                    time.sleep(0.2)
                check_stdout, check_stderr = checker.communicate()
                with self._lock:
                    if self._active.get(operation_id) is checker:
                        self._active.pop(operation_id, None)
                if checker.returncode:
                    detail = " ".join((check_stderr or check_stdout or "").split())[:240]
                    for sensitive in (str(endpoint.get("username") or ""), str(endpoint.get("host") or ""),
                                      str(dest_root), str(key_file), str(config_path)):
                        if sensitive:
                            detail = detail.replace(sensitive, "<redacted>")
                    message = "rclone content verification failed" + (": " + detail if detail else "")
                    raise TransferJobError("verification_failed", message, True)
                size = stage.stat().st_size if stage.is_file() else sum(f.stat().st_size for f in stage.rglob("*") if f.is_file())
                bytes_done += size
                files_done += 1
                with self._lock:
                    if self._get(operation_id)["state"] == "cancelling":
                        self._update(operation_id, state="cancelled", rate=0)
                        return
                    if dst.exists():
                        self._write_guard(dst, "write")
                        if conflict_policy != "overwrite":
                            raise TransferJobError("destination_exists", "destination appeared during transfer", True)
                        if dst.is_dir() != (kind == "directory"):
                            raise TransferJobError("conflict", "destination type changed before transfer publication", True)
                        if not expected_version:
                            raise TransferJobError("conflict", "overwrite requires a confirmed destination version", True)
                        current_version = _destination_version(dst)
                        if current_version != expected_version:
                            raise TransferJobError("conflict", "destination fingerprint changed before transfer publication "
                                                   f"(expected {expected_version[:24]}, observed {current_version[:24]})", True)
                        if kind == "directory":
                            self._write_guard(dst, "delete")
                    else:
                        self._write_guard(dst, "write")
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if dst.exists() and kind == "directory":
                        backup = dst.with_name("." + dst.name + ".tether-backup-" + operation_id)
                        if not _inside(backup, dest_root) or backup.exists():
                            raise TransferJobError("destination_backup_conflict", "cannot create a safe directory replacement backup", True)
                        self._write_guard(backup, "write")
                        os.replace(dst, backup)
                        try:
                            os.replace(stage, dst)
                        except OSError:
                            os.replace(backup, dst)
                            raise
                        try:
                            shutil.rmtree(backup)
                        except OSError as exc:
                            raise TransferJobError("destination_cleanup_failed",
                                                   "new directory was published but the confirmed old version remains in a backup", False) from exc
                    else:
                        os.replace(stage, dst)
                self._update(operation_id, state="running", bytes_done=min(bytes_total, bytes_done), files_done=files_done)
            with self._lock:
                if self._get(operation_id)["state"] == "cancelling":
                    self._update(operation_id, state="cancelled", rate=0)
                    return
                self._update(operation_id, state="completed", bytes_done=bytes_total,
                             files_done=self._get(operation_id)["files_total"], rate=0)
        except TransferJobError as exc:
            if exc.code == "cancelled":
                self._update(operation_id, state="cancelled", error=None, rate=0)
            else:
                self._update(operation_id, state="failed", error=json.dumps({"code": exc.code, "message": str(exc), "retryable": exc.retryable}), rate=0)
        except Exception as exc:  # persist operational errors for the next APP session
            self._update(operation_id, state="failed", error=json.dumps({"code": "transfer_failed", "message": str(exc)[:300], "retryable": True}), rate=0)
        finally:
            with self._lock:
                self._active.pop(operation_id, None)
            self._stop_rc(operation_id)
            current = self._get(operation_id)
            if current and current["state"] in {"completed", "cancelled"}:
                self._cleanup_credentials(operation_id)
            if current and current["state"] in TERMINAL:
                shutil.rmtree(dest_root / ".tether-incoming" / operation_id, ignore_errors=True)

    def _receive_relays(self, authority: dict[str, Any], endpoint: dict[str, Any], *,
                        allow_local_adapter: bool = True) -> list[SftpRelay]:
        if "sftp_relays" in authority:
            offers = authority["sftp_relays"]
            if not isinstance(offers, list):
                return []
            routes = {}
            for offer in offers:
                route = _managed_sftp_relay({**authority, "sftp_relay": offer}, endpoint)
                if route:
                    routes.setdefault(route[:2], route)
            return list(routes.values())

        offer = authority.get("sftp_relay")
        if isinstance(offer, dict) and offer.get("adapter") == "mtls_sftp":
            route = _managed_sftp_relay(authority, endpoint)
            return [route] if route else []
        binding = self._relay_adapter_route(authority, endpoint) if allow_local_adapter else None
        return [(*binding, None)] if binding else []

    def _relay_adapter_route(self, authority: dict[str, Any], endpoint: dict[str, Any]) -> tuple[str, int, int] | None:
        hint = _authorized_sftp_relay(authority, endpoint)
        if "sftp_relay" in authority and hint is None:
            return None
        path = self._grant_dir / "relay-adapter" / "binding.json"
        try:
            if not path.is_file() or path.resolve(strict=True) != path or not _private_relay_binding(path):
                return None
            with path.open("rb") as stream:
                body = stream.read(4097)
            if len(body) > 4096:
                return None
            binding = json.loads(body)
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
            return None
        pin = endpoint.get("host_key_fingerprint")
        if (not isinstance(binding, dict) or binding.get("local_host") != RELAY_ADAPTER_HOST or
                type(binding.get("local_port")) is not int or binding["local_port"] != RELAY_ADAPTER_PORT or
                not pin or binding.get("source_host_key_fingerprint") != pin):
            return None
        local = _authorized_sftp_relay({**authority, "sftp_relay": binding}, endpoint)
        if local is None:
            return None
        if hint is not None:
            if hint[:2] != local[:2]:
                return None
            return RELAY_ADAPTER_HOST, RELAY_ADAPTER_PORT, min(hint[2], local[2])
        if binding.get("local_validation") is True:
            return RELAY_ADAPTER_HOST, RELAY_ADAPTER_PORT, local[2]
        return None

    def _receive_route_plan(self, operation_id: str, endpoint: dict[str, Any], key_file: Path,
                            direct_config: Path, relays: list[SftpRelay], remote: str, probe_bytes: int,
                            direct_failure: TransferJobError | None, *,
                            rank_first: ReceiveRouteOrder | None = None) -> ReceiveRoutePlan:
        direct = ReceiveRoute(direct_config)
        direct_probed = direct_started = relay_started = False
        starting = True
        relays = list(relays)
        offset = 0
        while offset < len(relays):
            end = offset + RECEIVE_RELAYS_PER_BATCH
            with ExitStack() as resources:
                candidates = self._prepare_receive_relays(
                    operation_id, endpoint, key_file, direct_config.parent, relays[offset:end], resources)
                offset = end
                if not candidates:
                    continue
                if not direct_probed and direct_failure is None:
                    candidates.insert(0, direct)
                    direct_probed = True
                if starting and rank_first is not None:
                    ranked = rank_first(candidates)
                else:
                    ranked = self._probe_receive_routes(operation_id, candidates, remote, probe_bytes=probe_bytes)
                for index, route in enumerate(ranked):
                    if route.expires_at is not None and route.expires_at <= time.time():
                        continue
                    starting = False
                    direct_started |= route == direct
                    relay_started |= route != direct
                    untried_direct = not direct_started and direct_failure is None
                    has_backup = index + 1 < len(ranked) or offset < len(relays) or untried_direct
                    recheck = yield route, has_backup
                    if not recheck:
                        continue

                    challenger = next((item for item in ranked[index + 1:]
                                       if item.expires_at is None or item.expires_at > time.time()), None)
                    challenger_in_batch = challenger is not None
                    challenger_from_next_batch = False
                    if challenger is None and offset < len(relays):
                        extra = self._prepare_receive_relays(
                            operation_id, endpoint, key_file, direct_config.parent, relays[offset:offset + 1], resources)
                        challenger = extra[0] if extra else None
                        challenger_from_next_batch = challenger is not None
                    if challenger is None and untried_direct:
                        challenger = direct
                    if challenger is not None and self._compare_receive_route(operation_id, challenger, remote, recheck):
                        if challenger_in_batch:
                            ranked.remove(challenger)
                        if challenger_from_next_batch:
                            del relays[offset]
                        ranked.insert(index + 1, route)
                        route = challenger
                        direct_started |= route == direct
                    yield route, has_backup
        if not direct_started and direct_failure is None:
            yield direct, False
        elif direct_failure is not None and not relay_started:
            raise direct_failure

    def _prepare_receive_relays(self, operation_id: str, endpoint: dict[str, Any], key_file: Path,
                               config_root: Path, relays: list[SftpRelay], resources: ExitStack) -> list[ReceiveRoute]:
        routes = []
        for host, port, expiry, cert in relays:
            if self._get(operation_id)["state"] == "cancelling":
                raise TransferJobError("cancelled", "transfer was cancelled")
            if expiry <= time.time():
                continue
            with ExitStack() as relay:
                try:
                    if cert:
                        proxy = self._socks_proxy(endpoint["network_id"])
                        port = relay.enter_context(local_sftp_relay(self.data_dir, proxy, host, port, expiry, cert))
                    directory = Path(relay.enter_context(tempfile.TemporaryDirectory(dir=config_root)))
                    local_endpoint = {**endpoint, "host": RELAY_ADAPTER_HOST, "port": port}
                    config = self._write_rclone_config(operation_id, local_endpoint, key_file,
                                                       relay=True, config_dir=directory)
                except (OSError, ValueError, RuntimeError, TimeoutError):
                    continue
                resources.enter_context(relay.pop_all())
            routes.append(ReceiveRoute(config, expiry))
        return routes

    def _probe_receive_routes(self, operation_id: str, routes: list[ReceiveRoute], remote: str, *,
                              probe_bytes: int = RECEIVE_PROBE_BYTES) -> list[ReceiveRoute]:
        """Rank complete SSH-pinned reads and reap every probe before opening range readers."""
        with ExitStack() as handles:
            probes = {}

            def check_cancel():
                if self._get(operation_id)["state"] == "cancelling":
                    raise TransferJobError("cancelled", "transfer was cancelled")

            def probe_status(route):
                child, prefix = probes[route]
                if route.expires_at is not None and route.expires_at <= time.time():
                    return False
                status = child.poll()
                if status is None:
                    return None
                return status == 0 and prefix.seek(0, os.SEEK_END) == probe_bytes

            try:
                for route in routes:
                    check_cancel()
                    try:
                        prefix = handles.enter_context(tempfile.TemporaryFile(dir=route.config.parent))
                        child = subprocess.Popen(
                            [self._binary, "--config", str(route.config), "cat", remote, "--offset", "0",
                             "--count", str(probe_bytes), "--retries", "1", "--buffer-size", "0",
                             "--sftp-concurrency", "1", "--sftp-chunk-size", "32Ki", *route.rclone_options],
                            stdin=subprocess.DEVNULL, stdout=prefix, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    except OSError:
                        continue
                    probes[route] = child, prefix
                ready, pending = rank_routes(list(probes), probe_status, check_cancel=check_cancel,
                                             clock=time.monotonic, sleep=time.sleep, timeout=RECEIVE_PROBE_SECONDS,
                                             settle=RECEIVE_PROBE_SETTLE_SECONDS)
                return ready + pending
            finally:
                for child, _ in probes.values():
                    if child.poll() is None:
                        child.kill()
                    child.wait()

    def _compare_receive_route(self, operation_id: str, challenger: ReceiveRoute, remote: str,
                               probe: ReceiveRecheck) -> bool:
        """Compare one actual remaining range against the still-running readers."""
        if self._get(operation_id)["state"] == "cancelling":
            raise TransferJobError("cancelled", "transfer was cancelled")
        if challenger.expires_at is not None and time.time() >= challenger.expires_at:
            return False
        with tempfile.TemporaryFile(dir=challenger.config.parent, buffering=0) as sample:
            started = time.monotonic()
            incumbent_start, readers_start = probe.progress()
            try:
                reader = subprocess.Popen(
                    [self._binary, "--config", str(challenger.config), "cat", remote, "--offset", str(probe.offset),
                     "--count", str(probe.count), "--retries", "1", *challenger.rclone_options],
                    stdin=subprocess.DEVNULL, stdout=sample, stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError:
                return False
            try:
                first = None
                while time.monotonic() - started < RECEIVE_PROBE_SECONDS:
                    if self._get(operation_id)["state"] == "cancelling":
                        raise TransferJobError("cancelled", "transfer was cancelled")
                    if challenger.expires_at is not None and time.time() >= challenger.expires_at:
                        return False
                    status = reader.poll()
                    if status not in (None, 0):
                        return False
                    observed = time.monotonic()
                    moved = os.fstat(sample.fileno()).st_size
                    if first is None and status is None and moved > 0:
                        incumbent_start, readers_start = probe.progress()
                        first = observed, moved
                    measured_at, initial_bytes = first or (started, 0)
                    if status == 0 or (first and observed - measured_at >= RECEIVE_RECHECK_SECONDS):
                        incumbent_now, readers_now = probe.progress()
                        # A finished lane changes the reference rate. A short or empty sample
                        # cannot establish an improvement.
                        fresh = moved - initial_bytes
                        return (readers_start == readers_now > 0 and fresh >= RECEIVE_PROBE_BYTES
                                and (status is None or moved == probe.count)
                                and 3 * fresh * readers_now > 4 * (incumbent_now - incumbent_start))
                    time.sleep(0.05)
                return False
            finally:
                if reader.poll() is None:
                    reader.kill()
                reader.wait()

    def _start_range_reader(self, route: ReceiveRoute, remote: str, offset: int, count: int, output,
                            read_window=()):
        return subprocess.Popen(
            [self._binary, "--config", str(route.config), "cat", remote, "--offset", str(offset),
             "--count", str(count), "--retries", "1", *read_window, *route.rclone_options],
            stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def _copy_file_ranges(self, operation_id: str, config: Path, remote: str, stage: Path,
                          size: int, streams: int, *,
                          route_factory: Callable[[ReceiveRouteOrder | None], ReceiveRoutePlan] | None = None) -> None:
        # Each child inherits an independent file position. It advances only for bytes
        # written to staging, even when a connection drops in the middle of a range.
        # A restarted operation may have left staging behind. Never adopt its contents.
        stage.unlink(missing_ok=True)
        with stage.open("xb") as output:
            output.truncate(size)
        processes = {}

        def stop_reader(index):
            reader = processes.pop(index, None)
            if reader is not None:
                if reader.poll() is None:
                    reader.kill()
                reader.wait()
                if outputs[index].tell() > reader_starts[index]:
                    empty_exits[index] = 0

        with ExitStack() as handles:
            starts = [i * size // streams for i in range(streams)]
            ends = starts[1:] + [size]
            outputs = [handles.enter_context(stage.open("r+b", buffering=0)) for _ in range(streams)]
            reader_starts = starts.copy()
            empty_exits = [0] * streams
            retry_at = [0.0] * streams
            for output, offset in zip(outputs, starts):
                output.seek(offset)
            stall_timeout = 30.0
            startup_winner = None

            def rank_active_routes(candidates):
                nonlocal startup_winner
                for index in list(processes):
                    stop_reader(index)
                pilots = {}
                attempted_routes = set()
                slots = (index for index, output in enumerate(outputs) if output.tell() < ends[index])
                for index, candidate in zip(slots, candidates):
                    attempted_routes.add(candidate)
                    if self._get(operation_id)["state"] == "cancelling":
                        raise TransferJobError("cancelled", "transfer was cancelled")
                    try:
                        offset = reader_starts[index] = outputs[index].tell()
                        processes[index] = self._start_range_reader(
                            candidate, remote, offset, ends[index] - offset, outputs[index])
                    except OSError:
                        continue
                    pilots[index] = candidate

                deadline = time.monotonic() + stall_timeout
                observed_since = None
                samples = {}
                ready = []
                while pilots and time.monotonic() < deadline:
                    if self._get(operation_id)["state"] == "cancelling":
                        raise TransferJobError("cancelled", "transfer was cancelled")
                    now = time.monotonic()
                    ready = []
                    running = False
                    for index, candidate in list(pilots.items()):
                        status = processes[index].poll()
                        if (status not in (None, 0)
                                or candidate.expires_at is not None and time.time() >= candidate.expires_at):
                            stop_reader(index)
                            del pilots[index]
                            continue
                        running |= status is None
                        moved = outputs[index].tell() - reader_starts[index]
                        if moved > 0:
                            ready.append((index, moved))
                    if any(outputs[index].tell() >= ends[index] for index, _ in ready):
                        samples = {}
                        break
                    if any(moved >= RECEIVE_PROBE_BYTES for _, moved in ready):
                        if observed_since is None:
                            observed_since = now
                            samples = dict(ready)
                        elif (now - observed_since >= RECEIVE_START_OBSERVATION_SECONDS
                              and any(moved > samples.get(index, 0) for index, moved in ready)):
                            break
                    else:
                        observed_since = None
                        samples = {}
                    if not running:
                        break
                    time.sleep(0.05)
                ready.sort(key=lambda entry: (entry[1] - samples.get(entry[0], 0), entry[1]), reverse=True)
                ranked = [pilots[index] for index, _ in ready]
                startup_winner = ranked[0] if ranked else None
                for index, candidate in pilots.items():
                    if candidate != startup_winner:
                        stop_reader(index)
                if not ranked:
                    return [candidate for candidate in candidates if candidate not in attempted_routes]
                return ranked + [candidate for candidate in candidates if candidate not in ranked]
            rescue = False
            chunk_kib = 4 if streams >= 8 else 8
            samples = [None] * streams  # (time, position, previous narrow rate), per reader
            wide = {}  # Active wide readers, each compared to its own narrow rate.
            attempted = set()  # One probe per reader slot, including when ranges are reassigned.
            pending = None

            def active_progress():
                positions = [output.tell() for output in outputs]
                moved = size - sum(end - position for end, position in zip(ends, positions))
                active = sum(index in processes and positions[index] < ends[index] for index in range(streams))
                return moved, active

            route_failed = recheck_route = rechecked_route = False
            try:
                routes = None
                if route_factory is not None:
                    rank_first = rank_active_routes if streams > 1 else None
                    routes = handles.enter_context(closing(route_factory(rank_first)))
                route_plan = routes if routes is not None else iter([(ReceiveRoute(config), False)])
                route, has_backup = next(route_plan)
                has_alternates = has_backup
                if route != startup_winner:
                    for index in list(processes):
                        stop_reader(index)
                previous_time = progress_at = route_progress_at = window_at = time.monotonic()
                previous_bytes = progress_bytes = route_progress_bytes = window_bytes = active_progress()[0]
                assigned = [previous_time] * streams
                while True:
                    if self._get(operation_id)["state"] == "cancelling":
                        raise TransferJobError("cancelled", "transfer was cancelled")
                    done = size
                    idle = []
                    slow_index = None
                    slow_count = 0
                    longest = 30.0
                    now = time.monotonic()
                    expired = route.expires_at is not None and time.time() >= route.expires_at
                    route_stalled = has_backup and now - route_progress_at >= stall_timeout
                    following = None
                    if recheck_route:
                        recheck_route = False
                        if not (expired or route_failed or route_stalled):
                            remaining = [(end - output.tell(), end) for end, output in zip(ends, outputs)]
                            longest_range, range_end = max(remaining)
                            sample_size = min(longest_range, RECEIVE_RECHECK_BYTES)
                            if sample_size >= RECEIVE_PROBE_BYTES:
                                comparison = ReceiveRecheck(range_end - sample_size, sample_size, active_progress)
                                contender = routes.send(comparison)
                                if contender[0] != route:
                                    following = contender
                                now = time.monotonic()
                                expired = route.expires_at is not None and time.time() >= route.expires_at
                    if route_failed or expired or route_stalled or following is not None:
                        for index in list(processes):
                            stop_reader(index)
                        if following is None:
                            following = next(route_plan, None)
                        if following is None:
                            raise TransferJobError("rclone_failed", "rclone ran out of usable authorized routes", True)
                        route, has_backup = following
                        now = time.monotonic()
                        window_bytes, window_at = progress_bytes, now
                        empty_exits = [0] * streams
                        retry_at = [0.0] * streams
                        route_progress_bytes, route_progress_at = progress_bytes, now
                        progress_at = now
                        assigned = [now] * streams
                        wide.clear()
                        attempted.clear()
                        pending = None
                        rescue = route_failed = False
                    for index, output in enumerate(outputs):
                        process = processes.get(index)
                        result = process.poll() if process else None
                        position = output.tell()
                        remaining = ends[index] - position
                        done -= remaining
                        if remaining < 0:
                            raise TransferJobError("source_changed", "source exceeded its authorized range", True)
                        if remaining == 0:
                            if index == pending:
                                pending = None
                            idle.append(index)
                            continue
                        if process and result is None:
                            if rescue:
                                since, offset, prior_rate = samples[index]
                                interval = now - since
                                if index in wide and offset == reader_starts[index]:
                                    # Bound the handshake separately; measure rate only after the first write.
                                    if position > offset:
                                        samples[index] = (now, position, 0.0)
                                    elif interval >= stall_timeout:
                                        del wide[index]
                                        if index == pending:
                                            pending = None
                                        stop_reader(index)
                                        continue
                                elif interval >= 3:
                                    moved = position - offset
                                    rate = moved / interval
                                    if index in wide:
                                        if index == pending:
                                            pending = None
                                        if rate < wide[index] * 1.25:
                                            del wide[index]
                                            stop_reader(index)
                                            continue
                                    elif moved >= 2 * chunk_kib * 1024:
                                        if (pending is None and index not in attempted
                                                and prior_rate and remaining >= max(32 * chunk_kib * 1024, 4 * moved)):
                                            wide[index] = max(rate, prior_rate)
                                            attempted.add(index)
                                            pending = index
                                            stop_reader(index)
                                            continue
                                    else:
                                        rate = 0.0
                                    samples[index] = (now, position, rate)
                            elapsed = now - assigned[index]
                            transferred = position - starts[index]
                            if remaining >= 4 * 1024**2 and elapsed >= 5 and transferred > 0:
                                seconds_left = remaining * elapsed / transferred
                                if seconds_left > 30:
                                    slow_count += 1
                                    if seconds_left > longest:
                                        slow_index, longest = index, seconds_left
                            continue
                        if process is not None:
                            del processes[index]
                            wide.pop(index, None)
                            if index == pending:
                                pending = None  # A real exit still counts toward the empty-exit limit.
                            if position > reader_starts[index]:
                                empty_exits[index] = 0
                            else:
                                empty_exits[index] += 1
                                if empty_exits[index] >= 3:
                                    if has_backup:
                                        route_failed = True
                                        break
                                    raise TransferJobError("rclone_failed", "rclone could not finish the authorized range", True)
                                retry_at[index] = time.monotonic() + (2, 10)[empty_exits[index] - 1]
                        if time.monotonic() < retry_at[index]:
                            continue
                        reader_starts[index] = position
                        read_window = []
                        if rescue:
                            samples[index] = (time.monotonic(), position, 0.0)
                            read_window = ["--sftp-concurrency", "8" if index in wide else "1",
                                           "--sftp-chunk-size", "32Ki" if index in wide else f"{chunk_kib}Ki"]
                        processes[index] = self._start_range_reader(
                            route, remote, position, remaining, output, read_window)
                    if route_failed:
                        continue
                    # SSH teardown can stall after stdout has delivered every byte.
                    # Close our readers in finally before the caller hashes staging.
                    if done == size:
                        break
                    measured_for = now - window_at
                    if (routes is not None and has_backup and not rechecked_route and size >= RECEIVE_MULTI_MIN_BYTES
                            and size - done >= RECEIVE_SLOW_MIN_REMAINING and measured_for >= RECEIVE_SLOW_WINDOW_SECONDS):
                        rate = (done - window_bytes) / measured_for
                        if (0 < rate < RECEIVE_SLOW_BYTES_PER_SECOND
                                and size - done >= rate * RECEIVE_SLOW_MIN_SECONDS_LEFT):
                            recheck_route = rechecked_route = True
                            continue
                        window_bytes, window_at = done, now
                    if done - route_progress_bytes >= RECEIVE_PROBE_BYTES:
                        route_progress_bytes, route_progress_at = done, now
                    if done > progress_bytes:
                        progress_bytes, progress_at = done, now
                    elif (done or has_alternates) and not rescue and now - progress_at >= stall_timeout:
                        # Reopen only unfinished readers at their final offset after wait().
                        rescue = True
                        progress_at = now
                        for index, reader in list(processes.items()):
                            if outputs[index].tell() < ends[index] and reader.poll() is None:
                                stop_reader(index)
                        continue
                    elif has_alternates and rescue and now - progress_at >= stall_timeout:
                        raise TransferJobError("rclone_failed", "the last authorized route stopped making progress", True)
                    if idle and slow_index is not None:
                        # Stop only the slow reader and the completed ones whose slots we reuse.
                        # A last write may race with kill, so split at the position after wait.
                        # Leave a slot for each other slow range when possible.
                        available = max(1, len(idle) - slow_count + 1)
                        slots = [slow_index, *idle[:available]]
                        if pending in slots:
                            pending = None
                        for index in slots:
                            wide.pop(index, None)  # Reassigned readers restart narrow.
                            stop_reader(index)
                        position = outputs[slow_index].tell()
                        remaining = ends[slow_index] - position
                        for j, index in enumerate(slots):
                            starts[index] = position + j * remaining // len(slots)
                            ends[index] = position + (j + 1) * remaining // len(slots)
                            outputs[index].seek(starts[index])
                            assigned[index] = now
                            empty_exits[index] = 0
                            retry_at[index] = 0.0
                        continue
                    if now - previous_time >= 0.5:
                        self._update(operation_id, bytes_done=done, rate=int((done - previous_bytes) / (now - previous_time)))
                        previous_time, previous_bytes = now, done
                    time.sleep(0.1)
            finally:
                for index in list(processes):
                    stop_reader(index)

    def _await_rc_job(self, operation_id: str, path: str, body: dict[str, Any],
                      bytes_total: int, files_total: int) -> dict[str, Any]:
        response = self._rc_call(operation_id, path, body)
        job_id = int(response.get("jobid") or 0)
        execute_id = str(response.get("executeId") or "")
        if not job_id or not execute_id:
            raise TransferJobError("rclone_rc_error", "rclone RC did not return a background job id", True)
        self._update(operation_id, rc_job_id=job_id, rc_execute_id=execute_id)
        with self._lock:
            if operation_id in self._rc:
                self._rc[operation_id]["job_id"] = job_id
        while True:
            current = self._get(operation_id)
            if current and current["state"] == "cancelling":
                self._rc_call(operation_id, "job/stop", {"jobid": job_id})
                raise TransferJobError("cancelled", "transfer was cancelled", False)
            status = self._rc_call(operation_id, "job/status", {"jobid": job_id})
            stats = self._rc_call(operation_id, "core/stats", {})
            self._update(operation_id, bytes_done=min(bytes_total, int(stats.get("bytes", 0))),
                         rate=int(float(stats.get("speed", 0))),
                         files_done=min(files_total, int(stats.get("transfers", 0))))
            if status.get("finished"):
                if status.get("executeId") != execute_id or not status.get("success"):
                    raise TransferJobError("rclone_failed", str(status.get("error") or "rclone job failed"), True)
                output = status.get("output")
                if isinstance(output, dict) and output.get("error"):
                    raise TransferJobError("rclone_failed", "rclone reported an operation error", True)
                return output if isinstance(output, dict) else {}
            time.sleep(0.25)

    @staticmethod
    def _parse_rate(line: str) -> int:
        match = re.search(r"([\d.]+)\s*(B|Ki?B|Mi?B|Gi?B)/s", line, re.I)
        if not match:
            return 0
        multiplier = {"b": 1, "kb": 1000, "kib": 1024, "mb": 1000**2, "mib": 1024**2,
                      "gb": 1000**3, "gib": 1024**3}[match.group(2).lower()]
        return int(float(match.group(1)) * multiplier)

    @staticmethod
    def _same_content(source: Path, destination: Path) -> bool:
        if source.is_file():
            if not destination.is_file() or source.stat().st_size != destination.stat().st_size:
                return False
            def digest(path: Path) -> str:
                h = hashlib.sha256()
                with path.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        h.update(block)
                return h.hexdigest()
            return digest(source) == digest(destination)
        if not destination.is_dir():
            return False
        sources = sorted(p.relative_to(source) for p in source.rglob("*") if p.is_file())
        targets = sorted(p.relative_to(destination) for p in destination.rglob("*") if p.is_file())
        return sources == targets and all(RcloneJobs._same_content(source / rel, destination / rel) for rel in sources)

    def _write_rclone_config(self, operation_id: str, endpoint: dict[str, Any], key_file: Path, *,
                             relay: bool = False, config_dir: Path | None = None) -> Path:
        host_key = str(endpoint.get("host_key") or "").split()
        if len(host_key) < 2:
            raise TransferJobError("host_key_unpinned", "source SFTP host key is missing")
        import base64
        try:
            fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(base64.b64decode(host_key[1] + "===")).digest()).decode().rstrip("=")
        except (ValueError, IndexError) as exc:
            raise TransferJobError("host_key_unpinned", "source SFTP host key is malformed") from exc
        if fingerprint != endpoint.get("host_key_fingerprint"):
            raise TransferJobError("host_key_mismatch", "source SFTP key does not match its trusted fingerprint")
        directory = config_dir or self._grant_dir / operation_id
        known_hosts = directory / ("known_hosts-relay" if relay else "known_hosts")
        host = str(endpoint["host"])
        port = int(endpoint.get("port") or 22)
        if relay and (host != RELAY_ADAPTER_HOST or not 1 <= port <= 65535):
            raise TransferJobError("relay_address_invalid", "SFTP relay must use the designated local adapter")
        known_hosts.write_text(f"[{host}]:{port} {host_key[0]} {host_key[1]}\n", encoding="utf-8")
        config = directory / ("rclone-relay.conf" if relay else "rclone.conf")
        socks_proxy = ""
        if not relay:
            socks_proxy = "%s:%d" % self._socks_proxy(str(endpoint.get("network_id") or ""))
        content = ("[transfer]\ntype = sftp\n" + f"host = {host}\nuser = {endpoint['username']}\nport = {port}\n" +
                   f"key_file = {key_file}\nknown_hosts_file = {known_hosts}\nsocks_proxy = {socks_proxy}\n" +
                   "shell_type = none\nconnections = 9\n")
        config.write_text(content, encoding="utf-8")
        try:
            os.chmod(known_hosts, stat.S_IRUSR | stat.S_IWUSR)
            os.chmod(config, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        return config

    def _socks_proxy(self, network_id: str) -> tuple[str, int]:
        if not network_id or not callable(self.socks_proxy_resolver):
            raise TransferJobError("network_not_connected", "local SOCKS route for the selected network is unavailable", True)
        try:
            socks = self.socks_proxy_resolver(network_id)
        except Exception as exc:
            raise TransferJobError("network_not_connected", "local SOCKS route for the selected network is unavailable", True) from exc
        if (not isinstance(socks, dict) or socks.get("host") != "127.0.0.1" or
                type(socks.get("port")) is not int or not 1 <= socks["port"] <= 65535):
            raise TransferJobError("network_not_connected", "local SOCKS route for the selected network is invalid", True)
        return socks["host"], socks["port"]

    def _start_rc(self, operation_id: str, config: Path) -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        username, password = "tether", secrets.token_urlsafe(32)
        process = subprocess.Popen([self._binary, "rcd", "--config", str(config), "--rc-addr", f"127.0.0.1:{port}",
                                    "--rc-user", username, "--rc-pass", password,
                                    "--transfers", "4", "--checkers", "4"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self._rc[operation_id] = {"process": process, "url": f"http://127.0.0.1:{port}/",
                                  "username": username, "password": password}
        state_file = self._grant_dir / operation_id / "rclone-rc.json"
        state_file.write_text(json.dumps({"url": self._rc[operation_id]["url"], "username": username,
                                          "password": password, "pid": process.pid}, separators=(",", ":")), encoding="utf-8")
        try:
            os.chmod(state_file, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                self._stop_rc(operation_id)
                raise TransferJobError("rclone_rc_start_failed", "rclone RC exited before becoming ready", True)
            try:
                self._rc_call(operation_id, "core/version", {})
                return
            except TransferJobError:
                time.sleep(0.1)
        self._stop_rc(operation_id)
        raise TransferJobError("rclone_rc_start_failed", "rclone RC did not become healthy", True)

    def _stat_source_file(self, operation_id: str, relative: str) -> dict[str, Any] | None:
        for delay in (0, 1, 3):
            if delay:
                time.sleep(delay)
                if self._get(operation_id)["state"] == "cancelling":
                    raise TransferJobError("cancelled", "transfer was cancelled")
            try:
                return self._rc_call(operation_id, "operations/stat", {
                    "fs": "transfer:", "remote": relative,
                }).get("item")
            except TransferJobError as exc:
                if self._get(operation_id)["state"] == "cancelling":
                    raise TransferJobError("cancelled", "transfer was cancelled") from exc
                if exc.code != "source_connection_failed" or delay == 3:
                    raise

    def _rc_call(self, operation_id: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        entry = self._rc.get(operation_id)
        if not entry:
            raise TransferJobError("rclone_rc_unavailable", "rclone RC is not running", True)
        import base64
        auth = base64.b64encode((entry["username"] + ":" + entry["password"]).encode()).decode()
        request = Request(entry["url"] + path, data=json.dumps(body).encode(), method="POST",
                          headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
        source_stat = path == "operations/stat"
        if source_stat:
            with self._lock:
                if self._get(operation_id)["state"] == "cancelling":
                    raise TransferJobError("cancelled", "transfer was cancelled")
                if entry.get("process"):
                    self._active[operation_id] = entry["process"]
        try:
            # The packaged rclone allows 60 s to connect to the SFTP source.
            # Fast local control methods should still fail promptly.
            with urlopen(request, timeout=65 if source_stat else 10) as response:
                result = json.loads(response.read() or b"{}")
        except HTTPError as exc:
            if path == "operations/stat" and 500 <= exc.code < 600:
                # rclone reports path, auth and transport failures using the same
                # HTTP status. Its raw diagnostic can contain hosts and credentials.
                try:
                    detail = json.loads(exc.read(8192)).get("error", "").casefold()
                except (AttributeError, OSError, ValueError):
                    detail = ""
                finally:
                    exc.close()
                transient = ("connection refused", "actively refused", "connection reset",
                             "forcibly closed", "connection lost", "i/o timeout", "connection timed out",
                             "network is unreachable", "network unreachable", "host unreachable",
                             "no route to host", "ssh: handshake failed: eof")
                permanent = ("unable to authenticate", "permission denied", "access denied",
                             "knownhosts:", "host key", "no such file", "file does not exist",
                             "not found", "not allowed by ruleset")
                if (not any(message in detail for message in permanent)
                        and any(message in detail for message in transient)):
                    raise TransferJobError("source_connection_failed",
                                           "rclone could not connect to the authorized SFTP source", True) from exc
            raise TransferJobError("rclone_rc_error", f"rclone RC {path} failed", True) from exc
        except Exception as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc
            if source_stat and isinstance(reason, TimeoutError):
                raise TransferJobError("rclone_stat_wait_timeout",
                                       "local rclone did not answer the source file stat in time", True) from exc
            raise TransferJobError("rclone_rc_error", f"rclone RC {path} failed", True) from exc
        finally:
            if source_stat:
                with self._lock:
                    self._active.pop(operation_id, None)
        if not isinstance(result, dict):
            raise TransferJobError("rclone_rc_error", f"rclone RC {path} returned an invalid response", True)
        return result

    def _stop_rc(self, operation_id: str) -> None:
        entry = self._rc.pop(operation_id, None)
        if not entry:
            return
        process = entry["process"]
        if process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass

    def _cleanup_credentials(self, operation_id: str) -> None:
        for name in ("id_ed25519", "id_ed25519.pub", "rclone.conf", "known_hosts", "rclone-rc.json"):
            try:
                (self._grant_dir / operation_id / name).unlink(missing_ok=True)
            except OSError:
                pass

    def status(self, operation_id: str) -> dict[str, Any]:
        if not ID_RE.fullmatch(operation_id):
            raise TransferJobError("bad_operation_id", "operation_id is invalid")
        result = self._get(operation_id)
        if result is None:
            raise TransferJobError("not_found", "transfer job was not found")
        if result["state"] in {"failed", "interrupted", "cancelled", "completed"}:
            self._cleanup_credentials(operation_id)
        return result

    def destination_fingerprint(self, raw_path: str) -> dict[str, Any]:
        path = self._resolve(raw_path)
        self._read_guard(path)
        self._write_guard(path, "write")
        if path.is_symlink():
            raise TransferJobError("bad_path", "symbolic links cannot be overwritten by transfer jobs")
        if path.is_dir():
            fingerprint, files, size = _tree_fingerprint(path)
            kind = "directory"
        elif path.is_file():
            fingerprint, files, size = _file_fingerprint(path), 1, path.stat().st_size
            kind = "file"
        else:
            raise TransferJobError("unsupported_entry", "only regular files and directories have transfer fingerprints")
        return {"protocol": 1, "target_id": self.target_id, "path": str(path),
                "kind": kind, "fingerprint": fingerprint, "files": files, "bytes": size}

    def list(self) -> dict[str, Any]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 100").fetchall()
        return {"protocol": 1, "target_id": self.target_id, "jobs": [self._snapshot(row) for row in rows]}

    def has_active_jobs(self, *, network_id: str | None = None) -> bool:
        with self._connect() as db:
            rows = db.execute("SELECT operation_id FROM jobs WHERE state IN ('queued','authorizing','running','verifying','cancelling')").fetchall()
        if network_id is None:
            return bool(rows)
        for row in rows:
            metadata = self._prepared(str(row["operation_id"]))
            if not metadata or str(metadata.get("network_id") or "") == network_id:
                return True
        return False

    def cancel(self, operation_id: str) -> dict[str, Any]:
        with self._lock:
            job = self.status(operation_id)
            if job["state"] in TERMINAL:
                return job
            self._update(operation_id, state="cancelling")
            process = self._active.get(operation_id)
            rc = self._rc.get(operation_id)
        if process and process.poll() is None:
            process.terminate()
        elif rc and rc.get("job_id"):
            try:
                self._rc_call(operation_id, "job/stop", {"jobid": rc["job_id"]})
            except TransferJobError:
                pass
        return self.status(operation_id)
