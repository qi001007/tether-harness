"""Per-node agent catalog: detected CLIs plus user-registered entries.

Detection never installs anything. A user can override a built-in command or
register an agent that is not on PATH; the record is stored under the node's
data directory so it survives restarts.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from .acp import resolve_executable

NO_WINDOW = 0x08000000
VERSION_TIMEOUT = 4.0
CACHE_TTL = 30.0
KINDS = ("app-server", "acp", "web", "cli")

BUILTINS: tuple[dict[str, Any], ...] = (
    {"id": "codex", "name": "Codex", "commands": ("codex",), "kind": "app-server",
     "transports": ("app-server", "acp", "terminal"), "icon": "codex", "color": "#111827"},
    {"id": "opencode", "name": "OpenCode", "commands": ("opencode",), "kind": "web",
     "transports": ("web", "acp", "terminal"), "icon": "opencode", "color": "#0f766e"},
    {"id": "qoder", "name": "Qoder", "commands": ("qodercli", "qoder"), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "qoder", "color": "#7c3aed"},
    {"id": "claude", "name": "Claude Code", "commands": ("claude", "claude-code-acp"), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "claude", "color": "#c2410c"},
    {"id": "gemini", "name": "Gemini CLI", "commands": ("gemini",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "gemini", "color": "#2563eb"},
    {"id": "cursor", "name": "Cursor Agent", "commands": ("cursor-agent",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "cursor", "color": "#0f172a"},
    {"id": "copilot", "name": "Copilot CLI", "commands": ("copilot",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "copilot", "color": "#0891b2"},
    {"id": "kimi", "name": "Kimi CLI", "commands": ("kimi",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "kimi", "color": "#be185d"},
    {"id": "dsh", "name": "DeepSeek Harness", "commands": ("dsh",), "kind": "web",
     "transports": ("web", "terminal"), "icon": "dsh", "color": "#1d4ed8"},
)

COLORS = ("#2563eb", "#d97706", "#7c3aed", "#0f766e", "#c2410c", "#0891b2", "#be185d", "#111827")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_EXECUTABLE_SUFFIXES = (".exe", ".cmd", ".bat", ".com")


class AgentRegistry:
    def __init__(self, data_dir: Path) -> None:
        self.path = Path(data_dir) / "agents.json"
        self.lock = threading.Lock()
        self._cache: dict[str, Any] | None = None
        self._cache_at = 0.0

    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        agents = data.get("agents") if isinstance(data, dict) else None
        return agents if isinstance(agents, dict) else {}

    def _save(self, agents: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps({"schema": 1, "agents": agents}, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        os.replace(temp, self.path)

    def _version(self, command: str) -> str:
        path = Path(command)
        if path.suffix.lower() == ".ps1":
            return ""
        kwargs: dict[str, Any] = {
            "stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
            "text": True, "encoding": "utf-8", "errors": "replace", "timeout": VERSION_TIMEOUT,
        }
        if os.name == "nt":
            kwargs["creationflags"] = NO_WINDOW
        argv = [command, "--version"]
        if path.suffix.lower() in (".cmd", ".bat"):
            argv = ["cmd.exe", "/d", "/s", "/c", subprocess.list2cmdline([command, "--version"])]
        try:
            result = subprocess.run(argv, **kwargs)
        except (OSError, subprocess.SubprocessError):
            return ""
        line = (result.stdout or "").strip().splitlines()
        return line[0].strip()[:80] if line else ""

    def _detected(self, spec: dict[str, Any]) -> dict[str, Any] | None:
        for name in spec["commands"]:
            path = resolve_executable(name)
            if path:
                record = {
                    "id": spec["id"], "name": spec["name"], "kind": spec["kind"],
                    "command": path, "args": [], "enabled": True, "source": "detected",
                    "icon": spec.get("icon") or spec["id"], "color": spec.get("color") or COLORS[0],
                    "transports": list(spec["transports"]), "available": True,
                }
                record["version"] = self._version(path)
                return record
        return None

    def _manual_record(self, agent_id: str, entry: dict[str, Any]) -> dict[str, Any]:
        command = str(entry.get("command") or "").strip()
        resolved = command
        if command:
            candidate = Path(command)
            resolved = str(candidate) if candidate.is_absolute() and candidate.is_file() else (resolve_executable(command) or command)
        kind = entry.get("kind") if entry.get("kind") in KINDS else "cli"
        transports = ["terminal"]
        if kind == "app-server":
            transports.insert(0, "app-server")
        elif kind == "acp":
            transports.insert(0, "acp")
        elif kind == "web":
            transports.insert(0, "web")
        record = {
            "id": agent_id, "name": str(entry.get("name") or agent_id), "kind": kind,
            "command": resolved, "args": [str(item) for item in (entry.get("args") or [])],
            "enabled": entry.get("enabled") is not False, "source": "manual",
            "icon": str(entry.get("icon") or "bot"), "color": str(entry.get("color") or COLORS[0]),
            "transports": transports,
            "available": bool(resolved and (Path(resolved).is_file() if Path(resolved).is_absolute() else resolve_executable(resolved))),
        }
        record["version"] = self._version(resolved) if record["available"] else ""
        return record

    def catalog(self, force: bool = False) -> dict[str, Any]:
        with self.lock:
            now = time.time()
            if self._cache is not None and not force and now - self._cache_at < CACHE_TTL:
                return self._cache
            configured = self._load()
            records: list[dict[str, Any]] = []
            seen: set[str] = set()
            for spec in BUILTINS:
                entry = configured.get(spec["id"]) if isinstance(configured.get(spec["id"]), dict) else None
                if entry is not None:
                    record = self._manual_record(spec["id"], entry)
                    record["name"] = str(entry.get("name") or spec["name"])
                    record["source"] = "overridden"
                else:
                    record = self._detected(spec)
                    if record is None:
                        record = {
                            "id": spec["id"], "name": spec["name"], "kind": spec["kind"],
                            "command": "", "args": [], "enabled": True, "source": "builtin",
                            "icon": spec.get("icon") or spec["id"], "color": spec.get("color") or COLORS[0],
                            "transports": list(spec["transports"]), "available": False, "version": "",
                        }
                records.append(record)
                seen.add(spec["id"])
            for agent_id, entry in configured.items():
                if agent_id in seen or not isinstance(entry, dict):
                    continue
                records.append(self._manual_record(agent_id, entry))
            records.sort(key=lambda item: (not item["available"], item["name"].lower()))
            payload = {"agents": records, "path": str(self.path), "kinds": list(KINDS), "colors": list(COLORS)}
            self._cache = payload
            self._cache_at = now
            return payload

    def save(self, args: dict[str, Any]) -> dict[str, Any]:
        agent_id = str(args.get("id") or "").strip().lower()
        if not agent_id:
            name = str(args.get("name") or "agent").strip().lower()
            agent_id = re.sub(r"[^a-z0-9]+", "-", name).strip("-")[:48] or "agent"
            base, index = agent_id, 2
            existing = self._load()
            while agent_id in existing and existing[agent_id].get("source") != "manual":
                agent_id = base + "-" + str(index)
                index += 1
        if not _ID_RE.fullmatch(agent_id):
            raise ValueError("agent id must be lowercase letters, digits, dot, dash or underscore")
        name = str(args.get("name") or "").strip()
        command = str(args.get("command") or "").strip()
        if not name or not command:
            raise ValueError("name and command are required")
        selected_kind = args.get("kind")
        if selected_kind is not None and selected_kind not in KINDS:
            raise ValueError("kind must be one of " + ", ".join(KINDS))
        kind = selected_kind or "cli"
        raw_args = args.get("args") or []
        if isinstance(raw_args, str):
            raw_args = [item for item in raw_args.split(" ") if item]
        if not isinstance(raw_args, list) or not all(isinstance(item, str) for item in raw_args):
            raise ValueError("args must be a list of strings")
        with self.lock:
            configured = self._load()
            configured[agent_id] = {
                "name": name, "command": command, "args": raw_args, "kind": kind,
                "enabled": args.get("enabled") is not False,
                "icon": str(args.get("icon") or "bot"),
                "color": str(args.get("color") or COLORS[0]),
                "source": "manual",
            }
            self._save(configured)
            self._cache = None
        return self.catalog(force=True)

    def remove(self, agent_id: str) -> dict[str, Any]:
        with self.lock:
            configured = self._load()
            configured.pop(str(agent_id or ""), None)
            self._save(configured)
            self._cache = None
        return self.catalog(force=True)
