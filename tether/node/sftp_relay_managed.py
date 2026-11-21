"""Local consent and managed certificate pairing for SFTP relay leases."""

import asyncio
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import socket
import ssl
from tempfile import NamedTemporaryFile, TemporaryDirectory
from threading import Event, Lock, Thread
import time
from types import SimpleNamespace
from uuid import UUID

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from .mesh_runtime import SFTP_RELAY_PORT, MeshRelayBusy, MeshRuntimeError, secure_private_directory
from .sftp_relay import _MESH_SERVICE_NETWORK, _offer_fields, _serve
from .sftp_service_port import SHARED_PORT_VERSION, SFTP_SERVICE_PORT, bind_sftp_backend


PERSISTENT_RELAY_LEASE_SECONDS = 15 * 60
PERSISTENT_RELAY_POLICY = "owner-networks.json"


def _network_id(value):
    network = UUID(str(value))
    if not network.int:
        raise ValueError("invalid relay network")
    return network.hex


def _lease_scope(values, local_device):
    network = _network_id(values.get("network_id"))
    source, executor = values.get("source_device_id"), values.get("executor_device_id")
    if (not all(isinstance(device, str) and device and len(device) <= 128
                                  for device in (source, executor))
            or source == executor or local_device in (source, executor)):
        raise ValueError("invalid relay device scope")
    return network, source, executor


def _relay_reservation(authority):
    operation, attempt = authority.get("operation_id"), authority.get("attempt")
    if operation is None and attempt is None:
        return None
    if (not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", operation)
            or type(attempt) is not int or attempt < 1):
        raise ValueError("invalid relay reservation")
    return operation, attempt


def _tls_context(data_dir, relay_address, expiry, client_pem):
    if not isinstance(client_pem, str) or not client_pem.isascii() or len(client_pem) > 8192:
        raise ValueError("invalid relay client certificate")
    certificates = x509.load_pem_x509_certificates(client_pem.encode("ascii"))
    if len(certificates) != 1:
        raise ValueError("expected a single relay client certificate")
    client = certificates[0]
    try:
        client.verify_directly_issued_by(client)
        basics = client.extensions.get_extension_for_class(x509.BasicConstraints).value
        key_uses = client.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    except (InvalidSignature, ValueError, x509.ExtensionNotFound) as exc:
        raise ValueError("invalid relay client certificate") from exc
    if basics.ca or ExtendedKeyUsageOID.CLIENT_AUTH not in key_uses:
        raise ValueError("expected an end-entity relay client certificate")
    now = datetime.now(timezone.utc)
    ends = datetime.fromtimestamp(expiry, timezone.utc)
    if not client.not_valid_before_utc <= now < ends <= client.not_valid_after_utc:
        raise ValueError("relay client certificate does not cover the lease")
    key = ed25519.Ed25519PrivateKey.generate()
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Tether SFTP relay")])
    server = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(ends)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(relay_address)]), False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), True)
        .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(key.public_key()), False)
        .sign(key, None)
    )
    server_pem = server.public_bytes(serialization.Encoding.PEM)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.verify_mode = ssl.CERT_REQUIRED
    context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    context.load_verify_locations(cadata=client_pem)
    root = data_dir.resolve() / "sftp-relay"
    root.mkdir(mode=0o700, exist_ok=True)
    if root.resolve() != root:
        raise ValueError("invalid relay data directory")
    with TemporaryDirectory(dir=secure_private_directory(root)) as temporary:
        cert_path, key_path = Path(temporary) / "server.pem", Path(temporary) / "server.key"
        cert_path.write_bytes(server_pem)
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                               serialization.NoEncryption()))
        context.load_cert_chain(str(cert_path), str(key_path))
    return context, client.fingerprint(hashes.SHA256()), server_pem.decode("ascii")


async def _connect_mesh(socks_port, source):
    reader, writer = await asyncio.open_connection("127.0.0.1", socks_port)
    try:
        writer.write(b"\x05\x01\x00")
        await writer.drain()
        if await reader.readexactly(2) != b"\x05\x00":
            raise OSError("managed SOCKS authentication mismatch")
        writer.write(b"\x05\x01\x00\x01" + source.packed + (20222).to_bytes(2, "big"))
        await writer.drain()
        head = await reader.readexactly(4)
        if head[:3] != b"\x05\x00\x00":
            raise OSError("managed SOCKS could not reach SFTP")
        lengths = {1: 4, 4: 16}
        if head[3] == 3:
            address_length = (await reader.readexactly(1))[0]
        elif head[3] in lengths:
            address_length = lengths[head[3]]
        else:
            raise OSError("invalid managed SOCKS reply")
        await reader.readexactly(address_length + 2)
    except (OSError, asyncio.IncompleteReadError, asyncio.CancelledError):
        writer.close()
        raise
    return reader, writer


class ManagedSftpRelay:
    shared_port_version = SHARED_PORT_VERSION

    def __init__(self, data_dir, device):
        self.data_dir = data_dir
        self.device = device
        self._lock = Lock()
        self._consent = None
        self._current = None
        self._policy = self.data_dir.resolve() / "sftp-relay" / PERSISTENT_RELAY_POLICY
        self._networks = self._load_networks()

    def _load_networks(self):
        try:
            if self._policy.resolve(strict=True) != self._policy:
                return set()
            if os.name != "nt" and self._policy.stat().st_mode & 0o077:
                return set()
            body = json.loads(self._policy.read_text(encoding="utf-8"))
            if (not isinstance(body, dict) or body.get("device_id") != self.device
                    or not isinstance(body.get("networks"), list)):
                return set()
            return {_network_id(value) for value in body["networks"]}
        except (OSError, TypeError, ValueError):
            return set()

    def _save_networks(self, networks):
        directory = self._policy.parent
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.resolve() != directory:
            raise ValueError("invalid relay policy directory")
        directory = secure_private_directory(directory)
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as stream:
            staged = Path(stream.name)
        try:
            with staged.open("w", encoding="utf-8") as stream:
                json.dump({"device_id": self.device, "networks": sorted(networks)}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            staged.replace(self._policy)
        finally:
            staged.unlink(missing_ok=True)

    def persistent_networks(self):
        with self._lock:
            return sorted(self._networks)

    def persistent_status(self, value):
        network = _network_id(value)
        with self._lock:
            return {"network_id": network, "persistent": network in self._networks}

    def consent(self, args):
        if args.get("persistent") is True:
            if set(args) != {"network_id", "persistent", "enabled"} or type(args["enabled"]) is not bool:
                raise ValueError("invalid persistent relay consent")
            network, enabled = _network_id(args["network_id"]), args["enabled"]
            with self._lock:
                if enabled != (network in self._networks):
                    networks = self._networks | {network} if enabled else self._networks - {network}
                    self._save_networks(networks)
                    self._networks = networks
                current = self._current
                if not enabled and current and current.persistent and current.scope[0] == network:
                    current.stop.set()
            return {"network_id": network, "persistent": enabled}

        scope = _lease_scope(args, self.device)
        enabled = args.get("enabled", True)
        expiry = args.get("expires_at", 0)
        if type(enabled) is not bool or (enabled and (type(expiry) is not int or expiry <= time.time())):
            raise ValueError("invalid local relay consent")
        with self._lock:
            if enabled and self._consent == (scope, expiry):
                return {"consented": True}
            if self._current and (enabled or self._current.scope == scope):
                self._current.stop.set()
            if enabled:
                self._consent = (scope, expiry)
            elif self._consent and self._consent[0] == scope:
                self._consent = None
        return {"consented": enabled}

    def offer(self):
        with self._lock:
            current = self._current
            if (current and current.offer and not current.stop.is_set()
                    and current.expiry > time.time() and current.thread.is_alive()):
                return dict(current.offer)
        return None

    def control(self, op, authority, client_pem, network_status, set_mapping, *,
                shared_relay=None, single_network=None):
        if (not isinstance(authority, dict) or authority.get("kind") != "hub_sftp_relay"
                or authority.get("relay_device_id") != self.device or not authority.get("actor_id")):
            raise ValueError("missing Hub SFTP relay authority")
        scope = _lease_scope(authority, self.device)
        persistent = authority.get("persistent") is True
        reservation = _relay_reservation(authority) if persistent else None
        issued, deadline, expiry = (authority.get(key) for key in ("issued_at", "expires_at", "lease_expires_at"))
        if (type(issued) is not int or issued > time.time() + 5
                or type(deadline) is not int or deadline <= time.time() or issued >= deadline):
            raise ValueError("expired Hub SFTP relay authority")
        with self._lock:
            current = self._current
            if op == "sftp_relay_offer_release":
                if reservation is None:
                    raise ValueError("a persistent relay reservation is required")
                if current and current.persistent and current.scope == scope and current.actor == authority["actor_id"]:
                    current.borrowers.discard(reservation)
                    if current.shared and not current.borrowers and not current.untracked:
                        current.stop.set()
                return {"released": True}
            if op == "sftp_relay_offer_disable":
                if (current and current.scope == scope and current.actor == authority["actor_id"]
                        and current.persistent == persistent):
                    current.stop.set()
                return {"enabled": False}
            if persistent:
                consented = (scope[0] in self._networks and type(expiry) is int
                             and expiry <= issued + PERSISTENT_RELAY_LEASE_SECONDS)
            else:
                consented = (self._consent and self._consent[0] == scope
                             and type(expiry) is int and expiry <= self._consent[1])
            if not consented or expiry <= time.time():
                raise ValueError("current local device owner consent is required")
            shared_version = authority.get("relay_shared_port_version")
            shared = shared_version is not None
            if shared and (type(shared_version) is not int or shared_version != SHARED_PORT_VERSION):
                raise ValueError("unknown shared SFTP relay version")
            def network_allowed():
                return single_network is not None and single_network(scope[0])
            if shared and (shared_relay is None or not network_allowed()):
                raise OSError("the shared relay port requires a single managed network")
            if shared and current and current.shared and current.stop.is_set():
                current.thread.join(timeout=1)
            status = network_status(scope[0])
            relay = ipaddress.IPv4Address(authority.get("relay_host"))
            source = ipaddress.IPv4Address(authority.get("source_host"))
            executor = ipaddress.IPv4Address(authority.get("executor_host"))
            socks = status.get("socks_proxy") or {}
            socks_port = socks.get("port")
            if (status.get("network_id") != scope[0] or status.get("state") != "ready"
                    or status.get("service_ip") != str(relay) or len({relay, source, executor}) != 3
                    or any(address not in _MESH_SERVICE_NETWORK for address in (relay, source, executor))
                    or socks.get("host") != "127.0.0.1"
                    or type(socks_port) is not int or not 1 <= socks_port <= 65535):
                raise ValueError("relay and source must belong to the ready managed mesh")
            peer_scope = (scope, authority["actor_id"], relay, source, executor, client_pem, persistent, shared)
            if (current and current.peer_scope == peer_scope and current.thread.is_alive()
                    and current.offer and current.expiry > time.time() and not current.stop.is_set()
                    and (persistent or current.expiry == expiry)):
                if reservation is not None:
                    current.borrowers.add(reservation)
                elif persistent:
                    current.untracked = True
                return {"enabled": True, "offer": dict(current.offer)}
            handover = False
            if current and current.thread.is_alive():
                handover = (current.persistent and persistent and current.scope[0] == scope[0]
                            and current.actor == authority["actor_id"] and current.offer is not None and current.expiry > time.time()
                            and not current.stop.is_set() and not current.borrowers and not current.untracked
                            and reservation is not None and current.shared == shared)
                if not handover:
                    if current.persistent or persistent:
                        raise MeshRelayBusy("the relay already has an authorized lease")
                    current.stop.set()
                    raise ValueError("the previous relay lease is stopping")
            context, pin, server_pem = _tls_context(self.data_dir, relay, expiry, client_pem)
            ingress = shared_relay() if shared else None
            if handover:
                # Only the listener and peer identity change. The existing private-network port mapping is reused.
                current.keep_mapping = True
                current.stop.set()
                current.thread.join(timeout=5)
                if current.thread.is_alive():
                    current.keep_mapping = False
                    raise MeshRelayBusy("the previous relay listener is still closing")
            session = SimpleNamespace(scope=scope, actor=authority["actor_id"], peer_scope=peer_scope,
                                      persistent=persistent, expiry=expiry, stop=Event(), offer=None, shared=shared,
                                      borrowers={reservation} if reservation is not None else set(),
                                      untracked=persistent and reservation is None, keep_mapping=False)
            ready = Queue(maxsize=1)

            async def wait_for_stop():
                while not session.stop.is_set():
                    if shared and not network_allowed():
                        return
                    await asyncio.sleep(0.25)

            def started(port):
                if ingress is not None:
                    ingress.attach("tls", port, allowed=lambda: not session.stop.is_set() and network_allowed())
                session.offer = _offer_fields(*scope, str(source), SFTP_SERVICE_PORT if shared else port,
                                              expiry, shared=shared)
                session.offer["server_cert_pem"] = server_pem
                if persistent:
                    session.offer["persistent"] = True
                ready.put(True)

            async def run():
                options = SimpleNamespace(client_ip="127.0.0.1",
                                          client_sha256=pin, expires_unix=expiry)
                if not session.stop.is_set():
                    await _serve(options, context, connector=lambda: _connect_mesh(socks_port, source),
                                 lifetime=wait_for_stop, ready=started, listening_socket=listener)

            def worker():
                try:
                    asyncio.run(run())
                except (OSError, ValueError):
                    if session.offer is None:
                        ready.put(False)
                finally:
                    session.offer = None
                    if ingress is not None:
                        ingress.detach("tls", local_port)
                    listener.close()
                    while not shared and not session.keep_mapping:
                        try:
                            set_mapping(scope[0], False)
                            break
                        except MeshRelayBusy:
                            time.sleep(3)
                        except (MeshRuntimeError, OSError):
                            break

            listener = bind_sftp_backend() if shared else socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                if not shared:
                    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                    listener.bind(("127.0.0.1", SFTP_RELAY_PORT))
                    set_mapping(scope[0], True)
                local_port = listener.getsockname()[1]
            except Exception:
                listener.close()
                if handover and not shared:
                    try:
                        set_mapping(scope[0], False)
                    except (MeshRuntimeError, OSError):
                        pass
                raise
            session.thread = Thread(target=worker, name="tether-sftp-relay", daemon=True)
            self._current = session
            session.thread.start()
            try:
                listening = ready.get(timeout=5)
            except Empty:
                listening = False
            if not listening or not session.offer:
                session.stop.set()
                raise OSError("could not start the managed SFTP relay")
            return {"enabled": True, "offer": dict(session.offer)}
