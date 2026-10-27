"""Public per-gateway origin for native DSH surfaces.

Caddy terminates TLS for g<port>.<suffix> and forwards here. This process maps
the host to the loopback gateway port and rewrites Host/Origin so the gateway's
own checks still hold. Only loopback upstreams are reachable.
"""

from __future__ import annotations

import os
import re

import httpx
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

SUFFIX = os.environ.get("TETHER_SURFACE_SUFFIX", "8-220-198-26.sslip.io")
HOST_RE = re.compile(r"^g(\d{2,5})\." + re.escape(SUFFIX) + r"$", re.IGNORECASE)
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
       "trailer", "transfer-encoding", "upgrade", "host"}
app = FastAPI()
client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=8.0), follow_redirects=False)


def gateway_port(host: str | None) -> int | None:
    match = HOST_RE.match((host or "").split(":")[0])
    if not match:
        return None
    port = int(match.group(1))
    return port if 1024 <= port <= 65535 else None


def public_headers(request: Request, port: int, bootstrap: bool = False) -> dict[str, str]:
    headers = {key: value for key, value in request.headers.items() if key.lower() not in HOP}
    if bootstrap:
        headers.pop("origin", None)
    else:
        headers["origin"] = f"http://127.0.0.1:{port}"
    referer = headers.get("referer")
    if referer:
        headers["referer"] = re.sub(r"^https://g\d+\." + re.escape(SUFFIX), f"http://127.0.0.1:{port}", referer)
    return headers


@app.get("/healthz")
async def healthz() -> Response:
    return Response(content='{"ok":true}', media_type='application/json')


@app.get("/__allow")
async def allow(domain: str = "") -> Response:
    return Response(status_code=200 if HOST_RE.match(domain) else 403)


@app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(request: Request, path: str) -> Response:
    port = gateway_port(request.headers.get("host"))
    if port is None:
        return Response(status_code=421)
    url = f"http://127.0.0.1:{port}/{path}"
    if request.url.query:
        url += "?" + request.url.query
    body = await request.body()
    try:
        upstream = await client.send(client.build_request(
            request.method, url, headers=public_headers(request, port, path.lstrip('/').startswith('tether-connect')), content=body), stream=True)
    except httpx.HTTPError as error:
        return Response(status_code=502, content='{"error":"surface gateway unavailable"}', media_type='application/json')
    headers = {key: value for key, value in upstream.headers.items()
               if key.lower() not in {"connection", "keep-alive", "transfer-encoding", "content-length"}}
    location = headers.get("location")
    if location and location.startswith(f"http://127.0.0.1:{port}"):
        headers["location"] = location.replace(f"http://127.0.0.1:{port}",
                                              f"https://g{port}.{SUFFIX}", 1)
    return StreamingResponse(upstream.aiter_raw(), status_code=upstream.status_code,
                             headers=headers, background=BackgroundTask(upstream.aclose))


@app.websocket("/{path:path}")
async def websocket_proxy(websocket: WebSocket, path: str) -> None:
    port = gateway_port(websocket.headers.get("host"))
    if port is None:
        await websocket.close(code=1008)
        return
    requested = websocket.headers.get("sec-websocket-protocol")
    subprotocols = [item.strip() for item in requested.split(",")] if requested else None
    await websocket.accept(subprotocol=subprotocols[0] if subprotocols else None)
    uri = f"ws://127.0.0.1:{port}/{path}"
    if websocket.url.query:
        uri += "?" + websocket.url.query
    cookie = websocket.headers.get("cookie")
    try:
        async with websockets.connect(uri, origin=f"http://127.0.0.1:{port}",
                                      subprotocols=subprotocols, max_size=None,
                                      additional_headers={"Cookie": cookie} if cookie else None,
                                      ping_interval=None) as upstream:
            async def client_to_upstream() -> None:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])

            async def upstream_to_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            import asyncio
            tasks = [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=1011)
        except Exception:
            pass