"""Per-agent account profiles: snapshot credential/config files and switch."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any

MAX_FILE = 2 * 1024 * 1024
PROFILE_RE = re.compile(r"^[a-z0-9]{8,32}$")

GROUPS: dict[str, tuple[str, ...]] = {
    "codex": (".codex/auth.json", ".codex/config.toml"),
    "claude": (".claude/settings.json", ".claude/.credentials.json"),
    "gemini": (".gemini/settings.json", ".gemini/oauth_creds.json", ".gemini/google_accounts.json"),
    "opencode": (".local/share/opencode/auth.json", "AppData/Roaming/opencode/auth.json",
                 "AppData/Local/opencode/auth.json"),
    "qoder": (".qoder/config.json", ".qoder/settings.json"),
}


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


class AgentAccounts:
    def __init__(self, data_dir: Path, home: Path | None = None) -> None:
        self.root = Path(data_dir) / "agent-accounts"
        self.home = Path(home or Path.home())
        self.lock = threading.Lock()

    def supports(self, agent: str) -> bool:
        return agent in GROUPS

    def _files(self, agent: str) -> list[Path]:
        return [self.home / rel for rel in GROUPS.get(agent, ())]

    def _meta_path(self, agent: str) -> Path:
        return self.root / agent / "accounts.json"

    def _load(self, agent: str) -> dict[str, Any]:
        try:
            data = json.loads(self._meta_path(agent).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"profiles": []}
        if not isinstance(data.get("profiles"), list):
            data["profiles"] = []
        return data

    def _save(self, agent: str, data: dict[str, Any]) -> None:
        path = self._meta_path(agent)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp, path)

    def _present(self, agent: str) -> list[tuple[str, Path]]:
        items = []
        for path in self._files(agent):
            try:
                if path.is_file() and path.stat().st_size <= MAX_FILE:
                    items.append((str(path.relative_to(self.home)).replace("\\", "/"), path))
            except OSError:
                continue
        return items

    def _fingerprint(self, agent: str) -> dict[str, str]:
        print_map = {}
        for rel, path in self._present(agent):
            try:
                print_map[rel] = _sha(path)
            except OSError:
                continue
        return print_map

    def list(self, agent: str) -> dict[str, Any]:
        if agent not in GROUPS:
            raise ValueError("this agent has no account files")
        data = self._load(agent)
        live = self._fingerprint(agent)
        profiles = []
        for item in data["profiles"]:
            if not isinstance(item, dict):
                continue
            stored = {entry.get("rel"): entry.get("sha256") for entry in item.get("files") or []
                      if isinstance(entry, dict)}
            current = bool(stored) and all(live.get(rel) == sha for rel, sha in stored.items())
            profiles.append({"id": item.get("id"), "name": item.get("name"),
                             "created": item.get("created"), "files": len(stored),
                             "current": current})
        profiles.sort(key=lambda item: item.get("created") or 0, reverse=True)
        return {"agent": agent, "profiles": profiles, "live": sorted(live.keys()),
                "root": str(self.root / agent)}

    def save(self, agent: str, name: str) -> dict[str, Any]:
        if agent not in GROUPS:
            raise ValueError("this agent has no account files")
        label = str(name or "").strip()[:60]
        if not label:
            raise ValueError("account name is required")
        with self.lock:
            present = self._present(agent)
            if not present:
                raise ValueError("no account files found on this node")
            live = self._fingerprint(agent)
            data = self._load(agent)
            data["profiles"] = [item for item in data["profiles"] if isinstance(item, dict)]
            for item in data["profiles"]:
                stored = {entry.get("rel"): entry.get("sha256") for entry in item.get("files") or []
                          if isinstance(entry, dict)}
                if stored and stored == live:
                    return self.list(agent)
            profile_id = hashlib.sha256((label + str(time.time())).encode()).hexdigest()[:12]
            folder = self.root / agent / profile_id / "files"
            entries = []
            for rel, path in present:
                target = folder / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                try:
                    os.chmod(target, 0o600)
                except OSError:
                    pass
                entries.append({"rel": rel, "sha256": _sha(path), "size": path.stat().st_size})
            data["profiles"].append({"id": profile_id, "name": label,
                                     "created": time.time(), "files": entries})
            self._save(agent, data)
        return self.list(agent)

    def switch(self, agent: str, profile_id: str) -> dict[str, Any]:
        if agent not in GROUPS:
            raise ValueError("this agent has no account files")
        if not PROFILE_RE.fullmatch(str(profile_id or "")):
            raise ValueError("invalid profile id")
        with self.lock:
            data = self._load(agent)
            profile = next((item for item in data["profiles"]
                            if isinstance(item, dict) and item.get("id") == profile_id), None)
            if profile is None:
                raise ValueError("account profile not found")
            folder = self.root / agent / profile_id / "files"
            for entry in profile.get("files") or []:
                rel = str(entry.get("rel") or "")
                if not rel or rel.startswith("/") or ".." in rel.split("/"):
                    continue
                source = folder / rel
                if not source.is_file():
                    continue
                target = self.home / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                try:
                    os.chmod(target, 0o600)
                except OSError:
                    pass
        return self.list(agent)

    def delete(self, agent: str, profile_id: str) -> dict[str, Any]:
        if agent not in GROUPS:
            raise ValueError("this agent has no account files")
        if not PROFILE_RE.fullmatch(str(profile_id or "")):
            raise ValueError("invalid profile id")
        with self.lock:
            data = self._load(agent)
            data["profiles"] = [item for item in data["profiles"]
                                if not (isinstance(item, dict) and item.get("id") == profile_id)]
            self._save(agent, data)
            shutil.rmtree(self.root / agent / profile_id, ignore_errors=True)
        return self.list(agent)
