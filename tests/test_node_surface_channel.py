from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from websockets.asyncio.server import serve

from tether.node.agent import Node


def test_surface_response_uses_its_original_socket_after_control_changes():
    class Socket:
        def __init__(self, fail=False):
            self.sent = []
            self.fail = fail

        async def send(self, message):
            if self.fail:
                raise OSError("closed test channel")
            self.sent.append(json.loads(message))

    async def scenario():
        node = Node.__new__(Node)
        old_data, new_control = Socket(fail=True), Socket()
        node.ws = new_control
        node.connected = True

        async def call(_op, _args):
            return {"available": True}

        node.native_surface = SimpleNamespace(call=call)
        await node._surface_call({"req_id": "old-request", "op": "status"}, response_ws=old_data)
        assert new_control.sent == []
        assert node.connected is True

    asyncio.run(scenario())


def test_surface_connection_reconnects_without_replacing_control():
    async def scenario():
        accepted = 0
        completed = asyncio.Event()
        received = []

        async def server(channel):
            nonlocal accepted
            assert channel.request.path == "/prefix/ws/node-surface"
            register = json.loads(await channel.recv())
            assert register == {"type": "register_surface", "device_id": "QA", "ticket": "test-ticket"}
            accepted += 1
            await channel.send(json.dumps({"type": "surface_registered"}))
            await channel.send(json.dumps({"type": "surface_call", "op": "status",
                                           "req_id": str(accepted)}))
            received.append(json.loads(await channel.recv()))
            if accepted >= 2:
                completed.set()
                await channel.wait_closed()

        async with serve(server, "127.0.0.1", 0) as listener:
            node = Node.__new__(Node)
            node.url = f"ws://127.0.0.1:{listener.sockets[0].getsockname()[1]}/prefix/ws/node"
            control = object()
            node.ws = control
            node.device = "QA"
            node.connected = True
            node.surface_tasks = set()

            async def call(_op, _args):
                return {"available": True}

            node.native_surface = SimpleNamespace(call=call)
            task = asyncio.create_task(node._surface_channel(control, "test-ticket", {"proxy": None}))
            try:
                await asyncio.wait_for(completed.wait(), 4)
                assert accepted == 2
                assert [reply["req_id"] for reply in received] == ["1", "2"]
                assert all(reply["type"] == "surface_result" and reply["ok"] for reply in received)
                assert node.ws is control and node.connected
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            assert not node.surface_tasks

    asyncio.run(scenario())
