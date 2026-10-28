"""Safe, transactional updater for Tether APP, plugin, and node artifacts."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


UPDATER_VERSION = "0.2.3"
LEGACY_BASELINE_VERSION = "0.2.0"
UPDATE_PROTOCOL = 1
DEFAULT_MANIFEST_URL = (
    "https://github.com/qi001007/tether-harness/releases/latest/download/tether-update.json"
)
MAX_MANIFEST_BYTES = 256 * 1024
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_UNPACKED_BYTES = 256 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_FILES = 4096
MAX_COMPRESSION_RATIO = 150
COMPONENTS = {"app", "plugin", "node"}

PLUGIN_PACKAGE_MAP = {
    "dsh-plugin-tether": "tether-dsh-plugin",
    "dsh-plugin-tether-client": "tether-dsh-client",
    "tether-dsh-native-ui": "tether-dsh-native-ui",
    "tether-dsh-surface": "tether-dsh-surface",
}
PLUGIN_ALLOWED_FILES = {
    "dsh-plugin-tether": {"lib/index.js", "cordis.patch.yml", "package.json"},
    "dsh-plugin-tether-client": {"lib/index.js", "lib/client.js", "package.json", "version.json"},
    "tether-dsh-native-ui": {"lib/index.js", "lib/client.js", "package.json", "LICENSE", "README.md"},
    "tether-dsh-surface": {"lib/index.js", "lib/local-updates.js", "package.json"},
}
PLUGIN_UPDATER_FILES = {
    "updater/tether/__init__.py",
    "updater/tether/updates.py",
    "updater/tether/updates_cli.py",
    "updater/tether/node/__init__.py",
    "updater/tether/node/dsh_sessions.py",
}

APP_ALLOWED = (
    "apps/tether-app/",
    "packages/tether-ui/src/",
    "packages/tether-ui/web/",
    "assets/",
    "tether/updates.py",
    "tether/updates_cli.py",
    "desktop/install-app.ps1",
    "version.json",
)
NODE_ALLOWED = (
    "tether/",
    "laptop/tether-node.ps1",
    "laptop/bootstrap-node.ps1",
    "pyproject.toml",
    "version.json",
)
EXCLUDED_PARTS = {
    ".env", ".git", ".venv", "node_modules", "data", ".runtime", "work-local",
    "work", "__pycache__", ".pytest_cache", "credentials", ".credentials.yaml",
}
ERROR_MESSAGES = {
    "insecure_url": "更新地址必须使用受信任的 HTTPS 地址。",
    "insecure_redirect": "更新服务器尝试了不安全的跳转。",
    "manifest_missing": "当前更新源尚未提供统一更新清单。",
    "download_failed": "更新文件下载失败。",
    "download_too_large": "更新文件超过大小限制。",
    "hash_mismatch": "更新文件校验失败。",
    "invalid_manifest": "更新清单格式无效。",
    "unsupported_manifest": "更新清单版本不受支持。",
    "unsupported_protocol": "更新协议版本不兼容。",
    "updater_too_old": "当前更新器版本过旧。",
    "dirty_checkout": "检测到未提交的开发文件，已阻止更新以保留本地工作。",
    "plugin_package_missing": "DeepSeek Harness 桌面配置中缺少待更新的 Tether 插件包。",
    "plugin_profile_changed": "更新准备后当前 DSH profile 已变化，请重新检查并准备更新。",
    "dependency_change_requires_manual_install": "更新包含依赖变化，需要手动安装依赖后再更新。",
    "update_busy": "另一个更新正在进行。",
    "no_update": "当前组件已经是最新版本。",
    "apply_failed": "更新失败，已尝试恢复备份。",
    "rollback_failed": "更新失败且自动恢复未完成，原始文件备份已保留，请先恢复备份。",
    "local_state_error": "更新状态无法读取或写入。",
    "local_version_unknown": "无法确认当前安装版本，已阻止更新。",
    "target_missing": "未找到可更新的安装目录。",
    "checkout_state_unknown": "无法确认开发目录状态，已阻止更新。",
    "prepared_id_required": "apply 操作需要 prepared_id。",
    "prepared_stale": "准备的更新已过期，当前版本已变化，请重新检查和准备。",
    "invalid_archive_version": "更新压缩包版本与清单不一致。",
    "invalid_json": "更新数据格式无效。",
    "invalid_version": "更新版本号不符合 SemVer。",
    "invalid_response": "更新服务器返回了无效响应。",
    "file_not_allowed": "更新包包含不允许修改的文件。",
    "unsafe_archive_path": "更新包包含不安全的文件路径。",
    "unsafe_archive_entry": "更新包包含不安全的文件类型。",
    "invalid_archive": "更新压缩包损坏。",
    "invalid_archive_layout": "更新压缩包目录结构不受支持。",
    "incomplete_archive": "更新压缩包缺少必要组件文件。",
    "prepared_hash_mismatch": "暂存文件校验失败，请重新准备更新。",
    "app_busy": "APP或原生DSH中仍有运行任务，请等待任务结束后重试。",
}
ACTIVE_RUN_STATES = ("queued", "dispatching", "running", "cancelling")
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


class UpdateError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _semver(value: Any) -> tuple[int, int, int, tuple[str, ...]]:
    if not isinstance(value, str):
        raise UpdateError("invalid_version")
    match = SEMVER_RE.fullmatch(value)
    if not match:
        raise UpdateError("invalid_version")
    major, minor, patch = (int(match.group(i)) for i in (1, 2, 3))
    prerelease = tuple((match.group(4) or "").split(".")) if match.group(4) else ()
    return major, minor, patch, prerelease


def _is_newer(remote: str, current: str) -> bool:
    r = _semver(remote)
    c = _semver(current)
    if r[:3] != c[:3]:
        return r[:3] > c[:3]
    if not r[3] and c[3]:
        return True
    if r[3] and not c[3]:
        return False
    for left, right in zip(r[3], c[3]):
        if left == right:
            continue
        left_num = left.isdigit()
        right_num = right.isdigit()
        if left_num and right_num:
            return int(left) > int(right)
        if left_num != right_num:
            return not left_num
        return left > right
    return len(r[3]) > len(c[3])


def _json_object(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise UpdateError("invalid_json") from None
    if not isinstance(value, dict):
        raise UpdateError("invalid_json")
    return value


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, allow_loopback_http: bool) -> None:
        super().__init__()
        self.allow_loopback_http = allow_loopback_http

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old = urllib.parse.urlsplit(req.full_url)
        new = urllib.parse.urlsplit(newurl)
        if new.username or new.password or new.fragment:
            raise UpdateError("insecure_url")
        if old.scheme == "https" and new.scheme != "https":
            raise UpdateError("insecure_redirect")
        if new.scheme not in ({"https", "http"} if self.allow_loopback_http else {"https"}):
            raise UpdateError("insecure_url")
        if new.scheme == "http" and not _is_loopback(new.hostname):
            raise UpdateError("insecure_url")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    normalized = host.strip("[]").lower()
    return normalized == "localhost" or normalized == "::1" or normalized.startswith("127.")


class UpdateManager:
    """Check, stage, and apply allowlisted component updates from a trusted manifest."""

    def __init__(
        self,
        root: Path,
        component: str = "node",
        dsh_home: Path | None = None,
        manifest_url: str | None = None,
        state_dir: Path | None = None,
        profile: str = "desktop",
    ) -> None:
        if component not in COMPONENTS:
            raise ValueError("component must be app, plugin, or node")
        self.root = Path(root).expanduser().resolve()
        self.component = component
        if not isinstance(profile, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", profile):
            raise ValueError("profile must be a simple profile name")
        self.profile = profile
        self.dsh_home = Path(dsh_home or (Path.home() / ".dsh")).expanduser().resolve()
        self.state_dir = Path(state_dir or (self.root / ".runtime" / "updates")).expanduser().resolve()
        explicit_url = manifest_url is not None
        self.manifest_url = manifest_url or os.environ.get("TETHER_UPDATE_MANIFEST_URL") or DEFAULT_MANIFEST_URL
        self._allow_loopback_http = explicit_url and self._is_loopback_http_url(self.manifest_url)

    @staticmethod
    def _is_loopback_http_url(value: str) -> bool:
        parsed = urllib.parse.urlsplit(value)
        return parsed.scheme == "http" and _is_loopback(parsed.hostname)

    def _url_allowed(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        parsed = urllib.parse.urlsplit(value)
        if parsed.username or parsed.password or parsed.fragment or not parsed.hostname:
            return False
        if parsed.scheme == "https":
            return True
        return self._allow_loopback_http and parsed.scheme == "http" and _is_loopback(parsed.hostname)

    def _opener(self) -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(_SafeRedirectHandler(self._allow_loopback_http))

    def _fetch(self, url: str, limit: int) -> bytes:
        if not self._url_allowed(url):
            raise UpdateError("insecure_url")
        request = urllib.request.Request(url, headers={"User-Agent": "Tether-Updater/" + UPDATER_VERSION})
        try:
            with self._opener().open(request, timeout=15) as response:
                final_url = response.geturl()
                if not self._url_allowed(final_url):
                    raise UpdateError("insecure_redirect")
                length = response.headers.get("Content-Length")
                if length:
                    try:
                        if int(length) > limit:
                            raise UpdateError("download_too_large")
                    except ValueError:
                        raise UpdateError("invalid_response") from None
                chunks: list[bytes] = []
                total = 0
                while True:
                    chunk = response.read(min(64 * 1024, limit + 1 - total))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit:
                        raise UpdateError("download_too_large")
                    chunks.append(chunk)
                return b"".join(chunks)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise UpdateError("manifest_missing" if url == self.manifest_url else "download_failed") from None
            raise UpdateError("download_failed") from None
        except UpdateError:
            raise
        except (OSError, urllib.error.URLError, TimeoutError):
            raise UpdateError("download_failed") from None

    def _load_manifest(self) -> dict[str, Any]:
        manifest = _json_object(self._fetch(self.manifest_url, MAX_MANIFEST_BYTES))
        if type(manifest.get("schema")) is not int or manifest.get("schema") != 1:
            raise UpdateError("unsupported_manifest")
        components = manifest.get("components")
        if not isinstance(components, dict) or not COMPONENTS.issubset(components):
            raise UpdateError("invalid_manifest")
        for name in COMPONENTS:
            item = components.get(name)
            if not isinstance(item, dict):
                raise UpdateError("invalid_manifest")
            _semver(item.get("version"))
            _semver(item.get("min_updater"))
            if _is_newer(item["min_updater"], UPDATER_VERSION):
                raise UpdateError("updater_too_old")
            if type(item.get("protocol")) is not int or item.get("protocol") != UPDATE_PROTOCOL:
                raise UpdateError("unsupported_protocol")
            if not self._url_allowed(item.get("url")):
                raise UpdateError("insecure_url")
            if type(item.get("size")) is not int or not 0 < item["size"] <= MAX_ARCHIVE_BYTES:
                raise UpdateError("invalid_manifest")
            if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
                raise UpdateError("invalid_manifest")
        return manifest

    def _versions(self) -> dict[str, str]:
        path = self.root / "version.json"
        versions: dict[str, str] = {}
        if path.is_file():
            data = _json_object(path.read_bytes())
            components = data.get("components")
            if not isinstance(components, dict):
                raise UpdateError("local_version_invalid")
            for name in COMPONENTS:
                value = components.get(name, LEGACY_BASELINE_VERSION)
                _semver(value)
                versions[name] = value
        else:
            versions = {name: LEGACY_BASELINE_VERSION for name in COMPONENTS}
        if self.component == "plugin":
            versions["plugin"] = self._installed_plugin_version()
            return versions
        if self.dsh_home is not None:
            try:
                versions["plugin"] = self._installed_plugin_version()
            except UpdateError:
                pass
        return versions

    def _installed_plugin_version(self) -> str:
        client = self.dsh_home / "profiles" / self.profile / "node_modules" / "tether-dsh-client" / "lib" / "client.js"
        try:
            source = client.read_text(encoding="utf-8")
        except OSError:
            source = ""
        match = re.search(r"\bPLUGIN_VERSION\s*=\s*['\"]([^'\"]+)['\"]", source)
        if match:
            _semver(match.group(1))
            return match.group(1)
        package = client.parents[1] / "package.json"
        try:
            value = _json_object(package.read_bytes()).get("version")
            _semver(value)
            return value
        except (OSError, UpdateError):
            try:
                state = _json_object((self.state_dir / "installed-plugin.json").read_bytes())
                value = state.get("version", state.get("plugin_version"))
                _semver(value)
                return value
            except (OSError, UpdateError):
                raise UpdateError("local_version_unknown") from None

    def check(self) -> dict[str, Any]:
        try:
            current = self._versions()[self.component]
            manifest = self._load_manifest()
            remote = manifest["components"][self.component]
            version = remote["version"]
            newer = _is_newer(version, current)
            try:
                self.state_dir.mkdir(parents=True, exist_ok=True)
                self._write_atomic(
                    self.state_dir / f"latest-{self.component}.json",
                    (json.dumps({"schema": 1, "component": self.component, "version": version,
                                 "update_available": newer}, indent=2) + "\n").encode("utf-8"),
                )
            except OSError:
                pass
            return {"ok": True, "component": self.component, "current_version": current,
                    "latest_version": version, "update_available": newer, "error": ""}
        except UpdateError as exc:
            try:
                (self.state_dir / f"latest-{self.component}.json").unlink()
            except OSError:
                pass
            return self._error(exc.code)
        except OSError:
            return self._error("local_state_error")

    def activity(self) -> dict[str, Any]:
        """Return a prompt-free, fail-closed snapshot of local active work."""
        try:
            db_paths = set((self.root / "apps" / "tether-app" / "data").glob("node*.db"))
            db_paths.update((self.root / ".runtime").glob("node*.db"))
            for path in db_paths:
                try:
                    uri = path.resolve().as_uri() + "?mode=ro"
                    connection = sqlite3.connect(uri, uri=True, timeout=0.25)
                    try:
                        tables = {row[0] for row in connection.execute(
                            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
                        if "runs" not in tables:
                            return {"ok": True, "busy": True, "reason": "activity_unknown"}
                        marks = ",".join("?" for _ in ACTIVE_RUN_STATES)
                        row = connection.execute(
                            f"SELECT 1 FROM runs WHERE state IN ({marks}) LIMIT 1", ACTIVE_RUN_STATES
                        ).fetchone()
                        if row:
                            return {"ok": True, "busy": True, "reason": "node_run_active"}
                    finally:
                        connection.close()
                except (OSError, sqlite3.Error):
                    return {"ok": True, "busy": True, "reason": "activity_unknown"}

            sessions_dir = self.dsh_home / "sessions"
            if sessions_dir.exists():
                if not sessions_dir.is_dir():
                    return {"ok": True, "busy": True, "reason": "activity_unknown"}
                from .node.dsh_sessions import DshSessionStore, build_transcript, zstd

                try:
                    log_files = list(sessions_dir.rglob("session*.jsonl*"))
                except OSError:
                    return {"ok": True, "busy": True, "reason": "activity_unknown"}
                if any(path.suffix == ".zstd" for path in log_files) and zstd is None:
                    return {"ok": True, "busy": True, "reason": "activity_unknown"}
                store = DshSessionStore(self.dsh_home)
                latest: dict[Path, Path] = {}
                try:
                    files = store._files()
                    for path in files:
                        latest.setdefault(path.parent, path)
                except OSError:
                    return {"ok": True, "busy": True, "reason": "activity_unknown"}
                if {path.parent for path in log_files} - latest.keys():
                    return {"ok": True, "busy": True, "reason": "activity_unknown"}
                for path in latest.values():
                    rows = store._rows(path)
                    if not rows:
                        return {"ok": True, "busy": True, "reason": "activity_unknown"}
                    transcript = build_transcript(rows)
                    status = transcript.get("status")
                    if not transcript.get("session_id") or status not in {"running", "completed", "idle"}:
                        return {"ok": True, "busy": True, "reason": "activity_unknown"}
                    if status == "running":
                        return {"ok": True, "busy": True, "reason": "native_session_active"}
            return {"ok": True, "busy": False, "reason": ""}
        except Exception:
            return {"ok": True, "busy": True, "reason": "activity_unknown"}

    def _error(self, code: str) -> dict[str, Any]:
        return {"ok": False, "component": self.component, "error_code": code,
                "error": ERROR_MESSAGES.get(code, "更新操作失败。")}

    def _check_clean_checkout(self) -> None:
        if not (self.root / ".git").exists():
            return
        import subprocess

        try:
            result = subprocess.run(
                ["git", "-C", str(self.root), "status", "--porcelain", "--untracked-files=normal"],
                capture_output=True, text=True, timeout=10, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise UpdateError("checkout_state_unknown") from None
        if result.returncode != 0:
            raise UpdateError("checkout_state_unknown")
        if result.stdout.strip():
            raise UpdateError("dirty_checkout")

    def _check_plugin_targets(self) -> None:
        packages = self.dsh_home / "profiles" / self.profile / "node_modules"
        for package in PLUGIN_PACKAGE_MAP.values():
            if not (packages / package).is_dir():
                raise UpdateError("plugin_package_missing")

    def _check_dependencies(self, staged: list[tuple[Path, Path, str]]) -> None:
        for source, target, relative in staged:
            if self.component == "app" and relative == "apps/tether-app/package.json" and target.is_file():
                current = _json_object(target.read_bytes())
                offered = _json_object(source.read_bytes())
                for field in ("dependencies", "devDependencies"):
                    if current.get(field, {}) != offered.get(field, {}):
                        raise UpdateError("dependency_change_requires_manual_install")
            if self.component == "app" and relative == "apps/tether-app/package-lock.json" and target.is_file():
                current = _json_object(target.read_bytes()).get("packages", {}).get("", {})
                offered = _json_object(source.read_bytes()).get("packages", {}).get("", {})
                for field in ("dependencies", "devDependencies"):
                    if current.get(field, {}) != offered.get(field, {}):
                        raise UpdateError("dependency_change_requires_manual_install")
            if self.component == "node" and relative == "pyproject.toml" and target.is_file():
                if self._python_dependencies(target.read_bytes()) != self._python_dependencies(source.read_bytes()):
                    raise UpdateError("dependency_change_requires_manual_install")

    @staticmethod
    def _python_dependencies(raw: bytes) -> str:
        content = raw.decode("utf-8")
        def section(name: str) -> str:
            match = re.search(rf"(?ms)^\[{re.escape(name)}\]\s*(.*?)(?=^\[|\Z)", content)
            return match.group(1) if match else ""

        def field(block: str, name: str) -> str:
            match = re.search(rf"(?ms)^{re.escape(name)}\s*=\s*(.*?)(?=^[A-Za-z0-9_-]+\s*=|^\[|\Z)", block)
            return re.sub(r"\s+", "", match.group(1)) if match else ""

        project = section("project")
        optional = re.sub(r"\s+", "", section("project.optional-dependencies"))
        build_requires = field(section("build-system"), "requires")
        return "|".join((field(project, "dependencies"), field(project, "requires-python"),
                          field(project, "dynamic"), optional, build_requires))

    def _check_python_dependencies(self, offered: bytes) -> None:
        target = self.root / "pyproject.toml"
        if not target.is_file() or self._python_dependencies(target.read_bytes()) != self._python_dependencies(offered):
            raise UpdateError("dependency_change_requires_manual_install")

    def _component_files(self, path: str) -> tuple[Path, str] | None:
        raw_parts = path.split("/")
        device_names = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
        if any(not part or part in {".", ".."} or ":" in part or part.endswith((".", " "))
               or part.split(".", 1)[0].upper() in device_names for part in raw_parts):
            raise UpdateError("unsafe_archive_path")
        pure = PurePosixPath(path)
        if self.component in {"app", "node"}:
            if path == "version.json":
                return None
            if self.component == "app":
                if path in {"pyproject.toml", ".env.example", "README-INSTALL.md"}:
                    return None
                if path.startswith("tether/") and path not in {"tether/updates.py", "tether/updates_cli.py"}:
                    return None
                if path.startswith("apps/tether-app/") and pure.name in {"description.md", "backlog.md"}:
                    return None
                if path in {"packages/tether-ui/description.md", "packages/tether-ui/backlog.md"}:
                    return None
                if (path.startswith("packages/tether-ui/scripts/")
                        or path in {"packages/tether-ui/package.json", "packages/tether-ui/package-lock.json"}):
                    return None
                if path.startswith("packages/tether-ui/src/") and pure.name in {"description.md", "backlog.md"}:
                    return None
                if path.startswith("packages/tether-ui/web/") and pure.name in {"description.md", "backlog.md"}:
                    return None
                allowed = any(path.startswith(prefix) for prefix in APP_ALLOWED if prefix.endswith("/")) or path in APP_ALLOWED
                if not allowed:
                    raise UpdateError("file_not_allowed")
            else:
                if path in {"README-INSTALL.md", ".env.example"}:
                    return None
                if path.startswith("tether/") and pure.name in {"description.md", "backlog.md"}:
                    return None
                allowed = any(path.startswith(prefix) for prefix in NODE_ALLOWED if prefix.endswith("/")) or path in NODE_ALLOWED
                if not allowed:
                    raise UpdateError("file_not_allowed")
            if any(part in EXCLUDED_PARTS or part.startswith(".env") for part in pure.parts):
                raise UpdateError("file_not_allowed")
            return self.root.joinpath(*pure.parts), path

        if len(pure.parts) < 3 or pure.parts[0] != "packages":
            if path == "version.json":
                return None
            if path in {"README-INSTALL.md", "desktop/install-plugin.ps1", "scripts/build-native-ui-bridge.mjs"}:
                return None
            raise UpdateError("file_not_allowed")
        package_source = pure.parts[1]
        package_name = PLUGIN_PACKAGE_MAP.get(package_source)
        package_relative = "/".join(pure.parts[2:])
        if package_name and pure.parts[2:] in (('description.md',), ('backlog.md',)):
            return None
        if package_name and pure.parts[2:] in (('README.md',), ('LICENSE',), ('icon.svg',)):
            return None
        if package_name and pure.parts[2:][-1:] in (('description.md',), ('backlog.md',)):
            return None
        if package_name == "tether-dsh-surface" and package_relative in PLUGIN_UPDATER_FILES:
            target_relative = Path("profiles") / self.profile / "node_modules" / package_name / Path(*pure.parts[2:])
            target = self.dsh_home / target_relative
            if not (self.dsh_home / "profiles" / self.profile / "node_modules" / package_name).is_dir():
                raise UpdateError("plugin_package_missing")
            return target, str(target_relative)
        if not package_name or package_relative not in PLUGIN_ALLOWED_FILES[package_source]:
            raise UpdateError("file_not_allowed")
        relative = Path("profiles") / self.profile / "node_modules" / package_name
        target = self.dsh_home / relative / Path(*pure.parts[2:])
        if not (self.dsh_home / relative).is_dir():
            raise UpdateError("plugin_package_missing")
        return target, str(relative / Path(*pure.parts[2:]))

    def _safe_target(self, target: Path) -> Path:
        base = self.dsh_home if self.component == "plugin" else self.root
        base = base.resolve()
        resolved = target.resolve(strict=False)
        try:
            resolved.relative_to(base)
        except ValueError:
            raise UpdateError("unsafe_target") from None
        cursor = base
        for part in target.relative_to(base).parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise UpdateError("unsafe_target")
        return resolved

    def _validate_archive(self, data: bytes, item: dict[str, Any], prepared_root: Path) -> list[tuple[Path, Path, str]]:
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise UpdateError("hash_mismatch")
        expected_prefix = f"tether-{self.component}-{item['version']}"
        staged: list[tuple[Path, Path, str]] = []
        seen: set[str] = set()
        total_unpacked = 0
        version_found = False
        try:
            archive = zipfile.ZipFile(io.BytesIO(data))
        except (zipfile.BadZipFile, OSError):
            raise UpdateError("invalid_archive") from None
        with archive:
            infos = archive.infolist()
            if len(infos) > MAX_ARCHIVE_FILES:
                raise UpdateError("archive_too_many_files")
            for info in infos:
                name = info.filename
                if "\\" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
                    raise UpdateError("unsafe_archive_path")
                is_dir = info.is_dir()
                raw_parts = name.split("/")
                if is_dir and raw_parts[-1] == "":
                    raw_parts = raw_parts[:-1]
                if not raw_parts or any(part in {"", ".", ".."} for part in raw_parts):
                    raise UpdateError("unsafe_archive_path")
                device_names = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
                for part in raw_parts:
                    if ":" in part or part.endswith((".", " ")) or part.split(".", 1)[0].upper() in device_names:
                        raise UpdateError("unsafe_archive_path")
                pure = PurePosixPath(*raw_parts)
                if not pure.parts or pure.parts[0] != expected_prefix:
                    raise UpdateError("invalid_archive_layout")
                mode = info.external_attr >> 16
                file_type = stat.S_IFMT(mode)
                if file_type == stat.S_IFLNK:
                    raise UpdateError("unsafe_archive_entry")
                if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise UpdateError("unsafe_archive_entry")
                if is_dir and file_type == stat.S_IFREG or not is_dir and file_type == stat.S_IFDIR:
                    raise UpdateError("unsafe_archive_entry")
                if info.flag_bits & 1:
                    raise UpdateError("encrypted_archive")
                if is_dir:
                    continue
                relative_parts = pure.parts[1:]
                if not relative_parts:
                    raise UpdateError("invalid_archive_layout")
                relative = "/".join(relative_parts)
                if relative.casefold() in seen:
                    raise UpdateError("duplicate_archive_path")
                seen.add(relative.casefold())
                if info.file_size > MAX_FILE_BYTES:
                    raise UpdateError("file_too_large")
                if info.file_size and (not info.compress_size or info.file_size / info.compress_size > MAX_COMPRESSION_RATIO):
                    raise UpdateError("compression_ratio_exceeded")
                mapping = self._component_files(relative)
                if mapping is None:
                    if relative == "version.json":
                        version_doc = _json_object(archive.read(info))
                        offered = version_doc.get("components", {})
                        if not isinstance(offered, dict) or offered.get(self.component) != item["version"]:
                            raise UpdateError("invalid_archive_version")
                        version_found = True
                        continue
                    if relative == "pyproject.toml" and self.component == "app":
                        self._check_python_dependencies(archive.read(info))
                        continue
                    if self._component_files(relative) is None and (
                        self.component == "app" and (relative in {".env.example", "README-INSTALL.md"}
                        or relative.startswith("tether/") or relative.startswith("packages/tether-ui/")
                        or relative.startswith("apps/tether-app/") and PurePosixPath(relative).name in {"description.md", "backlog.md"})
                        or self.component == "plugin" and (relative in {"README-INSTALL.md", "desktop/install-plugin.ps1",
                        "scripts/build-native-ui-bridge.mjs"} or relative.startswith("packages/"))
                        or self.component == "node" and (relative in {"README-INSTALL.md", ".env.example"}
                        or relative.startswith("tether/") and PurePosixPath(relative).name in {"description.md", "backlog.md"})
                    ):
                        continue
                    if relative != "version.json":
                        raise UpdateError("file_not_allowed")
                    raise UpdateError("file_not_allowed")
                target, relative_target = mapping
                staged_path = prepared_root.joinpath(*PurePosixPath(relative).parts)
                staged_path.parent.mkdir(parents=True, exist_ok=True)
                actual_file_size = 0
                with archive.open(info, "r") as src, staged_path.open("xb") as dst:
                    while True:
                        chunk = src.read(64 * 1024)
                        if not chunk:
                            break
                        actual_file_size += len(chunk)
                        total_unpacked += len(chunk)
                        if actual_file_size > MAX_FILE_BYTES or total_unpacked > MAX_UNPACKED_BYTES:
                            raise UpdateError("archive_too_large_unpacked")
                        dst.write(chunk)
                if actual_file_size != info.file_size:
                    raise UpdateError("invalid_archive")
                staged.append((staged_path, target, relative))
            required = {
                "app": {"version.json", "apps/tether-app/main.js", "apps/tether-app/preload.js",
                        "apps/tether-app/package.json", "packages/tether-ui/src/app.js",
                        "tether/updates.py", "tether/updates_cli.py"},
                "node": {"version.json", "pyproject.toml", "tether/node/agent.py",
                         "tether/updates.py", "tether/updates_cli.py"},
                "plugin": {"version.json", "packages/dsh-plugin-tether/package.json",
                           "packages/dsh-plugin-tether-client/lib/client.js",
                           "packages/tether-dsh-native-ui/lib/client.js",
                           "packages/tether-dsh-surface/lib/index.js",
                           "packages/tether-dsh-surface/lib/local-updates.js",
                           *("packages/tether-dsh-surface/" + path for path in PLUGIN_UPDATER_FILES)},
            }[self.component]
            if not version_found or not required.issubset(seen):
                raise UpdateError("incomplete_archive")
            if not staged:
                raise UpdateError("empty_archive")
        return staged

    def prepare(self) -> dict[str, Any]:
        prepared_root: Path | None = None
        try:
            self._check_clean_checkout()
            if not self.root.is_dir():
                raise UpdateError("target_missing")
            if self.component == "plugin":
                self._check_plugin_targets()
            current = self._versions()[self.component]
            manifest = self._load_manifest()
            item = manifest["components"][self.component]
            target_version = item["version"]
            if not _is_newer(target_version, current):
                return self._error("no_update")
            archive_bytes = self._fetch(item["url"], MAX_ARCHIVE_BYTES)
            prepared_id = uuid.uuid4().hex
            self.state_dir.mkdir(parents=True, exist_ok=True)
            prepared_root = self.state_dir / "prepared" / prepared_id
            prepared_root.mkdir(parents=True, exist_ok=False)
            staged = self._validate_archive(archive_bytes, item, prepared_root)
            self._check_dependencies(staged)
            record = {
                "id": prepared_id, "component": self.component, "from_version": current,
                "to_version": target_version, "sha256": item["sha256"], "size": item["size"],
                "profile": self.profile if self.component == "plugin" else None,
                "files": [{"path": entry[2], "sha256": _sha256_path(entry[0]),
                           "size": entry[0].stat().st_size} for entry in staged],
            }
            (prepared_root / "prepared.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
            return {"ok": True, "prepared_id": prepared_id, "component": self.component,
                    "from_version": current, "to_version": target_version,
                    "size": item["size"], "sha256": item["sha256"], "error": ""}
        except UpdateError as exc:
            if prepared_root is not None:
                shutil.rmtree(prepared_root, ignore_errors=True)
            return self._error(exc.code)
        except OSError:
            if prepared_root is not None:
                shutil.rmtree(prepared_root, ignore_errors=True)
            return self._error("local_state_error")
        except Exception:
            if prepared_root is not None:
                shutil.rmtree(prepared_root, ignore_errors=True)
            return self._error("download_failed")

    def _lock(self) -> tuple[int, Path]:
        if self.component == "plugin":
            lock = self.dsh_home / "storages" / "tether" / "update.apply.lock"
        else:
            lock = self.root / ".runtime" / "update.apply.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        try:
            return os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), lock
        except FileExistsError:
            raise UpdateError("update_busy") from None

    def _load_prepared(self, prepared_id: str) -> tuple[Path, dict[str, Any], list[tuple[Path, Path, str]]]:
        if not re.fullmatch(r"[a-f0-9]{32}", prepared_id):
            raise UpdateError("invalid_prepared_id")
        prepared_root = self.state_dir / "prepared" / prepared_id
        try:
            record = _json_object((prepared_root / "prepared.json").read_bytes())
        except OSError:
            raise UpdateError("prepared_not_found") from None
        if record.get("id") != prepared_id or record.get("component") != self.component:
            raise UpdateError("prepared_mismatch")
        if self.component == "plugin" and record.get("profile") != self.profile:
            raise UpdateError("plugin_profile_changed")
        staged: list[tuple[Path, Path, str]] = []
        for item in record.get("files", []):
            if not isinstance(item, dict):
                raise UpdateError("prepared_mismatch")
            relative = item.get("path")
            if not isinstance(relative, str):
                raise UpdateError("prepared_mismatch")
            mapping = self._component_files(relative)
            if mapping is None:
                continue
            target, _relative_target = mapping
            staged_path = prepared_root.joinpath(*PurePosixPath(relative).parts)
            if not staged_path.is_file():
                raise UpdateError("prepared_file_missing")
            if staged_path.stat().st_size != item.get("size") or _sha256_path(staged_path) != item.get("sha256"):
                raise UpdateError("prepared_hash_mismatch")
            staged.append((staged_path, target, relative))
        if not staged:
            raise UpdateError("prepared_empty")
        return prepared_root, record, staged

    def _write_atomic(self, target: Path, data: bytes) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=".tether-update-", dir=target.parent)
        temp = Path(temp_name)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(temp, target)
        finally:
            if temp.exists():
                temp.unlink()

    def apply(self, prepared_id: str) -> dict[str, Any]:
        lock_fd = None
        lock_path: Path | None = None
        replaced: list[tuple[Path, Path | None]] = []
        backup_dir: Path | None = None
        try:
            lock_fd, lock_path = self._lock()
            self._check_clean_checkout()
            prepared_root, record, staged = self._load_prepared(prepared_id)
            expected_version = record["to_version"]
            _semver(expected_version)
            current = self._versions()[self.component]
            if record.get("from_version") != current or not _is_newer(expected_version, current):
                raise UpdateError("prepared_stale")
            if self.component in {"app", "plugin"} and self.activity()["busy"]:
                raise UpdateError("app_busy")
            self._check_dependencies(staged)
            base = self.dsh_home if self.component == "plugin" else self.root
            backup_dir = self.state_dir / "backups" / self.component / prepared_id
            backup_dir.mkdir(parents=True, exist_ok=False)
            for source, target, relative in staged:
                safe_target = self._safe_target(target)
                backup: Path | None = None
                if safe_target.exists():
                    backup = backup_dir / Path(*PurePosixPath(relative).parts)
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(safe_target, backup)
                replaced.append((safe_target, backup))
                self._write_atomic(safe_target, source.read_bytes())

            installed_path = self.state_dir / f"installed-{self.component}.json"
            applied_path = self.state_dir / f"applied-{self.component}.json"
            for path, content in (
                (applied_path, {"schema": 1, "component": self.component, "version": expected_version,
                                "restart_required": True}),
                (installed_path, {"schema": 1, "component": self.component, "version": expected_version}),
            ):
                backup: Path | None = None
                if path.exists():
                    backup = backup_dir / "state" / path.name
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, backup)
                replaced.append((path, backup))
                self._write_atomic(path, (json.dumps(content, indent=2) + "\n").encode("utf-8"))

            if self.component != "plugin":
                versions = self._versions()
                versions[self.component] = expected_version
                version_bytes = (json.dumps({"schema": 1, "components": versions}, indent=2) + "\n").encode("utf-8")
                version_target = self.root / "version.json"
                safe_version_target = self._safe_target(version_target)
                version_backup: Path | None = None
                if safe_version_target.exists():
                    version_backup = backup_dir / "version.json"
                    version_backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(safe_version_target, version_backup)
                replaced.append((safe_version_target, version_backup))
                self._write_atomic(safe_version_target, version_bytes)
            try:
                shutil.rmtree(prepared_root, ignore_errors=True)
            except OSError:
                pass
            return {"ok": True, "component": self.component, "version": expected_version,
                    "backup_dir": str(backup_dir), "restart_required": True,
                    "updated_files": len(staged), "error": ""}
        except UpdateError as exc:
            rolled_back = self._rollback(replaced)
            return self._error("rollback_failed" if not rolled_back else exc.code)
        except Exception:
            rolled_back = self._rollback(replaced)
            return self._error("apply_failed" if rolled_back else "rollback_failed")
        finally:
            if lock_fd is not None:
                os.close(lock_fd)
                try:
                    if lock_path is not None:
                        lock_path.unlink()
                except OSError:
                    pass

    def _rollback(self, replaced: list[tuple[Path, Path | None]]) -> bool:
        success = True
        for target, backup in reversed(replaced):
            try:
                if backup is None:
                    if target.exists():
                        target.unlink()
                elif backup.exists():
                    self._write_atomic(target, backup.read_bytes())
                else:
                    success = False
            except OSError:
                success = False
        return success

    def status(self) -> dict[str, Any]:
        try:
            current = self._versions()[self.component]
            prepared_dir = self.state_dir / "prepared"
            prepared: list[dict[str, str]] = []
            if prepared_dir.is_dir():
                for path in prepared_dir.iterdir():
                    try:
                        record = _json_object((path / "prepared.json").read_bytes())
                    except (OSError, UpdateError):
                        continue
                    if record.get("component") != self.component:
                        continue
                    to_version = record.get("to_version")
                    if not isinstance(to_version, str):
                        continue
                    try:
                        if not _is_newer(to_version, current):
                            continue
                    except UpdateError:
                        continue
                    prepared.append({"prepared_id": str(record.get("id") or ""),
                                     "to_version": to_version})
            restart_required = False
            try:
                applied = _json_object((self.state_dir / f"applied-{self.component}.json").read_bytes())
                restart_required = applied.get("component") == self.component and applied.get("restart_required") is True
            except (OSError, UpdateError):
                pass
            installed_latest: bool | None = None
            try:
                latest = _json_object((self.state_dir / f"latest-{self.component}.json").read_bytes())
                if latest.get("component") == self.component and isinstance(latest.get("version"), str):
                    installed_latest = latest["version"] == current
            except (OSError, UpdateError):
                pass
            if prepared:
                installed_latest = False
            return {"ok": True, "component": self.component, "current_version": current,
                    "prepared": prepared, "restart_required": restart_required,
                    "installed_latest": installed_latest, "error": ""}
        except UpdateError as exc:
            return self._error(exc.code)
        except OSError:
            return self._error("local_state_error")
