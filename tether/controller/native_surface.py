"""Authenticated loopback gateways for a node's native DSH web UI."""

from __future__ import annotations

import asyncio
import base64
import os
import binascii
import secrets
import socket
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response, RedirectResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

MAX_BODY = 8 * 1024 * 1024
MAX_GATEWAYS = 64
HTTP_TIMEOUT = 30.0
WS_TIMEOUT = 55.0
SURFACE_SUFFIX = os.environ.get("TETHER_SURFACE_SUFFIX", "")

HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailer", "transfer-encoding", "upgrade", "set-cookie",
               "authorization", "cookie", "location", "access-control-allow-origin"}


@dataclass
class _Gateway:
    device_id: str
    key: str
    cookie_name: str
    port: int
    app: Starlette | None = None
    server: uvicorn.Server | None = None
    task: asyncio.Task | None = None
    tickets: dict[str, float] = field(default_factory=dict)
    channels: set[str] = field(default_factory=set)

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def host(self) -> str:
        return f"127.0.0.1:{self.port}"

    @property
    def public_origin(self) -> str:
        return f"https://g{self.port}.{SURFACE_SUFFIX}" if SURFACE_SUFFIX else self.origin


class NativeSurfaceGateways:
    """Per-device loopback HTTP/WS relays. The callback is bound to each gateway."""

    def __init__(self, request: Callable[..., Awaitable[dict[str, Any]]]) -> None:
        self._request = request
        self._gateways: dict[str, _Gateway] = {}
        self._lock = asyncio.Lock()

    async def connect(self, device_id: str) -> dict[str, Any]:
        async with self._lock:
            old = self._gateways.get(device_id)
            if old is not None and old.task is not None and old.task.done():
                await self._stop(old)
                old = None
            if old is not None:
                ticket = self._new_ticket(old)
                return {"url": f"{old.public_origin}/tether-connect?ticket={ticket}", "available": True}
            if len(self._gateways) >= MAX_GATEWAYS:
                raise RuntimeError("surface_gateway_capacity")
            status = await self._call(device_id, "status", {}, HTTP_TIMEOUT)
            if not status.get("ok"):
                raise RuntimeError(status.get("error") or "surface_unavailable")
            result = status.get("result") or {}
            if not result.get("available"):
                raise RuntimeError(result.get("reason") or "surface_unavailable")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", 0))
                sock.listen(128)
                sock.setblocking(False)
                port = int(sock.getsockname()[1])
                key = secrets.token_urlsafe(24)
                gateway = _Gateway(device_id, key, f"__Host-tether_{key}", port)
                gateway.app = Starlette(routes=[
                    Route("/tether-connect", self._bootstrap, methods=["GET"]),
                    Route("/{path:path}", self._http, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
                    WebSocketRoute("/{path:path}", self._websocket),
                ])
                config = uvicorn.Config(gateway.app, host="127.0.0.1", port=port,
                                        log_config=None, access_log=False, server_header=False,
                                        date_header=False)
                gateway.server = uvicorn.Server(config)
                gateway.task = asyncio.create_task(gateway.server.serve(sockets=[sock]))
                self._gateways[device_id] = gateway
                for _ in range(100):
                    if gateway.server.started:
                        break
                    if gateway.task.done():
                        await gateway.task
                    await asyncio.sleep(0.01)
                else:
                    await self._stop(gateway)
                    raise RuntimeError("surface_gateway_start_failed")
                ticket = self._new_ticket(gateway)
                return {"url": f"{gateway.public_origin}/tether-connect?ticket={ticket}", "available": True}
            except BaseException:
                sock.close()
                raise

    def _new_ticket(self, gateway: _Gateway) -> str:
        now = time.monotonic()
        gateway.tickets = {key: expiry for key, expiry in gateway.tickets.items() if expiry > now}
        active_tickets = [(key, expiry) for key, expiry in gateway.tickets.items()
                          if not key.startswith("cookie:")]
        if len(active_tickets) >= 32:
            gateway.tickets.pop(min(active_tickets, key=lambda row: row[1])[0], None)
        ticket = secrets.token_urlsafe(32)
        gateway.tickets[ticket] = now + 60
        return ticket

    async def _call(self, device_id: str, op: str, args: dict[str, Any], timeout: float) -> dict[str, Any]:
        return await self._request(device_id, {"type": "surface_call", "op": op, "args": args}, timeout=timeout)

    def _gateway_for(self, request: Request) -> _Gateway | None:
        gateway = next((g for g in self._gateways.values() if request.url.port == g.port), None)
        if gateway is None or request.headers.get("host", "").lower() != gateway.host.lower():
            return None
        return gateway

    def _origin_allowed(self, gateway: _Gateway, request: Request, *, websocket: bool = False) -> bool:
        origin = request.headers.get("origin")
        if origin is not None and origin != gateway.origin:
            return False
        if websocket and origin != gateway.origin:
            return False
        return True

    async def _bootstrap(self, request: Request) -> Response:
        gateway = self._gateway_for(request)
        if gateway is None:
            return Response(status_code=421)
        ticket = request.query_params.get("ticket", "")
        origin = request.headers.get("origin")
        navigation = (request.headers.get("sec-fetch-mode") == "navigate" and
                      request.headers.get("sec-fetch-dest") in {"document", "iframe"})
        if (origin is not None and origin != "dsh-app://app") or (
                origin is None and not navigation):
            return Response(status_code=403)
        expires = gateway.tickets.pop(ticket, None)
        if not ticket or expires is None or expires <= time.monotonic():
            return Response(status_code=403)
        cookie = secrets.token_urlsafe(32)
        response = RedirectResponse("/?tether_native=1", status_code=303)
        response.set_cookie(gateway.cookie_name, cookie, httponly=True,
                            secure=True, samesite="none", path="/", max_age=8 * 60 * 60)
        response.headers["set-cookie"] += "; Partitioned"
        # Bound active cookie credentials and their lifetime to eight hours.
        now = time.monotonic()
        gateway.tickets = {key: expiry for key, expiry in gateway.tickets.items() if expiry > now}
        cookies = [(key, expiry) for key, expiry in gateway.tickets.items() if key.startswith("cookie:")]
        if len(cookies) >= 32:
            oldest = min(cookies, key=lambda row: row[1])[0]
            gateway.tickets.pop(oldest, None)
        gateway.tickets["cookie:" + cookie] = now + 8 * 60 * 60
        return response

    def _authorized(self, gateway: _Gateway, request: Request) -> bool:
        cookie = request.cookies.get(gateway.cookie_name)
        return bool(cookie and gateway.tickets.get("cookie:" + cookie, 0) > time.monotonic())

    async def _http(self, request: Request) -> Response:
        gateway = self._gateway_for(request)
        if gateway is None:
            return Response(status_code=421)
        origin = request.headers.get("origin")
        if (origin is not None and origin != gateway.origin) or (
                request.method not in {"GET", "HEAD"} and origin != gateway.origin):
            return Response(status_code=403)
        if not self._authorized(gateway, request):
            return Response(status_code=403)
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BODY:
                return Response(status_code=413)
            chunks.append(chunk)
        body = b"".join(chunks)
        headers = {k.lower(): v for k, v in request.headers.items() if k.lower() in {"content-type", "accept"}}
        path = "/" + request.path_params.get("path", "")
        if request.url.query:
            path += "?" + request.url.query
        args = {"method": request.method, "path": path,
                "headers": headers, "body_base64": base64.b64encode(body).decode("ascii")}
        try:
            reply = await self._call(gateway.device_id, "http", args, HTTP_TIMEOUT)
        except Exception:
            return Response("native surface request failed", status_code=502)
        if not reply.get("ok"):
            return Response("native surface request failed", status_code=502)
        result = reply.get("result") or {}
        encoded_body = result.get("body_base64") or ""
        if len(encoded_body) > ((MAX_BODY + 2) // 3) * 4:
            return Response(status_code=502)
        try:
            response_body = base64.b64decode(encoded_body, validate=True)
        except (binascii.Error, ValueError):
            return Response("invalid native surface response", status_code=502)
        if len(response_body) > MAX_BODY:
            return Response(status_code=502)
        try:
            status = int(result.get("status", 502))
        except (TypeError, ValueError):
            status = 502
        if not 100 <= status <= 599:
            status = 502
        response_headers = {k.lower(): v for k, v in (result.get("headers") or {}).items()
                            if k.lower() in {"content-type", "content-encoding", "content-disposition",
                                             "cache-control", "etag", "last-modified", "vary"}
                            and k.lower() not in HOP_HEADERS}
        location = (result.get("headers") or {}).get("location")
        if location:
            parsed = urlsplit(location)
            if parsed.scheme or parsed.netloc or not location.startswith("/"):
                return Response("blocked native surface redirect", status_code=502)
            response_headers["location"] = location
        return Response(response_body, status_code=status, headers=response_headers)

    async def _websocket(self, websocket: WebSocket) -> None:
        gateway = next((g for g in self._gateways.values() if websocket.url.port == g.port), None)
        if (gateway is None or websocket.headers.get("host", "").lower() != gateway.host.lower() or
                not self._origin_allowed(gateway, websocket, websocket=True) or
                not websocket.cookies.get(gateway.cookie_name) or
                "cookie:" + websocket.cookies[gateway.cookie_name] not in gateway.tickets):
            await websocket.close(code=4403)
            return
        path = "/" + websocket.path_params.get("path", "")
        if path != "/api/remote.mux":
            await websocket.close(code=4404)
            return
        await websocket.accept()
        try:
            opened = await self._call(
                gateway.device_id, "ws_open",
                {"path": path + ("?" + websocket.url.query if websocket.url.query else "")}, HTTP_TIMEOUT)
        except Exception:
            await websocket.close(code=1011)
            return
        if not opened.get("ok"):
            await websocket.close(code=1011)
            return
        channel = (opened.get("result") or {}).get("channel")
        if not isinstance(channel, str) or not channel:
            await websocket.close(code=1011)
            return
        gateway.channels.add(channel)
        queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue(maxsize=32)

        async def upload() -> None:
            while True:
                kind, data = await queue.get()
                result = await self._call(gateway.device_id, "ws_send", {"channel": channel, "kind": kind, "data": data}, WS_TIMEOUT)
                if not result.get("ok"):
                    raise RuntimeError("upstream websocket send failed")

        async def download() -> None:
            while True:
                result = await self._call(gateway.device_id, "ws_receive", {"channel": channel}, WS_TIMEOUT)
                if not result.get("ok"):
                    raise RuntimeError("upstream websocket receive failed")
                frame = result.get("result") or {}
                kind = frame.get("kind")
                if kind == "idle":
                    continue
                if kind == "closed":
                    await websocket.close()
                    return
                if kind == "text":
                    payload = str(frame.get("data") or "")
                    if len(payload.encode("utf-8")) > MAX_BODY:
                        raise RuntimeError("upstream websocket frame too large")
                    await websocket.send_text(payload)
                elif kind == "binary":
                    encoded = frame.get("data") or ""
                    if len(encoded) > ((MAX_BODY + 2) // 3) * 4:
                        raise RuntimeError("upstream websocket frame too large")
                    payload = base64.b64decode(encoded, validate=True)
                    if len(payload) > MAX_BODY:
                        raise RuntimeError("upstream websocket frame too large")
                    await websocket.send_bytes(payload)

        async def receive() -> None:
            while True:
                event = await websocket.receive()
                if event["type"] == "websocket.disconnect":
                    return
                if event.get("text") is not None:
                    payload = event["text"]
                    if len(payload.encode("utf-8")) > MAX_BODY:
                        raise RuntimeError("websocket frame too large")
                    await queue.put(("text", payload))
                elif event.get("bytes") is not None:
                    data = event["bytes"]
                    if len(data) > MAX_BODY:
                        raise RuntimeError("websocket frame too large")
                    await queue.put(("binary", base64.b64encode(data).decode("ascii")))

        tasks = [asyncio.create_task(fn()) for fn in (upload, download, receive)]
        try:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except Exception:
            try:
                await websocket.close(code=1011)
            except Exception:
                pass
        finally:
            for task in tasks:
                task.cancel()
            try:
                await asyncio.shield(asyncio.gather(*tasks, return_exceptions=True))
            except asyncio.CancelledError:
                pass
            gateway.channels.discard(channel)
            try:
                await asyncio.shield(self._call(gateway.device_id, "ws_close", {"channel": channel}, HTTP_TIMEOUT))
            except Exception:
                pass

    async def _stop(self, gateway: _Gateway) -> None:
        for channel in list(gateway.channels):
            try:
                await self._call(gateway.device_id, "ws_close", {"channel": channel}, HTTP_TIMEOUT)
            except Exception:
                pass
        gateway.channels.clear()
        if gateway.server is not None:
            gateway.server.should_exit = True
        if gateway.task is not None:
            try:
                await asyncio.wait_for(gateway.task, timeout=3)
            except (asyncio.TimeoutError, Exception):
                gateway.task.cancel()
                await asyncio.gather(gateway.task, return_exceptions=True)

    async def close(self) -> None:
        async with self._lock:
            gateways, self._gateways = list(self._gateways.values()), {}
            await asyncio.gather(*(self._stop(gateway) for gateway in gateways), return_exceptions=True)
