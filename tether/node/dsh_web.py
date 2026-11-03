"""Install and run DeepSeek Harness Web on a Linux node.

This is the Linux counterpart of the Windows DSH desktop installer: Node 24 and
the public @deepseek-ai/dsh package are installed under /opt/tether-node/dsh-web,
then run as tether-dsh-web.service. The wrapper publishes the per-process token
URL to apps.json so the APP's 远程应用 page can show it.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tarfile
import threading
import urllib.request
from pathlib import Path
from typing import Any

NODE_VERSION = "v24.22.2"
ROOT = Path("/opt/tether-node/dsh-web")
NODE_DIR = ROOT / f"node-{NODE_VERSION}-linux-x64"
NODE = NODE_DIR / "bin" / "node"
NPM = NODE_DIR / "bin" / "npm"
ENTRY = ROOT / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"
UNIT = Path("/etc/systemd/system/tether-dsh-web.service")
GATEWAY_UNIT = Path("/etc/systemd/system/tether-dsh-gateway.service")
APP_PORT = 3080
GATEWAY_PORT = 37301


def _run(command: list[str], timeout: float = 900, cwd: Path | None = None) -> None:
    env = os.environ.copy()
    env["HOME"] = "/root"
    env["PATH"] = str(NODE_DIR / "bin") + ":/usr/local/bin:/usr/bin:/bin"
    subprocess.run(command, cwd=str(cwd or ROOT), env=env, timeout=timeout,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


class DshWeb:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self._installing = False
        self._lock = threading.Lock()

    def _systemctl(self, action: str) -> bool:
        try:
            result = subprocess.run(["systemctl", action, "tether-dsh-web"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=60)
            return result.returncode == 0
        except Exception:
            return False

    def _installed(self) -> bool:
        return NODE.is_file() and ENTRY.is_file()

    def _running(self) -> bool:
        try:
            result = subprocess.run(["systemctl", "is-active", "tether-dsh-web"],
                                    capture_output=True, text=True, timeout=10)
            return result.stdout.strip() == "active"
        except Exception:
            return False

    def _url(self) -> str:
        try:
            data = json.loads((self.data_dir / "apps.json").read_text(encoding="utf-8"))
            for item in data.get("apps") or []:
                if item.get("name") == "DSH Web":
                    return str(item.get("url") or "") + str(item.get("path") or "")
        except (OSError, ValueError):
            pass
        return ""

    def status(self) -> dict[str, Any]:
        installed = self._installed()
        running = installed and self._running()
        return {"supported": os.name != "nt", "installed": installed, "running": running,
                "installing": self._installing, "url": self._url(),
                "port": GATEWAY_PORT, "version": "0.2.1-rc.5", "device_id": ""}

    def start(self) -> dict[str, Any]:
        if not self._installed():
            return {**self.status(), "error": "DSH Web is not installed"}
        self._systemctl("start")
        return self.status()

    def stop(self) -> dict[str, Any]:
        self._systemctl("stop")
        return self.status()

    def install(self) -> dict[str, Any]:
        if os.name == "nt":
            return {**self.status(), "error": "DSH Web installation is for Linux only"}
        if self._installed():
            return self.start()
        with self._lock:
            if self._installing:
                return self.status()
            self._installing = True
        threading.Thread(target=self._install_worker, daemon=True).start()
        return self.status()

    def _install_worker(self) -> None:
        try:
            ROOT.mkdir(parents=True, exist_ok=True)
            if not NODE.is_file():
                archive = ROOT / f"node-{NODE_VERSION}-linux-x64.tar.xz"
                if not archive.is_file():
                    url = f"https://nodejs.org/dist/{NODE_VERSION}/node-{NODE_VERSION}-linux-x64.tar.xz"
                    urllib.request.urlretrieve(url, archive)
                with tarfile.open(archive, "r:xz") as bundle:
                    bundle.extractall(ROOT)
            if not (ROOT / "package.json").is_file():
                _run([str(NPM), "init", "-y"])
            if not ENTRY.is_file():
                _run([str(NPM), "install", "--no-audit", "--no-fund", "@deepseek-ai/dsh"])
            source = Path(__file__).with_name("dsh_web_run.py")
            shutil.copyfile(source, ROOT / "run.py")
            os.chmod(ROOT / "run.py", 0o755)
            UNIT.write_text(
                "[Unit]\nDescription=DeepSeek Harness Web (Tether managed)\n"
                "After=network.target\n\n[Service]\nType=simple\n"
                f"WorkingDirectory={ROOT}\nEnvironment=HOME=/root\n"
                f"Environment=PATH={NODE_DIR / 'bin'}:/usr/local/bin:/usr/bin:/bin\n"
                f"ExecStart=/usr/bin/python3 {ROOT / 'run.py'}\n"
                "Restart=always\nRestartSec=3\nMemoryHigh=300M\nMemoryMax=600M\n\n"
                "[Install]\nWantedBy=multi-user.target\n", encoding="utf-8")
            GATEWAY_UNIT.write_text(
                "[Unit]\nDescription=Tether DSH Web gateway (EasyTier private address)\n"
                "After=network-online.target tether-dsh-web.service\n"
                "Wants=network-online.target\n\n[Service]\nType=simple\n"
                "ExecStart=/opt/tether-node/venv/bin/python -m tether.node.app_gateway "
                "--listen 10.144.0.1 --app \"DSH Web:37301:127.0.0.1:3080\"\n"
                "Restart=always\nRestartSec=3\nMemoryHigh=80M\nMemoryMax=160M\n\n"
                "[Install]\nWantedBy=multi-user.target\n", encoding="utf-8")
            _run(["systemctl", "daemon-reload"])
            _run(["systemctl", "enable", "--now", "tether-dsh-web"])
            _run(["systemctl", "enable", "--now", "tether-dsh-gateway"])
        except Exception:
            pass
        finally:
            self._installing = False
