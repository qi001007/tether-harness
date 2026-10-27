"""Authenticated, same-host access to the native DSH desktop web surface."""

from __future__ import annotations

import asyncio
import base64
import gzip
import http.cookiejar
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
import uuid
import threading
from pathlib import Path
from typing import Any

import websockets
import psutil

MAX_BODY = 8 * 1024 * 1024
MAX_FRAME = 8 * 1024 * 1024
TIMEOUT = 20
ALLOWED_RESPONSE_HEADERS = {
    "content-type", "cache-control", "content-disposition", "etag", "content-encoding",
    "last-modified", "expires", "vary", "x-content-type-options",
}
ALLOWED_REQUEST_HEADERS = {"content-type", "accept"}
NATIVE_SURFACE_STYLE = (
    b'<style id="tether-native-surface">'
    b'[class*="sidebarCol"]{border-right:0!important}'
    b'</style>'
)


def polish_native_html(payload: bytes, headers: dict[str, str]) -> tuple[bytes, dict[str, str]]:
    content_type = headers.get("content-type", "").lower()
    if "text/html" not in content_type:
        return payload, headers
    encoding = headers.get("content-encoding", "").lower()
    if encoding == "gzip":
        try:
            payload = gzip.decompress(payload)
        except OSError:
            return payload, headers
        if len(payload) > MAX_BODY:
            raise NativeSurfaceError("native DSH response too large", "too_large")
        headers = {key: value for key, value in headers.items() if key != "content-encoding"}
    elif encoding not in {"", "identity"}:
        return payload, headers
    closing = payload.lower().find(b"</head>")
    if closing < 0:
        return payload, headers
    payload = payload[:closing] + NATIVE_SURFACE_STYLE + payload[closing:]
    headers = {key: value for key, value in headers.items()
               if key not in {"etag", "last-modified", "expires"}}
    headers["cache-control"] = "no-store"
    return payload, headers


class NativeSurfaceError(Exception):
    def __init__(self, message: str, code: str = "surface_error") -> None:
        super().__init__(message)
        self.code = code


class NativeSurface:
    def __init__(self, home: Path) -> None:
        self.home = Path(home)
        self.descriptor = self.home / "storages" / "tether" / "native-surface.json"
        self._snapshot: tuple[int, int, str] | None = None
        self._origin = ""
        self._auth_url = ""
        self._reason = "descriptor_missing"
        self._profile: str | None = None
        self._pid: int | None = None
        self._jar = http.cookiejar.CookieJar()
        self._authenticated = False
        self._auth_lock = threading.Lock()
        self._channels: dict[str, Any] = {}
        self._pending_channels = 0
        self._lock = asyncio.Lock()

    def _load(self) -> bool:
        try:
            stat = self.descriptor.stat()
            data = json.loads(self.descriptor.read_text(encoding="utf-8"))
        except FileNotFoundError:
            self._reason = "descriptor_missing"
            self._clear()
            return False
        except (OSError, ValueError):
            self._reason = "descriptor_invalid"
            self._clear()
            return False
        origin, auth = data.get("origin"), data.get("authenticated_url")
        if data.get("version") != 1 or not isinstance(origin, str) or not isinstance(auth, str):
            self._clear()
            return False
        try:
            parsed = urllib.parse.urlsplit(origin)
            auth_parsed = urllib.parse.urlsplit(auth)
            port = parsed.port
            auth_port = auth_parsed.port
            valid_host = parsed.hostname in ("127.0.0.1", "::1")
            if (parsed.scheme != "http" or not valid_host or port is None or not 1 <= port <= 65535
                    or parsed.username or parsed.password or parsed.path not in ("", "/")
                    or parsed.query or parsed.fragment):
                raise ValueError
            if (auth_parsed.scheme != "http" or auth_parsed.hostname != parsed.hostname
                    or auth_port != port or auth_parsed.username or auth_parsed.password
                    or auth_parsed.fragment):
                raise ValueError
            if not auth_parsed.path.startswith("/") or "\r" in auth or "\n" in auth:
                raise ValueError
        except (ValueError, TypeError):
            self._reason = "descriptor_invalid"
            self._clear()
            return False
        snapshot = (stat.st_mtime_ns, stat.st_size, origin)
        if self._snapshot is not None and snapshot != self._snapshot:
            self._reset_auth()
            self._close_channels()
        self._snapshot, self._origin, self._auth_url = snapshot, origin.rstrip("/"), auth
        profile, pid = data.get("profile"), data.get("pid")
        self._profile = profile if isinstance(profile, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", profile) else None
        self._pid = pid if type(pid) is int and 0 < pid <= 2_147_483_647 else None
        self._reason = "ready"
        return True

    def _reset_auth(self) -> None:
        # Replace the jar atomically; in-flight openers retain the old jar object.
        self._jar = http.cookiejar.CookieJar()
        self._authenticated = False

    def _close_channels(self) -> None:
        # Synchronous invalidation; sockets are closed asynchronously by dispose/call.
        self._stale_channels = getattr(self, "_stale_channels", []) + list(self._channels.values())
        self._channels.clear()

    def _clear(self) -> None:
        self._snapshot = None
        self._origin = self._auth_url = ""
        self._profile = None
        self._pid = None
        self._reset_auth()
        self._close_channels()

    def _profile_from_host_argv(self) -> str | None:
        """Infer the profile from the live DSH desktop host when the descriptor omits it."""
        try:
            profiles = (self.home / "profiles").resolve()
        except OSError:
            return None
        try:
            processes = psutil.process_iter(["cmdline"])
        except Exception:
            return None
        for process in processes:
            try:
                cmdline = process.info.get("cmdline") or []
            except (psutil.Error, OSError):
                continue
            if not any(isinstance(arg, str) and "dsh-desktop-host" in arg for arg in cmdline):
                continue
            for arg in cmdline:
                if not isinstance(arg, str) or not arg:
                    continue
                try:
                    candidate = Path(arg)
                    if not candidate.is_absolute():
                        continue
                    resolved = candidate.resolve()
                except (OSError, ValueError):
                    continue
                if resolved.parent != profiles:
                    continue
                if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", resolved.name):
                    return resolved.name
        return None

    def active_profile(self) -> str | None:
        """Return the profile published by the live DSH Host companion, if known."""
        try:
            loaded = self._load()
        except Exception:
            self._clear()
            loaded = False
        if loaded and self._profile and self._pid is not None:
            try:
                if psutil.pid_exists(self._pid):
                    return self._profile
            except (OSError, ValueError):
                pass
        return self._profile_from_host_argv()

    def available(self) -> bool:
        return self._load()

    def _reachable(self) -> bool:
        try:
            parsed = urllib.parse.urlsplit(self._origin)
            with socket.create_connection((parsed.hostname or "", parsed.port or 80), timeout=1.0):
                return True
        except (OSError, ValueError):
            return False

    def status(self) -> dict[str, Any]:
        if not self._load():
            return {"available": False, "reason": self._reason}
        if not self._reachable():
            return {"available": False, "reason": "host_unreachable"}
        return {"available": True, "reason": "ready"}

    def _target(self, path: Any, *, websocket: bool = False, origin: str | None = None) -> str:
        origin = origin or self._origin
        if not origin:
            raise NativeSurfaceError("native DSH surface unavailable", "unavailable")
        if not isinstance(path, str) or not path.startswith("/") or path.startswith("//"):
            raise NativeSurfaceError("invalid surface path", "bad_path")
        if "\\" in path or "\r" in path or "\n" in path or "#" in path:
            raise NativeSurfaceError("invalid surface path", "bad_path")
        parsed = urllib.parse.urlsplit(path)
        decoded_path = urllib.parse.unquote(parsed.path)
        if ("\\" in decoded_path or "\r" in parsed.query or "\n" in parsed.query
                or any(part == ".." for part in decoded_path.split("/")) or "//" in decoded_path):
            raise NativeSurfaceError("invalid surface path", "bad_path")
        if parsed.scheme or parsed.netloc:
            raise NativeSurfaceError("invalid surface path", "bad_path")
        if websocket and parsed.path != "/api/remote.mux":
            raise NativeSurfaceError("unsupported websocket path", "bad_path")
        return origin + path

    def _ensure_authenticated(self) -> None:
        with self._auth_lock:
            self._jar.clear_expired_cookies()
            if self._authenticated and len(self._jar):
                return
            request = urllib.request.Request(self._auth_url, headers={"Accept": "text/html"})
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar), _NoRedirect())
            try:
                with opener.open(request, timeout=TIMEOUT) as response:
                    response.read(1024)
            except urllib.error.HTTPError as exc:
                if exc.code not in (301, 302, 303, 307, 308):
                    raise NativeSurfaceError("native DSH authentication failed", "auth_failed") from None
            except Exception:
                raise NativeSurfaceError("native DSH authentication failed", "auth_failed") from None
            if not len(self._jar):
                raise NativeSurfaceError("native DSH authentication failed", "auth_failed")
            self._authenticated = True

    def _cookie_header(self) -> str:
        with self._auth_lock:
            self._jar.clear_expired_cookies()
            return "; ".join(f"{cookie.name}={cookie.value}" for cookie in self._jar)

    async def call(self, op: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
        args = args or {}
        async with self._lock:
            self._load()
            stale = getattr(self, "_stale_channels", [])
            self._stale_channels = []
            await self._close_many(stale)
            if op == "status":
                return {"available": bool(self._snapshot)}
            if not self._snapshot:
                raise NativeSurfaceError("native DSH surface unavailable", "unavailable")
            if op == "http":
                url = self._target(args.get("path"), origin=self._origin)
            elif op == "ws_open":
                if len(self._channels) + self._pending_channels >= 8:
                    raise NativeSurfaceError("too many websocket channels", "capacity")
                self._pending_channels += 1
                url = self._target(args.get("path"), websocket=True, origin=self._origin)
            elif op not in {"ws_send", "ws_receive", "ws_close"}:
                raise NativeSurfaceError("unknown surface operation", "bad_op")
        if op == "http":
            return await asyncio.to_thread(self._http, args, url, self._origin)
        if op == "ws_open":
            try:
                return await self._ws_open(args, url, self._origin)
            finally:
                async with self._lock:
                    self._pending_channels -= 1
        if op == "ws_send":
            return await self._ws_send(args)
        if op == "ws_receive":
            return await self._ws_receive(args)
        if op == "ws_close":
            return await self._ws_close(args)
        raise NativeSurfaceError("unknown surface operation", "bad_op")

    def _http(self, args: dict[str, Any], url: str | None = None, origin: str | None = None) -> dict[str, Any]:
        method = str(args.get("method") or "GET").upper()
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}:
            raise NativeSurfaceError("unsupported HTTP method", "bad_method")
        url = url or self._target(args.get("path"), origin=origin)
        origin = origin or self._origin
        headers = args.get("headers") or {}
        if not isinstance(headers, dict):
            raise NativeSurfaceError("invalid headers", "bad_headers")
        clean = {}
        for key, value in headers.items():
            if str(key).lower() not in ALLOWED_REQUEST_HEADERS or not isinstance(value, str):
                continue
            if "\r" in value or "\n" in value:
                raise NativeSurfaceError("invalid header value", "bad_headers")
            clean[str(key).lower()] = value
        raw = args.get("body_base64")
        try:
            body = base64.b64decode(raw, validate=True) if raw is not None else None
        except Exception:
            raise NativeSurfaceError("invalid request body", "bad_body") from None
        if body is not None and len(body) > MAX_BODY:
            raise NativeSurfaceError("request body too large", "too_large")
        self._ensure_authenticated()
        cookie = self._cookie_header()
        if cookie:
            clean["cookie"] = cookie
        clean["origin"] = origin
        clean["sec-fetch-site"] = "same-origin"
        clean["accept-encoding"] = "gzip"
        request = urllib.request.Request(url, data=body, headers=clean, method=method)
        opener = urllib.request.build_opener(_NoRedirect())
        try:
            response = opener.open(request, timeout=TIMEOUT)
        except urllib.error.HTTPError as exc:
            response = exc
        except Exception as exc:
            raise NativeSurfaceError("native DSH request failed", "upstream_error") from None
        with response:
            payload = response.read(MAX_BODY + 1)
            if len(payload) > MAX_BODY:
                raise NativeSurfaceError("native DSH response too large", "too_large")
            result_headers = {k.lower(): v for k, v in response.headers.items()
                              if k.lower() in ALLOWED_RESPONSE_HEADERS and "\r" not in v and "\n" not in v}
            payload, result_headers = polish_native_html(payload, result_headers)
            return {"status": response.code, "headers": result_headers,
                    "body_base64": base64.b64encode(payload).decode("ascii")}

    async def _ws_open(self, args: dict[str, Any], url: str, origin: str) -> dict[str, Any]:
        await asyncio.to_thread(self._ensure_authenticated)
        cookie = self._cookie_header()
        headers = {"Origin": origin, "Sec-Fetch-Site": "same-origin"}
        if cookie:
            headers["Cookie"] = cookie
        try:
            ws = await websockets.connect(url.replace("http://", "ws://", 1), extra_headers=headers,
                                         open_timeout=TIMEOUT, close_timeout=TIMEOUT, max_size=MAX_FRAME)
        except TypeError:
            # websockets >=14 renamed extra_headers.
            try:
                ws = await websockets.connect(url.replace("http://", "ws://", 1), additional_headers=headers,
                                             open_timeout=TIMEOUT, close_timeout=TIMEOUT, max_size=MAX_FRAME)
            except Exception:
                raise NativeSurfaceError("native DSH websocket failed", "upstream_error") from None
        except Exception:
            raise NativeSurfaceError("native DSH websocket failed", "upstream_error") from None
        channel = uuid.uuid4().hex
        async with self._lock:
            self._channels[channel] = ws
        return {"channel": channel}

    def _get_channel(self, args: dict[str, Any]) -> Any:
        channel = args.get("channel")
        ws = self._channels.get(channel) if isinstance(channel, str) else None
        if ws is None:
            raise NativeSurfaceError("websocket channel closed", "closed")
        return ws

    async def _ws_send(self, args: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            ws = self._get_channel(args)
        kind, data = args.get("kind"), args.get("data")
        try:
            if kind == "text" and isinstance(data, str):
                if len(data.encode("utf-8")) > MAX_FRAME:
                    raise NativeSurfaceError("websocket frame too large", "too_large")
                await ws.send(data)
            elif kind == "binary" and isinstance(data, str):
                raw = base64.b64decode(data, validate=True)
                if len(raw) > MAX_FRAME:
                    raise NativeSurfaceError("websocket frame too large", "too_large")
                await ws.send(raw)
            else:
                raise NativeSurfaceError("invalid websocket frame", "bad_frame")
            return {"ok": True}
        except NativeSurfaceError:
            raise
        except Exception:
            async with self._lock:
                self._channels.pop(args.get("channel"), None)
            raise NativeSurfaceError("websocket channel closed", "closed") from None

    async def _ws_receive(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            async with self._lock:
                ws = self._get_channel(args)
        except NativeSurfaceError as exc:
            if exc.code == "closed":
                return {"kind": "closed"}
            raise
        try:
            frame = await asyncio.wait_for(ws.recv(), timeout=TIMEOUT)
        except asyncio.TimeoutError:
            return {"kind": "idle"}
        except Exception:
            async with self._lock:
                self._channels.pop(args.get("channel"), None)
            return {"kind": "closed"}
        if isinstance(frame, str):
            if len(frame.encode("utf-8")) > MAX_FRAME:
                raise NativeSurfaceError("websocket frame too large", "too_large")
            return {"kind": "text", "data": frame}
        if len(frame) > MAX_FRAME:
            raise NativeSurfaceError("websocket frame too large", "too_large")
        return {"kind": "binary", "data": base64.b64encode(frame).decode("ascii")}

    async def _ws_close(self, args: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            ws = self._channels.pop(args.get("channel"), None)
        if ws is not None:
            await ws.close()
        return {"ok": True}

    async def _close_many(self, sockets: list[Any]) -> None:
        for socket in sockets:
            try:
                await socket.close()
            except Exception:
                pass

    async def dispose(self) -> None:
        async with self._lock:
            sockets = list(self._channels.values()) + getattr(self, "_stale_channels", [])
            self._channels.clear()
            self._stale_channels = []
            await self._close_many(sockets)
            self._reset_auth()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None
