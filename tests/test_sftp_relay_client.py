from datetime import datetime, timedelta, timezone
import ipaddress
import socket
import ssl
import threading
import time

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
import pytest

from tether.node import sftp_relay_client


def _server_identity(path, address):
    now = datetime.now(timezone.utc)
    key = ed25519.Ed25519PrivateKey.generate()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "isolated SFTP relay")])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(minutes=2))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.IPv4Address(address))]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=True)
            .sign(key, algorithm=None))
    pem = cert.public_bytes(serialization.Encoding.PEM)
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption()) + pem)
    return pem.decode("ascii")


@pytest.mark.parametrize("wrong_pin", [False, True])
def test_managed_socks_to_pinned_mutual_tls_and_ephemeral_cleanup(tmp_path, wrong_pin):
    relay_host, relay_port = "10.223.30.9", 20223
    real = tmp_path / "server.pem"
    server_pem = _server_identity(real, relay_host)
    authority_pem = _server_identity(tmp_path / "unexpected.pem", relay_host) if wrong_pin else server_pem
    state = tmp_path / "receiver"
    state.mkdir()
    client_pem = sftp_relay_client.relay_client_cert_pem(state)
    assert client_pem == sftp_relay_client.relay_client_cert_pem(state) and "PRIVATE KEY" not in client_pem
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_cert_chain(real)
    context.load_verify_locations(cadata=client_pem)
    wanted_key = x509.load_pem_x509_certificate(client_pem.encode()).public_bytes(serialization.Encoding.DER)
    observed = []
    errors = []
    frame = b"authorized SFTP prefix"

    with socket.socket() as socks:
        socks.bind(("127.0.0.1", 0))
        socks.listen()
        socks.settimeout(4)

        def handle():
            try:
                raw, _ = socks.accept()
                with raw:
                    raw.settimeout(4)
                    with raw.makefile("rb") as request:
                        assert request.read(3) == b"\x05\x01\x00"
                        raw.sendall(b"\x05\x00")
                        assert request.read(10) == (b"\x05\x01\x00\x01" + socket.inet_aton(relay_host) +
                                                     relay_port.to_bytes(2, "big"))
                        raw.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
                    with context.wrap_socket(raw, server_side=True) as tls:
                        observed.append(tls.getpeercert(binary_form=True))
                        with tls.makefile("rb") as data:
                            assert data.read(len(frame)) == frame
                        tls.sendall(frame)
            except Exception as exc:
                errors.append(exc)

        thread = threading.Thread(target=handle)
        thread.start()
        with sftp_relay_client.local_sftp_relay(state, socks.getsockname(), relay_host, relay_port,
                                               int(time.time()) + 30, authority_pem) as local_port:
            assert 1 <= local_port <= 65535 and local_port != socks.getsockname()[1]
            with socket.create_connection(("127.0.0.1", local_port), timeout=4) as passing:
                passing.sendall(frame)
                if wrong_pin:
                    try:
                        assert not passing.recv(1)
                    except (ConnectionAbortedError, ConnectionResetError):
                        pass
                else:
                    with passing.makefile("rb") as received:
                        assert received.read(len(frame)) == frame
            thread.join(timeout=6)
            assert not thread.is_alive()
        with pytest.raises(OSError):
            socket.create_connection(("127.0.0.1", local_port), timeout=0.2)
    if wrong_pin:
        assert not observed and len(errors) == 1 and isinstance(errors[0], ssl.SSLError)
    else:
        assert not errors and observed == [wanted_key]


def test_wrong_relay_san_and_expired_offer_fail_before_socket(tmp_path):
    cert = _server_identity(tmp_path / "server.pem", "10.223.30.9")
    with pytest.raises(ValueError, match="expired"):
        with sftp_relay_client.local_sftp_relay(tmp_path, ("127.0.0.1", 9), "10.223.30.9", 52060, 0, cert):
            pytest.fail("expired adapter listened")
    with pytest.raises(ValueError, match="SAN"):
        with sftp_relay_client.local_sftp_relay(tmp_path, ("127.0.0.1", 9), "10.223.30.10", 52060,
                                               int(time.time()) + 30, cert):
            pytest.fail("mismatched adapter listened")


def test_managed_offer_uses_only_fixed_provider_port(tmp_path):
    from tether.node.transfer_jobs import _managed_sftp_relay

    when = int(time.time()) + 30
    scope = dict(network_id="managed", source_device_id="source", executor_device_id="receiver")
    endpoint = dict(host="10.223.30.45", port=20222)
    cert = _server_identity(tmp_path / "server.pem", "10.223.30.9")
    offer = dict(scope, source_host=endpoint["host"], host="10.223.30.9", port=20223, expires_at=when,
                 adapter="mtls_sftp", server_cert_pem=cert)
    assert _managed_sftp_relay(dict(scope, sftp_relay=offer), endpoint) == ("10.223.30.9", 20223, when, cert)
    for changes in ({"port": 52060}, {"port": 22}, {"adapter": "other"}, {"server_cert_pem": ""}):
        assert _managed_sftp_relay(dict(scope, sftp_relay={**offer, **changes}), endpoint) is None


def test_relay_bridge_admits_every_range_reader_and_a_challenger():
    # Eight range readers plus a route challenger and probe lanes share one bridge.
    assert sftp_relay_client.MAX_RELAY_CONNECTIONS >= 8 + 4
    assert sftp_relay_client.RELAY_LISTEN_BACKLOG >= 16
