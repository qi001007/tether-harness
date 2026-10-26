# Tether：多设备 Agent Harness 客户端

> 题二设计文档 · 2026-10-27
> 代码与证据：https://github.com/qi001007/tether-harness
> 一句话：让任意一台电脑上的 Agent，使用另一台电脑的文件、工具和运行环境完成任务；执行过程可看、可取消、可继续，断线不丢事件，结果不确定时绝不假装成功。

---

## 0. TL;DR 与 10 分钟导览

### 0.1 我做了什么

一个可运行的 Tether v0.1：

- 桌面端是一个 **Agent 对话窗口**（Edge `--app`），默认和本机 `DESKTOP-LOCAL` 的 DeepSeek Harness Agent 对话；
- 侧栏列出已接入的其它电脑（本次是 `LAPTOP-01`），切换过去就能把任务派到那台机器；
- 目标机器上的 Agent 用**它自己的**工作区、shell、模型 key 执行，工具调用和回答实时流回桌面；
- 断线、重复提交、取消、节点崩溃都有明确状态；取消后进程树残留为 0；
- 一条命令 `desktop/tether-app.ps1` 启动 Controller + 本地 Agent + 应用窗口；笔记本用同一份代码，只换 `.env`。

### 0.2 三个已用真实数据验证的主张

| 主张 | 实测 |
|---|---|
| 远端 Agent 真的在目标机器上干活 | 笔记本 `LAPTOP-01` 用 `pwsh` 创建了 `D:\tether-node\work\laptop-proof.txt`，返回绝对路径和内容 `OK`；桌面实时看到 tool 事件 |
| 同一会话可以继续 | 第二次 Run 的 `dsh_session` 与第一次相同；提示"不要再读文件"，Agent 直接引用上一轮读到的内容回答 |
| 取消后没有残留进程 | 取消前进程树 6 个：`python(agent) → node(dsh) → node(sandbox) → pwsh → python(sleep 120)`；取消后只剩 agent 本身，残留 **0** |
| 断线不丢事件 | 模拟 8 秒断网：事件先进节点本地 outbox，重连后补发；最终 13 个事件、`ack_seq=13`、序号连续、重复 0 |
| 幂等提交 | 同 `request_id` 同内容只产生 1 个 Run；同 id 异内容返回 409 |
| 不确定不假装成功 | 杀掉节点后 Run 进 `unknown`，不自动重跑；重启后 `reconcile` 返回节点 ledger 的真实状态 |

### 0.3 当前实现与目标架构的边界（先看这张表）

| 维度 | 已验证的 v0.1（代码里真的有） | 目标 v0.2（设计，未实现） |
|---|---|---|
| 拓扑 | 星型：一个 Controller 派发，多个 Node 接受 | 对等：每台设备同一份包，既是发起方也是受控方 |
| 本地 Agent | 桌面默认与 `DESKTOP-LOCAL` dsh Agent 对话 | 每台设备都常驻本地 Agent，可对话、可主动派活 |
| 交互 | Agent 聊天 + 工具卡片 | 同一形态，增加 peer 发现/配对/能力路由 |
| 接入 | 同一份代码；笔记本用 `.env` 指向 Controller | GitHub 一键安装 + 配对码，无需手工改地址 |
| Harness | 官方 Python SDK + npm dsh 运行时 | 可扩展 ACP adapter（Qoder/Codex/Claude Code） |
| 可靠性 | `seq/ack/journal`、幂等、`unknown`、硬取消、resume | 原样复用，扩展到多 peer 任务 |

**这不是"已经做完对等网络"，而是"对等网络所需的执行与可靠性内核已经跑通，交互先做成 Agent 对话"。** 第 9 节给出从 v0.1 到 v0.2 的具体改法。

---

## 1. 题目拆解

题面要求：用户有多台电脑，在任意一台已接入的电脑上，通过客户端操作其他电脑上的 Agent Harness（以 dsh 为例），用目标电脑的文件、资源和运行环境完成任务；支持远程发起、查看执行过程与结果、继续或管理任务；不同电脑的 OS、资源、网络、在线状态可能不同。

我把它拆成四层：

1. **执行层**：目标机器上的 Agent 必须真的能读写文件、跑命令、用本地模型 key。
2. **传输层**：发起端与目标端之间要能跨 NAT/不同网络通信；目标端不应开放入站端口。
3. **交付层**：任务有唯一身份、可重放的事件流、可取消、可继续；断线/崩溃不能产生"以为失败其实执行了"的结果。
4. **交互层**：用户面对的是一个 Agent（能对话、能看它干活），而不是一个任务表格。

题面说"客户端"，星型遥控器是成立的；但从产品完整度看，更强的解读是：**每台电脑装同一个 Agent 客户端，任意两台可以互相派活**。本文把后者作为目标架构，把前者作为已验证的 v0.1 竖切片。

### 1.1 假设

- 单 owner、2–5 台个人设备；设备之间通过 Tailscale 或可信局域网互联。
- 目标机器上的模型 key 只属于该机器，不经过发起端。
- 任务可能持续数分钟到数小时；网络会抖、设备会休眠/重启。
- 目标机器是 Windows 或 Linux；首发只验证 Windows。

### 1.2 明确不做

- 多租户组织、复杂 RBAC、公网 Relay 集群。
- 任务跨机迁移（dsh 会话单写者、工作区不迁移）。
- 多任务并发（v0.1 每 Session 同时只允许一个 Run）。
- 生产级 WSS/mTLS、设备吊销、审计、速率限制。
- 审批 UI：安装的 SDK wheel 没有 `approval_requests` 握手，标为 Designed。

---

## 2. 开源先例与选型

先做先例检索，避免重复造轮子，也避免把已有能力当自己的新设计。

| 项目 | 事实 | 结论 |
|---|---|---|
| **DeepSeek Harness（dsh）** | TS/Cordis 插件架构；ACP v1；Python SDK 管 session/prompt/events/resume；Web UI 只绑本机、单写者 | **被控 Agent 本体**；首发用 Python SDK，不手写 ACP |
| **Qoder** | 本机 IDE + CLI 1.1.78；CLI 支持 `--acp`、`--mcp-config`、`--config-dir` | 可作为本地 Agent 前端或额外受控端；首发不耦合 |
| **Codex** | CLI 0.163.0；原生 MCP | 可作为第二本地 Agent；首发不耦合 |
| **Raven** | 5.8k★ Apache-2.0 Python；gateway + WS RPC + ACP + 反向 SSH node + Job Object + 回放 | 最接近控制面；但 node 仅 POSIX/SSH，alpha；只作设计参考，不 fork |
| **nanoMuse** | 2.6k★ GPL-3.0 Swift；每台设备本地 Agent，relay 共享会话，Sentinel 审批 | 借"共享会话 + 审批门"思想；无 Windows/桌面 harness，不复制代码 |
| **Herdr** | 46k★ Apache-2.0 Rust；PTY 运行时 + 多端客户端；多设备靠 SSH；事件 512 条不重放 | 备选终端客户端；不是 harness 客户端 |
| **Orca** | 106k★ MIT TS；已支持 dsh 但走 TUI + Claude 形 hooks；插件 API 读不到会话流 | 结构化 dsh 接入要 600–900 行；20h 内不做 |
| **Happy** | 24k★ MIT；E2EE relay + ACP；daemon 安装脚本仅 macOS | Windows 受控端不成立 |

**选型结论：**

- 被控端用 **dsh**：它有完整 ACP、干净的插件化运行时，是题目点名的参考 harness。
- 接入用 **官方 Python SDK**，不手写 ACP：SDK 已经封装 initialize/session/prompt/events/resume，20h 内最稳。
- 本地交互用 **Web UI + Edge `--app`**：同一套 HTML/JS，一条命令启动，先做出 Agent 对话的实体感；不引入 Electron/React。
- 网络用 **Tailscale + 节点主动外连 WSS**：跨网络、无入站端口；换 Controller URL 就能走 LAN 或未来公网 relay。
- Qoder/Codex/Raven 作为设计对比和后续 adapter，不作为首发依赖。

### 2.1 两个真实的 SDK 坑（Gate 0 发现）

1. **Windows 运行时打包 bug**：`deepseek-harness-sdk==0.2.1rc2` 的 wheel 把 `@koromix/koffi-win32-x64` 解析到构建机路径 `E:\snapshot\node\...`，每个 turn 都报 `The specified module could not be found`。
   - 绕过：安装 npm 版 dsh，用 SDK 的 `_launch_args` 指向 `node .../dsh/lib/bin.js --profile sdk`；SDK 仍负责会话/事件/resume/关闭，只有运行时二进制来自 npm。
   - 这是代码里 `tether/node/dsh_adapter.py:npm_launch_args()` 存在的原因。
2. **SDK 没有协作式取消**：协议只注册了 `session/prompt`、`session/resume`、`session/wait`、`session/working-directory/*`，没有 `session/cancel`；`Session.run()` 阻塞到 `session.status == idle`。
   - 所以 v0.1 的取消是**硬取消**：`harness.close()` → 宽限 → 进程树终止 → `cancelled`；无法确认则 `unknown`；下一轮用 `resume_session` 修复被中断的 turn。
   - 文档里不写"协作式取消"，因为代码做不到。

---

## 3. 架构

### 3.1 v0.1：星型控制面 + 本地 Agent

```
┌──────────────────────────── 桌面 Windows ────────────────────────────┐
│  Edge --app 聊天窗口 (127.0.0.1:18890, 只允许本机)                     │
│        │ HTTP + SSE                                                    │
│  Tether Controller (FastAPI + SQLite)                                  │
│        │ 出站 WSS + node token (Tailscale / LAN)                       │
│        ├──────────────► Tether Node (DESKTOP-LOCAL) → dsh Agent        │
│        │                   └─ 本地控制台 127.0.0.1:18893（只读）        │
│        └──────────────► Tether Node (LAPTOP-01) → dsh Agent            │
│                            └─ 它自己的 D:\tether-node\work              │
└────────────────────────────────────────────────────────────────────────┘
```

- **Controller**：设备注册、会话、Run、事件日志、幂等、`unknown`、SSE；不执行代码、不持有模型 key。
- **Node**：在目标机器上运行；拉起 dsh、翻译 ACP/SDK 事件、本地 journal、进程树监督、本地控制台；只主动外连，不开入站端口。
- **本地 Agent**：桌面默认选中 `DESKTOP-LOCAL`，用户直接和它对话；`LAPTOP-01` 是同一个 Agent 类在另一台机器上的实例。
- **网络**：Tailscale 提供稳定 `100.x` 地址与 WireGuard 加密；Controller 绑 `0.0.0.0:18890`，但 HTTP UI/API 有 loopback 中间件，只有 `/ws/node` 对 tailnet 开放。
- **为什么 Node 必须存在**：dsh 的 ACP/SDK 是 stdio，跟着 dsh 进程走，不监听网络端口；Node 是把它变成出站 WSS 的适配器，同时负责进程树和能力清单。

### 3.2 v0.2 目标：对等 Agent 网络

```
┌────────────── 设备 A：Tether Agent App ──────────────┐
│ 聊天 UI · 本地 Agent(dsh) · peer 监听 · peer 注册表  │
│        ⇅ 出站 WSS（Tailscale）                       │
└───────────────────────┬──────────────────────────────┘
                        │  任意两台直连；没有唯一 master
┌───────────────────────┴──────────────────────────────┐
│ 设备 B：Tether Agent App                              │
│ 聊天 UI · 本地 Agent(dsh) · peer 监听 · peer 注册表  │
└───────────────────────────────────────────────────────┘
```

- 每台设备跑**同一份包、同一个入口**：`tether up` 启动本地 Agent + 聊天 UI + peer 监听。
- 每台既是 host 也是 callee；A 可以在自己的聊天里让本地 Agent 把任务派给 B，B 的 Agent 在本机执行，事件流回 A。
- 没有唯一 Controller；设备之间通过配对码/邀请交换身份和 token，直接 WSS；Tailscale 负责 NAT/加密，公网 relay 是可选演进。
- 可靠性内核（第 5 节）原样复用：每台节点都有自己的 journal，任务事件按 `seq` 去重/重放。

### 3.3 为什么 v0.1 先做星型

- 20 小时内，星型是拿到"真实远端执行 + 断线恢复 + 取消无残留"证据的最小路径。
- 对等网络需要多 Controller/多 peer 注册、发现、配对、N×N 连接、UI peer 列表；这些是 v0.2 的增量，不是 v0.1 的前置。
- 星型的 Controller/Node 代码已经按"设备/会话/Run/事件"抽象，改成对等主要改**连接拓扑和入口**，可靠性层不动。

---

## 4. 领域模型与状态机

| 对象 | 字段 | 说明 |
|---|---|---|
| Device | `device_id, name, platform, capabilities, allowed_workspace, online, last_seen` | 一台被控电脑；能力清单包含 OS/shell/agents/workspace |
| RemoteSession | `session_id, device_id, workspace, harness_session_id, created_at` | 可继续的远端 Agent 会话；同一 Session 单写者 |
| Run | `run_id, session_id, request_id, fingerprint, prompt, state, finish_reason, final_response, outcome, ack_seq` | 一次提示词执行；继续任务 = 同 Session 下新 Run |
| RunEvent | `run_id, seq, kind, ts, payload`，唯一键 `(run_id, seq)` | 不可变事件流；工具/assistant/thought/log |

状态机：

```
queued ──► dispatching ──► running ──► completed
                             │
                             ├──► cancelling ──► cancelled
                             ├──► failed
                             └──► unknown  ◄── 节点掉线/崩溃/终态前断链
```

- `completed` 只表示 Agent 正常结束，**不代表测试/业务目标成功**；命令非零退出、测试失败写 `outcome`，不是基础设施故障。
- `unknown` 是安全占位，不是判决；节点重连后可以上报真实状态，把 `unknown` 校正为 `running/completed/failed`；但绝不自动重跑。
- 同一 Session 同时只允许一个活跃 Run（会话级单写者）；第二个 Run 在第一个终态前返回 409。

---

## 5. 可靠性与交付语义

### 5.1 事件流

- Node 先把事件写入本地 SQLite outbox（fsync），再发 Controller。
- Controller 落库 commit 后才 ack；`ack_seq` 取**最高连续**序号，有缺口不前进。
- Node 只截断 `seq <= ack_seq`；重连从 `last_ack+1` 重放；Controller 用 `(run_id, seq)` 去重。
- 语义是 **at-least-once + 幂等效果**，不声称 exactly-once。

### 5.2 幂等

- 键：`(device_id, request_id)`；指纹：`sha256(prompt + agent + workspace)`。
- 同键同指纹返回原 Run；同键异指纹 409；响应丢失时不假装成功。

### 5.3 取消（SDK 限制下的硬取消）

1. 用户在 UI 点取消 → Controller 把 Run 置 `cancelling` 并发 `cancel`。
2. Node 调 `harness.close()` 发 shutdown；宽限期后进程树仍在，则 Job Object/进程树终止。
3. 再次检查残留进程；确认归零 → `cancelled`；无法确认 → `unknown`。
4. 下一轮用 `resume_session` 修复被中断的 turn；UI 明确提示"非协作式取消，正在执行的工具可能被中断"。

实测：取消前 6 个进程，取消后 0 残留（证据 `evidence/cancel_probe.json`）。

### 5.4 竞态表

| 竞态 | 规则 |
|---|---|
| cancel × complete | 先落库的终态获胜；晚到的终态事件照样入库；Run 保持 `cancelled`，`outcome` 记录实际终态与可能的部分副作用 |
| 离线 × 重投 | 节点先写 outbox；Controller 按 `(run_id, seq)` 去重；ack 只前进到连续位置 |
| 重连 × unknown | 节点上报 ledger；`unknown → running/completed/failed` 允许校正；不自动重跑 |
| 重复提交 | `request_id` + 指纹；同内容复用，异内容 409 |
| 节点崩溃 | 本机 ledger 里 active Run 在重启时标 `unknown`；等 `reconcile` |
| 同一 Session 并发 | 会话级单写者；第二个 Run 409 |

---

## 6. 交互：为什么是 Agent，而不是仪表盘

桌面打开就是和 `DESKTOP-LOCAL` 的对话：

```
Tether
DESKTOP-LOCAL · Local Agent        online · E:\...\work-local      Local console ↗
┌ Agents ─────────────┐ ┌──────────── Chat ─────────────────────────────┐
│ DESKTOP-LOCAL local  │ │ You: 统计 tests 目录，生成 report.md          │
│ LAPTOP-01     peer   │ │ Agent [running]                               │
│ + New chat           │ │  thought: 先列目录，再跑 pytest                │
│                      │ │  tool/call pwsh: pytest -q tests              │
│ Recent runs          │ │  tool/result: 42 passed, 3 failed             │
│                      │ │  assistant: 已生成 report.md（1.2 KB）         │
└──────────────────────┘ └───────────────────────────────────────────────┘
```

- 默认本地 Agent；侧栏切换 peer；顶部显示 agent/工作区/在线状态；本地 Agent 有 `Local console ↗`（127.0.0.1:18893，只读，显示节点自己的 outbox）。
- 会话记录跨 Run 保留：用户消息、thought、tool call/result、assistant 答案都在同一时间线；底部输入框，Enter 发送，Shift+Enter 换行。
- 一条命令 `desktop/tether-app.ps1` 启动 Controller + 本地 Node + Edge `--app` 窗口；日志在 `.runtime/logs/`。
- 同一份代码在笔记本上跑 Node；v0.2 会把聊天 UI/Controller 也放到每台设备，形成对等。

---

## 7. 异构、网络与安全

### 7.1 异构

- Node 上报能力清单：OS、shell、Python/Node、workspace、可用 agents（dsh/fake）。
- Windows 用 Job Object/进程树；Linux 用进程组（设计，未在本次验证）。
- 工作区路径由节点配置；Controller 只传 workspace 字符串，不做路径拼接。

### 7.2 网络

- 节点主动外连 WSS；目标机器不开入站端口。
- Tailscale 提供 `100.x` 稳定地址和加密；LAN 为备选；未来公网 relay 只需换 `TETHER_CONTROLLER` URL。
- 断线由节点 outbox + 重放处理；在线状态由心跳和 last_seen 表示。

### 7.3 安全边界（诚实版）

| 项 | 现状 | 生产化缺口 |
|---|---|---|
| 传输 | Tailscale/WireGuard；WSS token | WSS/mTLS、证书轮换 |
| 节点身份 | 共享 demo token（`TETHER_NODE_TOKEN`） | 每设备密钥、配对码、吊销 |
| 人类 UI/API | loopback-only 中间件；只 `/ws/node` 对 tailnet 开放 | UI 登录、会话 cookie、CSRF |
| 模型 key | 只存在目标机器 `.env`/环境变量，不经过 Controller | KMS/凭据代理 |
| 文件边界 | workspace 由节点配置 | resolve 后白名单校验、只读/写权限 |
| 日志 | 事件含命令输出，本地/仓库不进 key | 脱敏、保留期、审计 |

---

## 8. 验证

### 8.1 实验与数字

| 实验 | 做法 | 观测 |
|---|---|---|
| E0 SDK 探针 | 官方 SDK + npm dsh；dummy key | initialize/建会话/prompt/事件/idle 全通；dummy key 打到真实 401；发现 wheel 的 koffi 路径 bug 并绕过 |
| E1 本机闭环 | Controller + Node + fake adapter | 事件实时、终态入库、重连无重复 |
| E2 真实 dsh | 让 Agent 写 `gate2.txt` | 文件 `OK\n`；`pwsh` + `read` 工具事件；13 个 Tether 事件、29 个 dsh 事件 |
| E2b 继续任务 | 同一 Session 第二轮，要求不重读文件 | `dsh_session` 相同；直接引用上一轮内容回答 |
| E3 断线重放 | 模拟 8 秒 socket 断开 | 13 个事件、`ack_seq=13`、序号连续、重复 0 |
| E4 幂等 | 同 `request_id` 发送 3 次；异内容 | 只 1 个真实 Run；异内容 409 |
| E5 取消 | 真实慢命令 `python sleep 120` | 取消前 6 进程，取消后 0 残留；`cancelled` 5.4s |
| E6 跨机 | 笔记本 Node 通过 Tailscale 接入 | `LAPTOP-01` 创建 `D:\tether-node\work\laptop-proof.txt`，返回路径和 `OK` |
| UI | 桌面聊天窗口 + 本地控制台 | 实际发消息 "Say hello" → Agent 回复；同一会话累计 2 个 Run |

证据文件：`evidence/gate0.md`、`evidence/gate2.md`、`evidence/cancel_probe.json`。

### 8.2 Verified / Designed / Not implemented

| 状态 | 内容 |
|---|---|
| **Verified** | 星型 Controller/Node、真实 dsh 执行、Session 继续、断线重放、幂等、`unknown`、硬取消 0 残留、Tailscale 跨机、聊天式本地 Agent、一条命令桌面应用 |
| **Designed** | 对等 Agent 网络（每台同包、双向派活）、审批 UI、能力路由、Linux/WSL、公网 relay、多任务并发 |
| **Not implemented** | 上述 Designed 项；生产级鉴权/审计/沙箱 |

### 8.3 复现

```powershell
# 桌面
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
npm install --prefix .runtime\npm @deepseek-ai/dsh@0.2.1-rc.2
Copy-Item .env.example .env   # 填 DEEPSEEK_API_KEY
.\desktop\tether-app.ps1
```

```powershell
# 笔记本（同一份仓库）
.\laptop\bootstrap-node.ps1
# 填 .env 的 DEEPSEEK_API_KEY，然后把 TETHER_CONTROLLER 指向桌面 Tailscale IP
.\laptop\tether-node.ps1
```

---

## 9. 从 v0.1 到 v0.2：对等 Agent 网络

目标：每台设备同一份包，任意两台互相派活，没有唯一 master。

需要改的四件事：

1. **入口对称**：`tether up` 在每台设备同时启动本地 Agent、聊天 UI、peer 监听；Controller 不再是独立角色，而是每台设备内嵌的本地组件。
2. **多 peer 连接**：Node 从"连一个 Controller"改成"连本机 Controller + 每个已配对 peer 的 Controller"；每个 peer 连接独立 token/心跳；任务按 `run_id` 去重，避免双向重复。
3. **peer 注册与配对**：设备身份/公钥、一次性配对码、能力清单互换；Tailscale 提供地址，公网 relay 可选；UI 侧栏显示 peers 与在线状态。
4. **本地 Agent 工具化**：本地 dsh 通过 MCP 暴露 `list_peers`、`remote_task`、`remote_status`、`remote_cancel`；用户对本地 Agent 说"让 LAPTOP-01 跑这个"，Agent 自己调用工具派活；结果/事件回流到本地聊天。

保留不变：`seq/ack/journal`、幂等、`unknown`、硬取消、resume、事件映射、Job Object/进程树、本地控制台。

代价：设备数 N 时连接数 O(N²)；需要配对/发现/吊销；没有中心调度器，能力路由只能在客户端做；这些是 v0.2 的工程重点。

---

## 10. 已知限制

- 当前是星型，不是对等；本文把对等写进目标架构，但不冒充已实现。
- 审批 UI 未实现：SDK 0.2.1rc2 没有 `approval_requests` 握手；`next_request` 只用于诊断。
- 只验证了 Windows；Linux/WSL 仅有设计。
- 每 Session 同时一个 Run；没有多任务并发/调度。
- 默认节点 token 是 demo 级；生产需要每设备凭据/吊销。
- dsh SDK 仍是 RC；事件词汇可能随版本变化，`dsh_adapter.py` 用通用 fallback 保留未知事件。

### 10.1 如果还有时间

1. 对称入口 + 双向 peer（第 9 节），先做两台设备的真实双向派活。
2. 审批通道：升级 SDK/走 ACP，补 allow/deny/timeout。
3. 能力路由：按 OS/工具/资源选择目标设备。
4. 公网 relay / 断线更长的恢复；批量任务与 DAG。
5. WSS/mTLS、设备吊销、审计日志、工作区路径 resolve 白名单。

---

## 11. 附录

### 11.1 代码位置

- `tether/controller/app.py`：HTTP/SSE/WS、loopback 中间件、transcript 端点。
- `tether/controller/store.py`：Device/Session/Run/Event、幂等、连续 ack、`unknown`。
- `tether/node/agent.py`：出站 WSS、outbox、重连、心跳、本地控制台。
- `tether/node/dsh_adapter.py`：SDK 调用、npm 运行时绕过、事件映射、硬取消。
- `tether/static/index.html`：聊天式 UI。
- `desktop/tether-app.ps1` + `scripts/up.py`：一条命令启动 Controller + 本地 Agent + 应用窗口。
- `laptop/`：同一份代码的笔记本 bootstrap/node 脚本。

### 11.2 参考

- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- dsh Python SDK: https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.zh.md
- ACP: https://agentclientprotocol.com
- npm dsh: https://www.npmjs.com/package/@deepseek-ai/dsh
- Tailscale: https://tailscale.com/download/windows
- Raven: https://github.com/EverMind-AI/Raven
- nanoMuse: https://github.com/nano-muse/nanoMuse
- Herdr: https://github.com/herdrdev/herdr
- Orca: https://github.com/stablyai/orca
- Happy: https://github.com/slopus/happy