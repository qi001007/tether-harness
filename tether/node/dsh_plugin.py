"""Install or repair the Tether plugin inside the active DSH profile."""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
import zipfile
from pathlib import PurePosixPath
from pathlib import Path
from typing import Any

from .dsh_desktop import CREATE_NO_WINDOW, DshDesktop, DshError

PROFILE = "desktop"
PLUGIN_PACKAGE = "tether-dsh-plugin"
PLUGIN_PACKAGES = ("tether-dsh-plugin", "tether-dsh-client", "tether-dsh-surface", "tether-dsh-native-ui")
PLUGIN_SOURCE_DIRS = ("dsh-plugin-tether", "dsh-plugin-tether-client",
                      "tether-dsh-native-ui", "tether-dsh-surface")
REQUIRED_UI_PACKAGES = (
    "dsh-client-ui-chat",
    "dsh-client-ui-conversation",
    "dsh-client-ui-sidebar-files",
    "dsh-client-ui-tool",
    "dsh-client-ui-workspace",
)
PROFILE_TIMEOUT = 30.0
INSTALL_TIMEOUT = 300.0
DESCRIPTOR_TIMEOUT = 90.0
ROOT = Path(__file__).resolve().parents[2]
LOCAL_PACKAGES = ROOT / "packages"
_INSTALL_LOCK = threading.Lock()


class DshPluginError(DshError):
    def __init__(self, message: str, code: str = "dsh_plugin_error", **details: Any) -> None:
        super().__init__(message, code)
        self.details = details


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _package_version(path: Path) -> str:
    value = _read_json(path / "package.json").get("version")
    return value if isinstance(value, str) else ""


def _candidate_cli_paths(exe: str | None) -> list[Path]:
    values: list[Path] = []
    override = os.environ.get("DSH_CLI", "").strip()
    if override:
        values.append(Path(override))
    if exe:
        app = Path(exe)
        values.append(app.parent / "resources" / "runtime" / "cli" / "bin" / "dsh.cmd")
    local = os.environ.get("LOCALAPPDATA", "").strip()
    if local:
        values.append(Path(local) / "Programs" / "DeepSeek Harness" / "resources" / "runtime" / "cli" / "bin" / "dsh.cmd")
    for drive in ("C", "D", "E", "F", "G"):
        values.append(Path(f"{drive}:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd"))
        values.append(Path(f"{drive}:\\DeepSeek harness\\resources\\runtime\\cli\\bin\\dsh.cmd"))
    seen: set[str] = set()
    unique: list[Path] = []
    for value in values:
        key = os.path.normcase(str(value))
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def _find_cli(exe: str | None) -> Path | None:
    return next((path for path in _candidate_cli_paths(exe) if path.is_file()), None)


def _cli_argv(cli: Path, args: list[str]) -> tuple[list[str], dict[str, str]]:
    exe = cli.parents[4] / "DeepSeek Harness.exe"
    script = (cli.parents[3] / "app.asar" / "dsh" / "node_modules" / "@deepseek-ai"
              / "dsh-desktop-host" / "lib" / "cli.js")
    if exe.is_file():
        return [str(exe), "--expose-internals", str(script), *args], {"ELECTRON_RUN_AS_NODE": "1"}
    command = subprocess.list2cmdline([str(cli), *args])
    return ["cmd.exe", "/d", "/s", "/c", command], {}


def _run_cli(cli: Path, dsh_home: Path, args: list[str]) -> str:
    argv, extra_env = _cli_argv(cli, args)
    env = dict(os.environ)
    env["DSH_HOME"] = str(dsh_home)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.update(extra_env)
    kwargs: dict[str, Any] = {}
    if os.name == "nt":
        kwargs["creationflags"] = CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            argv,
            cwd=str(cli.parent),
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=INSTALL_TIMEOUT,
            **kwargs,
        )
    except subprocess.TimeoutExpired as exc:
        raise DshPluginError("Tether 插件安装超时", "dsh_plugin_timeout") from exc
    except OSError as exc:
        raise DshPluginError(f"无法运行 DSH CLI: {exc}", "dsh_cli_failed") from exc
    output = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    if result.returncode != 0:
        raise DshPluginError(output[-1200:] or f"DSH CLI 退出码 {result.returncode}",
                             "dsh_plugin_install_failed", output=output[-4000:])
    return output


def _extract_plugin_archive(archive: bytes, target: Path) -> Path:
    if target.is_dir() and (target / "packages" / "dsh-plugin-tether" / "package.json").is_file():
        return target
    temp = target.with_name(target.name + ".tmp-" + uuid.uuid4().hex[:8])
    shutil.rmtree(temp, ignore_errors=True)
    temp.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            for member in bundle.infolist():
                name = member.filename.replace("\\", "/")
                pure = PurePosixPath(name)
                if name.startswith("/") or not pure.parts or any(part in {"", ".", ".."} for part in pure.parts):
                    raise DshPluginError("插件包包含不安全路径", "plugin_archive_invalid")
                if member.is_dir():
                    continue
                destination = temp.joinpath(*pure.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(bundle.read(member))
        root = next((candidate for candidate in [temp, *[p for p in temp.iterdir() if p.is_dir()]]
                     if (candidate / "packages" / "dsh-plugin-tether" / "package.json").is_file()), None)
        if root is None:
            raise DshPluginError("插件包缺少 tether-dsh-plugin", "plugin_archive_invalid")
        shutil.rmtree(target, ignore_errors=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(root, target)
        if root != temp:
            shutil.rmtree(temp, ignore_errors=True)
        return target
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def _stage_local_packages(source: Path, version: str, stage_root: Path) -> Path:
    target = stage_root / version
    if (target / "packages" / "dsh-plugin-tether" / "package.json").is_file():
        return target
    temp = target.with_name(target.name + ".tmp-" + uuid.uuid4().hex[:8])
    shutil.rmtree(temp, ignore_errors=True)
    temp.mkdir(parents=True, exist_ok=True)
    ignore = shutil.ignore_patterns("node_modules", "__pycache__", ".git", ".pytest_cache")
    try:
        for name in PLUGIN_SOURCE_DIRS:
            origin = source / name
            if not (origin / "package.json").is_file():
                raise DshPluginError(f"本地插件包不完整: {name}", "plugin_source_invalid")
            shutil.copytree(origin, temp / "packages" / name, ignore=ignore)
        shutil.rmtree(target, ignore_errors=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(temp, target)
        return target
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def _staged_packages(dsh: DshDesktop) -> tuple[Path, str]:
    stage_root = dsh.data_dir / "plugin-source"
    local_package = LOCAL_PACKAGES / "dsh-plugin-tether" / "package.json"
    if local_package.is_file():
        version = _package_version(LOCAL_PACKAGES / "dsh-plugin-tether")
        return _stage_local_packages(LOCAL_PACKAGES, version, stage_root) / "packages", version
    from ..updates import UpdateError, UpdateManager
    manager = UpdateManager(
        root=ROOT,
        component="plugin",
        dsh_home=dsh.dsh_home,
        manifest_url=os.environ.get("TETHER_UPDATE_MANIFEST_URL") or None,
        state_dir=dsh.data_dir / "updates",
        profile=PROFILE,
    )
    try:
        manifest = manager._load_manifest(force=True)
        item = dict((manifest.get("components") or {}).get("plugin") or {})
        version = str(item.get("version") or "")
        archive = manager._fetch_artifact(item)
    except UpdateError as exc:
        raise DshPluginError(f"无法获取 Tether 插件包: {exc.code}", "plugin_download_failed",
                             error_code=exc.code) from exc
    if not version or hashlib.sha256(archive).hexdigest() != item.get("sha256"):
        raise DshPluginError("Tether 插件包校验失败", "plugin_archive_invalid")
    root = _extract_plugin_archive(archive, stage_root / version)
    return root / "packages", version


def _backup_profile(profile: Path) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = profile / f"package.json.bak-tether-plugin-{stamp}"
    shutil.copy2(profile / "package.json", backup)
    return backup


def _restore_profile(profile: Path, backup: Path) -> None:
    try:
        shutil.copy2(backup, profile / "package.json")
    except OSError:
        pass


def _file_spec(path: Path) -> str:
    value = str(path)
    if os.name == "nt":
        try:
            import ctypes
            buffer = ctypes.create_unicode_buffer(32768)
            if ctypes.windll.kernel32.GetShortPathNameW(value, buffer, 32768):
                value = buffer.value or value
        except Exception:
            pass
    return "file:" + Path(value).as_posix()


def _prepare_profile_dependency(profile: Path, plugin_path: Path) -> None:
    package = _read_json(profile / "package.json")
    dependencies = package.get("dependencies")
    if not isinstance(dependencies, dict):
        dependencies = {}
    dependencies[PLUGIN_PACKAGE] = _file_spec(plugin_path)
    package["dependencies"] = dependencies
    dsh = package.get("dsh")
    if not isinstance(dsh, dict):
        dsh = {}
    profile_config = dsh.get("profile")
    if not isinstance(profile_config, dict):
        profile_config = {}
    bundles = profile_config.get("bundles")
    if not isinstance(bundles, list):
        bundles = []
    if PLUGIN_PACKAGE not in bundles:
        bundles.append(PLUGIN_PACKAGE)
    profile_config["bundles"] = bundles
    dsh["profile"] = profile_config
    package["dsh"] = dsh
    temp = profile / "package.json.tether-tmp"
    temp.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, profile / "package.json")


def _restart_after_failure(dsh: DshDesktop, previous_running: bool, previous_pid: int,
                           started: float) -> None:
    if not previous_running:
        return
    try:
        dsh.start()
        _wait_descriptor(dsh, previous_pid, started)
    except Exception:
        pass


def _ensure_profile(dsh: DshDesktop) -> Path:
    profile = dsh.dsh_home / "profiles" / PROFILE
    if (profile / "package.json").is_file():
        _ensure_hoisted_layout(profile)
        return profile
    current = dsh.status()
    if not current["installed"]:
        raise DshPluginError("DSH 未安装", "dsh_not_installed")
    dsh.start()
    deadline = time.monotonic() + PROFILE_TIMEOUT
    while time.monotonic() < deadline:
        if (profile / "package.json").is_file():
            dsh.stop()
            _ensure_hoisted_layout(profile)
            return profile
        time.sleep(0.5)
    dsh.stop()
    raise DshPluginError("DSH profile 尚未创建，请先启动 DSH 完成初始化", "dsh_profile_missing")


def _ensure_hoisted_layout(profile: Path) -> None:
    """pnpm's isolated layout hides the DSH UI packages the client resolver needs."""
    workspace = profile / "pnpm-workspace.yaml"
    try:
        content = workspace.read_text(encoding="utf-8") if workspace.is_file() else ""
        if "nodeLinker: hoisted" in content:
            return
        if not content.strip():
            content = "packages:\n  - .\n"
        workspace.write_text(content.rstrip() + "\nnodeLinker: hoisted\nautoInstallPeers: false\n",
                             encoding="utf-8")
    except OSError:
        pass


def _verify_profile(profile: Path) -> dict[str, Any]:
    profile_package = _read_json(profile / "package.json")
    dependencies = profile_package.get("dependencies") if isinstance(profile_package.get("dependencies"), dict) else {}
    bundles = (((profile_package.get("dsh") or {}).get("profile") or {}).get("bundles")
               if isinstance(profile_package.get("dsh"), dict) else [])
    packages = profile / "node_modules"
    versions: dict[str, str] = {}
    missing: list[str] = []
    for name in PLUGIN_PACKAGES:
        version = _package_version(packages / name)
        if not version:
            missing.append(name)
        else:
            versions[name] = version
    missing_ui = [name for name in REQUIRED_UI_PACKAGES
                  if not (packages / "@deepseek-ai" / name / "lib" / "client.js").is_file()]
    if PLUGIN_PACKAGE not in dependencies or not isinstance(bundles, list) or PLUGIN_PACKAGE not in bundles:
        missing.append("profile-registration")
    if missing or missing_ui:
        raise DshPluginError(
            "Tether 插件或 DSH UI 依赖未安装完整",
            "plugin_verify_failed",
            missing=missing,
            missing_ui=missing_ui,
            versions=versions,
        )
    return {"versions": versions, "missing_ui": missing_ui, "dependencies": sorted(dependencies)}


def _descriptor_state(dsh: DshDesktop) -> tuple[int, float]:
    try:
        data = json.loads(dsh.descriptor.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0, 0.0
    pid = data.get("pid")
    updated = data.get("updated_at")
    return (pid if type(pid) is int and pid > 0 else 0,
            float(updated) if isinstance(updated, (int, float)) and updated > 0 else 0.0)


def _wait_descriptor(dsh: DshDesktop, previous_pid: int, started: float) -> dict[str, Any]:
    deadline = time.monotonic() + DESCRIPTOR_TIMEOUT
    while time.monotonic() < deadline:
        status = dsh.status()
        pid, updated = _descriptor_state(dsh)
        if status.get("running") and pid and pid == int(status.get("pid") or 0) and pid != previous_pid:
            return {"pid": pid, "updated_at": updated, "status": status}
        time.sleep(0.75)
    raise DshPluginError("插件已安装，但 DSH 没有发布新的 surface 描述符",
                         "dsh_plugin_descriptor_missing")


def install(dsh: DshDesktop, *, restart: bool = True) -> dict[str, Any]:
    """Install the Tether plugin and its DSH UI dependencies via the official CLI."""
    with _INSTALL_LOCK:
        started = time.time()
        status = dsh.status()
        if not status.get("installed"):
            raise DshPluginError("DSH 未安装", "dsh_not_installed")
        previous_pid = int(status.get("pid") or 0)
        previous_running = bool(status.get("running"))
        if status.get("running"):
            dsh.stop()
        profile = _ensure_profile(dsh)
        backup = _backup_profile(profile)
        packages, version = _staged_packages(dsh)
        cli = _find_cli(str(status.get("exe") or ""))
        if cli is None:
            _restore_profile(profile, backup)
            _restart_after_failure(dsh, previous_running, previous_pid, started)
            raise DshPluginError("找不到 DSH CLI，无法安装插件", "dsh_cli_missing")
        plugin_path = packages / "dsh-plugin-tether"
        try:
            _prepare_profile_dependency(profile, plugin_path)
            _run_cli(cli, dsh.dsh_home,
                     ["plugin", "--profile", PROFILE, "add", _file_spec(plugin_path)])
            verified = _verify_profile(profile)
        except Exception:
            _restore_profile(profile, backup)
            _restart_after_failure(dsh, previous_running, previous_pid, started)
            raise
        descriptor: dict[str, Any] = {}
        if restart:
            dsh.start()
            descriptor = _wait_descriptor(dsh, previous_pid, started)
        final = dsh.status()
        return {
            "ok": True,
            "installed": final.get("installed", True),
            "running": final.get("running", False),
            "pid": final.get("pid", 0),
            "version": final.get("version", ""),
            "version_plugin": version,
            "profile": PROFILE,
            "profile_path": str(profile),
            "backup": str(backup),
            "cli": str(cli),
            "packages": verified["versions"],
            "dependencies": verified["dependencies"],
            "descriptor": descriptor,
            "elapsed": round(time.time() - started, 2),
        }
