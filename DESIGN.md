# Tether：让 Agent 拥有跨设备的手

> 题二设计文档 · 2026-10-27
> 代码与证据：https://github.com/qi001007/tether-harness
> 交互端是 DeepSeek Harness 桌面 APP；Tether 只是它调用的 MCP 工具。

---

## 0. TL;DR

### 0.1 我做了什么

- 用户在 **DeepSeek Harness 官方桌面 APP** 里正常对话，记忆、技能、插件市场都还是 DeepSeek 的；
- DSH 侧栏装了 **Tether 原生 client 插件**：设备、目标机项目、**目标机 DSH 原生对话**、文件读写、任务事件、权限/审计都在 DSH 里完成，没有 iframe、没有第二个聊天 App；
- DeepSeek 的 Agent 通过 **Tether MCP** 调用 `list_peers` / `remote_task` / `remote_status` / `remote_cancel` / `remote_files` / `remote_workspaces` / `remote_audit`；
- 任务被送到另一台电脑的 Tether Node，由那台机器上的 Harness Agent 用它自己的文件、shell、模型 key 执行；
- 工具事件、结果和继续会话都在 DeepSeek 的对话里；
- Tether 自己的聊天页降级为**监控台**：看设备、任务、事件和证据，不是主入口。

这就是"交互端始终是一个独立的 Agent"：DeepSeek Harness 是 Agent，Tether 是它的跨设备工具层与远程工作区页面。

### 0.2 已用真实数据验证

| 主张 | 实测 |
|---|---|
| DSH 插件可安装、可渲染 | 干净卸载后由 `desktop/install-plugin.ps1` 重装；侧栏出现 `Tether`，设备/项目/文件/任务页渲染 |
| 已有 DSH 工作区能打开 | `default-workspace` 解析到 `D:\DeepSeek harness\workspace`；readonly 下可写并留审计 |
| 目标机原生对话能看 | 解析 `~/.dsh/sessions` 的 zstd 日志：2 轮、8 个 reasoning/tool/text 块；页面与 DSH 截图同一标题/工具/回答 |
| 权限真的分级 | readonly 写盘外路径 → 400；full 模式同路径可写；`C:\Windows` 与 `.dsh/.credentials.yaml` 始终拒绝 |
| 删除可恢复 | 文件移动到 `D:\TetherWorkspaces\.tether-trash\<时间>-<名>` |
| 插件内发起/取消任务 | run `r-f358e95993e9`：首事件 1261 ms，取消后 `cancelled` |
| DeepSeek 桌面 Agent 自己调用 Tether | 在官方桌面 APP 里问"用 Tether 列出设备"，它调用 `list_peers`，返回 3 台设备、2 台在线 |
| Agent 让 Agent 干活 | 它调用 `remote_task` 让 `LAPTOP-01` 创建 `D:\tether-node\work\tether-delegated.txt`，内容 `OK` |
| 目标端是同一个持久 Harness 会话 | 第二次只读校验 run `r-8fa5928462a6` 复用 `dsh_session=tether-s-d0332f33ad47` |
| 文件真的写对了 | 2 字节，字节 `4F 4B`，无 BOM、无换行 |
| 取消无残留 | 取消前 6 个进程（dsh → sandbox → pwsh → python），取消后只剩节点守护进程，残留 **0** |
| 断线不丢事件 | 8 秒断网，事件缓冲重放：13 个事件、`ack_seq=13`、序号连续、重复 0 |
| 幂等 | 同 `request_id` 同内容 1 个 Run；异内容 409 |
| 不确定不假装成功 | 节点被杀后 Run 进 `unknown`，不自动重跑；重启后 `reconcile` 返回真实状态 |
| 跨机走 Tailscale | `LAPTOP-01` 通过 `100.x` 接入；Controller 的 UI/API 仍只允许本机，只有 `/ws/node` 对 tailnet 开放 |

截图：`docs/screenshots/dsh-plugin-native-chat.png`、`dsh-plugin-files.png`、
`dsh-plugin-run-chat.png`、`dsh-plugin-laptop-chat.png`、`dsh-plugin-permissions.png`、
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
Tether 自带聊天页：可选监控台（设备/任务/事件/证据），不是交互端。
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

Tether 自带聊天页仍然存在，但定位是**监控台**：看设备、任务、事件、证据；不是主入口。设备/项目/文件/任务的主入口是 DSH 侧栏里的 **Tether 插件页**（下一节）。

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

DSH 是 Cordis 插件架构。Tether 按官方 client plugin 形态接入，**不是 iframe，
也不是另起一个 Web App**：

- `packages/dsh-plugin-tether`：bundle 包，`dsh.bundle.patch` 插入 host 插件；
- `packages/dsh-plugin-tether-client`：`dsh.client` 客户端插件，bundle 为
  `window.__ModuleLoader__.load({id, factory})`，依赖只来自 `PLATFORM_MODULES`；
- 注册 `ctx.slots.inject('main', …)` 和 `ctx.slots.inject('sidebar.panellist', …)`，
  侧栏出现 `Tether`，点击 `ctx.layout.selectPanel('tether')` 的等价行为由 slot 完成。

页面布局对齐 DSH：同一套左栏/主区/右栏结构、灰阶、字体与 8px 圆角；没有复制
DSH 的业务组件（client bundle 不能直接 import DSH 内部 React 组件），但复用它的
slot、布局和 token 观感。

五个区域：

| 区域 | 数据来源 | 行为 |
|---|---|---|
| 设备 | `GET /api/state` | online/offline、平台、agents、workspace；点击切换 |
| 项目 | `GET /api/devices/{id}/workspaces` | DSH `workspace.json` + `D:\TetherWorkspaces` + node workspace |
| 对话 | `GET /api/devices/{id}/dsh/sessions[/{sid}]` | 读取目标机 `~/.dsh/sessions` 的 zstd JSONL，还原 user / reasoning / tool / answer；**只读** |
| 任务 | `/api/sessions` + `/api/runs` + `/api/runs/{id}/events` | 同一套对话组件渲染 Tether Run；发起、1.2s 轮询、取消 |
| 文件 | `POST /api/devices/{id}/fs/{op}` | 目录、读取、编辑保存、新建/重命名/删除（按策略） |

DSH 原生会话的读取实现：`tether/node/dsh_sessions.py` 找到
`$DSH_HOME/sessions/<encoded-cwd>/<session>/session.vN.jsonl.zstd`，用
`zstandard` 解压全部帧，按 `SessionWireEvent` 还原 `turn/start`、`user/message`
（只保留 `source.kind=user/user-rpc`，过滤 runtime-context/skill 注入）、
`assistant/message` 的 `reasoning`/`text`/`tool-call`、`tool/result`、`turn/end`。
运行中的 `assistant/attempt` 流会聚合成临时 reasoning/text 预览。

**原生会话只读**：不写日志、不抢 Session 写锁。输入框发送时会在同一工作区新建
Tether 任务（清楚标注“不写入上面的原生会话”），这样不会破坏目标 DSH 正在进行的
对话。要在原生会话里继续，需要目标机 DSH Host 的 `session/prompt` 写者代理，
属于下一阶段。

设置抽屉做三档权限（见 §7.4），并显示审计。插件本身只改
`~/.dsh/profiles/desktop/package.json` 的 bundle/dependency；卸载不影响 DSH 启动。

已知限制：当前 client 直接访问 `127.0.0.1:18890`（controller 的 CORS 只允许 `dsh-app://app`），
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
| E9 DSH 插件 | 干净安装 `tether-dsh-plugin` | 侧栏 `Tether`；设备/项目/文件/任务/权限页渲染；其它 bundle 未变 |
| E10 文件权限 | readonly → full → readonly | 盘外写 400；DSH 工作区可写；full 可写；系统目录/凭据始终拒绝；删除进 `.tether-trash` |
| E11 插件任务 | fake agent `slow plugin ui test` | 首事件 1261 ms；取消后 `cancelled`；事件 seq 连续 |
| E12 原生对话镜像 | 读取目标机 `~/.dsh/sessions` 的 `session.v4.jsonl.zstd` | 还原 2 轮、5 个 reasoning/tool 块；页面显示与 DSH 截图同一标题/推理/工具/回答 |

证据：`evidence/gate0.md`、`evidence/gate2.md`、`evidence/dsh_plugin_fs.md`、
`evidence/cancel_probe.json`、`docs/screenshots/dsh-plugin-*.png`、`deepseek-*.png`。

### 8.2 Verified / Designed / Not implemented

| 状态 | 内容 |
|---|---|
| **Verified** | DSH 插件安装/渲染、设备/项目/文件/任务页、三档文件权限与审计、可恢复删除、DeepSeek 桌面 Agent 通过 MCP 调用 Tether、Agent-to-Agent 派活、真实 dsh 执行、Session 继续、断线重放、幂等、`unknown`、硬取消 0 残留、Tailscale 跨机、监控台 |
| **Designed** | 每台设备都跑桌面 Agent + Tether 插件/MCP 的对等网络、`@Remote` host service、配对/能力路由、审批 UI、Linux/WSL、公网 relay、多任务并发 |
| **Not implemented** | 上述 Designed 项；生产级鉴权/审计/沙箱；笔记本侧 Agent 发起任务；笔记本节点升级到含 fs 的新代码 |

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
- DSH 插件的 client 直接访问 loopback Controller（CORS 只允许 `dsh-app://app`）；
  计划中的 `@Remote`
  host service 未实现。插件复用了 DSH 的 slot/布局/视觉 token，但没有直接 import
  DSH 内部业务组件（client bundle 的依赖受 `PLATFORM_MODULES` 限制）。
- 审批 UI 未实现：SDK 0.2.1rc2 没有 `approval_requests` 握手。
- 只验证了 Windows；Linux/WSL 仅有设计。
- 每 Session 同时一个 Run；没有多任务并发/调度。
- 默认节点 token 是 demo 级；生产需要每设备凭据/吊销。
- `LAPTOP-01` 仍跑旧 Node 构建（无 `fs` 能力）；文件/项目操作需先更新
  `C:\tether-node\app` 并重启。任务委派不受影响。
- 目标机 DSH 原生会话现在能**只读镜像**（解析 `~/.dsh/sessions` 的 zstd 日志，
  渲染 user/reasoning/tool/answer）；但**不能写回原生会话**。在原生会话里继续输入
  需要目标机 DSH Host 的 `session/prompt` 写者代理，属于 Designed。
- dsh SDK 仍是 RC；事件词汇可能随版本变化，`dsh_adapter.py` 用通用 fallback 保留未知事件。
- Tether 自带聊天页是监控台；主入口是 DSH 对话 + Tether 插件页。

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
- `packages/dsh-plugin-tether-client/`：DSH 原生 client 页面（设备/项目/文件/任务/权限）。
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