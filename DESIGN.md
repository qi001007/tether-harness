# Tether：让 Agent 拥有跨设备的手

> 题二设计文档 · 2026-10-27
> 代码与证据：https://github.com/qi001007/tether-harness
> 交互端是 DeepSeek Harness 桌面 APP；Tether 只是它调用的 MCP 工具。

---

## 0. TL;DR

### 0.1 我做了什么

- 用户在 **DeepSeek Harness 官方桌面 APP** 里正常对话，记忆、技能、插件市场都还是 DeepSeek 的；
- DSH 侧栏装了 **Tether 原生 client 插件**：目标机 **工作区/会话树**、**磁盘文件树**、设备、原生对话（思考/工具折叠过程组）、文件读写、任务、权限/审计都在 DSH 里完成，没有 iframe、没有第二个聊天 App；
- DeepSeek 的 Agent 通过 **Tether MCP** 调用 `list_peers` / `remote_task` / `remote_status` / `remote_cancel` / `remote_files` / `remote_workspaces` / `remote_audit`；
- 任务被送到另一台电脑的 Tether Node，由那台机器上的 Harness Agent 用它自己的文件、shell、模型 key 执行；
- 工具事件、结果和继续会话都在 DeepSeek 的对话里；
- Tether 自己的聊天页降级为**监控台**：看设备、任务、事件和证据，不是主入口。

这就是"交互端始终是一个独立的 Agent"：DeepSeek Harness 是 Agent，Tether 是它的跨设备工具层与远程工作区页面。

### 0.2 已用真实数据验证

| 主张 | 实测 |
|---|---|
| DSH 插件可安装、可渲染 | 干净卸载后由 `desktop/install-plugin.ps1` 重装；侧栏出现 `Tether`，工作区/文件/设备/过程页渲染 |
| 已有 DSH 工作区能打开 | `default-workspace` 解析到 `D:\DeepSeek harness\workspace`；readonly 下可写并留审计 |
| 目标机原生对话能看 | 解析 `~/.dsh/sessions` 的 zstd 日志：2 轮、8 个 reasoning/tool/text 块；页面与 DSH 截图同一标题/工具/回答 |
| 权限真的分级 | readonly 写盘外路径 → 400；full 模式同路径可写；`C:\Windows` 与 `.dsh/.credentials.yaml` 始终拒绝 |
| 删除可恢复 | 文件移动到 `D:\TetherWorkspaces\.tether-trash\<时间>-<名>` |
| 插件内发起/取消任务 | run `r-f358e95993e9`：首事件 1261 ms，取消后 `cancelled` |
| DeepSeek 桌面 Agent 自己调用 Tether | 在官方桌面 APP 里问"用 Tether 列出设备"，它调用 `list_peers`，返回已配对设备与在线状态 |
| Agent 让 Agent 干活 | 它调用 `remote_task` 让 `LAPTOP-01` 创建 `D:\tether-node\work\tether-delegated.txt`，内容 `OK` |
| 目标端是同一个持久 Harness 会话 | 第二次只读校验 run `r-8fa5928462a6` 复用 `dsh_session=tether-s-d0332f33ad47` |
| 文件真的写对了 | 2 字节，字节 `4F 4B`，无 BOM、无换行 |
| 取消无残留 | 取消前 6 个进程（dsh → sandbox → pwsh → python），取消后只剩节点守护进程，残留 **0** |
| 断线不丢事件 | 8 秒断网，事件缓冲重放：13 个事件、`ack_seq=13`、序号连续、重复 0 |
| 幂等 | 同 `request_id` 同内容 1 个 Run；异内容 409 |
| 不确定不假装成功 | 节点被杀后 Run 进 `unknown`，不自动重跑；重启后 `reconcile` 返回真实状态 |
| 跨机走 Tailscale | `LAPTOP-01` 通过 `100.x` 接入；Controller 的 UI/API 仍只允许本机，只有 `/ws/node` 对 tailnet 开放 |

截图：`docs/screenshots/dsh-plugin-workspaces.png`、`dsh-plugin-native-chat.png`、
`dsh-plugin-dark.png`、`dsh-plugin-files.png`、`dsh-plugin-permissions.png`、
`deepseek-desktop.png`、`deepseek-after-tether.png`、`deepseek-delegated.png`。

### 0.3 当前实现 vs 目标架构（先看边界）

| 维度 | 已验证的 v0.1（代码里真的有） | 目标 v0.2（设计，未实现） |
|---|---|---|
| 交互端 | DeepSeek Harness 桌面 APP + Tether 插件页 + Tether MCP | 每台设备都跑同一个桌面 APP + 插件 |
| 拓扑 | 星型：一个 Controller 路由，多个 Node 执行 | 对等：任意两台 Agent 可互相派活，无唯一 master |
| 发起方 | 桌面 Agent 发起；笔记本是被控节点 | 每台设备都可发起/被控 |
| 接入 | 插件安装脚本 + 笔记本 bootstrap + `.env` | 配对码/邀请，GitHub 一键安装 |
| 文件 | Node 端 policy/audit，三档权限，全盘只读/显式全盘写 | 正式 ACL、配额、只读挂载 |
| Harness | 官方 Python SDK + npm dsh 运行时 | 可扩展 ACP adapter（Qoder/Codex/Claude Code） |
| 可靠性 | `seq/ack/journal`、幂等、`unknown`、硬取消、resume | 原样复用，扩展到多 peer |

**不把 v0.2 的对等网络冒充成已实现。** 第 9 节给出从 v0.1 到 v0.2 的具体改法。

---

## 1. 题目拆解

题面要求：用户有多台电脑，在任意一台已接入的电脑上，通过客户端操作其他电脑上的 Agent Harness（以 dsh 为例），用目标电脑的文件、资源和运行环境完成任务；支持远程发起、查看执行过程与结果、继续或管理任务；不同电脑的 OS、资源、网络、在线状态可能不同。

我把它拆成四层：

1. **交互层**：用户面对的必须是 Agent（会对话、有记忆/技能），而不是一个任务控制台。
2. **工具层**：这个 Agent 要能发现"还有哪些电脑可用"，并把任务派过去。
3. **执行层**：目标电脑上的 Agent 真的读写文件、跑命令、用本地模型 key。
4. **交付层**：任务有唯一身份、可重放事件、可取消、可继续；断线/崩溃不能产生"以为失败其实执行了"的结果。

### 1.1 关键产品判断

最早我做了一个独立的 Tether 聊天 App，想让它当交互端。这个方向是错的：

- 它复制不了 DeepSeek Harness 的记忆管理、技能和插件市场；
- 用户已经有自己的 Agent，换一个陌生聊天框不是"客户端"，是"替代品"；
- 题目说的是"操作其他电脑上的 Agent Harness"，不是"再写一个 Agent"。

所以最终架构改为 **Agent-first**：

- **DeepSeek Harness 桌面 APP 是交互端**（也支持 Qoder/Codex 等 MCP 客户端）；
- **Tether 是 MCP 工具层**，只负责发现设备、派发任务、查询状态、取消；
- **Tether 自己的 UI 只做监控/证据**。

### 1.2 假设

- 单 owner、2–5 台个人设备；设备间通过 Tailscale 或可信局域网互联。
- 目标机器的模型 key 只属于该机器，不经过发起端。
- 任务可能持续数分钟到数小时；网络会抖、设备会休眠/重启。
- 首发验证 Windows；Linux 只做设计。

### 1.3 明确不做

- 多租户、复杂 RBAC、公网 Relay 集群。
- 任务跨机迁移（dsh 会话单写者、工作区不迁移）。
- 多任务并发（v0.1 每 Session 同时一个 Run）。
- 生产级 WSS/mTLS、设备吊销、审计、速率限制。
- 审批 UI：安装的 SDK wheel 没有 `approval_requests` 握手，标 Designed。
- 对等网络的"每台设备都能发起"：v0.1 只有桌面 Agent 发起，笔记本是被控端。

---

## 2. 开源先例与选型

| 项目 | 事实 | 结论 |
|---|---|---|
| **DeepSeek Harness（dsh）** | 官方 Electron 桌面 APP；TS/Cordis 插件架构；ACP v1；Python SDK；Web UI 单机 | **交互端 + 被控 Agent**；桌面 APP 直接用，Node 用 Python SDK 驱动 |
| **Qoder** | 本机 IDE + CLI 1.1.78；CLI 支持 `--acp`、`--mcp-config` | 可作为另一个 MCP 客户端；首发不做 |
| **Codex** | CLI 0.163.0；原生 MCP | 可作为另一个 MCP 客户端；首发不做 |
| **Raven** | 5.8k★ Apache-2.0 Python；gateway + WS RPC + ACP + 反向 SSH node + Job Object + 回放 | 最接近控制面；node 仅 POSIX/SSH、alpha；只作设计参考，不 fork |
| **nanoMuse** | 2.6k★ GPL-3.0 Swift；每台设备本地 Agent，relay 共享会话，Sentinel 审批 | 借"共享会话 + 审批门"思想；无 Windows/桌面 harness，不复制代码 |
| **Herdr** | 46k★ Apache-2.0 Rust；PTY 运行时 + 多端客户端；多设备靠 SSH；事件 512 条不重放 | 备选终端客户端；不是 harness 客户端 |
| **Orca** | 106k★ MIT TS；已支持 dsh 但走 TUI + hooks；插件 API 读不到会话流 | 结构化 dsh 接入要 600–900 行；20h 内不做 |
| **Happy** | 24k★ MIT；E2EE relay + ACP；daemon 仅 macOS | Windows 受控端不成立 |

### 2.1 接入方式

- **桌面 APP**：官方 Windows 安装包 `https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe`；登录 DeepSeek 账号，选工作区。
- **Agent ↔ Tether**：`@deepseek-ai/dsh-mcp-client`，stdio 配置写在 `~/.dsh/profiles/desktop/cordis.patch.yml`；工具名 `mcp__tether__*`。
- **Node ↔ dsh**：官方 Python SDK；每个 Run 一个 worker thread + 一个 dsh 运行时；事件、resume、关闭由 SDK 管。
- **网络**：Tailscale + 节点主动外连 WSS；Controller 绑 `0.0.0.0`，但 HTTP UI/API 只允许 loopback，只有 `/ws/node` 带 token 对 tailnet 开放。

### 2.2 两个真实的坑（Gate 0 发现）

1. **Windows wheel 的 koffi 路径 bug**：`deepseek-harness-sdk==0.2.1rc2` 把 `@koromix/koffi-win32-x64` 解析到构建机路径 `E:\snapshot\node\...`，每个 turn 都报 `The specified module could not be found`。
   - 绕过：装 npm 版 dsh，用 SDK 的 `_launch_args` 指向 `node .../dsh/lib/bin.js --profile sdk`；SDK 仍负责会话/事件/resume/关闭。
   - 代码：`tether/node/dsh_adapter.py:npm_launch_args()`。
2. **SDK 没有协作式取消**：协议只有 `session/prompt`、`session/resume`、`session/wait`、`session/working-directory/*`，没有 `session/cancel`；`Session.run()` 阻塞到 idle。
   - 所以取消是**硬取消**：`harness.close()` → 宽限 → 进程树终止 → `cancelled`；无法确认则 `unknown`；下一轮 `resume_session` 修复被中断的 turn。
   - 文档不写"协作式取消"。

---

## 3. 架构

### 3.1 v0.1：Agent 在 DeepSeek，Tether 在下面

```
┌────────────────── DeepSeek Harness 桌面 APP（交互端）──────────────────┐
│  普通对话 · 记忆 · 技能 · 插件市场                                    │
│  工具列表里多出：mcp__tether__list_peers / remote_task / ...           │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ MCP stdio
                    ┌───────────▼───────────┐
                    │  Tether MCP server    │  只做工具，不做对话
                    └───────────┬───────────┘
                                │ HTTP
                    ┌───────────▼───────────┐
                    │ Tether Controller     │  设备/会话/Run/事件/幂等
                    │ FastAPI + SQLite      │  UI/API 仅 loopback
                    └───────┬───────┬───────┘
                            │ WSS   │ WSS（Tailscale）
                ┌───────────▼──┐  ┌─▼──────────────────────────────┐
                │ Node DESKTOP │  │ Node LAPTOP-01 → dsh Agent     │
                │ → dsh Agent  │  │ workspace D:\tether-node\work  │
                └──────────────┘  └────────────────────────────────┘
Tether 监控台网页（controller 静态页）：可选，看设备/任务/事件/证据，不是交互端。
```

角色边界：

| 角色 | 负责 | 不负责 |
|---|---|---|
| DeepSeek Harness 桌面 APP | 对话、记忆、技能、插件、决定何时调用工具 | 跨设备传输 |
| Tether MCP server | `list_peers` / `remote_task` / `remote_status` / `remote_cancel` / `remote_files` / `remote_workspaces` / `remote_audit` | 执行命令、持有 key、替代 Agent |
| Tether Controller | 设备注册、会话、Run、事件日志、幂等、`unknown`、SSE | 执行代码、模型调用 |
| Tether Node | 拉起 dsh、翻译事件、本地 journal、进程树、本地控制台 | 决策、对话 |

**为什么 Node 必须存在**：dsh 的 SDK/ACP 是 stdio，跟着 dsh 进程走，不监听网络端口；Node 是把它变成出站 WSS 的适配器，同时负责进程树和能力清单。

### 3.2 v0.2 目标：每台设备都是 Agent + Tether

```
设备 A：DeepSeek 桌面 APP + Tether MCP + 本地 Node + peer 注册表
        ⇅ 出站 WSS（Tailscale）
设备 B：DeepSeek 桌面 APP + Tether MCP + 本地 Node + peer 注册表
```

- 每台设备同一份包、同一个入口；每台既能发起也能被控；不再有唯一 master。
- 设备 A 的 DeepSeek Agent 通过本地 MCP 调 `remote_task(device=B)`；B 的 Agent 在本机执行；事件/结果回流到 A 的 DeepSeek 对话。
- 对等连接、配对码、能力清单、任务路由是 v0.2 的增量；可靠性内核原样复用。

### 3.3 为什么 v0.1 先做星型

- 20 小时内，星型是拿到"真实远端执行 + 断线恢复 + 取消无残留"证据的最小路径。
- 对等网络需要多控制面、peer 发现/配对、N×N 连接、每台设备的鉴权；这些是 v0.2 的增量，不是 v0.1 的前置。
- 星型的 Controller/Node 已按设备/会话/Run/事件抽象，改成对等主要改连接拓扑和入口，可靠性层不动。

---

## 4. 领域模型与状态机

| 对象 | 字段 | 说明 |
|---|---|---|
| Device | `device_id, name, platform, capabilities, allowed_workspace, online, last_seen` | 一台被控电脑；能力清单含 OS/shell/agents/workspace |
| RemoteSession | `session_id, device_id, workspace, harness_session_id, created_at` | 可继续的远端 Agent 会话；同一 Session 单写者 |
| Run | `run_id, session_id, request_id, fingerprint, prompt, state, finish_reason, final_response, outcome, ack_seq` | 一次提示词执行；继续任务 = 同 Session 下新 Run |
| RunEvent | `run_id, seq, kind, ts, payload`，唯一键 `(run_id, seq)` | 不可变事件流；tool/assistant/thought/log |

```
queued ──► dispatching ──► running ──► completed
                             │
                             ├──► cancelling ──► cancelled
                             ├──► failed
                             └──► unknown  ◄── 节点掉线/崩溃/终态前断链
```

- `completed` 只表示 Agent 正常结束，不代表测试/业务目标成功；命令非零退出写 `outcome`。
- `unknown` 是安全占位，不是判决；节点重连后可以上报真实状态校正，但绝不自动重跑。
- 同一 Session 同时只允许一个活跃 Run（会话级单写者）；第二个 Run 在第一个终态前 409。

---

## 5. 可靠性与交付语义

### 5.1 事件流

- Node 先把事件写本地 SQLite outbox（fsync），再发 Controller。
- Controller 落库 commit 后才 ack；`ack_seq` 取最高**连续**序号，有缺口不前进。
- Node 只截断 `seq <= ack_seq`；重连从 `last_ack+1` 重放；Controller 用 `(run_id, seq)` 去重。
- 语义：at-least-once + 幂等效果，不声称 exactly-once。

### 5.2 幂等

- 键：`(device_id, request_id)`；指纹：`sha256(prompt + agent + workspace)`。
- 同键同指纹返回原 Run；同键异指纹 409；响应丢失不假装成功。

### 5.3 取消（SDK 限制下的硬取消）

1. 用户在 DeepSeek 对话里让 Agent 取消，或监控台点取消 → Controller 置 `cancelling` 并发 `cancel`。
2. Node 调 `harness.close()` 发 shutdown；宽限期后进程树仍在，则 Job Object/进程树终止。
3. 再次检查残留；归零 → `cancelled`；无法确认 → `unknown`。
4. 下一轮用 `resume_session` 修复被中断的 turn。

实测：取消前 6 个进程，取消后 0 残留（`evidence/cancel_probe.json`）。

### 5.4 竞态表

| 竞态 | 规则 |
|---|---|
| cancel × complete | 先落库的终态获胜；晚到终态事件照样入库；Run 保持 `cancelled`，`outcome` 记录实际终态与可能的部分副作用 |
| 离线 × 重投 | 节点先写 outbox；Controller 按 `(run_id, seq)` 去重；ack 只前进到连续位置 |
| 重连 × unknown | 节点上报 ledger；`unknown → running/completed/failed` 允许校正；不自动重跑 |
| 重复提交 | `request_id` + 指纹；同内容复用，异内容 409 |
| 节点崩溃 | 本机 ledger 里 active Run 重启时标 `unknown`；等 `reconcile` |
| 同一 Session 并发 | 会话级单写者；第二个 Run 409 |

---

## 6. 交互：DeepSeek 是 Agent，Tether 是工具

用户在 DeepSeek Harness 桌面 APP 里说：

> 让 LAPTOP-01 的 Agent 在 D:/tether-node/work 建 tether-delegated.txt，内容 OK，然后读回来。

DeepSeek Agent 自己决定调用：

1. `mcp__tether__list_peers` → 看到 `LAPTOP-01` 在线、workspace 是 `D:\tether-node\work`；
2. `mcp__tether__remote_task(device="LAPTOP-01", prompt="...")` → Tether 创建 Run，路由到笔记本 Node；
3. 笔记本上的 dsh Agent 用 `pwsh` 写文件、读回；
4. Tether 把终态/结果返回给 DeepSeek Agent；
5. DeepSeek Agent 在自己的对话里总结，并可以继续追问。

实际运行结果（截图 `docs/screenshots/deepseek-delegated.png`）：

- 文件：`D:\tether-node\work\tether-delegated.txt`，内容 `OK`，2 字节，无 BOM；
- 第一次写 run `r-56ca1f58b1a3`，第二次只读校验 run `r-8fa5928462a6`；
- 两次都在 `dsh_session=tether-s-d0332f33ad47` 里，说明目标端是持久会话。

为什么这是对的：

- 用户不需要换聊天框；DeepSeek 的记忆、技能、插件市场全部保留；
- Tether 的 MCP 指令只描述"如何发现设备、如何派活"，不抢 Agent 的决策；
- 如果以后用 Qoder/Codex，同一套 MCP server 直接挂过去，不需要重写。

Tether 监控台网页仍然存在，但定位是**监控台**：看设备、任务、事件、证据；不是主入口。主入口是 DSH 侧栏里的 **Tether 插件页**：原生工作区 + 文件资源管理器 + 权限（下一节）。

### 6.1 MCP 配置

`~/.dsh/profiles/desktop/cordis.patch.yml` 里一条 `insert`：

```yaml
- insert:
    - id: mcp-tether
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tether
        transport: stdio
        command: '<repo>\.venv\Scripts\python.exe'
        args: ['-m', 'tether.mcp_server']
        env:
          PYTHONPATH: '<repo>'
          TETHER_CONTROLLER_HTTP: 'http://127.0.0.1:18890'
        cwd: '<repo>'
```

`desktop/install-mcp.ps1` 会备份并追加这条配置；重启 DeepSeek Harness 后生效。

### 6.2 DSH 插件页

DSH 是 Cordis 插件架构。Tether 分两层接入：

1. **完整原生页面（主路径）**：目标机 DSH Desktop 自己的 Host 页面，通过每设备
   回环 gateway 嵌入 Tether 插件页。模型、权限、`@` 文件引用、附件、轨迹和会话
   写者都来自目标 Host；已有会话可以原地继续。链路、凭据边界和验收标准见
   `docs/native-surface.md`。
2. **Tether 展示层（文件页/权限）**：官方 client plugin，负责文件资源管理器、
   右键菜单、文件预览和文件策略/审计。它复用 DSH 的 slot/布局/token 和部分
   MIT 展示组件，但不是对话入口。

#### 6.2.1 完整原生页面

目标 DSH 启动时由 `tether-dsh-surface` 发布
`$DSH_HOME/storages/tether/native-surface.json`，只含当前 loopback origin 和
认证 URL；目标 Node 校验 origin 后在内存中持有凭据。Controller 为每台设备开
一个 `127.0.0.1` 随机端口 gateway：单次 ticket + HttpOnly / SameSite=None /
Partitioned cookie；HTTP 只允许固定 Host 路径，WebSocket 只允许
`/api/remote.mux`；Origin 只允许 gateway 自身或 `dsh-app://app`；请求、响应和
单帧上限 8 MiB。浏览器不能传任意上游 URL，凭据不进 Controller DB、日志或前端。

这个 iframe 承载的是**目标机真实 Host 页面**，不是 Tether 自绘聊天；因此它与
"用 iframe 冒充原生页面"不同。它解决了已有会话写回：输入框直接由目标 Host 的
writer 处理，不需要 Tether 再起一个 SDK 会话。目标机必须运行 DSH Desktop；
只跑 Node 不够。Node 转发 HTML 时注入 `#tether-native-surface`，把
`[class*="sidebarCol"]` 的 0.5px 右边框置 0：桌面版由
`[data-windows-titlebar]` 隐藏这条线，浏览器版没有该属性，需要补同样的视觉
效果。注入只发生在 Tether gateway 的响应里，不改目标 DSH 安装。

#### 6.2.2 Tether 展示层

官方 client plugin 的包结构：

- `packages/dsh-plugin-tether`：bundle 包，`dsh.bundle.patch` 插入 host 插件；
- `packages/dsh-plugin-tether-client`：`dsh.client` 客户端插件，bundle 为
  `window.__ModuleLoader__.load({id, factory})`，依赖只来自 `PLATFORM_MODULES`；
- 注册 `ctx.slots.inject('main', …)` 和 `ctx.slots.inject('sidebar.panellist', …)`，
  侧栏出现 `Tether`，点击 `ctx.layout.selectPanel('tether')` 的等价行为由 slot 完成。

展示层只剩**文件资源管理器**和**文件权限**，不再有 Tether 自写的对话页/工作区树。
它复用 DSH 的 MIT 展示组件：`scripts/build-native-ui-bridge.mjs` 从 `0.2.1-rc.2`
bundle 提取 `FileEntryRow`、`MarkdownText`、文件类型图标和中文词典；不执行上游
`apply`，不注册上游 module ID。工作区、文件等 Tether 自己的布局复用 DSH 的
slot、字体、灰阶和 8px 圆角。

活动栏常驻四项：显示器 = 原生工作区，文件夹 = 文件资源管理器，地球 = 互联，
盾牌 = 文件权限。
设备切换放在顶栏的自绘菜单（DSH 字体/圆角/色阶，在线点、设备名 + 系统版本、
互联入口；点外部或 Escape 关闭）；不再有第二条设备栏。文件页：

- 左侧树：`工作区`（注册的 DSH 工作区）、`此电脑`（C–G）、`未分组`
  （散落会话 cwd）。文件夹整行就是展开/收起的点击目标：点一次打开并切换右侧
  目录，再点一次收起；没有独立的小 chevron。文件/文件夹图标用 DSH
  `FileTypeIcon`，Word/PDF/PPT/图片/Markdown 在左右两侧都能区分。
- 右侧：当前目录的 details list（名称/修改日期/类型/大小）、面包屑、后退/上级、
  刷新图标（加载时旋转）。双击文件夹进入，双击文件预览。
- 右键：背景和行都有 APP 式上下文菜单（打开/重命名/删除/新建文件/新建文件夹/
  刷新）；新建和重命名走小弹窗；删除二次确认并进 `.tether-trash`。
- 预览：Markdown 走 `MarkdownText` 渲染（可切编辑），文本可编辑保存，图片和 PDF
  直接显示；DOC/DOCX/PPT/PPTX 由目标机 `fs/preview` 调用 WPS/Office COM 转 PDF
  后显示，并写一条 `preview` 审计。目标机没有 WPS/Office 时明确报错，不显示空白。
- 字体：`工作区`/`此电脑`/`未分组`/`文件` 这类同级 section header 统一使用 DSH
  侧栏的 13px / 400 / `--dsw-alias-label-tertiary` / 36px 高，不加粗、不加字距。
- **互联**：左侧列出节点卡片（在线/离线、系统版本、原生页/旧节点能力），
  8 台/页、可翻页；右侧画布铺满剩余空间，以本机为中心画节点连线。线统一用
  中性灰、不上状态色：有控制边且两端连通为实线，有控制边但任一端离线为虚线，
  没有控制边不画线。设备栏与画布之间的边界可拖、双击复位。滚轮缩放 40%–120%，
  低于 72% 时标签隐藏、节点变成 22/16px 的纯色正圆（外框、填充、连线同中心）：
  `corner-shape: round` 抵消 DSH 全局的 superellipse。本机节点填 `C.ink` 黑色，
  和放大态的黑胶囊一致；子节点填业务蓝与侧栏底色的不透明 `color-mix`（8%，
  选中 13%），和放大态的子节点底色一致，所以跨 72% 阈值时颜色不突变。无白边、
  描边、外发光、玻璃或高光。普通缩放时非本机节点是同色胶囊 + 轻阴影，框可见；
  选中不再画蓝色 outline。
  连线端点按节点边缘裁剪：圆边进入约 1px 由节点覆盖，胶囊取 14/3px；节点
  z-index 高于连线。布局弹簧静止长度 35，低缩放位置按 `0.72+0.28*zoom` 展开，
  保持线长与圆的比例。节点被拖走后不会锚定回原位：力导向的弱中心力、节点斥力、
  阻尼（0.95）
  和有限伸缩的连线共同作用，带黏滞惯性缓慢游回平衡点（参考 Obsidian/d3-force
  的手感，不引入完整图库）。点击卡片选中设备，双击打开原生页。后续网络视图就
  挂在这一页。

权限只在盾牌入口，点旁边空白或 Escape 关闭：三档模式、可写根目录（逐行
添加/编辑/删除）、分页审计。审计使用 SQLite（WAL，100000 行上限，内存不随
历史增长），覆盖 Tether 文件服务的写入、删除、权限、Office 转 PDF 和被拒绝的
读取；写入有 `intent` 与 `result` 两行；DSH Agent 自己执行的命令不在其中。

视觉层遵循六条规则：层级由背景层（base / sidebar / hover / active）建立，不用
1px 灰框；所有颜色取 DSH 主题 token，暗色下标题/按钮字重 600→500、正文 400→350；
新出现的内容用 `opacity + blur + translateY` 做水墨式入画；时间、步数、token 用
tabular-nums；拖动中不加 transition，松手/双击复位用 160–180ms 回弹，按钮/行
按压 `scale(.97)`。

| 区域 | 数据来源 | 行为 |
|---|---|---|
| 原生页面 | 目标 DSH Host（经每设备 gateway） | 工作区/会话/模型/权限/`@` 文件/附件/轨迹/写者均为目标原生；已有会话原地继续 |
| 文件资源管理器 | `GET /api/devices/{id}/workspaces` + `/drives` + `POST /fs/{op}` | 左树 + 右 details list；面包屑/后退/刷新；双击进入/预览 |
| 右键菜单 | 同 `/fs/{op}` | 打开、重命名、删除、新建文件/文件夹、刷新 |
| 预览 | `POST /fs/preview` | MD 渲染、文本编辑、图片/PDF 直显；Office 经 WPS COM 转 PDF |
| 互联 | `GET /api/state` | 全量节点卡片 + 本机居中拓扑；双击卡片打开原生页 |
| 权限 | `GET/POST /api/devices/{id}/policy` + `/audit` | readonly / locked / full；可写根目录行；SQLite 审计 100000 行上限、分页 |

DSH 原生会话的读取实现仍保留：`tether/node/dsh_sessions.py` 读取
`~/.dsh/sessions` 的 zstd 日志，用于历史/证据和旧节点兼容，不再是插件页面。
Tether SDK 任务仍写成新的原生 Session 并注册到 workspace；已有会话由原生页面
的目标 Host writer 原地继续，Tether 不写已有 Session 日志。

设置抽屉做三档权限（见 §7.4），并显示审计。插件本身只改
`~/.dsh/profiles/desktop/package.json` 的 bundle/dependency；卸载不影响 DSH 启动。

已知限制：Tether 展示层直接访问 `127.0.0.1:18890`（controller 的 CORS 只允许
`dsh-app://app`）；原生页面经每设备 gateway（ticket/cookie/origin 校验）。
计划中的 `@Remote` host service 尚未实现；controller 仍然 loopback-only，
node token 不进入 client。

---

## 7. 异构、网络与安全

### 7.1 异构

- Node 上报能力清单：OS、shell、Python/Node、workspace、可用 agents（dsh/fake）。
- Windows 用 Job Object/进程树；Linux 用进程组（设计，未在本次验证）。
- 工作区路径由节点配置；Controller 只传字符串，不做路径拼接。

### 7.2 网络

- 节点主动外连 WSS；目标机器不开入站端口。
- Tailscale 提供 `100.x` 稳定地址和加密；LAN 为备选；未来公网 relay 只需换 `TETHER_CONTROLLER` URL。
- 断线由节点 outbox + 重放处理；在线状态由心跳和 last_seen 表示。

### 7.3 安全边界（诚实版）

| 项 | 现状 | 生产化缺口 |
|---|---|---|
| 传输 | Tailscale/WireGuard；WSS token | WSS/mTLS、证书轮换 |
| 节点身份 | 共享 demo token | 每设备密钥、配对码、吊销 |
| 人类 UI/API | loopback-only 中间件；只有 `/ws/node` 对 tailnet 开放 | UI 登录、会话 cookie、CSRF |
| 模型 key | 只在目标机器 `.env`/环境变量；桌面 APP 自己的账号 | KMS/凭据代理 |
| 文件边界 | Node 端 `resolve()` 后按 policy 校验；写前审计 | 正式 ACL、配额、只读挂载 |
| 日志 | 事件含命令输出；审计 `audit.jsonl` | 脱敏、保留期、集中审计 |

**注意**：Controller 的 HTTP API 只允许 loopback，所以 v0.1 只有桌面侧 Agent 能通过 MCP 发起；笔记本侧的 Agent 若要发起，需要 v0.2 的每设备控制面或带鉴权的 tailnet API。

### 7.4 文件权限模型（已实现）

策略存在 **Node 本地** (`<data_dir>/policy.json`)，Controller 只转发读写请求，
不能替 Node 放宽策略。默认：

```json
{
  "mode": "readonly",
  "allowed_roots": ["D:\\TetherWorkspaces", "<node workspace>"]
}
```

- **readonly（默认）**：全盘可读；写/建/改名/删除仅允许 `allowed_roots` + 已存在的 DSH
  workspace（从 `~/.dsh/storages/workspace.json` 读取）。已有项目不被专属根限制。
- **locked（全部只读）**：连 `allowed_roots` 内的写入也拒绝，适合临时交出只读现场。
- **full**：设置页显式二次确认后启用；全盘可写，但 Windows/Program Files/
  ProgramData、`.ssh`、`.dsh`、`.aws`、`.config`、`AppData` 永远拒写；
  `.dsh/.credentials.yaml` 永远拒读。
- 所有写操作先写 `phase=intent` 审计，再执行并写 `phase=result`；被拒的请求也留痕。
- 删除移动到 `D:\TetherWorkspaces\.tether-trash\`，可恢复，不做硬删除。
- 新建项目默认落在 `D:\TetherWorkspaces\<name>`；可用 `TETHER_WORKSPACES_ROOT` 覆盖。
- Node 是权限执行点，离线时设置页和文件操作返回 409，不会在 Controller 侧假成功。

---

## 8. 验证

### 8.1 实验与数字

| 实验 | 做法 | 观测 |
|---|---|---|
| E0 SDK 探针 | 官方 SDK + npm dsh；dummy key | initialize/建会话/prompt/事件/idle 全通；dummy key 打到真实 401；发现 wheel koffi bug 并绕过 |
| E1 本机闭环 | Controller + Node + fake adapter | 事件实时、终态入库、重连无重复 |
| E2 真实 dsh | 让 Agent 写 `gate2.txt` | 文件 `OK\n`；`pwsh` + `read` 工具事件；13 个 Tether 事件、29 个 dsh 事件 |
| E2b 继续任务 | 同一 Session 第二轮，要求不重读文件 | `dsh_session` 相同；直接引用上一轮内容回答 |
| E3 断线重放 | 模拟 8 秒 socket 断开 | 13 个事件、`ack_seq=13`、序号连续、重复 0 |
| E4 幂等 | 同 `request_id` 发送 3 次；异内容 | 只 1 个真实 Run；异内容 409 |
| E5 取消 | 真实慢命令 `python sleep 120` | 取消前 6 进程，取消后 0 残留；`cancelled` 5.4s |
| E6 跨机 | 笔记本 Node 通过 Tailscale 接入 | `LAPTOP-01` 创建 `D:\tether-node\work\laptop-proof.txt`，返回路径和 `OK` |
| E7 Agent-first | 在 DeepSeek 桌面 APP 里让 Agent 用 Tether | 它自己调用 `list_peers`，再 `remote_task` 让 LAPTOP-01 创建 `tether-delegated.txt`；两次校验同一 dsh 会话 |
| E8 监控台 | Tether 自带 UI | 设备/任务/事件可看；仅作监控 |
| E9 DSH 插件 | 干净安装 `tether-dsh-plugin` | 侧栏 `Tether`；工作区/文件/设备/权限/过程页渲染；其它 bundle 未变 |
| E10 文件权限 | readonly → full → readonly | 盘外写 400；DSH 工作区可写；full 可写；系统目录/凭据始终拒绝；删除进 `.tether-trash` |
| E11 插件任务 | fake agent `slow plugin ui test` | 首事件 1261 ms；取消后 `cancelled`；事件 seq 连续 |
| E12 原生对话镜像 | 读取目标机 `~/.dsh/sessions` 的 `session.v4.jsonl.zstd` | 还原 2 轮、8 个 reasoning/tool 块；页面显示与 DSH 截图同一标题/推理/工具/回答 |
| E13 Tether 任务写入目标 DSH | 在 `D:\TetherWorkspaces\demo` 发 `Reply with exactly OK.` | run `r-00aac51ff0ac` → native `tether-s-91e5ba584d36`，文件在目标 `~/.dsh/sessions`，并写入 workspace `sessionIds` |

证据：`evidence/gate0.md`、`evidence/gate2.md`、`evidence/dsh_plugin_fs.md`、
`evidence/cancel_probe.json`、`docs/screenshots/dsh-plugin-*.png`、`deepseek-*.png`。

### 8.2 Verified / Designed / Not implemented

| 状态 | 内容 |
|---|---|
| **Verified** | DSH 插件安装/渲染、统一工作区/文件树/设备/过程页、三档文件权限与审计、可恢复删除、目标 DSH 原生页面（DESKTOP-LOCAL 同 Host：模型/权限/`@` 引用/轨迹/Node 重启恢复）、DeepSeek 桌面 Agent 通过 MCP 调用 Tether、Agent-to-Agent 派活、真实 dsh 执行、Session 继续、断线重放、幂等、`unknown`、硬取消 0 残留、Tailscale 跨机、监控台 |
| **Designed** | 每台设备都跑桌面 Agent + Tether 插件/MCP 的对等网络、`@Remote` host service、配对/能力路由、审批 UI、Linux/WSL、公网 relay、多任务并发 |
| **Not implemented** | 上述 Designed 项；生产级鉴权/审计/沙箱；笔记本侧 Agent 发起任务；`LAPTOP-01` 节点升级与跨机原生页面；已有会话的真实模型发送；附件上传 |

### 8.3 复现

```powershell
# 控制面 + 本地 Node（监控台可选）
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
npm install --prefix .runtime\npm @deepseek-ai/dsh@0.2.1-rc.2
Copy-Item .env.example .env   # DEEPSEEK_API_KEY
.\desktop\tether-app.ps1

# 给 DeepSeek Harness 桌面 APP 装 Tether 插件（先关闭 APP）
.\desktop\install-plugin.ps1
# 重启 DeepSeek Harness，点侧栏 Tether

# 可选：给 DeepSeek Agent 挂 MCP
.\desktop\install-mcp.ps1
# 重启 DeepSeek Harness，然后：
#   用 Tether 列出当前已接入的设备
#   让 LAPTOP-01 的 Agent 在 D:/tether-node/work 建文件并读回

# 笔记本节点
.\laptop\bootstrap-node.ps1
# 填 .env，TETHER_CONTROLLER 指向桌面 Tailscale IP
.\laptop\tether-node.ps1
```

---

## 9. 从 v0.1 到 v0.2：每台设备都是 Agent

目标：每台设备同一份包；任意两台互相派活；没有唯一 master。

需要改的四件事：

1. **每台设备都跑 DeepSeek Harness 桌面 APP + Tether MCP**：交互端始终是 Agent；Tether 只是工具。笔记本也要装桌面 APP，而不是只跑 Node。
2. **控制面归属**：当前 Controller 的 HTTP API 只允许 loopback，所以笔记本侧 MCP 不能直接调桌面 Controller。v0.2 要么每台设备内嵌本地 Controller，要么给 Controller 的 tailnet API 加设备级鉴权；前者更符合"对等"。
3. **多 peer 连接**：Node 从"连一个 Controller"改成"连本机 Controller + 每个已配对 peer"；按 `run_id` 去重，避免双向重复；peer 发现/配对/能力清单。
4. **本地 Agent 工具化**：本地 DeepSeek Agent 的 MCP 工具负责 `list_peers` / `remote_task`；用户对本地 Agent 说"让 B 做这个"，Agent 自己派活；结果回到本地对话。

保留不变：`seq/ack/journal`、幂等、`unknown`、硬取消、resume、事件映射、Job Object/进程树、本地控制台。

代价：设备数 N 时连接数 O(N²)；需要配对/发现/吊销；没有中心调度器，能力路由只能在客户端做。

---

## 10. 已知限制

- 当前是星型：只有桌面侧 Agent 发起，笔记本是被控端；对等网络是 v0.2。
- Tether 展示层直接访问 loopback Controller（CORS 只允许 `dsh-app://app`）；
  原生页面走每设备 gateway。计划中的 `@Remote` host service 未实现。展示层复用
  DSH 的 slot/布局/token，并通过生成桥包复用部分 MIT 展示组件。
- 审批 UI 未实现：SDK 0.2.1rc2 没有 `approval_requests` 握手。
- 只验证了 Windows；Linux/WSL 仅有设计。
- 每 Session 同时一个 Run；没有多任务并发/调度。
- 默认节点 token 是 demo 级；生产需要每设备凭据/吊销。
- `LAPTOP-01` 仍跑旧 Node 构建（无 `fs`/`surface_protocol`）；文件、原生页面需先
  更新 `C:\tether-node\app`、重装目标 DSH 插件并重启 DSH 与 Node。任务委派不受
  影响，但页面会显示"节点待更新"。
- 原生页面要求目标机 **DSH Desktop 正在运行**；只跑 Node 时显示"目标 DSH 未
  运行"。已有会话由目标 Host writer 原地继续；Tether 日志镜像仍只读。
- Tether 新任务写成新的原生 Session 并注册到 workspace；跨机原生页面和真实模型
  发送尚未验收。
- dsh SDK 仍是 RC；事件词汇可能随版本变化，`dsh_adapter.py` 用通用 fallback 保留未知事件。
- Tether 监控台网页不是插件对话页；插件主入口是目标 DSH 原生页面 + 文件资源管理器 + 权限。

### 10.1 如果还有时间

1. 每台设备装 DeepSeek 桌面 APP + Tether MCP，做两台设备的双向派活。
2. 审批通道：升级 SDK/走 ACP，补 allow/deny/timeout。
3. 能力路由：按 OS/工具/资源选择目标设备。
4. 公网 relay / 更长断线恢复；批量任务与 DAG。
5. WSS/mTLS、设备吊销、审计日志、workspace 路径 resolve 白名单。

---

## 11. 附录

### 11.1 代码位置

- `tether/mcp_server.py`：MCP tools；Agent 的唯一入口。
- `tether/controller/app.py`：HTTP/SSE/WS、loopback 中间件、transcript 端点。
- `tether/controller/store.py`：Device/Session/Run/Event、幂等、连续 ack、`unknown`。
- `tether/node/agent.py`：出站 WSS、outbox、重连、心跳、`fs_call`、本地控制台。
- `tether/node/fs_service.py`：策略、路径 resolve、读写/目录/删除、`.tether-trash`、审计。
- `tether/node/dsh_adapter.py`：SDK 调用、npm 运行时绕过、事件映射、硬取消。
- `tether/static/index.html`：监控台 UI。
- `packages/dsh-plugin-tether/`：DSH bundle + cordis patch。
- `packages/dsh-plugin-tether-client/`：DSH 原生 client 页面（工作区/文件/设备/权限）。
- `desktop/install-plugin.ps1`：安装/备份 DSH 插件。
- `desktop/install-mcp.ps1`：把 Tether MCP 写进 DeepSeek Harness 桌面 profile。
- `laptop/`：笔记本 Node bootstrap/启动/卸载。

### 11.2 参考

- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- DeepSeek Harness 官网/桌面端下载: https://www.deepseek.com/harness/
- dsh Python SDK: https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.zh.md
- dsh MCP client: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.zh.md
- ACP: https://agentclientprotocol.com
- npm dsh: https://www.npmjs.com/package/@deepseek-ai/dsh
- Tailscale: https://tailscale.com/download/windows
- Raven: https://github.com/EverMind-AI/Raven
- nanoMuse: https://github.com/nano-muse/nanoMuse
- Herdr: https://github.com/herdrdev/herdr
- Orca: https://github.com/stablyai/orca
- Happy: https://github.com/slopus/happy
---

## 12. 团队拓扑、传输与三端复用（方向）

**拓扑模型**：当前是中心中继星型——每台 Node 只向 Controller 建一条出站 WSS，
设备之间没有 TCP 直连；Controller 可以控制 N 台设备，子设备之间默认不互通。
下一版把"线"变成 Controller 里的逻辑边 `Edge(parent, child, allow/deny)`，由
Team/Account 服务保存设备、成员、角色和边；同一账号/团队的所有客户端订阅同一份
拓扑，因此每台机器看到的图一致。派活时 Controller 只沿允许的边路由，未连边的
设备不会互相看到；这样天然支持"一个上位机控制十几个下位机、下位机之间隔离"，
也支持后续把任意节点接成万物互联。默认仍走中心中继（每个节点 1 条连接，避免
N² 条 TCP）；需要低延迟时再给边加可选的 P2P 直连，中继作为回退。

**是否必须 Tailscale**：不是。Node 的目标地址来自 `TETHER_CONTROLLER`，现在
用 Tailscale 只是因为它提供了最省事的 L3 网络路径；WSS/HTTP 协议本身与
Tailscale 无关，同一局域网可直连，公网可端口转发。要把它变成 Tether 自己的
能力，需要补一个 **Tether relay/account 服务**：监听 TLS/WSS，设备只做出站连接，
配对码/设备密钥、团队同步和吊销都在这里；公网 NAT 穿透可先用 relay（类似
Tailscale DERP），真正 P2P 再叠加 STUN/TURN/WebRTC。这样 Tailscale 变成可选
的部署方式，而不是产品依赖。边界要讲清：**纯插件本身不可能在双方都在 NAT 后
时无中生有地建立公网连接**；必须有一个公网可达的 Controller/relay（或用户
自己做端口映射/局域网直连）。纯 App 如果有自己的后端服务，可以把 relay 收进
产品里，但仍然是"要有一台公网机器"，不是零基础设施。

**三端复用**：文件资源管理器、互联画布、权限抽屉都是普通 React 组件，放成
共享 UI 包；DSH 插件只保留 slot/`window.__ModuleLoader__` 适配，独立 Tether
App（Electron/Tauri + 内嵌 Controller/Web 服务）和 Web 共用同一套组件。下载方式
就是两种：App（含桌面端和 Web 服务）或 DSH 插件；插件以后可上 DSH 插件市场。
APP 作为主体、插件作为 DSH 适配、WebUI 作为 APP 自带服务的具体拆分、运行形态、
服务监督、Relay 集成和分阶段验收见 `docs/APP_PLAN.md`。

### 12.1 连接关系、线语义与百台设备操作（设计，未实现）

**边的语义**：`Edge{id, from, to, mode, status, created_by, updated_at}`，
`from` 控制 `to`；没有边就不画线。画布线样式由边和两端状态派生：

| 条件 | 画法 |
|---|---|
| 有边、两端在线 | 实线 |
| 有边、任一端离线 | 虚线 |
| 没有边 | 不画线 |

线一律用中性灰，颜色不承载状态；**连通只用实线表达，不再加绿色中心点**，避免
和卡片在线点、节点填充重复表达。当前 v0.1 是隐式星型（本机 → 所有已配对节点），所以现有画布对每台节点都有
线；显式边和"无边"是 v0.2。线的两端按节点实际边缘裁剪（圆点进入圆边约 1px，
胶囊取端点 14/3px），不依赖节点背景盖住线。卡片标签表达连接方式与健康状态：
`插件互联`（surface_protocol）、`App 互联`（app_protocol，未实现前不显示）、
`插件版本过旧`/`文件服务缺失`/`节点受损`/`连接异常`；一个根因只显示主错误，
避免标签堆叠。

**入口统一**：右键设备卡片或画布节点，菜单里放“纳管到本机 / 断开控制”
（隐藏动作），这是所有规模都成立的主入口。画布拖线只是它的可视化快捷方式，
命令面板和多选批量是它的键盘/批量快捷方式；三个入口写同一套 `edges`，不能
各自有一套状态。

**小图（≤20 节点）**：画布右上角"连接"进入连线模式，节点 hover 出现端口；
从父节点端口拖到子节点完成连接，Esc 取消。触控/触控板用两步点击（先父后子）
作为等价操作。普通拖拽只移动节点，避免误连。边可选中，`Delete` 或右键断开；
连接成功后给一条可撤销提示。

**100+ 设备**：画布拖拽不是主路径：

0. **入网即连**：新设备通过配对码/团队邀请加入时，直接选择父节点或控制组，
   边随入网创建；不要要求用户先在图里找到新节点。
1. **命令面板**（`Ctrl/Cmd+K`）：按设备名、ID、OS、工作区搜索，直接选
   "A → B" 建边；不依赖在画布上找节点。
2. **左栏多选 + 纳管**：Shift/Ctrl 选 N 台，默认父节点是本机，一次"纳管到本机"
   建 N 条边；要指定别的父节点时用命令面板。支持撤销，这是百台设备最常用的路径。
3. **控制组**：把设备加入"控制组"，边由成员关系派生，新设备继承组规则；100+
   设备时管理组，而不是逐条管理边。
4. **连接表格**：源/目标/在线状态/创建者/最后检查，可筛选、批量删除；比在
   画布上一根根找线可靠。
5. **画布聚合**：按团队/工作区/网段折叠成组节点，低缩放显示组，点开展开；
   搜索时非匹配节点淡出。100+ 节点不直接把所有标签和线铺满画布。

**数据与权限**：v0.1 单用户时边存 Controller SQLite，`/api/edges` 提供
GET/POST/DELETE 和批量接口；v0.2 移到 Team/Account 服务，同一团队订阅同一份
图。只有 owner/admin 能建边，所有变更写审计；客户端乐观更新，带版本号冲突回滚；
浏览器只传设备 ID，不允许传任意 URL。**验收门禁**：两端在线实线、任一端离线
虚线、无边不画线；100 台虚拟设备下命令面板搜索和批量连接不卡；断线重连后边与
状态恢复；非管理员不能建边。**分片**：A 线端点/标签（本轮已完成）→ B 本地边表、
命令面板、批量连接（单 Controller）→ C Team 同步、权限、控制组 → D 聚合视图与
100+ 性能。

### 12.2 设备身份与显示名（已实现单用户改名）

- `device_id` 永远不变；`host_name` 是节点上报的机器名；`display_name` 是
  Tether 的别名。显示名存 Controller SQLite，节点重连只更新 `host_name`，
  不会覆盖别名；离线设备也可以改名，重新上线后继续显示别名。
- 改名入口隐藏在网络卡片/画布节点的右键菜单里；`POST /api/devices/{id}/name`
  校验 1–64 个可打印字符。当前插件每 2.5s 拉 `/api/state`，所以同一 Controller
  下的所有 Tether 客户端会同步看到新名字。目标机当前只跑 Node + DSH surface，
  不跑 Tether 控制台；团队版要让每台设备登录同一个 Team/Account 服务，才能让
  目标机自己的插件也显示别名。目标 DSH 原生页面里的机器名仍是目标 hostname，
  别名不写回 OS。
- 权限：当前 v0.1 是单用户 loopback 信任模型，能访问 Controller 的客户端可以给
  任意已配对节点改名，没有角色校验；v0.2 建议默认允许改自己、owner/admin 可改
  团队内其他节点，并记录 actor/时间。多端并发改名用 `updated_at` 或版本号做
  乐观冲突回滚，不能只靠最后写入悄悄覆盖。
- 已知风险：两个客户端同时改名时当前是 last-write-wins，会静默丢一次更新；
  客户端靠 2.5s 轮询，最多有约 2.5s 的旧值；没有唯一性约束，两台设备可以同名；
  没有审计和撤销；若将来出现多个 Controller/团队服务各自存一份别名，名字会
  分叉。团队版需要版本号 + SSE/WebSocket 推送 + 角色权限 + 审计 + 统一
  Team/Account 单一真源；设备身份应绑定密钥而不是可复用的 `device_id` 字符串。

### 12.3 自建互联服务：Tether Relay/Account（替代 Tailscale，设计）

**先划清边界**：纯插件不能独自承担 Tailscale 的角色。Tailscale 实际提供了
四件事：身份/协调、加密传输、NAT 穿透、relay 回退。Tether 的流量是 HTTP/WS，
不需要虚拟网卡或 TUN；应用层中继就够。但**必须有一个对设备可达的后端**：
公网 VPS、端口映射/公网 IP，或同局域网直连。没有任何公网可达点，又在双方
NAT 后，任何纯插件都无法凭空建立连接。

**推荐拓扑**（不复制 Tailscale 的 L3，只复制它需要的能力）：

```
桌面 Controller（UI/API 仍 loopback）
        │ 主动出站 TLS/WSS
        ▼
Tether Relay/Account（公网 VPS，TLS）
        ▲
        │ 主动出站 TLS/WSS
目标 Node（文件/shell/DSH Host 不变）
```

- 两端都只找出站连接；Node/目标机不开入站端口。Relay 按 `device_id` 和
  channel 转发帧；Controller 仍然只在本机暴露 UI/API。
- 同一局域网可直接连 Controller，不经过 Relay；没有公网需求时 Relay 可选。
- Relay 只是 NAT 回退，不是必须的数据面：未来可加 STUN/QUIC/WebRTC 做 P2P，
  Relay 保留作对称 NAT/降级路径。Tailscale 的 DERP 就是同类模型。
- 不建议自己写 WireGuard/TUN：Windows 驱动、路由、内核和权限成本远超收益；
  Tether 不需要三层虚拟网络。

**最小服务接口**：

1. 设备入网：`POST /v1/devices/enroll`，一次性配对码 + 设备公钥；返回
   `device_id`、短期证书/令牌和 Relay URL。每设备独立密钥，支持吊销和轮换。
2. 长连接：`/v1/node`（Node 出站）和 `/v1/controller`（桌面 Controller 出站）。
   Relay 维护 `device_id -> node socket` 映射。
3. 帧：`{channel, kind, payload}`；沿用现有 Node/Controller 消息，不把业务
   协议重写一遍。限制帧大小、队列长度和每设备并发。
4. TLS 终止用 Caddy/nginx 或服务内建证书；Relay 只做转发。需要更强隔离时把
   payload 做设备端到端加密，Relay 只看到密文和路由头。
5. Account 服务保存用户、团队、设备、边、角色、吊销和审计；Controller 的
   SQLite 在单用户模式保留，团队模式改为向 Account 同步。

**落地顺序**：

1. **本地三进程验证**：Relay + Controller + 两个模拟 Node 全在 loopback，跑
   现有 `/api/state`、文件、run、断线重连测试；证明“经 Relay”与直连语义一致。
2. **公网单机验证**：一台 VPS 部署 Relay，关掉 Tailscale；桌面 Controller 和
   笔记本 Node 都出站接入；验证 NAT、重启、断线、吊销。
3. **局域网/直连优先**：同网段直接连 Controller；跨网才走 Relay；保持 Relay
   回退，避免所有流量绕公网。
4. **P2P 可选**：STUN/QUIC/WebRTC 打洞，失败回落 Relay；不把 P2P 作为第一阶段
   前置条件。
5. **团队化**：Account 登录、配对码、设备吊销、边 ACL、审计、Relay 配额和健康
   监控。

**验收门禁**：卸载/关闭 Tailscale 后，设备仍能上线；Node 不开放入站端口；
Relay 断开时显示离线并可重连；局域网直连优先且不绕公网；设备吊销立即生效；
帧大小/队列有上限；100 台设备一个 Relay 不出现串设备或重放。**当前状态**：
以上只是设计，尚未实现；现有 `TETHER_CONTROLLER` 仍需要一个可达地址，Tailscale
只是当前部署路径之一。
