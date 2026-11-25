#!/usr/bin/env python3
"""唯一入口门禁（对应 ENT-1..ENT-4）：装机/升级后桌面与开始菜单只能有一个 Tether 入口。

入口所有权的状态机（2026-11-25 收口后）：

- 创建入口的只有安装器：NSIS 按 `productName` + `nsis.shortcutName` 写 `Tether.lnk`；
  `desktop/install-app.ps1` 这条源码安装路径必须写同名入口。
- APP 运行时只做两件级联的事：把 `Tether.lnk` 修回出厂形状（真实安装目录、
  无 asar 参数、品牌图标、`appUserModelId`），并清掉历史名字。它不再创建第二个名字。
- NSIS `customInit`/`customUnInstall` 调用 `TetherPurgeLegacyEntries` 删 legacy 入口，
  所以覆盖升级与卸载都不残留。

三种模式：
- `--scan-source`  只读仓库，推导产品会写出的入口名集合与 target/图标/AUMID 约定；
  名字集合 >1 或图标有回退分支即判 FAIL。**默认模式，不碰主机。**
- `--inspect`      只读枚举本机桌面/开始菜单的 Tether 快捷方式（PowerShell 查询，
  不写不删），需 `--allow-host-inspection` 显式确认。
- `--diff A.json B.json`  比对升级前后快照：入口数不得增加、legacy 名必须消失。

退出码：0 = 通过；1 = 违规；2 = 参数/环境错误。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# 历史与现行可能出现过的入口名。canonical 只有一个。
CANONICAL_NAME = "Tether.lnk"
LEGACY_NAMES = ["Tether APP.lnk", "Tether-App.cmd", "Tether APP.cmd"]


def hidden_startup() -> dict:
    """门禁子进程不许闪黑窗。本机 Python 的 Popen 不接受 windowsHide 关键字——用它
    会让 `--inspect` 直接 TypeError 崩掉，ENT 的真机快照线因此从没跑通过——
    改用 STARTUPINFO + CREATE_NO_WINDOW 达到同一效果。"""
    if os.name != "nt":
        return {}
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = subprocess.SW_HIDE
    return {"startupinfo": info, "creationflags": 0x08000000}


def read(relative: str) -> str:
    path = ROOT / relative
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def strip_cleanup_lists(text: str) -> str:
    """去掉"要清理的历史名字"，剩下的字面量才是产品会创建的名字。"""
    text = re.sub(r"const legacyNames\s*=\s*\[[^\]]*\]", "", text)
    text = re.sub(r"foreach \(\$legacy in @\([^)]*\)\)", "", text)
    return text


def created_names() -> dict[str, set[str]]:
    """每个写入方会创建的入口文件名。"""
    builder = read("desktop/packaging/electron-builder.yml")
    names = set()
    product = re.search(r"^productName:\s*(\S+)", builder, re.M)
    if product:
        names.add(f"{product.group(1)}.lnk")
    shortcut = re.search(r"^\s*shortcutName:\s*(\S+)", builder, re.M)
    if shortcut:
        names.add(f"{shortcut.group(1)}.lnk")
    writers = {"desktop/packaging/electron-builder.yml": names}

    main = strip_cleanup_lists(read("apps/tether-app/main.js"))
    writers["apps/tether-app/main.js"] = set(re.findall(r"['\"]([Tt]ether[^'\"]*?\.lnk)['\"]", main))

    installer = strip_cleanup_lists(read("desktop/install-app.ps1"))
    writers["desktop/install-app.ps1"] = {
        value for value in re.findall(r'CreateShortcut\(\(Join-Path\s+\$folder\s+"([^"]+)"', installer)
    }
    return writers


def scan_ent1() -> list[dict]:
    """ENT-1：产品能写出的入口名必须唯一，且入口数由打包配置显式声明。"""
    problems = []
    builder = read("desktop/packaging/electron-builder.yml")
    for field in ("shortcutName", "createDesktopShortcut", "createStartMenuShortcut"):
        if not re.search(rf"^\s*{field}:", builder, re.M):
            problems.append({"gate": "ENT-1", "file": "desktop/packaging/electron-builder.yml",
                             "why": f"缺少 {field} 声明，入口名与入口数不可预测", "text": ""})
    writers = created_names()
    for source, names in writers.items():
        if len(names) > 1:
            problems.append({"gate": "ENT-1", "file": source,
                             "why": "同一写入方会创建多个入口名：" + ", ".join(sorted(names)), "text": ""})
    union = {name.lower() for names in writers.values() for name in names}
    unexpected = sorted(union - {CANONICAL_NAME.lower()})
    if unexpected:
        problems.append({"gate": "ENT-1", "file": ", ".join(sorted(writers)),
                         "why": "入口名集合不唯一，期望只有 " + CANONICAL_NAME + "，实际多出："
                                + ", ".join(unexpected), "text": ""})
    if not union:
        problems.append({"gate": "ENT-1", "file": "desktop/packaging/electron-builder.yml",
                         "why": "推不出任何入口名，写入方约定已改变，门禁需同步", "text": ""})
    return problems


def scan_ent2() -> list[dict]:
    """ENT-2：target / 图标 / AppUserModelId 必须同源一致。"""
    problems = []
    builder = read("desktop/packaging/electron-builder.yml")
    main = read("apps/tether-app/main.js")
    app_id = re.search(r"^appId:\s*(\S+)", builder, re.M)
    identity = re.search(r"const APP_USER_MODEL_ID\s*=\s*'([^']+)'", main)
    if not app_id or not identity:
        problems.append({"gate": "ENT-2", "file": "apps/tether-app/main.js",
                         "why": "appId 或 APP_USER_MODEL_ID 常量缺失，任务栏分组会裂成两个", "text": ""})
    elif app_id.group(1) != identity.group(1):
        problems.append({"gate": "ENT-2", "file": "apps/tether-app/main.js",
                         "why": f"APP_USER_MODEL_ID {identity.group(1)} 与 appId {app_id.group(1)} 不一致",
                         "text": ""})
    icon = re.search(r"^\s+icon:\s*(\S+)", builder, re.M)
    if not icon or "tether-app-s" not in icon.group(1):
        problems.append({"gate": "ENT-2", "file": "electron-builder.yml",
                         "why": "win 图标未指向唯一品牌源 assets/tether-app-s.ico", "text": ""})
    for source in ("desktop/install-app.ps1", "apps/tether-app/main.js"):
        text = read(source)
        # 图标缺失时回退到 electron.exe 会让入口显示成通用图标，违反"图标只有一个源"。
        if re.search(r"\$icon\s*=\s*\$Electron|icon[^\n]{0,40}\?\s*iconPath\s*:\s*process\.execPath"
                     r"|icon:\s*fs\.existsSync\(iconPath\)[^\n]*process\.execPath", text):
            problems.append({"gate": "ENT-2", "file": source,
                             "why": "图标缺失时回退成可执行文件自带图标，入口图标不再同源",
                             "text": "fallback -> electron.exe"})
    start = main.find("function ensureAppShortcuts")
    body = main[start:start + 4000] if start > -1 else ""
    if not body:
        problems.append({"gate": "ENT-2", "file": "apps/tether-app/main.js",
                         "why": "找不到 ensureAppShortcuts，运行时入口自愈线缺失", "text": ""})
    else:
        # ShortcutDetails.appUserModelId 是 Electron 支持的字段（见 electron.d.ts），
        # 不带它的 .lnk 会与 NSIS 入口分成两个任务栏/Alt-Tab 组。
        if "appUserModelId" not in body:
            problems.append({"gate": "ENT-2", "file": "apps/tether-app/main.js",
                             "why": "ensureAppShortcuts 写的 .lnk 不带 appUserModelId，"
                                    "与 NSIS 入口不同组，任务栏/Alt-Tab 会显示两个", "text": ""})
        if "realpath" not in body:
            problems.append({"gate": "ENT-2", "file": "apps/tether-app/main.js",
                             "why": "入口 target 未做 realpath 规范化，经 D: 兼容联接启动会把"
                                    "联接路径写进用户桌面，安装器换路后入口即失效", "text": ""})
        if re.search(r"(cwd|args):[^\n]{0,40}appPath", body):
            problems.append({"gate": "ENT-2", "file": "apps/tether-app/main.js",
                             "why": "入口仍把 app.asar 当参数/工作目录，换安装目录即失效；"
                                    "需与 NSIS 的 target 约定统一", "text": ""})
    return problems


def scan_ent3() -> list[dict]:
    """ENT-3：安装/升级/卸载必须清 legacy 入口，运行时自愈要有同一份名单。"""
    problems = []
    migration = read("desktop/packaging/nsis/migration.nsh")
    for legacy in LEGACY_NAMES:
        if not re.search(rf'Delete\s+"[^"]*{re.escape(legacy)}"', migration):
            problems.append({"gate": "ENT-3", "file": "desktop/packaging/nsis/migration.nsh",
                             "why": f"迁移逻辑没有删除 legacy 入口 {legacy}，旧入口会与新入口同留桌面",
                             "text": ""})
    for macro in ("customInit", "customUnInstall"):
        block = re.search(rf"!macro {macro}.*?!macroend", migration, re.S)
        if not block or "TetherPurgeLegacyEntries" not in block.group(0):
            problems.append({"gate": "ENT-3", "file": "desktop/packaging/nsis/migration.nsh",
                             "why": f"{macro} 未调用 TetherPurgeLegacyEntries，"
                                    "该路径不会清理历史入口", "text": ""})
    main = read("apps/tether-app/main.js")
    declared = re.search(r"const legacyNames\s*=\s*\[([^\]]*)\]", main)
    runtime_names = {value.lower() for value in
                     re.findall(r"['\"]([^'\"]+)['\"]", declared.group(1))} if declared else set()
    missing = sorted({name.lower() for name in LEGACY_NAMES} - runtime_names)
    if missing:
        problems.append({"gate": "ENT-3", "file": "apps/tether-app/main.js",
                         "why": "运行时自愈没有清理：" + ", ".join(missing) +
                                "。只做 NSIS 清理不够，靠更新装上 APP 的机器不会被修好", "text": ""})
    installer = read("desktop/install-app.ps1")
    if not re.search(r"foreach \(\$legacy in @\(", installer):
        problems.append({"gate": "ENT-3", "file": "desktop/install-app.ps1",
                         "why": "源码安装路径不清理历史入口名，同机会留下两个图标", "text": ""})
    return problems


PS_INSPECT = r'''
$out = @()
$folders = @{
  desktop = [Environment]::GetFolderPath('Desktop')
  programs = [Environment]::GetFolderPath('Programs')
  common_desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  common_programs = [Environment]::GetFolderPath('CommonStartMenu') + '\Programs'
}
$shell = New-Object -ComObject WScript.Shell
foreach ($key in $folders.Keys) {
  $folder = $folders[$key]
  if (-not (Test-Path -LiteralPath $folder)) { continue }
  Get-ChildItem -LiteralPath $folder -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.lnk', '.cmd', '.url' } |
    Where-Object { $_.Name -match 'tether' } | ForEach-Object {
      $link = $null
      try { $link = $shell.CreateShortcut($_.FullName) } catch {}
      $out += [pscustomobject]@{
        folder = $key
        name = $_.Name
        path = $_.FullName
        target = if ($link) { $link.TargetPath } else { '' }
        args = if ($link) { $link.Arguments } else { '' }
        workdir = if ($link) { $link.WorkingDirectory } else { '' }
        icon = if ($link) { $link.IconLocation } else { '' }
        exists = if ($link) { [bool](Test-Path -LiteralPath $link.TargetPath) } else { $false }
      }
    }
}
ConvertTo-Json -Depth 4 -InputObject @($out)
'''


def inspect(output: Path) -> int:
    """只读枚举。不创建、不修改、不删除任何快捷方式。"""
    if sys.platform != "win32":
        print("ENT 主机枚举只在 Windows 有意义；本机非 Windows 判 BLOCKED。", file=sys.stderr)
        return 2
    proc = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", PS_INSPECT],
                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=120, **hidden_startup())
    if proc.returncode != 0:
        print(f"PowerShell 枚举失败：{proc.stderr.strip()[:300]}", file=sys.stderr)
        return 1
    try:
        entries = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        print("PowerShell 输出不是 JSON", file=sys.stderr)
        return 1
    entries = entries if isinstance(entries, list) else [entries]
    snapshot = {"entries": entries, "count": len(entries),
                "canonical_only": all(item.get("name", "").lower() == CANONICAL_NAME.lower()
                                      for item in entries)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"只读快照写入 {output}（{len(entries)} 个 Tether 入口）")
    for item in entries:
        print(f"  {item.get('folder')}/{item.get('name')} -> {item.get('target')} {item.get('args')}"
              f"  icon={item.get('icon')}  target存在={item.get('exists')}")
    return 0


def git_head() -> str:
    try:
        proc = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=str(ROOT),
                              capture_output=True, text=True, timeout=20, **hidden_startup())
    except (OSError, subprocess.SubprocessError):
        return ""
    return proc.stdout.strip() if proc.returncode == 0 else ""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def build_ent4_record(snapshot: Path, out: Path, version: str, screenshot: str,
                      log: str, synthetic: bool) -> int:
    """把"卸载后只读快照"装成 `release_gate.py` 认得的 REAL 证据记录（ENT-4）。

    本命令不执行卸载，也不替卸载编造结论：入口数从快照读，非 0 就判 fail；
    `--synthetic` 用来验证记录格式，会强制判 fail 并写明不是真机结论。
    """
    data = json.loads(snapshot.read_text(encoding="utf-8"))
    entries = data.get("entries", [])
    names = sorted({str(item.get("name", "")).lower() for item in entries})
    legacy = sorted(set(names) & {item.lower() for item in LEGACY_NAMES})
    dead = sorted(str(item.get("path", "")) for item in entries if not item.get("exists"))
    problems = []
    if names:
        problems.append(f"卸载后仍有 {len(entries)} 个入口：{', '.join(names)}")
    if legacy:
        problems.append("legacy 名残留：" + ", ".join(legacy))
    if dead:
        problems.append("残留入口 target 已失效：" + "; ".join(dead))
    if not screenshot:
        problems.append("缺少 screenshot 证据路径")
    if not log:
        problems.append("缺少 log 证据路径")
    if synthetic:
        problems.append("合成快照，仅验证记录格式，不构成真机结论")
    windows_build = getattr(sys, "getwindowsversion", lambda: None)()
    record = {
        "gate": "ENT-4",
        "version": version,
        "commit": git_head(),
        "executed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "verdict": "pass" if not problems else "fail",
        "problems": problems,
        "device": platform.node(),
        "os": f"Windows {windows_build.build}" if windows_build else platform.platform(),
        "screenshot": screenshot,
        "log": log,
        "snapshot_after_uninstall": relative(snapshot),
        "measured": {"entry_count_after_uninstall": len(entries),
                     "legacy_entry_count_after_uninstall": len(legacy)},
        "evidence": [{"path": relative(path), "sha256": sha256_file(path)}
                     for path in (snapshot, Path(screenshot) if screenshot else None,
                                  Path(log) if log else None)
                     if path is not None and path.is_file()],
        "enumerated": entries,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"ENT-4 证据记录写入 {relative(out)}（verdict={record['verdict']}，"
          f"入口数={len(entries)}，legacy={len(legacy)}）")
    for item in problems:
        print(f"  - {item}")
    if record["verdict"] == "pass":
        print("判据：卸载后桌面/开始菜单/公共目录 *tether* 入口数为 0，且 legacy 名不残留。")
    else:
        print("注意：这条记录现在还不能当 ENT-4 真机结论；补齐上面各项后重跑本命令。")
    return 0 if record["verdict"] == "pass" else 1


def diff(before: Path, after: Path) -> list[dict]:
    old = json.loads(before.read_text(encoding="utf-8"))
    new = json.loads(after.read_text(encoding="utf-8"))
    problems = []
    names_before = {item["name"].lower() for item in old.get("entries", [])}
    names_after = {item["name"].lower() for item in new.get("entries", [])}
    if len(names_after) > 1:
        problems.append({"gate": "ENT-1", "why": f"升级后仍有多个入口名：{sorted(names_after)}",
                         "file": str(after), "line": 0, "text": ""})
    for legacy in LEGACY_NAMES:
        if legacy.lower() in names_after:
            problems.append({"gate": "ENT-3", "why": f"legacy 入口未清理：{legacy}",
                             "file": str(after), "line": 0, "text": ""})
    if new.get("count", 0) > old.get("count", 0):
        problems.append({"gate": "ENT-1", "why": f"入口数从 {old.get('count')} 增至 {new.get('count')}",
                         "file": str(after), "line": 0, "text": ""})
    for item in new.get("entries", []):
        if not item.get("exists"):
            problems.append({"gate": "ENT-2", "why": f"入口 target 不存在：{item.get('path')}",
                             "file": str(after), "line": 0, "text": item.get("target", "")})
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="唯一入口门禁（只读）")
    parser.add_argument("--scan-source", action="store_true", help="扫描仓库里的入口写入约定")
    parser.add_argument("--inspect", default=None, metavar="OUT.json", help="只读枚举本机入口")
    parser.add_argument("--allow-host-inspection", action="store_true")
    parser.add_argument("--diff", nargs=2, metavar=("BEFORE.json", "AFTER.json"))
    parser.add_argument("--check", default="all", help="ENT-1|ENT-2|ENT-3|all")
    parser.add_argument("--ent4-record", default=None, metavar="SNAPSHOT.json",
                        help="把卸载后的只读快照装成 release_gate.py 认的 REAL 证据记录")
    parser.add_argument("--out", default=None, metavar="ENT-4.json")
    parser.add_argument("--version", default="")
    parser.add_argument("--screenshot", default="")
    parser.add_argument("--log", default="")
    parser.add_argument("--synthetic", action="store_true", help="只验记录格式，强制判 fail")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not (args.scan_source or args.inspect or args.diff or args.ent4_record):
        parser.error("至少指定 --scan-source / --inspect / --diff / --ent4-record 之一")

    problems: list[dict] = []
    if args.scan_source:
        wanted = {"ENT-1", "ENT-2", "ENT-3"} if args.check == "all" else {args.check}
        if "ENT-1" in wanted:
            problems.extend(scan_ent1())
        if "ENT-2" in wanted:
            problems.extend(scan_ent2())
        if "ENT-3" in wanted:
            problems.extend(scan_ent3())
    if args.diff:
        problems.extend(diff(Path(args.diff[0]), Path(args.diff[1])))
    if args.inspect:
        if not args.allow_host_inspection:
            print("拒绝：主机入口枚举需 --allow-host-inspection 显式确认（本工具只读，但不擅自读用户桌面）",
                  file=sys.stderr)
            return 2
        return inspect(Path(args.inspect))

    if args.ent4_record:
        if not args.out or not args.version:
            parser.error("--ent4-record 需要 --out 与 --version，否则记录无法与候选对齐")
        return build_ent4_record(Path(args.ent4_record), Path(args.out), args.version,
                                 args.screenshot, args.log, args.synthetic)

    # 同一个文件里 Desktop/Programs 两处字面量会各命中一次，按 (gate,file,why) 去重。
    unique: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for item in problems:
        key = (item["gate"], item.get("file", ""), item["why"])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    problems = unique

    if args.json:
        print(json.dumps({"findings": problems, "count": len(problems),
                          "verdict": "PASS" if not problems else "FAIL"}, ensure_ascii=False, indent=2))
    else:
        for item in problems:
            where = item.get("file", "")
            print(f"[{item['gate']}] {where}  {item['why']}")
        print(f"\n{'PASS' if not problems else 'FAIL'}：{len(problems)} 项入口违规")
        if problems:
            print("判据：桌面与开始菜单各只有一个入口名；target/图标/AppUserModelId 同源；"
                  "升级后 legacy 名消失；卸载后不留入口。")
        print("注意：源码约定唯一不等于用户机器唯一。ENT-3/ENT-4 的结论必须来自装机前后只读快照与卸载后枚举。")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
