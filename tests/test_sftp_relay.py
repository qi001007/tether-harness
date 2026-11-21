import asyncio
from datetime import datetime, timedelta, timezone
import json
import socket
import ssl
import time
from threading import Thread
from types import SimpleNamespace

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
import pytest

from tether.node import sftp_relay
from tether.node import sftp_relay_managed


def _credentials(tmp_path):
    now = datetime.now(timezone.utc)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test CA")])

    def issue(label, ca_certificate=False):
        key = ca_key if ca_certificate else ec.generate_private_key(ec.SECP256R1())
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, label)])
        builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(ca)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(minutes=5))
                   .add_extension(x509.BasicConstraints(ca=ca_certificate, path_length=None), True))
        crt = builder.sign(ca_key, hashes.SHA256())
        pem = tmp_path / f"{label}.pem"
        private = tmp_path / f"{label}.key"
        pem.write_bytes(crt.public_bytes(serialization.Encoding.PEM))
        private.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                              serialization.NoEncryption()))
        return pem, private, crt.fingerprint(hashes.SHA256())

    ca_file, _, _ = issue("test CA", ca_certificate=True)
    server_cert, server_key, _ = issue("relay")
    selected_cert, selected_key, digest = issue("selected")
    wrong_cert, wrong_key, _ = issue("wrong")
    context = sftp_relay._server_context(str(ca_file), str(server_cert), str(server_key))
    clients = []
    for credentials in (None, (wrong_cert, wrong_key), (selected_cert, selected_key)):
        client = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        client.check_hostname = False  # Fixture certificates are used on local ephemeral sockets.
        client.load_verify_locations(cafile=str(ca_file))
        if credentials:
            client.load_cert_chain(*map(str, credentials))
        clients.append(client)
    return context, clients, digest


def test_only_pinned_client_can_reach_loopback_and_lease_closes_it(tmp_path, monkeypatch):
    server_ssl, clients, pin = _credentials(tmp_path)

    async def run():
        accepts = []
        source_closed = asyncio.Event()

        async def source(reader, writer):
            accepts.append(True)
            try:
                payload = await reader.readexactly(4)
                writer.write(payload[::-1])
                await writer.drain()
                await reader.read()
            finally:
                writer.close()
                source_closed.set()

        options = SimpleNamespace(listen_ip="127.0.0.1", client_ip="127.0.0.1", client_sha256=pin)
        with socket.socket() as local:
            local.bind(("127.0.0.1", 0))
            options.listen_port = local.getsockname()[1]
        monkeypatch.setattr(sftp_relay, "_MESH_SERVICE_PORTS", {options.listen_port})
        directory = tmp_path / "sftp-relay"
        directory.mkdir()
        offer_path = directory / "lease-fixture.json"
        async with await asyncio.start_server(source, "127.0.0.1", 0) as origin:
            options.upstream_port = origin.sockets[0].getsockname()[1]
            options.expires_unix = int(time.time()) + 2
            offer = sftp_relay._offer_fields("32a14b80-f578-44c0-8f5d-fe8cfbd3696a", "origin", "target",
                                            "10.224.0.3", options.listen_port, options.expires_unix)
            assert sftp_relay.read_offer(tmp_path, "relay") is None
            relay = asyncio.create_task(sftp_relay._serve(options, server_ssl, offer_path, offer))

            async def connect(tls):
                for attempt in range(20):
                    try:
                        return await asyncio.open_connection("127.0.0.1", options.listen_port, ssl=tls)
                    except ConnectionRefusedError:
                        if attempt == 19:
                            raise
                        await asyncio.sleep(0.01)

            for client in clients[:2]:
                try:
                    reader, writer = await connect(client)
                except (ssl.SSLError, ConnectionResetError):
                    continue
                try:
                    assert await asyncio.wait_for(reader.read(), 0.5) == b""
                except (ssl.SSLError, ConnectionResetError):
                    pass
                finally:
                    writer.close()
            assert accepts == []
            assert sftp_relay.read_offer(tmp_path, "relay") == offer
            assert sftp_relay.read_offer(tmp_path, "target") is None
            reader, writer = await connect(clients[2])
            writer.write(b"abcd")
            await writer.drain()
            assert await asyncio.wait_for(reader.readexactly(4), 0.5) == b"dcba"
            assert accepts == [True]
            await asyncio.wait_for(relay, 3)
            assert sftp_relay.read_offer(tmp_path, "relay") is None
            await asyncio.wait_for(source_closed.wait(), 1)
            try:
                assert await asyncio.wait_for(reader.read(), 0.5) == b""
            except (ssl.SSLEOFError, ConnectionResetError):
                pass
            writer.close()
            with pytest.raises(OSError):
                await asyncio.open_connection("127.0.0.1", options.listen_port)

    asyncio.run(run())


def test_offer_ignores_stale_publishers(tmp_path):
    directory = tmp_path / "sftp-relay"
    directory.mkdir()
    now = int(time.time())
    offer = sftp_relay._offer_fields("32a14b80-f578-44c0-8f5d-fe8cfbd3696a", "origin", "target",
                                    "10.224.0.3", 52001, now + 120)
    (directory / "lease-stale.json").write_text(json.dumps({**offer, "live_until": now - 1}), encoding="utf-8")
    assert sftp_relay.read_offer(tmp_path, "relay") is None


def test_managed_relay_requires_local_consent_and_fixed_mesh_socks(tmp_path, monkeypatch):
    from tether.node.sftp_relay_client import _client_identity, relay_client_cert_pem

    network = "32a14b80f57844c08f5dfe8cfbd3696a"
    now = int(time.time())
    scope = dict(network_id=network, source_device_id="origin", executor_device_id="target")
    authority = dict(scope, kind="hub_sftp_relay", actor_id="owner", relay_device_id="relay",
                     source_host="10.224.0.3", executor_host="10.224.0.2", relay_host="10.224.0.1",
                     issued_at=now, expires_at=now + 2, lease_expires_at=now + 20)
    provider_state, client_state = tmp_path / "provider", tmp_path / "client"
    provider_state.mkdir()
    client_state.mkdir()
    cert = relay_client_cert_pem(client_state)
    pem_key, _ = _client_identity(client_state)
    with socket.socket() as local, socket.socket() as socks:
        local.bind(("127.0.0.1", 0))
        port = local.getsockname()[1]
        local.close()
        monkeypatch.setattr(sftp_relay, "SFTP_RELAY_PORT", port)
        monkeypatch.setattr(sftp_relay_managed, "SFTP_RELAY_PORT", port)
        socks.bind(("127.0.0.1", 0))
        socks.listen(1)
        socks.settimeout(4)
        socks_port = socks.getsockname()[1]
        transactions = []

        def existing_socks():
            with socks.accept()[0] as peer, peer.makefile("rb") as stream:
                transactions.append(stream.read(3))
                peer.sendall(b"\x05\x00")
                transactions.append(stream.read(10))
                peer.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
                peer.sendall(stream.read(4)[::-1])

        ready = dict(network_id=network, state="ready", service_ip="10.224.0.1",
                     socks_proxy=dict(host="127.0.0.1", port=socks_port))
        calls = []
        manager = sftp_relay_managed.ManagedSftpRelay(provider_state, "relay")

        def use_hub(op):
            proof = cert if op == "sftp_relay_offer_enable" else None
            authority.update(issued_at=int(time.time()), expires_at=int(time.time()) + 2)
            return manager.control(op, authority, proof, lambda _: ready, lambda *args: calls.append(args))

        with pytest.raises(ValueError, match="consent"):
            use_hub("sftp_relay_offer_enable")
        assert calls == []
        manager.consent(dict(scope, expires_at=authority["lease_expires_at"]))
        result = use_hub("sftp_relay_offer_enable")
        assert result["offer"]["port"] == port
        assert result["offer"]["expires_at"] == authority["lease_expires_at"]
        assert manager.offer() == result["offer"]
        source = Thread(target=existing_socks, daemon=True)
        source.start()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
        context.load_verify_locations(cadata=result["offer"]["server_cert_pem"])
        context.load_cert_chain(str(pem_key))
        with socket.create_connection(("127.0.0.1", port), timeout=2) as raw:
            with context.wrap_socket(raw, server_hostname="10.224.0.1") as tunnel:
                tunnel.sendall(b"abcd")
                assert tunnel.recv(4) == b"dcba"
        source.join(3)
        assert transactions == [b"\x05\x01\x00", b"\x05\x01\x00\x01\x0a\xe0\x00\x03\x4e\xfe"]
        use_hub("sftp_relay_offer_disable")
        manager._current.thread.join(3)
        assert manager.offer() is None
        assert calls == [(network, True), (network, False)]


def test_network_relay_consent_survives_restart_without_migrating_timed_leases(tmp_path):
    network = "32a14b80f57844c08f5dfe8cfbd3696a"
    another = "32a14b80f57844c08f5dfe8cfbd3696b"
    manager = sftp_relay_managed.ManagedSftpRelay(tmp_path, "relay")
    manager.consent(dict(network_id=another, source_device_id="origin", executor_device_id="target",
                         expires_at=int(time.time()) + 30))
    with pytest.raises(ValueError, match="persistent"):
        manager.consent(dict(network_id=network, persistent=True, enabled=True, expires_at=1))
    assert manager.consent(dict(network_id=network, persistent=True, enabled=True)) == {
        "network_id": network, "persistent": True,
    }
    restarted = sftp_relay_managed.ManagedSftpRelay(tmp_path, "relay")
    assert restarted.persistent_networks() == [network]
    assert restarted.persistent_status(another) == {"network_id": another, "persistent": False}
    assert restarted.offer() is None
    assert sftp_relay_managed.ManagedSftpRelay(tmp_path, "other").persistent_networks() == []
    assert restarted.consent(dict(network_id=network, persistent=True, enabled=False)) == {
        "network_id": network, "persistent": False,
    }
    assert sftp_relay_managed.ManagedSftpRelay(tmp_path, "relay").persistent_networks() == []


def test_persistent_relay_expires_and_reissues_without_preempting_other_peer_scope(tmp_path, monkeypatch):
    from tether.node.mesh_runtime import MeshRelayBusy
    from tether.node.sftp_relay_client import relay_client_cert_pem

    network = "32a14b80f57844c08f5dfe8cfbd3696a"
    provider_state, client_state = tmp_path / "provider", tmp_path / "client"
    provider_state.mkdir()
    client_state.mkdir()
    cert = relay_client_cert_pem(client_state)
    manager = sftp_relay_managed.ManagedSftpRelay(provider_state, "relay")
    with socket.socket() as temporary:
        temporary.bind(("127.0.0.1", 0))
        port = temporary.getsockname()[1]
    monkeypatch.setattr(sftp_relay, "SFTP_RELAY_PORT", port)
    monkeypatch.setattr(sftp_relay_managed, "SFTP_RELAY_PORT", port)
    status = dict(network_id=network, state="ready", service_ip="10.224.0.1",
                  socks_proxy=dict(host="127.0.0.1", port=53000))
    calls = []

    def enable(seconds, **fields):
        now = int(time.time())
        authority = dict(kind="hub_sftp_relay", actor_id="owner", network_id=network, persistent=True,
                         relay_device_id="relay", source_device_id="source", executor_device_id="target",
                         source_host="10.224.0.3", executor_host="10.224.0.2", relay_host="10.224.0.1",
                         issued_at=now, expires_at=now + 10, lease_expires_at=now + seconds)
        authority.update(fields)
        return manager.control("sftp_relay_offer_enable", authority, cert, lambda _: status,
                               lambda *args: calls.append(args))["offer"]

    with pytest.raises(ValueError, match="consent"):
        enable(3)
    manager.consent(dict(network_id=network, persistent=True, enabled=True))
    with pytest.raises(ValueError, match="consent"):
        enable(sftp_relay_managed.PERSISTENT_RELAY_LEASE_SECONDS + 1)
    first = enable(3)
    assert first["persistent"] is True
    assert enable(5) == first
    with pytest.raises(MeshRelayBusy):
        enable(5, source_device_id="another", source_host="10.224.0.4")
    assert manager.offer() == first
    manager._current.thread.join(4)
    assert manager.offer() is None
    second = enable(10)
    assert second["server_cert_pem"] != first["server_cert_pem"]
    assert second["expires_at"] > first["expires_at"]
    manager.consent(dict(network_id=network, persistent=True, enabled=False))
    assert manager.offer() is None
    manager._current.thread.join(3)
    assert calls == [(network, True), (network, False), (network, True), (network, False)]
    with pytest.raises(ValueError, match="consent"):
        enable(3)


def test_local_relay_policy_endpoint_requires_console_token(tmp_path):
    import json
    from types import SimpleNamespace
    from urllib.error import HTTPError
    from urllib.request import ProxyHandler, Request, build_opener

    from tether.node import console
    from tether.node.fs_service import FsService

    network = "32a14b80f57844c08f5dfe8cfbd3696a"
    fs = FsService.__new__(FsService)
    fs.mesh_runtime = object()
    fs.sftp_relay = sftp_relay_managed.ManagedSftpRelay(tmp_path, "relay")
    server = console.start(None, "relay", port=0, api=SimpleNamespace(fs=fs), token="isolated-test")
    url = f"http://127.0.0.1:{server.server_port}/api/devices/relay/sftp-relay/consent"
    payload = json.dumps(dict(network_id=network, persistent=True, enabled=True)).encode()
    opener = build_opener(ProxyHandler({}))
    headers = {"Authorization": "Bearer isolated-test"}

    def json_response(request):
        with opener.open(request, timeout=5) as response:
            return json.load(response)

    try:
        with pytest.raises(HTTPError) as denied:
            json_response(Request(url, data=payload))
        assert denied.value.code == 401
        assert json_response(Request(url + "?network_id=" + network, headers=headers)) == {
            "network_id": network, "persistent": False,
        }
        assert json_response(Request(url, data=payload, headers=headers)) == {
            "network_id": network, "persistent": True,
        }
        assert json_response(Request(url + "?network_id=" + network, headers=headers))["persistent"] is True
    finally:
        server.shutdown()
        server.server_close()



def test_persistent_relay_retains_overlapping_job_and_hands_off_to_reverse_immediately(tmp_path, monkeypatch):
    from tether.node.mesh_runtime import MeshRelayBusy
    from tether.node.sftp_relay_client import _client_identity, relay_client_cert_pem

    network = "32a14b80f57844c08f5dfe8cfbd3696a"
    states = {}
    for participant in ("relay", "forward", "reverse"):
        states[participant] = tmp_path / participant
        states[participant].mkdir()
    manager = sftp_relay_managed.ManagedSftpRelay(states["relay"], "relay")
    manager.consent(dict(network_id=network, persistent=True, enabled=True))

    with socket.socket() as available, socket.socket() as socks:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
        available.close()
        monkeypatch.setattr(sftp_relay, "SFTP_RELAY_PORT", port)
        monkeypatch.setattr(sftp_relay_managed, "SFTP_RELAY_PORT", port)
        socks.bind(("127.0.0.1", 0))
        socks.listen(2)
        socks.settimeout(4)
        addresses = []
        mappings = []

        def upstream():
            for _ in range(2):
                with socks.accept()[0] as peer, peer.makefile("rb") as stream:
                    assert stream.read(3) == b"\x05\x01\x00"
                    peer.sendall(b"\x05\x00")
                    request = stream.read(10)
                    addresses.append(str(socket.inet_ntoa(request[4:8])))
                    assert int.from_bytes(request[8:], "big") == 20222
                    peer.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
                    while block := stream.read(4):
                        peer.sendall(block[::-1])

        source_worker = Thread(target=upstream, daemon=True)
        source_worker.start()
        status = dict(network_id=network, state="ready", service_ip="10.224.0.1",
                      socks_proxy=dict(host="127.0.0.1", port=socks.getsockname()[1]))

        def rpc(action, operation, direction="forward", attempt=1):
            now = int(time.time())
            source, executor = ("origin", "target") if direction == "forward" else ("target", "origin")
            ip = {"origin": "10.224.0.3", "target": "10.224.0.2"}
            auth = dict(kind="hub_sftp_relay", actor_id="owner", network_id=network, persistent=True,
                        relay_device_id="relay", source_device_id=source, executor_device_id=executor,
                        source_host=ip[source], executor_host=ip[executor], relay_host="10.224.0.1",
                        issued_at=now, expires_at=now + 10, lease_expires_at=now + 30,
                        operation_id=operation, attempt=attempt)
            cert = relay_client_cert_pem(states[direction]) if action == "enable" else None
            return manager.control("sftp_relay_offer_" + action, auth, cert, lambda _: status,
                                   lambda *args: mappings.append(args))

        def tls(offer, direction, raw):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.minimum_version = ssl.TLSVersion.TLSv1_3
            context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
            context.load_verify_locations(cadata=offer["server_cert_pem"])
            context.load_cert_chain(str(_client_identity(states[direction])[0]))
            return context.wrap_socket(raw, server_hostname="10.224.0.1")

        try:
            old = rpc("enable", "copy-a")["offer"]
            assert rpc("enable", "copy-b", attempt=2)["offer"] == old
            with socket.create_connection(("127.0.0.1", port), timeout=3) as raw, tls(old, "forward", raw) as tunnel:
                tunnel.sendall(b"ABCD")
                assert tunnel.recv(4) == b"DCBA"
                assert rpc("release", "copy-a") == {"released": True}
                assert rpc("release", "copy-b", attempt=1) == {"released": True}
                with pytest.raises(MeshRelayBusy):
                    rpc("enable", "copy-c", "reverse")
                tunnel.sendall(b"EFGH")
                assert tunnel.recv(4) == b"HGFE"
            expiry = old["expires_at"]
            assert rpc("release", "copy-b", attempt=2) == {"released": True}
            reverse = rpc("enable", "copy-c", "reverse")["offer"]
            assert time.time() < expiry
            assert reverse["source_device_id"] == "target" and reverse["executor_device_id"] == "origin"
            assert reverse["server_cert_pem"] != old["server_cert_pem"]
            with socket.create_connection(("127.0.0.1", port), timeout=3) as raw, tls(reverse, "reverse", raw) as tunnel:
                tunnel.sendall(b"IJKL")
                assert tunnel.recv(4) == b"LKJI"
            assert addresses == ["10.224.0.3", "10.224.0.2"]
        finally:
            manager.consent(dict(network_id=network, persistent=True, enabled=False))
            if manager._current:
                manager._current.thread.join(3)
            source_worker.join(3)
        assert mappings == [(network, True), (network, True), (network, False)]
