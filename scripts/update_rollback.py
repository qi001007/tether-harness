#!/usr/bin/env python3
"""把一台机器回到上一个可用版本，并当场证明它回来了。

为什么单独一个脚本：`tether/updates_cli.py` 已经能 rollback，但它要人手填
prepared_id，而更新出事时运维并不知道该回滚哪一笔、也看不出回滚后到底能不能用。
这个脚本自己找待处理事务、回滚、再复算版本与备份，输出恢复版本与耗时。

    python scripts/update_rollback.py scan --root "D:/Tether/node-0.5.11" --component node
    python scripts/update_rollback.py revert --root "D:/Tether/node-0.5.11" --component node --apply

默认只读（scan 与 revert 不带 --apply 都不写任何东西）。退出码：
0 = 回滚完成且版本已回到 from_version；1 = 回滚失败或回滚后仍不可用；
2 = 找不到可回滚的事务；3 = 输入路径不对。

`--apply` 会停当前运行态所依赖的文件替换，属于改机器状态的动作：先 scan，
确认 from_version 是你要回到的版本，再带 --apply。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# 这些状态意味着文件已经换过、但验收没走完，正是需要回滚的那一批。
OPEN_STATES = {"applying", "awaiting_acceptance", "recovery_required"}


def state_dir_for(root: Path, component: str, override: str | None) -> Path:
    if override:
        return Path(override)
    return root / ".runtime" / "updates" / component


def installed_version(root: Path, component: str) -> str:
    path = root / "version.json"
    if not path.is_file():
        return ""
    try:
        return str(json.loads(path.read_text(encoding="utf-8")).get("components", {}).get(component, ""))
    except (json.JSONDecodeError, OSError):
        return ""


def open_transactions(state_dir: Path) -> list[dict]:
    found: list[dict] = []
    transactions = state_dir / "transactions"
    for directory in sorted(transactions.glob("*")) if transactions.is_dir() else []:
        record = directory / "transaction.json"
        if not record.is_file():
            continue
        try:
            payload = json.loads(record.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if payload.get("component") == "node" and payload.get("state") in OPEN_STATES:
            found.append({"prepared_id": str(payload.get("id") or directory.name),
                          "state": str(payload.get("state")),
                          "from_version": str(payload.get("from_version", "")),
                          "to_version": str(payload.get("to_version", "")),
                          "source": str(record)})
    return found


def backups_present(state_dir: Path, prepared_id: str) -> bool:
    if not re.fullmatch(r"[a-f0-9]{32}", str(prepared_id)):
        return False
    for candidate in (state_dir / "backups").glob(f"*/{prepared_id}"):
        if candidate.is_dir() and any(candidate.iterdir()):
            return True
    return False


def scan(root: Path, component: str, state_dir: Path) -> int:
    current = installed_version(root, component)
    items = open_transactions(state_dir)
    print(f"root={root}")
    print(f"component={component} installed_version={current or '（读不到 version.json）'}")
    print(f"state_dir={state_dir}")
    if not items:
        print("\n没有待处理事务：这台机器不需要回滚，或回滚材料已被 commit 清掉。")
        return 2
    for item in items:
        printable = {key: value for key, value in item.items() if key != "source"}
        printable["backups"] = "在场" if backups_present(state_dir, item["prepared_id"]) else "缺失"
        print("  " + json.dumps(printable, ensure_ascii=False))
    missing = [item for item in items if not backups_present(state_dir, item["prepared_id"])]
    if missing:
        print(f"\n注意：{len(missing)} 笔事务的备份目录找不到，回滚会失败——"
              "这些机器只能重装，不要在这里硬试。")
    return 0


def revert(root: Path, component: str, state_dir: Path, prepared_id: str | None, apply: bool) -> int:
    items = open_transactions(state_dir)
    if not items:
        print("没有待处理事务，无需回滚。")
        return 2
    target = None
    if prepared_id:
        target = next((item for item in items if item["prepared_id"] == prepared_id), None)
        if target is None:
            print(f"prepared_id {prepared_id} 不在待处理事务里；先跑 scan。")
            return 2
    elif len(items) == 1:
        target = items[0]
    else:
        print("有多笔待处理事务；先 scan，再用 --prepared-id 指定事务。")
        return 2
    if not backups_present(state_dir, target["prepared_id"]):
        print(f"事务 {target['prepared_id']} 的备份不在场，回滚无法恢复原文件。")
        return 2
    print(f"准备回滚：{json.dumps({k: v for k, v in target.items() if k != 'source'}, ensure_ascii=False)}")
    if not apply:
        print("只读预览。确认 from_version 是你要的版本后，加 --apply 才真的动文件。")
        return 0

    from tether.updates import UpdateError, UpdateManager  # noqa: PLC0415

    started = time.monotonic()
    manager = UpdateManager(root, component, state_dir=state_dir)
    try:
        result = manager.rollback(target["prepared_id"])
    except UpdateError as exc:
        print(f"回滚抛错：{exc.code}")
        return 1
    elapsed = time.monotonic() - started
    restored = installed_version(root, component)
    print(json.dumps({"ok": bool(result.get("ok")), "error": result.get("error", ""),
                      "rollback_s": round(elapsed, 2), "version_restored": restored,
                      "expected_from_version": target["from_version"]}, ensure_ascii=False))
    if not result.get("ok"):
        return 1
    if target["from_version"] and restored != target["from_version"]:
        print("回滚后 version.json 仍不是 from_version —— 判失败，要人工看。")
        return 1
    print(f"PASS：{elapsed:.2f}s 回到 {restored}。下一步按 UPD-7 复跑一次真实业务动作。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="更新回滚与回滚后自证")
    parser.add_argument("command", choices=("scan", "revert"))
    parser.add_argument("--root", required=True, help="该组件的安装根目录")
    parser.add_argument("--component", required=True, choices=("node",))
    parser.add_argument("--state-dir", default=None, help="默认 <root>/.runtime/updates/<component>")
    parser.add_argument("--prepared-id", default=None)
    parser.add_argument("--apply", action="store_true", help="真的回滚，否则只读预览")
    args = parser.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        print(f"目录不存在：{root}", file=sys.stderr)
        return 3
    state_dir = state_dir_for(root, args.component, args.state_dir)
    if not state_dir.is_dir():
        print(f"更新状态目录不存在：{state_dir}", file=sys.stderr)
        return 3
    if args.command == "scan":
        return scan(root, args.component, state_dir)
    return revert(root, args.component, state_dir, args.prepared_id, args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
