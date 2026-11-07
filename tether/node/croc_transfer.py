"""Thin adapter around the official croc binary.

Tether does not implement the transfer protocol. This module only starts croc,
parses its progress output, and exposes cancel/status to the Node API.
"""

from __future__ import annotations

import os
import platform as host_platform
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

PERCENT = re.compile(r"(\d{1,3})%")
SPEED = re.compile(r"([\d.]+)\s*(B|KB|MB|GB)/s", re.IGNORECASE)
SPEED_UNIT = {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}


def new_code() -> str:
    return secrets.token_urlsafe(12)


class CrocError(RuntimeError):
    def __init__(self, message: str, code: str = "croc_error") -> None:
        super().__init__(message)
        self.code = code


def _units(text: str) -> int:
    match = SPEED.search(text)
    if not match:
        return 0
    return int(float(match.group(1)) * SPEED_UNIT[match.group(2).upper()])


class CrocJob:
    def __init__(self, process: subprocess.Popen[str], *, direction: str, total: int = 0) -> None:
        self.process = process
        self.direction = direction
        self.total = total
        self.started_at = time.time()
        self.percent = 0
        self.progress_seq = 0
        self.speed = 0
        self.line = ""
        self.error = ""
        self.state = "running"
        self._lock = threading.Lock()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self) -> None:
        stream = self.process.stdout
        if stream is None:
            return
        for raw in stream:
            line = raw.strip()
            if not line:
                continue
            with self._lock:
                self.line = line[:300]
                match = PERCENT.search(line)
                if match:
                    percent = max(0, min(100, int(match.group(1))))
                    if percent > self.percent:
                        self.progress_seq += 1
                    self.percent = percent
                speed = _units(line)
                if speed:
                    self.speed = speed
                    self.progress_seq += 1
                if "error" in line.lower() or "failed" in line.lower():
                    self.error = line[:300]
        return_code = self.process.wait()
        with self._lock:
            if self.state == "cancelled":
                return
            if return_code == 0:
                self.state = "completed"
                self.percent = 100
            else:
                self.state = "failed"
                if not self.error:
                    self.error = "croc exited with code " + str(return_code)

    def status(self) -> dict[str, Any]:
        with self._lock:
            elapsed = max(0.001, time.time() - self.started_at)
            return {
                "state": self.state,
                "direction": self.direction,
                "percent": self.percent,
                "progress_seq": self.progress_seq,
                "speed": self.speed,
                "bytes_per_second": self.speed,
                "elapsed": round(elapsed, 2),
                "line": self.line,
                "error": self.error,
                "pid": self.process.pid,
            }

    def cancel(self) -> dict[str, Any]:
        with self._lock:
            if self.state == "running":
                self.state = "cancelled"
        if self.process.poll() is None:
            try:
                self.process.terminate()
            except OSError:
                pass
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    self.process.kill()
                except OSError:
                    pass
        return self.status()


class CrocTransfer:
    def __init__(self, binary: str | None = None, relay: str | None = None,
                 platform: str | None = None) -> None:
        self._binary = binary or os.environ.get("TETHER_CROC") or ""
        self.relay = (relay or os.environ.get("TETHER_CROC_RELAY") or "").strip()
        raw = (platform or sys.platform or os.name).lower()
        if raw.startswith("linux"):
            self.platform = "linux"
        elif raw.startswith("darwin") or raw == "macos":
            self.platform = "darwin"
        elif raw in ("nt", "win32", "windows"):
            self.platform = "nt"
        else:
            self.platform = raw
        self._version: str | None = None
        self._probe_lock = threading.Lock()
        self.job: CrocJob | None = None

    def binary(self) -> str:
        if self._binary:
            found = self._binary
        else:
            machine = host_platform.machine().lower()
            if self.platform == "nt":
                candidates = ["croc.exe"]
            elif self.platform == "darwin":
                candidates = ["croc-darwin-arm64", "croc-darwin-x64"] if machine in ("arm64", "aarch64") else ["croc-darwin-x64", "croc-darwin-arm64"]
            elif self.platform == "linux":
                candidates = ["croc-linux-arm64", "croc-linux-x64"] if machine in ("arm64", "aarch64") else ["croc-linux-x64", "croc-linux-arm64"]
            else:
                candidates = ["croc"]
            candidates.append("croc.exe" if self.platform == "nt" else "croc")
            found = ""
            for name in candidates:
                found = shutil.which(name) or ""
                if not found:
                    bundled = Path(__file__).with_name("bin") / name
                    found = str(bundled) if bundled.is_file() else ""
                if found:
                    break
        if found and self.platform != "nt" and os.path.isfile(found):
            try:
                os.chmod(found, 0o755)
            except OSError:
                pass
        return found

    def available(self) -> bool:
        return bool(self.binary())

    def version(self) -> str:
        if self._version is not None:
            return self._version
        binary = self.binary()
        if not binary:
            return ""
        with self._probe_lock:
            if self._version is not None:
                return self._version
            try:
                result = subprocess.run([binary, "--version"], capture_output=True, text=True,
                                        timeout=10, encoding="utf-8", errors="replace",
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                text = (result.stdout or result.stderr or "").strip()
                match = re.search(r"(\d+\.\d+\.\d+)", text)
                self._version = match.group(1) if match else text[:40]
            except (OSError, subprocess.SubprocessError):
                self._version = ""
        return self._version

    def info(self) -> dict[str, Any]:
        return {"available": self.available(), "version": self.version(),
                "relay": bool(self.relay)}

    def _require(self) -> tuple[str, str]:
        binary = self.binary()
        if not binary:
            raise CrocError("croc binary is not installed", "croc_missing")
        if not self.relay:
            raise CrocError("a self-hosted croc relay is required", "croc_relay_required")
        return binary, self.relay

    def _popen(self, args: list[str], env: dict[str, str] | None = None) -> subprocess.Popen[str]:
        merged = os.environ.copy()
        # croc turns HTTP_PROXY into --connect and sends relay traffic through
        # the proxy; a stale system proxy then hangs the whole transfer.
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                     "http_proxy", "https_proxy", "all_proxy"):
            merged.pop(name, None)
        if env:
            merged.update(env)
        return subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", env=merged,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def send(self, path: str, code: str, *, transfers: int = 4, transport: str = "relay") -> CrocJob:
        binary, relay = self._require()
        source = Path(path).expanduser()
        if not source.exists():
            raise CrocError("source path does not exist", "croc_source_missing")
        if len(code) < 6:
            raise CrocError("croc code must be at least 6 characters", "croc_bad_code")
        if self.job and self.job.status()["state"] == "running":
            raise CrocError("a croc transfer is already running", "croc_busy")
        args = [binary, "--relay", relay, "--yes", "--overwrite", "--ignore-stdin", "send"]
        env: dict[str, str] | None = None
        if self.platform == "nt":
            args += ["--code", code]
        else:
            # croc v11 refuses command-line codes on UNIX; use the environment.
            env = {"CROC_SECRET": code}
        args += ["--transfers", str(max(1, min(8, transfers))),
                 "--transport", transport, str(source)]
        self.job = CrocJob(self._popen(args, env), direction="send")
        return self.job

    def receive(self, code: str, out_dir: str) -> CrocJob:
        binary, relay = self._require()
        target = Path(out_dir).expanduser()
        target.mkdir(parents=True, exist_ok=True)
        if len(code) < 6:
            raise CrocError("croc code must be at least 6 characters", "croc_bad_code")
        if self.job and self.job.status()["state"] == "running":
            raise CrocError("a croc transfer is already running", "croc_busy")
        args = [binary, "--relay", relay, "--yes", "--overwrite", "--ignore-stdin",
                "--out", str(target)]
        self.job = CrocJob(self._popen(args, {"CROC_SECRET": code}), direction="receive")
        return self.job

    def status(self) -> dict[str, Any]:
        return self.job.status() if self.job else {"state": "idle"}
