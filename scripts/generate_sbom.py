#!/usr/bin/env python3
"""Generate a CycloneDX SBOM for the Tether release.

Reads the two npm lockfiles, pyproject dependencies, and the first-party
component versions. It intentionally emits names/versions only; no tokens,
local paths, or machine-specific data are included.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def npm_components(lockfile: Path) -> list[dict]:
    try:
        data = json.loads(lockfile.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    components = []
    for key, value in (data.get("packages") or {}).items():
        if not key or not isinstance(value, dict):
            continue
        name = value.get("name")
        if not isinstance(name, str) or not name:
            name = key.rsplit("node_modules/", 1)[-1]
        version = value.get("version")
        if not isinstance(name, str) or not name or not isinstance(version, str):
            continue
        component = {"type": "library", "name": name, "version": version,
                     "purl": f"pkg:npm/{name}@{version}"}
        license_name = value.get("license")
        if isinstance(license_name, str) and license_name:
            component["licenses"] = [{"license": {"name": license_name}}]
        components.append(component)
    return components


def python_components() -> list[dict]:
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r"(?ms)^\[project\].*?^dependencies\s*=\s*\[(.*?)\]", text)
    if not match:
        return []
    components = []
    for raw in re.findall(r'"([^"]+)"', match.group(1)):
        parsed = re.match(r"^([A-Za-z0-9_.-]+)\s*(.*)$", raw.strip())
        if not parsed:
            continue
        name = parsed.group(1)
        spec = parsed.group(2).strip() or "*"
        version = spec[2:].strip() if spec.startswith("==") else spec
        component = {"type": "library", "name": name, "version": version or "*",
                     "purl": f"pkg:pypi/{name.lower()}"}
        components.append(component)
    return components


def first_party() -> list[dict]:
    version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]
    return [
        {"type": "application", "name": "tether-app", "version": version["app"]},
        {"type": "application", "name": "tether-node", "version": version["node"]},
        {"type": "library", "name": "tether-dsh-plugin", "version": version["plugin"]},
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="docs/sbom.cdx.json")
    args = parser.parse_args()
    components = first_party()
    components.extend(npm_components(ROOT / "apps" / "tether-app" / "package-lock.json"))
    components.extend(npm_components(ROOT / "packages" / "tether-ui" / "package-lock.json"))
    components.extend(python_components())
    unique = {}
    for component in components:
        key = (component["name"], component.get("version", ""), component.get("purl", ""))
        unique[key] = component
    ordered = [unique[key] for key in sorted(unique)]
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "Tether",
                "version": json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["app"],
            }
        },
        "components": ordered,
    }
    target = ROOT / args.out
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT)} with {len(ordered)} components")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())