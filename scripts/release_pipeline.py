#!/usr/bin/env python3
"""Entry point for the v1 release pipeline.

`status` and `plan` inspect the checkout and print what would be built.
`bump` rewrites the four version sources; it is a dry run unless --write is
passed. `run` drives the whole chain in order — bump, build, test, gate,
publish, pin — by calling the entry points that already exist (the matrix
workflow, `scripts/release_gate.py`, the Hub pin route). It does not invent a
second release path.

Everything that leaves this machine is off by default. A bare `run` is a local
readiness report: it bumps in dry-run, runs the update test suites and the
release gate, and refuses `build`, `publish` and `pin` because a CI dispatch
burns minutes and creates a draft, a public release is visible to every device,
and a pin repoints the whole fleet. Name those stages in --approve to let them
act: `--approve build,test` style, comma separated.

Credentials come from the environment and are never printed:
GITHUB_PAT_TOKEN (repo scopes) and TETHER_HUB_OWNER_TOKEN (owner session).
Progress lands in `.scratch/release-run/<version>/state.json` so a watcher can
poll one file and only surface anomalies. See docs/RELEASE_PIPELINE.md.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Windows 控制台默认 GBK，中文提示会乱码；强制 UTF-8 输出。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

API = "https://api.github.com"
STAGES = ("bump", "build", "test", "gate", "publish", "pin")
CONCLUSION_OK = ("success", "skipped")

# target -> (runner, electron, node_only, reason)
MATRIX = {
    "windows-x64": ("windows-latest", True, True, "P0"),
    "linux-x64": ("ubuntu-22.04", True, True, "P0"),
    "macos-x64": ("macos-15-intel", True, True, "P0"),
    "macos-arm64": ("macos-15", True, True, "P0"),
    "linux-arm64": ("ubuntu-24.04-arm", False, True, "P1 Node-only"),
    "windows-arm64": ("windows-11-arm", False, False, "blocked: codeg-server/herdr"),
}


def _version_json() -> dict:
    return json.loads((ROOT / "version.json").read_text(encoding="utf-8"))


def _pyproject_version() -> str:
    with (ROOT / "pyproject.toml").open("rb") as stream:
        return str(tomllib.load(stream)["project"]["version"])


def _app_version() -> str:
    return str(json.loads((ROOT / "apps" / "tether-app" / "package.json").read_text(encoding="utf-8"))["version"])


def _lock_versions() -> tuple[str, str]:
    lock = json.loads((ROOT / "apps" / "tether-app" / "package-lock.json").read_text(encoding="utf-8"))
    return str(lock.get("version") or ""), str((lock.get("packages") or {}).get("", {}).get("version") or "")


def _tag(version: str, channel: str) -> str:
    return f"v{version}" if channel == "stable" else f"v{version}-preview.1"


def status(expect: str | None) -> int:
    version = _version_json()
    components = version.get("components") or {}
    app = str(components.get("app") or "")
    node = str(components.get("node") or "")
    plugin = str(components.get("plugin") or "")
    pyproject = _pyproject_version()
    packaged = _app_version()
    lock_top, lock_root = _lock_versions()
    rows = [
        ("version.json app", app),
        ("version.json node", node),
        ("version.json plugin", plugin),
        ("pyproject.toml", pyproject),
        ("apps/tether-app/package.json", packaged),
        ("package-lock.json", lock_top),
        ("package-lock root packages", lock_root),
    ]
    for name, value in rows:
        print(f"{name:32} {value}")
    problems = []
    if not re.fullmatch(r"\d+\.\d+\.\d+", app):
        problems.append(f"APP version is not X.Y.Z: {app!r}")
    if node != app:
        problems.append(f"APP ({app}) and Node ({node}) versions differ")
    if pyproject != app:
        problems.append(f"pyproject.toml ({pyproject}) differs from APP ({app})")
    if packaged != app:
        problems.append(f"package.json ({packaged}) differs from APP ({app})")
    if lock_top != app or lock_root != app:
        problems.append(f"package-lock.json ({lock_top}/{lock_root}) differs from APP ({app})")
    if plugin != "0.2.93":
        problems.append(f"plugin {plugin} is not the frozen 0.2.93 channel")
    if expect and app != expect:
        problems.append(f"expected {expect}, found {app}")
    if problems:
        print("\nFAIL")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print(f"\nOK: all version sources agree on {app}")
    return 0


def plan(version: str, channel: str) -> int:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        print(f"invalid version: {version}", file=sys.stderr)
        return 2
    tag = _tag(version, channel)
    print(f"tag      {tag}")
    print(f"channel  {channel}")
    print("\nmatrix")
    for target, (runner, electron, node_only, note) in MATRIX.items():
        kinds = "/".join(kind for kind, enabled in (("app", electron), ("node", node_only)) if enabled) or "-"
        print(f"  {target:14} {runner:16} {kinds:9} {note}")
    print("\nartifacts")
    print(f"  Tether-{version}-win-x64.exe")
    for arch in ("x64", "arm64"):
        print(f"  Tether-{version}-mac-{arch}.dmg|.zip|preview-mac-{arch}.yml")
    print(f"  Tether-{version}-linux-x64.AppImage|.deb")
    print(f"  tether-node-{version}.zip (legacy universal x64)")
    print(f"  tether-node-{version}-linux-arm64.tar.gz|.deb (Node-only, P1)")
    print(f"  tether-update.json (Ed25519 signature)")
    print("\nrequired secrets: TETHER_RELEASE_PRIVATE_KEY")
    print("optional: Windows Authenticode cert, Apple Developer ID + notary credentials")
    return 0


def _replace_once(text: str, pattern: str, replacement: str, path: Path) -> str:
    updated, found = re.subn(pattern, replacement, text, count=1)
    if found != 1:
        raise SystemExit(f"{path}: expected exactly one match for {pattern!r}, found {found}")
    return updated


def _bump_plan(root: Path, version: str) -> list[tuple[Path, str, str]]:
    """Return (path, before, after) for every version source, without writing."""
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"invalid version: {version!r} (expected X.Y.Z)")
    plan: list[tuple[Path, str, str]] = []

    version_json = root / "version.json"
    text = version_json.read_bytes().decode("utf-8")
    components = json.loads(text).get("components")
    if not isinstance(components, dict) or "app" not in components or "node" not in components:
        raise SystemExit(f"{version_json}: components.app and components.node are required")
    updated = text
    for key in ("app", "node"):
        updated = _replace_once(updated, rf'("{key}"\s*:\s*")[^"]*(")', rf"\g<1>{version}\g<2>", version_json)
    plan.append((version_json, text, updated))

    package = root / "apps" / "tether-app" / "package.json"
    text = package.read_bytes().decode("utf-8")
    updated = _replace_once(text, r'(?m)^(\s*"version"\s*:\s*")[^"]*(")', rf"\g<1>{version}\g<2>", package)
    plan.append((package, text, updated))

    lock = root / "apps" / "tether-app" / "package-lock.json"
    text = lock.read_bytes().decode("utf-8")
    updated = _replace_once(text, r'(?m)^(  "version": ")[^"]*(",\r?)$', rf"\g<1>{version}\g<2>", lock)
    anchor = re.search(r'\n    "": \{\r?\n', updated)
    if anchor is None:
        raise SystemExit(f"{lock}: the root packages entry is missing")
    start = anchor.end()
    match = re.search(r'(?m)^(      "version": ")[^"]*(",\r?)$', updated[start:])
    if match is None:
        raise SystemExit(f"{lock}: the root packages version is missing")
    updated = updated[:start] + match.group(1) + version + match.group(2) + updated[start + match.end():]
    plan.append((lock, text, updated))

    pyproject = root / "pyproject.toml"
    text = pyproject.read_bytes().decode("utf-8")
    updated = _replace_once(text, r'(?m)^(version = ")[^"]*("\r?)$', rf"\g<1>{version}\g<2>", pyproject)
    plan.append((pyproject, text, updated))
    _check_bump(plan, version)
    return plan


def _check_bump(plan: list[tuple[Path, str, str]], version: str) -> None:
    contents = {path.name: json.loads(after) for path, _, after in plan if path.suffix == ".json"}
    problems = []
    if contents["version.json"].get("components", {}).get("app") != version:
        problems.append("version.json components.app")
    if contents["version.json"].get("components", {}).get("node") != version:
        problems.append("version.json components.node")
    if contents["package.json"].get("version") != version:
        problems.append("apps/tether-app/package.json")
    lock = contents["package-lock.json"]
    if lock.get("version") != version or (lock.get("packages") or {}).get("", {}).get("version") != version:
        problems.append("apps/tether-app/package-lock.json")
    pyproject = next(after for path, _, after in plan if path.name == "pyproject.toml")
    if tomllib.loads(pyproject).get("project", {}).get("version") != version:
        problems.append("pyproject.toml")
    if problems:
        raise SystemExit("bump would not align: " + ", ".join(problems))


def bump(root: Path, version: str, write: bool) -> int:
    plan = _bump_plan(root, version)
    current = str(json.loads(plan[0][1])["components"].get("app") or "?")
    print(f"bump {current} -> {version}")
    for path, _, _ in plan:
        print(f"  {path.relative_to(root).as_posix()}: {current} -> {version}")
    if not write:
        print("\ndry run: nothing written; pass --write to update all four files")
        return 0
    for path, _, after in plan:
        path.write_bytes(after.encode("utf-8"))
        print(f"wrote {path.relative_to(root).as_posix()}")
    print("\nrun `python scripts/release_pipeline.py status` to confirm alignment")
    return 0


def _github(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    """One GitHub REST call. The token comes from the environment and is never printed."""
    token = os.environ.get("GITHUB_PAT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("GITHUB_PAT_TOKEN is not set; this script will not fall back to gh.")
    request = urllib.request.Request(
        f"{API}{path}",
        data=(json.dumps(body).encode() if body is not None else None),
        method=method,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "User-Agent": "Tether-Release-Pipeline"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        return exc.code, str(exc.read()[:400], "utf-8", "replace")


def _hub(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    base = os.environ.get("TETHER_HUB_URL", "").strip().rstrip("/")
    token = os.environ.get("TETHER_HUB_OWNER_TOKEN", "").strip()
    if not base or not token:
        raise RuntimeError("TETHER_HUB_URL and TETHER_HUB_OWNER_TOKEN are required to pin.")
    request = urllib.request.Request(
        f"{base}{path}",
        data=(json.dumps(body).encode() if body is not None else None),
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=600 if path.endswith("/prepare") else 60) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read(4096)
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw.decode("utf-8", "replace")[:400]


def _repo() -> str:
    raw = subprocess.run(["git", "-C", str(ROOT), "remote", "get-url", "origin"],
                         capture_output=True, text=True, check=True).stdout.strip()
    match = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", raw)
    if not match:
        raise RuntimeError(f"origin is not a GitHub repository: {raw}")
    return f"{match.group(1)}/{match.group(2)}"


def _state_file(version: str) -> Path:
    path = ROOT / ".scratch" / "release-run" / version
    path.mkdir(parents=True, exist_ok=True)
    return path / "state.json"


def _record(version: str, stage: str, status: str, **extra) -> None:
    """Append one stage result so a watcher polls a single file for anomalies."""
    path = _state_file(version)
    state = {"version": version, "stages": {}}
    if path.is_file():
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    state.setdefault("stages", {})[stage] = {"status": status, "at": int(time.time()), **extra}
    state["current"] = stage
    state["anomaly"] = status not in CONCLUSION_OK + ("planned", "dry-run")
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    print(f"[{stage}] {status} " + " ".join(f"{key}={value}" for key, value in extra.items()))


def stage_build(version: str, channel: str, ref: str, sign: bool, poll: float, timeout: float,
                approve: bool = True) -> int:
    """Reuse an existing preview draft, or dispatch the matrix workflow when asked."""
    tag = _tag(version, channel)
    # A dispatch burns CI minutes and creates a draft release, so a bare `run`
    # does not do it. The unattended chain is a local readiness report.
    if not approve:
        _record(version, "build", "refused", tag=tag, ref=ref,
                reason="pass --approve build; this dispatches CI and creates a draft")
        return 2
    repo = _repo()
    status, release = _github("GET", f"/repos/{repo}/releases/tags/{tag}")
    if status == 200:
        _record(version, "build", "existing", tag=tag,
                url=str((release or {}).get("html_url", "")))
        return 0
    _record(version, "build", "running", workflow="release-matrix.yml", tag=tag)
    dispatched = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    status, payload = _github("POST", f"/repos/{repo}/actions/workflows/release-matrix.yml/dispatches",
                              {"ref": ref, "inputs": {"version": version, "channel": channel,
                                                      "sign": "true" if sign else "false"}})
    if status not in (200, 204):
        _record(version, "build", "failed", http=status, detail=str(payload)[:200])
        return 1
    deadline = time.monotonic() + timeout
    run: dict = {}
    while time.monotonic() < deadline:
        time.sleep(poll)
        status, listed = _github("GET", f"/repos/{repo}/actions/workflows/release-matrix.yml/runs?event=workflow_dispatch"
                                        "&per_page=20")
        items = (listed or {}).get("workflow_runs", []) if status == 200 else []
        candidate = next((item for item in items
                          if item.get("display_title") == f"Tether {version} {channel}"
                          and item.get("created_at", "") >= dispatched),
                         None)
        if candidate is None:
            continue
        run = candidate
        print(f"  run {run['id']} status={run.get('status')} "
              f"https://github.com/{repo}/actions/runs/{run['id']}")
        if run.get("status") == "completed":
            conclusion = str(run.get("conclusion"))
            _record(version, "build", conclusion, run_id=run["id"], url=run.get("html_url"))
            return 0 if conclusion in CONCLUSION_OK else 1
    _record(version, "build", "timeout", run_id=run.get("id"))
    return 1


def stage_test(version: str, commit: str) -> int:
    """Exercise the installed-version lookup and Node transaction recovery before the gates."""
    result = subprocess.run([sys.executable, "-m", "pytest", "-q",
                             "tests/test_node_update_protocol.py::test_frozen_windows_desktop_node_reads_installed_version",
                             "tests/test_updates.py::test_node_transaction_rolls_back_after_manager_recreation",
                             "tests/test_updates.py::test_node_rollback_failure_keeps_recovery_transaction"],
                            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    _record(version, "test", "success" if result.returncode == 0 else "failed", summary=tail[:160])
    return 0 if result.returncode == 0 else 1


def stage_gate(version: str, commit: str) -> int:
    result = subprocess.run([sys.executable, "scripts/release_gate.py", "run",
                             "--version", version, "--commit", commit],
                            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    verdict = "PUBLISH-OK" if result.returncode == 0 else "PUBLISH-BLOCKED"
    _record(version, "gate", verdict, exit=result.returncode)
    print("\n".join(line for line in result.stdout.splitlines() if line.strip())[-4000:])
    return 0 if result.returncode == 0 else 1


def stage_publish(version: str, channel: str, approve: bool) -> int:
    tag = _tag(version, channel)
    # Refuse before the first request: an unapproved run must not even look at
    # GitHub, and a missing tag must not be reported as a failed publish.
    if not approve:
        _record(version, "publish", "refused", tag=tag,
                reason="pass --approve publish; a public release is visible to every device")
        return 2
    repo = _repo()
    status, releases = _github("GET", f"/repos/{repo}/releases/tags/{tag}")
    if status != 200:
        _record(version, "publish", "failed", http=status, tag=tag, detail=str(releases)[:200])
        return 1
    release = releases
    if not release.get("draft"):
        _record(version, "publish", "already-public", tag=tag)
        return 0
    publication = {"draft": False, "make_latest": "true" if channel == "stable" else "false"}
    status, payload = _github("PATCH", f"/repos/{repo}/releases/{release['id']}", publication)
    ok = status == 200
    _record(version, "publish", "success" if ok else "failed", tag=tag, http=status,
            url=(payload or {}).get("html_url") if ok else str(payload)[:200])
    return 0 if ok else 1


def stage_pin(version: str, channel: str, approve: bool) -> int:
    if not approve:
        _record(version, "pin", "refused", target=version,
                reason="pass --approve pin; this points every device feed at this version")
        return 2
    body = {"version": version}

    def reason(payload):
        detail = payload.get("detail", payload) if isinstance(payload, dict) else {}
        return detail.get("code") if isinstance(detail, dict) else None

    status, payload = _hub("POST", "/api/releases/pin", body)
    if status in (404, 409) and reason(payload) in {"manifest_not_found", "version_not_cached"}:
        # A newly published preview may be indexed only after release discovery.
        status, payload = _hub("POST", "/api/releases/refresh", {})
        if status == 200:
            status, payload = _hub("POST", "/api/releases/pin", body)
    if status == 409 and reason(payload) == "version_artifacts_not_cached":
        status, payload = _hub("POST", "/api/releases/prepare", body)
        if status == 200:
            status, payload = _hub("POST", "/api/releases/pin", body)
    ok = status == 200
    _record(version, "pin", "success" if ok else "failed", http=status,
            detail=str(payload)[:200] if not ok else "")
    return 0 if ok else 1


def run_chain(version: str, channel: str, until: str, approve: set[str], ref: str,
              sign: bool, write: bool) -> int:
    if version not in STAGES and not re.fullmatch(r"\d+\.\d+\.\d+", version):
        print(f"invalid version: {version}", file=sys.stderr)
        return 2
    if until not in STAGES:
        print(f"--until must be one of {STAGES}", file=sys.stderr)
        return 2
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                            capture_output=True, text=True).stdout.strip()
    order = STAGES[:STAGES.index(until) + 1]
    refused: list[str] = []
    print(f"release run {version} channel={channel} stages={'->'.join(order)} approve={sorted(approve)}")
    print(f"commit {commit[:9]} ref={ref} state={_state_file(version).relative_to(ROOT).as_posix()}")
    for stage in order:
        if stage == "bump":
            code = bump(ROOT, version, write)
            if code != 0:
                return code
            _record(version, "bump", "success" if write else "dry-run", write=write)
        elif stage == "build":
            code = stage_build(version, channel, ref, sign, 20.0, 3 * 3600.0,
                               approve="build" in approve)
        elif stage == "test":
            code = stage_test(version, commit)
        elif stage == "gate":
            code = stage_gate(version, commit)
            if code != 0:
                print("\nPUBLISH-BLOCKED：查看上方失败项和对应日志。")
        elif stage == "publish":
            code = stage_publish(version, channel, "publish" in approve)
        elif stage == "pin":
            code = stage_pin(version, channel, "pin" in approve)
        else:
            code = 0
        # A failure (1) stops the chain. A refusal (2) means "I did not do this
        # because you did not approve it", which is not an error: keep going so a
        # single run reports every approval that is still missing.
        if code == 1:
            return code
        if code == 2:
            refused.append(stage)
    if refused:
        print(f"\n未执行（缺批准）：{', '.join(refused)}。重跑并加 --approve {','.join(refused)}")
        return 2
    if "publish" not in approve or "pin" not in approve:
        print("\n本轮没有对外可见的动作。要发布/切 pin，重跑并加 --approve publish,pin。")
    return 0


def refuse(action: str, version: str, channel: str) -> int:
    print(f"`{action}` was the pre-automation stub and is retired; the chain is one command now.")
    print("Use:")
    print(f"  python scripts/release_pipeline.py run --version {version or '<version>'} "
          f"--channel {channel}")
    print("It stops after `gate` unless you pass --approve publish,pin.")
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    status_parser = sub.add_parser("status", help="check version alignment")
    status_parser.add_argument("--expect")
    plan_parser = sub.add_parser("plan", help="print matrix and artifact names")
    plan_parser.add_argument("--version", required=True)
    plan_parser.add_argument("--channel", default="preview", choices=("preview", "stable"))
    bump_parser = sub.add_parser("bump", help="rewrite the four version sources (dry run by default)")
    bump_parser.add_argument("--version", required=True)
    bump_parser.add_argument("--write", action="store_true", help="apply the rewrite")
    run_parser = sub.add_parser("run", help="bump -> build -> test -> gate -> publish -> pin")
    run_parser.add_argument("--version", required=True)
    run_parser.add_argument("--channel", default="preview", choices=("preview", "stable"))
    run_parser.add_argument("--until", default="gate", choices=STAGES,
                            help="last stage to attempt (default gate: nothing externally visible)")
    run_parser.add_argument("--approve", default="",
                            help="comma list of stages that may leave this machine: build,publish,pin")
    run_parser.add_argument("--ref", default=None, help="branch/tag the workflow dispatches on")
    run_parser.add_argument("--sign", action="store_true", help="ask CI to sign (needs certs)")
    run_parser.add_argument("--write", action="store_true", help="let the bump stage rewrite files")
    for name in ("build", "promote"):
        command = sub.add_parser(name, help="retired stub; prints the run command")
        command.add_argument("--version", default="")
        command.add_argument("--channel", default="preview", choices=("preview", "stable"))
    args = parser.parse_args(argv)
    if args.command == "status":
        return status(args.expect)
    if args.command == "plan":
        return plan(args.version, args.channel)
    if args.command == "bump":
        return bump(ROOT, args.version, args.write)
    if args.command == "run":
        ref = args.ref or subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--abbrev-ref", "HEAD"],
                                         capture_output=True, text=True).stdout.strip()
        return run_chain(args.version, args.channel, args.until,
                         {item.strip() for item in args.approve.split(",") if item.strip()},
                         ref, args.sign, args.write)
    return refuse(args.command, args.version, args.channel)


if __name__ == "__main__":
    raise SystemExit(main())