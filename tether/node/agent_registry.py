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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .acp import resolve_executable

NO_WINDOW = 0x08000000
VERSION_TIMEOUT = 1.5
CACHE_TTL = 30.0
INSTALL_TIMEOUT = 600.0
KINDS = ("app-server", "acp", "web", "cli")

# Codeg's built-in list (https://github.com/xintaofei/codeg, Apache-2.0) plus
# DeepSeek Harness and GitHub Copilot CLI. `install` is only used for explicit
# user actions; detection never installs anything on its own.
BUILTINS: tuple[dict[str, Any], ...] = (
    {"id": "claude", "name": "Claude Code", "commands": ("claude",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "claude", "color": "#c2410c",
     "install": {"kind": "npm", "package": "@anthropic-ai/claude-code"}},
    {"id": "codex", "name": "Codex", "commands": ("codex",), "kind": "app-server",
     "transports": ("app-server", "acp", "terminal"), "icon": "codex", "color": "#111827",
     "install": {"kind": "npm", "package": "@openai/codex"}},
    {"id": "opencode", "name": "OpenCode", "commands": ("opencode",), "kind": "web",
     "transports": ("web", "acp", "terminal"), "icon": "opencode", "color": "#0f766e",
     "install": {"kind": "npm", "package": "opencode-ai"}},
    {"id": "gemini", "name": "Gemini CLI", "commands": ("gemini",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "gemini", "color": "#2563eb",
     "install": {"kind": "npm", "package": "@google/gemini-cli"}},
    {"id": "openclaw", "name": "OpenClaw", "commands": ("openclaw",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "openclaw", "color": "#b91c1c",
     "install": {"kind": "npm", "package": "openclaw"}},
    {"id": "cline", "name": "Cline", "commands": ("cline",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "cline", "color": "#1f2937",
     "install": {"kind": "npm", "package": "cline"}},
    {"id": "hermes", "name": "Hermes Agent", "commands": ("hermes",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "hermes", "color": "#7c3aed",
     "install": {"kind": "npm", "package": "hermes-agent"}},
    {"id": "codebuddy", "name": "CodeBuddy", "commands": ("codebuddy",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "codebuddy", "color": "#0891b2",
     "install": {"kind": "npm", "package": "@tencent-ai/codebuddy-code"}},
    {"id": "kimi", "name": "Kimi Code", "commands": ("kimi",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "kimi", "color": "#be185d",
     "install": {"kind": "npm", "package": "@moonshot-ai/kimi-code"}},
    {"id": "pi", "name": "Pi", "commands": ("pi",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "pi", "color": "#4d7c0f",
     "install": {"kind": "system", "url": "https://github.com/badlogic/pi-mono"}},
    {"id": "grok", "name": "Grok", "commands": ("grok",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "grok", "color": "#0f172a",
     "install": {"kind": "npm", "package": "@xai-official/grok"}},
    {"id": "cursor", "name": "Cursor Agent", "commands": ("cursor-agent",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "cursor", "color": "#0f172a",
     "install": {"kind": "system", "url": "https://cursor.com/cli"}},
    {"id": "dsh", "name": "DeepSeek Harness", "commands": ("dsh", "dsh-cli"), "kind": "web",
     "transports": ("workbench",), "icon": "dsh", "color": "#1d4ed8",
     "install": {"kind": "system", "url": "https://deepseek.com/harness"}},
    {"id": "qoder", "name": "Qoder", "commands": ("qodercli", "qoder", "qoder-cli"), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "qoder", "color": "#7c3aed",
     "install": {"kind": "npm", "package": "@qoder-ai/qodercli"}},
    {"id": "antigravity", "name": "Google Antigravity", "commands": ("agy_acp_server",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "antigravity", "color": "#4285f4",
     "install": {"kind": "system", "url": "https://antigravity.google"}},
    {"id": "kiro", "name": "Kiro CLI", "commands": ("kiro-cli",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "kiro", "color": "#6d28d9",
     "install": {"kind": "system", "url": "https://kiro.dev"}},
    {"id": "zcode", "name": "ZCode", "commands": ("zcode", "zcode-acp-server"), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "zcode", "color": "#0f766e",
     "install": {"kind": "system", "url": "https://zcode.dev"}},
    {"id": "trae", "name": "TRAE CLI", "commands": ("traecli", "trae"), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "trae", "color": "#2563eb",
     "install": {"kind": "system", "url": "https://trae.ai"}},
    {"id": "command-code", "name": "Command Code", "commands": ("command-code",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "command-code", "color": "#111827",
     "install": {"kind": "npm", "package": "command-code"}},
    {"id": "minimax", "name": "MiniMax Code", "commands": ("mcode",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "minimax", "color": "#dc2626",
     "install": {"kind": "system", "url": "https://www.minimaxi.com"}},
    {"id": "copilot", "name": "GitHub Copilot CLI", "commands": ("copilot",), "kind": "acp",
     "transports": ("acp", "terminal"), "icon": "copilot", "color": "#0891b2",
     "install": {"kind": "npm", "package": "@github/copilot"}},
)

COLORS = ("#2563eb", "#d97706", "#7c3aed", "#0f766e", "#c2410c", "#0891b2", "#be185d", "#111827")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_EXECUTABLE_SUFFIXES = (".exe", ".cmd", ".bat", ".com")


def agent_home() -> Path:
    raw = str(os.environ.get("TETHER_AGENT_HOME") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path("D:/Tether/agents") if os.name == "nt" else Path("/opt/tether/agents")


def resolve_agent_executable(name: str) -> str:
    """PATH first, then the user-level Agent Home used by the install button."""
    found = resolve_executable(name)
    if found:
        return found
    home = agent_home()
    suffixes = _EXECUTABLE_SUFFIXES + ("",) if os.name == "nt" else ("",)
    roots = (home, home / "bin", home / "node_modules" / ".bin")
    for root in roots:
        for suffix in suffixes:
            candidate = root / (name + suffix)
            if candidate.is_file():
                return str(candidate)
    return ""


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

    def _install_info(self, spec: dict[str, Any]) -> dict[str, Any]:
        return dict(spec.get("install") or {})

    def _detected(self, spec: dict[str, Any]) -> dict[str, Any] | None:
        for name in spec["commands"]:
            path = resolve_agent_executable(name)
            if path:
                record = {
                    "id": spec["id"], "name": spec["name"], "kind": spec["kind"],
                    "command": path, "args": [str(item) for item in (spec.get("args") or [])],
                    "enabled": True, "source": "detected",
                    "icon": spec.get("icon") or spec["id"], "color": spec.get("color") or COLORS[0],
                    "transports": list(spec["transports"]), "available": True,
                    "install": self._install_info(spec),
                }
                record["version"] = ""
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
        record["version"] = ""
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
                    record["install"] = self._install_info(spec)
                else:
                    record = self._detected(spec)
                    if record is None:
                        record = {
                            "id": spec["id"], "name": spec["name"], "kind": spec["kind"],
                            "command": "", "args": [], "enabled": True, "source": "builtin",
                            "icon": spec.get("icon") or spec["id"], "color": spec.get("color") or COLORS[0],
                            "transports": list(spec["transports"]), "available": False, "version": "",
                            "install": self._install_info(spec),
                        }
                records.append(record)
                seen.add(spec["id"])
            for agent_id, entry in configured.items():
                if agent_id in seen or not isinstance(entry, dict):
                    continue
                records.append(self._manual_record(agent_id, entry))
            targets = [item for item in records if item.get("available") and item.get("command")]
            if targets:
                with ThreadPoolExecutor(max_workers=min(8, len(targets))) as pool:
                    versions = list(pool.map(lambda item: self._version(str(item["command"])), targets))
                for item, version in zip(targets, versions):
                    item["version"] = "" if ("requires an explicit DSH_HOME" in version
                                              or version.lower().startswith("error")) else version
            records.sort(key=lambda item: (not item["available"], item["name"].lower()))
            payload = {"agents": records, "path": str(self.path), "kinds": list(KINDS),
                       "colors": list(COLORS), "home": str(agent_home())}
            self._cache = payload
            self._cache_at = now
            return payload

    def get(self, agent_id: str) -> dict[str, Any] | None:
        return next((item for item in self.catalog(force=True)["agents"]
                     if item.get("id") == str(agent_id or "")), None)

    def install(self, agent_id: str) -> dict[str, Any]:
        spec = next((item for item in BUILTINS if item["id"] == str(agent_id or "")), None)
        if spec is None:
            raise ValueError("unknown built-in agent")
        info = self._install_info(spec)
        kind = str(info.get("kind") or "")
        if kind == "system":
            return {"ok": True, "installed": False, "action": "manual",
                    "url": str(info.get("url") or ""),
                    "message": "该 Agent 需要官方安装器，请使用官网安装后刷新"}
        if kind != "npm":
            raise ValueError("this agent has no automatic installer")
        package = str(info.get("package") or "").strip()
        if not package or not re.fullmatch(r"[@a-zA-Z0-9._/-]+", package):
            raise ValueError("invalid install package")
        npm = resolve_executable("npm")
        if not npm:
            raise ValueError("npm is not installed on this node")
        home = agent_home()
        home.mkdir(parents=True, exist_ok=True)
        env = {**os.environ,
               "npm_config_prefix": str(home), "npm_config_cache": str(home / "cache")}
        argv = [npm, "install", "-g", "--prefix", str(home), "--cache", str(home / "cache"),
                "--no-fund", "--no-audit", package]
        if os.name == "nt" and npm.lower().endswith((".cmd", ".bat")):
            argv = ["cmd.exe", "/d", "/s", "/c", subprocess.list2cmdline(argv)]
        kwargs: dict[str, Any] = {
            "stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
            "text": True, "encoding": "utf-8", "errors": "replace", "timeout": INSTALL_TIMEOUT,
            "env": env, "cwd": str(home),
        }
        if os.name == "nt":
            kwargs["creationflags"] = NO_WINDOW
        try:
            result = subprocess.run(argv, **kwargs)
        except subprocess.TimeoutExpired:
            raise ValueError("安装超时") from None
        except OSError as exc:
            raise ValueError("无法运行 npm: " + str(exc)) from None
        output = (result.stdout or "").strip()
        if result.returncode != 0:
            raise ValueError("安装失败：" + output[-600:])
        self._cache = None
        return {"ok": True, "installed": True, "package": package, "home": str(home),
                "output": output[-600:], "catalog": self.catalog(force=True)}

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
