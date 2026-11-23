"""The per-node authorize server that every Caddy worker calls per request.

A Codeg workspace load fans out dozens of parallel asset requests; each one is
a forward_auth hop into this loopback server. With the stdlib default backlog
(5) and a forced `Connection: close`, Windows refuses the overflow and Caddy
turns that into an empty 502, which leaves the browser bundle incomplete.
"""

from __future__ import annotations

import http.client
import threading

from tether.node.service_access import ServiceAccess, _ManagerServer


def _manager() -> ServiceAccess:
    access = object.__new__(ServiceAccess)
    access._lock = threading.Lock()
    access._httpd = None
    access._manager_port = 0
    access.workers = {}
    access._ensure_manager()
    return access


def _close(access: ServiceAccess) -> None:
    assert access._httpd is not None
    access._httpd.shutdown()
    access._httpd.server_close()


def test_manager_keeps_a_connection_alive_across_requests() -> None:
    access = _manager()
    port = int(access._httpd.server_address[1])  # type: ignore[union-attr]
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request("GET", "/internal/service/authorize")
        first = conn.getresponse()
        first.read()
        assert first.status == 401
        socket_after_first = conn.sock
        conn.request("GET", "/internal/service/authorize")
        second = conn.getresponse()
        second.read()
        assert second.status == 401
        assert conn.sock is socket_after_first, "the manager must reuse the Caddy connection"
        conn.close()
    finally:
        _close(access)


def test_manager_consumes_view_body_before_reusing_the_connection() -> None:
    access = _manager()
    port = int(access._httpd.server_address[1])  # type: ignore[union-attr]
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request("POST", "/__tether/view", body=b"{}",
                     headers={"Content-Type": "application/json"})
        view = conn.getresponse()
        view.read()
        assert view.status == 401
        socket_after_view = conn.sock
        conn.request("GET", "/internal/service/authorize")
        follow = conn.getresponse()
        follow.read()
        assert follow.status == 401, "an unread POST body would desync the next request"
        assert conn.sock is socket_after_view
        conn.close()
    finally:
        _close(access)


def test_manager_accepts_a_parallel_authorize_burst() -> None:
    access = _manager()
    port = int(access._httpd.server_address[1])  # type: ignore[union-attr]
    count = 48
    barrier = threading.Barrier(count)
    results: list[int] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def worker() -> None:
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
            barrier.wait(timeout=20)
            conn.request("GET", "/internal/service/authorize")
            response = conn.getresponse()
            response.read()
            with lock:
                results.append(response.status)
            conn.close()
        except BaseException as exc:  # noqa: BLE001 - reported by the assertion
            with lock:
                errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(count)]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert not errors, errors[:3]
        assert results == [401] * count
    finally:
        _close(access)


def test_manager_server_keeps_a_deep_accept_queue() -> None:
    assert _ManagerServer.request_queue_size >= 64
    assert _ManagerServer.daemon_threads is True