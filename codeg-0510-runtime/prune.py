# -*- coding: utf-8 -*-
"""Codeg 已构建产物裁剪脚本（基线 d8b64c8c78bce7e0）。

用法: python prune.py <baseline_dir> <out_dir>
幂等: 每次都从只读基线整树复制到 out_dir 后再打补丁，同一基线跑两次输出一致。

三项差量:
1. 侧栏导航/快捷入口数据源删掉 forge(仓库面板)、canvas(无限画布)、projectBoot(项目启动器)，
   并删掉我们自己加的 Agents 导航行，只保留 automations、tasks；
2. 删掉新建会话空状态里我们自己加的“选择 Agent 开始”按钮；
3. 在主 CSS chunk 末尾追加滚动条规则（默认隐藏、悬停显示、更细更浅）。
"""
import re
import shutil
import sys
from pathlib import Path


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def patch_js(path: Path, checks: list) -> str:
    text = path.read_text(encoding="utf-8")
    report = []
    # 1a. Agents 导航行（我们加的 Agent 按钮，侧栏顶部，children 数组首项，尾随逗号）
    pat = re.compile(
        r'\(0,[\w$.]+\.jsx\)\([\w$]+,\{icon:[\w$.]+\.f,label:[\w$]+\("agents"\),'
        r'active:"agents"===[\w$]+,onClick:\(\)=>\{[\w$]+&&[\w$]+\(\),[\w$]+\("agents"\)\}\}\),')
    text, n = pat.subn("", text)
    report.append(("agents_nav_row", n))
    # 1b. forge / canvas 快捷导航项
    for item in ("forge", "canvas"):
        pat = re.compile(
            r',\(0,[\w$.]+\.jsxs\)\([\w$.]+\.r,\{onSelect:\(\)=>[\w$]+\("%s"\),'
            r'children:\[.*?\]\}\)' % item)
        text, n = pat.subn("", text)
        report.append((item, n))
    # 1c. projectBoot 入口项
    pat = re.compile(
        r',\(0,[\w$.]+\.jsxs\)\([\w$.]+\.r,\{onSelect:[\w$]+,'
        r'children:\[.*?"projectBoot".*?\]\}\)')
    text, n = pat.subn("", text)
    report.append(("projectBoot", n))
    # 2. 新建会话空状态的“选择 Agent 开始”按钮
    pat = re.compile(
        r',\(0,[\w$.]+\.jsx\)\("button",\{type:"button",onClick:\(\)=>'
        r'[\w$]+\(.*?\),className:"[^"]*选择 Agent 开始.*?\}\)')
    text, n = pat.subn("", text) if pat.search(text) else (text, 0)
    # 更稳的写法：直接匹配整段 button jsx
    pat2 = re.compile(
        r'\(0,[\w$.]+\.jsx\)\("button",\{type:"button",onClick:\(\)=>'
        r'[\w$]+\([^)]*\),className:"text-xs[^"]*",children:"选择 Agent 开始"\}\)')
    text, n2 = pat2.subn("", text)
    report.append(("agent_start_button", n + n2))
    path.write_text(text, encoding="utf-8")
    return "; ".join("%s=%d" % (k, v) for k, v in report)


SCROLLBAR_CSS = (
    "/* tether-prune: scrollbar hidden by default, thin+light on hover */"
    "*{scrollbar-width:thin;scrollbar-color:transparent transparent;"
    "transition:scrollbar-color .2s ease}"
    ":hover{*{scrollbar-color:rgba(127,127,127,.32) transparent}}"
    "::-webkit-scrollbar{width:6px;height:6px;background:transparent;"
    "transition:width .2s ease}"
    "::-webkit-scrollbar-thumb{background:transparent;border-radius:3px;"
    "transition:background-color .2s ease}"
    ":hover::-webkit-scrollbar-thumb{background:rgba(127,127,127,.32)}"
    ":hover::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.48)}"
    ":hover::-webkit-scrollbar-track{background:transparent}"
)


def main() -> int:
    base = Path(sys.argv[1])
    out = Path(sys.argv[2])
    copy_tree(base, out)
    chunks = out / "_next" / "static" / "chunks"
    results = {}
    for name in ("0hjqkcd79ahe_.js", "3tmev4n-ekvzw.js",
                 "1k9_37hljdctk.js", "24c8s_scl3b2h.js"):
        p = chunks / name
        if p.is_file():
            results[name] = patch_js(p, [])
    css = chunks / "2xgfiqcdbf4_k.css"
    css_text = css.read_text(encoding="utf-8")
    if "tether-prune" not in css_text:
        css.write_text(css_text + SCROLLBAR_CSS, encoding="utf-8")
    results["2xgfiqcdbf4_k.css"] = "appended %d chars" % len(SCROLLBAR_CSS)
    for k, v in results.items():
        print("%s -> %s" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
