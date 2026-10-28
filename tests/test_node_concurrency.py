from __future__ import annotations

import asyncio
import time

from tether.node.agent import Node


def test_file_and_dsh_calls_do_not_block_each_other() -> None:
    node = object.__new__(Node)
    node.fs_tasks = set()
    node.dsh_tasks = set()
    node.surface_tasks = set()
    node.update_tasks = set()
    order: list[str] = []

    async def slow_fs(_msg):
        order.append("fs-start")
        await asyncio.sleep(0.2)
        order.append("fs-end")

    async def slow_dsh(_msg):
        order.append("dsh-start")
        await asyncio.sleep(0.2)
        order.append("dsh-end")

    async def send(_msg):
        return None

    node._fs_call = slow_fs
    node._dsh_call = slow_dsh
    node._send = send

    async def scenario() -> float:
        started = time.monotonic()
        await node._handle({"type": "fs_call", "req_id": "fs-1"})
        await node._handle({"type": "dsh_call", "req_id": "dsh-1"})
        await asyncio.sleep(0)
        assert order == ["fs-start", "dsh-start"], "both handlers must start before either finishes"
        while node.fs_tasks or node.dsh_tasks:
            await asyncio.sleep(0.01)
        return time.monotonic() - started

    elapsed = asyncio.run(scenario())
    assert order == ["fs-start", "dsh-start", "fs-end", "dsh-end"] or order == ["fs-start", "dsh-start", "dsh-end", "fs-end"]
    assert elapsed < 0.35, elapsed
