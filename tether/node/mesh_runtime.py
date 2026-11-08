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
    import psutil
except ImportError:  # pragma: no cover - declared by the Node runtime
    psutil = None


class MeshRuntimeError(RuntimeError):
    """A safe-to-report runtime error; messages never contain credential data."""


CADDY_PORT_RANGE = range(52000, 52064)
SOCKS_PORT_RANGE = range(53000, 53064)
SFTP_PORT = 20222
RPC_DENY_CIDR = "192.0.2.1/32"
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

    def apply(self, config: dict[str, Any]) -> dict[str, Any]:
        """Apply trusted Controller configuration; unchanged config is a no-op.

        Required fields: network_id, instance_id, revision, network_name,
        ipv4, service_ip, peers, credential_private_key. `peers` is a list of EasyTier
        peer URLs. A caller must only pass Controller-authenticated data.
        """
        values = self._validate_config(config)
        with self._instance_lock(values["instance_id"]):
            return self._apply_locked(values)

    def _apply_locked(self, values: dict[str, Any]) -> dict[str, Any]:
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
        if record:
            if record.get("network_id") != values["network_id"]:
                raise MeshRuntimeError("instance_id is already assigned to another network")
            previous_revision = record.get("revision")
            if type(previous_revision) is int and values["revision"] < previous_revision:
                raise MeshRuntimeError("stale network configuration revision")
            if type(previous_revision) is int and values["revision"] == previous_revision and record.get("config_sha256") != digest:
                raise MeshRuntimeError("configuration changed without a new revision")
        if record and record.get("network_id") == values["network_id"] and record.get("config_sha256") == digest and self._owned_process(record):
            if record.get("revision") != values["revision"]:
                record["revision"] = values["revision"]
                records[instance_id] = record
                self._save_records(records)
            return self.status(instance_id)

        self._atomic_text(candidate_path, body)
        try:
            self._check_config(candidate_path)
        except Exception:
            candidate_path.unlink(missing_ok=True)
            raise
        if record and self._pid_exists(record):
            if not self._owned_process(record):
                candidate_path.unlink(missing_ok=True)
                raise MeshRuntimeError("existing EasyTier process identity cannot be verified")
            self._stop_record(record)

        if not credential_path.exists():
            self._atomic_text(credential_path, "{}\n")
        os.replace(candidate_path, config_path)
        self._restrict(config_path)
        if not self._port_available(socks_port):
            raise MeshRuntimeError("EasyTier SOCKS listener port is already in use")
        port = self._rpc_port(instance_id, records)
        self._prepare_child_directory(directory, config_path, credential_path)
        process = self._start(instance_id, directory, port)
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
        }
        records[instance_id] = record
        self._save_records(records)
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
                "peers": None, "peer_connectivity": "unknown"}

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

    def _render_config(self, config: dict[str, Any], credential_path: Path) -> str:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

        private_key = X25519PrivateKey.from_private_bytes(
            base64.b64decode(config["credential_private_key"], validate=True))
        public_key = base64.b64encode(private_key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode("ascii")
        lines = [
            f'instance_name = "tether-{config["instance_id"]}"',
            f'instance_id = "{config["instance_id"]}"',
            f'ipv4 = "{config["ipv4"]}"',
            "listeners = []",
            f'socks5_proxy = "socks5://127.0.0.1:{config["socks_port"]}"',
            f'credential_file = {self._toml_string(str(credential_path))}',
            "",
            "[network_identity]",
            f'network_name = "{config["network_name"]}"',
            'network_secret = ""',
            "",
            "[flags]",
            "no_tun = true",
            "use_smoltcp = true",
            "disable_relay_data = true",
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

    def _check_config(self, config_path: Path) -> None:
        environment = {key: value for key, value in os.environ.items() if not key.startswith("ET_")}
        result = subprocess.run([str(self.core), "--check-config", "--config-file", str(config_path)],
                                cwd=str(config_path.parent), stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, env=environment,
                                check=False, shell=False)
        if result.returncode:
            raise MeshRuntimeError("EasyTier rejected the network configuration")

    def _start(self, instance_id: str, directory: Path, port: int) -> subprocess.Popen:
        rpc = f"127.0.0.1:{port}"
        argv = [str(self.core), "--config-dir", str(directory), "--no-tun", "--use-smoltcp",
                "--rpc-portal", rpc, "--rpc-portal-whitelist", RPC_DENY_CIDR]
        environment = {key: value for key, value in os.environ.items() if not key.startswith("ET_")}
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
                            str(self._instance_dir(instance_id)) in child.cmdline()):
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
            return (abs(process.create_time() - float(record["create_time"])) < 0.01
                    and Path(process.exe()).resolve() == self.core
                    and str(self._instance_dir(record["instance_id"])) in process.cmdline())
        except (psutil.Error, OSError, ValueError, KeyError, TypeError):
            return False

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
