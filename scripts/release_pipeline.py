#!/usr/bin/env python3
"""Entry point for the v1 release pipeline.

`status` and `plan` inspect the checkout and print what would be built.
`bump` rewrites the four version sources; it is a dry run unless --write is
passed. `build` and `promote` deliberately do not act: they print the exact
manual command and exit 2. Nothing here uploads, publishes, signs or touches
the Hub. See docs/RELEASE_PIPELINE.md.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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


def refuse(action: str, version: str, channel: str) -> int:
    tag = _tag(version, channel) if version else "<version>"
    print(f"`{action}` is not wired on purpose; this script never dispatches or publishes.")
    print("Manual path after approval:")
    print(f"  gh workflow run release-matrix.yml -f version={version or '<version>'} -f channel={channel} -f sign=false")
    print(f"  # then scripts/qa_release_artifacts.py against the draft {tag}")
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
    for name in ("build", "promote"):
        command = sub.add_parser(name, help="refuse and print the manual command")
        command.add_argument("--version", default="")
        command.add_argument("--channel", default="preview", choices=("preview", "stable"))
    args = parser.parse_args(argv)
    if args.command == "status":
        return status(args.expect)
    if args.command == "plan":
        return plan(args.version, args.channel)
    if args.command == "bump":
        return bump(ROOT, args.version, args.write)
    return refuse(args.command, args.version, args.channel)


if __name__ == "__main__":
    raise SystemExit(main())