# Agents 多 Agent 终端方案（Herdr / Codeg 借鉴）

> 历史方案，保留原评审内容。当前实现复用 Codeg 前后端与 Herdr，不按下文新增自写 AgentSession 或编排引擎。当前架构见 [TECHNICAL.md](TECHNICAL.md)，构建入口见 [codeg-runtime-rebuild.md](codeg-runtime-rebuild.md)，实际验收状态见 [PROGRESS.md](PROGRESS.md)。

状态：方案评审稿，未实现。日期：2026-11-04。

## 1. 为什么现在的 Agents 页不像 Codex TUI

当前 Agents 页走的是 **ACP（Agent Client Protocol）**：Node 启动 `codex-acp` / `opencode acp` / `claude-code-acp` / `gemini --experimental-acp`，通过 stdio JSON-RPC 收结构化事件，前端自己画聊天消息、模型下拉、命令 chip 和权限卡片（见 `tether/node/acp.py`、`packages/tether-ui/src/agents-page.js`）。

Codex 终端里的 ASCII logo、`? for shortcuts`、Esc 中断、斜杠面板，是 **Codex CLI 自己的 TUI**。ACP 是同一 Agent 的另一个“无头前端”，不会把 TUI 画面传过来。要看到截图里的效果，必须在 PTY 里运行 `codex` 本体，再用 xterm.js 渲染。

结论：**ACP 与 TUI 是同一 Agent 的两个前端，不能在同一个进程里同时拿到两者。** 方案按“每个会话选一种视图”设计。

## 2. 参考项目怎么拆

| 项目 | 可借 | 不能借 / 限制 |
|---|---|---|
| **Herdr**（Rust，Apache-2.0，单二进制 TUI） | 四态状态模型（working / blocked / idle / done）、侧栏、PTY 多路复用、socket/CLI 的 spawn/send/read/wait 语义、断连保持会话 | 它是 TUI 二进制，**没有库 API，不能作为组件内嵌**；只能在 xterm 里跑整个 `herdr`，或借它的交互设计自己实现 |
| **Codeg**（TypeScript/Next.js，Apache-2.0） | 多 Agent 注册表、ACP 适配器组织方式、`@` 委派、Git worktree 隔离、任务/会话控制面 | 不整包搬 UI；复制代码需保留 Apache-2.0 NOTICE 与修改说明 |
| **Codex**（Rust，Apache-2.0） | 原生 TUI；需要深度结构化集成时用 `codex app-server`（JSON-RPC over stdio/NDJSON，thread/approval/stream） | app-server 也不输出 TUI；Windows 原生支持需实测，可能要走 WSL |
| **OpenCode**（ACP 官方支持） | `opencode acp` 走结构化；PTY 跑 TUI 拿完整交互 | — |
| **Claude Code**（CLI 闭源） | 只能用社区 `claude-code-acp` 做结构化；要完整交互走 PTY | 不能复制其内部实现 |

## 3. 推荐架构：双后端 + 一个控制面

```
                 ┌──────────────── Agents 页（Herdr 式侧栏 + 标签）────────────────┐
                 │ 会话列表：设备 / Agent / 状态 / cwd / 最后一行输出                │
                 │ 右侧：结构化聊天（ACP）  或  原生终端（xterm.js + PTY）           │
                 └──────────────────────────────┬───────────────────────────────────┘
                                                │ HTTP fs/acp_*, terminal_*
                 ┌──────────────────────────────▼───────────────────────────────────┐
                 │ Node：AgentSession 注册表（kind = acp | tui）                     │
                 │  ├─ ACP 后端：现有 acp.py（结构化、可编排）                        │
                 │  ├─ TUI 后端：现有 terminal.py（PTY、resize、UTF-8）               │
                 │  └─ 状态检测：输出环形缓冲 + 每 Agent 的 profile 正则              │
                 └──────────────────────────────┬───────────────────────────────────┘
                                                │
                 ┌──────────────────────────────▼───────────────────────────────────┐
                 │ 编排层：MCP 工具 agent_spawn / send / wait / read / stop          │
                 │ 优先 ACP 结构化；TUI 只能按键 + 等 idle（兜底）                   │
                 └──────────────────────────────────────────────────────────────────┘
```

设计要点：

1. **会话模型统一**：`AgentSession { id, device, agent, cwd, kind, status, title, lastOutputAt }`；前端只认这个模型，不关心后端是 ACP 还是 PTY。
2. **TUI 模式**：Node 的 `terminal_start` 增加受控的 `command`/`env`/`title`（只允许 profile 白名单里的 `codex`、`opencode`、`claude`、`gemini`），沿用现有 pywinpty/ConPTY 与 POSIX pty。
3. **ACP 模式**：保持现有 `acp_start/prompt/poll/reply/set_model/stop`，作为多 Agent 编排的首选，因为它有结构化事件，不依赖猜屏幕。
4. **状态检测**：TUI 会话维护最近 N KB 输出，按 profile 正则判断：
   - `working`：最近有输出 / 匹配 “esc to interrupt” 等；
   - `blocked`：匹配审批、密码、`Allow?`、选择项；
   - `idle`：静默超过阈值且出现提示符；
   - `done`：进程退出（exit code 0）；`error`：非 0。
   这是 Herdr 同类做法，必须按 Agent 版本维护 profile，不能承诺 100% 准确。
5. **编排层**：给 Agent 暴露 MCP 工具：
   - `agent_spawn(agent, cwd, task)` → 返回 session id；
   - `agent_send(session, text)`；
   - `agent_wait(session, pattern|idle, timeout)`；
   - `agent_read(session, since)`；
   - `agent_stop(session)`。
   ACP 会话直接走协议；TUI 会话用 PTY 写入 + 输出等待。Codeg 的 `@` 委派可以作为 UI 语法糖，底层仍落到这些工具。
6. **worktree 隔离（可选）**：Node 在目标机用 `git worktree add` 给每个委派任务独立目录，避免多个 Agent 改同一工作区；Windows/Linux 都可用，失败时退回同一 cwd 并显式提示。

## 4. 具体改动点

| 文件/模块 | 改动 |
|---|---|
| `tether/node/agent_sessions.py`（新） | 统一会话注册表；启动/停止/状态/持久化元数据 |
| `tether/node/terminal.py` | `start` 支持 `command`/`args`/`env`/`title`（白名单）；输出环形缓冲；状态钩子 |
| `tether/node/agent_profiles.json`（新） | 每个 Agent 的启动命令、品牌名、忙/阻塞/空闲正则、模型探测方式 |
| `tether/node/acp.py` | 不变，注册为 `kind=acp`；补充 Codex app-server 可选后端 |
| `tether/node/mcp_server.py` 或新 `orchestrator.py` | `agent_*` MCP 工具；鉴权沿用 Hub/Node token |
| `packages/tether-ui/src/agents-page.js` | Herdr 式左侧会话栏 + 顶部标签 + 右侧双视图；TUI 用 xterm |
| `packages/tether-ui/src/terminal-dock.js` | 抽出可复用的 xterm 运行时，避免终端页和 Agents 页两套 |
| `packages/tether-ui/src/agent-logos.js`（新） | Codex/OpenCode/Claude/Gemini 品牌图标与字标；只用可再分发素材 |
| `docs/NOTICE` | 若复制 Herdr/Codeg 代码或素材，附 Apache-2.0 归属与修改说明 |

## 5. 分阶段落地

**P0 可行性样张（0.5–1 天）**
- 在 Windows 与 Linux 各跑一次 `codex` TUI：PTY 启动、xterm 渲染、输入、resize、Esc/Ctrl+C、退出码。
- 确认 Codex/Claude/OpenCode 在 Windows 是否原生可用（不可用则明确 WSL 路径）。
- 产出：两张截图 + 一份兼容性结论。验收：Codex ASCII logo 与提示符能在我们的 xterm 里正常显示，输入能回车。

**P1 Agents 页骨架（2–3 天）**
- 统一 `AgentSession`、左侧会话栏、标签、TUI 视图（先只接 Codex）。
- ACP 现有功能不回归；关闭标签真正 kill PTY。
- 验收：同时开 Codex TUI、OpenCode ACP 两个标签；切换不丢输出；Node 侧 `ps` 只剩预期进程。

**P2 状态与通知（2–3 天）**
- profile 正则 + 四态；侧栏状态点、阻塞横幅、点击聚焦。
- 验收：Codex 等待审批时 3 秒内变 `blocked`；任务完成变 `done`；误报率在三个版本上记录。

**P3 多 Agent 编排（3–5 天）**
- `agent_*` MCP 工具；`@codex` 委派；可选 worktree。
- 验收：一个 ACP Agent 调 `agent_spawn(codex)` → `agent_wait` → 读取结果并汇总；全程可审计、可取消。

**P4 持久化与打磨（2–3 天）**
- Linux 可选 tmux 后端让 TUI 会话脱离 Node 存活；Windows 暂不做。
- 品牌图标、快捷键、命令面板、会话恢复。
- 验收：Node 重启后 ACP 会话标记结束、TUI 会话（tmux 模式）可恢复；无静默丢会话。

## 6. 风险与边界

- **TUI 状态靠猜**：不同 Agent 版本提示语会变；profile 要跟版本走，误报要显示为 `unknown`，不能假装准确。
- **Windows**：Codex/Claude CLI 的原生 Windows 支持要先验证；ConPTY 对全屏 TUI 的渲染要真机截图，不接受“代码写完”。
- **安全**：TUI 会话等于在目标机跑 Agent CLI；服务器节点是 root，必须沿用 token + 白名单 + 审计，不能让任意命令通过 `command` 参数注入。
- **许可**：Herdr/Codeg 是 Apache-2.0，可参考/复制但需 NOTICE；Claude Code 闭源，只能调用 CLI，不能搬内部逻辑。
- **不要为了像 TUI 而放弃 ACP**：ACP 才是多 Agent 编排和远程稳定性的基础；TUI 是“人看着舒服”的前端。

## 7. 需要拍板

1. 是否接受 **双后端**（同一 Agent 可选“结构化/原生终端”），而不是只做其中一种？
2. 首批 Agent 顺序：Codex TUI 优先，还是 OpenCode/Claude 优先？
3. 多 Agent 交互是“可见的协调者 Agent + @ 委派”，还是只提供 MCP 工具给任意 Agent？
4. 是否要 worktree 隔离（更安全但更重）？
5. Herdr 只借设计，还是允许在 Tether 里额外开一个“Herdr 工作区”标签直接跑它的二进制？

## 2026-11-04 决策修订：DSH 是工作台，不是固定 Router

- DSH 的定位是**每个节点上的可交互工作台**（原生浏览器、终端、文件预览、插件），不是团队里固定的指挥者；团队谁做 Router 由 Herdr/Codex 的 skill 决定，DSH 的 CLI 也可以作为 Herdr 里的一个 Worker。
- 接入分层：原生 Web（DSH、OpenCode）→ Codex app-server（thread/turn/item 协议，自绘同款 UI）→ ACP（Qoder/Claude/Gemini 等）→ Herdr 终端（所有 CLI 的兜底）→ 不做窗口串流。
- 每节点 Agent 目录已落地：自动扫描 PATH + 手动登记/编辑/删除，配置存 `<node data>/agents.json`；DSH Web 运行中会以“本机服务”显示为可用。
- Herdr 已打包进 Node，机器人页有“Herdr 工作区”；OpenCode 已是第二个原生 Web：Node 用 `opencode serve` 起本机服务并挂到 mesh 网关，Agents 页一键打开原生 iframe，远程应用页同样可见。2026-11-04 在 LAPTOP-01 实测启动/停止/重启再启动均通过（端口 `4096 → 4097`，网关 200）。
- 下一步：Codex app-server 自绘表面；Herdr 作为多 Agent 编排（pane/skill）；Codeg 只复用 adapter/会话/设置骨架。
