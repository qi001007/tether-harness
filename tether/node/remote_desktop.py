"""Target-local MeshCentral 1.3.1 desktop guest-share adapter.

MeshCentral owns the desktop protocol, consent dialog, guest page, and relay
revocation. Tether only starts its private local service and asks MeshCtrl for
one device-only, time-limited desktop share. It never exposes the admin user.

Upstream source: https://github.com/Ylianst/MeshCentral/tree/1.3.1
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlencode, urlsplit

from .mesh_runtime import MeshRuntimeError, secure_private_directory

try:
    import psutil
except ImportError:  # pragma: no cover - declared by the Node runtime
    psutil = None


class RemoteDesktopError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class MeshCentralDesktop:
    """Own a loopback MeshCentral process and issue native desktop guest links.

    Node supplies pinned runtime executables and actual display/task state.
    The adapter creates its own isolated MeshCentral group and discovers its
    canonical node ID from the native server after the local Agent connects.
    """

    MAX_SHARE_SECONDS = 3600
    DEFAULT_SHARE_SECONDS = 1800
    NATIVE_SHARE_SECONDS = 24 * 60 * 60

    def __init__(self, *, node_executable: str | Path, meshcentral_root: str | Path,
                 meshagent_executable: str | Path, data_dir: str | Path, target_id: str,
                 get_device_state: Callable[[], dict[str, Any] | None],
                 owner_unattended_enabled: Callable[[], bool] | None = None) -> None:
        self.node = Path(node_executable).resolve()
        self.meshagent = Path(meshagent_executable).resolve()
        self.meshcentral = Path(meshcentral_root).resolve()
        self.entry = self.meshcentral / "meshcentral.js"
        self.meshctrl = self.meshcentral / "meshctrl.js"
        self.root = Path(data_dir).resolve() / "remote-desktop"
        self.target_id = str(target_id)
        self.get_device_state = get_device_state
        self.owner_unattended_enabled = owner_unattended_enabled or (lambda: False)
        if psutil is None:
            raise RemoteDesktopError("process_identity_unavailable", "进程身份校验不可用。")
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            secure_private_directory(self.root)
        except MeshRuntimeError as error:
            raise RemoteDesktopError("private_data_acl_failed", "远程桌面私有数据目录 ACL 无法确认。") from error
        self.config_path = self.root / "config.json"
        self.record_path = self.root / "runtime.json"
        self.admin_path = self.root / "control-account.json"
        self.shares_path = self.root / "shares.json"
        self.agent_dir = self.root / "agent"
        self.agent_path = self.agent_dir / ("MeshService64.exe" if os.name == "nt" else "meshagent")
        self.agent_record_path = self.root / "agent-runtime.json"
        self.agent_group_path = self.root / "agent-group.json"
        self._lock = threading.RLock()

    def catalog(self) -> dict[str, Any]:
        """Read-only status; this never starts MeshCentral or the local Agent."""
        if not self._assets_available():
            return {"state": "missing", "reason": "meshcentral_runtime_missing", "updated_at": int(time.time())}
        record = self._load_record()
        if not record or not self._owned_server(record):
            if record and self._pid_exists(record):
                return {"state": "failed", "reason": "meshcentral_process_identity_mismatch", "updated_at": int(time.time())}
            return {"state": "stopped", "reason": "meshcentral_stopped", "updated_at": int(time.time())}
        if not self._health(record):
            return {"state": "starting", "reason": "meshcentral_health_pending", "updated_at": int(time.time())}
        state = self._device_state()
        if state is None:
            return {"state": "failed", "reason": "meshcentral_device_state_unknown", "updated_at": int(time.time())}
        if not state.get("desktop_supported"):
            reason = self._reason_code(state.get("desktop_reason"), "desktop_unsupported")
            return {"state": "failed", "reason": reason, "updated_at": int(time.time())}
        try:
            node_id = self._native_node_id()
            if not self._native_node_connected(node_id):
                return {"state": "stopped", "reason": "meshcentral_agent_offline", "updated_at": int(time.time())}
        except RemoteDesktopError as error:
            return {"state": "failed", "reason": error.code, "updated_at": int(time.time())}
        return {"state": "ready", "reason": "", "agent_busy": bool(state.get("busy")),
                "view_only_reason": self._reason_code(state.get("busy_reason"), "agent_busy") if state.get("busy") else "",
                "updated_at": int(time.time())}

    def open(self, authority: dict[str, Any], *, duration_seconds: int | None = None) -> dict[str, Any]:
        """Create or return one authorized native desktop guest share.

        `authority` is Controller-to-Node data, never a renderer-supplied
        authority claim. The guest receives only MeshCentral's desktop share
        URL; its protocol is desktop-only and its normal consent is prompt.
        """
        grant = self._validate_authority(authority)
        duration = self._validate_duration(duration_seconds)
        native_duration = max(duration, self.NATIVE_SHARE_SECONDS)
        with self._lock:
            shares = self._load_shares()
            existing = shares.get(grant["grant_id"])
            if existing and existing.get("operation_id") == grant["operation_id"]:
                created_at = existing.get("created_at")
                expires_at = existing.get("expires_at")
                if (type(created_at) is not int or type(expires_at) is not int
                        or expires_at > created_at + self.NATIVE_SHARE_SECONDS):
                    raise RemoteDesktopError("native_session_limit_invalid", "远程桌面会话时限记录无效。")
                if expires_at <= int(time.time()):
                    raise RemoteDesktopError("grant_expired", "远程桌面授权已过期。")
                self._match_grant(existing, grant)
                if not self._native_share_exists(existing):
                    raise RemoteDesktopError("grant_revoked", "MeshCentral 已撤销此桌面共享。")
                return self._public_share(existing)
            if existing:
                raise RemoteDesktopError("grant_operation_conflict", "授权已绑定另一个操作。")

            state = self._device_state()
            if state is None:
                raise RemoteDesktopError("agent_state_unknown", "无法确认目标桌面与任务状态。")
            if not state.get("desktop_supported"):
                raise RemoteDesktopError("desktop_unsupported", "此目标没有可用桌面。")
            if state.get("busy") not in (True, False):
                raise RemoteDesktopError("agent_busy_state_unknown", "无法确认 Agent 当前是否正在处理任务。")
            self._ensure_server()
            record = self._load_record()
            node_id = self._ensure_native_agent()
            view_only = bool(state["busy"])
            unattended = bool(grant.get("owner_unattended_enabled") is True and self.owner_unattended_enabled())
            consent = "none" if unattended else "prompt"
            guest_name = "Tether-" + grant["grant_id"][:12]
            minutes = native_duration // 60
            args = ["DeviceSharing", "--id", node_id, "--add", guest_name,
                    "--type", "desktop", "--consent", consent, "--duration", str(minutes)]
            if view_only:
                args.append("--viewonly")
            output = self._meshctrl(record, args)
            share_id = self._output_value(output, "ID")
            share_url = self._output_value(output, "URL")
            if not share_id or not share_url:
                raise RemoteDesktopError("share_create_failed", "MeshCentral 未返回有效桌面共享。")
            try:
                guest_path = self._guest_path(share_url)
            except RemoteDesktopError:
                self._meshctrl(record, ["DeviceSharing", "--id", node_id, "--remove", share_id])
                raise
            now = int(time.time())
            item = {"target_id": self.target_id, "actor_id": grant["actor_id"],
                    "grant_id": grant["grant_id"], "authorization_revision": grant["authorization_revision"],
                    "operation_id": grant["operation_id"], "mesh_node_id": node_id,
                    "share_id": share_id, "guest_path": guest_path, "created_at": now,
                    "expires_at": now + native_duration, "consent": consent, "view_only": view_only,
                    "view_only_reason": self._reason_code(state.get("busy_reason"), "agent_busy") if view_only else ""}
            shares[grant["grant_id"]] = item
            self._save_shares(shares)
            return self._public_share(item)

    def view(self, authority: dict[str, Any]) -> dict[str, Any]:
        grant = self._validate_authority(authority)
        with self._lock:
            item = self._load_shares().get(grant["grant_id"])
            if not item:
                raise RemoteDesktopError("grant_missing", "远程桌面共享已不存在。")
            self._match_grant(item, grant)
            if item.get("expires_at", 0) <= int(time.time()):
                return {"state": "expired", "grant_id": grant["grant_id"], "expires_at": item["expires_at"]}
            if not self._native_share_exists(item):
                return {"state": "revoked", "grant_id": grant["grant_id"], "expires_at": item["expires_at"]}
            public = self._public_share(item)
            return {"state": "ready", **public}

    def close(self, authority: dict[str, Any]) -> dict[str, Any]:
        """Remove the native share; MeshCentral broadcasts revocation to relays."""
        grant = self._validate_authority(authority)
        with self._lock:
            shares = self._load_shares()
            item = shares.get(grant["grant_id"])
            if not item:
                node_id = self._native_node_id()
                if not self._native_guest_share_exists(node_id, grant["grant_id"]):
                    return {"state": "revoked", "grant_id": grant["grant_id"], "connections_closed": True}
                raise RemoteDesktopError("grant_missing", "远程桌面授权记录不存在，无法安全撤销共享。")
            self._match_grant(item, grant)
            record = self._load_record()
            output = self._meshctrl(record, ["DeviceSharing", "--id", item["mesh_node_id"], "--remove", item["share_id"]])
            if self._native_share_exists(item):
                raise RemoteDesktopError("revoke_pending", "MeshCentral 尚未确认撤销共享。")
            shares.pop(grant["grant_id"], None)
            self._save_shares(shares)
            return {"state": "revoked", "grant_id": grant["grant_id"], "connections_closed": True}

    def renew(self, authority: dict[str, Any], *, duration_seconds: int) -> dict[str, Any]:
        """Keep the bounded native share stable while renewing the shorter Hub lease."""
        grant = self._validate_authority(authority)
        self._validate_duration(duration_seconds)
        with self._lock:
            shares = self._load_shares()
            old = shares.get(grant["grant_id"])
            if not old:
                raise RemoteDesktopError("grant_missing", "远程桌面授权记录不存在。")
            self._match_grant(old, grant)
            created_at = old.get("created_at")
            native_expires_at = old.get("expires_at")
            if (type(created_at) is not int or type(native_expires_at) is not int
                    or native_expires_at > created_at + self.NATIVE_SHARE_SECONDS):
                raise RemoteDesktopError("native_session_limit_invalid", "远程桌面会话时限记录无效。")
            if native_expires_at <= int(time.time()):
                raise RemoteDesktopError("native_session_expired", "远程桌面会话已达到24小时上限，请重新打开会话。")
            state = self._device_state()
            if state is None or not state.get("desktop_supported"):
                raise RemoteDesktopError("desktop_unsupported", "目标桌面状态不可用，无法续期。")
            if state.get("busy") not in (True, False):
                raise RemoteDesktopError("agent_busy_state_unknown", "无法确认 Agent 当前任务状态。")
            record = self._load_record()
            if not self._native_node_connected(old["mesh_node_id"]):
                raise RemoteDesktopError("mesh_agent_offline", "MeshCentral 原生 Agent 当前离线。")
            if not self._native_share_exists(old):
                raise RemoteDesktopError("grant_revoked", "MeshCentral 已撤销此桌面共享。")
            unattended = bool(grant.get("owner_unattended_enabled") is True and self.owner_unattended_enabled())
            requested_consent = "none" if unattended else "prompt"
            was_view_only = old.get("view_only") is True
            permission_restriction = (not was_view_only and state["busy"]) or (
                old.get("consent") == "none" and requested_consent == "prompt")
            if not permission_restriction:
                return self._public_share(old)

            # Renewal only replaces a native link when the current desktop state
            # requires a stricter grant. Permission relaxation waits for a new open.
            consent = "prompt" if old.get("consent") == "prompt" or requested_consent == "prompt" else "none"
            view_only = was_view_only or bool(state["busy"])
            guest_name = "Tether-" + grant["grant_id"][:12]
            expires_at = datetime.fromtimestamp(native_expires_at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            args = ["DeviceSharing", "--id", old["mesh_node_id"], "--add", guest_name,
                    "--type", "desktop", "--consent", consent, "--end", expires_at]
            if view_only:
                args.append("--viewonly")
            output = self._meshctrl(record, args)
            share_id = self._output_value(output, "ID")
            share_url = self._output_value(output, "URL")
            if not share_id or not share_url:
                raise RemoteDesktopError("share_create_failed", "MeshCentral 未返回有效桌面共享。")
            guest_path = self._guest_path(share_url)
            renewed = {**old, "share_id": share_id, "guest_path": guest_path,
                       "created_at": int(time.time()), "expires_at": native_expires_at,
                       "consent": consent, "view_only": view_only,
                       "view_only_reason": self._reason_code(state.get("busy_reason"), "agent_busy") if state["busy"] else old.get("view_only_reason", "")}
            self._meshctrl(record, ["DeviceSharing", "--id", old["mesh_node_id"], "--remove", old["share_id"]])
            if self._native_share_exists(old):
                self._meshctrl(record, ["DeviceSharing", "--id", old["mesh_node_id"], "--remove", share_id])
                raise RemoteDesktopError("revoke_pending", "旧桌面共享尚未确认撤销。")
            shares[grant["grant_id"]] = renewed
            self._save_shares(shares)
            return self._public_share(renewed)

    def local_upstream(self) -> dict[str, Any]:
        """Return the loopback origin for the Caddy service proxy."""
        record = self._load_record()
        if not record or not self._owned_server(record) or not self._health(record):
            raise RemoteDesktopError("meshcentral_unavailable", "MeshCentral 本机服务尚未就绪。")
        certificate = self.root / "root-cert-public.crt"
        if not certificate.is_file():
            raise RemoteDesktopError("meshcentral_certificate_missing", "MeshCentral 本机证书尚未生成。")
        return {"scheme": "https", "host": "127.0.0.1", "port": int(record["port"]),
                "tls_server_name": "localhost.", "trust_certificate_path": str(certificate)}

    def stop(self) -> dict[str, Any]:
        """Stop only the exact MeshCentral server process started by this adapter."""
        with self._lock:
            shares = self._load_shares()
            now = int(time.time())
            if any(isinstance(item, dict) and int(item.get("expires_at") or 0) > now for item in shares.values()):
                raise RemoteDesktopError("active_shares", "仍有未过期的桌面共享，暂不能停止服务。")
            record = self._load_record()
            if record and self._pid_exists(record) and not self._owned_server(record):
                raise RemoteDesktopError("meshcentral_process_identity_mismatch", "无法安全确认 MeshCentral 进程身份。")
            agent_record = self._load_agent_record()
            if agent_record and self._pid_exists(agent_record) and not self._owned_agent(agent_record):
                raise RemoteDesktopError("mesh_agent_process_identity_mismatch", "无法安全确认本地 MeshAgent 进程。")
            if agent_record and self._owned_agent(agent_record):
                self._stop_owned_process(agent_record, self._owned_agent)
            if agent_record:
                self.agent_record_path.unlink(missing_ok=True)
            if record and self._owned_server(record):
                self._stop_owned_process(record, self._owned_server)
            if record:
                self.record_path.unlink(missing_ok=True)
            return {"state": "stopped"}

    @staticmethod
    def _stop_owned_process(record: dict[str, Any], owns_process: Callable[[dict[str, Any]], bool]) -> None:
        process = psutil.Process(int(record["pid"]))
        try:
            process.terminate()
            process.wait(timeout=8)
        except psutil.TimeoutExpired:
            if owns_process(record):
                process.kill()
                process.wait(timeout=3)
        except psutil.Error as error:
            raise RemoteDesktopError("meshcentral_stop_failed", "受管远程桌面进程无法停止。") from error

    def _ensure_server(self) -> dict[str, Any]:
        with self._lock:
            record = self._load_record()
            if record and self._owned_server(record):
                if self._health(record):
                    return record
                raise RemoteDesktopError("meshcentral_starting", "MeshCentral 正在启动，请稍后重试。")
            if record and self._pid_exists(record):
                raise RemoteDesktopError("meshcentral_process_identity_mismatch", "无法安全确认 MeshCentral 进程身份。")
            if not self._assets_available():
                raise RemoteDesktopError("meshcentral_runtime_missing", "远程桌面组件尚未安装。")
            self._prepare_meshagent_cache()
            port = self._free_port()
            self._write_config(port)
            self._ensure_admin_account()
            creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
            argv = [str(self.node), str(self.entry), "--datapath", str(self.root), "--configfile", "config.json"]
            environment = {key: value for key, value in os.environ.items()
                           if not key.startswith("MESHCENTRAL_") and key not in {"NODE_OPTIONS", "NODE_PATH"}}
            try:
                with (self.root / "meshcentral.log").open("ab") as log:
                    process = subprocess.Popen(argv, cwd=str(self.meshcentral), stdin=subprocess.DEVNULL,
                                               stdout=log, stderr=subprocess.STDOUT,
                                               env=environment, shell=False, close_fds=(os.name != "nt"),
                                               creationflags=creation_flags)
            except OSError as error:
                raise RemoteDesktopError("meshcentral_start_failed", "MeshCentral 无法启动。") from error
            record = {"pid": process.pid, "create_time": self._process_create_time(process.pid),
                      "node_executable": str(self.node), "meshcentral_entry": str(self.entry),
                      "data_dir": str(self.root), "port": port}
            self._save_record(record)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if not self._owned_server(record):
                    raise RemoteDesktopError("meshcentral_start_failed", "MeshCentral 启动后退出。")
                if self._health(record):
                    return record
                time.sleep(0.25)
            raise RemoteDesktopError("meshcentral_health_failed", "MeshCentral 本机服务未能就绪。")

    def _ensure_native_agent(self) -> str:
        record = self._load_agent_record()
        if record and self._owned_agent(record):
            node_id = self._native_node_id()
            if self._native_node_connected(node_id):
                return node_id
            raise RemoteDesktopError("mesh_agent_starting", "MeshCentral 原生 Agent 正在连接，请稍后重试。")
        if record and self._pid_exists(record):
            raise RemoteDesktopError("mesh_agent_process_identity_mismatch", "无法安全确认本地 MeshAgent 进程。")
        group = self._ensure_agent_group()
        self.agent_dir.mkdir(parents=True, exist_ok=True)
        secure_private_directory(self.agent_dir)
        with tempfile.TemporaryDirectory(prefix="meshagent-download-", dir=self.root) as temporary:
            work = Path(temporary)
            platform_type = self._agent_type()
            meshctrl_record = self._load_record()
            result = self._run_meshctrl(meshctrl_record, ["AgentDownload", "--id", group["raw_id"],
                                           "--type", str(platform_type), "--installflags", "1"], cwd=work)
            if "Downloaded " not in result:
                raise RemoteDesktopError("mesh_agent_download_failed", "MeshCentral 未能生成本机原生 Agent。")
            downloaded = [path for path in work.iterdir() if path.is_file()]
            if len(downloaded) != 1:
                raise RemoteDesktopError("mesh_agent_download_invalid", "MeshCentral Agent 下载结果不符合预期。")
            shutil.copy2(downloaded[0], self.agent_path)
        self._write_agent_msh(group)
        if os.name != "nt":
            self.agent_path.chmod(0o700)
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        try:
            process = subprocess.Popen([str(self.agent_path), "run"], cwd=str(self.agent_dir),
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, shell=False,
                                       close_fds=(os.name != "nt"), creationflags=creation_flags)
        except OSError as error:
            raise RemoteDesktopError("mesh_agent_start_failed", "MeshCentral 原生 Agent 无法启动。") from error
        record = {"pid": process.pid, "create_time": self._process_create_time(process.pid),
                  "executable": str(self.agent_path), "data_dir": str(self.agent_dir)}
        self._save_agent_record(record)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if not self._owned_agent(record):
                raise RemoteDesktopError("mesh_agent_start_failed", "MeshCentral Agent 启动后退出。")
            node_id = self._find_native_node(group["id"])
            if node_id:
                self._atomic_json(self.node_id_path, {"node_id": node_id})
                return node_id
            time.sleep(0.25)
        raise RemoteDesktopError("mesh_agent_connect_timeout", "MeshCentral 原生 Agent 未在时限内注册。")

    def _write_agent_msh(self, group: dict[str, str]) -> None:
        import ssl
        import urllib.error
        import urllib.request
        mesh_id = group["id"].split("/")[2]
        url = f"https://127.0.0.1:{int(self._load_record()['port'])}/meshsettings?{urlencode({'id': mesh_id})}"
        request = urllib.request.Request(url, headers={"Host": f"localhost:{int(self._load_record()['port'])}"})
        try:
            with urllib.request.urlopen(request, context=ssl._create_unverified_context(), timeout=5) as response:
                msh = response.read(32 * 1024).decode("utf-8")
        except (OSError, UnicodeError, urllib.error.URLError) as error:
            raise RemoteDesktopError("mesh_agent_config_failed", "MeshCentral 未能生成本机 Agent 配置。") from error
        if not msh.startswith("\r\nMeshName=") or "\r\nMeshID=0x" not in msh or "\r\nServerID=" not in msh:
            raise RemoteDesktopError("mesh_agent_config_invalid", "MeshCentral Agent 配置格式无效。")
        self._atomic_bytes(self.agent_path.with_suffix(".msh"), msh.encode("utf-8"))

    @property
    def node_id_path(self) -> Path:
        return self.root / "agent-node.json"

    def _ensure_agent_group(self) -> dict[str, str]:
        stable_name = "Tether-" + uuid.uuid5(uuid.NAMESPACE_URL, self.target_id).hex[:20]
        output = self._meshctrl(self._load_record(), ["ListDeviceGroups", "--json", "--hex"])
        try:
            groups = json.loads(output)
        except ValueError as error:
            raise RemoteDesktopError("meshcentral_groups_invalid", "MeshCentral 设备组状态无法验证。") from error
        if not isinstance(groups, list) or any(not isinstance(item, dict) for item in groups):
            raise RemoteDesktopError("meshcentral_groups_invalid", "MeshCentral 设备组状态格式无效。")
        matches = [item for item in groups if item.get("name") == stable_name]
        if not matches:
            self._meshctrl(self._load_record(), ["AddDeviceGroup", "--name", stable_name])
            output = self._meshctrl(self._load_record(), ["ListDeviceGroups", "--json", "--hex"])
            try:
                groups = json.loads(output)
            except ValueError as error:
                raise RemoteDesktopError("meshcentral_groups_invalid", "MeshCentral 新设备组无法验证。") from error
            matches = [item for item in groups if isinstance(item, dict) and item.get("name") == stable_name]
        if len(matches) != 1:
            raise RemoteDesktopError("meshcentral_group_conflict", "MeshCentral 本机设备组无法唯一识别。")
        group_id = matches[0].get("_id")
        if not isinstance(group_id, str) or not group_id.startswith("mesh/") or len(group_id.split("/")) != 3:
            raise RemoteDesktopError("meshcentral_group_invalid", "MeshCentral 本机设备组标识无效。")
        raw_id = group_id.split("/")[2]
        if len(raw_id) != 64:
            raise RemoteDesktopError("meshcentral_group_invalid", "MeshCentral 本机设备组标识长度无效。")
        self._atomic_json(self.agent_group_path, {"id": group_id, "raw_id": raw_id, "name": stable_name})
        return {"id": group_id, "raw_id": raw_id, "name": stable_name}

    def _find_native_node(self, group_id: str) -> str:
        output = self._meshctrl(self._load_record(), ["ListDevices", "--json"])
        try:
            devices = json.loads(output)
        except ValueError as error:
            raise RemoteDesktopError("meshcentral_device_status_invalid", "MeshCentral 未返回可验证的设备状态。") from error
        if not isinstance(devices, list) or any(not isinstance(device, dict) for device in devices):
            raise RemoteDesktopError("meshcentral_device_status_invalid", "MeshCentral 设备状态格式无效。")
        matches = [device for device in devices if device.get("meshid") == group_id and device.get("conn") == 1]
        if len(matches) > 1:
            raise RemoteDesktopError("meshcentral_agent_ambiguous", "本机设备组中出现多个连接的 MeshAgent。")
        if not matches:
            return ""
        return self._canonical_node_id(matches[0].get("_id", ""))

    def _native_node_id(self) -> str:
        value = self._read_json(self.node_id_path, {})
        node_id = value.get("node_id") if isinstance(value, dict) else None
        if not isinstance(node_id, str) or not node_id:
            raise RemoteDesktopError("mesh_agent_registration_missing", "本机 MeshAgent 尚未完成注册。")
        return self._canonical_node_id(node_id)

    def _agent_type(self) -> int:
        if os.name == "nt":
            return 4
        import platform
        if platform.system() == "Darwin":
            return 29 if platform.machine().lower() in {"arm64", "aarch64"} else 16
        if platform.system() == "Linux" and platform.machine().lower() in {"x86_64", "amd64"}:
            return 6
        raise RemoteDesktopError("mesh_agent_platform_unsupported", "此平台暂不支持桌面 Agent。")

    def _prepare_meshagent_cache(self) -> None:
        filename = self._meshagent_filename()
        if self.meshagent.name != filename:
            raise RemoteDesktopError("mesh_agent_asset_mismatch", "本机 MeshAgent 组件与运行平台不匹配。")
        expected_sha256 = {
            "MeshService64.exe": "cbf10a37fc01f74f2473aeca0a4b391dca6f9d0a8d0300aa7181dbce7bacc51e",
            "meshagent_x86-64": "891da8d32d0fbfec933b7ca5aa64b27650c05531a772f993601f20ae7c2c0a3b",
            "meshagent_osx-arm-64": "5bad4449e361b0a1f35e660f5d2b6cfdb11abf4adbb859719fccc6987800aca9",
            "meshagent_osx-x86-64": "d2b5d2dbb2f917354752449ec1b730c0b96f36b30d23a58c8350727e909fa1b4",
        }[filename]
        import hashlib
        source_hash = hashlib.sha256(self.meshagent.read_bytes()).hexdigest()
        if source_hash != expected_sha256:
            raise RemoteDesktopError("mesh_agent_asset_integrity_failed", "Pinned MeshAgent SHA256 mismatch.")
        manifest_path = self.meshcentral / "agents" / "agent-defaults.json"
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            pinned = [item for release in manifest["releases"] if release.get("tag") == "legacy-1.2.6"
                      for item in release.get("files", []) if item.get("filename") == filename]
            if len(pinned) != 1:
                raise ValueError("Missing or duplicate pinned agent entry")
            asset = pinned[0]
            source = self.meshagent.stat()
            source_sha384 = hashlib.sha384(self.meshagent.read_bytes()).hexdigest()
            if source.st_size != asset.get("size") or source_sha384 != asset.get("sha384"):
                raise ValueError("Pinned MeshAgent SHA384 mismatch")
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise RemoteDesktopError("mesh_agent_manifest_invalid", "Pinned MeshCentral agent manifest mismatch.") from error
        cache = self.root / "agentbuilds" / "legacy-1.2.6"
        cache.mkdir(parents=True, exist_ok=True)
        secure_private_directory(cache)
        target = cache / filename
        if target.is_file():
            if hashlib.sha384(target.read_bytes()).hexdigest() != asset["sha384"]:
                raise RemoteDesktopError("mesh_agent_cache_integrity_failed", "本机 MeshAgent 缓存完整性校验失败。")
            return
        shutil.copy2(self.meshagent, target)
        if hashlib.sha384(target.read_bytes()).hexdigest() != asset["sha384"]:
            target.unlink(missing_ok=True)
            raise RemoteDesktopError("mesh_agent_cache_integrity_failed", "MeshCentral local agent cache integrity failure.")

    @staticmethod
    def _meshagent_filename() -> str:
        if os.name == "nt":
            return "MeshService64.exe"
        import platform
        if platform.system() == "Darwin":
            return "meshagent_osx-arm-64" if platform.machine().lower() in {"arm64", "aarch64"} else "meshagent_osx-x86-64"
        if platform.system() == "Linux" and platform.machine().lower() in {"x86_64", "amd64"}:
            return "meshagent_x86-64"
        raise RemoteDesktopError("mesh_agent_platform_unsupported", "此平台暂不支持桌面 Agent。")

    def _ensure_admin_account(self) -> dict[str, Any]:
        current = self._load_admin()
        if current:
            return current
        username = "tether-" + secrets.token_hex(10)
        password = "T" + secrets.token_urlsafe(36)
        account = {"username": username, "password": password}
        self._save_admin(account)
        try:
            self._run_meshcentral_setup({"CREATEACCOUNT": username, "PASS": password})
            self._run_meshcentral_setup({"ADMINACCOUNT": username})
        except Exception:
            self.admin_path.unlink(missing_ok=True)
            raise
        return account

    def _run_meshcentral_setup(self, values: dict[str, str]) -> None:
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("MESHCENTRAL_") and key not in {"NODE_OPTIONS", "NODE_PATH"}}
        environment["MESHCENTRAL_DATAPATH"] = str(self.root)
        environment.update({"MESHCENTRAL_" + key: value for key, value in values.items()})
        result = subprocess.run([str(self.node), str(self.entry), "--datapath", str(self.root)], cwd=str(self.meshcentral),
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, env=environment,
                                timeout=45, check=False, shell=False)
        output = result.stdout.decode("utf-8", "replace")
        if result.returncode or not any(marker in output for marker in ("Done.", "User already exists.")):
            raise RemoteDesktopError("meshcentral_account_setup_failed", "MeshCentral 本地控制账户初始化失败。")

    def _meshctrl(self, record: dict[str, Any], args: list[str]) -> str:
        return self._run_meshctrl(record, args, cwd=self.meshcentral)

    def _run_meshctrl(self, record: dict[str, Any], args: list[str], *, cwd: Path) -> str:
        account = self._load_admin()
        if not account:
            raise RemoteDesktopError("meshcentral_account_missing", "MeshCentral 本地控制账户不可用。")
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("MESHCTRL_") and key not in {"NODE_OPTIONS", "NODE_PATH"}}
        environment.update({"MESHCTRL_URL": f"wss://127.0.0.1:{int(record['port'])}",
                            "MESHCTRL_LOGINUSER": account["username"],
                            "MESHCTRL_LOGINPASS": account["password"]})
        wrapper = ("const log=console.log;console.log=(...a)=>log(...(a.length===1&&Array.isArray(a[0])"
                   "?[JSON.stringify(a[0])]:a));require(process.argv[1]);")
        result = subprocess.run([str(self.node), "-e", wrapper, str(self.meshctrl), *args],
                                cwd=str(cwd), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                env=environment, timeout=20, check=False, shell=False)
        output = result.stdout.decode("utf-8", "replace")
        if result.returncode and not (args[0].lower() == "agentdownload" and "Downloaded " in output):
            raise RemoteDesktopError("meshcentral_control_failed", "MeshCentral 原生授权操作失败。")
        return output

    def _native_share_exists(self, item: dict[str, Any]) -> bool:
        return any(share.get("publicid") == item["share_id"]
                   for share in self._native_shares(item["mesh_node_id"]))

    def _native_guest_share_exists(self, node_id: str, grant_id: str) -> bool:
        guest_name = "Tether-" + grant_id[:12]
        return any(share.get("guestName") == guest_name for share in self._native_shares(node_id))

    def _native_shares(self, node_id: str) -> list[dict[str, Any]]:
        record = self._load_record()
        output = self._meshctrl(record, ["DeviceSharing", "--id", node_id, "--json"])
        if output.strip() == "No device sharing links for this device.":
            return []
        try:
            shares = json.loads(output)
        except ValueError as error:
            raise RemoteDesktopError("meshcentral_share_status_invalid", "MeshCentral 未返回可验证的共享状态。") from error
        if not isinstance(shares, list) or any(not isinstance(share, dict) for share in shares):
            raise RemoteDesktopError("meshcentral_share_status_invalid", "MeshCentral 共享状态格式无效。")
        return shares

    def _write_config(self, port: int) -> None:
        config = {"settings": {"cert": "localhost.", "port": int(port), "portBind": "127.0.0.1",
                               "redirPort": 0, "relayPort": 0, "mpsPort": 0,
                               "allowFraming": False,
                               "agentconfig": ["nocertstore=1", "disableUpdate=1", "noUpdateCoreModule=1"],
                               "agentdownloads": {"enabled": False}, "selfUpdate": False},
        "domains": {"": {"guestDeviceSharing": {"maxSessionTime": self.NATIVE_SHARE_SECONDS // 60}}}}
        self._atomic_json(self.config_path, config)

    def _health(self, record: dict[str, Any]) -> bool:
        import ssl
        import urllib.error
        import urllib.request
        request = urllib.request.Request(f"https://127.0.0.1:{int(record['port'])}/", method="GET")
        try:
            with urllib.request.urlopen(request, context=ssl._create_unverified_context(), timeout=2) as response:
                return response.status == 200
        except (OSError, urllib.error.URLError):
            return False

    def _device_state(self) -> dict[str, Any] | None:
        try:
            state = self.get_device_state()
            if not isinstance(state, dict):
                return None
            if not all(key in state for key in ("desktop_supported", "busy")):
                return None
            if any(type(state[key]) is not bool for key in ("desktop_supported", "busy")):
                return None
            return state
        except Exception:
            return None

    @staticmethod
    def _reason_code(value: Any, fallback: str) -> str:
        if isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value):
            return value
        return fallback

    def _assets_available(self) -> bool:
        return self.node.is_file() and self.entry.is_file() and self.meshctrl.is_file() and self.meshagent.is_file()

    def _canonical_node_id(self, value: str) -> str:
        node_id = str(value or "")
        if not re.fullmatch(r"node/[A-Za-z0-9_-]{0,64}/[A-Za-z0-9_$@.-]{8,128}", node_id):
            raise RemoteDesktopError("invalid_mesh_node", "目标 MeshCentral 设备标识无效。")
        return node_id

    def _validate_authority(self, authority: Any) -> dict[str, Any]:
        if not isinstance(authority, dict):
            raise RemoteDesktopError("authority_missing", "缺少可信远程桌面授权。")
        expected = {"actor_id", "target_id", "grant_id", "authorization_revision", "operation_id"}
        if not expected.issubset(authority):
            raise RemoteDesktopError("authority_missing", "可信远程桌面授权字段不完整。")
        if str(authority["target_id"]) != self.target_id:
            raise RemoteDesktopError("target_mismatch", "授权目标与本 Node 不一致。")
        for field in ("actor_id", "grant_id", "authorization_revision", "operation_id"):
            value = str(authority[field])
            if not value or len(value) > 128 or any(ord(char) < 32 for char in value):
                raise RemoteDesktopError("invalid_authority", "可信远程桌面授权无效。")
        result: dict[str, Any] = {key: str(authority[key]) for key in expected}
        if "owner_unattended_enabled" in authority:
            if type(authority["owner_unattended_enabled"]) is not bool:
                raise RemoteDesktopError("invalid_authority", "可信远程桌面无人值守授权标记无效。")
            result["owner_unattended_enabled"] = authority["owner_unattended_enabled"]
        return result

    def _match_grant(self, item: dict[str, Any], grant: dict[str, str]) -> None:
        if any(item.get(key) != grant.get(key) for key in
               ("actor_id", "target_id", "grant_id", "authorization_revision", "operation_id")):
            raise RemoteDesktopError("grant_mismatch", "远程桌面撤销目标与授权不匹配。")
        expected_node = self._native_node_id()
        if item.get("mesh_node_id") != expected_node:
            raise RemoteDesktopError("grant_mismatch", "远程桌面授权绑定了不同的本机设备。")

    def _native_node_connected(self, node_id: str) -> bool:
        record = self._load_record()
        output = self._meshctrl(record, ["ListDevices", "--json"])
        try:
            devices = json.loads(output)
        except ValueError as error:
            raise RemoteDesktopError("meshcentral_device_status_invalid", "MeshCentral 未返回可验证的设备状态。") from error
        if not isinstance(devices, list) or any(not isinstance(device, dict) for device in devices):
            raise RemoteDesktopError("meshcentral_device_status_invalid", "MeshCentral 设备状态格式无效。")
        return any(device.get("_id") == node_id and device.get("conn") == 1 for device in devices)

    def _load_agent_record(self) -> dict[str, Any] | None:
        value = self._read_json(self.agent_record_path, {})
        return value if isinstance(value, dict) and value else None

    def _save_agent_record(self, value: dict[str, Any]) -> None:
        self._atomic_json(self.agent_record_path, value)

    def _owned_agent(self, record: dict[str, Any]) -> bool:
        try:
            process = psutil.Process(int(record["pid"]))
            command = process.cmdline()
            return (abs(process.create_time() - float(record["create_time"])) < 0.01
                    and Path(process.exe()).resolve() == self.agent_path.resolve()
                    and any(str(self.agent_dir) in arg for arg in command)
                    and "run" in command)
        except (psutil.Error, OSError, ValueError, KeyError, TypeError):
            return False

    def _validate_duration(self, duration: int | None) -> int:
        duration = self.DEFAULT_SHARE_SECONDS if duration is None else duration
        if type(duration) is not int or duration < 60 or duration > self.MAX_SHARE_SECONDS or duration % 60:
            raise RemoteDesktopError("invalid_duration", "远程桌面时长必须为 1 至 60 分钟的整数。")
        return duration

    @staticmethod
    def _output_value(output: str, label: str) -> str:
        match = re.search(r"(?m)^" + re.escape(label) + r":\s*(\S+)\s*$", output)
        return match.group(1) if match else ""

    @staticmethod
    def _guest_path(url: str) -> str:
        try:
            parsed = urlsplit(url)
            query = parse_qs(parsed.query, keep_blank_values=True)
            if (parsed.scheme not in {"http", "https"}
                    or parsed.path not in {"/sharing", "/default/sharing"}
                    or not query.get("c") or not query["c"][0]):
                raise ValueError("unexpected guest link")
            if parsed.username or parsed.password or parsed.fragment or ".." in parsed.path.split("/"):
                raise ValueError("unsafe guest link")
            return parsed.path + "?" + parsed.query
        except ValueError as error:
            raise RemoteDesktopError("invalid_guest_link", "MeshCentral 返回的 guest 页面链接无效。") from error

    @staticmethod
    def _public_share(item: dict[str, Any]) -> dict[str, Any]:
        return {"protocol": 1, "target_id": item["target_id"], "grant_id": item["grant_id"],
                "share_id": item["share_id"], "guest_path": item["guest_path"],
                "expires_at": item["expires_at"], "consent": item["consent"],
                "view_only": item["view_only"], "view_only_reason": item.get("view_only_reason", "")}

    def _free_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])

    def _load_record(self) -> dict[str, Any] | None:
        value = self._read_json(self.record_path, {})
        return value if isinstance(value, dict) else None

    def _save_record(self, value: dict[str, Any]) -> None:
        self._atomic_json(self.record_path, value)

    def _load_shares(self) -> dict[str, Any]:
        value = self._read_json(self.shares_path, {})
        if not isinstance(value, dict):
            raise RemoteDesktopError("share_store_unreadable", "远程桌面授权记录不可读取。")
        return value

    def _save_shares(self, value: dict[str, Any]) -> None:
        self._atomic_json(self.shares_path, value)

    def _load_admin(self) -> dict[str, str] | None:
        value = self._read_json(self.admin_path, {})
        if isinstance(value, dict) and isinstance(value.get("username"), str) and isinstance(value.get("password"), str):
            return {"username": value["username"], "password": value["password"]}
        return None

    def _save_admin(self, value: dict[str, str]) -> None:
        self._atomic_json(self.admin_path, value)

    @staticmethod
    def _read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return fallback
        except (OSError, ValueError) as error:
            raise RemoteDesktopError("remote_desktop_state_unreadable", "远程桌面状态文件不可读取。") from error

    def _atomic_json(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".meshcentral-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            self._secure_file(Path(temporary))
            os.replace(temporary, path)
            self._secure_file(path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def _atomic_bytes(self, path: Path, value: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".meshcentral-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(value)
                stream.flush()
                os.fsync(stream.fileno())
            self._secure_file(Path(temporary))
            os.replace(temporary, path)
            self._secure_file(path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    @staticmethod
    def _secure_file(path: Path) -> None:
        if os.name != "nt":
            path.chmod(0o600)

    def _owned_server(self, record: dict[str, Any]) -> bool:
        try:
            process = psutil.Process(int(record["pid"]))
            return (abs(process.create_time() - float(record["create_time"])) < 0.01
                    and Path(process.exe()).resolve() == self.node
                    and str(self.entry) in process.cmdline()
                    and str(self.root) in process.cmdline())
        except (psutil.Error, OSError, ValueError, KeyError, TypeError):
            return False

    @staticmethod
    def _pid_exists(record: dict[str, Any]) -> bool:
        try:
            return psutil.pid_exists(int(record["pid"]))
        except (psutil.Error, OSError, ValueError, KeyError, TypeError):
            return True

    @staticmethod
    def _process_create_time(pid: int) -> float:
        try:
            return psutil.Process(pid).create_time()
        except psutil.Error as error:
            raise RemoteDesktopError("meshcentral_process_identity_unavailable", "MeshCentral 进程身份不可用。") from error
