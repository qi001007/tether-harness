"""Unit tests for the deepseek-acp optional-MCP in-place patch.

The patched artifact is the compiled ``lib/mcp/spec.js`` where
``toMountSpec()`` hardcodes ``failOnStartupError: true`` for both the stdio and
streamable-http branches.  A single unreachable optional MCP server then makes
``session/new`` / ``session/load`` / ``session/resume`` fail outright instead of
only logging a warning.  These tests drive the patch purely through temp dirs —
no real npm installs and no network access.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from tether.node import agents_runtime
from tether.node.agents_runtime import (
    DEEPSEEK_ACP_PATCH_REV,
    DEEPSEEK_ACP_VERSION,
    AgentsRuntime,
)

UNPATCHED_SPEC_JS = """\
import { publicServerName } from './naming.js';
/** 翻译失败：客户端送来了本部署无法承载的 server。 */
export class UnsupportedMcpServer extends Error {
}
function toRecord(pairs) {
    const out = {};
    for (const pair of pairs)
        out[pair.name] = pair.value;
    return out;
}
export function toMountSpec(server, sessionSeq) {
    const serverName = publicServerName(sessionSeq, server.name);
    if (!('type' in server)) {
        return {
            transport: 'stdio',
            serverName,
            command: server.command,
            args: [...server.args],
            env: toRecord(server.env),
            failOnStartupError: true,
        };
    }
    if (server.type === 'http') {
        return {
            transport: 'streamable-http',
            serverName,
            url: server.url,
            headers: toRecord(server.headers),
            failOnStartupError: true,
        };
    }
    throw new UnsupportedMcpServer(`MCP transport "${server.type}" is not supported (server "${server.name}")`);
}
export function toMountSpecs(servers, sessionSeq) {
    return servers.map((server) => toMountSpec(server, sessionSeq));
}
"""

SPEC_TS = """\
import { publicServerName } from './naming.js'
export type McpMountSpec =
  | {
      readonly transport: 'stdio'
      readonly failOnStartupError: true
    }
  | {
      readonly transport: 'streamable-http'
      readonly failOnStartupError: true
    }
export class UnsupportedMcpServer extends Error {}
export function toMountSpec(server, sessionSeq) {
  if (!('type' in server)) {
    return { transport: 'stdio', failOnStartupError: true }
  }
  if (server.type === 'http') {
    return { transport: 'streamable-http', failOnStartupError: true }
  }
  throw new UnsupportedMcpServer('unsupported')
}
"""

SPEC_DTS = """\
export type McpMountSpec = {
    readonly transport: 'stdio';
    readonly failOnStartupError: true;
} | {
    readonly transport: 'streamable-http';
    readonly failOnStartupError: true;
};
"""

NAMING_JS = "export function publicServerName(sessionSeq, userServerName) { return String(userServerName); }\n"


@pytest.fixture()
def runtime(tmp_path: Path) -> AgentsRuntime:
    return AgentsRuntime(tmp_path / "data", tmp_path / "workspace")


def _package_dir(home: Path, layout: str) -> Path:
    if layout == "posix":
        return home / "lib" / "node_modules" / "deepseek-acp"
    return home / "node_modules" / "deepseek-acp"


def _make_package(home: Path, layout: str = "windows", *, version: str = DEEPSEEK_ACP_VERSION) -> Path:
    pkg = _package_dir(home, layout)
    (pkg / "lib" / "mcp").mkdir(parents=True)
    (pkg / "src" / "mcp").mkdir(parents=True)
    (pkg / "lib" / "types" / "mcp").mkdir(parents=True)
    (pkg / "package.json").write_text(
        json.dumps({"name": "deepseek-acp", "version": version, "type": "module"}), encoding="utf-8")
    (pkg / "lib" / "mcp" / "spec.js").write_text(UNPATCHED_SPEC_JS, encoding="utf-8")
    (pkg / "lib" / "mcp" / "naming.js").write_text(NAMING_JS, encoding="utf-8")
    (pkg / "src" / "mcp" / "spec.ts").write_text(SPEC_TS, encoding="utf-8")
    (pkg / "lib" / "mcp" / "spec.d.ts").write_text(SPEC_DTS, encoding="utf-8")
    (pkg / "lib" / "types" / "mcp" / "spec.d.ts").write_text(SPEC_DTS, encoding="utf-8")
    # Fake launcher so _deepseek_acp_binary() discovers an executable.
    (home / "deepseek-acp").write_text("#!/bin/sh\n", encoding="utf-8")
    return pkg


def _fake_run(converter, calls: list[list[str]]):
    def run(command, **_kwargs):
        calls.append(list(command))
        return SimpleNamespace(stdout=converter, stderr="")
    return run


def test_constants_exposed() -> None:
    assert DEEPSEEK_ACP_VERSION == "0.11.0"
    assert DEEPSEEK_ACP_PATCH_REV == "tether-mcp-optional-v1"


def test_package_dir_detects_both_layouts(tmp_path: Path) -> None:
    windows_home = tmp_path / "win"
    windows_pkg = _make_package(windows_home, "windows")
    assert AgentsRuntime._deepseek_acp_package_dir(windows_home) == windows_pkg

    posix_home = tmp_path / "posix"
    posix_pkg = _make_package(posix_home, "posix")
    assert AgentsRuntime._deepseek_acp_package_dir(posix_home) == posix_pkg

    assert AgentsRuntime._deepseek_acp_package_dir(tmp_path / "empty") is None


def test_patch_status_reports_unpatched_then_patched(tmp_path: Path, runtime: AgentsRuntime) -> None:
    home = tmp_path / "home"
    _make_package(home)
    assert AgentsRuntime._deepseek_acp_patch_status(home) == (False, "unpatched")
    assert runtime._patch_deepseek_acp(home) is True
    assert AgentsRuntime._deepseek_acp_patch_status(home) == (True, DEEPSEEK_ACP_PATCH_REV)


def test_patch_status_missing_package(tmp_path: Path) -> None:
    assert AgentsRuntime._deepseek_acp_patch_status(tmp_path / "home") == (False, "missing")


def test_ensure_patches_unpatched_windows_install_in_place(tmp_path: Path, runtime: AgentsRuntime, monkeypatch) -> None:
    home = tmp_path / "home"
    pkg = _make_package(home, "windows")
    calls: list[list[str]] = []
    monkeypatch.setattr(agents_runtime.subprocess, "run", _fake_run("0.11.0", calls))

    assert runtime._deepseek_acp_current(home) is False

    runtime._ensure_deepseek_acp(home)

    # No npm install was attempted; only the version probe ran.
    assert all("install" not in part for command in calls for part in command), calls

    spec = (pkg / "lib" / "mcp" / "spec.js").read_text(encoding="utf-8")
    assert "failOnStartupError: true" not in spec
    assert spec.count("failOnStartupError: false") == 2
    # Both transports patched, UnsupportedMcpServer preserved.
    assert spec.count("transport: 'stdio'") == 1
    assert spec.count("transport: 'streamable-http'") == 1
    assert "class UnsupportedMcpServer" in spec
    assert "throw new UnsupportedMcpServer" in spec

    ts = (pkg / "src" / "mcp" / "spec.ts").read_text(encoding="utf-8")
    assert "readonly failOnStartupError: boolean" in ts
    assert ts.count("failOnStartupError: false") == 2
    assert "failOnStartupError: true" not in ts

    for dts_rel in ("lib/mcp/spec.d.ts", "lib/types/mcp/spec.d.ts"):
        dts = (pkg / dts_rel).read_text(encoding="utf-8")
        assert "readonly failOnStartupError: true;" not in dts
        assert dts.count("readonly failOnStartupError: boolean;") == 2

    marker = json.loads((pkg / ".tether-patch.json").read_text(encoding="utf-8"))
    assert marker["revision"] == DEEPSEEK_ACP_PATCH_REV
    assert marker["version"] == DEEPSEEK_ACP_VERSION
    assert "lib/mcp/spec.js" in marker["patched_files"]

    assert runtime._deepseek_acp_current(home) is True


def test_ensure_patches_posix_layout(tmp_path: Path, runtime: AgentsRuntime, monkeypatch) -> None:
    home = tmp_path / "home"
    pkg = _make_package(home, "posix")
    calls: list[list[str]] = []
    monkeypatch.setattr(agents_runtime.subprocess, "run", _fake_run("0.11.0", calls))

    assert AgentsRuntime._deepseek_acp_package_dir(home) == pkg
    assert runtime._deepseek_acp_current(home) is False
    runtime._ensure_deepseek_acp(home)

    spec = (pkg / "lib" / "mcp" / "spec.js").read_text(encoding="utf-8")
    assert spec.count("failOnStartupError: false") == 2
    assert runtime._deepseek_acp_current(home) is True


def test_patch_is_idempotent(tmp_path: Path, runtime: AgentsRuntime, monkeypatch) -> None:
    home = tmp_path / "home"
    pkg = _make_package(home)
    calls: list[list[str]] = []
    monkeypatch.setattr(agents_runtime.subprocess, "run", _fake_run("0.11.0", calls))

    assert runtime._patch_deepseek_acp(home) is True
    first_spec = (pkg / "lib" / "mcp" / "spec.js").read_bytes()
    first_marker = (pkg / ".tether-patch.json").read_text(encoding="utf-8")

    assert runtime._patch_deepseek_acp(home) is True
    assert (pkg / "lib" / "mcp" / "spec.js").read_bytes() == first_spec
    assert (pkg / ".tether-patch.json").read_text(encoding="utf-8") == first_marker

    # _ensure_deepseek_acp short-circuits when already current.
    runtime._ensure_deepseek_acp(home)
    assert (pkg / "lib" / "mcp" / "spec.js").read_bytes() == first_spec
    assert runtime._deepseek_acp_current(home) is True


def test_unexpected_spec_js_fails_without_corruption(tmp_path: Path, runtime: AgentsRuntime) -> None:
    home = tmp_path / "home"
    pkg = _make_package(home)
    spec = pkg / "lib" / "mcp" / "spec.js"
    garbage = "export const unrelated = 1;\nfailOnStartupError: true;\n"
    spec.write_text(garbage, encoding="utf-8")

    assert runtime._patch_deepseek_acp(home) is False
    assert spec.read_text(encoding="utf-8") == garbage
    assert not (pkg / ".tether-patch.json").exists()


def test_wrong_true_count_fails_without_corruption(tmp_path: Path, runtime: AgentsRuntime) -> None:
    home = tmp_path / "home"
    pkg = _make_package(home)
    spec = pkg / "lib" / "mcp" / "spec.js"
    broken = UNPATCHED_SPEC_JS.replace(
        "failOnStartupError: true,", "failOnStartupError: true, failOnStartupError: true,")
    spec.write_text(broken, encoding="utf-8")

    assert runtime._patch_deepseek_acp(home) is False
    assert spec.read_text(encoding="utf-8") == broken
    assert not (pkg / ".tether-patch.json").exists()


def test_patched_spec_runs_under_node(tmp_path: Path, runtime: AgentsRuntime) -> None:
    home = tmp_path / "home"
    pkg = _make_package(home)
    assert runtime._patch_deepseek_acp(home) is True

    spec_path = pkg / "lib" / "mcp" / "spec.js"
    patched = spec_path.read_text(encoding="utf-8")
    # Always verify textually, even without node.
    assert patched.count("failOnStartupError: false") == 2
    assert "failOnStartupError: true" not in patched

    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for behavioural check")

    harness = tmp_path / "harness.mjs"
    harness.write_text(
        "import { pathToFileURL } from 'node:url';\n"
        "const spec = await import(pathToFileURL(process.argv[2]).href);\n"
        "const stdio = { name: 'github', command: 'gh', args: [], env: [{ name: 'A', value: 'b' }] };\n"
        "const http = { name: 'remote', type: 'http', url: 'https://github.run.tools', headers: [] };\n"
        "const sse = { name: 'old', type: 'sse', url: 'https://example.invalid' };\n"
        "const mounts = spec.toMountSpecs([stdio, http], 0);\n"
        "let sseThrew = false;\n"
        "try { spec.toMountSpec(sse, 0); } catch (err) { sseThrew = err instanceof spec.UnsupportedMcpServer; }\n"
        "console.log(JSON.stringify({ stdio: mounts[0].failOnStartupError,"
        " http: mounts[1].failOnStartupError, sseThrew }));\n",
        encoding="utf-8")

    completed = subprocess.run(
        [node, str(harness), str(spec_path)],
        capture_output=True, text=True, timeout=60)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout.strip().splitlines()[-1])
    assert result == {"stdio": False, "http": False, "sseThrew": True}