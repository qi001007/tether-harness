"""DeepSeek Harness adapter for a Tether node.

The SDK is synchronous and owns a child runtime, so each run gets a worker
thread plus its own harness process. Cancellation is deliberately honest: the
SDK protocol has no session/cancel, so we close the runtime (shutdown, then
terminate), mark the run cancelled, and let the next run `resume_session` repair
the interrupted turn.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[2]
RAW_LOG = ROOT / ".runtime" / "dsh-events.jsonl"
NPM_DSH = ROOT / ".runtime" / "npm" / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"


def npm_launch_args() -> tuple[str, ...] | None:
    """Use the npm runtime when the bundled Windows wheel references its build path.

    The 0.2.1rc2 wheel hardcodes E:\\snapshot\\node\\node_modules for koffi; the
    npm package installs that native module correctly. Set TETHER_DSH_BIN to
    override, or keep the bundled runtime when the wheel is fixed.
    """
    override = os.environ.get("TETHER_DSH_BIN")
    if override:
        node = shutil.which("node")
        return (node or "node", str(Path(override).resolve()), "--profile", "sdk")
    if NPM_DSH.is_file() and shutil.which("node"):
        return (shutil.which("node") or "node", str(NPM_DSH), "--profile", "sdk")
    return None


def _trunc(value: Any, limit: int = 2000) -> Any:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)[:limit]
    return text if len(text) <= limit else text[:limit] + "…"


def _text_of(value: Any, depth: int = 0) -> str:
    if depth > 5:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_text_of(v, depth + 1) for v in value)
    if isinstance(value, dict):
        for key in ("text", "delta", "content", "message", "result"):
            if key in value:
                found = _text_of(value[key], depth + 1)
                if found:
                    return found
    return ""


def map_note(note: Any) -> list[tuple[str, dict[str, Any]]]:
    """Translate one SDK notification into Tether events.

    The exact DSH event vocabulary is versioned; keep a generic fallback so a
    new event type still reaches the UI instead of disappearing.
    """
    method = getattr(note, "method", "")
    payload = getattr(note, "payload", {}) or {}
    if method == "session.event":
        event = payload.get("event") or {}
        typ = str(event.get("type") or "event")
        data = event.get("data") or {}
        if typ in {"system/message", "user/message", "request/header", "request/context",
                   "session/title", "agent/inbox/spliced", "turn/start", "step/start",
                   "step/end", "session/status", "job/registered", "job/settled",
                   "session-log-deepseek/delivery-accepted"}:
            return []
        if typ == "tool/call":
            name = str(data.get("name") or "tool")
            raw_args = data.get("arguments") or ""
            try:
                parsed = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception:
                parsed = {}
            command = parsed.get("command") or parsed.get("file_path") or raw_args
            return [("tool", {"type": typ, "name": name, "command": str(command)[:400],
                              "text": str(command)[:400], "data": _trunc(data)})]
        if typ == "tool/result":
            return [("tool", {"type": typ, "text": _text_of(data)[:2000], "data": _trunc(data)})]
        if "tool" in typ:
            return [("tool", {"type": typ, "text": _text_of(data)[:2000], "data": _trunc(data)})]
        if typ == "assistant/attempt":
            # Streaming deltas include reasoning; the committed assistant/message
            # below carries the final text, so do not duplicate token noise here.
            return []
        if typ == "assistant/message":
            message = (data.get("message") or {}).get("content") or []
            texts, thoughts = [], []
            for block in message:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    texts.append(str(block.get("text") or ""))
                elif block.get("type") == "reasoning":
                    thoughts.append(str(block.get("text") or ""))
            out: list[tuple[str, dict[str, Any]]] = []
            thought_text = "".join(thoughts).strip()
            if thought_text:
                out.append(("thought", {"type": typ, "text": thought_text[:600]}))
            if texts:
                out.append(("assistant", {"type": typ, "text": "".join(texts)[:4000]}))
            return out
        if typ == "turn/end":
            reason = data.get("reason") or {}
            error = reason.get("error") or {}
            return [("log", {"type": "turn/end", "reason": reason.get("kind"),
                             "error": str(error.get("message") or "")[:500]})]
        text = _text_of(data)
        if text:
            return [("assistant", {"type": typ, "text": text[:4000]})]
        return [("log", {"type": typ, "data": _trunc(data, 600)})]
    if method == "session.status":
        return []
    return [("log", {"method": method, "payload": _trunc(payload, 600)})]


class DshRun:
    def __init__(self, node: Any, run_id: str, tether_session_id: str, prompt: str) -> None:
        self.node = node
        self.run_id = run_id
        self.tether_session_id = tether_session_id
        self.prompt = prompt
        self.loop: asyncio.AbstractEventLoop | None = None
        self.harness: DeepSeekHarness | None = None
        self.cancelled = threading.Event()
        self.error: BaseException | None = None
        self.result: Any = None
        self.dsh_session_id: str | None = None

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        await asyncio.to_thread(self._blocking)

    def _blocking(self) -> None:
        try:
            self.dsh_session_id = self.node.store.get_dsh_session(self.tether_session_id)
            first = self.dsh_session_id is None
            if first:
                self.dsh_session_id = f"tether-{self.tether_session_id}"
            self.harness = DeepSeekHarness(
                dsh_home=self.node.dsh_home,
                cwd=self.node.workspace,
                provider=self.node.provider,
                model=self.node.model,
                max_tokens=int(os.environ.get("DSH_MAX_TOKENS", "8192")),
                initialize_timeout_seconds=60.0,
                env={"DSH_HOME": self.node.dsh_home},
                _launch_args=npm_launch_args(),
            )
            self.harness.start()
            if self.cancelled.is_set():
                return
            if first:
                session = self.harness.start_session(self.dsh_session_id)
                self.node.store.set_dsh_session(self.tether_session_id, self.dsh_session_id)
            else:
                session = self.harness.resume_session(self.dsh_session_id)
            if self.cancelled.is_set():
                return
            self.result = session.run(self.prompt, on_notification=self._on_note)
        except BaseException as exc:  # noqa: BLE001 - reported to the node
            self.error = exc
        finally:
            try:
                if self.harness is not None:
                    self.harness.close()
            except Exception:
                pass

    def _on_note(self, note: Any) -> None:
        try:
            RAW_LOG.parent.mkdir(parents=True, exist_ok=True)
            with RAW_LOG.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"run_id": self.run_id, "method": note.method,
                                     "payload": note.payload}, ensure_ascii=False) + "\n")
        except Exception:
            pass
        if self.loop is None:
            return
        for kind, payload in map_note(note):
            try:
                asyncio.run_coroutine_threadsafe(self.node.emit(self.run_id, kind, payload), self.loop)
            except Exception:
                pass

    async def cancel(self) -> None:
        self.cancelled.set()
        if self.harness is not None:
            await asyncio.to_thread(self._close)
        else:
            # The worker may still be starting; it checks the flag after start.
            pass

    def _close(self) -> None:
        try:
            if self.harness is not None:
                self.harness.close()
        except Exception:
            pass