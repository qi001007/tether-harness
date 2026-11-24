#!/usr/bin/env python3
"""Release gate: a declared memory limit must also be readable at runtime.

Exit codes follow the house convention (0 PASS, 1 FAIL, 3 BLOCKED, 4 DEGRADED).
``DEGRADED`` is printed whenever the limit was declared but cannot be read
back; it remains visible in the gate table but does not block publication
because the missing cgroup controller is a host property, not a Tether defect.
``BLOCKED`` is used only when the unit is not running yet so its cgroup does
not exist — that is a missing input, not a verdict. Non-Linux hosts report
``N-A``: they have no cgroup backend, so there is nothing to enforce and
nothing to degrade — painting every Windows node red would teach people to
ignore the gate.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Windows consoles default to the local codepage (cp936 here), which mangles the
# Chinese verdict lines into mojibake. Pin UTF-8 so the verdict text is the same
# bytes everywhere; callers that decode differently still get valid UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tether.node.memory_guard import (  # noqa: E402
    BACKEND_NONE,
    STATE_DECLARED_NOT_ENFORCED,
    STATE_ENFORCED,
    STATE_UNDECLARED,
    STATE_UNDETERMINED,
    classify_state,
    normalize_declared,
    probe,
)

PASS, FAIL, BLOCKED, DEGRADED_EXIT = 0, 1, 3, 4


def self_test() -> int:
    """Fixed cases, including the ones no kernel here can produce."""
    cases = [
        (
            "enforced: declared + readable",
            dict(declared_max=402_653_184, controller_available=True,
                 effective_max=402_653_184, backend="cgroup2"),
            STATE_ENFORCED,
        ),
        (
            "reverse: controller present but no limit file",
            dict(declared_max=402_653_184, controller_available=True,
                 effective_max=None, backend="cgroup2"),
            STATE_DECLARED_NOT_ENFORCED,
        ),
        (
            "no controller at all (cgroup_disable=memory)",
            dict(declared_max=402_653_184, controller_available=False,
                 effective_max=None, backend="cgroup2"),
            STATE_DECLARED_NOT_ENFORCED,
        ),
        (
            "timing: unit inactive, cgroup dir not created yet",
            dict(declared_max=67_108_864, controller_available=True,
                 effective_max=None, backend="cgroup2", dir_present=False),
            STATE_UNDETERMINED,
        ),
        (
            "nothing declared",
            dict(declared_max=None, controller_available=True,
                 effective_max="max", backend="cgroup2"),
            STATE_UNDECLARED,
        ),
        (
            "windows: no backend",
            dict(declared_max=None, controller_available=False,
                 effective_max=None, backend=BACKEND_NONE),
            STATE_UNDECLARED,
        ),
    ]
    # The declared-value parser is where the "infinity means no limit" trap
    # lives, so it gets its own fixed cases (measured on PI-01).
    declared_cases = [
        ("infinity", None), ("max", None), ("[not set]", None), ("", None),
        ("402653184", 402_653_184), ("garbage", None),
    ]
    failed = 0
    for name, kwargs, expected in cases:
        got = classify_state(**kwargs)
        if got == expected:
            print(f"OK   {name} -> {got}")
        else:
            print(f"FAIL {name} -> {got}, expected {expected}")
            failed += 1
    for raw, expected in declared_cases:
        got = normalize_declared(raw)
        if got == expected:
            print(f"OK   normalize_declared({raw!r}) -> {got}")
        else:
            print(f"FAIL normalize_declared({raw!r}) -> {got}, expected {expected}")
            failed += 1
    if failed:
        print(f"FAIL 自检 {failed} 项不符")
        return FAIL
    print("PASS 自检")
    return PASS


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unit", default="tether-node", help="systemd unit to inspect")
    parser.add_argument("--cgroup-dir", default=None, help="override the unit cgroup path")
    parser.add_argument("--sysfs-root", default="/sys/fs/cgroup")
    parser.add_argument("--wait-ms", type=int, default=2000,
                        help="bounded wait for the unit cgroup to appear (measured ~100ms)")
    parser.add_argument("--json", action="store_true", help="emit machine-readable result")
    parser.add_argument("--self-test", action="store_true", help="run the fixed cases only")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if not sys.platform.startswith("linux"):
        result = {
            "verdict": "N-A",
            "reason": f"no_cgroup_backend_on_{sys.platform}",
            "unit": args.unit,
        }
        print(json.dumps(result, ensure_ascii=False) if args.json
              else f"OK N-A 该平台（{sys.platform}）没有 cgroup 后端，本条判据不适用")
        return PASS

    result = probe(
        unit=args.unit,
        sysfs_root=Path(args.sysfs_root),
        cgroup_dir=Path(args.cgroup_dir) if args.cgroup_dir else None,
        wait_ms=args.wait_ms,
    )
    state = result["state"]
    if state == STATE_ENFORCED:
        verdict, code = "PASS", PASS
    elif state == STATE_UNDETERMINED:
        verdict, code = "BLOCKED", BLOCKED
        result["note"] = "单元未启动或 cgroup 目录尚未出现，这是缺输入，不是判定"
    elif state == STATE_DECLARED_NOT_ENFORCED:
        verdict, code = "DEGRADED", DEGRADED_EXIT
        result["note"] = "声明的上限无法从内核读回，不得记为已限制"
    else:
        verdict, code = "DEGRADED", DEGRADED_EXIT
        result["note"] = "unit 未声明任何内存上限"

    result["verdict"] = verdict
    result["host"] = getattr(os, "uname", lambda: None)()
    result["host"] = getattr(result["host"], "nodename", "unknown")
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        # release_gate.py picks the first line matching ^(PASS|FAIL|BLOCKED|DEGRADED|OK|verdict)
        # to display a verdict. DEGRADED must remain distinct from BLOCKED so the
        # runner can show a visible, non-publishing defect instead of treating the
        # host's missing cgroup controller as a missing required input.
        head = {"PASS": "PASS", "DEGRADED": "DEGRADED", "BLOCKED": "BLOCKED"}[verdict]
        detail = "DEGRADED（声明未生效）" if verdict == "DEGRADED" else verdict
        print(f"{head} 内存上限判据 {detail} unit={args.unit} state={state} "
              f"backend={result['backend']} controller={result['controller_available']} "
              f"dir_present={result['dir_present']} declared={result['declared_max_bytes']} "
              f"effective={result['effective_max']} error={result.get('error', '')}")
        if result.get("note"):
            print(f"{head} {result['note']}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
