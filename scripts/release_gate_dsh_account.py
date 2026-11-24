#!/usr/bin/env python3
"""DSH 账号/映射可证明门禁（对应 DSH-1..DSH-5），只读。

为什么需要这条线：Tether 打开的是别人机器上的 DeepSeek Harness 实例。实例身份
（哪个 DSH_HOME、哪个 profile、哪个本地 endpoint）一旦错位，用户看到的就是
"另一个账号的会话列表"；而 DSH 登录态目前只在收到 401 时被动提示重登，页面上
没有任何"当前是哪个 DSH 账号"的正向显示，外部浏览器里登录了 DSH 也容易被当成
Tether 已登录。门禁要先把这些差异变成可核对的记录。

三种模式：
- `--check mapping`   比对导出的 native-surface descriptor 与批准实例清单（DSH-1）。
  descriptor 由设备上 `<DSH_HOME>/storages/tether/native-surface.json` 导出，
  或本机用 `--dsh-home` + `--allow-host-inspection` 只读读取。
- `--check ui-account` 首方源码是否正向暴露 DSH 账号/登录态（DSH-2/DSH-4 的代码半边）。
- `--check selection`  随包 DSH 与已安装 DeepSeek Harness 的选择规则是否确定（DSH-5）。

DSH-3（外部浏览器登录不误判为 Tether 已登录）与 DSH-4 的行为半边只能在真机验，
本脚本不给它们发绿。

退出码：0 = 通过；1 = 违规；2 = 缺输入/参数错误。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

DESCRIPTOR_RELATIVE = Path("storages") / "tether" / "native-surface.json"


def read(relative: str) -> str:
    path = ROOT / relative
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def approved_instances(path: str | None) -> list[dict] | None:
    if not path:
        return None
    file = Path(path)
    if not file.is_absolute():
        file = ROOT / path
    if not file.is_file():
        print(f"批准实例清单不存在：{path}\n"
              "DSH-1 需要它才能判「映射是否指向批准的 DSH 实例」；"
              "清单由 DSH 回归线维护（每个实例一条：id/dsh_home/profile/host）。",
              file=sys.stderr)
        raise SystemExit(2)
    payload = json.loads(file.read_text(encoding="utf-8"))
    return payload.get("instances") if isinstance(payload, dict) else payload


def load_descriptor(args) -> dict | None:
    if args.descriptor:
        file = Path(args.descriptor)
        if not file.is_absolute():
            file = ROOT / args.descriptor
        if not file.is_file():
            print(f"descriptor 快照不存在：{file}", file=sys.stderr)
            raise SystemExit(2)
        return json.loads(file.read_text(encoding="utf-8"))
    if args.dsh_home:
        if not args.allow_host_inspection:
            print("拒绝：读取本机 DSH_HOME 需 --allow-host-inspection 显式确认", file=sys.stderr)
            raise SystemExit(2)
        target = Path(args.dsh_home) / DESCRIPTOR_RELATIVE
        if not target.is_file():
            return {}
        try:
            return json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"_broken": True}
    return None


def check_mapping(args) -> list[dict]:
    """DSH-1：descriptor 的 origin/auth_url/pid 必须落在批准实例上。"""
    problems: list[dict] = []
    descriptor = load_descriptor(args)
    if descriptor is None:
        print("缺少 --descriptor 或 --dsh-home，DSH-1 判 BLOCKED（不代取设备快照）", file=sys.stderr)
        raise SystemExit(2)
    if not descriptor:
        problems.append({"gate": "DSH-1", "file": str(args.dsh_home or args.descriptor),
                         "why": "没有 native-surface.json：DSH Web 未发布过本地 endpoint", "text": ""})
        return problems
    if descriptor.get("_broken"):
        problems.append({"gate": "DSH-1", "file": "", "why": "descriptor 不是合法 JSON", "text": ""})
        return problems

    origin = str(descriptor.get("origin") or "")
    auth_url = str(descriptor.get("auth_url") or "")
    pid = int(descriptor.get("pid") or 0)
    if not origin:
        problems.append({"gate": "DSH-1", "file": "descriptor", "why": "缺 origin", "text": ""})
    if not pid:
        problems.append({"gate": "DSH-1", "file": "descriptor", "why": "缺 pid，无法证明 endpoint 属于活的实例", "text": ""})
    elif args.allow_host_inspection and not _pid_alive(pid):
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": f"descriptor 里的 pid {pid} 已不存在：stale endpoint，页面会连到死实例",
                         "text": origin})
    if origin and not _is_loopback(origin):
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "native surface 的 origin 不是回环地址，DSH Web 不该被外部直连", "text": origin})

    instances = approved_instances(args.approved)
    if instances is None:
        print("缺少 --approved 批准实例清单，DSH-1 判 BLOCKED", file=sys.stderr)
        raise SystemExit(2)
    keys = {(str(item.get("host") or ""), str(item.get("profile") or "")) for item in instances}
    matched = any(origin.startswith(host) for host, _profile in keys)
    if not matched:
        problems.append({"gate": "DSH-1", "file": str(args.approved),
                         "why": f"origin {origin or '<空>'} 不在批准实例集合里："
                                + ", ".join(sorted(h for h, _ in keys)), "text": ""})
    home = str(descriptor.get("dsh_home") or "")
    if home and instances and not any(str(item.get("dsh_home", "")) and
                                      os.path.normcase(home).startswith(os.path.normcase(str(item["dsh_home"])))
                                      for item in instances):
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": f"descriptor 的 dsh_home {home} 不属于任何批准实例", "text": ""})
    if auth_url and origin and not auth_url.startswith(origin.rsplit(":", 1)[0]):
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "auth_url 与 origin 不同主机，登录会跳到另一个实例", "text": auth_url})

    # 硬判据 ①：instance kind 必须显式存在（桌面 DSH vs 捆绑 DSH Web），不能靠猜。
    kind = str(descriptor.get("instance_kind") or descriptor.get("kind") or "")
    if kind.lower() not in {"desktop", "bundled"}:
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "descriptor 没有 instance_kind（desktop/bundled）："
                                "现场桌面 DSH 与捆绑 DSH Web 并存时无法标明映射的是哪一类实例",
                         "text": kind})
    # 硬判据 ②：映射前必须校验 descriptor 的 PID 与当前活跃 DSH 实例一致。
    # PID 会被复用，所以还要一个不会被复用的伴随身份（启动时间或实例 token）。
    token = str(descriptor.get("pid_started_at") or descriptor.get("started_at")
                or descriptor.get("instance_token") or "")
    if not token:
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "descriptor 只有裸 pid，没有 pid_started_at/instance_token："
                                "Windows 上 PID 会被复用，旧 descriptor 可能指向另一个进程的"
                                "同名 PID", "text": f"pid={pid}"})
    active = _active_pids(args)
    if active is None:
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "缺少 --active-pid 或 --instances 快照，无法校验 descriptor PID "
                                "与当前活跃实例一致：裸 PID 不能当长期契约", "text": ""})
    elif pid and pid not in active:
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": f"descriptor pid {pid} 不在当前活跃 DSH 实例集合 {sorted(active)} 里："
                                "映射前必须重新解析，不能沿用过期 descriptor", "text": ""})
    # 硬判据 ③：profile 与 DSH_HOME 必须随映射一起给出，供 UI 显示。
    if not str(descriptor.get("profile") or ""):
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "descriptor 缺 profile，UI 无法显示映射到哪个 profile", "text": ""})
    if not home:
        problems.append({"gate": "DSH-1", "file": "descriptor",
                         "why": "descriptor 缺 dsh_home，UI 无法显示映射实例的 DSH_HOME", "text": ""})
    return problems


def _active_pids(args) -> set[int] | None:
    """当前活跃 DSH 实例 PID 集合，来自主人导出的快照或显式参数（门禁自己不扫进程）。"""
    pids: set[int] = set()
    if getattr(args, "active_pid", None):
        pids.add(int(args.active_pid))
    if getattr(args, "instances", None):
        file = Path(args.instances)
        if not file.is_absolute():
            file = ROOT / args.instances
        if not file.is_file():
            print(f"活跃实例快照不存在：{file}", file=sys.stderr)
            raise SystemExit(2)
        payload = json.loads(file.read_text(encoding="utf-8"))
        items = payload.get("instances") if isinstance(payload, dict) else payload
        for item in items or []:
            value = item.get("pid") if isinstance(item, dict) else item
            if value:
                pids.add(int(value))
    return pids or None


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _is_loopback(origin: str) -> bool:
    return bool(re.match(r"https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$", origin))


def check_ui_account() -> list[dict]:
    """DSH-2 / DSH-4 的代码半边：页面要正向显示**映射实例**的账号、PID、profile、DSH_HOME。

    现场有两实例并存（桌面 DSH 与捆绑 DSH Web 各自一个 pid）。后端
    `native_surface.py:258,378` 已经拿到 `profile` 与 `pid`，缺的是把它们标到 UI；
    不标就出现"捆绑实例被说成桌面 DSH 账号"这类身份错乱。
    """
    problems: list[dict] = []
    ui = read("packages/tether-ui/src/app.js")
    surface = read("tether/node/native_surface.py")
    rpc = read("tether/node/dsh_rpc.py")

    # 后端半边：状态里必须带映射实例身份（pid/profile/dsh_home）
    for field, pattern in (("pid", r"info\[.pid.\]|\bpid\b"),
                           ("profile", r"profile"),
                           ("dsh_home", r"(active_home|dsh_home)")):
        if not re.search(pattern, surface):
            problems.append({"gate": "DSH-2", "file": "tether/node/native_surface.py",
                             "why": f"surface 状态里没有 {field}，UI 无法标出连的是哪个实例", "text": ""})
    # UI 半边：必须正向显示账号/登录态，且绑定到具体实例身份
    positive = bool(re.search(r"(?i)dsh[_-]?(account|user|login|auth)[_-]?(state|status|name|label)"
                              r"|dshAccount|dshLoginState", ui))
    if not positive:
        problems.append({"gate": "DSH-2", "file": "packages/tether-ui/src/app.js",
                         "why": "页面只在 401 时被动提示重登，没有「当前 DSH 账号/登录态」的正向字段与渲染",
                         "text": ""})
    identity_shown = bool(re.search(r"(?i)(pid|profile).{0,40}(dsh[_-]?account|dshLoginState|账号)"
                                    r"|(dsh[_-]?account|dshLoginState).{0,40}(pid|profile)", ui))
    if not identity_shown:
        problems.append({"gate": "DSH-2", "file": "packages/tether-ui/src/app.js",
                         "why": "账号/登录态没有与映射实例的 PID/profile/DSH_HOME 一起呈现："
                                "桌面 DSH 与捆绑 DSH Web 并存时，UI 无法证明显示的是哪一个", "text": ""})
    # 不允许把"某个实例已登录"当成全局 DSH 已登录
    if re.search(r"(?i)\bdshLoggedIn\b|\bdsh[_-]?authed\b(?!\w*_pid)", ui) and not identity_shown:
        problems.append({"gate": "DSH-5", "file": "packages/tether-ui/src/app.js",
                         "why": "存在不区分实例的全局 DSH 登录布尔，捆绑实例会被谎称成桌面 DSH 账号",
                         "text": ""})
    # 硬判据：只要显示了账号，就必须有真实数据源，且不得由桌面进程/系统用户名推断。
    if positive:
        sourced = bool(re.search(r"(?i)(dshAccountState|dsh_account|accountState)[^\n]{0,120}"
                                 r"(await|fetch|rpc|status|response|result)", ui)
                       or re.search(r"(?i)(fetch|read|query)Dsh(Account|Identity|Auth)", ui))
        if not sourced:
            problems.append({"gate": "DSH-2", "file": "packages/tether-ui/src/app.js",
                             "why": "显示了 DSH 账号却没有真实数据源（未见从 DSH RPC/status 读取的路径）："
                                    "无法证明该账号属于当前映射实例", "text": ""})
        inferred = re.search(r"(?i)(dshAccount|accountState|dshLoginState)[^\n]{0,80}"
                             r"(os\.userInfo|hostname|process\.env\.(USERNAME|USER)|"
                             r"isRunning|desktop\w*Running)", ui)
        if inferred:
            problems.append({"gate": "DSH-2", "file": "packages/tether-ui/src/app.js",
                             "why": "账号/登录态由桌面进程或系统用户名推断："
                                    "桌面 DSH 在跑不等于 Tether 映射的那个实例已登录",
                             "text": inferred.group(0)[:160]})
    # 硬判据：后端没有 DSH 账号数据源时，UI 只能报 unknown，不得拿 Hub 登录态冒充。
    account_op = bool(re.search(r"(?i)(account|whoami|user/profile|identity)",
                                " ".join(re.findall(r"\"[a-z/]+\"", rpc))))
    if not account_op:
        if not re.search(r"(?i)['\"]unknown['\"]", ui):
            problems.append({"gate": "DSH-2", "file": "packages/tether-ui/src/app.js",
                             "why": "DSH RPC 白名单里没有账号/whoami endpoint（只有 session/*），"
                                    "DSH 账号本就无从得知；此时必须显示 unknown，"
                                    "不能显示已登录或留空让用户误判", "text": ""})
        conflated = re.search(r"(?i)(dsh\w*(loggedIn|authed|account)|账号|account)[^\n]{0,60}"
                              r"\bloggedIn\b|\bloggedIn\b[^\n]{0,60}(dsh|账号|account)", ui)
        if conflated:
            problems.append({"gate": "DSH-2", "file": "packages/tether-ui/src/app.js",
                             "why": "DSH 登录态与 Hub 会话的 loggedIn 混用：桌面/Hub 已登录不等于 "
                                    "Tether 映射的那个 DSH 实例已登录", "text": conflated.group(0)[:160]})
    # 401 后必须清缓存 cookie，否则会把失效登录态一直显示成已登录
    if not re.search(r"self\._cookies,\s*self\._origin\s*=\s*\{\},\s*\"\"", rpc):
        problems.append({"gate": "DSH-3", "file": "tether/node/dsh_rpc.py",
                         "why": "401 后没有清掉缓存 cookie，会把失效登录态误报为已登录", "text": ""})
    if not re.search(r"AUTH_COOKIE_PREFIX\s*=\s*[\"']dsh-auth", rpc):
        problems.append({"gate": "DSH-3", "file": "tether/node/dsh_rpc.py",
                         "why": "未固定 dsh-auth cookie 前缀，无法区分 DSH 自己的会话与 Tether 的登录态",
                         "text": ""})
    if not re.search(r"ALLOWED_ENDPOINTS|READ_ENDPOINTS", rpc):
        problems.append({"gate": "DSH-2", "file": "tether/node/dsh_rpc.py",
                         "why": "DSH RPC 没有只读 endpoint 白名单，账号面可能被扩成写面", "text": ""})
    # 登录成功后必须有明确的状态变化与 reload（DSH-4 的代码半边）
    if not re.search(r"(?i)(after|on)login|login.*then.*(refresh|reload|publish)", ui):
        problems.append({"gate": "DSH-4", "file": "packages/tether-ui/src/app.js",
                         "why": "看不到「登录成功后触发刷新/重发 descriptor」的代码路径", "text": ""})
    if not re.search(r"(?i)reload|did-navigate|loadURL", ui):
        problems.append({"gate": "DSH-4", "file": "packages/tether-ui/src/app.js",
                         "why": "登录后没有明确的 reload 路径，状态变化只能靠用户手刷", "text": ""})
    return problems


# 只认明确的保护入参标识符。故意不写裸 keep/protect：注释里 "keep a warm cache"
# 这类散文会让判据恒真，门禁就废了。
PROTECTION_TOKEN = (r"\b(protectedPartitions|protectedNames|exemptPartitions|keepPartitions"
                    r"|keepNames|activePartitions|livePartitions|inUsePartitions)\b")


def function_body(source: str, name: str) -> str:
    """截出 JS 函数体：先跳过参数括号的整体，再从第一个 `{` 做配对。

    直接从函数名后的第一个 `{` 配对会被解构默认参数截断
    （`function f(a, { b = 1 } = {}) {` 里的第一个 `}` 不是函数体结束）。
    """
    start = source.find(name)
    if start < 0:
        return ""
    open_paren = source.find("(", start)
    if open_paren < 0:
        return ""
    depth = 0
    index = open_paren
    while index < len(source):
        char = source[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                break
        index += 1
    open_at = source.find("{", index)
    if open_at < 0:
        return ""
    depth = 0
    for position in range(open_at, len(source)):
        if source[position] == "{":
            depth += 1
        elif source[position] == "}":
            depth -= 1
            if depth == 0:
                return source[start:position + 1]
    return source[start:]


def def_block(source: str, name: str) -> str:
    """Python 侧按缩进截函数体：从 def 行到下一个同级 def/class。"""
    lines = source.splitlines()
    start = None
    indent = 0
    for index, line in enumerate(lines):
        if name in line and line.strip().startswith("def "):
            start, indent = index, len(line) - len(line.lstrip())
            break
    if start is None:
        return ""
    body = [lines[start]]
    for line in lines[start + 1:]:
        if line.strip() and (len(line) - len(line.lstrip())) <= indent:
            break
        body.append(line)
    return "\n".join(body)


def _maintenance_problem(file: str, why: str, text: str = "") -> dict:
    return {"gate": "DSH-6", "file": file, "why": why, "text": text}


def _check_budget_contract(maintenance: str, budget: str) -> list[dict]:
    """统一预算实现的硬判据：登录态和正在使用都不能进入 removable。"""
    problems: list[dict] = []
    if not re.search(PROTECTION_TOKEN, budget):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "partitionBudgetReport 没有受保护分区入参：持有有效登录会话的分区到期即被静默清掉"))
    else:
        if not re.search(r"const\s+eligible\s*=[\s\S]{0,180}?!\s*protectedSet\.has\(", budget):
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "partitionBudgetReport 的 removable 候选没有先排除 protectedSet"))

        if not function_body(maintenance, "function partitionDirectoryName"):
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "缺少目录名规范键：persist: 保护键和 loginEntries 会在边界处静默落空"))
        elif not re.search(r"protectedNames\s*=[\s\S]{0,400}?\.map\(\s*partitionDirectoryName\s*\)", budget):
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "protectedNames 未把 Chromium persist: 键归一为目录名"))

        normalize_login = function_body(maintenance, "function normalizeLoginEntries")
        if not normalize_login or not re.search(r"partitionDirectoryName\s*\(\s*key\s*\)", normalize_login):
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "loginEntries 的 persist: 状态键未归一，登录豁免无法命中目录名"))

        if not re.search(r"const\s+anonymous\s*=[\s\S]{0,180}?!\s*entry\.hasLoginState", budget):
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "partitionBudgetReport 没有把有登录态分区从 removable 池中分开"))

        age_branch = re.search(
            r"const\s+anonymousStale\s*=[\s\S]{0,260}?maxAgeMs[\s\S]{0,180}?"
            r"removable\.push\(\s*\.\.\.anonymousStale\b", budget)
        if not age_branch:
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "mtime 到期删除路径没有只处理 anonymousStale：已登录分区到期即被回收"))

        count_branch = re.search(
            r"const\s+freshOverflow\s*=[\s\S]{0,260}?"
            r"removable\.push\(\s*\.\.\.anonymousFresh\.slice", budget)
        if not count_branch:
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "maxCount 溢出路径没有只处理 anonymousFresh：已登录分区会被「最新里最旧」挤掉",
                "removable.push(...anonymousFresh.slice(0, freshOverflow))"))

        if re.search(r"removable\.push\(\s*\.\.\.(?:loginCandidates|staleLoginCandidates"
                     r"|cacheTrimCandidates|eligible|partitions)\b", budget):
            problems.append(_maintenance_problem(
                "apps/tether-app/data-maintenance.js",
                "登录分区被放进 removable，cacheTrim 与整目录删除的边界已失效"))

    evidence = function_body(maintenance, "function partitionHasCredentialEvidence")
    if not evidence:
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "缺少 partitionHasCredentialEvidence：登录状态文件尚未建立时，首启无法识别 Cookie 证据"))
    elif not re.search(r"PARTITION_CREDENTIAL_CANDIDATES|Network.{0,30}Cookies", evidence):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "partitionHasCredentialEvidence 未核对 Chromium 的 Network/Cookies，首启分区仍可能被删"))

    if not re.search(r"['\"]Network['\"]\s*,\s*['\"]Cookies['\"]|['\"]Network/Cookies['\"]", maintenance):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "没有声明 Chromium 真实的 Network/Cookies 凭证候选路径"))

    normalize = function_body(maintenance, "function normalizeEntries")
    if not normalize or not re.search(r"hasCredentialEvidence", normalize):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "normalizeEntries 未把首启凭证证据归一化为登录态"))

    if not re.search(r"PARTITION_CACHE_SUBDIRS", maintenance):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "缺少 cache 子目录清单，cacheTrim 无法与登录 Cookie 分离"))
    return problems


def _check_main_budget_gc(main: str, gc: str) -> list[dict]:
    problems: list[dict] = []
    if not re.search(r"partitionBudgetReport\s*\([\s\S]{0,900}?\bprotectedPartitions\b"
                     r"[\s\S]{0,900}?\bloginEntries\b", gc):
        problems.append(_maintenance_problem(
            "apps/tether-app/main.js",
            "gc 调用 partitionBudgetReport 时没有同时传入保护集与登录态："
            "正在被 workbench 挂载或已有 Cookie 证据的分区也可能被删"))
    if not re.search(r"partitionHasCredentialEvidence", main):
        problems.append(_maintenance_problem(
            "apps/tether-app/main.js",
            "gc 未读取 Chromium Cookie 证据，workbench-login-state.json 不存在时无法首启豁免"))
    else:
        if not re.search(r"const\s+cookieEvidencePartitions\s*=\s*\[\]", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "gc 未建立首启 Cookie 保护集，状态文件缺失时仍会先回收再补登录态"))
        if not re.search(r"cookieEvidencePartitions[\s\S]{0,700}?loginState\.entries"
                         r"[\s\S]{0,700}?partitionHasCredentialEvidence", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "首启保护未同时核对『无状态条目』与『Cookie 文件存在』两个条件"))
        if not re.search(r"cookieEvidencePartitions\.push\(\s*name\s*\)", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "首启 Cookie 保护集写入 persist: 键，与 budget 的目录名规范键不一致"))
        if not re.search(r"unknownAccountSource\.push\(\s*name\s*\)", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "未知账号保护集写入 persist: 键，无法在 budget 中命中"))
        if re.search(r"['\"]persist:tether-dsh-local['\"]", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "gc 保护集仍使用带 persist: 的本地分区字面量"))
        if not re.search(r"activeServicePartitions\(\)[\s\S]{0,240}?\.map\(\s*partitionDirectoryName\s*\)", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "activeServicePartitions() 的 persist: 返回未经边界转换"))
        if not re.search(r"const\s+protectedPartitions\s*=[\s\S]{0,700}?"
                         r"\.\.\.cookieEvidencePartitions", gc):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "cookieEvidencePartitions 未并入 protectedPartitions，本轮回收仍会删除首启分区"))
    if not re.search(r"(?:state\.evidence|hasCredentialEvidence)[\s\S]{0,300}?hasLoginState"
                     r"|hasLoginState[\s\S]{0,300}?(?:state\.evidence|hasCredentialEvidence)", gc):
        problems.append(_maintenance_problem(
            "apps/tether-app/main.js",
            "Cookie 证据没有折算成 hasLoginState，首启分区仍会进入 removable"))
    if not re.search(r"report\.removable[\s\S]{0,300}?fs\.rmSync\(", gc):
        problems.append(_maintenance_problem(
            "apps/tether-app/main.js",
            "removable 与不可回收分区共用同一删除路径，无法证明登录豁免生效"))
    if not re.search(r"clearWorkbenchCacheOnly[\s\S]{0,1200}?PARTITION_CACHE_SUBDIRS", main):
        problems.append(_maintenance_problem(
            "apps/tether-app/main.js",
            "cacheTrim 未按 PARTITION_CACHE_SUBDIRS 精确清理，可能连 Network/Cookies 一起删"))
    if re.search(r"report\.cacheTrim[\s\S]{0,400}?fs\.rmSync\(\s*path\.join\(\s*dir\s*,\s*name\s*\)", gc):
        problems.append(_maintenance_problem(
            "apps/tether-app/main.js",
            "cacheTrim 对登录分区执行整目录 rmSync，登录态与 HTTP cache 未分离"))
    return problems


def _check_legacy_selector(maintenance: str) -> list[dict]:
    """保留旧 selectStalePartitions 形状的判据，避免门禁只认新实现而漏掉历史分支。"""
    problems: list[dict] = []
    selector = function_body(maintenance, "function selectStalePartitions")
    if not selector:
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "找不到 selectStalePartitions，回收判据无法核对"))
        return problems
    if not re.search(PROTECTION_TOKEN, selector):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "selectStalePartitions 只按 mtime/数量决定删除，没有受保护分区入参："
            "持有有效登录会话的分区到期即被静默清掉"))
        return problems

    stale_branch = re.search(r"(?:const|let)\s+stale\s*=[^;\n]*(?:;|\n)", selector)
    if not stale_branch:
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "找不到 mtime 到期分支，无法确认已登录分区被豁免"))
    elif not re.search(PROTECTION_TOKEN, stale_branch.group(0)):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "mtime 到期删除路径没有排除受保护分区：已登录分区到期即被回收",
            stale_branch.group(0).strip()[:160]))

    region = re.search(r"(?:const|let)\s+fresh\s*=[\s\S]{0,400}?slice[^)]*\)", selector)
    if not region:
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "找不到数量溢出删除路径，无法确认已登录分区被豁免"))
    elif not re.search(PROTECTION_TOKEN, region.group(0)):
        problems.append(_maintenance_problem(
            "apps/tether-app/data-maintenance.js",
            "maxCount 溢出路径没有排除受保护分区：已登录分区会被「最新里最旧」挤掉",
            region.group(0).strip()[:160]))
    return problems


def check_auth_reset() -> list[dict]:
    """DSH-6：认证复位与分区回收不得无故清掉已登录会话。

    现场事实：`apps/tether-app/main.js:gcWorkbenchPartitions()` 在启动时与每 24 小时
    跑一次，把 mtime 超过 12 小时的 `persist:tether-wb-*` 目录整棵 `rmSync` 掉；
    这些分区正是 DSH/Codeg 登录态的存放处。当前实现把 age、maxCount、登录态和
    首启 Cookie 证据统一收进 `partitionBudgetReport`，所以门禁按 removable 的
    实际来源核对，而不是只认旧的 `selectStalePartitions` 文本形状。
    `repair_auth` 只在用户点一键修复时经 RPC 触发并做时间戳备份，这部分是对的。
    """
    problems: list[dict] = []
    maintenance = read("apps/tether-app/data-maintenance.js")
    budget = function_body(maintenance, "function partitionBudgetReport")
    if budget:
        problems.extend(_check_budget_contract(maintenance, budget))
    else:
        problems.extend(_check_legacy_selector(maintenance))

    main = read("apps/tether-app/main.js")
    gc = function_body(main, "function gcWorkbenchPartitions")
    if not gc:
        problems.append(_maintenance_problem("apps/tether-app/main.js", "找不到 gcWorkbenchPartitions"))
    elif budget:
        problems.extend(_check_main_budget_gc(main, gc))
    else:
        call = re.search(r"selectStalePartitions\(([^)]*)\)", gc)
        if not call or not re.search(PROTECTION_TOKEN, call.group(1)):
            problems.append(_maintenance_problem(
                "apps/tether-app/main.js",
                "gc 调用 selectStalePartitions 时没有传入在用/已登录分区保护集："
                "正在被 workbench 挂载的分区也可能被删（Windows 上目录 rmSync "
                "不会因为 busy 失败）"))

    desktop = read("tether/node/dsh_desktop.py")
    body = def_block(desktop, "def repair_auth")
    if not body:
        problems.append(_maintenance_problem(
            "tether/node/dsh_desktop.py", "找不到 repair_auth，无法核对复位是否可回滚"))
    else:
        for label, pattern in [("appdata 备份", r"appdata_backup"),
                               ("凭据备份", r"credentials_backup"),
                               ("先停实例", r"self\.stop\(\)"),
                               ("备份已存在则拒绝执行", r"dsh_backup_exists")]:
            if not re.search(pattern, body):
                problems.append(_maintenance_problem(
                    "tether/node/dsh_desktop.py", f"repair_auth 缺少{label}，认证复位不可回滚"))
    service = read("tether/node/fs_service.py")
    op = def_block(service, "def _op_dsh_repair_auth")
    if op and "audit" not in op:
        problems.append(_maintenance_problem(
            "tether/node/fs_service.py", "认证复位入口没有审计记录"))
    return problems


def check_selection() -> list[dict]:
    """DSH-5：随包 DSH 与已安装 DeepSeek Harness 的选择边界必须确定且可校验。

    真实的契约在 `tether/node/dsh_desktop.py:_candidate_exes`：`TETHER_DSH_EXE` 覆盖优先、
    再按已知 home 派生、再 LOCALAPPDATA/ProgramFiles、最后 C..G 盘根扫描，去重保序。
    优先级本身是确定的；风险在最后一档盘根扫描可能落到未批准实例，所以门禁要求
    实际选中的路径必须能被批准清单校验。
    """
    problems: list[dict] = []
    desktop = read("tether/node/dsh_desktop.py")
    plugin = read("tether/node/dsh_plugin.py")
    adapter = read("tether/node/dsh_adapter.py")
    if not desktop:
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_desktop.py",
                         "why": "定位文件缺失", "text": ""})
        return problems
    if not re.search(r"EXE_NAME\s*=\s*[\"']DeepSeek Harness\.exe[\"']", desktop):
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_desktop.py",
                         "why": "已安装桌面 Harness 的识别名不再固定，候选会漂", "text": ""})
    if not re.search(r"def _candidate_exes", desktop):
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_desktop.py",
                         "why": "有序候选函数不在，选择结果可能随环境变化", "text": ""})
    if "TETHER_DSH_EXE" not in desktop:
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_desktop.py",
                         "why": "显式 override 入口被移除，指定实例无法保证被选中", "text": ""})
    if not re.search(r"seen\.add|normcase", desktop):
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_desktop.py",
                         "why": "候选去重不再保序，同一台机可能连到不同实例", "text": ""})
    # 盘根扫描保留为兜底可以，但选中结果必须被批准清单约束（真机半边由 mapping 校验）。
    # 词边界是必须的：不加边界时 "typing"/"mapping" 里的 "pin" 会让这条永远为真（假绿灯）。
    if re.search(r"for drive in \(\"C\"", desktop) and not re.search(
            r"\b(approved|allowlist|allow_list|expected_exe|instance_pin)", desktop, re.I):
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_desktop.py",
                         "why": "C..G 盘根扫描兜底存在，但选中路径没有与批准实例清单比对的约束："
                                "换一台机器或未装随包实例时，可能连到另一个 DSH 账号面", "text": ""})
    if plugin and not re.search(r"(?i)dsh\.cmd", plugin):
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_plugin.py",
                         "why": "插件侧 CLI 路径解析缺失，可能落到系统 PATH 上的另一个 dsh", "text": ""})
    if adapter and "DeepSeekHarness" not in adapter:
        problems.append({"gate": "DSH-5", "file": "tether/node/dsh_adapter.py",
                         "why": "SDK 适配器不再显式引用 DeepSeekHarness，来源不明", "text": ""})
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="DSH 账号/映射可证明门禁（只读）")
    parser.add_argument("--check", required=True,
                        choices=["mapping", "ui-account", "selection", "auth-reset"])
    parser.add_argument("--descriptor", default=None, help="从设备导出的 native-surface.json")
    parser.add_argument("--dsh-home", default=None, help="本机 DSH_HOME（只读）")
    parser.add_argument("--active-pid", default=None, help="当前活跃 DSH 实例 PID")
    parser.add_argument("--instances", default=None, help="活跃实例快照（[{pid,..}] 或 {instances:[..]}）")
    parser.add_argument("--approved", default="docs/dsh-approved-instances.json")
    parser.add_argument("--allow-host-inspection", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.check == "mapping":
        problems = check_mapping(args)
    elif args.check == "ui-account":
        problems = check_ui_account()
    elif args.check == "auth-reset":
        problems = check_auth_reset()
    else:
        problems = check_selection()

    if args.json:
        print(json.dumps({"check": args.check, "verdict": "PASS" if not problems else "FAIL",
                          "findings": problems}, ensure_ascii=False, indent=2))
    else:
        for item in problems:
            print(f"[{item['gate']}] {item['file']}  {item['why']}")
        print(f"\n{'PASS' if not problems else 'FAIL'}：{args.check} 共 {len(problems)} 项")
        if args.check == "mapping":
            print("产物：把本输出与 descriptor 原文一起存进证据记录，字段含 origin/auth_url/pid/dsh_home。")
        if args.check == "ui-account":
            print("注意：这条只判「代码有没有正向暴露登录态」。DSH-3/DSH-4 的行为结论必须真机："
                  "外部浏览器登录 DSH 后 Tether 仍显示未登录；Tether 内登录后页面立刻显示账号并刷新会话。")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
