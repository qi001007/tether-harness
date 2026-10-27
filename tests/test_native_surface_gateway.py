from __future__ import annotations

import asyncio
import base64
from urllib.parse import urlsplit

import httpx
import pytest

from tether.controller.native_surface import NativeSurfaceGateways


class FakeHub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.channels: dict[str, asyncio.Queue] = {}

    async def request(self, device: str, payload: dict, timeout: float = 30) -> dict:
        self.calls.append((device, payload))
        op, args = payload["op"], payload["args"]
        if op == "status":
            return {"ok": True, "result": {"available": True}}
        if op == "http":
            body = base64.b64decode(args["body_base64"])
            return {"ok": True, "result": {"status": 200,
                    "headers": {"content-type": args.get("headers", {}).get("content-type", "application/octet-stream"),
                                "set-cookie": "stolen=secret"},
                    "body_base64": base64.b64encode(device.encode() + b":" + body).decode()}}
        if op == "ws_open":
            channel = device + "-channel"
            self.channels[channel] = asyncio.Queue()
            await self.channels[channel].put({"kind": "binary", "data": base64.b64encode(b"\x00\xff").decode()})
            return {"ok": True, "result": {"channel": channel}}
        if op == "ws_receive":
            try:
                frame = await asyncio.wait_for(self.channels[args["channel"]].get(), .2)
            except asyncio.TimeoutError:
                frame = {"kind": "idle"}
            return {"ok": True, "result": frame}
        if op == "ws_send":
            await self.channels[args["channel"]].put({"kind": "idle"})
            return {"ok": True, "result": {"sent": True}}
        if op == "ws_close":
            return {"ok": True, "result": {"closed": True}}
        raise AssertionError(op)


def test_ticket_cookie_origin_limits_and_device_binding() -> None:
    async def run() -> None:
        hub = FakeHub()
        gateways = NativeSurfaceGateways(hub.request)
        try:
            a = await gateways.connect("A")
            b = await gateways.connect("B")
            ua, ub = urlsplit(a["url"]), urlsplit(b["url"])
            assert ua.port != ub.port
            async with httpx.AsyncClient(follow_redirects=False, trust_env=False) as client:
                denied = await client.get(f"{ua.scheme}://{ua.netloc}/")
                assert denied.status_code == 403
                wrong_host = await client.get(a["url"], headers={"host": "evil.example"})
                assert wrong_host.status_code == 421
                cross_bootstrap = await client.get(a["url"], headers={"origin": "https://evil.example"})
                assert cross_bootstrap.status_code == 403
                boot = await client.get(a["url"], headers={"origin": "dsh-app://app"})
                assert boot.status_code == 303
                assert boot.headers["location"] == "/?tether_native=1"
                assert "httponly" in boot.headers["set-cookie"].lower()
                assert "samesite=none" in boot.headers["set-cookie"].lower()
                assert "secure" in boot.headers["set-cookie"].lower()
                assert "partitioned" in boot.headers["set-cookie"].lower()
                cookie_pair = boot.headers["set-cookie"].split(";", 1)[0]
                replay = await client.get(a["url"], headers={"origin": "dsh-app://app"})
                assert replay.status_code == 403
                iframe = await gateways.connect("A")
                iframe_boot = await client.get(
                    iframe["url"], headers={"sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe"})
                assert iframe_boot.status_code == 303
                assert iframe_boot.headers["location"] == "/?tether_native=1"
                assert "set-cookie" not in (await client.get(f"{ua.scheme}://{ua.netloc}/")).headers
                body = b"\x00native\xff"
                response = await client.post(f"{ua.scheme}://{ua.netloc}/api/upload?x=1", content=body,
                                             headers={"content-type": "application/octet-stream",
                                                      "origin": f"{ua.scheme}://{ua.netloc}",
                                                      "cookie": cookie_pair})
                assert response.status_code == 200
                assert response.content == b"A:" + body
                assert "set-cookie" not in response.headers
                assert hub.calls[-1][1]["args"]["path"] == "/api/upload?x=1"
                cross = await client.post(f"{ua.scheme}://{ua.netloc}/api/change", content=b"x",
                                          headers={"origin": "https://evil.example", "cookie": cookie_pair})
                assert cross.status_code == 403
                assert (await client.get(f"{ub.scheme}://{ub.netloc}/", cookies={"bad": "cookie"})).status_code == 403
                no_origin = await client.post(f"{ua.scheme}://{ua.netloc}/api/change", content=b"x")
                assert no_origin.status_code == 403
                oversized = await client.post(f"{ua.scheme}://{ua.netloc}/upload", content=b"x" * (8 * 1024 * 1024 + 1),
                                              headers={"origin": f"{ua.scheme}://{ua.netloc}", "cookie": cookie_pair})
                assert oversized.status_code == 413
            assert all(device == "A" for device, _ in hub.calls if _["op"] != "status")
        finally:
            await gateways.close()

    asyncio.run(run())


def test_browser_websocket_binary_frames_are_relayed_and_closed() -> None:
    async def run() -> None:
        hub = FakeHub()
        gateways = NativeSurfaceGateways(hub.request)
        try:
            descriptor = await gateways.connect("A")
            url = urlsplit(descriptor["url"])
            origin = f"{url.scheme}://{url.netloc}"
            async with httpx.AsyncClient(follow_redirects=False, trust_env=False) as client:
                await client.get(descriptor["url"], headers={"origin": "dsh-app://app"})
                cookies = client.cookies
            import websockets
            ws_url = f"ws://{url.netloc}/api/remote.mux?token=ignored"
            async with websockets.connect(ws_url, origin=origin, additional_headers={"Cookie": "; ".join(
                    f"{key}={value}" for key, value in cookies.items())}) as websocket:
                assert await websocket.recv() == b"\x00\xff"
                await websocket.send(b"\x10\xfe")
                await websocket.send("native text")
            sent = [payload for _, payload in hub.calls if payload["op"] == "ws_send"]
            assert any(row["args"]["data"] == base64.b64encode(b"\x10\xfe").decode() for row in sent)
            assert any(row["args"]["data"] == "native text" for row in sent)
        finally:
            await gateways.close()
        assert any(payload["op"] == "ws_close" for _, payload in hub.calls)

    asyncio.run(run())
