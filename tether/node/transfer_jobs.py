"""Durable, target-owned transfer jobs executed by the official rclone CLI."""

from __future__ import annotations

import hashlib
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
import threading
import time
from contextlib import contextmanager
from contextvars import copy_context
from pathlib import Path
from pathlib import PureWindowsPath
from typing import Any
from urllib.request import Request, urlopen


ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
TERMINAL = {"completed", "cancelled", "failed", "interrupted"}
_INSTANCES: dict[str, "RcloneJobs"] = {}


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


class TransferJobError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class RcloneJobs:
    """Runs one rclone task at a time and persists identity and final status."""

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
        thread = threading.Thread(target=context.run, args=(self._run, operation_id, prepared, mode, bytes_total, source_root, dest_root, endpoint, self._key_paths(operation_id)[0], payload.get("conflict_policy", "fail")), daemon=True,
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
             conflict_policy: str) -> None:
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
                    self._await_rc_job(operation_id, "sync/copy", {
                        "srcFs": "transfer:", "dstFs": str(batch_stage_root),
                        "_filter": {"IncludeRule": batch_rules}, "_async": True,
                    }, bytes_total, files_total)
                    self._update(operation_id, state="verifying")
                    check_output = self._await_rc_job(operation_id, "operations/check", {
                        "srcFs": "transfer:", "dstFs": str(batch_stage_root), "download": True,
                        "oneWay": True, "_filter": {"IncludeRule": batch_rules}, "_async": True,
                    }, bytes_total, files_total)
                    if (check_output.get("success") is False or check_output.get("differ") or
                            check_output.get("error") or check_output.get("missingOnSrc") or
                            check_output.get("missingOnDst")):
                        raise TransferJobError("verification_failed", "rclone content verification failed", True)
                    for batch_relative, batch_dst, _, version in batch_files:
                        if self._get(operation_id)["state"] == "cancelling":
                            self._update(operation_id, state="cancelled", rate=0)
                            return
                        stage_file = self._resolve(str(batch_stage_root / Path(*batch_relative.split("/"))))
                        self._write_guard(stage_file, "write")
                        if not _inside(stage_file, batch_stage_root) or not stage_file.is_file():
                            raise TransferJobError("verification_failed", "rclone did not stage a selected file", True)
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

    def _write_rclone_config(self, operation_id: str, endpoint: dict[str, Any], key_file: Path) -> Path:
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
        directory = self._grant_dir / operation_id
        known_hosts = directory / "known_hosts"
        host = str(endpoint["host"])
        port = int(endpoint.get("port") or 22)
        known_hosts.write_text(f"[{host}]:{port} {host_key[0]} {host_key[1]}\n", encoding="utf-8")
        config = directory / "rclone.conf"
        network_id = str(endpoint.get("network_id") or "")
        if not network_id or not callable(self.socks_proxy_resolver):
            raise TransferJobError("network_not_connected", "local SOCKS route for the selected network is unavailable", True)
        try:
            socks = self.socks_proxy_resolver(network_id)
        except Exception as exc:
            raise TransferJobError("network_not_connected", "local SOCKS route for the selected network is unavailable", True) from exc
        if (not isinstance(socks, dict) or socks.get("host") != "127.0.0.1" or
                type(socks.get("port")) is not int or not 1 <= socks["port"] <= 65535):
            raise TransferJobError("network_not_connected", "local SOCKS route for the selected network is invalid", True)
        content = ("[transfer]\ntype = sftp\n" + f"host = {host}\nuser = {endpoint['username']}\nport = {port}\n" +
                   f"key_file = {key_file}\nknown_hosts_file = {known_hosts}\nsocks_proxy = {socks['host']}:{socks['port']}\n" +
                   "shell_type = none\nconnections = 9\n")
        config.write_text(content, encoding="utf-8")
        try:
            os.chmod(known_hosts, stat.S_IRUSR | stat.S_IWUSR)
            os.chmod(config, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        return config

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

    def _rc_call(self, operation_id: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        entry = self._rc.get(operation_id)
        if not entry:
            raise TransferJobError("rclone_rc_unavailable", "rclone RC is not running", True)
        import base64
        auth = base64.b64encode((entry["username"] + ":" + entry["password"]).encode()).decode()
        request = Request(entry["url"] + path, data=json.dumps(body).encode(), method="POST",
                          headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=10) as response:
                result = json.loads(response.read() or b"{}")
        except Exception as exc:
            raise TransferJobError("rclone_rc_error", f"rclone RC {path} failed", True) from exc
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
