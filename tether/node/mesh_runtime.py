"""Small, process-scoped EasyTier 2.6.4 runtime adapter.

The controller is the sole source of network configuration and credentials.
This module only writes validated per-instance config, starts/stops an
EasyTier process it created, and reads that instance through easytier-cli.

CLI/config references were checked against EasyTier/EasyTier tag v2.6.4:
https://github.com/EasyTier/EasyTier/tree/v2.6.4
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

try:
    import tomllib
except ImportError:  # Python 3.10
    from . import _tomli as tomllib

try:
    import psutil
except ImportError:  # pragma: no cover - declared by the Node runtime
    psutil = None


class MeshRuntimeError(RuntimeError):
    """A safe-to-report runtime error; messages never contain credential data."""


class MeshRelayBusy(MeshRuntimeError):
    """The selected node has work using the current core."""


CADDY_PORT_RANGE = range(52000, 52064)
SOCKS_PORT_RANGE = range(53000, 53064)
SFTP_PORT = 20222
SFTP_RELAY_PORT = 20223
SFTP_RELAY_CONFIG = ".sftp-relay-effective"
# The management portal stays on loopback and only loopback may talk to it, so the
# Node can read this instance's peer table with easytier-cli and nothing else can.
RPC_ALLOW_CIDR = "127.0.0.1/32"
PEER_HEALTH_MAX_AGE = 10.0
PEER_QUERY_TIMEOUT = 6
UNKNOWN_PEER_HEALTH: dict[str, Any] = {
    "peers": None, "peer_connectivity": "unknown", "peer_count": None,
    "remote_peer_count": None, "cost": None,
    "tunnel": None, "latency_ms": None, "loss_rate": None, "nat_type": None, "peer_read_at": None,
}
MEMBER_WSS_ENV = "TETHER_MESH_MEMBER_WSS"
TRANSPORT_CONFIG = ".transport-runtime.toml"
MESH_VIP_POOL = ipaddress.IPv4Network("10.240.0.0/12")
SERVICE_IP_POOL = ipaddress.IPv4Network("10.224.0.0/12")


def secure_private_directory(path: str | Path) -> Path:
    """Restrict exactly one caller-owned directory to its current user and SYSTEM."""
    target = Path(path).resolve()
    if not target.is_dir():
        raise MeshRuntimeError("private_directory_missing", "私有数据目录不存在。")
    if os.name != "nt":
        target.chmod(0o700)
        return target
    identity = subprocess.run(["whoami.exe", "/user", "/fo", "csv", "/nh"],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=5, check=False, shell=False)
    match = re.search(rb"S-1-(?:\d+-)+\d+", identity.stdout)
    if identity.returncode or not match:
        raise MeshRuntimeError("private_directory_acl_failed", "私有数据目录 ACL 无法确认。")
    user_sid = match.group(0).decode("ascii")
    acl = subprocess.run(["icacls.exe", str(target), "/inheritance:r", "/grant:r",
                          f"*{user_sid}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, timeout=10, check=False, shell=False)
    if acl.returncode:
        raise MeshRuntimeError("private_directory_acl_failed", "私有数据目录 ACL 无法确认。")
    return target


_INSTANCE_LOCKS: dict[str, threading.RLock] = {}
_INSTANCE_LOCKS_GUARD = threading.Lock()


class EasyTierRuntime:
    """Manage product-owned EasyTier instances in a dedicated data directory.

    Args:
        core_executable: Installed EasyTier 2.6.4 easytier-core executable.
        cli_executable: Matching easytier-cli executable.
        data_root: Private writable root owned by the Tether Node.
    """

    def __init__(self, core_executable: str | Path, cli_executable: str | Path, data_root: str | Path,
                 *, record_root: str | Path | None = None):
        self.core = Path(core_executable).resolve()
        self.cli = Path(cli_executable).resolve()
        self.root = Path(data_root).resolve()
        self.record_root = Path(record_root).resolve() if record_root is not None else self.root
        if psutil is None:
            raise MeshRuntimeError("process identity support is unavailable")
        self.root.mkdir(parents=True, exist_ok=True)
        self.record_root.mkdir(parents=True, exist_ok=True)
        self._records = self.record_root / "instances.json"
        self._applying_sftp_topology = threading.Lock()
        self._applying_sftp_networks = {}
        self._peer_guard = threading.Lock()
        self._peer_cache: dict[str, tuple[float, dict[str, Any]]] = {}

    def apply(self, config: dict[str, Any]) -> dict[str, Any]:
        """Apply trusted Controller configuration; unchanged config is a no-op.

        Required fields: network_id, instance_id, revision, network_name,
        ipv4, service_ip, peers, credential_private_key. `peers` is a list of EasyTier
        peer URLs. A caller must only pass Controller-authenticated data.
        """
        values = self._validate_config(config)
        with self._instance_lock(values["instance_id"]):
            with self._applying_sftp_topology:
                self._applying_sftp_networks[values["instance_id"]] = values["network_id"]
            try:
                return self._apply_locked(values)
            finally:
                with self._applying_sftp_topology:
                    self._applying_sftp_networks.pop(values["instance_id"])

    def _apply_locked(self, values: dict[str, Any], *,
                      restored_credential_file: str | None = None) -> dict[str, Any]:
        instance_id = values["instance_id"]
        directory = self._instance_dir(instance_id)
        directory.mkdir(parents=True, exist_ok=True)
        self._secure_instance_directory(directory)
        config_path = directory / "config.toml"
        candidate_path = directory / ".config.validate.toml"
        credential_path = directory / "managed-credentials.json"
        records = self._load_records()
        record = records.get(instance_id)
        self._validate_child_runtime()
        socks_port = self._socks_port(instance_id, values["network_id"], records)
        render_values = {**values, "socks_port": socks_port}
        body = self._render_config(render_values, credential_path)
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        member_wss = self._member_wss(values["network_id"], values["peers"])
        if member_wss:
            # Preserve the digest written by existing member WSS deployments.
            transport = {"relay": None, "quic": False, "member_wss": member_wss}
            transport_digest = hashlib.sha256(json.dumps(transport, sort_keys=True).encode()).hexdigest()
        else:
            transport_digest = None
        transport_candidate_path = directory / ".transport.validate.toml"
        transport_config_path = directory / TRANSPORT_CONFIG
        if record:
            if record.get("network_id") != values["network_id"]:
                raise MeshRuntimeError("instance_id is already assigned to another network")
            previous_revision = record.get("revision")
            if type(previous_revision) is int and values["revision"] < previous_revision:
                raise MeshRuntimeError("stale network configuration revision")
            if (type(previous_revision) is int and values["revision"] == previous_revision and
                    record.get("config_sha256") != digest and
                    not self._legacy_mesh_template_only(config_path, body)):
                previous_digest = digest
                if restored_credential_file is not None:
                    previous_body = self._render_config(render_values, restored_credential_file)
                    previous_digest = hashlib.sha256(previous_body.encode("utf-8")).hexdigest()
                if previous_digest != record.get("config_sha256"):
                    raise MeshRuntimeError("configuration changed without a new revision")
        if (record and record.get("network_id") == values["network_id"] and record.get("config_sha256") == digest
                and record.get("transport_sha256") == transport_digest and self._owned_process(record)):
            if record.get("revision") != values["revision"]:
                record["revision"] = values["revision"]
                records[instance_id] = record
                self._save_records(records)
            return self.status(instance_id)

        self._atomic_text(candidate_path, body)
        try:
            self._check_config(candidate_path, values["network_name"], values["credential_private_key"])
            if member_wss:
                # Keep the Hub state independent of this Node-local transport.
                transport_values = dict(render_values)
                if member_wss["mode"] == "listen":
                    transport_values["member_wss_port"] = member_wss["port"]
                transport_body = self._render_config(transport_values, credential_path)
                if member_wss["mode"] == "dial":
                    transport_body += (f'\n[[peer]]\nuri = {self._toml_string(member_wss["uri"])}\n'
                                       f'peer_public_key = {self._toml_string(member_wss["public_key"])}\n')
                self._atomic_text(transport_candidate_path, transport_body)
                self._check_config(transport_candidate_path, values["network_name"], values["credential_private_key"])
        except Exception:
            candidate_path.unlink(missing_ok=True)
            transport_candidate_path.unlink(missing_ok=True)
            raise
        if record and self._pid_exists(record):
            if not self._owned_process(record):
                candidate_path.unlink(missing_ok=True)
                transport_candidate_path.unlink(missing_ok=True)
                raise MeshRuntimeError("existing EasyTier process identity cannot be verified")
            self._stop_record(record)

        if not credential_path.exists():
            self._atomic_text(credential_path, "{}\n")
        if member_wss:
            os.replace(transport_candidate_path, transport_config_path)
            self._prepare_child_directory(directory, transport_config_path, credential_path)
        else:
            transport_candidate_path.unlink(missing_ok=True)
            transport_config_path.unlink(missing_ok=True)
        os.replace(candidate_path, config_path)
        self._restrict(config_path)
        if not self._port_available(socks_port):
            raise MeshRuntimeError("EasyTier SOCKS listener port is already in use")
        port = self._rpc_port(instance_id, records)
        self._prepare_child_directory(directory, config_path, credential_path)
        process = self._start(instance_id, directory, port, values["network_name"], values["credential_private_key"],
                              transport_config_path if transport_digest else None)
        record = {
            "network_id": values["network_id"],
            "instance_id": instance_id,
            "revision": values["revision"],
            "config_sha256": digest,
            "ipv4": values["ipv4"],
            "service_ip": values["service_ip"],
            "socks_port": socks_port,
            "directory": str(directory),
            "config_path": str(config_path),
            "rpc_port": port,
            "pid": process.pid,
            "create_time": self._create_time(process.pid),
            "executable": str(self.core),
            "launch_sha256": self.launch_sha256(),
        }
        if transport_digest:
            record["transport_sha256"] = transport_digest
        records[instance_id] = record
        self._save_records(records)
        with self._peer_guard:
            self._peer_cache.pop(instance_id, None)
        return self._wait_ready(instance_id, record)

    def status(self, instance_id: str) -> dict[str, Any]:
        """Return one instance's actual native status, or an explicit stopped state."""
        instance_id = self._uuid(instance_id, "instance_id")
        with self._instance_lock(instance_id):
            return self._status_locked(instance_id)

    def status_for_network(self, network_id: str) -> dict[str, Any]:
        """Resolve a controller network to its unique managed instance status."""
        network_id = self._uuid(network_id, "network_id")
        matches = [record for record in self._load_records().values()
                   if isinstance(record, dict) and record.get("network_id") == network_id]
        if not matches:
            return {"state": "not_connected", "network_id": network_id, "instance_id": None,
                    "revision": None, "node": None, "peers": None}
        if len(matches) != 1:
            return {"state": "ambiguous", "network_id": network_id, "instance_id": None,
                    "revision": None, "node": None, "peers": None}
        record = matches[0]
        instance_id = record.get("instance_id")
        if not isinstance(instance_id, str):
            return {"state": "unverified", "network_id": network_id, "instance_id": None,
                    "revision": record.get("revision"), "node": None, "peers": None}
        result = self.status(instance_id)
        if result.get("network_id") != network_id:
            return {"state": "unverified", "network_id": network_id, "instance_id": instance_id,
                    "revision": result.get("revision"), "node": None, "peers": None}
        return result

    def restore_stopped_network(self, network_id: str, *, expected_instance: str | None = None,
                                expected_revision: int | None = None,
                                expected_service_ip: str | None = None) -> dict[str, Any]:
        """Restart only a recorded, stopped instance from its unchanged local config."""
        network_id = self._uuid(network_id, "network_id")
        matches = [(instance_id, record) for instance_id, record in self._load_records().items()
                   if isinstance(record, dict) and record.get("network_id") == network_id]
        if len(matches) != 1:
            raise MeshRuntimeError("existing paired network instance is unavailable")
        instance_id, _record = matches[0]
        with self._instance_lock(instance_id):
            records = self._load_records()
            record = records.get(instance_id)
            if (not isinstance(record, dict) or record.get("instance_id") != instance_id
                    or record.get("network_id") != network_id
                    or type(record.get("revision")) is not int or record["revision"] < 1):
                raise MeshRuntimeError("existing paired network record is invalid")
            if expected_instance is not None and (instance_id != expected_instance
                    or record["revision"] != expected_revision or record.get("service_ip") != expected_service_ip):
                raise MeshRuntimeError("saved network does not match the current Hub membership")
            status = self._status_locked(instance_id)
            if (status.get("state") == "ready" and status.get("network_id") == network_id
                    and status.get("revision") == record["revision"]):
                return status
            if status.get("state") != "stopped" or self._pid_exists(record):
                raise MeshRuntimeError("existing EasyTier instance is not verifiably stopped")
            directory = self._instance_dir(instance_id)
            config_path = directory / "config.toml"
            if (directory.is_symlink() or config_path.is_symlink()
                    or Path(str(record.get("directory") or "")).resolve() != directory
                    or Path(str(record.get("config_path") or "")).resolve() != config_path):
                raise MeshRuntimeError("existing network configuration path is invalid")
            try:
                body = config_path.read_bytes()
            except OSError as error:
                raise MeshRuntimeError("existing network configuration is unavailable") from error
            digest = hashlib.sha256(body).hexdigest()
            if not re.fullmatch(r"[a-f0-9]{64}", str(record.get("config_sha256") or "")) or digest != record.get("config_sha256"):
                raise MeshRuntimeError("existing network configuration changed")
            try:
                saved = tomllib.loads(body.decode("utf-8"))
                peers = [peer["uri"] for peer in saved.get("peer", [])]
                service_ip = saved["proxy_network"][0]["mapped_cidr"].removesuffix("/32")
                config = {
                    "network_id": network_id,
                    "instance_id": instance_id,
                    "revision": record["revision"],
                    "network_name": saved["network_identity"]["network_name"],
                    "ipv4": saved["ipv4"],
                    "service_ip": service_ip,
                    "peers": peers,
                    "credential_private_key": saved["secure_mode"]["local_private_key"],
                }
                values = self._validate_config(config)
                if (values["ipv4"] != record.get("ipv4")
                        or values["service_ip"] != record.get("service_ip")
                        or type(record.get("socks_port")) is not int
                        or record["socks_port"] not in SOCKS_PORT_RANGE):
                    raise MeshRuntimeError("existing network configuration does not match its record")
                saved_credential_file = saved["credential_file"]
                saved_credential_path = Path(saved_credential_file)
                credential_path = directory / "managed-credentials.json"
                if (saved_credential_path.resolve(strict=False) != credential_path.resolve(strict=False)
                        or saved_credential_path.is_symlink()
                        or saved["instance_id"] != instance_id
                        or saved["socks5_proxy"] != f"socks5://127.0.0.1:{record['socks_port']}"):
                    raise MeshRuntimeError("existing network configuration does not match its record")
                restored_credential_file = None
                if saved_credential_file != str(credential_path):
                    if (not saved_credential_path.is_absolute() or credential_path.is_symlink()
                            or not (saved_credential_path.is_file() and credential_path.is_file())):
                        raise MeshRuntimeError("existing network credential file is unavailable")
                    restored_credential_file = saved_credential_file
            except (KeyError, IndexError, TypeError, ValueError) as error:
                raise MeshRuntimeError("existing network configuration is invalid") from error
            return self._apply_locked(values, restored_credential_file=restored_credential_file)

    def _status_locked(self, instance_id: str) -> dict[str, Any]:
        record = self._load_records().get(instance_id)
        if not record:
            return {"state": "stopped", "network_id": record.get("network_id") if record else None,
                    "instance_id": instance_id, "revision": record.get("revision") if record else None,
                    "service_ip": None, "socks_proxy": None, "node": None, "peers": None,
                    "peer_connectivity": "unknown"}
        if not self._owned_process(record):
            state = "unverified" if self._pid_exists(record) else "stopped"
            return {"state": state, "network_id": record.get("network_id"),
                    "instance_id": instance_id, "revision": record.get("revision"),
                    "service_ip": record.get("service_ip"), "socks_proxy": None,
                    "node": None, "peers": None, "peer_connectivity": "unknown"}
        node = {"ipv4": str(record.get("ipv4", "")).split("/", 1)[0]}
        if not self._socks_ready(record):
            return {"state": "starting", "network_id": record["network_id"],
                    "instance_id": instance_id, "revision": record["revision"],
                    "service_ip": record.get("service_ip"), "socks_proxy": None,
                    "node": node, "peers": None, "peer_connectivity": "unknown"}
        return {"state": "ready", "network_id": record["network_id"], "instance_id": instance_id,
                "revision": record["revision"], "service_ip": record.get("service_ip"),
                "node": node, "socks_proxy": {"host": "127.0.0.1", "port": record["socks_port"]},
                **({"sftp_relay_port": SFTP_RELAY_PORT} if record.get("sftp_relay") else {}),
                **self._peer_fields(instance_id)}

    def _peer_fields(self, instance_id: str) -> dict[str, Any]:
        """Last read peer table; never invents a value the runtime did not return."""
        with self._peer_guard:
            cached = self._peer_cache.get(instance_id)
        return dict(cached[1]) if cached else dict(UNKNOWN_PEER_HEALTH)

    def peer_health(self, instance_id: str, *, max_age: float = PEER_HEALTH_MAX_AGE) -> dict[str, Any]:
        """Read this instance's peer table through its own RPC portal, with caching."""
        instance_id = self._uuid(instance_id, "instance_id")
        now = time.monotonic()
        with self._peer_guard:
            cached = self._peer_cache.get(instance_id)
        if cached and now - cached[0] < max_age:
            return dict(cached[1])
        payload = self._read_peer_health(self._load_records().get(instance_id))
        with self._peer_guard:
            self._peer_cache[instance_id] = (time.monotonic(), payload)
        return dict(payload)

    def _read_peer_health(self, record: dict[str, Any] | None) -> dict[str, Any]:
        result = dict(UNKNOWN_PEER_HEALTH)
        if not isinstance(record, dict) or type(record.get("rpc_port")) is not int:
            result["error"] = "instance_not_recorded"
            return result
        if not self.cli.is_file():
            result["error"] = "cluster_cli_missing"
            return result
        argv = [str(self.cli), "-p", f"127.0.0.1:{record['rpc_port']}", "-o", "json", "peer", "list"]
        try:
            completed = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, timeout=PEER_QUERY_TIMEOUT,
                                       check=False, shell=False)
        except (OSError, subprocess.SubprocessError):
            result["error"] = "peer_query_failed"
            return result
        if completed.returncode:
            result["error"] = "peer_query_failed"
            return result
        try:
            value = json.loads(completed.stdout.decode("utf-8", "replace"))
        except (UnicodeDecodeError, ValueError):
            result["error"] = "peer_query_invalid"
            return result
        peers = self._safe_peers(value)
        result.update({"peers": peers, "peer_read_at": int(time.time())})
        result.update(self._peer_summary(peers))
        return result

    @staticmethod
    def _peer_summary(peers: list[dict[str, Any]]) -> dict[str, Any]:
        # easytier-cli renders every metric as text ("218.68", "0.0%", "-"), and the
        # node itself appears in the table with cost "Local"; both are handled here
        # instead of being passed on as if they were measurements.
        remote = [peer for peer in peers if str(peer.get("cost") or "").lower() != "local"]
        metrics = [(peer, EasyTierRuntime._peer_number(peer.get("latency_ms")),
                    EasyTierRuntime._peer_number(peer.get("loss_rate"))) for peer in remote]
        direct = [item for item in metrics if str(item[0].get("cost") or "").lower() in {"p2p", "direct"}]
        relayed = [item for item in metrics if str(item[0].get("cost") or "").lower().startswith("relay")]
        if direct:
            connectivity = "direct"
        elif relayed:
            connectivity = "relay"
        else:
            connectivity = "unknown"
        pool = direct or relayed or metrics
        best = (min(pool, key=lambda item: item[1] if item[1] is not None else float("inf"))
                if pool else ({}, None, None))
        return {"peer_connectivity": connectivity,
                "peer_count": len(peers),
                "remote_peer_count": len(remote),
                "cost": best[0].get("cost"),
                "tunnel": best[0].get("tunnel_type") or None,
                "latency_ms": best[1],
                "loss_rate": best[2],
                "nat_type": best[0].get("nat_type") or None}

    @staticmethod
    def _peer_number(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if not isinstance(value, str):
            return None
        match = re.match(r"\s*(-?\d+(?:\.\d+)?)", value)
        return float(match.group(1)) if match else None

    def has_single_sftp_network(self, network_id: str) -> bool:
        # Every managed instance maps its service IPv4 back to the same loopback.
        # A second configured instance might become reachable during this lease.
        with self._applying_sftp_topology:
            records = self._load_records()
            if len(records) != 1:
                return False
            instance_id, record = next(iter(records.items()))
            return (record.get("network_id") == network_id
                    and all(key == instance_id and value == network_id
                            for key, value in self._applying_sftp_networks.items()))

    def set_sftp_relay_mapping(self, network_id: str, enabled: bool, busy) -> None:
        status = self.status_for_network(network_id)
        if status.get("state") != "ready":
            raise MeshRuntimeError("the managed relay network is not ready")
        instance = status["instance_id"]
        with self._instance_lock(instance):
            records = self._load_records()
            original = records.get(instance)
            if (not original or original.get("network_id") != network_id
                    or not self._owned_process(original)):
                raise MeshRuntimeError("the managed relay network changed")
            if bool(original.get("sftp_relay")) == enabled:
                return
            if busy():
                raise MeshRelayBusy("the managed relay network is busy")
            directory = self._instance_dir(instance)
            config_path = directory / "config.toml"
            override = directory / SFTP_RELAY_CONFIG
            base = config_path.read_text(encoding="utf-8")
            if hashlib.sha256(base.encode("utf-8")).hexdigest() != original.get("config_sha256"):
                raise MeshRuntimeError("the managed base configuration changed")
            network = re.search(r'^network_name = "([^"\n]+)"$', base, re.M)
            secret = re.search(r'^local_private_key = "([A-Za-z0-9+/=]+)"$', base, re.M)
            if not network or not secret:
                raise MeshRuntimeError("the managed base configuration is not recognized")
            network_name, credential = network[1], secret[1]
            transport = directory / TRANSPORT_CONFIG if original.get("transport_sha256") else None
            effective_base = transport.read_text(encoding="utf-8") if transport else base
            if enabled:
                relay_acl = (
                    '\n[[acl.acl_v1.chains.rules]]\nname = "tether-sftp-relay"\npriority = 998\n'
                    'enabled = true\nprotocol = 1\n'
                    f'ports = ["{SFTP_RELAY_PORT}"]\ndestination_ips = ["{status["service_ip"]}/32"]\n'
                    'action = 1\nstateful = true\n'
                )
                self._atomic_text(override, effective_base + relay_acl)
                try:
                    self._check_config(override, network_name, credential)
                    self._prepare_child_directory(directory, override, directory / "managed-credentials.json")
                except Exception:
                    override.unlink(missing_ok=True)
                    raise
            if busy():
                if enabled:
                    override.unlink(missing_ok=True)
                raise MeshRelayBusy("the managed relay network is busy")

            def start(use_override):
                effective = override if use_override else transport
                process = self._start(instance, directory, original["rpc_port"], network_name, credential, effective)
                active = {**original, "pid": process.pid, "create_time": self._create_time(process.pid)}
                if use_override:
                    active["sftp_relay"] = True
                else:
                    active.pop("sftp_relay", None)
                records[instance] = active
                self._save_records(records)
                self._wait_ready(instance, active)

            self._stop_record(original)
            try:
                start(enabled)
            except Exception:
                attempt = records[instance]
                if self._owned_process(attempt):
                    self._stop_record(attempt)
                start(not enabled)
                if enabled:
                    override.unlink(missing_ok=True)
                raise
            if not enabled:
                override.unlink(missing_ok=True)

    def stale_sftp_relay_networks(self) -> list[str]:
        return [record["network_id"] for record in self._load_records().values()
                if isinstance(record, dict) and record.get("sftp_relay") and record.get("network_id")]

    def stop(self, instance_id: str) -> dict[str, Any]:
        """Stop only a process whose executable, pid and creation time still match."""
        instance_id = self._uuid(instance_id, "instance_id")
        with self._instance_lock(instance_id):
            return self._stop_locked(instance_id)

    def _stop_locked(self, instance_id: str) -> dict[str, Any]:
        records = self._load_records()
        record = records.get(instance_id)
        if not record:
            return {"state": "stopped", "instance_id": instance_id}
        if self._pid_exists(record) and not self._owned_process(record):
            raise MeshRuntimeError("existing EasyTier process identity cannot be verified")
        if self._owned_process(record):
            self._stop_record(record)
        records.pop(instance_id, None)
        self._save_records(records)
        with self._peer_guard:
            self._peer_cache.pop(instance_id, None)
        return {"state": "stopped", "instance_id": instance_id}

    def _validate_config(self, config: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(config, dict):
            raise MeshRuntimeError("invalid network configuration")
        required = {"network_id", "instance_id", "revision", "network_name", "ipv4", "service_ip",
                    "peers", "credential_private_key"}
        if set(config) != required:
            raise MeshRuntimeError("invalid network configuration fields")
        network_id = self._uuid(config["network_id"], "network_id")
        instance_id = self._uuid(config["instance_id"], "instance_id")
        revision = config["revision"]
        if type(revision) is not int or revision < 1:
            raise MeshRuntimeError("invalid configuration revision")
        name = config["network_name"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name):
            raise MeshRuntimeError("invalid network name")
        try:
            ipv4 = str(ipaddress.IPv4Interface(config["ipv4"]))
        except (ValueError, TypeError) as error:
            raise MeshRuntimeError("invalid virtual IPv4 address") from error
        vip = ipaddress.IPv4Interface(ipv4).ip
        try:
            service_ip = ipaddress.IPv4Address(config["service_ip"])
        except (ValueError, TypeError) as error:
            raise MeshRuntimeError("invalid service endpoint IPv4 address") from error
        if vip not in MESH_VIP_POOL or service_ip not in SERVICE_IP_POOL:
            raise MeshRuntimeError("service endpoint does not match the reserved address pools")
        expected_service_ip = ipaddress.IPv4Address(
            int(SERVICE_IP_POOL.network_address) + int(vip) - int(MESH_VIP_POOL.network_address))
        if service_ip != expected_service_ip:
            raise MeshRuntimeError("service endpoint does not map to the assigned mesh IPv4")
        peers = config["peers"]
        if not isinstance(peers, list) or len(peers) > 64:
            raise MeshRuntimeError("invalid peer list")
        normalized_peers = []
        for peer in peers:
            if not isinstance(peer, str) or len(peer) > 512:
                raise MeshRuntimeError("invalid peer list")
            parsed = urlsplit(peer)
            if parsed.scheme not in {"udp", "tcp", "quic", "wg", "wss"} or not parsed.hostname:
                raise MeshRuntimeError("invalid peer address")
            if parsed.username or parsed.password or parsed.fragment:
                raise MeshRuntimeError("invalid peer address")
            normalized_peers.append(peer)
        key = config["credential_private_key"]
        if not isinstance(key, str) or len(key) > 256:
            raise MeshRuntimeError("invalid network credential")
        try:
            decoded = base64.b64decode(key, validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise MeshRuntimeError("invalid network credential") from error
        if len(decoded) != 32:
            raise MeshRuntimeError("invalid network credential")
        if not self.core.is_file():
            raise MeshRuntimeError("EasyTier runtime is not installed")
        return {"network_id": network_id, "instance_id": instance_id, "revision": revision,
                "network_name": name, "ipv4": ipv4, "service_ip": str(service_ip), "peers": normalized_peers,
                "credential_private_key": key}

    def _render_config(self, config: dict[str, Any], credential_path: str | Path) -> str:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

        private_key = X25519PrivateKey.from_private_bytes(
            base64.b64decode(config["credential_private_key"], validate=True))
        public_key = base64.b64encode(private_key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode("ascii")
        listeners = ["tcp://0.0.0.0:0", "udp://0.0.0.0:0"]
        if config.get("member_wss_port") is not None:
            listeners.append(f'ws://127.0.0.1:{config["member_wss_port"]}')
        disable_relay_data = str(os.environ.get("TETHER_MESH_DISABLE_RELAY_DATA", "")).strip().lower() in ("1", "true")
        lines = [
            f'instance_name = "tether-{config["instance_id"]}"',
            f'instance_id = "{config["instance_id"]}"',
            f'ipv4 = "{config["ipv4"]}"',
            f"listeners = {json.dumps(listeners)}",
            f'socks5_proxy = "socks5://127.0.0.1:{config["socks_port"]}"',
            f'credential_file = {self._toml_string(str(credential_path))}',
            "",
            "[network_identity]",
            f'network_name = "{config["network_name"]}"',
            "",
            "[flags]",
            "no_tun = true",
            "use_smoltcp = true",
            f"disable_relay_data = {'true' if disable_relay_data else 'false'}",
            "",
            "[secure_mode]",
            "enabled = true",
            f'local_private_key = "{config["credential_private_key"]}"',
            f'local_public_key = "{public_key}"',
            "",
            "[[proxy_network]]",
            'cidr = "127.0.0.1/32"',
            f'mapped_cidr = "{config["service_ip"]}/32"',
            'allow = ["tcp"]',
            "",
            "[[acl.acl_v1.chains]]",
            'name = "tether-service-ports"',
            "chain_type = 3",
            "enabled = true",
            "default_action = 2",
            "",
            "[[acl.acl_v1.chains.rules]]",
            'name = "tether-caddy-workers"',
            "priority = 1000",
            "enabled = true",
            "protocol = 1",
            'ports = ["52000-52063"]',
            f'destination_ips = ["{config["service_ip"]}/32"]',
            "action = 1",
            "stateful = true",
            "",
            "[[acl.acl_v1.chains.rules]]",
            'name = "tether-sftpgo"',
            "priority = 999",
            "enabled = true",
            "protocol = 1",
            'ports = ["20222"]',
            f'destination_ips = ["{config["service_ip"]}/32"]',
            "action = 1",
            "stateful = true",
        ]
        for peer in config["peers"]:
            lines.extend(["", "[[peer]]", f'uri = {self._toml_string(peer)}'])
        return "\n".join(lines) + "\n"

    def _member_wss(self, network_id: str, peers: list[str]) -> dict[str, Any] | None:
        raw = os.environ.get(MEMBER_WSS_ENV)
        if not raw:
            return None
        try:
            values = json.loads(raw)
            common = {"network_id", "mode", "expires_at"}
            mode = values["mode"]
            if mode == "dial" and set(values) == common | {"uri", "public_key"}:
                self._validate_wss_pin(values, self._uuid(values["network_id"], "network_id"), peers)
            elif mode == "listen" and set(values) == common | {"port"}:
                if type(values["port"]) is not int or not 1024 <= values["port"] <= 65535:
                    raise ValueError
            else:
                raise ValueError
            if type(values["expires_at"]) is not int:
                raise ValueError
            if self._uuid(values["network_id"], "network_id") != network_id:
                return None
        except (ValueError, KeyError, TypeError, AttributeError, MeshRuntimeError) as error:
            raise MeshRuntimeError("invalid local EasyTier member WSS configuration") from error
        return values if values["expires_at"] > time.time() else None

    @staticmethod
    def _validate_wss_pin(values: dict[str, Any], network_id: str, peers: list[str]) -> None:
        uri = values["uri"]
        url = urlsplit(uri)
        if (len(uri) > 512 or url.scheme != "wss" or not url.hostname or url.username is not None
                or url.password is not None or url.fragment or url.path != "/tether-mesh-relay"
                or url.query != f"network={network_id}" or uri in peers):
            raise ValueError
        if len(base64.b64decode(values["public_key"], validate=True)) != 32:
            raise ValueError

    @staticmethod
    def _legacy_mesh_template_only(config_path: Path, candidate: str) -> bool:
        """Permit only safe template migrations (logger/listeners and disable_relay_data)."""
        try:
            previous = tomllib.loads(config_path.read_text(encoding="utf-8"))
            current = tomllib.loads(candidate)
        except (OSError, ValueError):
            return False
        prev_flags = previous.get("flags")
        curr_flags = current.get("flags")
        relay_migrated = False
        if (isinstance(prev_flags, dict) and isinstance(curr_flags, dict) and
                isinstance(prev_flags.get("disable_relay_data"), bool) and
                isinstance(curr_flags.get("disable_relay_data"), bool) and
                prev_flags.get("disable_relay_data") != curr_flags.get("disable_relay_data")):
            prev_flags = dict(prev_flags)
            curr_flags = dict(curr_flags)
            prev_flags.pop("disable_relay_data", None)
            curr_flags.pop("disable_relay_data", None)
            previous["flags"] = prev_flags
            current["flags"] = curr_flags
            relay_migrated = True
        if relay_migrated and previous == current:
            return True
        old_logger = previous.pop("file_logger", None)
        old_listeners = previous.pop("listeners", None)
        new_listeners = current.pop("listeners", None)
        return (old_logger is not None and old_listeners == [] and
                new_listeners == ["tcp://0.0.0.0:0", "udp://0.0.0.0:0"] and
                "file_logger" not in current and previous == current)

    @staticmethod
    def _native_log_level() -> str:
        if (os.environ.get("TETHER_EASYTIER_DIAGNOSTICS") == "1" and
                os.environ.get("TETHER_EASYTIER_LOG_LEVEL", "").strip().lower() == "debug"):
            return "debug"
        return "warn"

    @staticmethod
    def _toml_string(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)

    def _instance_lock(self, instance_id: str) -> threading.RLock:
        key = f"{self.root}\0{instance_id}"
        with _INSTANCE_LOCKS_GUARD:
            return _INSTANCE_LOCKS.setdefault(key, threading.RLock())

    def _instance_dir(self, instance_id: str) -> Path:
        return (self.root / "instances" / instance_id).resolve()

    def _rpc_port(self, instance_id: str, records: dict[str, Any]) -> int:
        existing = records.get(instance_id)
        if existing and type(existing.get("rpc_port")) is int:
            if self._port_available(existing["rpc_port"]):
                return existing["rpc_port"]
        raw = int(hashlib.sha256(instance_id.encode()).hexdigest()[:8], 16)
        start = raw % 20000
        reserved = {record.get("rpc_port") for key, record in records.items()
                    if key != instance_id and isinstance(record, dict)}
        for offset in range(20000):
            port = 30000 + (start + offset) % 20000
            if port in reserved:
                continue
            if self._port_available(port):
                return port
        raise MeshRuntimeError("no free loopback RPC port is available")

    def _socks_port(self, instance_id: str, network_id: str, records: dict[str, Any]) -> int:
        record = records.get(instance_id)
        if record and type(record.get("socks_port")) is int:
            return record["socks_port"]
        raw = int(hashlib.sha256(network_id.encode()).hexdigest()[:8], 16)
        reserved = {value.get("socks_port") for key, value in records.items()
                    if key != instance_id and isinstance(value, dict)}
        start = raw % len(SOCKS_PORT_RANGE)
        for offset in range(len(SOCKS_PORT_RANGE)):
            port = SOCKS_PORT_RANGE.start + (start + offset) % len(SOCKS_PORT_RANGE)
            if port not in reserved and self._port_available(port):
                return port
        raise MeshRuntimeError("socks_port_pool_exhausted: local network routes are unavailable")

    @staticmethod
    def _port_available(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return True
            except OSError:
                return False

    def _check_config(self, config_path: Path, network_name: str, credential: str) -> None:
        environment = {key: value for key, value in os.environ.items() if not key.startswith("ET_")}
        environment["ET_CREDENTIAL"] = credential
        result = subprocess.run([str(self.core), "--check-config", "--config-file", str(config_path),
                                 "--network-name", network_name],
                                cwd=str(config_path.parent), stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, env=environment,
                                check=False, shell=False)
        if result.returncode:
            raise MeshRuntimeError("EasyTier rejected the network configuration")

    def _start(self, instance_id: str, directory: Path, port: int,
               network_name: str, credential: str,
               transport_config_path: Path | None = None) -> subprocess.Popen:
        rpc = f"127.0.0.1:{port}"
        log_level = self._native_log_level()
        launch_path = transport_config_path or directory
        config_args = (["--config-file", str(transport_config_path)] if transport_config_path is not None
                       else ["--config-dir", str(directory)])
        argv = [str(self.core), *config_args, "--no-tun", "--use-smoltcp",
                "--rpc-portal", rpc, "--rpc-portal-whitelist", RPC_ALLOW_CIDR,
                "--network-name", network_name,
                "--file-log-level", log_level, "--file-log-dir", str(directory),
                "--file-log-size", "2", "--file-log-count", "2"]
        environment = {key: value for key, value in os.environ.items() if not key.startswith("ET_")}
        environment["ET_CREDENTIAL"] = credential
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        if os.name != "nt" and os.geteuid() == 0:
            try:
                import pwd
                identity = pwd.getpwnam("tether-easytier")
            except (ImportError, KeyError) as error:
                raise MeshRuntimeError("dedicated EasyTier service account is unavailable") from error
            setpriv = shutil.which("setpriv")
            if not setpriv:
                raise MeshRuntimeError("setpriv is required to run EasyTier without root privileges")
            argv = [setpriv, f"--reuid={identity.pw_uid}", f"--regid={identity.pw_gid}",
                    "--init-groups", "--no-new-privs", "--", *argv]
            dropped_privileges = True
        else:
            dropped_privileges = False
        try:
            process = subprocess.Popen(argv, cwd=str(directory), stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=environment,
                                       shell=False, close_fds=(os.name != "nt"),
                                       creationflags=creation_flags)
        except OSError as error:
            raise MeshRuntimeError("EasyTier could not start") from error
        if dropped_privileges:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise MeshRuntimeError("EasyTier exited before its executable identity was confirmed")
                try:
                    child = psutil.Process(process.pid)
                    if (Path(child.exe()).resolve() == self.core and
                              str(launch_path) in child.cmdline()):
                        return process
                except (psutil.Error, OSError):
                    pass
                time.sleep(0.05)
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
            raise MeshRuntimeError("EasyTier executable identity was not confirmed after privilege drop")
        return process

    def _wait_ready(self, instance_id: str, record: dict[str, Any]) -> dict[str, Any]:
        deadline = time.monotonic() + 15
        last_error = None
        while time.monotonic() < deadline:
            if not self._owned_process(record):
                raise MeshRuntimeError("EasyTier process exited before becoming ready")
            try:
                status = self.status(instance_id)
                if status.get("state") == "ready":
                    return status
                time.sleep(0.25)
            except (MeshRuntimeError, subprocess.SubprocessError, OSError, ValueError, json.JSONDecodeError) as error:
                last_error = error
                time.sleep(0.25)
        raise MeshRuntimeError("EasyTier native status did not become available") from last_error

    @staticmethod
    def _socks_ready(record: dict[str, Any]) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", int(record["socks_port"])), timeout=0.75) as sock:
                sock.settimeout(0.75)
                sock.sendall(b"\x05\x01\x00")
                return sock.recv(2) == b"\x05\x00"
        except (OSError, ValueError, KeyError, TypeError):
            return False

    @staticmethod
    def _prepare_child_directory(directory: Path, config_path: Path, credential_path: Path) -> None:
        if os.name == "nt" or os.geteuid() != 0:
            return
        import pwd
        try:
            identity = pwd.getpwnam("tether-easytier")
        except (ImportError, KeyError) as error:
            raise MeshRuntimeError("dedicated EasyTier service account is unavailable") from error
        instances_dir = directory.parent
        config_root = instances_dir.parent
        for path in (config_root, instances_dir, directory):
            path.mkdir(parents=True, exist_ok=True)
            os.chown(path, identity.pw_uid, identity.pw_gid)
            path.chmod(0o700)
        for path in (config_path, credential_path):
            if path.exists():
                os.chown(path, identity.pw_uid, identity.pw_gid)
                path.chmod(0o600)

    @staticmethod
    def _validate_child_runtime() -> None:
        if os.name == "nt" or os.geteuid() != 0:
            return
        try:
            import pwd
            pwd.getpwnam("tether-easytier")
        except (ImportError, KeyError) as error:
            raise MeshRuntimeError("dedicated EasyTier service account is unavailable") from error
        if not shutil.which("setpriv"):
            raise MeshRuntimeError("setpriv is required to run EasyTier without root privileges")

    @staticmethod
    def _safe_node(value: Any) -> Any:
        if isinstance(value, list):
            return [EasyTierRuntime._safe_node(item) for item in value]
        if not isinstance(value, dict):
            return None
        aliases = {"inst_id": "instance_id", "ipv4_addr": "ipv4", "ipv6_addr": "ipv6"}
        allowed = {"instance_id", "instance_name", "hostname", "ipv4", "ipv6", "listeners", "stun_info", "version", "feature_flag", "ip_list", "peer_id"}
        safe = {aliases.get(key, key): value[key] for key in value
                if aliases.get(key, key) in allowed and isinstance(value[key], (str, int, float, bool, list, dict, type(None)))}
        nested = value.get("result")
        if not isinstance(nested, dict):
            nested = value.get("node")
        if isinstance(nested, dict):
            safe.update({aliases.get(key, key): nested[key] for key in nested
                         if aliases.get(key, key) in allowed and isinstance(nested[key], (str, int, float, bool, list, dict, type(None)))})
        return safe

    @staticmethod
    def _safe_peers(value: Any) -> Any:
        if isinstance(value, list):
            rows = value
        elif isinstance(value, dict) and isinstance(value.get("result"), list):
            rows = value["result"]
        else:
            rows = []
        aliases = {"id": "peer_id", "lat_ms": "latency_ms", "tunnel_proto": "tunnel_type"}
        allowed = {"peer_id", "hostname", "ipv4", "cidr", "cost", "latency_ms", "loss_rate", "rx_bytes", "tx_bytes", "tunnel_type", "nat_type", "version"}
        return [{aliases.get(key, key): row[key] for key in row
                 if aliases.get(key, key) in allowed and isinstance(row[key], (str, int, float, bool, list, type(None)))}
                for row in rows if isinstance(row, dict)]

    def _owned_process(self, record: dict[str, Any]) -> bool:
        try:
            process = psutil.Process(int(record["pid"]))
            directory = self._instance_dir(record["instance_id"])
            launch_path = (directory / SFTP_RELAY_CONFIG if record.get("sftp_relay") else
                           directory / TRANSPORT_CONFIG if record.get("transport_sha256") else directory)
            return (abs(process.create_time() - float(record["create_time"])) < 0.01
                    and Path(process.exe()).resolve() in self._instance_executables(record)
                    and str(launch_path) in process.cmdline())
        except (psutil.Error, OSError, ValueError, KeyError, TypeError):
            return False

    def _instance_executables(self, record: dict[str, Any]) -> tuple[Path, ...]:
        """Binaries this instance may legitimately run: the installed one or the recorded one.

        The record is written by this Node into its private data directory, so a recorded
        EasyTier binary stays attributable across a Node/runtime upgrade.
        """
        paths = [self.core]
        recorded = record.get("executable")
        if isinstance(recorded, str) and Path(recorded).name.lower().startswith("easytier-core"):
            try:
                paths.append(Path(recorded).resolve())
            except OSError:
                pass
        return tuple(dict.fromkeys(paths))

    def launch_sha256(self) -> str:
        """Signature of the launch flags that affect supervision and observability."""
        body = json.dumps({"core": str(self.core), "rpc_whitelist": RPC_ALLOW_CIDR,
                           "no_tun": True, "use_smoltcp": True, "log": self._native_log_level()},
                          sort_keys=True)
        return hashlib.sha256(body.encode("utf-8")).hexdigest()

    def managed_networks(self) -> list[dict[str, Any]]:
        """Recorded networks this Node owns; the only input of the lifecycle loop."""
        entries: list[dict[str, Any]] = []
        for instance_id, record in self._load_records().items():
            if not isinstance(record, dict) or record.get("instance_id") != instance_id:
                continue
            network_id, revision = record.get("network_id"), record.get("revision")
            if not isinstance(network_id, str) or type(revision) is not int:
                continue
            entries.append({"network_id": network_id, "instance_id": instance_id, "revision": revision,
                            "launch_sha256": record.get("launch_sha256")})
        return entries

    def relaunch(self, instance_id: str, *, network_id: str | None = None) -> dict[str, Any]:
        """Restart one of this Node's own instances from its unchanged local config."""
        instance_id = self._uuid(instance_id, "instance_id")
        with self._instance_lock(instance_id):
            record = self._load_records().get(instance_id)
            if not isinstance(record, dict) or not self._owned_process(record):
                raise MeshRuntimeError("existing EasyTier process identity cannot be verified")
            if network_id is not None and record.get("network_id") != self._uuid(network_id, "network_id"):
                raise MeshRuntimeError("existing EasyTier instance belongs to another network")
            self._stop_record(record)
            return self.restore_stopped_network(record["network_id"])

    @staticmethod
    def _pid_exists(record: dict[str, Any]) -> bool:
        try:
            return psutil.pid_exists(int(record["pid"]))
        except (psutil.Error, OSError, ValueError, KeyError, TypeError):
            return True

    @staticmethod
    def _create_time(pid: int) -> float:
        try:
            return psutil.Process(pid).create_time()
        except psutil.Error as error:
            raise MeshRuntimeError("EasyTier process identity is unavailable") from error

    def _stop_record(self, record: dict[str, Any]) -> None:
        if not self._owned_process(record):
            return
        process = psutil.Process(int(record["pid"]))
        try:
            process.terminate()
            process.wait(timeout=8)
        except psutil.TimeoutExpired:
            if self._owned_process(record):
                process.kill()
                process.wait(timeout=3)
        except psutil.Error as error:
            raise MeshRuntimeError("EasyTier process could not be stopped") from error

    def _load_records(self) -> dict[str, Any]:
        try:
            value = json.loads(self._records.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except FileNotFoundError:
            return {}
        except (OSError, ValueError):
            raise MeshRuntimeError("EasyTier process records are unreadable")

    def _save_records(self, records: dict[str, Any]) -> None:
        self._atomic_text(self._records, json.dumps(records, separators=(",", ":"), sort_keys=True))

    def _atomic_text(self, path: Path, value: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".mesh-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(value)
                stream.flush()
                os.fsync(stream.fileno())
            self._restrict(Path(temporary))
            os.replace(temporary, path)
            self._restrict(path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    @staticmethod
    def _restrict(path: Path, is_dir: bool = False) -> None:
        if os.name != "nt":
            path.chmod(0o700 if is_dir else 0o600)

    @staticmethod
    def _secure_instance_directory(path: Path) -> None:
        secure_private_directory(path)

    @staticmethod
    def _uuid(value: Any, field: str) -> str:
        try:
            parsed = uuid.UUID(value).hex
        except (ValueError, TypeError, AttributeError) as error:
            raise MeshRuntimeError(f"invalid {field}") from error
        return parsed
