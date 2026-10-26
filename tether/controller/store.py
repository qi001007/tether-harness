"""SQLite state for the Tether controller.

The store is the only authority for device/session/run/event state. It is
intentionally synchronous; the API layer is small enough that a lock around a
single connection is simpler than an async DB driver.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any


class Conflict(Exception):
    """A request conflicts with an existing run or session lease."""


class NotFound(Exception):
    pass


ACTIVE_STATES = ("queued", "dispatching", "running", "cancelling")
TERMINAL_STATES = ("completed", "cancelled", "failed", "unknown")


def now() -> float:
    return time.time()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fingerprint(prompt: str, device_id: str, workspace: str) -> str:
    return sha256(json.dumps({"prompt": prompt, "device_id": device_id, "workspace": workspace},
                             ensure_ascii=False, sort_keys=True))


SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT,
  capabilities TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  last_seen REAL
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  harness_session_id TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  prompt TEXT NOT NULL,
  state TEXT NOT NULL,
  finish_reason TEXT,
  final_response TEXT,
  outcome TEXT,
  created_at REAL NOT NULL,
  started_at REAL,
  finished_at REAL,
  ack_seq INTEGER NOT NULL DEFAULT 0,
  UNIQUE(device_id, request_id)
);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ts REAL NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);
"""


class Store:
    def __init__(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # devices -----------------------------------------------------------------
    def register_device(self, device_id: str, name: str, platform: str,
                        capabilities: dict[str, Any], token: str) -> dict[str, Any]:
        token_hash = sha256(token)
        with self._lock:
            row = self._db.execute("SELECT token_hash FROM devices WHERE device_id=?", (device_id,)).fetchone()
            if row is not None and row["token_hash"] != token_hash:
                raise Conflict("device token does not match")
            self._db.execute(
                """INSERT INTO devices(device_id,name,platform,capabilities,token_hash,online,last_seen)
                   VALUES(?,?,?,?,?,1,?)
                   ON CONFLICT(device_id) DO UPDATE SET
                     name=excluded.name, platform=excluded.platform,
                     capabilities=excluded.capabilities, online=1, last_seen=excluded.last_seen""",
                (device_id, name, platform, json.dumps(capabilities, ensure_ascii=False), token_hash, now()),
            )
            self._db.commit()
        return self.get_device(device_id)

    def set_online(self, device_id: str, online: bool) -> None:
        with self._lock:
            self._db.execute("UPDATE devices SET online=?, last_seen=? WHERE device_id=?",
                             (1 if online else 0, now(), device_id))
            self._db.commit()

    def heartbeat(self, device_id: str) -> None:
        with self._lock:
            self._db.execute("UPDATE devices SET online=1, last_seen=? WHERE device_id=?", (now(), device_id))
            self._db.commit()

    def get_device(self, device_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._db.execute("SELECT * FROM devices WHERE device_id=?", (device_id,)).fetchone()
        if row is None:
            raise NotFound(device_id)
        return _device(row)

    def list_devices(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM devices ORDER BY name").fetchall()
        return [_device(r) for r in rows]

    # sessions ----------------------------------------------------------------
    def create_session(self, device_id: str, workspace: str, harness_session_id: str | None = None) -> dict[str, Any]:
        self.get_device(device_id)
        session_id = f"s-{uuid.uuid4().hex[:12]}"
        with self._lock:
            self._db.execute(
                "INSERT INTO sessions(session_id,device_id,workspace,harness_session_id,created_at) VALUES(?,?,?,?,?)",
                (session_id, device_id, workspace, harness_session_id, now()),
            )
            self._db.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._db.execute("SELECT * FROM sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise NotFound(session_id)
        return dict(row)

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM sessions ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    # runs --------------------------------------------------------------------
    def active_run_for_session(self, session_id: str) -> dict[str, Any] | None:
        marks = ",".join("?" for _ in ACTIVE_STATES)
        with self._lock:
            row = self._db.execute(
                f"SELECT * FROM runs WHERE session_id=? AND state IN ({marks}) ORDER BY created_at DESC LIMIT 1",
                (session_id, *ACTIVE_STATES),
            ).fetchone()
        return _run(row) if row else None

    def create_run(self, session_id: str, request_id: str, prompt: str) -> tuple[dict[str, Any], bool]:
        session = self.get_session(session_id)
        fp = fingerprint(prompt, session["device_id"], session["workspace"])
        with self._lock:
            existing = self._db.execute(
                "SELECT * FROM runs WHERE device_id=? AND request_id=?",
                (session["device_id"], request_id),
            ).fetchone()
            if existing is not None:
                if existing["fingerprint"] != fp:
                    raise Conflict("request_id reused with different content")
                return _run(existing), True
            active = self.active_run_for_session(session_id)
            if active is not None:
                raise Conflict(f"session busy with run {active['run_id']}")
            run_id = f"r-{uuid.uuid4().hex[:12]}"
            self._db.execute(
                """INSERT INTO runs(run_id,session_id,device_id,request_id,fingerprint,prompt,state,created_at)
                   VALUES(?,?,?,?,?,?, 'queued', ?)""",
                (run_id, session_id, session["device_id"], request_id, fp, prompt, now()),
            )
            self._db.commit()
        return self.get_run(run_id), False

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._db.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise NotFound(run_id)
        return _run(row)

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [_run(r) for r in rows]

    def runs_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM runs WHERE session_id=? ORDER BY created_at", (session_id,)
            ).fetchall()
        return [_run(r) for r in rows]

    def set_run_state(self, run_id: str, state: str, *, finish_reason: str | None = None,
                      final_response: str | None = None, outcome: dict[str, Any] | None = None) -> dict[str, Any]:
        if state not in ACTIVE_STATES + TERMINAL_STATES:
            raise Conflict(f"unknown state {state}")
        run = self.get_run(run_id)
        if run["state"] in TERMINAL_STATES and state not in TERMINAL_STATES:
            # `unknown` is a safe placeholder, not a verdict. A reconnected node
            # reporting that the run is still alive is authoritative.
            if not (run["state"] == "unknown" and state in ("running", "dispatching", "cancelling")):
                raise Conflict(f"run {run_id} already terminal ({run['state']})")
        fields = ["state=?"]
        values: list[Any] = [state]
        if finish_reason is not None:
            fields.append("finish_reason=?")
            values.append(finish_reason)
        if final_response is not None:
            fields.append("final_response=?")
            values.append(final_response)
        if outcome is not None:
            fields.append("outcome=?")
            values.append(json.dumps(outcome, ensure_ascii=False))
        if state in ACTIVE_STATES:
            # A reconnected node can take a run back from `unknown`; terminal
            # bookkeeping from the placeholder must not survive.
            fields.extend(["finished_at=NULL", "finish_reason=NULL",
                           "final_response=NULL", "outcome=NULL"])
        if state == "running" and run["started_at"] is None:
            fields.append("started_at=?")
            values.append(now())
        if state in TERMINAL_STATES:
            fields.append("finished_at=?")
            values.append(now())
        values.append(run_id)
        with self._lock:
            self._db.execute(f"UPDATE runs SET {', '.join(fields)} WHERE run_id=?", values)
            self._db.commit()
        return self.get_run(run_id)

    def set_ack(self, run_id: str, ack_seq: int) -> None:
        with self._lock:
            self._db.execute("UPDATE runs SET ack_seq=? WHERE run_id=? AND ack_seq<?", (ack_seq, run_id, ack_seq))
            self._db.commit()

    def add_event(self, run_id: str, seq: int, kind: str, payload: dict[str, Any], ts: float | None = None) -> int:
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO events(run_id,seq,kind,ts,payload) VALUES(?,?,?,?,?)",
                (run_id, seq, kind, ts or now(), json.dumps(payload, ensure_ascii=False)),
            )
            self._db.commit()
            row = self._db.execute("SELECT ack_seq FROM runs WHERE run_id=?", (run_id,)).fetchone()
            ack = int(row["ack_seq"]) if row else 0
            while True:
                nxt = self._db.execute("SELECT 1 FROM events WHERE run_id=? AND seq=?", (run_id, ack + 1)).fetchone()
                if nxt is None:
                    break
                ack += 1
            self._db.execute("UPDATE runs SET ack_seq=? WHERE run_id=?", (ack, run_id))
            self._db.commit()
        return ack

    def get_events(self, run_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq", (run_id, after_seq)
            ).fetchall()
        return [{"run_id": r["run_id"], "seq": r["seq"], "kind": r["kind"], "ts": r["ts"],
                 "payload": json.loads(r["payload"])} for r in rows]

    def mark_device_unknown(self, device_id: str) -> list[str]:
        changed: list[str] = []
        with self._lock:
            rows = self._db.execute(
                f"SELECT run_id FROM runs WHERE device_id=? AND state IN ({','.join('?' for _ in ACTIVE_STATES)})",
                (device_id, *ACTIVE_STATES),
            ).fetchall()
            for row in rows:
                self._db.execute(
                    "UPDATE runs SET state='unknown', finished_at=?, outcome=? WHERE run_id=?",
                    (now(), json.dumps({"reason": "node disconnected before terminal state"}), row["run_id"]),
                )
                changed.append(row["run_id"])
            self._db.commit()
        return changed


def _device(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "device_id": row["device_id"], "name": row["name"], "platform": row["platform"],
        "capabilities": json.loads(row["capabilities"]),
        "online": bool(row["online"]), "last_seen": row["last_seen"],
    }


def _run(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "run_id": row["run_id"], "session_id": row["session_id"], "device_id": row["device_id"],
        "request_id": row["request_id"], "fingerprint": row["fingerprint"], "prompt": row["prompt"],
        "state": row["state"], "finish_reason": row["finish_reason"],
        "final_response": row["final_response"],
        "outcome": json.loads(row["outcome"]) if row["outcome"] else None,
        "created_at": row["created_at"], "started_at": row["started_at"],
        "finished_at": row["finished_at"], "ack_seq": row["ack_seq"],
    }