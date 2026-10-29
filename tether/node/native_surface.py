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
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import websockets
import psutil

MAX_BODY = 8 * 1024 * 1024
MAX_FRAME = 8 * 1024 * 1024
TIMEOUT = 20
MAX_HTTP_STREAMS = 8
HTTP_STREAM_CHUNK = 48 * 1024
HTTP_STREAM_QUEUE = 4
HTTP_STREAM_POLL = 1.0
HTTP_STREAM_IDLE_TTL = 90.0
HTTP_STREAM_WATCHDOG_POLL = 1.0
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


@dataclass
class _HttpStream:
    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    chunked: bool = False
    content_remaining: int | None = None
    current_chunk_remaining: int = 0
    last_access: float = field(default_factory=time.monotonic)
    chunks: asyncio.Queue[tuple[str, bytes | None]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=HTTP_STREAM_QUEUE))
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    pump: asyncio.Task | None = None
    watchdog: asyncio.Task | None = None


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
        self._updated_at: float | None = None
        self._jar = http.cookiejar.CookieJar()
        self._authenticated = False
        self._auth_lock = threading.Lock()
        self._channels: dict[str, Any] = {}
        self._pending_channels = 0
        self._http_streams: dict[str, _HttpStream] = {}
        self._pending_http_streams = 0
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
            self._close_http_streams()
        self._snapshot, self._origin, self._auth_url = snapshot, origin.rstrip("/"), auth
        profile, pid = data.get("profile"), data.get("pid")
        self._profile = profile if isinstance(profile, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", profile) else None
        self._pid = pid if type(pid) is int and 0 < pid <= 2_147_483_647 else None
        updated_at = data.get("updated_at")
        self._updated_at = float(updated_at) if isinstance(updated_at, (int, float)) and updated_at > 0 else None
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
        self._updated_at = None
        self._reset_auth()
        self._close_channels()
        self._close_http_streams()

    def _close_http_streams(self) -> None:
        streams, self._http_streams = list(self._http_streams.values()), {}
        for state in streams:
            state.stop.set()
            for task in (state.pump, state.watchdog):
                if task is not None and not task.done():
                    task.cancel()
            state.writer.close()

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

    def descriptor_info(self) -> dict[str, Any]:
        """Identity of the live DSH host, used by the UI to reload after a restart."""
        if not self.status().get("available"):
            return {}
        info: dict[str, Any] = {}
        if self._pid is not None:
            info["pid"] = self._pid
        if self._updated_at is not None:
            info["updated_at"] = self._updated_at
        return info

    def local_url(self) -> str | None:
        """Same-host authenticated DSH URL, for the APP's zero-WAN-hop path."""
        if not self.status().get("available"):
            return None
        return self._auth_url or None

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
            elif op == "http_stream_open":
                url = self._target(args.get("path"), origin=self._origin)
                if (str(args.get("method") or "GET").upper() != "GET"
                        or urllib.parse.urlsplit(url).path != "/plugins/events"):
                    raise NativeSurfaceError("unsupported HTTP stream", "bad_path")
                now = time.monotonic()
                expired = [key for key, state in self._http_streams.items()
                           if now - state.last_access > HTTP_STREAM_IDLE_TTL
                           or now - state.created > HTTP_STREAM_MAX_AGE]
                for key in expired:
                    state = self._http_streams.pop(key)
                    asyncio.create_task(self._stop_http_stream(state))
                if len(self._http_streams) + self._pending_http_streams >= MAX_HTTP_STREAMS:
                    raise NativeSurfaceError("too many HTTP streams", "capacity")
                self._pending_http_streams += 1
            elif op not in {"http_stream_read", "http_stream_close", "ws_send", "ws_receive", "ws_close"}:
                raise NativeSurfaceError("unknown surface operation", "bad_op")
        if op == "http":
            return await asyncio.to_thread(self._http, args, url, self._origin)
        if op == "ws_open":
            try:
                return await self._ws_open(args, url, self._origin)
            finally:
                async with self._lock:
                    self._pending_channels -= 1
        if op == "http_stream_open":
            try:
                return await self._http_stream_open(args, url, self._origin)
            finally:
                async with self._lock:
                    self._pending_http_streams -= 1
        if op == "http_stream_read":
            return await self._http_stream_read(args)
        if op == "http_stream_close":
            return await self._http_stream_close(args)
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

        def send() -> Any:
            try:
                return opener.open(request, timeout=TIMEOUT)
            except urllib.error.HTTPError as exc:
                return exc
            except Exception:
                raise NativeSurfaceError("native DSH request failed", "upstream_error") from None

        response = send()
        if response.code in (401, 403):
            # DSH rotates its web session on restart; stale cookies must be replaced once.
            response.close()
            self._reset_auth()
            self._ensure_authenticated()
            refreshed = self._cookie_header()
            if refreshed:
                clean["cookie"] = refreshed
            else:
                clean.pop("cookie", None)
            request = urllib.request.Request(url, data=body, headers=clean, method=method)
            response = send()
        with response:
            payload = response.read(MAX_BODY + 1)
            if len(payload) > MAX_BODY:
                raise NativeSurfaceError("native DSH response too large", "too_large")
            result_headers = {k.lower(): v for k, v in response.headers.items()
                              if k.lower() in ALLOWED_RESPONSE_HEADERS and "\r" not in v and "\n" not in v}
            payload, result_headers = polish_native_html(payload, result_headers)
            return {"status": response.code, "headers": result_headers,
                    "body_base64": base64.b64encode(payload).decode("ascii")}

    async def _http_stream_open(self, args: dict[str, Any], url: str, origin: str) -> dict[str, Any]:
        headers = args.get("headers") or {}
        if not isinstance(headers, dict):
            raise NativeSurfaceError("invalid headers", "bad_headers")
        accept = headers.get("accept", "text/event-stream")
        if (not isinstance(accept, str) or "\r" in accept or "\n" in accept
                or "text/event-stream" not in accept.lower()):
            raise NativeSurfaceError("invalid headers", "bad_headers")
        await asyncio.to_thread(self._ensure_authenticated)
        cookie = self._cookie_header()
        parsed = urllib.parse.urlsplit(url)
        host, port = parsed.hostname or "", parsed.port or 80
        host_header = f"[{host}]" if ":" in host else host
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        if any(ord(char) <= 32 or ord(char) == 127 or ord(char) > 126 for char in path):
            raise NativeSurfaceError("invalid surface path", "bad_path")
        request_headers = [f"GET {path} HTTP/1.1", f"Host: {host_header}:{port}",
                           f"Accept: {accept}", "Accept-Encoding: identity",
                           f"Origin: {origin}", "Sec-Fetch-Site: same-origin", "Connection: keep-alive"]
        if cookie:
            request_headers.append(f"Cookie: {cookie}")
        writer: asyncio.StreamWriter | None = None
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port, limit=64 * 1024), timeout=TIMEOUT)
            writer.write(("\r\n".join(request_headers) + "\r\n\r\n").encode("latin-1"))
            await writer.drain()
            raw_head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=TIMEOUT)
        except asyncio.CancelledError:
            if writer is not None:
                writer.close()
            raise
        except Exception:
            if writer is not None:
                writer.close()
            raise NativeSurfaceError("native DSH stream failed", "upstream_error") from None
        try:
            lines = raw_head.decode("iso-8859-1").split("\r\n")
            status_match = re.fullmatch(r"HTTP/1\.[01] ([0-9]{3})(?: .*)?", lines[0])
            if status_match is None:
                raise ValueError
            status = int(status_match.group(1))
            raw_response_headers: dict[str, str] = {}
            for line in lines[1:]:
                if not line:
                    continue
                name, separator, value = line.partition(":")
                if not separator:
                    raise ValueError
                raw_response_headers[name.strip().lower()] = value.strip()
        except (UnicodeError, ValueError):
            writer.close()
            raise NativeSurfaceError("native DSH stream response invalid", "bad_response") from None
        result_headers = {key: value for key, value in raw_response_headers.items()
                          if key in ALLOWED_RESPONSE_HEADERS and "\r" not in value and "\n" not in value}
        transfer_encoding = raw_response_headers.get("transfer-encoding", "").lower()
        if transfer_encoding and "chunked" not in transfer_encoding.split(",")[-1].strip():
            writer.close()
            raise NativeSurfaceError("unsupported native DSH stream framing", "bad_response")
        content_length: int | None = None
        if "content-length" in raw_response_headers:
            try:
                content_length = int(raw_response_headers["content-length"])
                if content_length < 0:
                    raise ValueError
            except ValueError:
                writer.close()
                raise NativeSurfaceError("native DSH stream response invalid", "bad_response") from None
        if status != 200:
            payload = b""
            if content_length is not None:
                try:
                    payload = await asyncio.wait_for(
                        reader.readexactly(min(content_length, HTTP_STREAM_CHUNK)), timeout=TIMEOUT)
                except (asyncio.TimeoutError, asyncio.IncompleteReadError):
                    writer.close()
                    raise NativeSurfaceError("native DSH stream response incomplete", "bad_response") from None
            writer.close()
            return {"status": status, "headers": result_headers,
                    "body_base64": base64.b64encode(payload).decode("ascii")}
        if "text/event-stream" not in result_headers.get("content-type", "").lower():
            writer.close()
            raise NativeSurfaceError("native DSH stream content type invalid", "bad_response")
        stream_id = uuid.uuid4().hex
        state = _HttpStream(reader, writer, chunked="chunked" in transfer_encoding,
                            content_remaining=content_length)
        self._http_streams[stream_id] = state
        state.pump = asyncio.create_task(self._http_stream_pump(state))
        state.watchdog = asyncio.create_task(self._http_stream_watchdog(stream_id, state))
        return {"status": status, "headers": result_headers, "stream": stream_id}

    @staticmethod
    def _http_stream_expired(state: _HttpStream) -> bool:
        return time.monotonic() - state.last_access > HTTP_STREAM_IDLE_TTL

    async def _read_http_stream_chunk(self, state: _HttpStream) -> bytes:
        if state.chunked:
            if state.current_chunk_remaining == 0:
                line = await state.reader.readuntil(b"\r\n")
                if len(line) > 1024:
                    raise NativeSurfaceError("native DSH stream chunk header too large", "too_large")
                try:
                    size = int(line[:-2].split(b";", 1)[0].strip(), 16)
                except ValueError:
                    raise NativeSurfaceError("invalid native DSH stream framing", "bad_response") from None
                if size == 0:
                    trailer_bytes = 0
                    for _ in range(64):
                        trailer = await state.reader.readuntil(b"\r\n")
                        trailer_bytes += len(trailer)
                        if trailer_bytes > 8192:
                            raise NativeSurfaceError("native DSH stream trailer too large", "too_large")
                        if trailer == b"\r\n":
                            return b""
                    raise NativeSurfaceError("too many native DSH stream trailers", "bad_response")
                state.current_chunk_remaining = size
            size = min(HTTP_STREAM_CHUNK, state.current_chunk_remaining)
            data = await state.reader.readexactly(size)
            state.current_chunk_remaining -= len(data)
            if state.current_chunk_remaining == 0 and await state.reader.readexactly(2) != b"\r\n":
                raise NativeSurfaceError("invalid native DSH stream framing", "bad_response")
            return data
        if state.content_remaining is not None:
            if state.content_remaining == 0:
                return b""
            data = await state.reader.readexactly(min(HTTP_STREAM_CHUNK, state.content_remaining))
            state.content_remaining -= len(data)
            return data
        return await state.reader.read(HTTP_STREAM_CHUNK)

    async def _http_stream_pump(self, state: _HttpStream) -> None:
        try:
            while not state.stop.is_set():
                if self._http_stream_expired(state):
                    break
                chunk = await self._read_http_stream_chunk(state)
                if not chunk:
                    await state.chunks.put(("eof", None))
                    break
                await state.chunks.put(("chunk", chunk))
        except asyncio.CancelledError:
            raise
        except Exception:
            if not state.stop.is_set():
                await state.chunks.put(("error", None))

    async def _http_stream_watchdog(self, stream_id: str, state: _HttpStream) -> None:
        while not state.stop.is_set():
            await asyncio.sleep(HTTP_STREAM_WATCHDOG_POLL)
            if self._http_stream_expired(state):
                async with self._lock:
                    if self._http_streams.get(stream_id) is state:
                        self._http_streams.pop(stream_id, None)
                await self._stop_http_stream(state)
                return

    def _http_stream_state(self, args: dict[str, Any]) -> tuple[str, _HttpStream] | None:
        stream_id = args.get("stream")
        if not isinstance(stream_id, str) or not re.fullmatch(r"[a-f0-9]{32}", stream_id):
            return None
        state = self._http_streams.get(stream_id)
        if state is None:
            return None
        if self._http_stream_expired(state):
            self._http_streams.pop(stream_id, None)
            asyncio.create_task(self._stop_http_stream(state))
            return None
        state.last_access = time.monotonic()
        return stream_id, state

    async def _http_stream_read(self, args: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            found = self._http_stream_state(args)
        if found is None:
            return {"kind": "closed"}
        stream_id, state = found
        try:
            kind, data = await asyncio.wait_for(state.chunks.get(), timeout=HTTP_STREAM_POLL)
        except asyncio.TimeoutError:
            if state.stop.is_set():
                return {"kind": "closed"}
            return {"kind": "idle"}
        if kind == "chunk" and data is not None:
            return {"kind": "chunk", "data": base64.b64encode(data).decode("ascii")}
        async with self._lock:
            self._http_streams.pop(stream_id, None)
        await self._stop_http_stream(state)
        return {"kind": "eof" if kind == "eof" else "closed"}

    async def _stop_http_stream(self, state: _HttpStream) -> None:
        state.stop.set()
        current = asyncio.current_task()
        tasks = [task for task in (state.pump, state.watchdog)
                 if task is not None and task is not current and not task.done()]
        for task in tasks:
            task.cancel()
        state.writer.close()
        try:
            await asyncio.wait_for(state.writer.wait_closed(), timeout=1.0)
        except (asyncio.TimeoutError, OSError, RuntimeError):
            pass
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _http_stream_close(self, args: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            stream_id = args.get("stream")
            state = self._http_streams.pop(stream_id, None) if isinstance(stream_id, str) else None
        if state is not None:
            await self._stop_http_stream(state)
        return {"ok": True}

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
            streams = list(self._http_streams.values())
            self._channels.clear()
            self._http_streams.clear()
            self._stale_channels = []
            await self._close_many(sockets)
            for state in streams:
                await self._stop_http_stream(state)
            self._reset_auth()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None
