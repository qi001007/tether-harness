"""Expose selected loopback services on the EasyTier virtual LAN.

A route is a transparent TCP proxy: the peer connects to the virtual IP and the
gateway forwards bytes to a loopback service. HTTP, WebSocket and other TCP
protocols work without per-application adapters.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import socket
import socketserver
import threading
from dataclasses import dataclass
from typing import Iterable


BUFFER = 256 * 1024


@dataclass(frozen=True)
class AppRoute:
    name: str
    listen_host: str
    listen_port: int
    target_host: str
    target_port: int

    def validate(self) -> None:
        if not self.name or len(self.name) > 80:
            raise ValueError("app name must be 1-80 characters")
        if not isinstance(self.listen_port, int) or not 0 <= self.listen_port <= 65535:
            raise ValueError("listen port must be 0-65535")
        if not isinstance(self.target_port, int) or not 1 <= self.target_port <= 65535:
            raise ValueError("target port must be 1-65535")
        try:
            target = ipaddress.ip_address(self.target_host)
        except ValueError:
            raise ValueError("target host must be a literal loopback address") from None
        if not target.is_loopback:
            raise ValueError("target host must be loopback")
        try:
            ipaddress.ip_address(self.listen_host)
        except ValueError:
            raise ValueError("listen host must be a literal address") from None


def _pipe(source: socket.socket, destination: socket.socket) -> None:
    try:
        while True:
            data = source.recv(BUFFER)
            if not data:
                break
            destination.sendall(data)
    except OSError:
        pass
    finally:
        try:
            destination.shutdown(socket.SHUT_WR)
        except OSError:
            pass


class _Handler(socketserver.BaseRequestHandler):
    route: AppRoute
    allowed: tuple[ipaddress._BaseNetwork, ...]

    def handle(self) -> None:
        try:
            address = ipaddress.ip_address(self.client_address[0])
        except ValueError:
            return
        if not any(address in network for network in self.allowed):
            return
        try:
            upstream = socket.create_connection(
                (self.route.target_host, self.route.target_port), timeout=10)
        except OSError:
            return
        upstream.settimeout(None)
        thread = threading.Thread(target=_pipe, args=(self.request, upstream), daemon=True)
        thread.start()
        _pipe(upstream, self.request)
        thread.join(timeout=5)
        try:
            upstream.close()
        except OSError:
            pass


class _Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Gateway:
    def __init__(self, routes: Iterable[AppRoute], allowed: Iterable[str]) -> None:
        self.servers: list[_Server] = []
        self.threads: list[threading.Thread] = []
        self.routes: list[dict[str, object]] = []
        networks = tuple(ipaddress.ip_network(value, strict=False) for value in allowed)
        try:
            for route in routes:
                route.validate()
                handler = type("_RouteHandler", (_Handler,), {"route": route, "allowed": networks})
                server = _Server((route.listen_host, route.listen_port), handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                self.servers.append(server)
                self.threads.append(thread)
                self.routes.append({
                    "name": route.name,
                    "listen": "{}:{}".format(route.listen_host, server.server_address[1]),
                    "target": "{}:{}".format(route.target_host, route.target_port),
                })
        except BaseException:
            self.stop()
            raise

    def stop(self) -> None:
        for server in self.servers:
            server.shutdown()
            server.server_close()
        for thread in self.threads:
            thread.join(timeout=5)
        self.servers.clear()
        self.threads.clear()


def parse_app(value: str, listen_host: str) -> AppRoute:
    parts = value.split(":")
    if len(parts) != 4:
        raise ValueError("--app must be name:listen_port:target_host:target_port")
    name, listen_port, target_host, target_port = parts
    return AppRoute(name, listen_host, int(listen_port), target_host, int(target_port))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Expose loopback services on a virtual LAN")
    parser.add_argument("--listen", required=True, help="virtual LAN address to bind")
    parser.add_argument("--app", action="append", default=[],
                        help="name:listen_port:target_host:target_port")
    parser.add_argument("--allow", action="append", default=["10.144.0.0/24"],
                        help="client CIDR allowed to connect")
    arguments = parser.parse_args(argv)
    if not arguments.app:
        parser.error("at least one --app is required")
    routes = [parse_app(value, arguments.listen) for value in arguments.app]
    gateway = Gateway(routes, arguments.allow)
    print(json.dumps({"ok": True, "routes": gateway.routes}, ensure_ascii=False), flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        gateway.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
