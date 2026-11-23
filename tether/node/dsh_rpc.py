"""Read-only RPC proxy to the local DeepSeek Harness daemon.

The APP's DSH process publishes ``storages/tether/native-surface.json`` with the
loopback origin and a one-shot authenticated URL. Opening that URL with the
token returns ``303`` plus a ``dsh-auth-*`` HttpOnly cookie; every later call is
a one-shot RPC::

    POST /api/<endpoint>
    {"type": "client-request", "rpcId": "<uuid>",
     "method": "<endpoint>", "payload": {"args": {...}}}

    -> {"rpcId": "...", "result": {"ok": true, "value": {...}}}
    -> {"rpcId": "...", "result": {"ok": false,
                                   "error": {"code": "session/not-found", ...}}}

Only the read endpoints and ``session/prompt`` are reachable: prompts are
executed by the DSH daemon itself, so session files are never written here.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import threading
import urllib.parse
import uuid
from pathlib import Path
from typing import Any, Callable

DESCRIPTOR_NAME = ("storages", "tether", "native-surface.json")
READ_ENDPOINTS = frozenset({"session/list", "session/page"})
ALLOWED_ENDPOINTS = READ_ENDPOINTS | {"session/prompt"}
AUTH_COOKIE_PREFIX = "dsh-auth"
TIMEOUT = 20.0
MAX_RESPONSE = 32 * 1024 * 1024
MAX_SESSION_ID = 200
MAX_MESSAGES = 500

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, list[tuple[str, str]], bytes]]


class DshRpcError(Exception):
    """A native DSH call failed; ``code`` is the upstream code when there is one."""

    def __init__(self, message: str, code: str = "dsh_error", *,
                 status: int | None = None, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"error": str(self), "code": self.code}
        if self.status is not None:
            payload["status"] = self.status
        if self.details is not None:
            payload["details"] = self.details
        return payload


def default_descriptor_homes() -> tuple[Path, ...]:
    configured = os.environ.get("TETHER_NATIVE_DSH_HOME") or os.environ.get("DSH_HOME")
    if configured:
        return (Path(configured).expanduser(),)
    return (Path.home() / ".dsh",)


def _descriptor_path(home: Path) -> Path:
    return home.joinpath(*DESCRIPTOR_NAME)


def _validated_surface(path: Path) -> tuple[str, str]:
    """Return (origin, authenticated_url) or raise for anything but loopback http."""
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise DshRpcError("native DSH descriptor missing", "descriptor_missing") from None
    except OSError:
        raise DshRpcError("native DSH descriptor unreadable", "descriptor_invalid") from None
    try:
        data = json.loads(raw)
    except ValueError:
        raise DshRpcError("native DSH descriptor invalid", "descriptor_invalid") from None
    if not isinstance(data, dict) or data.get("version") != 1:
        raise DshRpcError("native DSH descriptor invalid", "descriptor_invalid")
    origin, auth = data.get("origin"), data.get("authenticated_url")
    if not isinstance(origin, str) or not isinstance(auth, str):
        raise DshRpcError("native DSH descriptor invalid", "descriptor_invalid")
    try:
        parsed = urllib.parse.urlsplit(origin)
        authorized = urllib.parse.urlsplit(auth)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "::1")
                or parsed.port is None or not 1 <= parsed.port <= 65535
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment):
            raise ValueError
        if (authorized.scheme != "http" or authorized.hostname != parsed.hostname
                or authorized.port != parsed.port or authorized.username or authorized.password
                or authorized.fragment or not authorized.path.startswith("/")):
            raise ValueError
    except (TypeError, ValueError):
        raise DshRpcError("native DSH descriptor invalid", "descriptor_invalid") from None
    if "\r" in auth or "\n" in auth:
        raise DshRpcError("native DSH descriptor invalid", "descriptor_invalid")
    return origin.rstrip("/"), auth


def _cookie_pairs(headers: list[tuple[str, str]]) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for name, value in headers:
        if not isinstance(name, str) or not isinstance(value, str):
            continue
        if name.lower() != "set-cookie":
            continue
        pair = value.split(";", 1)[0]
        key, separator, cookie = pair.partition("=")
        key = key.strip()
        if separator and key.startswith(AUTH_COOKIE_PREFIX):
            cookies[key] = cookie.strip()
    return cookies


class DshRpcClient:
    """Read-only DSH client. One instance per node; login state is cached."""

    def __init__(self, home: Path | str | None = None, *,
                 fallback_homes: tuple[Path, ...] | list[Path] = (),
                 timeout: float = TIMEOUT, transport: Transport | None = None) -> None:
        primary = Path(home).expanduser() if home is not None else default_descriptor_homes()[0]
        homes = [primary]
        for candidate in fallback_homes:
            resolved = Path(candidate).expanduser()
            if resolved not in homes:
                homes.append(resolved)
        self.descriptor = _descriptor_path(homes[0])
        self._descriptors = tuple(_descriptor_path(item) for item in homes)
        self.timeout = float(timeout)
        self._transport: Transport = transport or self._http_transport
        self._lock = threading.Lock()
        self._origin = ""
        self._cookies: dict[str, str] = {}

    # -- transport ---------------------------------------------------------
    def _http_transport(self, method: str, url: str,
                        headers: dict[str, str], body: bytes | None
                        ) -> tuple[int, list[tuple[str, str]], bytes]:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "http" or not parsed.hostname or parsed.port is None:
            raise DshRpcError("native DSH url rejected", "descriptor_invalid")
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=self.timeout)
        try:
            connection.request(method, target, body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise DshRpcError("native DSH response too large", "too_large")
            return response.status, response.getheaders(), raw
        except socket.timeout:
            raise DshRpcError("native DSH request timed out", "timeout") from None
        except DshRpcError:
            raise
        except OSError:
            raise DshRpcError("native DSH host unreachable", "host_unreachable") from None
        except http.client.HTTPException:
            raise DshRpcError("native DSH response invalid", "bad_response") from None
        finally:
            connection.close()

    # -- surface / auth ----------------------------------------------------
    def surface(self) -> tuple[str, str]:
        last: DshRpcError | None = None
        for path in self._descriptors:
            try:
                origin, auth = _validated_surface(path)
            except DshRpcError as exc:
                last = exc
                continue
            self.descriptor = path
            return origin, auth
        raise last or DshRpcError("native DSH descriptor missing", "descriptor_missing")

    def _login(self, origin: str, auth_url: str) -> dict[str, str]:
        status, headers, _ = self._transport("GET", auth_url, {"Accept": "*/*"}, None)
        if status not in (301, 302, 303, 307, 308):
            raise DshRpcError(f"native DSH login rejected (HTTP {status})", "auth_failed", status=status)
        cookies = _cookie_pairs(headers)
        if not cookies:
            raise DshRpcError("native DSH login returned no auth cookie", "auth_failed", status=status)
        self._origin = origin
        self._cookies = cookies
        return cookies

    def _cookie_header(self, origin: str) -> str:
        if self._cookies and self._origin == origin:
            return "; ".join(f"{name}={value}" for name, value in self._cookies.items())
        return ""

    # -- rpc ---------------------------------------------------------------
    def rpc(self, endpoint: str, arguments: dict[str, Any]) -> Any:
        """Call one allowed endpoint and return ``result.value``."""
        if endpoint not in ALLOWED_ENDPOINTS:
            raise DshRpcError(f"{endpoint} is not an allowed DSH endpoint", "read_only")
        if not isinstance(arguments, dict):
            raise DshRpcError("DSH arguments must be an object", "bad_args")
        origin, auth_url = self.surface()
        body = json.dumps({"type": "client-request", "rpcId": str(uuid.uuid4()),
                           "method": endpoint, "payload": {"args": arguments}},
                          ensure_ascii=False).encode("utf-8")
        for attempt in (0, 1):
            cookie = self._cookie_header(origin)
            if not cookie:
                with self._lock:
                    cookie = self._cookie_header(origin) or self._login_cookie(origin, auth_url)
            status, _, raw = self._transport(
                "POST", f"{origin}/api/{endpoint}",
                {"Content-Type": "application/json", "Accept": "application/json",
                 "Cookie": cookie, "Content-Length": str(len(body))},
                body)
            if status == 401 and attempt == 0:
                with self._lock:
                    self._cookies, self._origin = {}, ""
                    self._login(origin, auth_url)
                continue
            if status == 401:
                raise DshRpcError("native DSH rejected the session cookie", "unauthorized", status=401)
            if status == 404:
                raise DshRpcError(f"native DSH endpoint {endpoint} not found",
                                  "endpoint_not_found", status=404)
            if status != 200:
                raise DshRpcError(f"native DSH returned HTTP {status}",
                                  "upstream_error", status=status)
            return self._value(raw)
        raise DshRpcError("native DSH authentication failed", "unauthorized")

    def _login_cookie(self, origin: str, auth_url: str) -> str:
        cookies = self._login(origin, auth_url)
        return "; ".join(f"{name}={value}" for name, value in cookies.items())

    @staticmethod
    def _value(raw: bytes) -> Any:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise DshRpcError("native DSH response invalid", "bad_response") from None
        if not isinstance(payload, dict):
            raise DshRpcError("native DSH response invalid", "bad_response")
        result = payload.get("result")
        if not isinstance(result, dict):
            raise DshRpcError("native DSH response missing result", "bad_response")
        if not result.get("ok"):
            error = result.get("error")
            if isinstance(error, dict):
                raise DshRpcError(str(error.get("message") or "native DSH call failed"),
                                  str(error.get("code") or "upstream_error"),
                                  details=error.get("details"))
            raise DshRpcError(str(error) or "native DSH call failed", "upstream_error")
        return result.get("value")

    # -- reader API --------------------------------------------------------
    def list_sessions(self) -> list[dict[str, Any]]:
        value = self.rpc("session/list", {"_request": {}})
        items = value.get("items") if isinstance(value, dict) else None
        if not isinstance(items, list):
            raise DshRpcError("native DSH session list malformed", "bad_response")
        return [item for item in items if isinstance(item, dict)]

    def page(self, session_id: str, through_seq: int, max_messages: int = 50) -> dict[str, Any]:
        if not isinstance(session_id, str) or not session_id.strip():
            raise DshRpcError("session_id is required", "bad_args")
        if len(session_id) > MAX_SESSION_ID or "/" in session_id or "\\" in session_id:
            raise DshRpcError("session_id is invalid", "bad_args")
        if type(through_seq) is not int or through_seq < 0:
            raise DshRpcError("throughSeq must be a non-negative integer", "bad_args")
        if type(max_messages) is not int or not 1 <= max_messages <= MAX_MESSAGES:
            raise DshRpcError(f"maxMessages must be 1..{MAX_MESSAGES}", "bad_args")
        value = self.rpc("session/page", {"request": {
            "address": {"kind": "session", "sessionId": session_id.strip()},
            "throughSeq": through_seq, "maxMessages": max_messages}})
        if not isinstance(value, dict) or not isinstance(value.get("records"), list):
            raise DshRpcError("native DSH session page malformed", "bad_response")
        return value

    # -- writer API --------------------------------------------------------
    def prompt(self, session_id: str, text: str, request_id: str | None = None,
               mode: str = "queue") -> dict[str, Any]:
        if not isinstance(session_id, str) or not session_id.strip():
            raise DshRpcError("session_id is required", "bad_args")
        if len(session_id) > MAX_SESSION_ID or "/" in session_id or "\\" in session_id:
            raise DshRpcError("session_id is invalid", "bad_args")
        if not isinstance(text, str) or not text.strip():
            raise DshRpcError("text is required", "bad_args")
        value = self.rpc("session/prompt", {"request": {
            "requestId": request_id or uuid.uuid4().hex,
            "sessionId": session_id.strip(),
            "mode": "steer" if mode == "steer" else "queue",
            "content": [{"type": "text", "text": text}]}})
        return value if isinstance(value, dict) else {}