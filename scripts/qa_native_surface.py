"""Direct, no-model QA harness for the native DSH page and its loopback gateway."""

from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from tether.controller.native_surface import NativeSurfaceGateways
from tether.node.native_surface import NativeSurface, NativeSurfaceError

DEVICE_ID = "DESKTOP-QA"
PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Tether native surface QA</title>
<style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{font:14px sans-serif}
#state{position:fixed;z-index:1;top:8px;left:8px;padding:6px 10px;background:#fff;border-radius:5px}</style>
</head><body><div id="state">Connecting to native DSH…</div><iframe title="Native DSH"></iframe>
<script>
(async()=>{
  const state=document.getElementById('state'), frame=document.querySelector('iframe');
  try {
    const reply=await fetch('/view',{cache:'no-store'});
    if(!reply.ok) throw new Error('gateway unavailable');
    const data=await reply.json();
    if(!data.available || typeof data.url!=='string') throw new Error('native surface unavailable');
    frame.src=data.url;
    state.remove();
  } catch (_) { state.textContent='Native DSH surface unavailable. Check the local QA harness.'; }
})();
</script></body></html>"""


def create_app(surface: NativeSurface) -> FastAPI:
    async def request(device_id: str, message: dict[str, Any], *, timeout: float) -> dict[str, Any]:
        if device_id != DEVICE_ID:
            return {"ok": False, "error": "unknown QA device", "code": "not_found"}
        try:
            result = await asyncio.wait_for(
                surface.call(str(message.get("op") or ""), message.get("args") or {}), timeout=timeout
            )
            return {"ok": True, "result": result}
        except NativeSurfaceError as exc:
            return {"ok": False, "error": str(exc), "code": exc.code}
        except asyncio.TimeoutError:
            return {"ok": False, "error": "native surface request timed out", "code": "timeout"}
        except Exception:
            return {"ok": False, "error": "native surface request failed", "code": "surface_error"}

    gateways = NativeSurfaceGateways(request)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            await gateways.close()
            await surface.dispose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/", response_class=HTMLResponse)
    async def home() -> HTMLResponse:
        return HTMLResponse(PAGE, headers={"Cache-Control": "no-store"})

    @app.get("/view")
    async def view() -> dict[str, Any]:
        try:
            return await gateways.connect(DEVICE_ID)
        except Exception:
            raise HTTPException(status_code=503, detail="native DSH surface unavailable") from None

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Open the native DSH page through a temporary loopback QA gateway.")
    parser.add_argument("--port", type=int, default=18897)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    surface = NativeSurface(Path.home() / ".dsh")
    app = create_app(surface)
    config = uvicorn.Config(app, host="127.0.0.1", port=args.port, log_config=None, access_log=False,
                            server_header=False, date_header=False)
    server = uvicorn.Server(config)
    if args.port == 0:
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        sock.listen(128)
        sock.setblocking(False)
        port = int(sock.getsockname()[1])
        print(f"http://127.0.0.1:{port}/", flush=True)
        try:
            asyncio.run(server.serve(sockets=[sock]))
        finally:
            sock.close()
    else:
        print(f"http://127.0.0.1:{args.port}/", flush=True)
        server.run()


if __name__ == "__main__":
    main()
