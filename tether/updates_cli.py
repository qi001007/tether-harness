"""JSON command-line interface for the Tether updater."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .updates import UpdateManager


def _default_root() -> Path:
    return Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tether-updates")
    parser.add_argument("action", choices=("status", "check", "prepare", "apply", "activity"))
    parser.add_argument("--component", required=True, choices=("app", "plugin", "node"))
    parser.add_argument("--prepared-id")
    parser.add_argument("--root", type=Path, default=_default_root())
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--dsh-home", type=Path, default=Path(os.environ["DSH_HOME"]) if os.environ.get("DSH_HOME") else None)
    parser.add_argument("--profile", default="desktop")
    parser.add_argument("--device")
    parser.add_argument("--manifest-url")
    parser.add_argument("--fallback-manifest-url", action="append", default=[])
    parser.add_argument("--allow-unsigned", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    manager = UpdateManager(
        root=args.root,
        component=args.component,
        dsh_home=args.dsh_home,
        state_dir=args.state_dir,
        profile=args.profile,
        device=args.device,
        manifest_url=args.manifest_url,
        fallback_manifest_urls=args.fallback_manifest_url or None,
        allow_unsigned=True if args.allow_unsigned else None,
    )
    if args.action == "activity":
        result = manager.activity()
    elif args.action == "status":
        result = manager.status()
    elif args.action == "check":
        result = manager.check(force=args.force)
    elif args.action == "prepare":
        result = manager.prepare()
    else:
        if not args.prepared_id:
            result = {"ok": False, "component": args.component, "error_code": "prepared_id_required",
                      "error": "apply 操作需要 prepared_id。"}
        else:
            result = manager.apply(args.prepared_id)

    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
