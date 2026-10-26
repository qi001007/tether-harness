from __future__ import annotations

import json
from pathlib import Path

import zstandard as zstd

from tether.node.dsh_sessions import DshSessionStore, build_transcript


def _write_session(root: Path, session_id: str, rows: list[dict]) -> Path:
    folder = root / "sessions" / "--C-work--" / session_id
    folder.mkdir(parents=True)
    path = folder / "session.v4.jsonl.zstd"
    raw = ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode()
    path.write_bytes(zstd.ZstdCompressor().compress(raw))
    return path


def _fixture(session_id: str = "session-native-1") -> list[dict]:
    return [
        {"type": "session", "version": 4, "id": session_id, "createdAt": 1,
         "cwd": "C:\\work", "agentPreset": "standard"},
        {"type": "turn/start", "seq": 1, "time": 1000, "data": {"turn": 1}},
        {"type": "user/message", "seq": 2, "time": 1001,
         "data": {"content": [{"type": "text", "text": "检查远程设备"}],
                  "source": {"kind": "user"}}},
        {"type": "user/message", "seq": 3, "time": 1002,
         "data": {"content": [{"type": "text", "text": "runtime context"}],
                  "source": {"kind": "time-context"}}},
        {"type": "assistant/message", "seq": 4, "time": 1100,
         "data": {"turn": 1, "step": 1, "message": {"role": "assistant", "content": [
             {"type": "reasoning", "text": "先列设备"},
             {"type": "tool-call", "id": "call-1", "name": "list_peers", "arguments": "{}"},
         ]}}},
        {"type": "tool/result", "seq": 5, "time": 1200,
         "data": {"turn": 1, "step": 1, "message": {"role": "tool", "toolCallId": "call-1",
                  "content": [{"type": "text", "text": "[{\"device\":\"B\"}]"}], "isError": False}}},
        {"type": "assistant/message", "seq": 6, "time": 1300,
         "data": {"turn": 1, "step": 2, "message": {"role": "assistant", "content": [
             {"type": "text", "text": "B 在线。"},
         ]}, "usage": {"inputTokens": 10, "outputTokens": 5}}},
        {"type": "turn/end", "seq": 7, "time": 1400, "data": {"turn": 1, "reason": {"kind": "completed"}}},
    ]


def test_build_transcript_filters_context_and_links_tools() -> None:
    transcript = build_transcript(_fixture())
    assert transcript["session_id"] == "session-native-1"
    assert transcript["cwd"] == "C:\\work"
    assert transcript["status"] == "completed"
    assert transcript["turns"][0]["user"]["text"] == "检查远程设备"
    blocks = transcript["turns"][0]["blocks"]
    assert [block["type"] for block in blocks] == ["reasoning", "tool", "text"]
    assert blocks[1]["name"] == "list_peers"
    assert blocks[1]["result"] == "[{\"device\":\"B\"}]"
    assert blocks[1]["status"] == "done"
    assert blocks[2]["text"] == "B 在线。"
    assert transcript["turns"][0]["usage"]["outputTokens"] == 5


def test_store_lists_and_reads_native_sessions(tmp_path: Path) -> None:
    _write_session(tmp_path, "session-native-1", _fixture())
    store = DshSessionStore(tmp_path)
    items = store.list()
    assert len(items) == 1
    assert items[0]["session_id"] == "session-native-1"
    assert items[0]["title"] == "检查远程设备"
    assert items[0]["last_user"] == "检查远程设备"
    assert items[0]["status"] == "completed"

    transcript = store.transcript("session-native-1")
    assert transcript is not None
    assert transcript["turns"][0]["blocks"][1]["result"].startswith("[")
    assert store.transcript("missing") is None


def test_unfinished_turn_is_running(tmp_path: Path) -> None:
    rows = _fixture("session-running")
    rows = [row for row in rows if row["type"] != "turn/end"]
    rows.append({"type": "assistant/attempt", "seq": 8, "time": 1500,
                 "data": {"turn": 1, "step": 2, "stream": [
                     {"type": "reasoning-chunks", "time0": 1400, "index": 0, "dt": [],
                      "texts": ["继续检查"]},
                     {"type": "text-chunks", "time0": 1410, "index": 0, "dt": [],
                      "texts": ["正在"]},
                 ]}})
    _write_session(tmp_path, "session-running", rows)
    transcript = DshSessionStore(tmp_path).transcript("session-running")
    assert transcript is not None
    assert transcript["status"] == "running"
    live = [block for block in transcript["turns"][-1]["blocks"] if block.get("live")]
    assert any(block["text"] == "继续检查" for block in live)
    assert any(block["text"] == "正在" for block in live)
