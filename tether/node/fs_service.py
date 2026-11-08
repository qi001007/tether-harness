"""Filesystem service for a Tether node.

Policy is enforced here, on the machine that owns the files, and every write is
audited before it happens. The controller only forwards calls; it cannot widen
policy on its own.
"""

from __future__ import annotations

import base64
import binascii
import codecs
from contextvars import ContextVar
import hashlib
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import time
import threading
import uuid
import zipfile
import xml.etree.ElementTree as ET
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .dsh_desktop import DshDesktop, DshError
from .dsh_plugin import DshPluginError, install as install_dsh_plugin
from .agent_registry import AgentRegistry
from .agent_accounts import AgentAccounts
from .web_apps import OpenCodeWeb
from .agents_runtime import AgentsRuntime
from .transfer_jobs import RcloneJobs, TransferJobError
from .sftpgo_grants import SftpGoGrants, GrantError
from .service_access import ServiceAccess, ServiceAccessError
from .office_preview import OfficePreviewError, office_pdf
try:
    from .dsh_web import DshWeb
except Exception:  # an older install may not ship the optional Linux web module
    DshWeb = None  # type: ignore[assignment]


MAX_READ = 4 * 1024 * 1024
MAX_WRITE_CHUNK = 4 * 1024 * 1024
MAX_TRANSFER_BYTES = 64 * 1024 * 1024 * 1024
TRANSFER_ID_RE = re.compile(r"[a-f0-9]{8,32}")
MAX_PREVIEW_BYTES = 8 * 1024 * 1024
MAX_PREVIEW_TEXT = 512 * 1024
TRANSFER_PRIVATE_OPS = {
    "transfer_job_prepare", "transfer_job_start", "transfer_job_status", "transfer_job_list",
    "transfer_job_cancel", "transfer_job_retry", "transfer_grant_issue", "transfer_grant_revoke",
    "transfer_grant_renew", "transfer_move_finalize",
}
SERVICE_PRIVATE_OPS = {"service_grant_issue", "service_grant_renew", "service_grant_revoke"}
MESH_PRIVATE_OPS = {"mesh_apply", "mesh_status", "mesh_remove"}
HUB_FILE_SCOPE_OPS = {
    "list", "stat", "read", "preview", "destination_fingerprint",
    "write", "write_chunk", "mkdir", "rename", "copy", "delete",
}
HUB_FILE_READ_OPS = {"list", "stat", "read", "preview", "destination_fingerprint", "copy"}
HUB_FILE_WRITE_OPS = {"destination_fingerprint", "write", "write_chunk", "mkdir", "rename", "copy", "delete"}
PREVIEW_CACHE_MAX_FILES = 96
PREVIEW_CACHE_MAX_BYTES = 256 * 1024 * 1024
TEXT_SUFFIXES = {
    ".txt", ".md", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml",
    ".toml", ".ini", ".cfg", ".csv", ".log", ".xml", ".html", ".css", ".scss", ".sh", ".ps1",
    ".bat", ".cmd", ".c", ".h", ".cpp", ".hpp", ".cc", ".m", ".mm", ".pr", ".java", ".go", ".rs",
    ".sql", ".env", ".gitignore", ".cs", ".php", ".rb", ".swift", ".kt", ".lua", ".r", ".pl", ".tex",
    ".vue", ".svelte", ".dart", ".gradle", ".dockerfile", ".cmake", ".makefile",
}
MARKDOWN_SUFFIXES = {".md", ".markdown"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
OFFICE_KINDS = {".doc": "word", ".docx": "word", ".ppt": "powerpoint", ".pptx": "powerpoint"}


def _norm(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def _inside(candidate: Path, root: Path) -> bool:
    try:
        return os.path.commonpath([_norm(candidate), _norm(root)]) == _norm(root)
    except ValueError:
        return False


def _mesh_uuid_hex(value: Any) -> str:
    raw = str(value or "")
    try:
        parsed = uuid.UUID(raw)
    except (ValueError, TypeError, AttributeError) as exc:
        raise FsError("invalid EasyTier UUID", "bad_network_id") from exc
    if raw not in {parsed.hex, str(parsed)}:
        raise FsError("invalid EasyTier UUID", "bad_network_id")
    return parsed.hex


def _mesh_uuid_matches(value: Any, expected_hex: str) -> bool:
    try:
        return _mesh_uuid_hex(value) == expected_hex
    except FsError:
        return False


def _transfer_grant_expiry(args: dict[str, Any]) -> int:
    expires_at = args.pop("grant_expires_at", None)
    now = int(time.time())
    if type(expires_at) is not int or expires_at <= now or expires_at > now + 3600:
        raise FsError("source grant lease must expire within one hour", "bad_grant_expiry")
    return expires_at


def _content_version(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _path_version(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _newline_name(text: str) -> str:
    crlf = text.count("\r\n")
    bare_lf = text.count("\n") - crlf
    bare_cr = text.count("\r") - crlf
    if crlf >= bare_lf and crlf >= bare_cr and crlf:
        return "crlf"
    if bare_cr > bare_lf:
        return "cr"
    return "lf"


def _decode_text(data: bytes) -> tuple[str, str, str] | None:
    if data.startswith(codecs.BOM_UTF8):
        text = data.decode("utf-8-sig")
        encoding = "utf-8-bom"
    elif data.startswith(codecs.BOM_UTF16_LE):
        text = data[len(codecs.BOM_UTF16_LE):].decode("utf-16-le")
        encoding = "utf-16-le"
    elif data.startswith(codecs.BOM_UTF16_BE):
        text = data[len(codecs.BOM_UTF16_BE):].decode("utf-16-be")
        encoding = "utf-16-be"
    else:
        if b"\x00" in data:
            return None
        try:
            text = data.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError:
            try:
                text = data.decode("gb18030")
                encoding = "gb18030"
            except UnicodeDecodeError:
                return None
    if text:
        controls = sum(ord(char) < 32 and char not in "\t\n\r\f\b" for char in text)
        if controls / len(text) > 0.02:
            return None
    return text, encoding, _newline_name(text)


def _encode_text(text: str, encoding: str, newline: str) -> bytes:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    separator = {"lf": "\n", "crlf": "\r\n", "cr": "\r"}.get(newline)
    if separator is None:
        raise FsError("unsupported newline mode", "bad_args")
    normalized = normalized.replace("\n", separator)
    if encoding == "utf-8":
        return normalized.encode("utf-8")
    if encoding == "utf-8-bom":
        return codecs.BOM_UTF8 + normalized.encode("utf-8")
    if encoding == "utf-16-le":
        return codecs.BOM_UTF16_LE + normalized.encode("utf-16-le")
    if encoding == "utf-16-be":
        return codecs.BOM_UTF16_BE + normalized.encode("utf-16-be")
    if encoding == "gb18030":
        return normalized.encode("gb18030")
    raise FsError("unsupported text encoding", "bad_args")


class FsError(Exception):
    def __init__(self, message: str, code: str = "fs_error") -> None:
        super().__init__(message)
        self.code = code


class Policy:
    def __init__(self, path: Path, *, device: str, node_workspace: Path, workspaces_root: Path) -> None:
        self.path = path
        self.device = device
        self.node_workspace = node_workspace.resolve()
        self.workspaces_root = workspaces_root
        self.data = self._load()
        self.data.setdefault("allowed_roots", [str(self.workspaces_root), str(self.node_workspace)])
        self.data.setdefault("mode", "readonly")
        self._save()

    def _load(self) -> dict[str, Any]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def public(self) -> dict[str, Any]:
        return {**self.data, "workspaces_root": str(self.workspaces_root),
                "node_workspace": str(self.node_workspace),
                "writable_roots": [str(p) for p in self.writable_roots()]}

    def update(self, body: dict[str, Any]) -> dict[str, Any]:
        mode = body.get("mode")
        if mode not in (None, "readonly", "locked", "full"):
            raise FsError("mode must be readonly, locked or full", "bad_policy")
        if mode:
            self.data["mode"] = mode
        roots = body.get("allowed_roots")
        if roots is not None:
            if not isinstance(roots, list) or not all(isinstance(r, str) and r.strip() for r in roots):
                raise FsError("allowed_roots must be a list of paths", "bad_policy")
            self.data["allowed_roots"] = [str(Path(r).expanduser().resolve()) for r in roots]
        self.data["updated_at"] = time.time()
        self.data["updated_by"] = "desktop-settings"
        self._save()
        return self.public()

    def dsh_workspaces(self) -> list[dict[str, Any]]:
        home = Path.home()
        out: list[dict[str, Any]] = []
        registry = home / ".dsh" / "storages" / "workspace.json"
        try:
            raw = json.loads(registry.read_text(encoding="utf-8"))
            for wid, item in (raw.get("tables", {}).get("workspaces", {}) or {}).items():
                p = item.get("path")
                if p:
                    out.append({"id": wid, "name": item.get("title") or Path(p).name,
                                "path": str(Path(p)), "kind": "dsh", "exists": Path(p).exists()})
        except (OSError, ValueError):
            pass
        docs = home / "Documents" / "deepseek-harness"
        try:
            for child in docs.iterdir():
                if child.is_dir() and not any(_norm(child) == _norm(Path(w["path"])) for w in out):
                    out.append({"id": "dir:" + child.name, "name": child.name,
                                "path": str(child), "kind": "dsh", "exists": True})
        except OSError:
            pass
        return out

    def tether_workspaces(self) -> list[dict[str, Any]]:
        out = []
        try:
            for child in sorted(self.workspaces_root.iterdir(), key=lambda p: p.name.lower()):
                if child.is_dir() and not child.name.startswith("."):
                    out.append({"id": "tether:" + child.name, "name": child.name,
                                "path": str(child), "kind": "tether", "exists": True})
        except OSError:
            pass
        return out

    def workspaces(self) -> list[dict[str, Any]]:
        seen: set[str] = set()
        result = []
        items = self.dsh_workspaces() + self.tether_workspaces()
        if not any(_norm(Path(w["path"])) == _norm(self.node_workspace) for w in items):
            items.append({"id": "node", "name": "Tether 工作目录", "path": str(self.node_workspace),
                          "kind": "node", "exists": True})
        for w in items:
            key = _norm(Path(w["path"]))
            if key in seen:
                continue
            seen.add(key)
            w["writable"] = self.can_write(Path(w["path"]), op="write")[0]
            result.append(w)
        return result

    def writable_roots(self) -> list[Path]:
        roots = [Path(r) for r in self.data.get("allowed_roots", [])]
        roots += [Path(w["path"]) for w in self.dsh_workspaces()]
        return roots

    def _system_deny_write(self, p: Path) -> str | None:
        home = Path.home()
        denied = [
            Path(os.environ.get("SystemRoot", r"C:\Windows")),
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
            Path(os.environ.get("ProgramData", r"C:\ProgramData")),
            home / ".ssh",
            home / ".dsh",
            home / ".aws",
            home / ".config",
            home / "AppData",
        ]
        for root in denied:
            if _inside(p, root):
                return f"protected system path: {root}"
        return None

    def can_write(self, p: Path, *, op: str) -> tuple[bool, str]:
        try:
            p = p.resolve()
        except OSError:
            pass
        reason = self._system_deny_write(p)
        if reason:
            return False, reason
        if self.data.get("mode") == "locked":
            return False, "writes disabled (locked policy)"
        if self.data.get("mode") == "full":
            return True, "full-disk mode"
        for root in self.writable_roots():
            try:
                root = root.resolve()
            except OSError:
                pass
            if _inside(p, root):
                return True, f"allowed root: {root}"
        return False, "read-only: path outside allowed roots (enable full-disk mode in settings)"

    def can_read(self, p: Path) -> tuple[bool, str]:
        home = Path.home()
        secret_files = [home / ".dsh" / ".credentials.yaml"]
        for secret in secret_files:
            if _norm(p) == _norm(secret):
                return False, "credential store is protected"
        return True, ""


class Audit:
    """Append-only audit in SQLite; memory stays constant and old rows age out."""

    MAX_ROWS = 100_000
    BASE_KEYS = {"ts", "device", "op", "path", "mode", "phase", "result", "reason"}

    def __init__(self, path: Path, *, device: str, max_rows: int | None = None,
                 context_provider: Any = None) -> None:
        self.path = Path(path)
        self.db_path = self.path.with_suffix(".db")
        self.device = device
        self.max_rows = max_rows or self.MAX_ROWS
        self.context_provider = context_provider
        self._inserts = 0
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    device TEXT,
                    op TEXT,
                    path TEXT,
                    mode TEXT,
                    phase TEXT,
                    result TEXT,
                    reason TEXT,
                    extra TEXT
                )
            """)
        self._migrate_legacy()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(str(self.db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _migrate_legacy(self) -> None:
        if not self.path.is_file():
            return
        with self._connect() as conn:
            if conn.execute("SELECT COUNT(*) FROM audit").fetchone()[0]:
                return
            try:
                lines = self.path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                return
            for line in lines:
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if isinstance(item, dict):
                    self._insert(conn, item)
            if conn.execute("SELECT COUNT(*) FROM audit").fetchone()[0] > self.max_rows:
                conn.execute(
                    "DELETE FROM audit WHERE id <= (SELECT MAX(id) - ? FROM audit)",
                    (self.max_rows,),
                )
        try:
            self.path.rename(self.path.with_name(self.path.name + ".migrated"))
        except OSError:
            pass

    def _insert(self, conn: sqlite3.Connection, item: dict[str, Any]) -> None:
        extra = {key: value for key, value in item.items() if key not in self.BASE_KEYS}
        conn.execute(
            "INSERT INTO audit(ts, device, op, path, mode, phase, result, reason, extra) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (float(item.get("ts") or time.time()), item.get("device") or self.device,
             item.get("op"), item.get("path"), item.get("mode"), item.get("phase"),
             item.get("result"), item.get("reason"),
             json.dumps(extra, ensure_ascii=False) if extra else None),
        )

    def _prune(self, conn: sqlite3.Connection) -> None:
        row = conn.execute(
            "SELECT id FROM audit ORDER BY id DESC LIMIT 1 OFFSET ?", (self.max_rows,)
        ).fetchone()
        if row is not None:
            conn.execute("DELETE FROM audit WHERE id <= ?", (row["id"],))

    def add(self, **entry: Any) -> dict[str, Any]:
        if self.context_provider is not None:
            try:
                scope = self.context_provider()
            except Exception:
                scope = None
            if isinstance(scope, dict):
                for key in ("actor_id", "grant_id", "operation_id"):
                    if scope.get(key) and key not in entry:
                        entry[key] = scope[key]
        item = {"ts": time.time(), "device": self.device, **entry}
        with self._connect() as conn:
            self._insert(conn, item)
            self._inserts += 1
            if self._inserts % 256 == 0:
                self._prune(conn)
        return item

    def page(self, limit: int = 100, offset: int = 0) -> dict[str, Any]:
        limit = max(1, min(int(limit or 100), 5000))
        offset = max(0, int(offset or 0))
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM audit").fetchone()[0]
        entries: list[dict[str, Any]] = []
        for row in rows:
            item = {key: row[key] for key in ("ts", "device", "op", "path", "mode", "phase", "result", "reason")
                    if row[key] is not None}
            if row["extra"]:
                try:
                    item.update(json.loads(row["extra"]))
                except ValueError:
                    pass
            entries.append(item)
        return {"entries": entries, "count": total, "retained": self.max_rows}

    def list(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        return self.page(limit, offset)["entries"]


class _StreamWriter:
    def __init__(self, service: "FsService", path: Path, part: Path,
                 handle: Any, total: int, transfer: str, *, expected_version: str | None = None,
                 discard_on_abort: bool = False) -> None:
        self.service = service
        self.path = path
        self.part = part
        self.handle = handle
        self.total = total
        self.transfer = transfer
        self.expected_version = expected_version
        self.discard_on_abort = discard_on_abort

    def write(self, data: bytes) -> None:
        self.service._write_guard(self.path, "write", bytes=self.total)
        self.handle.write(data)

    def abort(self) -> None:
        try:
            self.handle.close()
        except OSError:
            pass
        if self.discard_on_abort:
            try:
                self.part.unlink(missing_ok=True)
            except OSError:
                pass

    def finish(self) -> dict[str, Any]:
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.handle.close()
        if self.part.stat().st_size != self.total:
            raise FsError("stream is incomplete", "offset_mismatch")
        self.service._write_guard(self.path, "write", bytes=self.total)
        if self.expected_version == "absent":
            if self.path.exists():
                raise FsError("file appeared during upload", "conflict")
        elif self.expected_version is not None:
            current_version = _path_version(self.path) if self.path.exists() else ""
            if current_version != self.expected_version:
                raise FsError("file changed during upload", "conflict")
        os.replace(self.part, self.path)
        st = self.path.stat()
        version = _path_version(self.path)
        self.service.audit.add(op="transfer", path=str(self.path),
                               mode=self.service.policy.data.get("mode"),
                               phase="result", result="ok", bytes=self.total, version=version)
        return {"path": str(self.path), "transfer_id": self.transfer,
                "offset": self.total, "total": self.total, "size": st.st_size,
                "mtime": st.st_mtime, "version": version, "complete": True}


class FsService:
    def __init__(self, *, device: str, workspace: Path, data_dir: Path, workspaces_root: Path,
                 dsh_home: Path | None = None) -> None:
        self.device = device
        self.workspace = workspace
        self.data_dir = data_dir
        self.workspaces_root = workspaces_root
        self.workspaces_root.mkdir(parents=True, exist_ok=True)
        self.policy = Policy(data_dir / "policy.json", device=device,
                             node_workspace=workspace, workspaces_root=workspaces_root)
        self._hub_file_scope: ContextVar[dict[str, Any] | None] = ContextVar(
            f"hub-file-scope-{device}", default=None)
        self.audit = Audit(data_dir / "audit.jsonl", device=device,
                           context_provider=self._hub_file_scope.get)
        self.dsh_desktop = DshDesktop(data_dir, dsh_home=dsh_home)
        self.dsh_web = DshWeb(data_dir, workspace=workspace) if DshWeb is not None else None
        self.preview_cache_dir = data_dir / "preview-cache"
        self.preview_cache_dir.mkdir(parents=True, exist_ok=True)
        self._office_lock = threading.Lock()
        self.croc = None
        self._croc_context: dict[str, Any] = {}
        self.agents = AgentRegistry(data_dir)
        self.accounts = AgentAccounts(data_dir)
        self.opencode = OpenCodeWeb(data_dir, workspace)
        self.agents_runtime = AgentsRuntime(data_dir, workspace)
        self.transfer_jobs = RcloneJobs(data_dir, target_id=device, resolver=self._resolve,
                                        read_guard=self._read_guard, write_guard=self._write_guard)
        self.sftpgo_grants = SftpGoGrants(data_dir, device_id=device, resolve=self._resolve,
                                          read_guard=self._read_guard, write_guard=self._write_guard)
        self.sftpgo_grants.transfer_jobs = self.transfer_jobs
        self.mesh_runtime = None
        mesh_core = os.environ.get("TETHER_EASYTIER_CORE", "")
        mesh_cli = os.environ.get("TETHER_EASYTIER_CLI", "")
        if mesh_core and mesh_cli:
            from .mesh_runtime import EasyTierRuntime
            mesh_data_root = data_dir / "managed-mesh"
            record_root = None
            if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
                mesh_data_root = Path("/var/lib/tether-easytier")
                record_root = data_dir / "managed-mesh"
            self.mesh_runtime = EasyTierRuntime(mesh_core, mesh_cli, mesh_data_root,
                                                record_root=record_root)
            self.transfer_jobs.socks_proxy_resolver = self._network_socks_proxy
        self.service_access = ServiceAccess(data_dir, target_id=device, agents_runtime=self.agents_runtime,
                                            dsh_web=self.dsh_web, network_address=self._network_address)
        try:
            from .files_http import FilesHttpService
            self.files_http = FilesHttpService(self, self.service_access)
        except Exception:
            self.files_http = None
        self.service_access.files_http = self.files_http

    def _network_address(self, network_id: str) -> str:
        runtime = self.mesh_runtime
        if runtime is None:
            raise FsError("target is not connected to the selected EasyTier network", "network_not_connected")
        try:
            expected_network_id = _mesh_uuid_hex(network_id)
            status = runtime.status_for_network(str(network_id))
        except Exception as exc:
            raise FsError("selected EasyTier network status is unavailable", "network_not_connected") from exc
        if (status.get("state") != "ready" or
                not _mesh_uuid_matches(status.get("network_id"), expected_network_id)):
            raise FsError("target is not connected to the selected EasyTier network", "network_not_connected")
        raw_address = status.get("service_ip")
        try:
            address = ipaddress.IPv4Address(str(raw_address).split("/", 1)[0])
        except ipaddress.AddressValueError as exc:
            raise FsError("selected EasyTier instance has no valid service address", "network_not_connected") from exc
        if address not in ipaddress.IPv4Network("10.224.0.0/12"):
            raise FsError("selected EasyTier instance has an invalid service address", "network_not_connected")
        return str(address)

    def _network_socks_proxy(self, network_id: str) -> dict[str, Any]:
        runtime = self.mesh_runtime
        if runtime is None:
            raise FsError("source network SOCKS route is unavailable", "network_not_connected")
        try:
            expected_network_id = _mesh_uuid_hex(network_id)
            status = runtime.status_for_network(str(network_id))
        except Exception as exc:
            raise FsError("source network SOCKS route is unavailable", "network_not_connected") from exc
        route = status.get("socks_proxy") if isinstance(status, dict) else None
        if (status.get("state") != "ready" or
                not _mesh_uuid_matches(status.get("network_id"), expected_network_id) or
                not isinstance(route, dict) or route.get("host") != "127.0.0.1" or
                type(route.get("port")) is not int or not 1 <= route["port"] <= 65535):
            raise FsError("source network SOCKS route is not ready", "network_not_connected")
        return {"host": route["host"], "port": route["port"]}

    def _resolve(self, raw: str | None) -> Path:
        if not raw:
            raise FsError("path is required", "bad_path")
        text = str(raw)
        if len(text) == 2 and text[1] == ":" and text[0].isalpha():
            text += "\\"
        p = Path(text).expanduser()
        if not p.is_absolute():
            raise FsError("path must be absolute", "bad_path")
        return p.resolve()

    def _read_guard(self, p: Path) -> None:
        self._require_scope_path(p, "read_roots", self._hub_file_scope.get())
        ok, why = self.policy.can_read(p)
        if not ok:
            self.audit.add(op="read", path=str(p), mode=self.policy.data.get("mode"),
                           result="denied", error=why)
            raise FsError(why, "denied")

    def _write_guard(self, p: Path, op: str, **extra: Any) -> None:
        self._require_scope_path(p, "write_roots", self._hub_file_scope.get())
        ok, why = self.policy.can_write(p, op=op)
        self.audit.add(op=op, path=str(p), mode=self.policy.data.get("mode"),
                       phase="intent", result="allowed" if ok else "denied", reason=why, **extra)
        if not ok:
            raise FsError(why, "denied")

    @staticmethod
    def _scope_roots(scope: dict[str, Any], field: str, *, required: bool = True) -> list[Path]:
        raw = scope.get(field)
        if not isinstance(raw, list) or (required and not raw) or any(not isinstance(item, str) or not item.strip() for item in raw):
            raise FsError("shared path authority has no usable roots", "shared_scope_denied")
        roots = []
        for item in raw:
            root = Path(item).expanduser()
            if not root.is_absolute():
                raise FsError("shared path authority contains a non-absolute root", "shared_scope_denied")
            try:
                roots.append(root.resolve())
            except (OSError, RuntimeError) as exc:
                raise FsError("shared path authority contains an invalid root", "shared_scope_denied") from exc
        return roots

    @classmethod
    def _require_scope_path(cls, path: Path, field: str, scope: dict[str, Any] | None) -> None:
        if scope is None:
            return
        grant_check = scope.get("_grant_check")
        if callable(grant_check):
            grant_check()
        if scope.get("_owner_policy") is True:
            return
        roots = cls._scope_roots(scope, field)
        try:
            resolved = path.resolve()
        except (OSError, RuntimeError) as exc:
            raise FsError("could not resolve shared path", "shared_scope_denied") from exc
        if not any(_inside(resolved, root) for root in roots):
            raise FsError("resolved path is outside this Hub share", "shared_scope_denied")

    def dispatch(self, op: str, args: dict[str, Any], *, trusted_hub: bool = False) -> Any:
        if (op in TRANSFER_PRIVATE_OPS or op in SERVICE_PRIVATE_OPS or op in MESH_PRIVATE_OPS) and not trusted_hub:
            raise FsError("this operation is only accepted on the authenticated Hub control channel", "trusted_hub_required")
        handler = getattr(self, "_op_" + op, None)
        if handler is None:
            raise FsError(f"unknown fs op: {op}", "bad_op")
        try:
            result = handler(args)
        except DshError as exc:
            raise FsError(str(exc), exc.code) from exc
        if isinstance(result, dict):
            result.setdefault("device_id", self.policy.device)
        return result

    def dispatch_hub(self, op: str, args: dict[str, Any], authority: dict[str, Any] | None = None) -> Any:
        if op in MESH_PRIVATE_OPS:
            return self._dispatch_hub_mesh(op, args, authority)
        if isinstance(authority, dict) and authority.get("kind") == "hub_files" and op not in HUB_FILE_SCOPE_OPS:
            raise FsError("Hub file authority cannot authorize this operation", "trusted_hub_required")
        if op in HUB_FILE_SCOPE_OPS and isinstance(authority, dict) and authority.get("kind") == "hub_files":
            required = ("actor_id", "target_id", "operation_id", "issued_at", "expires_at")
            now = int(time.time())
            try:
                issued, expires = int(authority.get("issued_at") or 0), int(authority.get("expires_at") or 0)
            except (TypeError, ValueError):
                issued = expires = 0
            if (any(not authority.get(key) for key in required) or str(authority.get("target_id")) != self.device or
                    issued > now + 5 or expires <= now or expires > issued + 60):
                raise FsError("invalid or expired Hub file authority", "trusted_hub_required")
            if (args.get("operation_id") is not None and str(args.get("operation_id")) != str(authority["operation_id"])):
                raise FsError("operation_id does not match Hub file authority", "trusted_hub_required")
            if any(key in args for key in ("actor_id", "target_id", "issued_at", "expires_at",
                                           "read_roots", "write_roots", "kind", "_hub_authority")):
                raise FsError("Hub file authority must be sent outside args", "trusted_hub_required")
            if any(key not in authority or not isinstance(authority[key], list) for key in ("read_roots", "write_roots")):
                raise FsError("Hub file authority must include read_roots and write_roots arrays", "trusted_hub_required")
            self._scope_roots(authority, "read_roots", required=False)
            self._scope_roots(authority, "write_roots", required=False)
            if op in HUB_FILE_READ_OPS:
                self._scope_roots(authority, "read_roots")
            if op in HUB_FILE_WRITE_OPS:
                self._scope_roots(authority, "write_roots")
            token = self._hub_file_scope.set(authority)
            try:
                return self.dispatch(op, args, trusted_hub=True)
            finally:
                self._hub_file_scope.reset(token)
        if (op in HUB_FILE_SCOPE_OPS and authority is not None and
                (not isinstance(authority, dict) or authority.get("kind") != "hub_files")):
            raise FsError("invalid Hub file authority", "trusted_hub_required")
        if op in SERVICE_PRIVATE_OPS:
            if not isinstance(authority, dict) or authority.get("kind") != "hub_service":
                raise FsError("missing Hub service authority", "trusted_hub_required")
            if (not authority.get("actor_id") or not authority.get("target_id") or
                    not authority.get("service_id") or not authority.get("grant_id") or
                    not authority.get("operation_id") or not authority.get("authorization_revision") or
                    not authority.get("network_id") or not authority.get("service_ip")):
                raise FsError("invalid Hub service authority", "trusted_hub_required")
            if str(authority.get("target_id")) != self.device:
                raise FsError("service authority targets another device", "wrong_target")
            if (op in {"service_grant_issue", "service_grant_renew"} and
                    authority.get("service_ip") != self._network_address(str(authority["network_id"]))):
                raise FsError("service address does not match selected network", "mesh_service_ip_mismatch")
            reserved = {"actor_id", "target_id", "service_id", "grant_id", "operation_id", "authorization_revision",
                        "network_id", "service_ip", "issued_at", "expires_at", "kind"}
            if any(key in args for key in reserved):
                raise FsError("service authority fields must be sent outside args", "trusted_hub_required")
            args = {**args, "_hub_authority": authority}
            return self.dispatch(op, args, trusted_hub=True)
        if op in TRANSFER_PRIVATE_OPS:
            if not isinstance(authority, dict) or authority.get("kind") != "hub_transfer":
                raise FsError("missing Hub transfer authority", "trusted_hub_required")
            if (not authority.get("actor_id") or not authority.get("operation_id") or
                    not authority.get("authorization_revision") or not authority.get("network_id") or
                    not authority.get("service_ip")):
                raise FsError("invalid Hub transfer authority", "trusted_hub_required")
            try:
                service_ip = str(ipaddress.IPv4Address(str(authority["service_ip"])))
            except ipaddress.AddressValueError as exc:
                raise FsError("invalid trusted mesh service address", "trusted_hub_required") from exc
            now = int(time.time())
            try:
                issued_at = int(authority["issued_at"]) if authority.get("issued_at") is not None else None
                expires_at = int(authority.get("expires_at") or 0)
            except (TypeError, ValueError):
                issued_at, expires_at = 0, 0
            if (issued_at is None or expires_at <= now or expires_at > now + 60 or
                    issued_at > now + 5 or expires_at > issued_at + 60):
                raise FsError("Hub transfer authority expired", "authorization_expired")
            if op in {"transfer_job_prepare", "transfer_job_start", "transfer_job_retry",
                      "transfer_grant_issue"} and service_ip != self._network_address(str(authority["network_id"])):
                raise FsError("transfer service address does not match selected network", "mesh_service_ip_mismatch")
            expected_device = authority.get("source_device_id") if op in {"transfer_grant_issue", "transfer_grant_revoke", "transfer_grant_renew", "transfer_move_finalize"} else authority.get("executor_device_id")
            if str(expected_device or "") != self.device:
                raise FsError("transfer authority targets another device", "wrong_target")
            requested_id = str(args.get("operation_id") or authority.get("operation_id") or "")
            if requested_id != str(authority.get("operation_id")):
                raise FsError("operation_id does not match Hub authority", "trusted_hub_required")
            root_fields = ("source_read_roots", "source_write_roots", "destination_write_roots")
            if any(field in args for field in root_fields):
                raise FsError("transfer roots must be sent in Hub authority", "trusted_hub_required")
            present = [field in authority for field in root_fields]
            scope = None
            if any(present):
                if not all(present) or any(not isinstance(authority[field], list) for field in root_fields):
                    raise FsError("shared transfer authority must include all operation root arrays", "trusted_hub_required")
                for field in root_fields:
                    self._scope_roots(authority, field, required=False)
                if expected_device == self.device:
                    if op in {"transfer_grant_issue", "transfer_move_finalize"}:
                        self._scope_roots(authority, "source_read_roots")
                        scope = {"read_roots": list(authority["source_read_roots"])}
                    if op == "transfer_move_finalize":
                        self._scope_roots(authority, "source_write_roots")
                        scope["write_roots"] = list(authority["source_write_roots"])
                    elif op in {"transfer_job_prepare", "transfer_job_start", "transfer_job_retry"}:
                        self._scope_roots(authority, "destination_write_roots")
                        scope = {"write_roots": list(authority["destination_write_roots"])}
                if scope is not None:
                    scope.update({"actor_id": authority.get("actor_id"),
                                  "operation_id": authority.get("operation_id")})
                    token = self._hub_file_scope.set(scope)
                    try:
                        args = {**args, "_hub_authority": authority}
                        return self.dispatch(op, args, trusted_hub=True)
                    finally:
                        self._hub_file_scope.reset(token)
            args = {**args, "_hub_authority": authority}
        return self.dispatch(op, args, trusted_hub=True)

    def _dispatch_hub_mesh(self, op: str, args: dict[str, Any], authority: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(authority, dict) or authority.get("kind") != "hub_mesh":
            raise FsError("missing trusted Hub mesh authority", "trusted_hub_required")
        required = ("actor_id", "target_id", "network_id", "instance_id", "operation_id", "service_ip",
                    "authorization_revision", "config_revision", "issued_at", "expires_at")
        if any(not authority.get(field) for field in required) or str(authority["target_id"]) != self.device:
            raise FsError("invalid Hub mesh authority", "trusted_hub_required")
        try:
            now = int(time.time())
            issued_at, expires_at = int(authority["issued_at"]), int(authority["expires_at"])
            config_revision = authority["config_revision"]
        except (TypeError, ValueError):
            raise FsError("invalid Hub mesh authority", "trusted_hub_required") from None
        if (issued_at > now + 5 or expires_at <= now or expires_at > now + 45 or
                expires_at > issued_at + 45 or type(config_revision) is not int or config_revision < 1):
            raise FsError("Hub mesh authority expired or malformed", "authorization_expired")
        if args or not isinstance(args, dict):
            raise FsError("mesh configuration must be sent only in trusted authority", "trusted_hub_required")
        if self.mesh_runtime is None:
            raise FsError("EasyTier runtime is not installed", "mesh_runtime_missing")
        network_id, instance_id = str(authority["network_id"]), str(authority["instance_id"])
        try:
            normalized_network_id = _mesh_uuid_hex(network_id)
            normalized_instance_id = _mesh_uuid_hex(instance_id)
        except FsError as exc:
            raise FsError("invalid Hub mesh UUID", "trusted_hub_required") from exc
        if op == "mesh_apply":
            config = authority.get("mesh_config")
            if (not isinstance(config, dict) or config.get("network_id") != network_id or
                    config.get("instance_id") != instance_id or config.get("revision") != config_revision):
                raise FsError("trusted mesh configuration does not match its authority", "trusted_hub_required")
            if config.get("service_ip") not in (None, authority["service_ip"]):
                raise FsError("mesh service address does not match trusted authority", "trusted_hub_required")
            if set(authority) - set(required) - {"kind", "mesh_config"}:
                raise FsError("unexpected fields in Hub mesh authority", "trusted_hub_required")
            config = {**config, "service_ip": authority["service_ip"]}
            try:
                current = self.mesh_runtime.status(instance_id)
            except Exception as exc:
                raise FsError(str(exc), getattr(exc, "code", "mesh_runtime_error")) from exc
            if ((current.get("network_id") is not None and
                 not _mesh_uuid_matches(current.get("network_id"), normalized_network_id)) or
                    (current.get("instance_id") is not None and
                     not _mesh_uuid_matches(current.get("instance_id"), normalized_instance_id))):
                raise FsError("mesh instance identity changed", "mesh_network_mismatch")
            if current.get("state") == "ready" and current.get("revision") != config_revision:
                if self._mesh_instance_busy(network_id):
                    raise FsError("EasyTier instance has active service or file operations", "mesh_busy")
            try:
                result = self.mesh_runtime.apply(config)
            except Exception as exc:
                raise FsError(str(exc), getattr(exc, "code", "mesh_runtime_error")) from exc
        else:
            if "mesh_config" in authority or set(authority) - set(required) - {"kind"}:
                raise FsError("unexpected fields in Hub mesh authority", "trusted_hub_required")
            try:
                result = (self.mesh_runtime.status_for_network(network_id) if op == "mesh_status"
                          else self.mesh_runtime.status(instance_id))
            except Exception as exc:
                raise FsError(str(exc), getattr(exc, "code", "mesh_runtime_error")) from exc
            if (op == "mesh_status" and result.get("instance_id") is not None and
                    not _mesh_uuid_matches(result.get("instance_id"), normalized_instance_id)):
                raise FsError("selected network maps to another mesh instance", "mesh_instance_mismatch")
            if (result.get("network_id") is not None and
                    not _mesh_uuid_matches(result.get("network_id"), normalized_network_id)):
                raise FsError("mesh instance belongs to another network", "mesh_network_mismatch")
            if result.get("revision") is not None and result.get("revision") != config_revision:
                raise FsError("mesh operation revision is stale", "stale_revision")
            if result.get("state") == "ready" and result.get("service_ip") != authority["service_ip"]:
                raise FsError("mesh service address does not match trusted authority", "mesh_service_ip_mismatch")
            if op == "mesh_remove":
                reasons = self._mesh_busy_reasons(network_id)
                if reasons:
                    raise FsError("EasyTier instance has active service or file operations", "mesh_busy")
                if result.get("state") == "unverified":
                    raise FsError("mesh process identity cannot be verified for removal", "mesh_process_unverified")
                pre_stop = result
                try:
                    result = self.mesh_runtime.stop(instance_id)
                except Exception as exc:
                    raise FsError(str(exc), getattr(exc, "code", "mesh_runtime_error")) from exc
                pre_stop_matches = (
                    _mesh_uuid_matches(pre_stop.get("instance_id"), normalized_instance_id) and
                    ((pre_stop.get("state") == "stopped" and
                      pre_stop.get("network_id") is None and pre_stop.get("revision") is None) or
                     (pre_stop.get("state") in {"ready", "stopped"} and
                      _mesh_uuid_matches(pre_stop.get("network_id"), normalized_network_id) and
                      pre_stop.get("revision") == config_revision))
                )
                if (pre_stop_matches and result.get("state") == "stopped" and
                        _mesh_uuid_matches(result.get("instance_id"), normalized_instance_id)):
                    result = {**result, "network_id": network_id, "revision": config_revision}
        if (result.get("network_id") is not None and
                not _mesh_uuid_matches(result.get("network_id"), normalized_network_id)):
            raise FsError("mesh runtime returned another network", "mesh_network_mismatch")
        if (result.get("instance_id") is not None and
                not _mesh_uuid_matches(result.get("instance_id"), normalized_instance_id)):
            raise FsError("mesh runtime returned another instance", "mesh_instance_mismatch")
        if result.get("revision") not in (None, config_revision):
            raise FsError("mesh runtime did not apply the requested revision", "stale_revision")
        if op == "mesh_apply" and result.get("state") != "ready":
            raise FsError("EasyTier did not confirm the requested configuration", "mesh_apply_unconfirmed")
        response = {"protocol": 1, "target_id": self.device, "network_id": network_id,
                "instance_id": instance_id, "state": result.get("state", "unverified"),
                "revision": result.get("revision"), "node": result.get("node"),
                "service_ip": result.get("service_ip"),
                "peers": result.get("peers")}
        if op == "mesh_status":
            reasons = self._mesh_busy_reasons(network_id)
            response.update({"busy": bool(reasons), "busy_reasons": reasons})
        return response

    def _mesh_busy_reasons(self, network_id: str) -> list[str]:
        now = time.time()
        reasons: list[str] = []
        access = getattr(self, "service_access", None)
        if access is not None:
            with access._lock:
                if any(worker.network_id == network_id and worker.lease_expires_at > now and
                       access._worker_alive(worker) for worker in access.workers.values()):
                    reasons.append("service_lease")
        jobs = getattr(self, "transfer_jobs", None)
        if jobs is not None and jobs.has_active_jobs(network_id=network_id):
            reasons.append("transfer_job")
        grants = getattr(self, "sftpgo_grants", None)
        if grants is not None and grants.has_active_grants(network_id=network_id):
            reasons.append("transfer_grant")
        desktop = getattr(access, "remote_desktop", None) if access is not None else None
        if desktop is not None:
            try:
                shares = desktop._load_shares()
                if any(int(item.get("expires_at") or 0) > int(now) and
                       item.get("target_id") == self.device for item in shares.values()
                       if isinstance(item, dict)):
                    reasons.append("remote_desktop_lease")
            except Exception:
                reasons.append("remote_desktop_state_unknown")
        return reasons

    def _mesh_instance_busy(self, network_id: str) -> bool:
        return bool(self._mesh_busy_reasons(network_id))

    def _op_service_catalog(self, _args: dict[str, Any]) -> dict[str, Any]:
        return self.service_access.catalog()

    def _op_service_grant_issue(self, args: dict[str, Any]) -> dict[str, Any]:
        authority = args.pop("_hub_authority", {})
        try:
            return self.service_access.issue(authority, args.get("lease_expires_at"))
        except ServiceAccessError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_service_grant_renew(self, args: dict[str, Any]) -> dict[str, Any]:
        authority = args.pop("_hub_authority", {})
        try:
            return self.service_access.renew(authority, args.get("lease_expires_at"))
        except ServiceAccessError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_service_grant_revoke(self, args: dict[str, Any]) -> dict[str, Any]:
        authority = args.pop("_hub_authority", {})
        try:
            return self.service_access.revoke(authority, str(args.get("reason") or ""))
        except ServiceAccessError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_list(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._read_guard(p)
        if not p.is_dir():
            raise FsError("not a directory", "not_dir")
        items = []
        try:
            children = list(p.iterdir())
        except PermissionError as exc:
            raise FsError(f"permission denied: {exc}", "denied") from exc
        scope = self._hub_file_scope.get()
        for child in sorted(children, key=lambda c: (not c.is_dir(), c.name.lower())):
            try:
                if scope is not None:
                    self._read_guard(child)
                st = child.stat()
                item = {"name": child.name, "path": str(child), "dir": child.is_dir(),
                        "size": st.st_size, "mtime": st.st_mtime,
                        "hidden": child.name.startswith(".")}
                if not child.is_dir() and not child.suffix:
                    item.update(self._file_format(child))
                items.append(item)
            except (OSError, FsError):
                continue
        writable = self.policy.can_write(p, op="write")[0]
        if scope is not None and scope.get("_owner_policy") is not True:
            try:
                self._require_scope_path(p, "write_roots", scope)
            except FsError:
                writable = False
        return {"path": str(p), "entries": items, "writable": writable}

    def _op_stat(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._read_guard(p)
        try:
            st = p.stat()
        except FileNotFoundError as exc:
            raise FsError("not found", "not_found") from exc
        writable = self.policy.can_write(p, op="write")[0]
        scope = self._hub_file_scope.get()
        if scope is not None and scope.get("_owner_policy") is not True:
            try:
                self._require_scope_path(p, "write_roots", scope)
            except FsError:
                writable = False
        return {"path": str(p), "dir": p.is_dir(), "size": st.st_size, "mtime": st.st_mtime,
                "version": _path_version(p) if p.is_file() else "",
                "writable": writable}

    def _op_direct_info(self, args: dict[str, Any]) -> dict[str, Any]:
        direct = getattr(self, "direct", None)
        if direct is None:
            raise FsError("direct api unavailable", "unavailable")
        return direct.info()

    def _croc_engine(self):
        croc = getattr(self, "croc", None)
        if croc is None or not croc.available():
            raise FsError("croc transfer engine is not available", "croc_missing")
        return croc

    def _croc_status(self) -> dict[str, Any]:
        croc = getattr(self, "croc", None)
        if croc is None:
            return {"engine": "croc", "state": "idle"}
        status = {**croc.status(), "engine": "croc"}
        context = self._croc_context
        if context:
            status.update({"transfer_id": context.get("transfer_id"),
                           "direction": context.get("direction"),
                           "staging": context.get("staging", ""),
                           "destination": context.get("destination", "")})
        return status

    def _op_transfer_send(self, args: dict[str, Any]) -> dict[str, Any]:
        croc = self._croc_engine()
        source = self._resolve(args.get("path"))
        self._read_guard(source)
        try:
            job = croc.send(str(source), str(args.get("code") or ""),
                            transfers=int(args.get("transfers") or 4))
        except Exception as exc:
            raise FsError(str(exc), getattr(exc, "code", "croc_error")) from exc
        self._croc_context = {"transfer_id": secrets.token_hex(8), "direction": "send",
                              "source": str(source), "job": job}
        return self._croc_status()

    def _op_transfer_receive(self, args: dict[str, Any]) -> dict[str, Any]:
        croc = self._croc_engine()
        destination = self._resolve(args.get("path"))
        if destination.exists() and not destination.is_dir():
            destination = destination.parent
        self._write_guard(destination, "write")
        destination.mkdir(parents=True, exist_ok=True)
        transfer_id = str(args.get("transfer_id") or secrets.token_hex(8))
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", transfer_id):
            raise FsError("invalid transfer id", "bad_args")
        staging = self.workspace / ".tether-incoming" / transfer_id
        staging.mkdir(parents=True, exist_ok=True)
        try:
            job = croc.receive(str(args.get("code") or ""), str(staging))
        except Exception as exc:
            raise FsError(str(exc), getattr(exc, "code", "croc_error")) from exc
        self._croc_context = {"transfer_id": transfer_id, "direction": "receive",
                              "staging": str(staging), "destination": str(destination), "job": job}
        return self._croc_status()

    def _op_transfer_info(self, args: dict[str, Any]) -> dict[str, Any]:
        croc = getattr(self, "croc", None)
        if croc is None:
            return {"engine": "croc", "legacy": True, "default_engine": "rclone-sftpgo",
                    "available": False, "version": "", "relay": False}
        return {"engine": "croc", "legacy": True, "default_engine": "rclone-sftpgo",
                **croc.info(), "cancel_by_transfer_id": True}

    def _transfer_capabilities(self) -> dict[str, Any]:
        rclone_path = str(getattr(self.transfer_jobs, "_binary", "") or "")
        rclone_ready = bool(rclone_path and Path(rclone_path).is_file())
        sftpgo_ready = bool(self.sftpgo_grants and self.sftpgo_grants.available())
        croc = getattr(self, "croc", None)
        croc_info = croc.info() if croc is not None else {"available": False}
        return {
            "transfer_engine": "rclone-sftpgo",
            "transfer_engines": {
                "rclone-sftpgo": {"state": "ready" if rclone_ready and sftpgo_ready else "unavailable",
                                  "rclone_available": rclone_ready, "sftpgo_available": sftpgo_ready},
                "croc": {"state": "legacy" if croc_info.get("available") else "unavailable",
                         "available": bool(croc_info.get("available")), "legacy": True},
            },
        }

    def _op_transfer_status(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self._croc_context and args.get("path"):
            p, part, transfer = self._transfer_part(args)
            return {"path": str(p), "transfer_id": transfer,
                    "offset": part.stat().st_size if part.exists() else 0,
                    "partial": part.exists(), "exists": p.exists()}
        return self._croc_status()

    def _op_transfer_cancel(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self._croc_context and args.get("path"):
            p, part, transfer = self._transfer_part(args)
            try:
                part.unlink(missing_ok=True)
            except OSError:
                raise FsError("could not remove the partial transfer", "write_failed") from None
            return {"path": str(p), "transfer_id": transfer, "cancelled": True}
        croc = getattr(self, "croc", None)
        if croc is None:
            return {"engine": "croc", "state": "idle"}
        context = self._croc_context
        requested_id = str(args.get("transfer_id") or "")
        if requested_id:
            if not context or context.get("transfer_id") != requested_id:
                return {"engine": "croc", "state": "unchanged", "cancelled": False}
            job = context.get("job")
        else:
            job = croc.job
        status = job.cancel() if job else {"state": "idle"}
        if requested_id and self._croc_context is not context:
            return {**status, "engine": "croc", "cancelled": False}
        staging = context.get("staging")
        if staging:
            shutil.rmtree(staging, ignore_errors=True)
        if not requested_id or self._croc_context is context:
            self._croc_context = {}
        return {**status, "engine": "croc"}

    def _op_transfer_finish(self, args: dict[str, Any]) -> dict[str, Any]:
        context = self._croc_context
        if not context or context.get("direction") != "receive":
            raise FsError("no receive transfer", "croc_no_transfer")
        status = self._croc_status()
        if status.get("state") != "completed":
            raise FsError("transfer is not complete", "croc_not_complete")
        staging = Path(context["staging"])
        entries = [entry for entry in staging.iterdir() if not entry.name.startswith(".")]
        if len(entries) != 1:
            raise FsError("expected exactly one received item", "croc_result_ambiguous")
        source = entries[0]
        destination = Path(context["destination"])
        self._write_guard(destination, "write")
        name = str(args.get("name") or source.name)
        if name != Path(name).name or name in (".", ".."):
            raise FsError("invalid destination name", "bad_args")
        target = destination / name
        if target.exists():
            if args.get("overwrite") is not True:
                raise FsError("destination already exists", "exists")
            if target.is_dir() or source.is_dir():
                raise FsError("cannot overwrite a directory", "exists")
            target.unlink()
        self._write_guard(target, "write")
        shutil.move(str(source), str(target))
        shutil.rmtree(staging, ignore_errors=True)
        self._croc_context = {}
        return {"path": str(target), "bytes": target.stat().st_size, "engine": "croc"}

    def _op_transfer_job_prepare(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            authority = args.pop("_hub_authority", {})
            grant_expires_at = _transfer_grant_expiry(args)
            prepared = {**args, **authority,
                        "executor_device_id": authority.get("executor_device_id"),
                        "expires_at": grant_expires_at}
            return self.transfer_jobs.prepare(prepared)
        except TransferJobError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_job_start(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            authority = args.pop("_hub_authority", {})
            args["_hub_authority"] = authority
            return self.transfer_jobs.start(args)
        except TransferJobError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_job_status(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.transfer_jobs.status(str(args.get("operation_id") or ""))
        except TransferJobError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_job_list(self, args: dict[str, Any]) -> dict[str, Any]:
        return self.transfer_jobs.list()

    def _op_transfer_job_cancel(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.transfer_jobs.cancel(str(args.get("operation_id") or ""))
        except TransferJobError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_job_retry(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.transfer_jobs.retry(args)
        except TransferJobError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_destination_fingerprint(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.transfer_jobs.destination_fingerprint(str(args.get("path") or ""))
        except TransferJobError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_grant_issue(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            authority = args.pop("_hub_authority", {})
            grant_expires_at = _transfer_grant_expiry(args)
            args["expires_at"] = grant_expires_at
            args["actor_id"] = authority.get("actor_id")
            args["source_device_id"] = authority.get("source_device_id")
            args["executor_device_id"] = authority.get("executor_device_id")
            args["authorization_revision"] = authority.get("authorization_revision")
            args["network_id"] = authority.get("network_id")
            args["mesh_host"] = self._network_address(str(authority.get("network_id") or ""))
            if args["mesh_host"] != str(authority.get("service_ip") or ""):
                raise FsError("transfer service address does not match selected network", "mesh_service_ip_mismatch")
            return self.sftpgo_grants.issue(args)
        except GrantError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_grant_revoke(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            args.pop("_hub_authority", None)
            return self.sftpgo_grants.revoke(args)
        except GrantError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_grant_renew(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            authority = args.pop("_hub_authority", {})
            grant_expires_at = _transfer_grant_expiry(args)
            args["expires_at"] = grant_expires_at
            args["actor_id"] = authority.get("actor_id")
            args["source_device_id"] = authority.get("source_device_id")
            args["executor_device_id"] = authority.get("executor_device_id")
            args["authorization_revision"] = authority.get("authorization_revision")
            args["network_id"] = authority.get("network_id")
            return self.sftpgo_grants.renew(args)
        except GrantError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_transfer_move_finalize(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            authority = args.pop("_hub_authority", {})
            args["authorization_revision"] = authority.get("authorization_revision")
            result = self.sftpgo_grants.finalize_move(args)
            for path in result.get("deleted", []):
                self.audit.add(op="transfer_move_finalize", path=str(path), mode=self.policy.data.get("mode"),
                               phase="result", result="deleted", operation_id=str(args.get("operation_id") or ""))
            for item in result.get("errors", []):
                self.audit.add(op="transfer_move_finalize", path=str(item.get("path") or ""), mode=self.policy.data.get("mode"),
                               phase="result", result="retained", reason=str(item.get("message") or "delete failed"),
                               operation_id=str(args.get("operation_id") or ""))
            return result
        except GrantError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _terminal_dispatch(self, action: str, args: dict[str, Any]) -> Any:
        terminal = getattr(self, "terminal", None)
        if terminal is None:
            raise FsError("terminal unavailable", "unavailable")
        try:
            return terminal.dispatch(action, args)
        except ValueError as exc:
            raise FsError(str(exc), "terminal_error") from None

    def _op_terminal_start(self, args: dict[str, Any]) -> Any:
        agent_id = str(args.get("agent") or "").strip()
        if agent_id:
            record = self.agents.get(agent_id)
            if not record or not record.get("available") or not record.get("command"):
                raise FsError("agent is not installed on this node", "agent_unavailable")
            command = [str(record["command"])] + [str(item) for item in (record.get("args") or [])]
            args = {**args, "command": command, "shell": "agent"}
            if record.get("cwd"):
                args["cwd"] = record["cwd"]
            if record.get("env"):
                args["env"] = record["env"]
        return self._terminal_dispatch("start", args)

    def _op_terminal_shells(self, args: dict[str, Any]) -> Any:
        return self._terminal_dispatch("shells", args)

    def _op_terminal_write(self, args: dict[str, Any]) -> Any:
        return self._terminal_dispatch("write", args)

    def _op_terminal_poll(self, args: dict[str, Any]) -> Any:
        return self._terminal_dispatch("poll", args)

    def _op_terminal_resize(self, args: dict[str, Any]) -> Any:
        return self._terminal_dispatch("resize", args)

    def _op_terminal_stop(self, args: dict[str, Any]) -> Any:
        return self._terminal_dispatch("stop", args)

    def _apps_dispatch(self, action: str, args: dict[str, Any]) -> Any:
        apps = getattr(self, "apps", None)
        if apps is None:
            raise FsError("apps unavailable", "unavailable")
        try:
            return apps.dispatch(action, args)
        except ValueError as exc:
            raise FsError(str(exc), "apps_error") from None

    def _op_apps_list(self, args: dict[str, Any]) -> Any:
        return self._apps_dispatch("list", args)

    def _acp_dispatch(self, action: str, args: dict[str, Any]) -> Any:
        acp = getattr(self, "acp", None)
        if acp is None:
            raise FsError("acp unavailable", "unavailable")
        try:
            return acp.dispatch(action, args)
        except ValueError as exc:
            raise FsError(str(exc), "acp_error") from None

    def _opencode_surface(self, result: dict[str, Any]) -> dict[str, Any]:
        if not result.get("running"):
            return result
        apps = getattr(self, "apps", None)
        if apps is None:
            return result
        try:
            listing = apps.list({})
        except Exception:
            return result
        for item in listing.get("apps") or []:
            if item.get("name") != "OpenCode":
                continue
            base = str(item.get("url") or "").rstrip("/")
            path = str(item.get("path") or "/")
            if base:
                result["url"] = base + (path if path.startswith("/") else "/" + path)
            break
        return result

    def _op_opencode_status(self, _args: dict[str, Any]) -> Any:
        return self._opencode_surface(self.opencode.status())

    def _op_opencode_start(self, _args: dict[str, Any]) -> Any:
        try:
            result = self.opencode.start()
        except ValueError as exc:
            raise FsError(str(exc), "opencode_error") from None
        result = self._opencode_surface(result)
        self.audit.add(op="opencode_start", path=str(self.opencode.workspace), mode=self.policy.data.get("mode"),
                       phase="result", result="ok" if result.get("running") else "failed")
        return result

    def _op_opencode_stop(self, _args: dict[str, Any]) -> Any:
        result = self.opencode.stop()
        self.audit.add(op="opencode_stop", path=str(self.opencode.workspace), mode=self.policy.data.get("mode"),
                       phase="result", result="ok")
        return result

    def _agents_runtime_surface(self, result: dict[str, Any]) -> dict[str, Any]:
        if not result.get("running"):
            return result
        apps = getattr(self, "apps", None)
        base = ""
        if apps is not None:
            listing = None
            for _ in range(6):
                try:
                    listing = apps.list({})
                except Exception:
                    listing = None
                if listing and any(isinstance(item, dict) and item.get("name") == "Agents"
                                   for item in listing.get("apps") or []):
                    break
                time.sleep(0.25)
            for item in (listing or {}).get("apps") or []:
                if isinstance(item, dict) and item.get("name") == "Agents":
                    base = str(item.get("url") or "").rstrip("/")
                    break
        # This URL is consumed by the APP viewer. A node-local loopback URL
        # points at the viewer's machine for remote nodes, so fail closed when
        # the app gateway has not published the node route yet.
        result["url"] = self.agents_runtime.surface_url(base) if base else ""
        result.pop("token", None)
        return result

    def _op_agents_runtime_status(self, _args: dict[str, Any]) -> Any:
        return self._agents_runtime_surface(self.agents_runtime.status())

    def _op_agents_runtime_start(self, args: dict[str, Any]) -> Any:
        try:
            result = self.agents_runtime.start(str(args.get("agent") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "agents_runtime_error") from None
        result = self._agents_runtime_surface(result)
        self.audit.add(op="agents_runtime_start", path=str(self.agents_runtime.workspace),
                       mode=self.policy.data.get("mode"),
                       phase="result", result="ok" if result.get("running") or result.get("installing") else "failed")
        return result

    def _op_agents_runtime_stop(self, _args: dict[str, Any]) -> Any:
        result = self.agents_runtime.stop()
        self.audit.add(op="agents_runtime_stop", path=str(self.agents_runtime.workspace),
                       mode=self.policy.data.get("mode"), phase="result", result="ok")
        return result

    def _op_agents_catalog(self, args: dict[str, Any]) -> Any:
        payload = self.agents.catalog(force=args.get("fresh") is True)
        for item in payload.get("agents") or []:
            item["accounts"] = self.accounts.supports(str(item.get("id") or ""))
        dsh = next((item for item in payload.get("agents") or [] if item.get("id") == "dsh"), None)
        if dsh is not None and self.dsh_web is not None:
            status = self.dsh_web.status()
            if status.get("running"):
                dsh.update({"available": True, "kind": "web", "transports": ["workbench"],
                            "version": dsh.get("version") or "DSH", "source": "service"})
        return payload

    def _op_agents_save(self, args: dict[str, Any]) -> Any:
        try:
            result = self.agents.save(args)
        except ValueError as exc:
            raise FsError(str(exc), "bad_args") from None
        self.audit.add(op="agents_save", path=str(self.agents.path), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", agent=str(args.get("id") or args.get("name") or ""))
        return result

    def _op_agents_delete(self, args: dict[str, Any]) -> Any:
        result = self.agents.remove(str(args.get("id") or ""))
        self.audit.add(op="agents_delete", path=str(self.agents.path), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", agent=str(args.get("id") or ""))
        return result

    def _op_agents_accounts(self, args: dict[str, Any]) -> Any:
        try:
            return self.accounts.list(str(args.get("id") or ""), fresh=args.get("fresh") is True)
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None

    def _op_agents_account_save(self, args: dict[str, Any]) -> Any:
        try:
            result = self.accounts.save(str(args.get("id") or ""), str(args.get("name") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None
        self.audit.add(op="agents_account_save", path=str(self.accounts.root), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", agent=str(args.get("id") or ""))
        return result

    def _op_agents_account_switch(self, args: dict[str, Any]) -> Any:
        try:
            result = self.accounts.switch(str(args.get("id") or ""), str(args.get("profile") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None
        self.audit.add(op="agents_account_switch", path=str(self.accounts.root), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", agent=str(args.get("id") or ""),
                       profile=str(args.get("profile") or ""))
        return result

    def _op_agents_account_delete(self, args: dict[str, Any]) -> Any:
        try:
            result = self.accounts.delete(str(args.get("id") or ""), str(args.get("profile") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None
        self.audit.add(op="agents_account_delete", path=str(self.accounts.root), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", agent=str(args.get("id") or ""),
                       profile=str(args.get("profile") or ""))
        return result

    def _op_agents_account_login_start(self, args: dict[str, Any]) -> Any:
        try:
            agent_id = str(args.get("id") or "")
            record = self.agents.get(agent_id) or {}
            result = self.accounts.login_start(agent_id, str(args.get("profile") or ""),
                                               str(record.get("command") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None
        except RuntimeError as exc:
            raise FsError(str(exc), "accounts_login") from None
        self.audit.add(op="agents_account_login_start", path=str(self.accounts.root),
                       mode=self.policy.data.get("mode"), phase="result", result="ok",
                       agent=str(args.get("id") or ""), profile=str(args.get("profile") or ""))
        return result

    def _op_agents_account_login_status(self, args: dict[str, Any]) -> Any:
        return self.accounts.login_status(str(args.get("login_id") or ""))

    def _op_agents_account_login_cancel(self, args: dict[str, Any]) -> Any:
        return self.accounts.login_cancel(str(args.get("login_id") or ""))

    def _op_agents_account_logout(self, args: dict[str, Any]) -> Any:
        try:
            result = self.accounts.logout(str(args.get("id") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None
        except RuntimeError as exc:
            raise FsError(str(exc), "accounts_logout") from None
        self.audit.add(op="agents_account_logout", path=str(self.accounts.root),
                       mode=self.policy.data.get("mode"), phase="result", result="ok",
                       agent=str(args.get("id") or ""))
        return result

    def _op_agents_account_probe(self, args: dict[str, Any]) -> Any:
        try:
            return self.accounts.probe(str(args.get("id") or ""), str(args.get("profile") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "accounts_error") from None

    def _op_agents_test(self, args: dict[str, Any]) -> Any:
        try:
            result = self.agents.test(str(args.get("id") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "agent_test") from None
        return result

    def _op_agents_install(self, args: dict[str, Any]) -> Any:
        try:
            result = self.agents.install(str(args.get("id") or ""))
        except ValueError as exc:
            raise FsError(str(exc), "agent_install") from None
        self.audit.add(op="agents_install", path=str(self.agents.path), mode=self.policy.data.get("mode"),
                       phase="result", result="ok" if result.get("installed") else "manual",
                       agent=str(args.get("id") or ""))
        return result

    def _op_acp_detect(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("detect", args)

    def _op_acp_start(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("start", args)

    def _op_acp_prompt(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("prompt", args)

    def _op_acp_poll(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("poll", args)

    def _op_acp_reply(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("reply", args)

    def _op_acp_cancel(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("cancel", args)

    def _op_acp_stop(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("stop", args)

    def _op_acp_set_model(self, args: dict[str, Any]) -> Any:
        return self._acp_dispatch("set_model", args)

    def _op_read(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._read_guard(p)
        if not p.is_file():
            raise FsError("not a file", "not_file")
        size = p.stat().st_size
        offset = max(0, int(args.get("offset") or 0))
        limit = min(MAX_READ, max(1, int(args.get("limit") or MAX_READ)))
        with p.open("rb") as fh:
            fh.seek(offset)
            chunk = fh.read(limit)
        binary = b"\x00" in chunk or (p.suffix.lower() not in TEXT_SUFFIXES and b"\x00" in chunk[:1024])
        exact = str(args.get("encoding") or "").lower() in {"base64", "binary"}
        result = {"path": str(p), "size": size, "offset": offset, "truncated": offset + len(chunk) < size,
                  "mtime": p.stat().st_mtime}
        if binary or exact:
            result.update({"binary": True, "base64": base64.b64encode(chunk).decode("ascii")})
        else:
            result.update({"binary": False, "text": chunk.decode("utf-8", errors="replace")})
        return result

    def _file_format(self, path: Path) -> dict[str, Any]:
        try:
            with path.open("rb") as stream:
                head = stream.read(512)
        except OSError:
            return {}
        checks = (
            (b"\x7fELF", "ELF 可执行", "application/x-elf"),
            (b"\x89PNG\r\n\x1a\n", "PNG 图片", "image/png"),
            (b"\xff\xd8\xff", "JPEG 图片", "image/jpeg"),
            (b"GIF87a", "GIF 图片", "image/gif"),
            (b"GIF89a", "GIF 图片", "image/gif"),
            (b"%PDF", "PDF 文档", "application/pdf"),
            (b"PK\x03\x04", "ZIP 压缩包", "application/zip"),
            (b"\x1f\x8b", "GZIP 压缩包", "application/gzip"),
        )
        for magic, label, mime in checks:
            if head.startswith(magic):
                return {"format": label, "mime": mime, "binary": True}
        if head.startswith(b"#!"):
            return {"format": "脚本", "mime": "text/x-script", "binary": False}
        if b"\x00" not in head:
            try:
                head.decode("utf-8")
                return {"format": "文本", "mime": "text/plain", "binary": False}
            except UnicodeDecodeError:
                pass
        return {"format": "二进制", "mime": "application/octet-stream", "binary": True}

    def _op_preview(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._read_guard(p)
        if not p.is_file():
            raise FsError("not a file", "not_file")
        suffix = p.suffix.lower()
        st = p.stat()
        size = st.st_size
        writable = self.policy.can_write(p, op="write")[0]
        scope = self._hub_file_scope.get()
        if scope is not None and scope.get("_owner_policy") is not True:
            try:
                self._require_scope_path(p, "write_roots", scope)
            except FsError:
                writable = False
        result: dict[str, Any] = {
            "path": str(p), "size": size, "writable": writable,
            "version": _path_version(p), "mtime": st.st_mtime,
            "editable": False,
        }
        if suffix in TEXT_SUFFIXES or suffix in MARKDOWN_SUFFIXES:
            with p.open("rb") as stream:
                chunk = stream.read(MAX_PREVIEW_TEXT)
            decoded = _decode_text(chunk)
            if decoded is None:
                result.update({"kind": "unsupported", "mime": mimetypes.guess_type(str(p))[0] or ""})
                return result
            text, encoding, newline = decoded
            truncated = size > MAX_PREVIEW_TEXT
            result.update({
                "kind": "markdown" if suffix in MARKDOWN_SUFFIXES else "text",
                "text": text, "encoding": encoding, "newline": newline,
                "truncated": truncated, "editable": writable and not truncated,
            })
            return result
        if suffix in IMAGE_SUFFIXES:
            if size > MAX_PREVIEW_BYTES:
                raise FsError("file too large to preview", "too_large")
            mime = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            result.update({"kind": "image", "mime": mime,
                           "base64": base64.b64encode(p.read_bytes()).decode("ascii")})
            return result
        if suffix == ".pdf":
            if size > MAX_PREVIEW_BYTES:
                raise FsError("file too large to preview", "too_large")
            result.update({"kind": "pdf", "mime": "application/pdf",
                           "base64": base64.b64encode(p.read_bytes()).decode("ascii")})
            return result
        if suffix == ".zip":
            try:
                with zipfile.ZipFile(p) as archive:
                    infos = archive.infolist()[:500]
                    text = "\n".join(f"{item.filename}\t{item.file_size}" for item in infos)
                result.update({"kind": "text", "text": text, "truncated": len(infos) >= 500,
                               "editable": False})
                return result
            except (OSError, zipfile.BadZipFile) as exc:
                raise FsError(f"invalid zip archive: {exc}", "preview_unavailable") from exc
        if suffix in (".xlsx", ".xlsm"):
            if size > MAX_PREVIEW_BYTES:
                raise FsError("file too large to preview", "too_large")
            try:
                rows = self._xlsx_rows(p)
                result.update({"kind": "text", "text": "\n".join(rows), "truncated": len(rows) >= 2000,
                               "editable": False})
                return result
            except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
                raise FsError(f"xlsx preview failed: {exc}", "preview_unavailable") from exc
        if suffix in OFFICE_KINDS:
            data, from_cache = self._office_pdf_cached(p, OFFICE_KINDS[suffix])
            if len(data) > MAX_PREVIEW_BYTES:
                raise FsError("converted preview too large", "too_large")
            self.audit.add(op="preview", path=str(p), mode=self.policy.data.get("mode"),
                           result="ok", converted=OFFICE_KINDS[suffix], from_cache=from_cache)
            result.update({"kind": "pdf", "mime": "application/pdf",
                           "base64": base64.b64encode(data).decode("ascii"), "converted": True})
            return result
        if size <= MAX_PREVIEW_BYTES:
            with p.open("rb") as stream:
                chunk = stream.read(MAX_PREVIEW_TEXT)
            decoded = _decode_text(chunk)
            if decoded is not None:
                text, encoding, newline = decoded
                truncated = size > MAX_PREVIEW_TEXT
                result.update({"kind": "text", "text": text, "encoding": encoding,
                               "newline": newline, "truncated": truncated,
                               "editable": writable and not truncated})
                return result
        detected = self._file_format(p)
        result.update({"kind": "unsupported", "mime": mimetypes.guess_type(str(p))[0] or "",
                       "format": detected.get("format") or "二进制"})
        return result

    def _xlsx_rows(self, source: Path) -> list[str]:
        namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        with zipfile.ZipFile(source) as archive:
            names = set(archive.namelist())
            shared: list[str] = []
            if "xl/sharedStrings.xml" in names:
                root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                for item in root.findall(namespace + "si"):
                    shared.append("".join(node.text or "" for node in item.iter(namespace + "t")))
            sheets = sorted(name for name in names if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
            if not sheets:
                raise ValueError("no worksheet")
            root = ET.fromstring(archive.read(sheets[0]))
        rows: list[str] = []
        for row in root.iter(namespace + "row"):
            values: list[str] = []
            for cell in row.findall(namespace + "c"):
                kind = cell.get("t")
                value_node = cell.find(namespace + "v")
                if kind == "s" and value_node is not None and value_node.text is not None:
                    index = int(value_node.text)
                    values.append(shared[index] if 0 <= index < len(shared) else "")
                elif kind == "inlineStr":
                    values.append("".join(node.text or "" for node in cell.iter(namespace + "t")))
                else:
                    values.append((value_node.text or "") if value_node is not None else "")
            rows.append("\t".join(values))
            if len(rows) >= 2000:
                break
        return rows

    def _office_cache_path(self, source: Path, kind: str) -> Path:
        st = source.stat()
        seed = f"{_norm(source)}|{st.st_mtime_ns}|{st.st_size}|{kind}|v1"
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
        return self.preview_cache_dir / (digest + ".pdf")

    def _office_pdf_cached(self, source: Path, kind: str) -> tuple[bytes, bool]:
        target = self._office_cache_path(source, kind)
        try:
            if target.is_file():
                return target.read_bytes(), True
        except OSError:
            pass
        with self._office_lock:
            try:
                if target.is_file():
                    return target.read_bytes(), True
            except OSError:
                pass
            data = self._office_pdf(source, kind)
            tmp = target.with_name(target.name + f".{os.getpid()}.tmp")
            try:
                tmp.write_bytes(data)
                os.replace(tmp, target)
            finally:
                try:
                    tmp.unlink()
                except OSError:
                    pass
            self._trim_preview_cache()
            return data, False

    def _trim_preview_cache(self) -> None:
        try:
            files = []
            for item in self.preview_cache_dir.iterdir():
                if not item.is_file() or item.suffix != ".pdf":
                    continue
                try:
                    st = item.stat()
                except OSError:
                    continue
                files.append((st.st_mtime, st.st_size, item))
        except OSError:
            return
        total = sum(size for _, size, _ in files)
        files.sort()
        while files and (len(files) > PREVIEW_CACHE_MAX_FILES or total > PREVIEW_CACHE_MAX_BYTES):
            _, size, item = files.pop(0)
            try:
                item.unlink()
                total -= size
            except OSError:
                pass

    def _office_pdf(self, source: Path, kind: str) -> bytes:
        try:
            return office_pdf(source, kind)
        except OfficePreviewError as exc:
            raise FsError(str(exc), exc.code) from exc

    def _op_write(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        content = args.get("text")
        if not isinstance(content, str):
            raise FsError("text is required", "bad_args")
        encoding = str(args.get("encoding") or "utf-8")
        newline = str(args.get("newline") or "lf")
        data = _encode_text(content, encoding, newline)
        self._write_guard(p, "write", bytes=len(data))
        if p.exists() and not args.get("overwrite", True):
            raise FsError("file exists", "exists")
        expected_version = args.get("expected_version")
        if expected_version is not None:
            if expected_version == "absent":
                if p.exists():
                    raise FsError("file exists", "conflict")
            elif not isinstance(expected_version, str) or len(expected_version) != 64:
                raise FsError("expected_version must be a SHA-256 digest", "bad_args")
            else:
                current_version = _path_version(p) if p.exists() else ""
                if current_version != expected_version:
                    raise FsError("file changed on target device", "conflict")
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tether-tmp." + secrets.token_hex(8))
        tmp.write_bytes(data)
        self._write_guard(p, "write", bytes=len(data))
        if expected_version == "absent":
            if p.exists():
                tmp.unlink(missing_ok=True)
                raise FsError("file appeared while saving", "conflict")
        elif isinstance(expected_version, str):
            current_version = _path_version(p) if p.exists() else ""
            if current_version != expected_version:
                tmp.unlink(missing_ok=True)
                raise FsError("file changed on target device", "conflict")
        os.replace(tmp, p)
        st = p.stat()
        version = _content_version(data)
        self.audit.add(op="write", path=str(p), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", bytes=len(data), version=version)
        return {"path": str(p), "bytes": len(data), "size": st.st_size,
                "mtime": st.st_mtime, "version": version,
                "encoding": encoding, "newline": newline}

    def _transfer_part(self, args: dict[str, Any]) -> tuple[Path, Path, str]:
        p = self._resolve(args.get("path"))
        transfer = str(args.get("transfer_id") or "")
        if not TRANSFER_ID_RE.fullmatch(transfer):
            raise FsError("transfer_id must be 8-32 lowercase hex characters", "bad_args")
        return p, p.with_name(p.name + ".tether-part." + transfer), transfer

    def _op_write_chunk(self, args: dict[str, Any]) -> dict[str, Any]:
        p, part, transfer = self._transfer_part(args)
        try:
            offset = int(args.get("offset"))
            total = int(args.get("total"))
        except (TypeError, ValueError):
            raise FsError("offset and total are required integers", "bad_args") from None
        encoded = args.get("base64")
        if not isinstance(encoded, str):
            raise FsError("base64 is required", "bad_args")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise FsError("base64 is invalid", "bad_args") from None
        if len(data) > MAX_WRITE_CHUNK:
            raise FsError("chunk exceeds 1 MiB", "bad_args")
        if total < 0 or total > MAX_TRANSFER_BYTES:
            raise FsError("total is out of range", "bad_args")
        if offset < 0 or offset + len(data) > total:
            raise FsError("chunk exceeds the declared size", "bad_args")
        final = args.get("final") is True
        if not data and not final and total:
            raise FsError("empty chunk", "bad_args")
        if final and offset + len(data) != total:
            raise FsError("final chunk does not complete the file", "bad_args")
        overwrite = args.get("overwrite") is True
        expected_version = args.get("expected_version")
        if expected_version is not None and expected_version != "absent" and (
                not isinstance(expected_version, str) or len(expected_version) != 64):
            raise FsError("expected_version must be a SHA-256 digest", "bad_args")
        if offset == 0:
            self._write_guard(p, "write", bytes=total)
            if p.exists() and not overwrite:
                raise FsError("file exists", "exists")
            if expected_version == "absent" and p.exists():
                raise FsError("file exists", "conflict")
            if isinstance(expected_version, str) and expected_version != "absent":
                current_version = _path_version(p) if p.exists() else ""
                if current_version != expected_version:
                    raise FsError("file changed on target device", "conflict")
            if part.exists() and args.get("resume") is not True:
                part.unlink()
        else:
            self._write_guard(p, "write", bytes=total)
            if not part.exists() or part.stat().st_size != offset:
                raise FsError("partial transfer offset does not match", "offset_mismatch")
        p.parent.mkdir(parents=True, exist_ok=True)
        with part.open("r+b" if part.exists() else "wb") as handle:
            handle.seek(offset)
            handle.write(data)
            handle.flush()
            if final:
                os.fsync(handle.fileno())
        if not final:
            return {"path": str(p), "transfer_id": transfer, "offset": offset + len(data),
                    "total": total, "complete": False}
        if part.stat().st_size != total:
            raise FsError("partial transfer is incomplete", "offset_mismatch")
        self._write_guard(p, "write", bytes=total)
        if expected_version == "absent" and p.exists():
            raise FsError("file appeared during upload", "conflict")
        if isinstance(expected_version, str) and expected_version != "absent":
            current_version = _path_version(p) if p.exists() else ""
            if current_version != expected_version:
                raise FsError("file changed on target device", "conflict")
        if p.exists() and not overwrite:
            raise FsError("file exists", "exists")
        os.replace(part, p)
        st = p.stat()
        version = _path_version(p)
        self.audit.add(op="transfer", path=str(p), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", bytes=total, version=version)
        return {"path": str(p), "transfer_id": transfer, "offset": total, "total": total,
                "size": st.st_size, "mtime": st.st_mtime, "version": version, "complete": True}

    def open_write_stream(self, path: Any, transfer_id: Any, total: int,
                          overwrite: bool, *, expected_version: str | None = None,
                          discard_on_abort: bool = False) -> _StreamWriter:
        p, part, transfer = self._transfer_part({"path": path, "transfer_id": transfer_id})
        if total < 0 or total > MAX_TRANSFER_BYTES:
            raise FsError("total is out of range", "bad_args")
        self._write_guard(p, "write", bytes=total)
        if expected_version == "absent":
            if p.exists():
                raise FsError("file exists", "conflict")
        elif expected_version is not None:
            if not isinstance(expected_version, str) or len(expected_version) != 64:
                raise FsError("expected_version must be a SHA-256 digest", "bad_args")
            current_version = _path_version(p) if p.exists() else ""
            if current_version != expected_version:
                raise FsError("file changed on target device", "conflict")
        elif p.exists() and not overwrite:
            raise FsError("file exists", "exists")
        p.parent.mkdir(parents=True, exist_ok=True)
        if part.exists():
            part.unlink()
        return _StreamWriter(self, p, part, part.open("wb"), total, transfer,
                             expected_version=expected_version, discard_on_abort=discard_on_abort)

    def _op_mkdir(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._write_guard(p, "mkdir")
        p.mkdir(parents=True, exist_ok=bool(args.get("exist_ok", True)))
        self.audit.add(op="mkdir", path=str(p), mode=self.policy.data.get("mode"),
                       phase="result", result="ok")
        return {"path": str(p)}

    def _op_rename(self, args: dict[str, Any]) -> dict[str, Any]:
        src = self._resolve(args.get("path"))
        dst = self._resolve(args.get("dest"))
        self._write_guard(src, "rename", dest=str(dst))
        self._write_guard(dst, "rename", source=str(src))
        if dst.exists() and not args.get("overwrite", False):
            raise FsError("destination exists", "exists")
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dst)
        st = dst.stat()
        self.audit.add(op="rename", path=str(src), dest=str(dst), mode=self.policy.data.get("mode"),
                       phase="result", result="ok")
        return {"path": str(src), "dest": str(dst), "size": st.st_size,
                "mtime": st.st_mtime,
                "version": _path_version(dst) if dst.is_file() else None}

    def _op_copy(self, args: dict[str, Any]) -> dict[str, Any]:
        src = self._resolve(args.get("path"))
        dst = self._resolve(args.get("dest"))
        self._read_guard(src)
        self._write_guard(dst, "copy", source=str(src))
        if not src.exists():
            raise FsError("not found", "not_found")
        if dst.exists():
            raise FsError("destination already exists", "exists")
        try:
            if src.is_dir():
                shutil.copytree(src, dst)
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
        except OSError as exc:
            raise FsError(f"copy failed: {exc}", "copy_failed") from exc
        self.audit.add(op="copy", path=str(src), dest=str(dst), mode=self.policy.data.get("mode"),
                       phase="result", result="ok")
        return {"path": str(src), "dest": str(dst)}

    def _op_delete(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._write_guard(p, "delete")
        if not p.exists():
            raise FsError("not found", "not_found")
        trash = self.workspaces_root / ".tether-trash"
        trash.mkdir(parents=True, exist_ok=True)
        target = trash / f"{time.strftime('%Y%m%d-%H%M%S')}-{p.name}"
        if target.exists():
            target = trash / f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns()}-{p.name}"
        shutil.move(str(p), str(target))
        self.audit.add(op="delete", path=str(p), dest=str(target), mode=self.policy.data.get("mode"),
                       phase="result", result="trashed")
        return {"path": str(p), "trash": str(target)}

    def _op_drives(self, _args: dict[str, Any]) -> dict[str, Any]:
        if os.name != "nt":
            return {"drives": [{"name": "根目录", "path": "/"}]}
        import string
        roots = []
        for letter in string.ascii_uppercase:
            path = Path(f"{letter}:\\")
            try:
                if path.exists():
                    roots.append({"name": f"{letter}:", "path": str(path)})
            except OSError:
                continue
        return {"drives": roots}

    def _op_workspaces(self, _args: dict[str, Any]) -> dict[str, Any]:
        return {"root": str(self.workspaces_root), "node_workspace": str(self.workspace),
                "workspaces": self.policy.workspaces()}

    def _op_policy_get(self, _args: dict[str, Any]) -> dict[str, Any]:
        return self.policy.public()

    def _op_policy_set(self, args: dict[str, Any]) -> dict[str, Any]:
        policy = self.policy.update(args)
        self.audit.add(op="policy", path=str(self.policy.path), mode=policy.get("mode"),
                       phase="result", result="updated", detail=policy)
        return policy

    def _op_audit_list(self, args: dict[str, Any]) -> dict[str, Any]:
        return self.audit.page(int(args.get("limit") or 100), int(args.get("offset") or 0))

    def _op_dsh_status(self, _args: dict[str, Any]) -> dict[str, Any]:
        return self.dsh_desktop.status()

    def _op_dsh_start(self, _args: dict[str, Any]) -> dict[str, Any]:
        result = self.dsh_desktop.start()
        self.audit.add(op="dsh_start", path=result.get("exe") or "", mode=self.policy.data.get("mode"),
                       phase="result", result="started" if result.get("running") else "requested")
        return result

    def _op_dsh_repair_auth(self, _args: dict[str, Any]) -> dict[str, Any]:
        result = self.dsh_desktop.repair_auth()
        self.audit.add(op="dsh_repair_auth", path=result.get("appdata_backup") or "", mode=self.policy.data.get("mode"),
                       phase="result", result="started")
        return result

    def _op_dsh_stop(self, _args: dict[str, Any]) -> dict[str, Any]:
        result = self.dsh_desktop.stop()
        self.audit.add(op="dsh_stop", path=result.get("exe") or "", mode=self.policy.data.get("mode"),
                       phase="result", result="stopped" if not result.get("running") else "still_running")
        return result

    def _op_dsh_restart(self, _args: dict[str, Any]) -> dict[str, Any]:
        result = self.dsh_desktop.restart()
        self.audit.add(op="dsh_restart", path=result.get("exe") or "", mode=self.policy.data.get("mode"),
                       phase="result", result="requested" if result.get("restarting") else "started")
        return result

    def _op_dsh_web_status(self, _args: dict[str, Any]) -> dict[str, Any]:
        if self.dsh_web is None:
            return {"supported": False, "installed": False, "running": False,
                    "installing": False, "url": ""}
        return self.dsh_web.status()

    def _op_dsh_web_install(self, _args: dict[str, Any]) -> dict[str, Any]:
        if self.dsh_web is None:
            raise FsError("DSH Web is unavailable in this node build", "unavailable")
        return self.dsh_web.install()

    def _op_dsh_web_start(self, _args: dict[str, Any]) -> dict[str, Any]:
        if self.dsh_web is None:
            raise FsError("DSH Web is unavailable in this node build", "unavailable")
        return self.dsh_web.start()

    def _op_dsh_web_stop(self, _args: dict[str, Any]) -> dict[str, Any]:
        if self.dsh_web is None:
            raise FsError("DSH Web is unavailable in this node build", "unavailable")
        return self.dsh_web.stop()

    def _op_dsh_web_repair(self, _args: dict[str, Any]) -> dict[str, Any]:
        if self.dsh_web is None:
            raise FsError("DSH Web is unavailable in this node build", "unavailable")
        result = self.dsh_web.repair_plugin()
        self.audit.add(op="dsh_web_repair", path="tether-dsh-plugin", mode=self.policy.data.get("mode"),
                       phase="intent", result="started" if result.get("repairing") else "skipped")
        return result

    def _op_dsh_install(self, _args: dict[str, Any]) -> dict[str, Any]:
        result = self.dsh_desktop.install()
        self.audit.add(op="dsh_install", path=result.get("exe") or "", mode=self.policy.data.get("mode"),
                       phase="intent", result="started" if result.get("installing") else "skipped")
        return result

    def _op_dsh_install_plugin(self, _args: dict[str, Any]) -> dict[str, Any]:
        result = install_dsh_plugin(self.dsh_desktop)
        self.audit.add(op="dsh_install_plugin", path=result.get("profile_path") or "",
                       mode=self.policy.data.get("mode"), phase="result", result="installed")
        return result
