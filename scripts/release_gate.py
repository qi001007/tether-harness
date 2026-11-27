#!/usr/bin/env python3
"""Run Tether's offline release checks. Supply --runtime to exercise an assembled pnpm."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTEST = [sys.executable, "-m", "pytest", "-q"]


def commands(version: str, runtime: str | None) -> dict[str, list[str]]:
    pnpm = (["node", "desktop/packaging/check-dsh-pnpm.cjs", "--runtime", runtime] if runtime else
            ["node", "--test", "--test-isolation=none", "--test-name-pattern=packaged runtime guard",
             "tests/test_candidate_build.mjs"])
    return {
        "ART-2": pnpm,
        "ENT-1": [sys.executable, "scripts/release_gate_entry_uniqueness.py", "--scan-source"],
        "VER-1": [sys.executable, "scripts/release_pipeline.py", "status", "--expect", version],
        "UPD-8": [*PYTEST, "tests/test_update_rollback_script.py",
                  "tests/test_updates.py::test_node_update_waits_for_acceptance_then_commits"],
        "REG-1": [*PYTEST, "tests/test_release_manifest_assembly.py", "tests/test_release_pipeline_run.py"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("list", "run", "auto"))
    parser.add_argument("--version")
    parser.add_argument("--commit")
    parser.add_argument("--only", help="comma-separated gate IDs")
    parser.add_argument("--runtime", help="assembled desktop runtime for the packaged pnpm check")
    parser.add_argument("--evidence-root", default=".scratch/release-gate")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    version = args.version or json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["app"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        parser.error("expected version X.Y.Z")
    gates = commands(version, args.runtime)
    if args.action == "list":
        for name, command in gates.items():
            print(name, *command)
        return 0
    selected = {item.strip() for item in args.only.split(",")} if args.only else set(gates)
    if selected - gates.keys():
        parser.error("unknown gate: " + ", ".join(sorted(selected - gates.keys())))
    out = ROOT / args.evidence_root / version
    out.mkdir(parents=True, exist_ok=True)
    results = {}
    for name, command in gates.items():
        if name not in selected:
            continue
        log = out / f"{name}.log"
        with log.open("w", encoding="utf-8") as stream:
            try:
                result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                        timeout=args.timeout)
                passed = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired) as exc:
                print(exc, file=stream)
                passed = False
        results[name] = "PASS" if passed else "FAIL"
        if not args.json:
            print(name, results[name], log, flush=True)
    verdict = "READY-FOR-APPROVAL"
    if "FAIL" in results.values():
        verdict = "PUBLISH-BLOCKED"
    elif selected != set(gates):
        verdict = "PARTIAL"
    report = json.dumps({"version": version, "commit": args.commit, "verdict": verdict,
                         "results": results}, ensure_ascii=False, indent=2)
    (out / "verdict.json").write_text(report + "\n", encoding="utf-8")
    print(report if args.json else verdict)
    return {"READY-FOR-APPROVAL": 0, "PUBLISH-BLOCKED": 1, "PARTIAL": 2}[verdict]


if __name__ == "__main__":
    raise SystemExit(main())
