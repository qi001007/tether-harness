"""Read DeepSeek Harness session logs from the target machine.

DSH stores one append-only JSONL log per session under
``$DSH_HOME/sessions/<encoded-cwd>/<session>/session.vN.jsonl[.zstd]``. Reading
that log gives us the exact native conversation: user messages, reasoning,
tool calls/results and turn boundaries. This module only reads; it never writes
to a DSH session or competes for the Session writer.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

try:
    import zstandard as zstd
except ImportError:  # pragma: no cover - the node reports a capability miss
    zstd = None  # type: ignore[assignment]


MAX_TEXT = 12000
MAX_RESULT = 8000


def _text_blocks(content: Any) -> str:
    if not isinstance(content, list):
        return ""
    out = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            out.append(str(block.get("text") or ""))
    return "".join(out)


def _arguments(raw: Any) -> tuple[str, str]:
    text = raw if isinstance(raw, str) else json.dumps(raw or {}, ensure_ascii=False)
    try:
        parsed = json.loads(text) if isinstance(raw, str) else (raw or {})
    except (TypeError, ValueError):
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    command = (parsed.get("command") or parsed.get("file_path") or parsed.get("path")
               or parsed.get("query") or "")
    return text[:MAX_TEXT], str(command)[:2000]


def _stream_text(stream: Any) -> tuple[str, str]:
    """Return (reasoning, text) from an assistant attempt stream."""
    reasoning: list[str] = []
    text: list[str] = []
    if not isinstance(stream, list):
        return "", ""
    for record in stream:
        if not isinstance(record, dict):
            continue
        typ = record.get("type")
        if typ == "reasoning-chunks":
            reasoning.extend(str(item) for item in record.get("texts") or [])
        elif typ == "text-chunks":
            text.extend(str(item) for item in record.get("texts") or [])
        elif typ == "chunk":
            chunk = record.get("chunk") or {}
            if chunk.get("type") == "reasoning-delta":
                reasoning.append(str(chunk.get("text") or ""))
            elif chunk.get("type") == "text-delta":
                text.append(str(chunk.get("text") or ""))
    return "".join(reasoning)[:MAX_TEXT], "".join(text)[:MAX_TEXT]


def build_transcript(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Turn native SessionWireEvent rows into a renderer-friendly transcript."""
    if not rows:
        return {"session_id": "", "title": "", "cwd": "", "turns": [], "status": "unknown"}
    header = next((row for row in rows if row.get("type") == "session"), {}) or {}
    session_id = str(header.get("id") or "")
    cwd = str(header.get("cwd") or "")
    title = ""
    turns: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    calls: dict[str, dict[str, Any]] = {}
    last_time = 0.0
    model = ""
    preset = str(header.get("agentPreset") or "")

    def ensure_turn(turn_no: Any = None) -> dict[str, Any]:
        nonlocal current
        if current is None or (turn_no is not None and current.get("turn") not in (None, turn_no)):
            current = {"turn": turn_no, "started_at": None, "ended_at": None,
                       "state": "running", "user": None, "blocks": [], "usage": None,
                       "steps": 0}
            turns.append(current)
        return current

    for row in rows[1:]:
        typ = str(row.get("type") or "")
        data = row.get("data") or {}
        ts = row.get("time")
        if isinstance(ts, (int, float)):
            last_time = max(last_time, float(ts) / 1000.0)
        if typ == "session/title":
            title = str(data.get("title") or title)
        elif typ == "turn/start":
            turn = ensure_turn(data.get("turn"))
            turn["started_at"] = (float(ts) / 1000.0) if isinstance(ts, (int, float)) else None
            turn["state"] = "running"
        elif typ == "turn/end":
            turn = ensure_turn()
            reason = data.get("reason") or {}
            turn["state"] = str(reason.get("kind") or "completed")
            turn["ended_at"] = (float(ts) / 1000.0) if isinstance(ts, (int, float)) else None
            current = None
        elif typ == "user/message":
            source = data.get("source") or {}
            if source.get("kind") not in ("user", "user-rpc"):
                continue
            text = _text_blocks(data.get("content"))
            if not text.strip():
                continue
            turn = ensure_turn()
            if turn.get("user") is None:
                turn["user"] = {"text": text[:MAX_TEXT],
                                "time": (float(ts) / 1000.0) if isinstance(ts, (int, float)) else None}
        elif typ in ("assistant/message", "assistant/attempt"):
            turn = ensure_turn(data.get("turn"))
            if typ == "assistant/attempt":
                live_reasoning, live_text = _stream_text(data.get("stream"))
                if live_reasoning or live_text:
                    blocks = [b for b in turn["blocks"] if not b.get("live")]
                    if live_reasoning:
                        blocks.append({"type": "reasoning", "text": live_reasoning, "live": True})
                    if live_text:
                        blocks.append({"type": "text", "text": live_text, "live": True})
                    turn["blocks"] = blocks
                continue
            turn["steps"] = max(int(turn.get("steps") or 0), int(data.get("step") or 1))
            if data.get("usage"):
                turn["usage"] = data.get("usage")
            message = data.get("message") or {}
            source = message.get("source") or {}
            if source.get("model"):
                model = str(source.get("model"))
            content = message.get("content") or []
            turn["blocks"] = [b for b in turn["blocks"] if not b.get("live")]
            for block in content:
                if not isinstance(block, dict):
                    continue
                kind = block.get("type")
                if kind == "reasoning":
                    text = str(block.get("text") or "")
                    if text:
                        if turn["blocks"] and turn["blocks"][-1].get("type") == "reasoning":
                            turn["blocks"][-1]["text"] += text
                        else:
                            turn["blocks"].append({"type": "reasoning", "text": text})
                elif kind == "text":
                    text = str(block.get("text") or "")
                    if text:
                        if turn["blocks"] and turn["blocks"][-1].get("type") == "text":
                            turn["blocks"][-1]["text"] += text
                        else:
                            turn["blocks"].append({"type": "text", "text": text})
                elif kind == "tool-call":
                    call_id = str(block.get("id") or "")
                    raw_args, command = _arguments(block.get("arguments"))
                    tool = {"type": "tool", "id": call_id, "name": str(block.get("name") or "tool"),
                            "arguments": raw_args, "command": command, "result": "",
                            "is_error": False, "status": "running"}
                    turn["blocks"].append(tool)
                    if call_id:
                        calls[call_id] = tool
        elif typ == "tool/call":
            call_id = str(data.get("callId") or "")
            if call_id and call_id not in calls:
                turn = ensure_turn(data.get("turn"))
                raw_args, command = _arguments(data.get("arguments"))
                tool = {"type": "tool", "id": call_id, "name": str(data.get("name") or "tool"),
                        "arguments": raw_args, "command": command, "result": "",
                        "is_error": False, "status": "running"}
                turn["blocks"].append(tool)
                calls[call_id] = tool
        elif typ == "tool/result":
            message = data.get("message") or {}
            call_id = str(message.get("toolCallId") or "")
            tool = calls.get(call_id)
            if tool is None:
                continue
            tool["result"] = _text_blocks(message.get("content"))[:MAX_RESULT]
            tool["is_error"] = bool(message.get("isError"))
            tool["status"] = "error" if tool["is_error"] else "done"

    if not title:
        first_user = next((t["user"]["text"] for t in turns if t.get("user")), "")
        title = first_user.strip().splitlines()[0][:60] if first_user.strip() else session_id
    status = "running" if current is not None else ("completed" if turns else "idle")
    return {"session_id": session_id, "title": title, "cwd": cwd, "status": status,
            "model": model, "agent_preset": preset, "updated_at": last_time,
            "turns": turns}


class DshSessionStore:
    def __init__(self, home: Path | str | None = None) -> None:
        env = os.environ.get("TETHER_NATIVE_DSH_HOME")
        self.home = Path(home or env or (Path.home() / ".dsh")).expanduser()
        self.root = self.home / "sessions"
        self._cache: dict[str, tuple[tuple[int, int], list[dict[str, Any]]]] = {}

    def available(self) -> bool:
        return zstd is not None and self.root.is_dir()

    def _files(self) -> list[Path]:
        try:
            return sorted(self.root.glob("*/*/session*.jsonl*"), key=lambda p: p.stat().st_mtime, reverse=True)
        except OSError:
            return []

    def _rows(self, path: Path) -> list[dict[str, Any]]:
        try:
            stat = path.stat()
            key = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            return []
        cached = self._cache.get(str(path))
        if cached and cached[0] == key:
            return cached[1]
        try:
            with path.open("rb") as fh:
                if path.suffix == ".zstd":
                    if zstd is None:
                        return []
                    reader = zstd.ZstdDecompressor().stream_reader(fh)
                    raw = reader.read()
                else:
                    raw = fh.read()
            rows = []
            for line in raw.decode("utf-8", "replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
            self._cache[str(path)] = (key, rows)
            return rows
        except Exception:
            return cached[1] if cached else []

    def list(self) -> list[dict[str, Any]]:
        items = []
        for path in self._files():
            rows = self._rows(path)
            if not rows:
                continue
            transcript = build_transcript(rows)
            last_user = ""
            for turn in reversed(transcript["turns"]):
                if turn.get("user"):
                    last_user = turn["user"]["text"]
                    break
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = transcript.get("updated_at") or time.time()
            items.append({
                "session_id": transcript["session_id"] or path.parent.name,
                "title": transcript["title"], "cwd": transcript["cwd"],
                "status": transcript["status"], "model": transcript.get("model"),
                "agent_preset": transcript.get("agent_preset"),
                "updated_at": mtime, "turns": len(transcript["turns"]),
                "last_user": last_user[:200],
            })
        items.sort(key=lambda item: item.get("updated_at") or 0, reverse=True)
        return items

    def transcript(self, session_id: str) -> dict[str, Any] | None:
        for path in self._files():
            if path.parent.name == session_id or path.parent.name.endswith(session_id):
                rows = self._rows(path)
                if rows:
                    result = build_transcript(rows)
                    result["log_path"] = str(path)
                    return result
        return None
