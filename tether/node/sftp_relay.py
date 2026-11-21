"""Explicitly enabled TLS relay to one locally managed SFTP tunnel."""

import argparse
import asyncio
import hashlib
import ipaddress
import json
from pathlib import Path
import ssl
from tempfile import NamedTemporaryFile
import time
from uuid import UUID, uuid4

from .mesh_runtime import SFTP_RELAY_PORT
from .sftp_service_port import SFTP_SERVICE_PORT, SHARED_PORT_VERSION


_PRIVATE_NETWORKS = tuple(map(ipaddress.ip_network, (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8",
    "fc00::/7", "::1/128",
)))
_OFFER_DIR = "sftp-relay"
_OFFER_LIFETIME = 8
_MESH_SERVICE_PORTS = range(52000, 52064)
_MESH_SERVICE_NETWORK = ipaddress.ip_network("10.224.0.0/12")


def _offer_fields(network_id, source_device_id, executor_device_id, source_host, port, expires_at, *, shared=False):
    network = UUID(network_id)
    host = ipaddress.IPv4Address(source_host)
    if (not network.int or host not in _MESH_SERVICE_NETWORK or type(port) is not int
            or (port != (SFTP_SERVICE_PORT if shared else SFTP_RELAY_PORT)
                and (shared or port not in _MESH_SERVICE_PORTS)) or type(expires_at) is not int):
        raise ValueError("invalid mesh relay offer")
    devices = (source_device_id, executor_device_id)
    if (any(not isinstance(device, str) or not device or len(device) > 128 or device != device.strip()
            for device in devices) or source_device_id == executor_device_id):
        raise ValueError("invalid mesh relay source or executor")
    return dict(network_id=network.hex, source_device_id=source_device_id, executor_device_id=executor_device_id,
                source_host=str(host), port=port, expires_at=expires_at, adapter="mtls_sftp",
                **({"relay_shared_port_version": SHARED_PORT_VERSION} if shared else {}))


def _publish(path, offer):
    live = {**offer, "live_until": min(offer["expires_at"], int(time.time()) + _OFFER_LIFETIME)}
    temporary = NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False)
    staged = Path(temporary.name)
    try:
        with temporary:
            json.dump(live, temporary)
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)


def read_offer(data_dir, device):
    now = time.time()
    offers = []
    try:
        for path in (data_dir / _OFFER_DIR).glob("lease-*.json"):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if (type(record["live_until"]) is not int or not now < record["live_until"] <= now + _OFFER_LIFETIME
                        or record["adapter"] != "mtls_sftp"):
                    continue
                offer = _offer_fields(*(record[k] for k in (
                    "network_id", "source_device_id", "executor_device_id", "source_host", "port", "expires_at",
                )))
            except (OSError, TypeError, ValueError, KeyError, AttributeError):
                continue
            if offer["expires_at"] > now and device not in (offer["source_device_id"], offer["executor_device_id"]):
                offers.append(offer)
    except OSError:
        return None
    return offers[0] if len(offers) == 1 else None


def _private_ip(value):
    address = ipaddress.ip_address(value)
    if not any(address in network for network in _PRIVATE_NETWORKS):
        raise argparse.ArgumentTypeError("a single private IP is required")
    return str(address)


def _port(value):
    number = int(value)
    if not 1 <= number <= 65535:
        raise argparse.ArgumentTypeError("invalid port")
    return number


def _sha256(value):
    digest = bytes.fromhex(value)
    if len(digest) != 32:
        raise argparse.ArgumentTypeError("expected the SHA-256 digest of the client certificate DER")
    return digest


def _server_context(ca_file, cert_file, key_file):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(cafile=ca_file)
    context.load_cert_chain(certfile=cert_file, keyfile=key_file)
    return context


async def _copy(reader, writer):
    while chunk := await reader.read(64 * 1024):
        writer.write(chunk)
        await writer.drain()
    if writer.can_write_eof():
        writer.write_eof()


async def _serve(args, context, offer_path=None, offer=None, *, connector=None, lifetime=None, ready=None,
                 listening_socket=None):
    tasks = set()
    loop = asyncio.get_running_loop()
    seconds = args.expires_unix - time.time()
    if seconds <= 0:
        raise ValueError("the relay lease has expired")
    deadline = loop.time() + seconds

    async def handle(reader, writer):
        task = asyncio.current_task()
        tasks.add(task)
        upstream = None
        copies = []
        try:
            if loop.time() >= deadline:
                return
            address = writer.get_extra_info("peername")[0]
            if address != args.client_ip:
                return
            client_der = writer.get_extra_info("ssl_object").getpeercert(binary_form=True)
            if hashlib.sha256(client_der).digest() != args.client_sha256:
                return
            pending = connector() if connector else asyncio.open_connection("127.0.0.1", args.upstream_port)
            server_reader, upstream = await asyncio.wait_for(pending, timeout=5)
            upload = asyncio.create_task(_copy(reader, upstream))
            download = asyncio.create_task(_copy(server_reader, writer))
            copies = [upload, download]
            done, _ = await asyncio.wait(copies, return_when=asyncio.FIRST_COMPLETED)
            if download in done:
                await download
            else:
                await upload
                await download
        except (OSError, asyncio.TimeoutError):
            pass
        except asyncio.CancelledError:
            writer.transport.abort()
            raise
        finally:
            for copy in copies:
                copy.cancel()
            if upstream:
                upstream.close()
            if loop.time() >= deadline:
                writer.transport.abort()
            else:
                writer.close()
            await asyncio.gather(*copies, return_exceptions=True)
            tasks.discard(task)

    try:
        listen = ({"sock": listening_socket} if listening_socket is not None
                  else {"host": args.listen_ip, "port": args.listen_port})
        async with await asyncio.start_server(handle, ssl=context, ssl_handshake_timeout=5, **listen) as server:
            if ready is None:
                print(f"relay ready at {args.listen_ip}:{args.listen_port} until {args.expires_unix}", flush=True)
            else:
                ready(server.sockets[0].getsockname()[1])
            if offer_path is None:
                seconds = max(0, deadline - loop.time())
                if lifetime is None:
                    await asyncio.sleep(seconds)
                else:
                    try:
                        await asyncio.wait_for(lifetime(), seconds)
                    except asyncio.TimeoutError:
                        pass
            else:
                while loop.time() < deadline:
                    _publish(offer_path, offer)
                    await asyncio.sleep(min(3, max(0, deadline - loop.time())))
    finally:
        if offer_path is not None:
            offer_path.unlink(missing_ok=True)
        active = list(tasks)
        for task in active:
            task.cancel()
        await asyncio.gather(*active, return_exceptions=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-opt-in", action="store_true")
    parser.add_argument("--expires-unix", type=int, required=True)
    parser.add_argument("--listen-ip", type=_private_ip, required=True)
    parser.add_argument("--listen-port", type=_port, required=True)
    parser.add_argument("--upstream-port", type=_port, required=True)
    parser.add_argument("--client-ip", type=_private_ip, required=True)
    parser.add_argument("--client-sha256", type=_sha256, required=True)
    parser.add_argument("--ca-file", required=True)
    parser.add_argument("--cert-file", required=True)
    parser.add_argument("--key-file", required=True)
    parser.add_argument("--node-data-dir", type=Path)
    parser.add_argument("--network-id")
    parser.add_argument("--source-device-id")
    parser.add_argument("--executor-device-id")
    parser.add_argument("--source-host")
    args = parser.parse_args(argv)
    if not args.owner_opt_in:
        parser.error("the relay device owner must opt in")
    if args.expires_unix <= time.time():
        parser.error("the relay lease has expired")
    same_socket = args.listen_ip == "127.0.0.1" and args.listen_port == args.upstream_port
    if same_socket:
        parser.error("the relay and its upstream cannot use the same socket")
    fields = (args.network_id, args.source_device_id, args.executor_device_id, args.source_host)
    offer_path = None
    offer = None
    if args.node_data_dir is not None or any(fields):
        if (args.node_data_dir is None or not args.node_data_dir.is_dir() or not all(fields)
                or args.listen_ip != "127.0.0.1" or args.client_ip != "127.0.0.1"
                or args.listen_port not in _MESH_SERVICE_PORTS):
            parser.error("offer publication requires Node data, a source/executor pair and a loopback listener")
        try:
            offer = _offer_fields(*fields, args.listen_port, args.expires_unix)
        except (TypeError, ValueError) as exc:
            parser.error(str(exc))
        from .mesh_runtime import secure_private_directory

        directory = args.node_data_dir.resolve() / _OFFER_DIR
        directory.mkdir(mode=0o700, exist_ok=True)
        if directory.resolve() != directory:
            parser.error("the Node offer directory must be local to Node data")
        offer_path = secure_private_directory(directory) / f"lease-{uuid4().hex}.json"
    context = _server_context(args.ca_file, args.cert_file, args.key_file)
    try:
        asyncio.run(_serve(args, context, offer_path, offer))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
