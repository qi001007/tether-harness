#!/usr/bin/env python3
"""Tether 发布门禁 runner。

两类门禁：

- ``auto``  本机能跑起来的脚本门禁。runner 直接执行命令，把退出码、完整日志、
  日志 SHA-256 写成一条证据记录。退出码 0=PASS、3=BLOCKED（脚本自检到前置条件不成立，
  例如批准清单仍是草案，此时不得用当前观测值签署通过）、其余=FAIL。
- ``real``  必须真机验收的门禁。runner 不执行任何操作，只校验
  ``.scratch/release-gate/<version>/real/<gate>.json`` 是否存在且字段齐全：
  版本、提交、设备、系统、时间、截图/日志路径与 SHA-256、实测数字。
  缺任何一项判 ``BLOCKED``，不判 PASS。

verdict 只在所有 blocking 门禁都为 PASS 时才输出 READY；否则退出码非 0。
本脚本不发布、不调用 Hub、不改网络配置、不安装任何东西。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Windows 控制台默认 GBK，门禁输出的中文与路径会乱码；强制 UTF-8。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# 门禁注册表：docs/RELEASE_GATE.md 的 ID 必须与这里逐条对应。
# ---------------------------------------------------------------------------

GATES: list[dict] = [
    # --- 制品完整性 -------------------------------------------------------
    dict(
        id="ART-1", blocking=True, kind="auto",
        title="app.asar require 图完整（含 data-maintenance）",
        command=["node", "--test", "tests/test_candidate_build.mjs"],
        criteria="electron-builder files 白名单覆盖 main.js/preload.js 的整条 require 图与子进程路径；reachable 必须含 data-maintenance.js",
        doc="docs/RELEASE_GATE.md#art-1",
    ),
    dict(
        id="ART-2", blocking=True, kind="auto",
        title="打包 DSH 的 pnpm 真实可执行",
        command=["node", "desktop/packaging/check-dsh-pnpm.cjs",
                 "--runtime", ".runtime/desktop-candidate"],
        criteria="用包内 node 实际执行包内 pnpm 入口，--version 输出必须等于 pnpm.json 的固定版本，退出码 0",
        doc="docs/RELEASE_GATE.md#art-2",
        needs="desktop-candidate 装配产物（未构建时 BLOCKED，不算通过）",
    ),
    dict(
        id="ART-3", blocking=True, kind="auto",
        title="Codeg / DSH / Herdr / croc 组件资源完整",
        command=["python", "scripts/release_gate_assets.py",
                 "--runtime", ".runtime/desktop-candidate"],
        criteria="每个组件的入口文件、固定版本、可执行位与逐文件 SHA-256 清单齐全；缺文件或版本不匹配即失败",
        doc="docs/RELEASE_GATE.md#art-3",
        needs="desktop-candidate 装配产物",
    ),
    dict(
        id="ART-4", blocking=True, kind="auto", network=True,
        title="GitHub release 资产存在且清单签名/哈希校验通过",
        command=["python", "scripts/qa_release_artifacts.py"],
        criteria="Hub 清单 Ed25519 验签通过；三件套 URL 可达、SHA-256 与 size 逐一对上；必需文件在场且无 node_modules/.env/hub.json/.credentials.yaml",
        doc="docs/RELEASE_GATE.md#art-4",
        needs="已存在的 draft/公开 release 与导出的 Hub 清单快照；只读下载",
    ),
    # --- 版本一致 ---------------------------------------------------------
    dict(
        id="VER-1", blocking=True, kind="auto",
        title="仓库内版本号四处一致",
        command=["python", "scripts/release_pipeline.py", "status", "--expect", "{version}"],
        criteria="version.json / pyproject.toml / apps/tether-app/package.json / package-lock.json 全部等于候选版本",
        doc="docs/RELEASE_GATE.md#ver-1",
    ),
    dict(
        id="VER-2", blocking=True, kind="auto",
        title="Hub pin 与 manifest 的 node/app 版本一致",
        command=["python", "scripts/release_gate_hub_pin.py", "--expected-version", "{version}",
                 "--hub-manifest", "{hub_manifest}", "--release-assets", "{release_assets}"],
        criteria="离线比对快照：manifest.components.app/node 的 version 与 platforms 条目一致；pin 指向候选版本；每个 URL 的资产名出现在 release 资产清单内且带 sha256/size",
        doc="docs/RELEASE_GATE.md#ver-2",
        needs="主人从 Hub 导出的 manifest 快照与 `gh release view --json assets` 输出",
    ),
    dict(
        id="VER-3", blocking=True, kind="auto",
        title="不广告已撤包 / 不引用被取代资产",
        command=["python", "scripts/release_gate_hub_pin.py", "--expected-version", "{version}",
                 "--hub-manifest", "{hub_manifest}", "--withdrawn", "{withdrawn}"],
        criteria="清单与 pin 里不得出现撤回过的资产名（如已撤下的 APP 包）；命中即失败",
        doc="docs/RELEASE_GATE.md#ver-3",
    ),
    # --- 分发分层（Hub 是小服务器，不是下载中心）--------------------------
    dict(
        id="DST-1", blocking=True, kind="auto",
        title="源序由服务端策略决定，产品默认第一跳是源站",
        command=["python", "scripts/release_gate_distribution.py", "--check", "dst-1"],
        criteria="节点必须消费清单 artifact_sources；未设显式镜像时默认第一跳为 origin、Hub 镜像只作兜底；策略可重排但不得删层；必须有双向回归",
        doc="docs/RELEASE_GATE.md#dst-1",
    ),
    dict(
        id="DST-2", blocking=True, kind="auto",
        title="Hub 出口字节比 ≤10%（J17.1）",
        command=["python", "scripts/release_gate_distribution.py", "--check", "dst-2",
                 "--manifest", "{hub_manifest}", "--devices", "{fleet_size}"],
        criteria="按 N 台合成批次算计划字节分层，Hub 自有出口占比必须 ≤10%；缺 --hub-manifest 判 BLOCKED，不判通过",
        doc="docs/RELEASE_GATE.md#dst-2",
        needs="需要 --hub-manifest 清单快照",
    ),
    dict(
        id="AUD-1", blocking=True, kind="auto",
        title="分发审计可回答「这台从哪层拿到件」",
        command=["python", "scripts/release_gate_distribution.py", "--check", "aud-1",
                 "--hub-repo", "{hub_repo}"],
        criteria="客户端必须记录 served_by 与逐次尝试的源/原因码并落进 prepared.json；Hub 必须有镜像用量（served_bytes）、并发闸与 mirror_quota_exhausted 显式降级码",
        doc="docs/RELEASE_GATE.md#aud-1",
        needs="Hub 半边需要 --hub-repo；缺了判 BLOCKED",
    ),
    # --- 网络与隐私 -------------------------------------------------------
    dict(
        id="NET-1", blocking=True, kind="auto",
        title="源码不创建 TUN、不改默认路由",
        command=["python", "scripts/release_gate_network.py", "--scan", "--check", "tun-route"],
        criteria="首方源码（tether/ apps/ packages/ desktop/ laptop/ scripts/）内不得出现 TUN 创建、路由改写、`--tun` 默认开启；mesh 引导必须显式 `--no-tun`",
        doc="docs/RELEASE_GATE.md#net-1",
    ),
    dict(
        id="NET-2", blocking=True, kind="auto",
        title="源码不触碰 PPPoE / RAS",
        command=["python", "scripts/release_gate_network.py", "--scan", "--check", "pppoe"],
        criteria="不得出现 rasdial / New-VpnConnection / Add-VpnConnection / RAS 拨号或凭据写入调用",
        doc="docs/RELEASE_GATE.md#net-2",
    ),
    dict(
        id="NET-3", blocking=True, kind="auto",
        title="源码不改 Edge / 系统代理",
        command=["python", "scripts/release_gate_network.py", "--scan", "--check", "proxy"],
        criteria="不得写 ProxyEnable / ProxyServer / ProxyOverride / WinINET 或 Edge 代理策略、不得设 PAC",
        doc="docs/RELEASE_GATE.md#net-3",
    ),
    dict(
        id="NET-4", blocking=True, kind="auto",
        title="不残留外部私有 mesh 实例",
        command=["python", "scripts/release_gate_network.py", "--scan", "--check", "private-mesh"],
        criteria="首方源码/脚本不得安装或自启独立 mesh 实例；主机侧的服务、计划任务、进程检测需 `--host-snapshot` 单独跑并出真机证据",
        doc="docs/RELEASE_GATE.md#net-4",
    ),
    dict(
        id="PRV-1", blocking=True, kind="auto",
        title="状态输出与日志不泄漏 token",
        command=["python", "scripts/release_gate_network.py", "--scan", "--check", "token"],
        criteria="状态 URL / 日志 / 诊断字段里的 token 必须走掩码 helper；已知泄漏面（Hub capabilities、runtime 文件预览）必须有拦截断言",
        doc="docs/RELEASE_GATE.md#prv-1",
    ),
    # --- vendored Codeg 页面 ------------------------------------------------
    dict(
        id="CODEG-UI-1", blocking=True, kind="auto",
        title="Codeg web 产物等于主人批准的字节版本（旧包混进来即挡）",
        command=["python", "scripts/release_gate_codeg.py", "--check", "bundle"],
        criteria="tether/node/bin/agents-runtime/web 整目录 sha256 与文件数必须等于 docs/codeg-approved-entries.json 的 bundle_pin；不等即说明发布链拿到了未重建/被回退的旧页面",
        doc="docs/RELEASE_GATE.md#codeg-ui-1",
        needs="docs/codeg-approved-entries.json 需主人把 status 改成 approved 后才算签署通过，草案期判 BLOCKED",
    ),
    dict(
        id="CODEG-UI-2", blocking=True, kind="auto",
        title="Codeg 入口集合不得扩大、已裁功能不得回归",
        command=["python", "scripts/release_gate_codeg.py", "--check", "entries"],
        criteria="产物 html 页面集合必须与批准清单完全相等；docs/codeg-pruned-features.json 列出的被裁路由页与设置子页出现任一即 FAIL",
        doc="docs/RELEASE_GATE.md#codeg-ui-2",
        needs="两份清单需主人批准，草案期判 BLOCKED",
    ),
    dict(
        id="CODEG-UI-3", blocking=True, kind="auto",
        title="Codeg 产物为批准版页面契约（非更早的旧构建）",
        command=["python", "scripts/release_gate_codeg.py", "--check", "contract"],
        criteria="批准版独有的 tether:show-home / data-conversation-header / 组件独有串必须在场，cursor-col-resize 命中数不得超上限，_next/static 构建 ID 目录数不得 >1（>1 = 增量叠加的脏产物）",
        doc="docs/RELEASE_GATE.md#codeg-ui-3",
        needs="两份清单需主人批准，草案期判 BLOCKED",
    ),

    # --- 唯一入口 ---------------------------------------------------------
    dict(
        id="ENT-1", blocking=True, kind="auto",
        title="桌面/开始菜单入口名唯一（不出现两个 Tether 入口）",
        command=["python", "scripts/release_gate_entry_uniqueness.py",
                 "--scan-source", "--check", "ENT-1"],
        criteria="NSIS 的 productName 入口与 install-app.ps1 / ensureAppShortcuts 写出的 .lnk 必须是同一个名字；createDesktopShortcut/createStartMenuShortcut 显式声明",
        doc="docs/RELEASE_GATE.md#ent-1",
    ),
    dict(
        id="ENT-2", blocking=True, kind="auto",
        title="入口 target / 图标 / AppUserModelId 同源一致",
        command=["python", "scripts/release_gate_entry_uniqueness.py",
                 "--scan-source", "--check", "ENT-2"],
        criteria="appId == AppUserModelId；win 图标指向唯一品牌源；不得有图标回退到可执行文件；自愈写出的 .lnk 需与 NSIS 入口同组",
        doc="docs/RELEASE_GATE.md#ent-2",
    ),
    dict(
        id="ENT-3", blocking=True, kind="auto",
        title="覆盖升级清理 legacy 入口",
        command=["python", "scripts/release_gate_entry_uniqueness.py",
                 "--scan-source", "--check", "ENT-3"],
        criteria="NSIS 迁移逻辑必须删除历史入口名（Tether APP.lnk、Tether-App.cmd 等），安装脚本不得继续按旧名写入口",
        doc="docs/RELEASE_GATE.md#ent-3",
    ),
    dict(
        id="ENT-4", blocking=True, kind="real", title="卸载后桌面/开始菜单不留 Tether 入口",
        doc="docs/RELEASE_GATE.md#ent-4",
        evidence_fields=["device", "os", "screenshot", "log", "snapshot_after_uninstall"],
        measured_fields=["entry_count_after_uninstall"],
        note="只读枚举快照必须随附；非 NSIS 创建的入口需被卸载流程或自愈逻辑显式清理"),
    # --- DSH 账号与映射 ---------------------------------------------------
    dict(
        id="DSH-1", blocking=True, kind="auto",
        title="DSH 映射 endpoint/DSH_HOME/profile 与批准实例一致",
        command=["python", "scripts/release_gate_dsh_account.py", "--check", "mapping",
                 "--descriptor", "{dsh_descriptor}", "--approved", "{dsh_approved}"],
        criteria="native-surface.json 的 origin 必须是回环且落在批准实例集合内；auth_url 与 origin 同主机；pid 必须还活着；dsh_home 必须属于批准实例",
        doc="docs/RELEASE_GATE.md#dsh-1",
        needs="设备导出的 native-surface.json 与 docs/dsh-approved-instances.json 批准清单",
    ),
    dict(
        id="DSH-2", blocking=True, kind="auto",
        title="Tether 页面正向显示当前 DSH 账号/登录态",
        command=["python", "scripts/release_gate_dsh_account.py", "--check", "ui-account"],
        criteria="UI 侧要有正向的 DSH 账号/登录态字段与渲染，不能只在 401 时被动提示重登；DSH RPC 需保持 dsh-auth cookie 前缀与只读 endpoint 白名单",
        doc="docs/RELEASE_GATE.md#dsh-2",
    ),
    dict(
        id="DSH-3", blocking=True, kind="real", title="外部浏览器登录 DSH 不得被误判为 Tether 已登录",
        doc="docs/RELEASE_GATE.md#dsh-3",
        evidence_fields=["device", "os", "screenshot", "log", "external_login_state", "tether_state"],
        measured_fields=["misjudge_detected"],
        note="外部浏览器完成 DSH 登录后，Tether 侧必须仍显示未登录且能一键进入登录"),
    dict(
        id="DSH-4", blocking=True, kind="real", title="Tether 内登录成功后页面刷新并同步账号/会话",
        doc="docs/RELEASE_GATE.md#dsh-4",
        evidence_fields=["device", "os", "screenshot", "log", "account_shown"],
        measured_fields=["refresh_ms", "session_list_ms"],
        note="登录态变化要触发 descriptor 重发与页面刷新，不能靠用户手刷"),
    dict(
        id="DSH-5", blocking=True, kind="auto",
        title="随包 DSH 与已装 DeepSeek Harness 的选择边界明确",
        command=["python", "scripts/release_gate_dsh_account.py", "--check", "selection"],
        criteria="EXE_NAME 固定、_candidate_exes 有序且 override 优先、去重保序；盘根扫描兜底必须受批准实例清单约束，不得静默连到未批准实例",
        doc="docs/RELEASE_GATE.md#dsh-5",
    ),
    dict(
        id="DSH-6", blocking=True, kind="auto",
        title="认证复位与分区回收不得清掉已登录会话",
        command=["python", "scripts/release_gate_dsh_account.py", "--check", "auth-reset"],
        criteria="selectStalePartitions 要有受保护分区入参；gcWorkbenchPartitions 调用时必须传入在用/已登录分区保护集；repair_auth 保留 appdata+凭据备份、先停实例、备份已存在则拒绝，RPC 入口带审计",
        doc="docs/RELEASE_GATE.md#dsh-6",
    ),
    # --- 更新行为 ---------------------------------------------------------
    dict(
        id="UPD-1", blocking=True, kind="auto",
        title="更新页 UI 契约（APP/Node 分开、28px 纯图标无文字）",
        command=["python", "scripts/release_gate_update_page.py", "--check", "ui-contract"],
        criteria="更新中心 APP 行与 Node 行分列可独立操作；远程操作按钮为 28px 图标且无中文标签；断言给到 file:line",
        doc="docs/RELEASE_GATE.md#upd-1",
    ),
    dict(
        id="UPD-2", blocking=True, kind="auto",
        title="逐行短超时、整页不空转",
        command=["python", "scripts/release_gate_update_page.py", "--check", "timeout"],
        criteria="刷新按行独立短超时并逐行落状态；任一设备离线不得让整页停在 loading；行级失败与页面级失败分开",
        doc="docs/RELEASE_GATE.md#upd-2",
    ),
    dict(
        id="UPD-3", blocking=True, kind="auto",
        title="更新页 cache-first（打开即渲染上一份快照）",
        command=["python", "scripts/release_gate_update_page.py", "--check", "cache-first"],
        criteria="进入页面先用缓存快照渲染，后台刷新不清空已有行；同请求去重、切换目标预取",
        doc="docs/RELEASE_GATE.md#upd-3",
    ),
    dict(
        id="UPD-4", blocking=True, kind="auto",
        title="远端 job 在目标端静默",
        command=["python", "scripts/release_gate_update_page.py", "--check", "target-silent"],
        criteria="远程更新任务在目标机不得弹控制台窗口/前台提示；子进程一律 windowsHide，目标端只留卡片状态",
        doc="docs/RELEASE_GATE.md#upd-4",
    ),
    dict(
        id="UPD-5", blocking=True, kind="auto",
        title="更新失败可回滚（事务边界）",
        command=["python", "scripts/release_gate_update_page.py", "--check", "rollback"],
        criteria="apply 失败路径必须调用暂存回滚并保留原运行态；旧版本文件与清单在校验通过前不得被覆盖",
        doc="docs/RELEASE_GATE.md#upd-5",
    ),
    dict(
        id="UPD-6", blocking=True, kind="auto",
        title="更新链离线回归（含下一版兼容）",
        command=["node", "--test", "--test-force-exit",
                 "tests/test_update_chain.mjs", "tests/test_update_service.mjs",
                 "tests/test_dsh_local_updates.mjs", "tests/test_update_version_line.mjs"],
        criteria="暂存/校验/切换/回滚全链回归通过，更新入口与版本行断言不退化",
        doc="docs/RELEASE_GATE.md#upd-6",
    ),
    dict(
        id="REG-1", blocking=True, kind="auto",
        title="Python 全量回归",
        command=["python", "-m", "pytest", "-q",
                 "--deselect",
                 "tests/test_updates.py::test_built_release_archives_prepare_and_apply_for_all_components"],
        criteria="pytest 全绿；唯一 deselect 项与 CI 保持一致，去掉它必须写清原因",
        doc="docs/RELEASE_GATE.md#reg-1",
    ),
    dict(
        id="REG-2", blocking=True, kind="auto",
        title="Node 全量回归（含 DSH/Agents/更新/终端）",
        command=["node", "--test", "--test-force-exit", "tests/test_*.mjs", "tests/test_*.cjs"],
        criteria="node:test 全绿；已知缺口只能显式登记，不能用跳过冒充通过",
        doc="docs/RELEASE_GATE.md#reg-2",
    ),
    # --- P0 功能实机（全部要求真机证据） ---------------------------------
    dict(id="F-CODEG-LOCAL", blocking=True, kind="real", title="Codeg 本地：结构化会话真实往返",
         doc="docs/RELEASE_GATE.md#f-codeg",
         evidence_fields=["device", "os", "screenshot", "log", "agent_reply"],
         measured_fields=["roundtrip_ms", "first_token_ms"]),
    dict(id="F-CODEG-REMOTE", blocking=True, kind="real", title="Codeg 远程：跨机结构化会话真实往返",
         doc="docs/RELEASE_GATE.md#f-codeg",
         evidence_fields=["device", "os", "screenshot", "log", "agent_reply"],
         measured_fields=["roundtrip_ms", "first_token_ms", "click_p95_ms"]),
    dict(id="F-DSH-LOCAL", blocking=True, kind="real", title="DSH 本地：终端与插件面板同时可用",
         doc="docs/RELEASE_GATE.md#f-dsh",
         evidence_fields=["device", "os", "screenshot", "log", "plugin_version"],
         measured_fields=["pty_echo_ms", "surface_ready_ms"]),
    dict(id="F-DSH-REMOTE", blocking=True, kind="real", title="DSH 远程：跨机终端真实输入输出",
         doc="docs/RELEASE_GATE.md#f-dsh",
         evidence_fields=["device", "os", "screenshot", "log", "plugin_version"],
         measured_fields=["keystroke_p95_ms", "pty_echo_ms"]),
    dict(id="F-AGENTS-CODEX-STRUCT", blocking=True, kind="real", title="Agents / Codex 结构化模式",
         doc="docs/RELEASE_GATE.md#f-agents",
         evidence_fields=["device", "os", "screenshot", "log", "agent_reply"],
         measured_fields=["open_ms", "roundtrip_ms"]),
    dict(id="F-AGENTS-CODEX-TERM", blocking=True, kind="real", title="Agents / Codex 终端模式",
         doc="docs/RELEASE_GATE.md#f-agents",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["open_ms", "keystroke_p95_ms"]),
    dict(id="F-AGENTS-OPENCODE-STRUCT", blocking=True, kind="real", title="Agents / OpenCode 结构化模式",
         doc="docs/RELEASE_GATE.md#f-agents",
         evidence_fields=["device", "os", "screenshot", "log", "agent_reply"],
         measured_fields=["open_ms", "roundtrip_ms"]),
    dict(id="F-AGENTS-OPENCODE-TERM", blocking=True, kind="real", title="Agents / OpenCode 终端模式",
         doc="docs/RELEASE_GATE.md#f-agents",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["open_ms", "keystroke_p95_ms"]),
    dict(id="F-TRANSFER", blocking=True, kind="real", title="文件传输：三端六向真实吞吐与摘要一致",
         doc="docs/RELEASE_GATE.md#f-transfer",
         evidence_fields=["device", "os", "screenshot", "log", "sha256_source", "sha256_target"],
         measured_fields=["mb_per_min", "elapsed_s", "streams"],
         note="源与目标 SHA-256 必须相同；测不准写未知，不得写通过"),
    dict(id="F-HUB-LOGIN", blocking=True, kind="real", title="Hub 登录：设备码与账号登录",
         doc="docs/RELEASE_GATE.md#f-account",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["login_ms"]),
    dict(id="F-ACCOUNT-WORKSPACE", blocking=True, kind="real", title="账号资料与工作区跨机同步",
         doc="docs/RELEASE_GATE.md#f-account",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["sync_ms"]),
    dict(id="F-UPDATE-CENTER", blocking=True, kind="real", title="更新中心：本机与远程逐行状态可见",
         doc="docs/RELEASE_GATE.md#f-update-center",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["refresh_ms"]),
    dict(id="F-REMOTE-WORKBENCH", blocking=True, kind="real", title="远程工作台：跨机文件/终端/Agent 同屏",
         doc="docs/RELEASE_GATE.md#f-workbench",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["open_ms", "click_p95_ms"]),
    # --- 更新真机 ---------------------------------------------------------
    dict(id="UPD-7", blocking=True, kind="real", title="真机普通更新（非诊断启动）",
         doc="docs/RELEASE_GATE.md#upd-7",
         evidence_fields=["device", "os", "screenshot", "log", "version_before", "version_after"],
         measured_fields=["mb_per_min", "elapsed_s"],
         note="每台设备单独一条记录；版本字段滞后时以对端新运行态 descriptor 为准"),
    dict(id="UPD-8", blocking=True, kind="real", title="更新中断/失败后回滚可用",
         doc="docs/RELEASE_GATE.md#upd-8",
         evidence_fields=["device", "os", "screenshot", "log", "version_restored"],
         measured_fields=["rollback_s"]),
    # --- 平台矩阵 ---------------------------------------------------------
    dict(id="PLAT-WIN-CLEAN", blocking=True, kind="real", title="Windows 11 干净安装",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log", "installed_version"],
         measured_fields=["install_s"]),
    dict(id="PLAT-WIN-UPGRADE", blocking=True, kind="real", title="Windows 11 覆盖升级（保留身份与工作区）",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log", "device_id_before", "device_id_after"],
         measured_fields=["upgrade_s"]),
    dict(id="PLAT-LINUX-CLEAN", blocking=True, kind="real", title="Linux Hub 干净安装",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log", "installed_version"],
         measured_fields=["install_s"]),
    dict(id="PLAT-LINUX-UPGRADE", blocking=True, kind="real", title="Linux Hub 覆盖升级与重启回连",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["reconnect_s"]),
    dict(id="PLAT-MAC-CLEAN", blocking=True, kind="real", title="macOS 干净安装（Gatekeeper 未拦截）",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log", "installed_version"],
         measured_fields=["install_s"]),
    dict(id="PLAT-MAC-UPGRADE", blocking=True, kind="real", title="macOS 覆盖升级",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log"],
         measured_fields=["upgrade_s"]),
    dict(id="PLAT-ROLLBACK", blocking=True, kind="real", title="三平台回滚到上一公开版",
         doc="docs/RELEASE_GATE.md#plat",
         evidence_fields=["device", "os", "screenshot", "log", "version_restored"],
         measured_fields=["rollback_s"]),
]

GATE_BY_ID = {gate["id"]: gate for gate in GATES}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def sha256_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            value.update(block)
    return value.hexdigest()


def resolve(placeholders: str, args: argparse.Namespace) -> str:
    """按占位符名替换；属性缺失一律当空值。

    这里必须用 getattr：`GATES` 由多条线共同维护，任何一条新加占位符时，
    直接 `args.<name>` 会让所有构造不完整 namespace 的调用方（含测试）AttributeError。
    """
    def value(name: str) -> str:
        raw = getattr(args, name, None)
        return "" if raw is None else str(raw)

    for name in ("version", "hub_manifest", "release_assets", "withdrawn",
                 "hub_repo", "fleet_size", "dsh_descriptor", "dsh_approved"):
        placeholders = placeholders.replace("{" + name + "}", value(name))
    return placeholders


def evidence_dir(args: argparse.Namespace, kind: str) -> Path:
    return ROOT / args.evidence_root / args.version / kind


# ---------------------------------------------------------------------------
# auto 门禁
# ---------------------------------------------------------------------------

def expand_glob(argument: str) -> list[str]:
    """`node --test tests/test_*.mjs` 的星号在 Windows 上不会由 shell 展开，
    而 runner 不经过 shell，所以自己展开。无匹配时原样保留，让命令自己报错。
    """
    if "*" not in argument and "?" not in argument:
        return [argument]
    matches = sorted(str(path.relative_to(ROOT)) for path in ROOT.glob(argument))
    return matches or [argument]


SNAPSHOT_ARGS = {"hub_manifest": "hub-manifest", "release_assets": "release-assets",
                 "withdrawn": "withdrawn", "dsh_descriptor": "dsh-descriptor",
                 "dsh_approved": "dsh-approved", "hub_repo": "hub-repo"}


def run_auto_gate(gate: dict, args: argparse.Namespace) -> dict:
    out_dir = evidence_dir(args, "auto")
    out_dir.mkdir(parents=True, exist_ok=True)
    record = {"gate": gate["id"], "kind": "auto", "version": args.version,
              "commit": args.commit, "blocking": gate["blocking"]}

    missing_input = False
    command: list[str] = []
    for part in gate.get("command", []):
        holder = re.search(r"\{(\w+)\}", part)
        if holder and holder.group(1) in SNAPSHOT_ARGS:
            key = holder.group(1)
            value = getattr(args, key, None)
            if not value:
                missing_input = True
                record["reason"] = f"缺少输入 --{SNAPSHOT_ARGS[key]}（快照由主人导出，门禁不代取）"
                break
            part = part.replace("{" + key + "}", value)
        else:
            part = resolve(part, args)
        command.extend(expand_glob(part))
    if gate.get("network") and not args.allow_network:
        missing_input = True
        record["reason"] = "该门禁需要只读下载公开制品，未加 --allow-network"
    if missing_input:
        record.update(verdict="BLOCKED")
        return record
    record["command"] = command

    log_path = out_dir / f"{gate['id']}.log"
    started = time.time()
    try:
        proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=args.timeout,
                              env={**os.environ, "PYTHONUTF8": "1",
                                   "PYTHONIOENCODING": "utf-8"})
        log_path.write_text(f"$ {' '.join(command)}\n\n{proc.stdout}\n--- stderr ---\n{proc.stderr}\n",
                            encoding="utf-8")
        record.update(exit_code=proc.returncode,
                      verdict={**{0: "PASS", 3: "BLOCKED"}, 4: "DEGRADED"}.get(proc.returncode, "FAIL"),
                      elapsed_s=round(time.time() - started, 1),
                      log=str(log_path.relative_to(ROOT)),
                      log_sha256=sha256_file(log_path))
        lines = (proc.stderr or proc.stdout).strip().splitlines()
        # 优先展示结论行（PASS/FAIL/BLOCKED/DEGRADED/OK/verdict），否则退回末行。
        detail = next((line for line in reversed(lines)
                       if re.match(r"^(PASS|FAIL|BLOCKED|DEGRADED|OK|verdict)", line.strip())), None)
        if detail is None:
            detail = lines[-1] if lines else "<no output>"
        record["detail"] = detail[:400]
    except FileNotFoundError as exc:
        record.update(verdict="BLOCKED", reason=f"命令不可用：{exc}")
    except subprocess.TimeoutExpired:
        record.update(verdict="FAIL", reason=f"超过 {args.timeout}s 未结束")
    return record


# ---------------------------------------------------------------------------
# real 门禁：只校验证据，绝不代替真机
# ---------------------------------------------------------------------------

def verify_real_gate(gate: dict, args: argparse.Namespace) -> dict:
    record_path = evidence_dir(args, "real") / f"{gate['id']}.json"
    result = {"gate": gate["id"], "kind": "real", "version": args.version,
              "blocking": gate["blocking"], "record": str(record_path.relative_to(ROOT))}
    if not record_path.is_file():
        result.update(verdict="BLOCKED", reason="没有真机证据记录")
        return result

    try:
        record = json.loads(record_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        result.update(verdict="FAIL", reason=f"证据 JSON 解析失败：{exc}")
        return result

    problems: list[str] = []
    if record.get("verdict") != "pass":
        problems.append(f"verdict={record.get('verdict')!r}，只有 pass 才算过")
    if args.version and record.get("version") != args.version:
        problems.append(f"证据版本 {record.get('version')!r} 不等于候选 {args.version}")
    if args.commit:
        evidence_commit = str(record.get("commit", ""))
        if not evidence_commit:
            problems.append("证据缺少 commit")
        elif not (args.commit.startswith(evidence_commit) or evidence_commit.startswith(args.commit)):
            problems.append(f"证据提交 {evidence_commit} 与候选提交 {args.commit} 不符")
    executed_at = str(record.get("executed_at", ""))
    if not ISO_RE.match(executed_at):
        problems.append("executed_at 必须是 ISO 时间")
    elif args.not_before and executed_at < args.not_before:
        problems.append(f"证据时间 {executed_at} 早于冻结提交时间 {args.not_before}，属旧结果")
    for field in gate.get("evidence_fields", []):
        if not record.get(field):
            problems.append(f"缺少字段 {field}")
    measured = record.get("measured") or {}
    for field in gate.get("measured_fields", []):
        value = measured.get(field)
        if value in (None, "", "unknown"):
            problems.append(f"实测数字 {field} 缺失或为 unknown")

    for item in record.get("evidence", []):
        path = ROOT / str(item.get("path", ""))
        if not path.is_file():
            problems.append(f"证据文件不存在：{item.get('path')}")
            continue
        claimed = str(item.get("sha256", ""))
        actual = sha256_file(path)
        if claimed != actual:
            problems.append(f"证据文件哈希不符：{item.get('path')}")

    result.update(verdict="PASS" if not problems else "FAIL",
                  problems=problems, device=record.get("device"), os=record.get("os"),
                  measured=measured, executed_at=executed_at)
    return result


# ---------------------------------------------------------------------------
# 子命令
# ---------------------------------------------------------------------------

def cmd_list(args: argparse.Namespace) -> int:
    for gate in GATES:
        kind = "AUTO" if gate["kind"] == "auto" else "REAL"
        flag = "P0" if gate["blocking"] else "P1"
        print(f"{gate['id']:<22} {kind:<4} {flag:<2} {gate['title']}")
    print(f"\n共 {len(GATES)} 条，blocking {sum(1 for g in GATES if g['blocking'])} 条。")
    return 0


def collect(args: argparse.Namespace, only: list[str] | None = None) -> list[dict]:
    results = []
    for gate in GATES:
        if only and gate["id"] not in only:
            continue
        if args.skip_real and gate["kind"] == "real":
            continue
        if args.skip_auto and gate["kind"] == "auto":
            continue
        if gate["kind"] == "auto":
            print(f"[auto] {gate['id']} {gate['title']}", flush=True)
            results.append(run_auto_gate(gate, args))
        else:
            results.append(verify_real_gate(gate, args))
    return results


def print_verdict(results: list[dict], args: argparse.Namespace) -> int:
    counts = {"PASS": 0, "FAIL": 0, "BLOCKED": 0, "DEGRADED": 0}
    blockers = []
    for row in results:
        counts[row["verdict"]] = counts.get(row["verdict"], 0) + 1
        if row["blocking"] and row["verdict"] in {"FAIL", "BLOCKED"}:
            blockers.append(row)
    print("\n| 门禁 | 类型 | 判定 | 说明 |")
    print("| --- | --- | --- | --- |")
    for row in results:
        note = row.get("detail") or row.get("reason") or ""
        if row.get("problems"):
            note = "；".join(row["problems"][:3])
        print(f"| {row['gate']} | {row['kind']} | {row['verdict']} | {note[:120]} |")
    summary = {"version": args.version, "commit": args.commit, "counts": counts,
               "blocked_by": [row["gate"] for row in blockers],
               "verdict": "READY-FOR-APPROVAL" if not blockers else "PUBLISH-BLOCKED"}
    # 只跑了一部分门禁时不得给全局结论：漏评的 blocking 门禁一律算未过。
    evaluated = {row["gate"] for row in results}
    unrun = [gate["id"] for gate in GATES if gate["blocking"] and gate["id"] not in evaluated]
    if unrun:
        summary["verdict"] = "PARTIAL"
        summary["not_evaluated"] = unrun
    out_dir = ROOT / args.evidence_root / args.version
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "verdict.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                          encoding="utf-8")
    print(f"\nPASS {counts['PASS']} / FAIL {counts['FAIL']} / BLOCKED {counts['BLOCKED']} / DEGRADED {counts['DEGRADED']}")
    print("verdict:", summary["verdict"])
    if blockers:
        print("阻塞门禁:", ", ".join(summary["blocked_by"]))
    if unrun:
        print(f"未评 blocking 门禁 {len(unrun)} 条：{', '.join(unrun[:8])}"
              f"{' …' if len(unrun) > 8 else ''}")
        print("部分运行不构成发布结论，退出码 2。")
    print("判定产物:", (out_dir / "verdict.json").relative_to(ROOT))
    if unrun:
        return 2
    return 0 if not blockers else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tether 发布门禁 runner")
    parser.add_argument("action", choices=["list", "run", "check-evidence", "auto"])
    parser.add_argument("--version", default=None, help="候选版本，例如 0.5.15")
    parser.add_argument("--commit", default=None, help="候选提交短哈希")
    parser.add_argument("--not-before", default=None, help="冻结提交时间，早于它的证据一律不算")
    parser.add_argument("--only", default=None, help="逗号分隔的门禁 ID")
    parser.add_argument("--hub-manifest", default=None, help="导出的 Hub manifest 快照路径")
    parser.add_argument("--release-assets", default=None, help="gh release view --json assets 输出路径")
    parser.add_argument("--withdrawn", default=None, help="已撤包资产名清单路径")
    parser.add_argument("--hub-repo", default=None,
                        help="tether-harness-server 源码目录；缺了 AUD-1 的 Hub 半边判 BLOCKED")
    parser.add_argument("--fleet-size", type=int, default=100, help="DST-2 的批次规模")
    parser.add_argument("--dsh-descriptor", default=None, help="设备导出的 native-surface.json")
    parser.add_argument("--dsh-approved", default=None, help="DSH 批准实例清单路径")
    parser.add_argument("--evidence-root", default=".scratch/release-gate")
    parser.add_argument("--allow-network", action="store_true",
                        help="允许 ART-4 只读下载公开制品")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--json", action="store_true")
    return parser


def defaults_namespace() -> argparse.Namespace:
    """返回一份与 CLI 完全一致的默认参数表。

    测试与外部调用方都用它，不要手抄字段：`GATES` 里每加一个占位符，手抄的
    namespace 就会漏字段并把 BLOCKED 变成 AttributeError（2026-11-25 REG-1 就是这么红的）。
    """
    return build_parser().parse_args(["list"])


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.action == "list":
        return cmd_list(args)

    only = [item.strip() for item in args.only.split(",")] if args.only else None
    if only:
        unknown = [gate for gate in only if gate not in GATE_BY_ID]
        if unknown:
            print(f"未知门禁：{', '.join(unknown)}", file=sys.stderr)
            return 2

    if args.version is None:
        version_file = ROOT / "version.json"
        if version_file.is_file():
            args.version = json.loads(version_file.read_text(encoding="utf-8"))["components"]["app"]

    args.skip_real = args.action == "auto"
    args.skip_auto = args.action == "check-evidence"
    results = collect(args, only)
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    return print_verdict(results, args)


if __name__ == "__main__":
    raise SystemExit(main())
