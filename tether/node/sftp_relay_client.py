"""Receiver-owned identity and per-operation, client-authenticated SFTP bridge."""

from __future__ import annotations

import asyncio
from concurrent.futures import Future, TimeoutError as FutureTimeout
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import ipaddress
import os
from pathlib import Path
import socket
import ssl
import tempfile
import threading
import time

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from .mesh_runtime import secure_private_directory


# One bridge serves every range reader, route probe and route challenger of a
# transfer. The old ceiling of 10 was reachable with eight readers, so the
# challenger was silently dropped and slow routes could never be replaced.
MAX_RELAY_CONNECTIONS = 32
RELAY_LISTEN_BACKLOG = 32

_identity_lock = threading.Lock()
_identity_cache: dict[Path, tuple[Path, x509.Certificate]] = {}


def _client_identity(data_dir: Path) -> tuple[Path, x509.Certificate]:
    root = Path(data_dir).resolve()
    now = datetime.now(timezone.utc)
    with _identity_lock:
        cached = _identity_cache.get(root)
        if cached and cached[1].not_valid_after_utc > now + timedelta(days=7):
            return cached
        directory = root / "sftp-relay-client"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.resolve() != directory:
            raise ValueError("relay client identity directory must be local to Node state")
        secure_private_directory(directory)
        identity = directory / "identity.pem"
        if identity.exists():
            if identity.resolve(strict=True) != identity:
                raise ValueError("relay client identity cannot be a link")
            if os.name != "nt" and identity.stat().st_mode & 0o077:
                raise ValueError("relay client identity must be private")
            cert = x509.load_pem_x509_certificate(identity.read_bytes())
            if cert.not_valid_after_utc > now + timedelta(days=7):
                _identity_cache[root] = (identity, cert)
                return identity, cert
        key = ed25519.Ed25519PrivateKey.generate()
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Tether SFTP receiver")])
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
                .not_valid_after(now + timedelta(days=90))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=True)
                .sign(key, algorithm=None))
        fd, temporary = tempfile.mkstemp(dir=directory)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                               serialization.NoEncryption()))
                stream.write(cert.public_bytes(serialization.Encoding.PEM))
            os.replace(temporary, identity)
        finally:
            Path(temporary).unlink(missing_ok=True)
        _identity_cache[root] = (identity, cert)
        return identity, cert


def relay_client_cert_pem(data_dir: Path) -> str:
    """Only this public certificate is advertised over the authenticated Node channel."""
    return _client_identity(data_dir)[1].public_bytes(serialization.Encoding.PEM).decode("ascii")


async def _read_exact(sock: socket.socket, count: int) -> bytes:
    loop = asyncio.get_running_loop()
    data = bytearray()
    while len(data) < count:
        block = await loop.sock_recv(sock, count - len(data))
        if not block:
            raise OSError("SOCKS response closed")
        data.extend(block)
    return bytes(data)


async def _relay_connection(proxy, host, port, context, pinned_der):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setblocking(False)
    loop = asyncio.get_running_loop()
    try:
        await loop.sock_connect(sock, proxy)
        await loop.sock_sendall(sock, b"\x05\x01\x00")
        if await _read_exact(sock, 2) != b"\x05\x00":
            raise OSError("managed SOCKS gateway did not accept the normal session")
        await loop.sock_sendall(sock, b"\x05\x01\x00\x01" + socket.inet_aton(host) + port.to_bytes(2, "big"))
        head = await _read_exact(sock, 4)
        if head[:3] != b"\x05\x00\x00" or head[3] not in (1, 3, 4):
            raise OSError("managed SOCKS gateway rejected the relay address")
        addr_size = (await _read_exact(sock, 1))[0] if head[3] == 3 else {1: 4, 4: 16}[head[3]]
        await _read_exact(sock, addr_size + 2)
        reader, writer = await asyncio.open_connection(sock=sock, ssl=context, server_hostname=host,
                                                       ssl_handshake_timeout=5)
    except BaseException:
        sock.close()
        raise
    if writer.get_extra_info("ssl_object").getpeercert(binary_form=True) != pinned_der:
        writer.transport.abort()
        raise ssl.SSLError("relay peer did not present the authorized certificate")
    return reader, writer


async def _copy(reader, writer):
    while data := await reader.read(65536):
        writer.write(data)
        await writer.drain()


async def _serve(listener, expires_at, connect, stopped, ready):
    active = set()

    async def handle(reader, writer):
        if len(active) >= MAX_RELAY_CONNECTIONS or stopped.is_set() or expires_at <= time.time():
            writer.transport.abort()
            return
        task = asyncio.current_task()
        active.add(task)
        upstream = None
        copies = set()
        completed = False
        try:
            upstream_reader, upstream = await asyncio.wait_for(connect(), timeout=6)
            copies = {asyncio.create_task(_copy(reader, upstream)),
                      asyncio.create_task(_copy(upstream_reader, writer))}
            done, _ = await asyncio.wait(copies, return_when=asyncio.FIRST_COMPLETED)
            completed = all(copy.exception() is None for copy in done)
        except (OSError, asyncio.TimeoutError):
            pass
        finally:
            for copy in copies:
                copy.cancel()
            streams = (writer, upstream) if upstream is not None else (writer,)
            try:
                if completed:
                    for stream in streams:
                        stream.close()
                    await asyncio.wait_for(asyncio.gather(*(s.wait_closed() for s in streams),
                                                          return_exceptions=True), timeout=1)
            except (OSError, asyncio.TimeoutError):
                pass
            finally:
                for stream in streams:
                    stream.transport.abort()
                await asyncio.gather(*copies, return_exceptions=True)
                active.discard(task)

    server = await asyncio.start_server(handle, sock=listener, backlog=RELAY_LISTEN_BACKLOG)
    ready.set_result(None)
    async with server:
        while not stopped.is_set() and expires_at > time.time():
            await asyncio.sleep(0.1)
    tasks = list(active)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


@contextmanager
def local_sftp_relay(data_dir: Path, proxy: tuple[str, int], host: str, port: int, expires_at: int,
                     server_cert_pem: str):
    """Yield a temporary local SFTP port for an already validated Hub relay offer."""
    if expires_at <= time.time():
        raise ValueError("the authorized relay has expired")
    server_cert = x509.load_pem_x509_certificate(server_cert_pem.encode("ascii"))
    try:
        names = server_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound as exc:
        raise ValueError("the authorized relay certificate is missing a SAN") from exc
    if ipaddress.IPv4Address(host) not in names.get_values_for_type(x509.IPAddress):
        raise ValueError("the authorized server certificate has no SAN for this relay address")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.load_verify_locations(cadata=server_cert.public_bytes(serialization.Encoding.PEM).decode("ascii"))
    context.load_cert_chain(_client_identity(data_dir)[0])
    pinned_der = server_cert.public_bytes(serialization.Encoding.DER)

    async def connect():
        return await _relay_connection(proxy, host, port, context, pinned_der)

    stopped = threading.Event()
    ready = Future()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        local_port = listener.getsockname()[1]

        def run():
            try:
                asyncio.run(_serve(listener, expires_at, connect, stopped, ready))
            except (RuntimeError, OSError) as exc:
                if not ready.done():
                    ready.set_exception(exc)

        thread = threading.Thread(target=run, name="tether-sftp-relay", daemon=True)
        thread.start()
        try:
            try:
                ready.result(timeout=3)
            except FutureTimeout as exc:
                raise OSError("relay listener did not become ready") from exc
            yield local_port
        finally:
            stopped.set()
            thread.join(timeout=2)
