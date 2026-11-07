from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


def _bash_executable() -> str | None:
    if os.name == "nt":
        git_bash = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git" / "bin" / "bash.exe"
        if git_bash.is_file():
            return str(git_bash)
    return shutil.which("bash")


def _node_archive(version: str) -> bytes:
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"tether-node-{version}/pyproject.toml", "[project]\nname='fixture-node'\nversion='0.0.0'\n")
    return data.getvalue()


def _shell_path(path: Path) -> str:
    value = str(path)
    if os.name == "nt":
        cygpath = shutil.which("cygpath")
        if not cygpath:
            git_cygpath = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git" / "usr" / "bin" / "cygpath.exe"
            cygpath = str(git_cygpath) if git_cygpath.is_file() else None
        if cygpath:
            return subprocess.check_output([cygpath, "-u", value], encoding="utf-8").strip()
        bash = shutil.which("bash")
        if bash:
            drive, tail = os.path.splitdrive(value)
            if drive and len(drive) == 2:
                return f"/mnt/{drive[0].lower()}/{tail.replace(chr(92), '/').lstrip('/')}"
        pytest.skip("Git Bash cygpath or WSL wslpath is required for the Windows bash fixture")
    return value


def _python3_wrapper(path: Path) -> None:
    path.write_text(
        """#!/usr/bin/env bash
if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"venv\" ]; then
  mkdir -p \"$3/bin\"
  cat > \"$3/bin/python\" <<'INNER'
#!/usr/bin/env bash
if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ]; then exit 0; fi
exit 1
INNER
  chmod +x \"$3/bin/python\"
  exit 0
fi
REAL_PYTHON=\"$TETHER_TEST_REAL_PYTHON\"
exec \"$REAL_PYTHON\" \"$@\"
""",
        encoding="utf-8",
        newline="\n",
    )
    path.chmod(0o755)


def _run_installer(tmp_path: Path, short_responses: int, *, resolve_latest: bool = False) -> tuple[subprocess.CompletedProcess[str], int, bytes]:
    bash = _bash_executable()
    if not bash:
        pytest.skip("bash and curl are required for the install-node HTTP fixture")
    shell_curl = subprocess.check_output([bash, "-c", "command -v curl"], encoding="utf-8").strip()
    shell_path = subprocess.check_output([bash, "-c", "printf %s \"$PATH\""], encoding="utf-8").strip()
    if not shell_curl:
        pytest.skip("bash and curl are required for the install-node HTTP fixture")

    version = "9.8.7"
    payload = _node_archive(version)

    class Handler(BaseHTTPRequestHandler):
        requests = 0

        def do_GET(self) -> None:
            if self.path == "/install/version.json":
                body = json.dumps({"components": {"node": version}}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            type(self).requests += 1
            if self.path != f"/install/tether-node-{version}.zip":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if type(self).requests <= short_responses:
                self.wfile.write(payload[: max(1, len(payload) // 3)])
                self.wfile.flush()
                self.close_connection = True
                return
            self.wfile.write(payload)

        def log_message(self, _format: str, *_args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        home = tmp_path / "home"
        prefix = tmp_path / "prefix"
        bin_dir = tmp_path / "bin"
        home.mkdir()
        bin_dir.mkdir()
        _python3_wrapper(bin_dir / "python3")
        target = prefix / f"tether-node-{version}.zip"
        prefix.mkdir()
        target.write_bytes(b"previous complete archive")
        env = os.environ.copy()
        env.update({
            "HOME": _shell_path(home),
            "PATH": _shell_path(bin_dir) + ":" + shell_path,
            "TETHER_TEST_REAL_PYTHON": _shell_path(Path(sys.executable)) if os.name == "nt" else sys.executable,
        })
        if os.name == "nt":
            env["MSYS"] = "winsymlinks:native"
        source_script = Path(__file__).resolve().parents[1] / "laptop" / "install-node.sh"
        script = tmp_path / "install-node.sh"
        script.write_text(source_script.read_text(encoding="utf-8").replace("\r\n", "\n"),
                          encoding="utf-8", newline="\n")
        command = [bash, _shell_path(script), "--controller", "wss://127.0.0.1/ws/node",
                   "--base-url", f"http://127.0.0.1:{server.server_port}/install"]
        if not resolve_latest:
            command.extend(["--version", version])
        command.extend(["--prefix", _shell_path(prefix), "--no-systemd", "--install-only"])
        result = subprocess.run(
            command,
            cwd=tmp_path, env=env, encoding="utf-8", capture_output=True, timeout=60,
        )
        return result, Handler.requests, payload
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_network_download_retries_a_short_response_before_promoting_archive(tmp_path: Path) -> None:
    result, requests, payload = _run_installer(tmp_path, short_responses=1)

    assert result.returncode == 0, result.stdout + result.stderr
    assert requests == 2
    target = tmp_path / "prefix" / "tether-node-9.8.7.zip"
    assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(payload).digest()
    assert (tmp_path / "prefix" / "tether-node-9.8.7" / "pyproject.toml").is_file()


def test_exhausted_short_download_preserves_existing_archive_and_does_not_install(tmp_path: Path) -> None:
    result, requests, _payload = _run_installer(tmp_path, short_responses=3)

    assert result.returncode != 0
    assert requests == 3
    assert "complete valid archive after 3 attempts" in result.stderr
    assert (tmp_path / "prefix" / "tether-node-9.8.7.zip").read_bytes() == b"previous complete archive"
    assert not (tmp_path / "prefix" / "tether-node-9.8.7").exists()
    assert not (tmp_path / "prefix" / "venv").exists()
    assert not (tmp_path / "home" / ".local" / "bin" / "tether-node").exists()


def test_latest_with_explicit_base_url_resolves_mirror_version_json(tmp_path: Path) -> None:
    result, requests, payload = _run_installer(tmp_path, short_responses=0, resolve_latest=True)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "latest node version: 9.8.7" in result.stdout
    assert requests == 1
    assert hashlib.sha256((tmp_path / "prefix" / "tether-node-9.8.7.zip").read_bytes()).digest() == hashlib.sha256(payload).digest()


def test_default_latest_resolution_uses_the_published_release_manifest() -> None:
    source = (Path(__file__).resolve().parents[1] / "laptop" / "install-node.sh").read_text(encoding="utf-8")

    assert 'BASE_URL="${TETHER_ASSET_BASE:-}"' in source
    assert 'releases/latest/download/tether-update.json' in source
    assert 'releases/download/v$VERSION/tether-node-$VERSION.zip' in source
