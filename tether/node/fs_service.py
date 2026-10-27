"""Filesystem service for a Tether node.

Policy is enforced here, on the machine that owns the files, and every write is
audited before it happens. The controller only forwards calls; it cannot widen
policy on its own.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any


MAX_READ = 256 * 1024
MAX_PREVIEW_BYTES = 8 * 1024 * 1024
MAX_PREVIEW_TEXT = 512 * 1024
TEXT_SUFFIXES = {
    ".txt", ".md", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml",
    ".toml", ".ini", ".cfg", ".csv", ".log", ".xml", ".html", ".css", ".scss", ".sh", ".ps1",
    ".bat", ".cmd", ".c", ".h", ".cpp", ".hpp", ".java", ".go", ".rs", ".sql", ".env", ".gitignore",
}
MARKDOWN_SUFFIXES = {".md", ".markdown"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
OFFICE_KINDS = {".doc": "word", ".docx": "word", ".ppt": "powerpoint", ".pptx": "powerpoint"}
OFFICE_SCRIPT = r'''
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Output,
  [Parameter(Mandatory = $true)][string]$Kind
)
$ErrorActionPreference = 'Stop'
if ($Kind -eq 'word') {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $app.DisplayAlerts = 0
  try {
    $doc = $app.Documents.Open($Source, $false, $true)
    $doc.SaveAs([ref]$Output, [ref]17)
    $doc.Close($false)
  } finally { $app.Quit() }
} else {
  $app = New-Object -ComObject PowerPoint.Application
  try {
    $pres = $app.Presentations.Open($Source, $true, $false, $false)
    $pres.SaveAs($Output, 32)
    $pres.Close()
  } finally { $app.Quit() }
}
'''


def _norm(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def _inside(candidate: Path, root: Path) -> bool:
    try:
        return os.path.commonpath([_norm(candidate), _norm(root)]) == _norm(root)
    except ValueError:
        return False


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

    def __init__(self, path: Path, *, device: str, max_rows: int | None = None) -> None:
        self.path = Path(path)
        self.db_path = self.path.with_suffix(".db")
        self.device = device
        self.max_rows = max_rows or self.MAX_ROWS
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


class FsService:
    def __init__(self, *, device: str, workspace: Path, data_dir: Path, workspaces_root: Path) -> None:
        self.device = device
        self.workspace = workspace
        self.workspaces_root = workspaces_root
        self.workspaces_root.mkdir(parents=True, exist_ok=True)
        self.policy = Policy(data_dir / "policy.json", device=device,
                             node_workspace=workspace, workspaces_root=workspaces_root)
        self.audit = Audit(data_dir / "audit.jsonl", device=device)

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
        ok, why = self.policy.can_read(p)
        if not ok:
            self.audit.add(op="read", path=str(p), mode=self.policy.data.get("mode"),
                           result="denied", error=why)
            raise FsError(why, "denied")

    def _write_guard(self, p: Path, op: str, **extra: Any) -> None:
        ok, why = self.policy.can_write(p, op=op)
        self.audit.add(op=op, path=str(p), mode=self.policy.data.get("mode"),
                       phase="intent", result="allowed" if ok else "denied", reason=why, **extra)
        if not ok:
            raise FsError(why, "denied")

    def dispatch(self, op: str, args: dict[str, Any]) -> Any:
        handler = getattr(self, "_op_" + op, None)
        if handler is None:
            raise FsError(f"unknown fs op: {op}", "bad_op")
        return handler(args)

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
        for child in sorted(children, key=lambda c: (not c.is_dir(), c.name.lower())):
            try:
                st = child.stat()
                items.append({"name": child.name, "path": str(child), "dir": child.is_dir(),
                              "size": st.st_size, "mtime": st.st_mtime,
                              "hidden": child.name.startswith(".")})
            except OSError:
                continue
        writable = self.policy.can_write(p, op="write")[0]
        return {"path": str(p), "entries": items, "writable": writable}

    def _op_stat(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._read_guard(p)
        try:
            st = p.stat()
        except FileNotFoundError as exc:
            raise FsError("not found", "not_found") from exc
        return {"path": str(p), "dir": p.is_dir(), "size": st.st_size, "mtime": st.st_mtime,
                "writable": self.policy.can_write(p, op="write")[0]}

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
        result = {"path": str(p), "size": size, "offset": offset, "truncated": offset + len(chunk) < size,
                  "mtime": p.stat().st_mtime}
        if binary:
            result.update({"binary": True, "base64": base64.b64encode(chunk).decode("ascii")})
        else:
            result.update({"binary": False, "text": chunk.decode("utf-8", errors="replace")})
        return result

    def _op_preview(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        self._read_guard(p)
        if not p.is_file():
            raise FsError("not a file", "not_file")
        suffix = p.suffix.lower()
        size = p.stat().st_size
        writable = self.policy.can_write(p, op="write")[0]
        result: dict[str, Any] = {"path": str(p), "size": size, "writable": writable}
        if suffix in TEXT_SUFFIXES or suffix in MARKDOWN_SUFFIXES:
            chunk = p.read_bytes()[:MAX_PREVIEW_TEXT]
            result.update({
                "kind": "markdown" if suffix in MARKDOWN_SUFFIXES else "text",
                "text": chunk.decode("utf-8", errors="replace"),
                "truncated": size > MAX_PREVIEW_TEXT,
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
        if suffix in OFFICE_KINDS:
            data = self._office_pdf(p, OFFICE_KINDS[suffix])
            if len(data) > MAX_PREVIEW_BYTES:
                raise FsError("converted preview too large", "too_large")
            self.audit.add(op="preview", path=str(p), mode=self.policy.data.get("mode"),
                           result="ok", converted=OFFICE_KINDS[suffix])
            result.update({"kind": "pdf", "mime": "application/pdf",
                           "base64": base64.b64encode(data).decode("ascii"), "converted": True})
            return result
        result.update({"kind": "unsupported", "mime": mimetypes.guess_type(str(p))[0] or ""})
        return result

    def _office_pdf(self, source: Path, kind: str) -> bytes:
        if os.name != "nt":
            raise FsError("Office preview is only available on Windows", "unsupported")
        with tempfile.TemporaryDirectory(prefix="tether-preview-") as folder:
            script = Path(folder) / "convert.ps1"
            target = Path(folder) / "preview.pdf"
            script.write_text(OFFICE_SCRIPT, encoding="utf-8")
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                run = subprocess.run(
                    ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                     "-File", str(script), "-Source", str(source), "-Output", str(target),
                     "-Kind", kind],
                    capture_output=True, text=True, timeout=45, creationflags=flags,
                )
            except subprocess.TimeoutExpired:
                raise FsError("Office preview timed out", "preview_timeout") from None
            except OSError:
                raise FsError("Office preview is unavailable", "preview_unavailable") from None
            if run.returncode != 0 or not target.is_file():
                raise FsError("Office preview failed; WPS or Office is required", "preview_unavailable")
            return target.read_bytes()

    def _op_write(self, args: dict[str, Any]) -> dict[str, Any]:
        p = self._resolve(args.get("path"))
        content = args.get("text")
        if not isinstance(content, str):
            raise FsError("text is required", "bad_args")
        data = content.encode("utf-8")
        self._write_guard(p, "write", bytes=len(data))
        if p.exists() and not args.get("overwrite", True):
            raise FsError("file exists", "exists")
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tether-tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)
        self.audit.add(op="write", path=str(p), mode=self.policy.data.get("mode"),
                       phase="result", result="ok", bytes=len(data))
        return {"path": str(p), "bytes": len(data)}

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
        self.audit.add(op="rename", path=str(src), dest=str(dst), mode=self.policy.data.get("mode"),
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
