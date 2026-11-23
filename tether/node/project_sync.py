from __future__ import annotations

import json
import logging
import os
import threading
import time
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

LOG = logging.getLogger("tether.project_sync")

_SYNC_INTERVAL_SECONDS = 60.0
_SYNC_INITIAL_DELAY_SECONDS = 8.0
_HTTP_TIMEOUT_SECONDS = 5.0


def normalize_project_path(path: str) -> str:
    try:
        resolved = os.path.realpath(path)
    except OSError:
        resolved = path
    return os.path.normcase(resolved).replace("/", "\\").rstrip("\\")


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _post_codeg(port: int, token: str, route: str, body: dict | None) -> object:
    payload = json.dumps(body if body is not None else {}).encode("utf-8")
    request = Request(
        "http://127.0.0.1:%d/api%s" % (port, route if route.startswith("/") else "/" + route),
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
    )
    with build_opener().open(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8")) if raw else None


class DshClient:
    def __init__(self, descriptor: Path) -> None:
        self.descriptor = descriptor
        self.opener = None
        self.origin = ""

    def _authenticate(self) -> None:
        data = _read_json(self.descriptor)
        url = str(data.get("authenticated_url") or "")
        origin = str(data.get("origin") or "").rstrip("/")
        if not url or not origin:
            raise RuntimeError("dsh descriptor unavailable")
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        with self.opener.open(Request(url), timeout=_HTTP_TIMEOUT_SECONDS) as response:
            response.read()
        self.origin = origin

    def call(self, method: str, args: dict) -> object:
        if self.opener is None:
            self._authenticate()
        body = json.dumps({
            "type": "client-request",
            "rpcId": str(int(time.time() * 1000)),
            "method": method,
            "payload": {"args": args},
        }).encode("utf-8")
        request = Request(
            self.origin + "/api/" + method,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with self.opener.open(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:
            raw = response.read()
        result = (json.loads(raw.decode("utf-8")) or {}).get("result") or {}
        if result.get("ok") is False:
            raise RuntimeError(str(result.get("error") or "dsh rpc failed"))
        return result.get("value")


def _dsh_workspace_paths(dsh_home: Path) -> dict[str, str]:
    raw = _read_json(dsh_home / "storages" / "workspace.json")
    items = ((raw.get("tables") or {}).get("workspaces") or {}).values()
    out: dict[str, str] = {}
    for item in items:
        path = item.get("path") if isinstance(item, dict) else None
        if isinstance(path, str) and path:
            out[normalize_project_path(path)] = path
    return out


def _codeg_folder_paths(port: int, token: str) -> dict[str, str]:
    folders = _post_codeg(port, token, "/list_all_folder_details", None)
    out: dict[str, str] = {}
    for item in folders or []:
        if not isinstance(item, dict):
            continue
        if item.get("kind") == "chat" or item.get("deletedAt") or item.get("deleted_at"):
            continue
        path = item.get("path")
        if isinstance(path, str) and path:
            out[normalize_project_path(path)] = path
    return out


def sync_once(runtime, dsh_home: Path | None = None) -> tuple[int, int]:
    state = runtime._read_state()
    port = int(state.get("port") or 0)
    token = str(state.get("token") or "")
    if not port or not token or not state.get("pid"):
        return 0, 0
    try:
        codeg = _codeg_folder_paths(port, token)
    except Exception as exc:
        LOG.info("project sync: codeg folders unavailable: %s", exc)
        return 0, 0
    home = dsh_home or Path(os.environ.get("TETHER_NATIVE_DSH_HOME") or (Path.home() / ".dsh"))
    dsh_paths = _dsh_workspace_paths(home)
    dsh = DshClient(home / "storages" / "tether" / "native-surface.json")
    added_dsh = 0
    for key, path in codeg.items():
        if key in dsh_paths or not os.path.isdir(path):
            continue
        try:
            dsh.call("workspace/create", {"request": {"path": path}})
            added_dsh += 1
        except Exception as exc:
            LOG.info("project sync: dsh workspace create failed for %s: %s", path, exc)
    added_codeg = 0
    for key, path in dsh_paths.items():
        if key in codeg or not os.path.isdir(path):
            continue
        try:
            _post_codeg(port, token, "/open_folder", {"path": path})
            added_codeg += 1
        except Exception as exc:
            LOG.info("project sync: codeg folder open failed for %s: %s", path, exc)
    if added_dsh or added_codeg:
        LOG.info("project sync: dsh+%d codeg+%d", added_dsh, added_codeg)
    return added_dsh, added_codeg


_started = False


def start(runtime, interval: float = _SYNC_INTERVAL_SECONDS) -> None:
    global _started
    if _started:
        return
    _started = True

    def loop() -> None:
        time.sleep(_SYNC_INITIAL_DELAY_SECONDS)
        while True:
            try:
                sync_once(runtime)
            except Exception as exc:
                LOG.info("project sync tick failed: %s", exc)
            time.sleep(interval)

    threading.Thread(target=loop, name="tether-project-sync", daemon=True).start()