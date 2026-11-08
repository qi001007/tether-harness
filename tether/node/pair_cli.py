"""Interactively pair a packaged Debian Node with its owner's one-time code."""

from __future__ import annotations

import getpass
import ipaddress
import json
import os
import platform
import re
import secrets
import shutil
import ssl
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PAIRING_CODE_RE = re.compile(r"^[A-Z0-9]{8}$")
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
MAX_RESPONSE_BYTES = 16 * 1024


class PairingError(RuntimeError):
    pass


def _read_env_file(path: Path) -> tuple[str, dict[str, str]]:
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise PairingError("The private Node environment file is missing or unsafe")
    if os.name != "posix" or not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise PairingError("Run this command with sudo so it can protect the Node credential")
    parent = path.parent
    parent_stat = parent.stat()
    file_stat = path.stat()
    if (parent_stat.st_uid != 0 or parent_stat.st_mode & 0o077 or file_stat.st_uid != 0 or
            file_stat.st_mode & 0o077 or not stat.S_ISREG(file_stat.st_mode)):
        raise PairingError("Node environment file and directory must be root-owned and private")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            text = handle.read(256 * 1024 + 1)
    except (OSError, UnicodeError):
        raise PairingError("Node environment file could not be read safely") from None
    if len(text) > 256 * 1024:
        raise PairingError("Node environment file is unexpectedly large")
    values: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _separator, value = stripped.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            values[key] = value
    return text, values


def _hub_exchange_url(controller: str) -> str:
    parsed = urllib.parse.urlsplit(controller.strip())
    path = parsed.path.rstrip("/")
    if (parsed.scheme.lower() != "wss" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise PairingError("TETHER_CONTROLLER must be a secure wss:// Hub URL without credentials or query")
    try:
        port = parsed.port
    except ValueError:
        raise PairingError("TETHER_CONTROLLER has an invalid port") from None
    if port is not None and not 1 <= port <= 65535:
        raise PairingError("TETHER_CONTROLLER has an invalid port")
    hostname = parsed.hostname or ""
    try:
        if ":" in hostname:
            ipaddress.IPv6Address(hostname)
            host_for_url = f"[{hostname}]"
        else:
            ascii_host = hostname.encode("idna").decode("ascii")
            if (not ascii_host or len(ascii_host) > 253 or
                    not re.fullmatch(r"[A-Za-z0-9.-]+", ascii_host) or
                    any(not label or len(label) > 63 or label.startswith("-") or label.endswith("-")
                        for label in ascii_host.rstrip(".").split("."))):
                raise ValueError
            host_for_url = ascii_host
    except (UnicodeError, ValueError):
        raise PairingError("TETHER_CONTROLLER must use a valid Hub hostname or IP address") from None
    if path.endswith("/ws/node"):
        base_path = path[:-len("/ws/node")].rstrip("/")
    elif path in ("", "/"):
        base_path = ""
    else:
        raise PairingError("TETHER_CONTROLLER must end with /ws/node")
    if not re.fullmatch(r"(?:/[A-Za-z0-9._~-]+)*", base_path):
        raise PairingError("TETHER_CONTROLLER has an invalid URL path")
    netloc = f"{host_for_url}:{port}" if port is not None else host_for_url
    return urllib.parse.urlunsplit(("https", netloc, base_path + "/api/pairing/exchange", "", ""))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _fp, _code, _msg, _headers, _newurl):
        raise urllib.error.HTTPError(_newurl, 0, "redirect refused", {}, None)


def _exchange(code: str, device_id: str, exchange_url: str) -> str:
    payload = json.dumps({"code": code, "device_id": device_id, "name": device_id,
                          "platform": platform.platform(), "capabilities": {}},
                         separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        exchange_url, data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "Cache-Control": "no-store"}, method="POST")
    opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(request, timeout=20) as response:
            if response.geturl().lower().startswith("https://") is False:
                raise PairingError("Hub pairing did not remain on HTTPS")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        code_name = ""
        try:
            body = json.loads(exc.read(MAX_RESPONSE_BYTES).decode("utf-8"))
            detail = body.get("detail", body) if isinstance(body, dict) else {}
            if isinstance(detail, dict):
                code_name = str(detail.get("code") or "")
        except (OSError, UnicodeError, ValueError):
            pass
        suffix = f" ({code_name})" if re.fullmatch(r"[a-z0-9_]{1,64}", code_name) else ""
        raise PairingError(f"Hub rejected the pairing code: HTTP {exc.code}{suffix}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PairingError("Could not securely connect to the configured Hub") from None
    if len(raw) > MAX_RESPONSE_BYTES:
        raise PairingError("Hub pairing response is unexpectedly large")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise PairingError("Hub returned an invalid pairing response") from None
    token = value.get("token") if isinstance(value, dict) else None
    if (not isinstance(token, str) or not token or len(token) > 4096 or
            not re.fullmatch(r"[A-Za-z0-9_-]+", token) or value.get("device_id") != device_id):
        raise PairingError("Hub pairing response did not match this Node")
    return token


def _updated_env(text: str, *, controller: str, device_id: str, token: str) -> str:
    replacements = {"TETHER_CONTROLLER": controller, "TETHER_DEVICE": device_id,
                    "TETHER_NODE_TOKEN": token}
    seen: set[str] = set()
    output: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        key, separator, _value = stripped.partition("=")
        key = key.strip()
        if separator and key in replacements:
            if key not in seen:
                output.append(f"{key}={replacements[key]}")
                seen.add(key)
            continue
        if separator and key == "TETHER_USER_TOKEN":
            continue
        output.append(line)
    for key, value in replacements.items():
        if key not in seen:
            output.append(f"{key}={value}")
    return "\n".join(output).rstrip("\n") + "\n"


def _write_env_atomic(path: Path, content: str) -> None:
    if path.is_symlink() or not path.is_file():
        raise PairingError("Node environment file changed during pairing; no config was written")
    parent_stat = path.parent.stat()
    file_stat = path.stat()
    if (parent_stat.st_uid != 0 or parent_stat.st_mode & 0o077 or file_stat.st_uid != 0 or
            file_stat.st_mode & 0o077 or not stat.S_ISREG(file_stat.st_mode)):
        raise PairingError("Node environment file permissions changed; no config was written")
    temporary = path.parent / f".node.env.pair-{os.getpid()}-{secrets.token_hex(8)}"
    descriptor = -1
    replaced = False
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            descriptor = -1
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        replaced = True
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        if replaced:
            raise PairingError("Paired credential was written, but its directory could not be synced; check the Node configuration before retrying") from None
        raise PairingError("Paired credential could not be saved; existing Node configuration was preserved") from None
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _systemctl(*args: str) -> bool:
    executable = shutil.which("systemctl")
    if not executable:
        return False
    try:
        result = subprocess.run([executable, *args], stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Pair this Linux Tether Node with an APP-generated one-time code.")
    parser.parse_args(argv)
    if os.name != "posix" or not hasattr(os, "geteuid") or os.geteuid() != 0:
        print("Run with sudo: sudo tether-node-pair", file=sys.stderr)
        return 2
    if not sys.stdin.isatty():
        print("Pairing is interactive; run it from a terminal.", file=sys.stderr)
        return 2
    env_path = Path(os.environ.get("TETHER_NODE_ENV_FILE", "/etc/tether-node/node.env"))
    try:
        text, values = _read_env_file(env_path)
        controller = values.get("TETHER_CONTROLLER", "").strip()
        if not controller:
            controller = input("Hub WebSocket URL (wss://host/ws/node): ").strip()
        exchange_url = _hub_exchange_url(controller)
        device_id = values.get("TETHER_DEVICE", "").strip() or platform.node().strip()
        if not DEVICE_ID_RE.fullmatch(device_id):
            raise PairingError("The configured device id is invalid; set TETHER_DEVICE before pairing")
        if values.get("TETHER_NODE_TOKEN", "").strip():
            confirmation = input(f"Device {device_id} already has a token. Re-pairing rotates it and closes its old connection. Continue? [y/N] ")
            if confirmation.strip().lower() not in {"y", "yes"}:
                print("Pairing cancelled; Node configuration was not changed.")
                return 1
        code = getpass.getpass("One-time pairing code from the Tether APP: ").strip().upper().replace(" ", "").replace("-", "")
        if not PAIRING_CODE_RE.fullmatch(code):
            raise PairingError("Pairing code must contain eight letters or digits")
        token = _exchange(code, device_id, exchange_url)
        updated = _updated_env(text, controller=controller, device_id=device_id, token=token)
        _write_env_atomic(env_path, updated)
        print(f"Paired device {device_id}; the private Node configuration was saved.")
        if not _systemctl("enable", "tether-node.service") or not _systemctl("restart", "tether-node.service"):
            print("Pairing succeeded, but the service did not restart. Run: sudo systemctl restart tether-node.service",
                  file=sys.stderr)
            return 1
        if not _systemctl("is-active", "--quiet", "tether-node.service"):
            print("Pairing succeeded, but tether-node.service is not active.", file=sys.stderr)
            return 1
        print("tether-node.service is active.")
        return 0
    except (PairingError, OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
