"""Locate, start and install the DeepSeek Harness desktop app on this node.

Tether embeds the DSH web UI but does not own its lifecycle. When the desktop
app is closed (or missing) the native surface has nothing to embed, so this
module gives the node a small, bounded API for status, start and install.
Installers come only from DeepSeek's HTTPS update feed and are verified by the
feed's SHA-512 before they are executed.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import psutil

EXE_NAME = "DeepSeek Harness.exe"
DEFAULT_FEED = "https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml"
FEED_HOST = "download.deepseek.com"
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000
MAX_INSTALLER_BYTES = 512 * 1024 * 1024


class DshError(Exception):
    def __init__(self, message: str, code: str = "dsh_error") -> None:
        super().__init__(message)
        self.code = code


def _app_env() -> dict[str, str]:
    env = dict(os.environ)
    for key in ("ELECTRON_RUN_AS_NODE", "DSH_HOME", "TETHER_NATIVE_DSH_HOME",
                "TETHER_DSH_EXE", "TETHER_DSH_FEED_URL"):
        env.pop(key, None)
    return env


def _query(key: Any, name: str) -> str:
    import winreg
    try:
        value, _kind = winreg.QueryValueEx(key, name)
        return str(value or "").strip()
    except (OSError, ValueError):
        return ""


def _registry_info() -> dict[str, str]:
    if os.name != "nt":
        return {}
    import winreg
    roots = [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for root, subkey in roots:
        try:
            with winreg.OpenKey(root, subkey) as parent:
                for index in range(4096):
                    try:
                        name = winreg.EnumKey(parent, index)
                    except OSError:
                        break
                    try:
                        with winreg.OpenKey(parent, name) as item:
                            display = _query(item, "DisplayName")
                            if "deepseek harness" not in display.lower():
                                continue
                            location = _query(item, "InstallLocation")
                            icon = _query(item, "DisplayIcon")
                            version = _query(item, "DisplayVersion")
                            exe = ""
                            if location:
                                candidate = Path(location) / EXE_NAME
                                if candidate.is_file():
                                    exe = str(candidate)
                            if not exe and icon:
                                candidate = Path(icon.split(",")[0].strip())
                                if candidate.is_file():
                                    exe = str(candidate)
                            if exe or location:
                                return {"exe": exe, "location": location, "version": version}
                    except OSError:
                        continue
        except OSError:
            continue
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths\\" + EXE_NAME) as item:
                exe = _query(item, "")
                if exe and Path(exe).is_file():
                    return {"exe": exe, "location": str(Path(exe).parent), "version": ""}
        except OSError:
            continue
    return {}


def _asar_version(exe: Path) -> str:
    asar = exe.parent / "resources" / "app.asar"
    try:
        with asar.open("rb") as handle:
            header = handle.read(16)
            if len(header) < 16:
                return ""
            _pickle, header_size, _length, json_length = struct.unpack("<IIII", header)
            data = json.loads(handle.read(json_length).decode("utf-8", "replace"))
            package = data.get("files", {}).get("package.json") or {}
            offset = int(package.get("offset") or 0)
            size = int(package.get("size") or 0)
            if size <= 0:
                return ""
            handle.seek(8 + header_size + offset)
            parsed = json.loads(handle.read(size).decode("utf-8", "replace"))
            version = parsed.get("version")
            return str(version) if isinstance(version, str) else ""
    except (OSError, ValueError, KeyError, TypeError):
        return ""


def _candidate_exes(home: Path) -> list[Path]:
    values: list[Path] = []
    override = os.environ.get("TETHER_DSH_EXE", "").strip()
    if override:
        values.append(Path(override).expanduser())
    values.extend([
        home.parent / EXE_NAME,
        home / EXE_NAME,
        home.parent / "DeepSeek harness" / EXE_NAME,
    ])
    for root in (os.environ.get("LOCALAPPDATA"), os.environ.get("ProgramFiles"),
                 os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramW6432")):
        if not root:
            continue
        values.extend([
            Path(root) / "Programs" / "DeepSeek Harness" / EXE_NAME,
            Path(root) / "DeepSeek Harness" / EXE_NAME,
            Path(root) / "Programs" / "@deepseek-ai" / "dsh-desktop" / EXE_NAME,
        ])
    for drive in ("C", "D", "E", "F", "G"):
        values.extend([
            Path(f"{drive}:\\DeepSeek Harness\\{EXE_NAME}"),
            Path(f"{drive}:\\DeepSeek harness\\{EXE_NAME}"),
        ])
    unique: list[Path] = []
    seen: set[str] = set()
    for value in values:
        key = os.path.normcase(str(value))
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def _parse_feed(text: str) -> dict[str, Any]:
    version = re.search(r"(?m)^version:\s*(\S+)", text)
    path = re.search(r"(?ms)^path:\s*>?-\s*\n\s*(https?://\S+)", text)
    if path is None:
        path = re.search(r"(?m)^path:\s*(https?://\S+)", text)
    sha = re.search(r"(?ms)^sha512:\s*>?-\s*\n\s*(\S+)", text)
    if sha is None:
        sha = re.search(r"(?m)^sha512:\s*(\S+)", text)
    size = re.search(r"(?m)^\s*size:\s*(\d+)", text)
    if not version or not path or not sha or not size:
        raise DshError("DSH 更新源格式无效", "dsh_feed_invalid")
    return {
        "version": version.group(1),
        "url": path.group(1),
        "sha512": sha.group(1),
        "size": int(size.group(1)),
    }


class DshDesktop:
    def __init__(self, data_dir: Path, *, dsh_home: Path | None = None) -> None:
        self.data_dir = Path(data_dir)
        self.dsh_home = Path(dsh_home) if dsh_home is not None else (Path.home() / ".dsh")
        self.descriptor = self.dsh_home / "storages" / "tether" / "native-surface.json"
        self.installer_dir = self.data_dir / "dsh-installer"
        self.state_path = self.data_dir / "dsh-desktop-state.json"
        self._lock = threading.Lock()
        self._status_at = 0.0
        self._status: dict[str, Any] | None = None
        self._state = self._read_state()

    def _read_state(self) -> dict[str, Any]:
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write_state(self, **fields: Any) -> None:
        with self._lock:
            self._state.update(fields)
            self._state["updated_at"] = time.time()
            try:
                self.state_path.parent.mkdir(parents=True, exist_ok=True)
                self.state_path.write_text(json.dumps(self._state, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass

    def _descriptor_pid(self) -> int:
        try:
            data = json.loads(self.descriptor.read_text(encoding="utf-8"))
            pid = data.get("pid")
            if type(pid) is int and 0 < pid <= 2_147_483_647 and psutil.pid_exists(pid):
                return pid
        except (OSError, ValueError):
            pass
        return 0

    def _find_exe(self) -> tuple[Path | None, str]:
        info = _registry_info()
        version = info.get("version", "")
        if info.get("exe"):
            exe = Path(info["exe"])
            if exe.is_file():
                return exe, version or _asar_version(exe)
        if info.get("location"):
            candidate = Path(info["location"]) / EXE_NAME
            if candidate.is_file():
                return candidate, version or _asar_version(candidate)
        for candidate in _candidate_exes(self.dsh_home):
            if candidate.is_file():
                return candidate, _asar_version(candidate)
        return None, version

    def _running(self, exe: Path | None) -> tuple[bool, int]:
        descriptor_pid = self._descriptor_pid()
        if descriptor_pid:
            return True, descriptor_pid
        target = os.path.normcase(str(exe)) if exe else ""
        for process in psutil.process_iter(["pid", "name", "exe"]):
            try:
                name = str(process.info.get("name") or "")
                if name.lower() != EXE_NAME.lower():
                    continue
                executable = str(process.info.get("exe") or "")
                if target and os.path.normcase(executable) != target:
                    continue
                return True, int(process.info.get("pid") or 0)
            except (psutil.Error, OSError, ValueError):
                continue
        return False, 0

    def status(self) -> dict[str, Any]:
        now = time.monotonic()
        if self._status is not None and now - self._status_at < 4:
            return dict(self._status)
        exe, version = self._find_exe()
        running, pid = self._running(exe)
        installing = self._state.get("installing") is True
        result = {
            "installed": exe is not None,
            "running": running,
            "version": version,
            "exe": str(exe) if exe else "",
            "home": str(self.dsh_home),
            "pid": pid,
            "installing": installing,
            "stage": str(self._state.get("stage") or ""),
            "progress": int(self._state.get("progress") or 0),
            "error": str(self._state.get("error") or ""),
        }
        self._status = result
        self._status_at = now
        return dict(result)

    def start(self) -> dict[str, Any]:
        current = self.status()
        if current["running"]:
            return current
        if not current["installed"]:
            raise DshError("DSH 未安装", "dsh_not_installed")
        exe = Path(current["exe"])
        env = _app_env()
        kwargs: dict[str, Any] = {
            "cwd": str(exe.parent),
            "env": env,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "close_fds": True,
        }
        if os.name == "nt":
            kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        try:
            subprocess.Popen([str(exe)], **kwargs)
        except OSError as exc:
            raise DshError(f"DSH 启动失败: {exc}", "dsh_start_failed") from exc
        self._status = None
        return {"started": True, **self.status()}

    def restart(self) -> dict[str, Any]:
        current = self.status()
        if not current["installed"]:
            raise DshError("DSH 未安装", "dsh_not_installed")
        if not current["running"]:
            return self.start()
        log = self.dsh_home / "storages" / "tether" / "dsh-restart.log"
        env = _app_env()
        env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2]) + (
            os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        env["PYTHONIOENCODING"] = "utf-8"
        args = [sys.executable, "-m", "tether.node.dsh_restart",
                "--descriptor", str(self.descriptor), "--log", str(log),
                "--delay", "0.8", "--wait", "60"]
        kwargs: dict[str, Any] = {
            "cwd": str(Path(__file__).resolve().parents[2]),
            "env": env,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "close_fds": True,
        }
        if os.name == "nt":
            kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        try:
            subprocess.Popen(args, **kwargs)
        except OSError as exc:
            raise DshError(f"DSH 重启失败: {exc}", "dsh_restart_failed") from exc
        self._status = None
        return {"restarting": True, **self.status()}

    def install(self) -> dict[str, Any]:
        current = self.status()
        if current["running"]:
            return current
        if self._state.get("installing") is True:
            return self.status()
        feed = self._feed()
        self._write_state(installing=True, stage="download", progress=0, version=feed["version"], error="")
        self._status = None
        thread = threading.Thread(target=self._install_worker, args=(feed,), daemon=True, name="tether-dsh-install")
        thread.start()
        return self.status()

    def _feed(self) -> dict[str, Any]:
        url = os.environ.get("TETHER_DSH_FEED_URL", "").strip() or DEFAULT_FEED
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https":
            raise DshError("DSH 更新源必须是 HTTPS", "dsh_feed_invalid")
        if parsed.hostname != FEED_HOST and not os.environ.get("TETHER_DSH_FEED_URL"):
            raise DshError("DSH 更新源不在允许的域名", "dsh_feed_invalid")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Tether/DSH-installer"})
            with urllib.request.urlopen(request, timeout=30) as response:
                text = response.read(512 * 1024).decode("utf-8", "replace")
        except OSError as exc:
            raise DshError(f"读取 DSH 更新源失败: {exc}", "dsh_feed_unreachable") from exc
        feed = _parse_feed(text)
        if urllib.parse.urlsplit(feed["url"]).hostname != FEED_HOST and not os.environ.get("TETHER_DSH_FEED_URL"):
            raise DshError("DSH 安装包地址不在允许的域名", "dsh_feed_invalid")
        if feed["size"] > MAX_INSTALLER_BYTES:
            raise DshError("DSH 安装包超过大小上限", "dsh_feed_invalid")
        return feed

    def _install_worker(self, feed: dict[str, Any]) -> None:
        try:
            self.installer_dir.mkdir(parents=True, exist_ok=True)
            installer = self.installer_dir / f"deepseek-harness-{feed['version']}-win-x64.exe"
            partial = installer.with_suffix(".part")
            digest = hashlib.sha512()
            received = 0
            request = urllib.request.Request(feed["url"], headers={"User-Agent": "Tether/DSH-installer"})
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > feed["size"]:
                        raise DshError("DSH 安装包大小与清单不一致", "dsh_install_invalid")
                    digest.update(chunk)
                    output.write(chunk)
                    self._write_state(progress=min(90, int(received * 90 / max(1, feed["size"]))))
            if received != feed["size"]:
                raise DshError("DSH 安装包大小与清单不一致", "dsh_install_invalid")
            expected = base64.b64decode(feed["sha512"])
            if digest.digest() != expected:
                raise DshError("DSH 安装包校验失败", "dsh_install_invalid")
            partial.replace(installer)
            self._write_state(stage="install", progress=95)
            kwargs: dict[str, Any] = {
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
                "close_fds": True,
            }
            if os.name == "nt":
                kwargs["creationflags"] = CREATE_NO_WINDOW
            process = subprocess.Popen([str(installer), "/S"], **kwargs)
            try:
                process.wait(timeout=600)
            except subprocess.TimeoutExpired as exc:
                raise DshError("DSH 安装超时", "dsh_install_timeout") from exc
            self._write_state(stage="verify", progress=98)
            self._status = None
            current = self.status()
            if not current["installed"]:
                raise DshError("DSH 安装后未找到程序", "dsh_install_failed")
            self._write_state(installing=False, stage="done", progress=100, error="")
            try:
                self.start()
            except DshError:
                pass
        except DshError as exc:
            self._write_state(installing=False, stage="error", error=str(exc))
        except (OSError, ValueError) as exc:
            self._write_state(installing=False, stage="error", error=f"DSH 安装失败: {exc}")
        finally:
            self._status = None