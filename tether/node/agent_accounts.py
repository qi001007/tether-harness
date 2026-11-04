"""Per-agent account profiles: native login, switching and usage probes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from . import codex_accounts

MAX_FILE = 2 * 1024 * 1024
PROFILE_RE = re.compile(r"^[a-z0-9]{8,32}$")

GROUPS: dict[str, tuple[str, ...]] = {
    "codex": (".codex/auth.json", ".codex/config.toml"),
    "claude": (".claude/settings.json", ".claude/.credentials.json"),
    "gemini": (".gemini/settings.json", ".gemini/oauth_creds.json", ".gemini/google_accounts.json"),
    "opencode": (".local/share/opencode/auth.json", "AppData/Roaming/opencode/auth.json",
                 "AppData/Local/opencode/auth.json"),
    "qoder": (".qoder/config.json", ".qoder/settings.json"),
    "dsh": (".dsh/.credentials.yaml",),
}

LOGIN_COMMANDS = {
    "opencode": "opencode auth login",
    "qoder": "qoder",
    "gemini": "gemini",
    "claude": "claude",
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


def _secure_dir(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
        os.chmod(path, 0o700)
    except OSError:
        pass


def _secure_file(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


class AgentAccounts:
    def __init__(self, data_dir: Path, home: Path | None = None) -> None:
        self.root = Path(data_dir) / "agent-accounts"
        self.home = Path(home or Path.home())
        self.lock = threading.Lock()
        self.logins: dict[str, dict[str, Any]] = {}
        self.usages: dict[str, dict[str, Any]] = {}

    def supports(self, agent: str) -> bool:
        return agent in GROUPS

    def title(self, agent: str) -> str:
        return "ChatGPT (Codex OAuth)" if agent == "codex" else "账号"

    def login_command(self, agent: str) -> str:
        return LOGIN_COMMANDS.get(agent, "")

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
        _secure_file(temp)
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
        result = {}
        for rel, path in self._present(agent):
            try:
                result[rel] = _sha(path)
            except OSError:
                continue
        return result

    @staticmethod
    def _profile_home(root: Path, agent: str, profile_id: str) -> Path:
        return root / agent / profile_id / ("home" if agent == "codex" else "files")

    def _stored_map(self, item: dict[str, Any]) -> dict[str, str]:
        return {entry.get("rel"): entry.get("sha256") for entry in item.get("files") or []
                if isinstance(entry, dict)}

    def _make_profile(self, agent: str, label: str) -> tuple[str, Path]:
        profile_id = hashlib.sha256((label + str(time.time())).encode()).hexdigest()[:12]
        folder = self.root / agent / profile_id
        _secure_dir(folder)
        home = self._profile_home(self.root, agent, profile_id)
        _secure_dir(home)
        return profile_id, home

    def _entries_codex(self, home: Path) -> list[dict[str, Any]]:
        entries = []
        for name, rel in (("auth.json", ".codex/auth.json"), ("config.toml", ".codex/config.toml")):
            path = home / name
            try:
                if path.is_file() and path.stat().st_size <= MAX_FILE:
                    entries.append({"rel": rel, "sha256": _sha(path), "size": path.stat().st_size})
            except OSError:
                continue
        return entries

    def _copy_codex_live_to(self, target: Path) -> list[dict[str, Any]]:
        source = self.home / ".codex"
        _secure_dir(target)
        entries = []
        for name, rel in (("auth.json", ".codex/auth.json"), ("config.toml", ".codex/config.toml")):
            src = source / name
            if not src.is_file() or src.stat().st_size > MAX_FILE:
                continue
            dst = target / name
            shutil.copy2(src, dst)
            _secure_file(dst)
            entries.append({"rel": rel, "sha256": _sha(dst), "size": dst.stat().st_size})
        if not (target / "config.toml").is_file() and (source / "config.toml").is_file():
            shutil.copy2(source / "config.toml", target / "config.toml")
        return entries

    def _copy_codex_profile_to_live(self, home: Path) -> None:
        target = self.home / ".codex"
        _secure_dir(target)
        for name in ("auth.json", "config.toml"):
            src = home / name
            if src.is_file() and src.stat().st_size <= MAX_FILE:
                shutil.copy2(src, target / name)
                _secure_file(target / name)

    def _import_live_codex(self, data: dict[str, Any]) -> None:
        if data["profiles"]:
            return
        if not (self.home / ".codex" / "auth.json").is_file():
            return
        info = codex_accounts.identity(self.home / ".codex")
        label = info.get("email") or "默认账号"
        profile_id, home = self._make_profile("codex", label)
        entries = self._copy_codex_live_to(home)
        data["profiles"].append({
            "id": profile_id, "name": label, "email": info.get("email", ""),
            "plan": info.get("plan", ""), "created": time.time(), "updated": time.time(),
            "files": entries, "usage": {},
        })
        data["active"] = profile_id
        data["imported"] = True
        self._save("codex", data)

    def _import_live_generic(self, agent: str, data: dict[str, Any]) -> None:
        present = self._present(agent)
        if not present:
            return
        profile_id = hashlib.sha256((agent + str(time.time())).encode()).hexdigest()[:12]
        folder = self.root / agent / profile_id / "files"
        entries = []
        for rel, path in present:
            target = folder / rel
            _secure_dir(target.parent)
            shutil.copy2(path, target)
            _secure_file(target)
            entries.append({"rel": rel, "sha256": _sha(path), "size": path.stat().st_size})
        data["profiles"].append({"id": profile_id, "name": "默认账号",
                                 "created": time.time(), "files": entries})
        data["active"] = profile_id
        data["imported"] = True
        self._save(agent, data)

    def _probe_codex(self, home: Path) -> dict[str, Any]:
        key = str(home)
        cached = self.usages.get(key)
        if cached and time.time() - float(cached.get("checkedAt") or 0) < 90:
            return cached
        result = codex_accounts.probe(home)
        self.usages[key] = result
        return result

    def _profile_view(self, agent: str, item: dict[str, Any], index: int, probes: dict[int, dict[str, Any]],
                      live_fp: dict[str, str], live_info: dict[str, Any], active: str) -> dict[str, Any]:
        profile_id = str(item.get("id") or "")
        home = self._profile_home(self.root, agent, profile_id)
        stored = self._stored_map(item)
        email = str(item.get("email") or "")
        plan = str(item.get("plan") or "")
        usage = item.get("usage") if isinstance(item.get("usage"), dict) else {}
        info: dict[str, Any] = {}
        if agent == "codex":
            info = codex_accounts.identity(home) if home.is_dir() else {}
            email = info.get("email") or email
            plan = info.get("plan") or plan
            probe = probes.get(index)
            if probe:
                if probe.get("loggedIn"):
                    email = probe.get("email") or email
                    plan = probe.get("plan") or plan
                    usage = probe.get("usage") or usage
                elif probe.get("error") and not usage:
                    usage = {}
        current = False
        if agent == "codex" and live_info.get("account_id"):
            current = bool(info.get("account_id")) and info.get("account_id") == live_info.get("account_id")
            if not current and not info.get("account_id"):
                current = bool(email) and email == live_info.get("email")
        if not current and stored and live_fp:
            current = all(live_fp.get(rel) == sha for rel, sha in stored.items())
        return {
            "id": profile_id, "name": item.get("name") or email or profile_id,
            "email": email, "plan": plan, "current": current,
            "created": item.get("created"), "updated": item.get("updated"),
            "files": len(stored), "usage": usage if agent == "codex" else {},
            "active": profile_id == active,
        }

    def list(self, agent: str, fresh: bool = False) -> dict[str, Any]:
        if agent not in GROUPS:
            raise ValueError("this agent has no account files")
        data = self._load(agent)
        if agent == "codex":
            self._import_live_codex(data)
            data = self._load(agent)
        elif not data["profiles"] and not data.get("imported"):
            self._import_live_generic(agent, data)
            data = self._load(agent)
        live_fp = self._fingerprint(agent)
        live_info = codex_accounts.identity(self.home / ".codex") if agent == "codex" else {}
        items = [item for item in data["profiles"] if isinstance(item, dict)]
        probes: dict[int, dict[str, Any]] = {}
        if agent == "codex":
            pending = []
            for index, item in enumerate(items):
                home = self._profile_home(self.root, agent, str(item.get("id") or ""))
                if not (home / "auth.json").is_file():
                    continue
                usage = item.get("usage") if isinstance(item.get("usage"), dict) else {}
                if usage.get("checkedAt") and time.time() - float(usage["checkedAt"]) < 90:
                    continue
                pending.append((index, home))
            if pending and fresh:
                with ThreadPoolExecutor(max_workers=3) as pool:
                    futures = {index: pool.submit(self._probe_codex, home) for index, home in pending}
                    for index, future in futures.items():
                        try:
                            probes[index] = future.result(timeout=15)
                        except Exception:
                            probes[index] = {}
        views = [self._profile_view(agent, item, index, probes, live_fp, live_info, str(data.get("active") or ""))
                 for index, item in enumerate(items)]
        current = [view for view in views if view["current"]]
        if len(current) > 1:
            preferred = next((view for view in current if view["id"] == str(data.get("active") or "")), None)
            chosen = preferred or max(current, key=lambda view: view.get("created") or 0)
            for view in views:
                view["current"] = view["id"] == chosen["id"]
        views.sort(key=lambda view: (not view["current"], -(view.get("created") or 0)))
        if agent == "codex":
            with self.lock:
                fresh = self._load(agent)
                for view in views:
                    for item in fresh["profiles"]:
                        if isinstance(item, dict) and item.get("id") == view["id"]:
                            item["email"] = view["email"] or item.get("email") or ""
                            item["plan"] = view["plan"] or item.get("plan") or ""
                            if view["usage"]:
                                item["usage"] = view["usage"]
                                item["updated"] = time.time()
                self._save(agent, fresh)
        return {
            "agent": agent, "title": self.title(agent), "profiles": views,
            "live": sorted(live_fp.keys()), "root": str(self.root / agent),
            "loginMode": "device" if agent == "codex" else ("command" if self.login_command(agent) else "snapshot"),
            "loginCommand": self.login_command(agent),
        }

    def save(self, agent: str, name: str) -> dict[str, Any]:
        if agent not in GROUPS:
            raise ValueError("this agent has no account files")
        label = str(name or "").strip()[:60]
        if not label:
            if agent == "codex":
                label = str(codex_accounts.identity(self.home / ".codex").get("email") or "")
                if not label:
                    raise ValueError("account name is required")
            else:
                label = "默认账号"
        with self.lock:
            present = self._present(agent)
            if not present:
                raise ValueError("no account files found on this node")
            data = self._load(agent)
            data["profiles"] = [item for item in data["profiles"] if isinstance(item, dict)]
            if agent == "codex":
                info = codex_accounts.identity(self.home / ".codex")
                duplicate = any(info.get("account_id") and item.get("email") == info.get("email")
                                for item in data["profiles"])
                if not duplicate:
                    profile_id, home = self._make_profile("codex", label or info.get("email") or "默认账号")
                    entries = self._copy_codex_live_to(home)
                    data["profiles"].append({
                        "id": profile_id, "name": label or info.get("email") or "默认账号",
                        "email": info.get("email", ""), "plan": info.get("plan", ""),
                        "created": time.time(), "updated": time.time(), "files": entries, "usage": {},
                    })
                    data["active"] = profile_id
                    data["imported"] = True
                    self._save(agent, data)
            else:
                live = self._fingerprint(agent)
                duplicate = any(self._stored_map(item) and self._stored_map(item) == live for item in data["profiles"])
                if not duplicate:
                    profile_id = hashlib.sha256((label + str(time.time())).encode()).hexdigest()[:12]
                    folder = self.root / agent / profile_id / "files"
                    entries = []
                    for rel, path in present:
                        target = folder / rel
                        _secure_dir(target.parent)
                        shutil.copy2(path, target)
                        _secure_file(target)
                        entries.append({"rel": rel, "sha256": _sha(path), "size": path.stat().st_size})
                    data["profiles"].append({"id": profile_id, "name": label or "默认账号",
                                             "created": time.time(), "files": entries})
                    data["active"] = profile_id
                    data["imported"] = True
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
            if agent == "codex":
                home = self._profile_home(self.root, agent, profile_id)
                self._copy_codex_profile_to_live(home)
            else:
                folder = self.root / agent / profile_id / "files"
                for entry in profile.get("files") or []:
                    rel = str(entry.get("rel") or "")
                    if not rel or rel.startswith("/") or ".." in rel.split("/"):
                        continue
                    source = folder / rel
                    if not source.is_file():
                        continue
                    target = self.home / rel
                    _secure_dir(target.parent)
                    shutil.copy2(source, target)
                    _secure_file(target)
            data["active"] = profile_id
            self._save(agent, data)
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
            if data.get("active") == profile_id:
                data.pop("active", None)
            self._save(agent, data)
            shutil.rmtree(self.root / agent / profile_id, ignore_errors=True)
        return self.list(agent)

    def login_start(self, agent: str, profile_id: str = "", executable: str = "") -> dict[str, Any]:
        if agent != "codex":
            command = self.login_command(agent)
            if command and executable:
                rest = command.split(" ", 1)
                exe = '"' + executable + '"' if " " in executable else executable
                command = exe + ((" " + rest[1]) if len(rest) > 1 else "")
            if not command:
                return {"mode": "snapshot", "title": self.title(agent),
                        "hint": "先在该 Agent 完成登录，再点保存当前"}
            parts = command.split(" ", 1) if command else []
            argv = ([executable] if executable else []) + ((parts[1].split() if len(parts) > 1 else []))
            return {"mode": "command", "command": command, "argv": argv, "title": self.title(agent),
                    "hint": "在终端完成登录后返回这里保存当前账号"}
        with self.lock:
            data = self._load(agent)
            target = next((item for item in data["profiles"]
                           if isinstance(item, dict) and item.get("id") == profile_id), None)
            if target is None and profile_id:
                raise ValueError("account profile not found")
            if target is None:
                profile_id, home = self._make_profile("codex", "新账号")
                config = self.home / ".codex" / "config.toml"
                if config.is_file():
                    shutil.copy2(config, home / "config.toml")
                    _secure_file(home / "config.toml")
            else:
                home = self._profile_home(self.root, agent, profile_id)
        server = codex_accounts.CodexAppServer(home)
        try:
            server.initialize()
            result = server.login_start()
        except Exception:
            server.close()
            raise
        login_id = str(result.get("loginId") or "")
        if not login_id:
            server.close()
            raise RuntimeError("Codex did not return a login id")
        session = {
            "loginId": login_id, "status": "pending", "url": result.get("verificationUrl") or "",
            "code": result.get("userCode") or "", "profileId": profile_id,
            "created": time.time(), "server": server,
        }
        self.logins[login_id] = session
        threading.Thread(target=self._wait_login, args=(login_id, profile_id, home, server), daemon=True).start()
        return {"mode": "device", **{key: session[key] for key in ("loginId", "status", "url", "code", "profileId")}}

    def _wait_login(self, login_id: str, profile_id: str, home: Path, server: codex_accounts.CodexAppServer) -> None:
        session = self.logins.get(login_id)
        try:
            event = server.wait_notification("account/login/completed", 300)
            if not event or not event.get("success"):
                if session is not None:
                    session["status"] = "error"
                    session["error"] = str((event or {}).get("error") or "登录未完成")
                return
            read = server.account_read()
            account = read.get("account") if isinstance(read.get("account"), dict) else {}
            usage = {}
            try:
                usage = codex_accounts.normalize_usage(server.rate_limits())
            except Exception:
                usage = {}
            info = codex_accounts.identity(home)
            email = str(account.get("email") or info.get("email") or "")
            plan = str(account.get("planType") or info.get("plan") or "")
            entries = self._entries_codex(home)
            with self.lock:
                data = self._load("codex")
                item = next((entry for entry in data["profiles"]
                             if isinstance(entry, dict) and entry.get("id") == profile_id), None)
                if item is None:
                    data["profiles"].append({
                        "id": profile_id, "name": email or "新账号", "email": email, "plan": plan,
                        "created": time.time(), "updated": time.time(), "files": entries, "usage": usage,
                    })
                else:
                    item.update({"name": email or item.get("name") or "新账号", "email": email,
                                 "plan": plan, "updated": time.time(), "files": entries, "usage": usage})
                data["active"] = profile_id
                self._save("codex", data)
            if session is not None:
                session["status"] = "success"
                session["email"] = email
                session["plan"] = plan
        except Exception as exc:
            if session is not None:
                session["status"] = "error"
                session["error"] = str(exc)[:200]
        finally:
            server.close()

    def login_status(self, login_id: str) -> dict[str, Any]:
        session = self.logins.get(str(login_id or ""))
        if not session:
            return {"status": "unknown"}
        return {key: session[key] for key in ("loginId", "status", "url", "code", "profileId", "email", "plan", "error")
                if key in session}

    def login_cancel(self, login_id: str) -> dict[str, Any]:
        session = self.logins.get(str(login_id or ""))
        if not session:
            return {"status": "unknown"}
        server = session.get("server")
        if isinstance(server, codex_accounts.CodexAppServer):
            server.login_cancel(str(session.get("loginId") or ""))
            server.close()
        session["status"] = "cancelled"
        return self.login_status(login_id)

    def logout(self, agent: str) -> dict[str, Any]:
        if agent != "codex":
            raise ValueError("native logout is only available for Codex")
        server = codex_accounts.CodexAppServer(self.home / ".codex")
        try:
            server.initialize()
            server.logout()
        finally:
            server.close()
        with self.lock:
            data = self._load(agent)
            data.pop("active", None)
            self._save(agent, data)
        return self.list(agent)

    def probe(self, agent: str, profile_id: str = "") -> dict[str, Any]:
        if agent != "codex":
            return {"loggedIn": bool(self._fingerprint(agent))}
        home = self._profile_home(self.root, agent, profile_id) if profile_id else self.home / ".codex"
        result = codex_accounts.probe(home)
        if profile_id:
            with self.lock:
                data = self._load(agent)
                for item in data["profiles"]:
                    if isinstance(item, dict) and item.get("id") == profile_id:
                        item["email"] = result.get("email") or item.get("email") or ""
                        item["plan"] = result.get("plan") or item.get("plan") or ""
                        item["usage"] = result.get("usage") or item.get("usage") or {}
                        item["updated"] = time.time()
                self._save(agent, data)
        return result
