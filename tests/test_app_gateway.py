import http.client
import http.server
import socket
import threading

import pytest

from tether.node.app_gateway import AppRoute, Gateway, parse_app


class _FixtureHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b"tether-app-gateway"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        pass


def _fixture_server() -> tuple[http.server.ThreadingHTTPServer, int]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def test_gateway_forwards_http_to_loopback() -> None:
    fixture, fixture_port = _fixture_server()
    route = AppRoute("fixture", "127.0.0.1", 0, "127.0.0.1", fixture_port)
    gateway = Gateway([route], ["127.0.0.0/8"])
    try:
        port = gateway.servers[0].server_address[1]
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.request("GET", "/")
        response = connection.getresponse()
        assert response.status == 200
        assert response.read() == b"tether-app-gateway"
        connection.close()
    finally:
        gateway.stop()
        fixture.shutdown()
        fixture.server_close()


def test_gateway_rejects_targets_outside_loopback() -> None:
    route = AppRoute("public", "127.0.0.1", 0, "8.8.8.8", 80)
    with pytest.raises(ValueError):
        route.validate()
    with pytest.raises(ValueError):
        Gateway([route], ["127.0.0.0/8"])


def test_gateway_rejects_clients_outside_the_allowlist() -> None:
    fixture, fixture_port = _fixture_server()
    route = AppRoute("fixture", "127.0.0.1", 0, "127.0.0.1", fixture_port)
    gateway = Gateway([route], ["10.144.0.0/24"])
    try:
        port = gateway.servers[0].server_address[1]
        with socket.create_connection(("127.0.0.1", port), timeout=5) as client:
            client.settimeout(2)
            assert client.recv(1) == b""
    finally:
        gateway.stop()
        fixture.shutdown()
        fixture.server_close()


def test_parse_app_requires_four_parts() -> None:
    assert parse_app("dsh:18080:127.0.0.1:50061", "10.144.0.2") == AppRoute(
        "dsh", "10.144.0.2", 18080, "127.0.0.1", 50061)
    with pytest.raises(ValueError):
        parse_app("dsh:18080:127.0.0.1", "10.144.0.2")