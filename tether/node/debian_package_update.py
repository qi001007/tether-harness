"""Install a prepared, signature-verified Tether Debian package outside the Node cgroup."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

from .mesh_runtime import MeshRuntimeError, secure_private_directory

PACKAGE = "tether-node"
ARCHITECTURE = "amd64"
OWNER = "deb_package_manager"
PREPARED_ID_RE = re.compile(r"^[a-f0-9]{32}$")
VERSION_RE = re.compile(r"^[A-Za-z0-9.+:~_-]{1,128}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class DebianPackageUpdateError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class DebianPackageUpdater:
    """Validate an UpdateManager prepared artifact and schedule native dpkg work."""

    def __init__(self, data_dir: Path, owner: str | None = None) -> None:
        self.data_dir = Path(data_dir).resolve()
        self.owner = (owner if owner is not None else
                      os.environ.get("TETHER_NODE_UPDATE_OWNER", "")).strip().lower()
        self.packages_dir = self.data_dir / "packages"
        self.transactions_dir = self.packages_dir / "transactions"

    def _run(self, argv: list[str], *, timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise DebianPackageUpdateError("package_manager_unavailable",
                                           "Debian package manager command is unavailable") from exc

    def _os_id(self) -> str:
        try:
            return str(platform.freedesktop_os_release().get("ID", "")).lower()
        except (AttributeError, OSError):
            values: dict[str, str] = {}
            try:
                for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
                    key, sep, value = line.partition("=")
                    if sep and key in {"ID", "ID_LIKE"}:
                        values[key] = value.strip().strip('"').lower()
            except OSError:
                return ""
            return values.get("ID", "") or values.get("ID_LIKE", "")

    def _installed(self) -> dict[str, str] | None:
        result = self._run(["dpkg-query", "-W", "-f=${db:Status-Status}\t${Version}\t${Architecture}", PACKAGE])
        if result.returncode != 0:
            return None
        fields = result.stdout.strip().split("\t")
        if len(fields) != 3 or fields[0] != "installed":
            return None
        return {"version": fields[1], "architecture": fields[2]}

    def _systemd_owner(self) -> bool:
        result = self._run(["systemctl", "show", "--property=MainPID", "--value", "tether-node.service"])
        return result.returncode == 0 and result.stdout.strip().isdigit() \
            and int(result.stdout.strip()) == os.getpid()

    def availability(self) -> dict[str, Any]:
        reason = ""
        current = self._installed() if shutil.which("dpkg-query") else None
        transaction = self.transaction_status()
        if self.owner != OWNER:
            reason = "package_update_not_owned"
        elif platform.system() != "Linux" or self._os_id() not in {"debian", "ubuntu"}:
            reason = "unsupported_platform"
        elif os.geteuid() != 0:
            reason = "root_required"
        elif platform.machine().lower() not in {"x86_64", "amd64"}:
            reason = "unsupported_architecture"
        elif not shutil.which("dpkg-deb") or not shutil.which("dpkg") or not shutil.which("dpkg-query"):
            reason = "dpkg_unavailable"
        elif not shutil.which("apt-get"):
            reason = "apt_unavailable"
        elif not shutil.which("systemd-run") or not shutil.which("systemctl") or not Path("/run/systemd/system").is_dir():
            reason = "systemd_unavailable"
        elif current is None:
            reason = "package_not_installed"
        elif current["architecture"] != ARCHITECTURE:
            reason = "unsupported_architecture"
        elif not self._systemd_owner():
            reason = "node_service_identity_mismatch"
        elif transaction and transaction.get("state") == "rollback_failed":
            reason = "package_recovery_required"
        return {"available": not reason, "reason": reason or None,
                "package": PACKAGE, "architecture": ARCHITECTURE,
                "current_version": current["version"] if current else None,
                "transaction": transaction}

    def _ensure_private_dirs(self) -> None:
        try:
            secure_private_directory(self.packages_dir)
            secure_private_directory(self.transactions_dir)
        except MeshRuntimeError as exc:
            raise DebianPackageUpdateError("package_cache_permissions",
                                           "Node package cache could not be made private") from exc
        if os.geteuid() != 0:
            raise DebianPackageUpdateError("root_required", "Debian package updates require root")
        for path in (self.packages_dir, self.transactions_dir):
            info = path.stat()
            if info.st_uid != 0 or info.st_mode & 0o077:
                raise DebianPackageUpdateError("package_cache_permissions",
                                               "Node package cache must be owned by root with mode 0700")

    def _transaction_lock(self):
        import fcntl

        path = self.packages_dir / "transaction.lock"
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            info = os.fstat(descriptor)
            if info.st_uid != 0:
                raise DebianPackageUpdateError("package_cache_permissions",
                                               "Node package transaction lock must be owned by root")
            os.fchmod(descriptor, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except DebianPackageUpdateError:
            os.close(descriptor)
            raise
        except OSError as exc:
            os.close(descriptor)
            raise DebianPackageUpdateError("package_update_busy",
                                           "Another Node package update is already being submitted") from exc
        return descriptor

    @staticmethod
    def _file_sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _deb_fields(self, path: Path) -> dict[str, str]:
        result = self._run(["dpkg-deb", "--field", str(path), "Package", "Version", "Architecture"])
        if result.returncode != 0:
            raise DebianPackageUpdateError("deb_invalid", "Prepared Debian package metadata is invalid")
        expected = {"package", "version", "architecture"}
        fields: dict[str, str] = {}
        for line in result.stdout.splitlines():
            name, separator, value = line.partition(":")
            key = name.strip().lower()
            if not separator or key not in expected or key in fields:
                raise DebianPackageUpdateError("deb_invalid", "Prepared Debian package metadata is invalid")
            fields[key] = value.strip()
        if set(fields) != expected or any(not value for value in fields.values()):
            raise DebianPackageUpdateError("deb_invalid", "Prepared Debian package metadata is incomplete")
        return fields

    def _apt_preflight(self, candidate: Path) -> None:
        if not shutil.which("apt-get"):
            raise DebianPackageUpdateError("apt_unavailable", "APT is unavailable for dependency preflight")
        result = self._run(["apt-get", "-s", "--no-download", "--no-install-recommends",
                            "install", str(candidate)], timeout=60)
        if result.returncode != 0:
            raise DebianPackageUpdateError("package_dependencies_unavailable",
                                           "Candidate package dependencies are not satisfied without changing the system")
        actions: list[tuple[str, str]] = []
        for line in result.stdout.splitlines():
            match = re.match(r"^\s*(Inst|Conf|Remv|Purg|Hold|Deconfigure|Remove)\s+([^\s:]+)", line)
            if match:
                actions.append((match.group(1), match.group(2)))
        if (not any(action == "Inst" and name == PACKAGE for action, name in actions) or
                any(name != PACKAGE or action not in {"Inst", "Conf"} for action, name in actions)):
            raise DebianPackageUpdateError("package_dependency_plan_unsafe",
                                           "APT proposes package changes beyond the Tether Node candidate")

    def _verify_deb(self, path: Path, *, version: str, sha256: str | None = None,
                    size: int | None = None) -> dict[str, str]:
        if not path.is_file() or path.is_symlink():
            raise DebianPackageUpdateError("deb_missing", "Prepared Debian package is missing")
        if size is not None and path.stat().st_size != size:
            raise DebianPackageUpdateError("deb_size_mismatch", "Prepared Debian package size does not match")
        actual_hash = self._file_sha256(path)
        if sha256 is not None and actual_hash != sha256:
            raise DebianPackageUpdateError("deb_hash_mismatch", "Prepared Debian package hash does not match")
        fields = self._deb_fields(path)
        if (fields["package"] != PACKAGE or fields["architecture"] != ARCHITECTURE
                or fields["version"] != version):
            raise DebianPackageUpdateError("deb_identity_mismatch",
                                           "Debian package name, version, or architecture does not match")
        return {**fields, "sha256": actual_hash, "size": str(path.stat().st_size)}

    def _prepared_deb(self, manager: Any, prepared_id: str) -> tuple[Path, dict[str, Any]]:
        if not PREPARED_ID_RE.fullmatch(prepared_id):
            raise DebianPackageUpdateError("prepared_id_invalid", "Prepared update identifier is invalid")
        try:
            metadata = manager.load_debian_prepared(prepared_id)
        except Exception as exc:
            code = getattr(exc, "code", "prepared_not_found")
            raise DebianPackageUpdateError(str(code),
                                           "Prepared Debian update did not pass UpdateManager validation") from exc
        if not isinstance(metadata, dict):
            raise DebianPackageUpdateError("prepared_invalid", "Prepared Debian update metadata is invalid")
        if (metadata.get("prepared_id") != prepared_id or metadata.get("package") != PACKAGE
                or metadata.get("architecture") != ARCHITECTURE):
            raise DebianPackageUpdateError("prepared_not_deb", "Prepared update is not a Tether Debian package")
        version, sha256, size = metadata.get("version"), metadata.get("sha256"), metadata.get("size")
        if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
            raise DebianPackageUpdateError("deb_version_invalid", "Prepared Debian package version is invalid")
        if not isinstance(sha256, str) or not SHA256_RE.fullmatch(sha256):
            raise DebianPackageUpdateError("deb_hash_invalid", "Prepared Debian package hash is invalid")
        if isinstance(size, bool) or not isinstance(size, int) or size < 1:
            raise DebianPackageUpdateError("deb_size_invalid", "Prepared Debian package size is invalid")
        raw_artifact = metadata.get("artifact_path")
        if not isinstance(raw_artifact, str) or not Path(raw_artifact).is_absolute():
            raise DebianPackageUpdateError("prepared_path_invalid", "Prepared Debian package path is invalid")
        artifact_unresolved = Path(raw_artifact)
        artifact = artifact_unresolved.resolve()
        state_dir = Path(getattr(manager, "state_dir", "")).resolve()
        prepared_dir = (state_dir / "prepared" / prepared_id).resolve()
        if (artifact_unresolved.is_symlink() or not artifact.is_relative_to(prepared_dir)):
            raise DebianPackageUpdateError("prepared_path_invalid", "Prepared Debian package path is invalid")
        self._verify_deb(artifact, version=version, sha256=sha256, size=size)
        return artifact, metadata

    def _cached_previous(self, installed: dict[str, str]) -> tuple[Path, dict[str, str]]:
        version = installed["version"]
        if not VERSION_RE.fullmatch(version):
            raise DebianPackageUpdateError("installed_version_invalid", "Installed package version is invalid")
        target = self.packages_dir / f"{PACKAGE}_{version}_{ARCHITECTURE}.deb"
        candidates = [target]
        apt_cache = Path("/var/cache/apt/archives")
        if apt_cache.is_dir():
            candidates.extend(apt_cache.glob(f"{PACKAGE}_{version}_*.deb"))
        for candidate in candidates:
            if not candidate.is_file() or candidate.is_symlink():
                continue
            try:
                verified = self._verify_deb(candidate, version=version)
            except DebianPackageUpdateError:
                continue
            if candidate != target:
                temporary = target.with_name(target.name + f".tmp.{uuid.uuid4().hex}")
                shutil.copyfile(candidate, temporary)
                os.chmod(temporary, 0o600)
                os.replace(temporary, target)
            os.chmod(target, 0o600)
            return target, verified
        raise DebianPackageUpdateError("rollback_artifact_missing",
                                       "A verified package for the installed Node version is not cached")

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        temporary = path.with_name(path.name + f".tmp.{uuid.uuid4().hex}")
        payload = (json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _transaction(self, prepared_id: str) -> tuple[Path, dict[str, Any]] | None:
        path = self.transactions_dir / prepared_id / "transaction.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return path, value if isinstance(value, dict) else {}

    def apply(self, manager: Any, prepared_id: str) -> dict[str, Any]:
        self._ensure_private_dirs()
        descriptor = self._transaction_lock()
        try:
            return self._apply_locked(manager, prepared_id)
        finally:
            import fcntl
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def _apply_locked(self, manager: Any, prepared_id: str) -> dict[str, Any]:
        state = self.availability()
        if not state["available"]:
            raise DebianPackageUpdateError(str(state["reason"]),
                                           "Native Debian package updates are unavailable on this Node")
        active = self.transaction_status()
        if active and active.get("state") in {"scheduled", "installing", "installed"} \
                and active.get("prepared_id") != prepared_id:
            raise DebianPackageUpdateError("package_update_busy",
                                           "A previous Node package transaction is still in progress")
        existing = self._transaction(prepared_id)
        if existing:
            current = self.transaction_status(prepared_id)
            state_name = str((current or existing[1]).get("state") or "")
            if state_name in {"scheduled", "installing", "installed", "completed"}:
                return {"ok": True, "in_progress": state_name != "completed",
                        "status": state_name, "prepared_id": prepared_id,
                        "unit": existing[1].get("unit")}
            raise DebianPackageUpdateError(str((current or existing[1]).get("error_code")
                                               or "package_transaction_terminal"),
                                           "This prepared package transaction is terminal; prepare a new update")

        installed = self._installed()
        if installed is None or installed["architecture"] != ARCHITECTURE:
            raise DebianPackageUpdateError("package_not_installed", "The managed Tether Node package is not installed")
        candidate, metadata = self._prepared_deb(manager, prepared_id)
        if metadata["version"] == installed["version"]:
            raise DebianPackageUpdateError("package_version_unchanged", "Prepared package version is already installed")
        self._apt_preflight(candidate)
        previous, previous_metadata = self._cached_previous(installed)
        transaction_dir = self.transactions_dir / prepared_id
        transaction_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(transaction_dir, 0o700)
        candidate_copy = transaction_dir / "candidate.deb"
        temporary = transaction_dir / f"candidate.deb.tmp.{os.getpid()}"
        shutil.copyfile(candidate, temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, candidate_copy)
        candidate_metadata = self._verify_deb(candidate_copy, version=metadata["version"],
                                              sha256=metadata["sha256"], size=metadata["size"])
        unit = f"tether-node-update-{prepared_id[:20]}"
        marker_path = transaction_dir / "transaction.json"
        marker = {"schema": 1, "prepared_id": prepared_id, "package": PACKAGE,
                  "architecture": ARCHITECTURE, "state": "scheduled", "unit": unit,
                  "previous": {"version": previous_metadata["version"],
                               "sha256": previous_metadata["sha256"], "path": str(previous)},
                  "candidate": {"version": candidate_metadata["version"],
                                "sha256": candidate_metadata["sha256"], "path": str(candidate_copy)},
                  "updated_at": int(time.time())}
        self._write_json(marker_path, marker)
        state_path = transaction_dir / "state"
        script_path = transaction_dir / "install.sh"
        script = "\n".join([
            "#!/bin/sh", "set -u",
            f"state={shlex.quote(str(state_path))}",
            f"candidate={shlex.quote(str(candidate_copy))}",
            f"previous={shlex.quote(str(previous))}",
            "write_state() { tmp=\"${state}.tmp.$$\"; printf '%s\\n' \"$1\" >\"$tmp\" && chmod 600 \"$tmp\" && mv -f \"$tmp\" \"$state\"; }",
            "write_state installing",
            "if dpkg --install \"$candidate\"; then write_state installed; exit 0; fi",
            "if dpkg --install \"$previous\"; then write_state rolled_back; exit 1; fi",
            "write_state rollback_failed", "exit 2", "",
        ])
        script_path.write_text(script, encoding="utf-8")
        os.chmod(script_path, 0o700)
        result = self._run(["systemd-run", "--quiet", "--no-block", "--collect",
                            f"--unit={unit}", "--property=Type=oneshot",
                            "--property=TimeoutStartSec=1800s", "/bin/sh", str(script_path)], timeout=20)
        if result.returncode != 0:
            marker.update({"state": "failed", "error_code": "systemd_run_failed",
                           "updated_at": int(time.time())})
            self._write_json(marker_path, marker)
            raise DebianPackageUpdateError("systemd_run_failed",
                                           "Could not submit the isolated Debian package transaction")
        return {"ok": True, "in_progress": True, "status": "in_progress", "restart_required": True,
                "prepared_id": prepared_id, "unit": unit,
                "target_version": candidate_metadata["version"]}

    def transaction_status(self, prepared_id: str | None = None) -> dict[str, Any] | None:
        if not self.transactions_dir.is_dir():
            return None
        latest: tuple[float, Path, dict[str, Any]] | None = None
        if prepared_id is not None:
            if not PREPARED_ID_RE.fullmatch(prepared_id):
                return None
            paths = [self.transactions_dir / prepared_id / "transaction.json"]
        else:
            paths = list(self.transactions_dir.glob("*/transaction.json"))
        for path in paths:
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                updated = float(record.get("updated_at", 0))
                if latest is None or updated > latest[0]:
                    latest = (updated, path, record)
            except (OSError, ValueError, TypeError):
                continue
        if latest is None:
            return None
        _, path, record = latest
        state_file = path.parent / "state"
        try:
            worker_state = state_file.read_text(encoding="ascii").strip()
        except OSError:
            worker_state = ""
        if worker_state:
            record["state"] = worker_state
        if worker_state == "rolled_back":
            record["error_code"] = "package_install_failed_rolled_back"
        elif worker_state == "rollback_failed":
            record["error_code"] = "package_rollback_failed"
        if record.get("state") in {"scheduled", "installing", "installed"}:
            installed = self._installed()
            expected = ((record.get("candidate") or {}).get("version"))
            previous = ((record.get("previous") or {}).get("version"))
            if installed and installed["version"] == expected:
                record["state"] = "completed"
            elif installed and installed["version"] == previous and worker_state == "rolled_back":
                record["state"] = "rolled_back"
            elif installed and installed["version"] == previous:
                result = self._run(["systemctl", "show", "--property=ActiveState", "--value",
                                    str(record.get("unit") or "")])
                if result.returncode != 0 or result.stdout.strip() not in {"active", "activating"}:
                    record["state"] = "failed"
                    record["error_code"] = "package_install_failed"
            record["updated_at"] = int(time.time())
            try:
                self._write_json(path, record)
            except OSError:
                pass
        return {key: value for key, value in record.items() if key not in {"previous", "candidate"}}

    def reconcile(self) -> dict[str, Any] | None:
        """Reconcile the durable transaction marker after a package restart."""
        return self.transaction_status()
