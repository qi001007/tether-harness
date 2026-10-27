"""Short-lived local identity records shared with the DSH companion."""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path


def identity_path(home: Path, pid: int | None = None) -> Path:
    return Path(home) / "storages" / "tether" / f"node-identity-{pid or os.getpid()}.json"


def write_identity(home: Path, device_id: str, *, pid: int | None = None, now: float | None = None) -> Path:
    if not isinstance(device_id, str) or not device_id or len(device_id) > 256 or any(ord(char) < 32 or ord(char) == 127 for char in device_id):
        raise ValueError("invalid node device ID")
    owner_pid = pid or os.getpid()
    target = identity_path(home, owner_pid)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({
        "version": 1,
        "pid": owner_pid,
        "device_id": device_id,
        "updated_at": time.time() * 1000 if now is None else now,
    }, separators=(",", ":"))
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}-", suffix=".tmp", dir=target.parent)
    try:
        if os.name != "nt":
            os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    return target


def remove_identity(home: Path, device_id: str, *, pid: int | None = None) -> bool:
    owner_pid = pid or os.getpid()
    target = identity_path(home, owner_pid)
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        if payload.get("version") != 1 or payload.get("pid") != owner_pid or payload.get("device_id") != device_id:
            return False
        target.unlink()
        return True
    except (OSError, ValueError, AttributeError):
        return False

