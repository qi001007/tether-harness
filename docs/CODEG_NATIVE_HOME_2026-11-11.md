# Codeg 原生 Agent 主页实施计划

> For agentic workers: use the existing Luna implementer for this tightly coupled source/build/deploy task; Sol owns design and review, Terra owns actual APP interaction verification. Follow the existing executing-plans workflow without creating another Tether worktree.

**Goal:** 将默认 Agent 主页接入 Codeg 原生工作台页面，修复覆盖层与原生分栏、缩放、编辑区域冲突，同时保留 Agent 启动、账号与已有会话。

**Architecture:** 在既有 WorkbenchRouteContext 和 WORKBENCH_ROUTES 注册 agents 页面，由 Codeg 的 WorkspaceContent 管理主区域和页面显隐。Agent 主页通过原生 tab actions 打开指定 Agent 的草稿，随后返回 conversations；会话、文件编辑器和终端继续使用原有布局与生命周期。

**Tech Stack:** Codeg 0.42.0 的 Next 静态导出、React、TypeScript、原有 react-resizable-panels；复用现有 codeg-server，前端变更不重建 Rust 后端。

**Spec:** 主人 2026-11-11 的本次反馈：自定义主页直接覆盖原生 Codeg 页面，拖动编辑边界的变化和丝滑程度不及原生；要求作为原生页面内嵌。本文记录该要求及 Sol 的实现裁定。

## 已查明的实际结构

- `conversation-detail-panel.tsx` 的自定义主页采用 fixed/z-50、按全窗口坐标定位，并每 250ms 查询侧栏与标题栏几何。
- `globals.css` 的 Tether 覆盖规则隐藏原生标签栏、resize handles、分隔线和会话头部。
- 实际 guest DOM 观察到主页层与原生主区重叠；这不是外层 Tether webview 的宽度问题。
- 上游已有 WorkbenchRouteProvider、原生页面 registry、SidebarNavButton、WorkspaceContent、原生 panel group，不需要另造路由或拖拽框架。

## Global Constraints

- 现有 Tether 工作树、身份、账号、数据库、会话和未知 dirty 修改全部保留；不 reset/clean，不创建新 Tether worktree。
- 单一源码目录 `.runtime/codeg-source` 从现有 Codeg 参考源码恢复，原 salvage 档案不改；当前恢复量约 57.5MB，不含运行时和依赖。
- 先复用缓存，再按既有锁文件仅补缺失前端依赖一次；保持单一 node_modules/build/export，不复制整套运行时，不改依赖版本来掩盖缺包。
- 只生成 Codeg 前端静态资源，保留目标 codeg-server、CODEG_DATA_DIR、账号、模型设置、Node、Hub 与网络授权。
- 修改最终进入 `tether/node/agents-runtime-codeg.patch`；生成产物从源码构建，不直接编辑压缩 bundle。
- 不用全局 CSS 或关闭 webSecurity 掩盖布局问题；保留框架原生容器、分隔条和尺寸约束。

## Sol 方案裁定

- 采用已有原生 workbench route，注册 `agents`，主页位于 Codeg 自身的 WorkspaceContent 内，由同一页面状态控制。
- 原生页面壳可以使用上游自身的定位方式；禁止另加按 viewport/侧栏几何估算的 Tether fixed 层，也禁止让隐藏会话争抢 pointer events。
- 结构化启动复用 `openNewConversationTab(folder.id, folder.path, { forceAgent })`；无活动文件夹时复用 `openChatModeTab({ forceAgent })`。随后调用 `openConversations()`，沿用正常首次发送建立会话的流程。
- 终端启动沿用 `useTerminalContext`，Agent 元数据继续复用 `useAcpAgents` 的共享缓存。
- 主页入口与回程使用原生 SidebarNavButton / route title；移除各 ConversationTabView 中的独立主页、重复的全局 show/hide 监听、坐标计时器和相关 module-global 标志。若外层 Tether 已调用 `tether:show-home`，在原生 route owner 只注册一次兼容入口，将它映射为 `setRoute("agents")`；内部会话切换使用 `openConversations()`。
- Tether token 默认入口应明确进入原生 Agent 主页；深链或显式 next 仍保留原意。查询参数只驱动原生 route，不再自动创建空会话或设置用于隐藏原生控件的全局标记。

## Tasks

- [x] 应用现有 Tether patch，保存本次修改前差异；完成 `workbench-route-context.tsx`、`workbench-content.tsx`、`sidebar.tsx` 及原生 Agent 页面接入。
- [x] 从 `conversation-detail-panel.tsx` 与 `globals.css` 删除自定义覆盖层和广域隐藏规则；保留其它已存在的功能修改，清理仅因此失效的 import/变量。
- [x] 用现有 tab API 接上结构化 Agent、主页回程和终端动作；源码复用原生 tab actions，并保留当前 tab 的 agentType。默认入口和原生页面实机验收通过。
- [x] 再生 tracked Codeg patch、必要的 token bridge 和目录 backlog；tracked patch 正向/反向 apply check 通过。恢复锁文件依赖后，用 Node 24.22.1 执行既有 postinstall 和单一 Next 静态构建。
- [x] 将 1007 个静态文件部署到 LAPTOP-01 实际使用的 Codeg web 目录；部署前保留一次回退目录。实际 index/workspace/token 响应与构建产物哈希一致；静态部署期间未重启 Codeg server 或 Node。r11 APP 的 readiness 补丁此前单独重启为 PID 9996。
- [x] r11 中已确认 Codeg 原生 Agent 页显示、Tether loading 遮罩消失、左侧栏与聊天区边界可拖动、窗口最大化/还原、主页/聊天来回，以及真实 Codex 唯一 nonce `CODEG-1111-1320` 回复并保留同一会话。截图 `.scratch/evidence/codeg-codex-final-retained.png`。
- [x] 复验新增默认入口修复：正常关闭工作台后重新打开直接进入 Codeg 原生 Agent 页，再返回既有 nonce 会话；未重发模型消息。证据 `.scratch/evidence/native-agents-default-final.png`。
- [x] 只读打开既有 QA 文本文件并拖动 Codeg 内文件编辑器分隔条：x=810→690→810，accessibility value=56→41→56；文件无输入/保存。截图 `.scratch/evidence/codeg-editor-divider-moved.png`。

## Review Focus

- 不能只把 fixed 改成 absolute，或再加一层盖住原生内容。
- 主页应只有一个原生页面 owner，不能每个会话实例启动计时器或响应同一全局事件。
- 拖拽时主页边缘与原生容器同步，鼠标命中正确的 handle，原生编辑器/终端布局未被全局隐藏规则破坏。
- 选 Agent 必须通过原生 forceAgent 绑定，已有会话和草稿不可被无条件重建或误切模型。
- 构建和发布记录必须区分本地检查、已部署资源、真实 APP 观察；nonce 未真正回复前不标完成。

## 进展

- Codeg 原生 route/tab 接入、覆盖层与广域 CSS 移除、token 默认主页入口和 tracked patch 已实现；clean source 正向及 canonical source 反向 apply check 通过。依赖恢复后完成初始静态构建，随后同一 source/out 完成一次增量构建；1007 个文件部署到已核对的 LAPTOP-01 web 根目录，保留最初回退目录。
- 实机打开曾因迟到的 `did-finish-load` 监听持续显示“正在连接”；一次安全 readiness 快照、忽略 same-document 导航开始事件、主进程固定 token bootstrap next 已修复并部署。r11 `app.asar` SHA-256 `697F5F220B33EC8299C5B0352A34FA447390646C82F5DBBEA19FC8498A13CDD4`、bundle SHA-256 `41A4EB2636D247974127D2A9D7928A3DEFC3530CE2C1C3FD28C42FB362C75381`，focused tests 21/21 通过，PID 9996。
- 首次真实 Codex nonce `CODEG-1111-1320` 已回复；Terra 验证主页/聊天区拖动、最大化还原、切页往返保留会话。随后发现 initial tab restore 覆盖显式 agents route；已在 `WorkbenchRouteConversationSync` 精准忽略首次 null→activeTab 初始化覆盖，保持后续本地切换和 remote activation 原语义。针对 `src/app/workspace/layout.tsx` clean forward 与 canonical reverse apply-check 均通过；Node 24.22.1 增量 Next build 成功。
- follow-up 静态包 1007 文件、77,852,616 B，已部署到同一 LAPTOP-01 静态根。旧初始版回退目录保留；最终接受后已清理本次创建的中间 web 回退树。index/login/workspace/token 均由目标 server HTTP 200 返回且 SHA-256 与构建输出一致。关闭后重开默认原生 Agent 页、返回同一 nonce 会话已通过；文件编辑器分隔条实机验证也已通过：x=810→690→810（accessibility value 56→41→56），只读打开 QA 文本文件，未输入或保存；截图 `.scratch/evidence/codeg-editor-divider-moved.png`。

