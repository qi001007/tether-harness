"""Minimal module dispatcher for the packaged headless Tether Python runtime."""

from __future__ import annotations

import runpy
import sys


ALLOWED_MODULES = {"tether.node.agent", "tether.updates_cli"}


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2 or args[0] != "-m" or args[1] not in ALLOWED_MODULES:
        print("This bundled runtime accepts only the managed Tether Node and updater commands.", file=sys.stderr)
        return 64
    module = args[1]
    sys.argv = [module, *args[2:]]
    runpy.run_module(module, run_name="__main__", alter_sys=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
