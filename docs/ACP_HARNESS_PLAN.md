# Agent Harness（ACP）接入计划

2026-11-03。目标：让 Tether 在“终端”之外，用结构化协议驱动目标电脑上已装好的编码 Agent（Gemini CLI、OpenCode、Claude Code、Codex CLI、Cursor 等），而不是为每个 CLI 各写一套私有适配。

## 协议事实

- ACP（Agent Client Protocol）是 Zed 发起的开放协议，定位是“Agent 界的 LSP”：客户端（IDE/终端/UI）与 Agent 进程之间用 **JSON-RPC 2.0** 通信，默认 **stdio + newline-delimited JSON**；也支持 HTTP/WebSocket 远程承载。
- 核心方法：`initialize`、`session/new`、`session/prompt`、`session/cancel`；Agent 通过 `session/update` 通知流式返回消息、工具调用与计划；权限请求（文件/命令）由客户端回执。
- 与 MCP 互补：MCP 管“Agent 能访问哪些数据/工具”，ACP 管“客户端如何驱动 Agent、如何渲染与审批”。
- 生态（2026-10）：Gemini CLI 是参考实现；OpenCode、Cursor、Copilot CLI、Kimi CLI 等原生支持；Claude Code 与 Codex CLI 通过 Zed 的 adapter 接入；ACP Agent Registry（2026-01，Zed + JetBrains）提供“注册一次、各编辑器可装”。

## 接入方式（不在 Tether 内重写 Agent）

Node 只做 ACP 客户端，按“命令模板”拉起目标机上已有的 Agent/adapter：

| Harness | 启动方式（示例） | 说明 |
|---|---|---|
| Gemini CLI | `gemini --experimental-acp` | 参考实现，优先做首个样张 |
| OpenCode | `opencode acp` | 原生 ACP |
| Claude Code | `npx -y @zed-industries/claude-code-acp` 或已装 adapter | 复用本机登录态 |
| Codex CLI | Zed 的 codex adapter / `codex app-server` | adapter 负责私有协议↔ACP |
| Cursor / Copilot / Kimi | 各自 ACP 入口 | 检测到再列 |

检测策略：只查用户 PATH 上已存在的可执行文件（`where.exe`/`which`），不自动安装、不下载；未安装的 Harness 显示“未检测到”，不弹安装。

## Node 侧（M0 窄切片）

新增 `tether/node/acp.py`，复用 `fs` 受控通道（与 terminal 同模式，无需部署 Hub）：

- `acp_detect`：返回检测到的 harness（id/name/command/version）。
- `acp_start`：`{harness, cwd}` → 拉起子进程，完成 `initialize` 与 `session/new`，返回 `session_id`。
- `acp_prompt`：`{session_id, text}` → `session/prompt`。
- `acp_poll`：`{session_id, since}` → 增量事件（文本块、工具调用、计划、权限请求、结束原因），按字节/序号游标。
- `acp_reply`：`{session_id, request_id, option}` → 回执权限请求（允许/拒绝/仅本次）。
- `acp_cancel` / `acp_stop`：取消当前轮次；停止时杀进程树。
- 约束：命令模板写死在代码里（白名单），不接受 UI 传入任意命令行；cwd 默认目标工作区；Windows 无窗口；owner-only；超时与输出上限与 terminal 相同。

## UI（M1）

活动栏“Agents”页：

- 设备选择 → 检测结果列表（已安装/未安装、版本）。
- 选中 Harness → 打开会话面板：消息流（assistant/工具调用/计划）、输入框、停止/取消。
- 权限请求作为内联卡片（允许一次/总是/拒绝），绝不自动批准。
- 与“终端”页共用增量轮询与 `inFlight` 单飞行闸，避免重复输出。

## 验收

- Gemini CLI 或 OpenCode 任一：检测 → 开会话 → 发一条 prompt → 流式收到文本与至少一个工具调用 → 拒绝一次权限 → 取消一轮 → 关闭会话；全程在 DESKTOP APP 里完成，不切窗口。
- 目标机未装任何 ACP Harness 时页面显示空态，不报错。
- 非 owner 调用被 Hub 拒绝；子进程不是管理员权限；不留孤儿进程。

## 验收结果（2026-11-03，0.2.98 源码）

- 真机 DESKTOP 已有 `codex-acp`（npm shim）。Windows 下无扩展名的 shim 不能直接 `CreateProcess`，实现里优先解析 `.cmd/.bat/.exe` 并用 `cmd.exe /c` 启动。
- 真实链路：`initialize`（protocol 1）→ `session/new`（返回 sessionId）→ `session/prompt` → 流式 `agent_message_chunk` 合并为 `tether-ui-ok` → `[完成] end_turn`；会话面板在真实 Electron APP 内渲染。
- 单元测试：假 ACP Agent 覆盖检测、握手、prompt、权限请求回执、结果与停止，5 passed。
- 仍需补：真实工具调用的权限卡片交互、Gemini/OpenCode/Claude adapter 的真机验收、非 owner 端到端拒绝。

## 非目标

- 不在 Tether 内实现 Agent 推理/工具循环；只做 ACP 客户端。
- 不自动安装 Harness 或 adapter；安装/登录仍由用户在目标机完成。
- 首版不覆盖远程 HTTP/WebSocket 承载，只做本地 stdio（EasyTier 已解决跨机，ACP 只需在本机跑）。
- 不替代 DSH 原生工作区：DSH 仍走自己的认证 surface。

## 参考

- ACP 协议与生态：[Agent Client Protocol 协议介绍](https://www.xiexianbin.cn/ai/agentic/acp/)、[ACP 与 Agent Harness](https://blog.csdn.net/tian_wang/article/details/164215759)、[ACP 协议详解](https://www.google.com/goto?url=CAESdQHrOzAVLZr3dbvn28kpnwOK0vlSKMFFTYcHgORxMjnKv0_TMzbnHjUvGyWX_QIgemTjqmGn1WtUGbjs-TvM-ckZQhWufkxh8wS3poBQ0VgSkENTLOzIrs1N5bOSEp3g8ngowOO3NJWCiRXj9pcD-PFZTKlozg)
- Harness 适配清单：[Agent Client Protocol 全景解析](https://m.blog.csdn.net/YAU3EJNLm/article/details/162234016)、[Claude Code/Codex/Cursor 互通](https://m.toutiao.com/a7642711305639445038/)
- 多 CLI 统一接入的工程参考：[把 5 个编码 Agent 塞进一个 npm 包](https://juejin.cn/post/7660046768504881158)