# 终端 / Agent / 登录体验修订计划

2026-11-03。依据主人本轮反馈，按“先修明显反人类的地方，再补适配接口，最后做锦上添花”排序。

## 完成情况（2026-11-03，0.3.0–0.3.1）

- 已完成：APP 登录 ×、DSH 登录面板内布局（真机退出/恢复登录验证）、终端停靠资源管理器（目录右键/cwd/shell 切换）、shell 目标机能力、Agents 图标/品牌/模型切换/命令 chip/多会话标签。
- 已完成（0.3.3）：终端改真 PTY + xterm，PowerShell/Git Bash 原生提示符与交互实测；dock 配色跟随工作台；shell 下拉改自绘主题菜单；悬浮卡不再遮挡右键菜单。
- 部分完成：连接质量已复测（跨网 p2p 3.64 MB/s、同 LAN 未复现）；强制中继对照、DSH 未登录态在 APP 内的 × 端到端、Mac/Linux 真机安装仍待补。
- 后延：`apps.json` 小白化、Herdr 内嵌（已确认其是 Rust TUI、Apache-2.0，先借鉴交互不内嵌）、虚拟机多系统测试。

## 做（按顺序）

1. **APP 登录页加关闭键**：未登录时右上角始终有 ×，APP 关闭到托盘；DSH 仍保留“返回 DSH”。
2. **DSH 登录不再盖住整个宿主**：登录卡片改为插件面板内的普通流式布局，保留 DSH 侧边栏；不再用铺满窗口的绝对定位。
3. **终端并入资源管理器**：
   - 目录右键“在终端中打开”、工具栏终端按钮；
   - 终端停靠在资源管理器底部，可拖动高度、可关闭，不再占满整个页面；
   - 切换目录时终端不强制重启，新开时使用当前目录。
4. **终端适配接口**：
   - Node 暴露 `terminal_shells`（Windows：PowerShell / PowerShell 7 / cmd / Git Bash；macOS/Linux：登录 shell / bash / zsh / sh）；
   - `terminal_start` 接受 `cwd` 与 `shell`，会话按目标机 OS 选命令；
   - UI 提供 shell 下拉，默认按目标机能力选择；
   - 为 macOS/Linux 保留同一接口，后续只在 Node 侧补命令映射。
5. **Agents 页外观**：换掉难看的机器人图标；补 Harness 品牌块（Codex/OpenCode 等）、模型/命令入口；消息区可选中复制。
6. **连接质量汇报**：补一次同 LAN 下的 100 MB 实测与 EasyTier 路径（direct/relay）记录；再做一次强制中继/跨网测试并写进 `docs/TRANSFER_LIMITS.md`。

## 缓做

- 远程应用 `apps.json` 小白化：先保留通道，后续做成“检测到本机 HTTP 服务→一键登记”，不再让用户手写 JSON。
- Her/Herdr 式多 Agent 终端 UI：先调研其许可与嵌入门槛，再决定是内嵌其前端还是只借鉴交互。
- 虚拟机多系统安装测试：需要先启用 Hyper-V/装 VM，随后按 Windows/macOS/Linux 顺序跑安装与 shell 适配。

## 不做

- 不把终端做成独立活动栏页面；保留 Node 的 `fs/terminal_*` 协议。
- 不为每个 OS 复制一套 UI；差异只在 Node 的 shell 解析与能力字段。
- 不在本轮重写 ACP 协议栈；先补展示与模型入口。