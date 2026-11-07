# Tether 技术说明

本文公开 Tether 客户端、插件、Node 与服务端之间的兼容边界，不记录私有服务地址、部署操作、凭据位置或内部服务器实现。

## 当前候选与生产边界（2026-11-07）

生产主机 APP+Node 与 cloud Node 已正常安装 0.4.8；Laptop 仍为在线 0.4.7，旧更新 job 因 `update_timeout` 结束，尚未 apply 0.4.8。0.4.9 是未签名/未发布候选，包含远端更新详情后台收起、错误关闭、设备 scope 保护及 Node/同根 managed APP busy guard；HTTP actual nonempty snapshots 未实机核验，CLI path 和瞬间新任务竞态不在本轮范围。官方插件发行仍为 0.2.93，DSH 宿主现有安装 0.4.2 未改。

系统代理 flag 和 relay 配置已补，效果需等受控 Node 重读验证。1.448 秒代理与 9.759 秒直连的单次小范围对照不能代表完整包传输。048 目录错误修复仍待实际新版屏幕复验；生产多 Agent 验收仅覆盖基础能力。

## 组成与职责

| 组件 | 职责 |
|---|---|
| DSH 插件 | 在 DeepSeek Harness 中呈现设备切换、文件与权限功能，并可提供 MCP 工具入口。 |
| APP 客户端 | 提供独立桌面入口，连接配置的本地服务或 Hub；当前发行与实机安装状态见 [PROGRESS.md](PROGRESS.md)，不以源码版本代替运行版本。 |
| Node | 代表一台目标设备，执行授权范围内的文件和任务操作；连接由用户配置的 Tether 服务。 |
| Agents 运行时 | 在目标设备复用 Codeg 的前后端、成熟 CLI/ACP 与 Herdr 终端能力。Tether 负责启动、授权、路由和嵌入，不另写 Agent 推理引擎；DSH 插件不新增多 Agent 业务。 |
| Tether 服务 | 提供客户端与 Node 使用的兼容 API。可由有权限的私有服务部署提供，或由用户配置可达 Hub。其部署和运行细节不属于本公开仓库文档。 |

DSH 入口的模型调用与会话持久化由目标设备的 DSH Host 管理；Agents 入口由目标设备的 Codeg 后端驱动成熟 CLI/ACP，使用目标设备的资源与登录态。Hub 只做认证和路由，不调用模型。客户端不得为同一 DSH 会话创建第二个写入者，也不得把服务令牌发送给模型或公开日志。

Agents 当前源码入口为 `tether/node/agents_runtime.py`、`tether/node/agents-runtime-codeg.patch` 与 [Codeg 重建说明](codeg-runtime-rebuild.md)。`AGENTS_MULTI_AGENT_PLAN.md` 和 `ACP_HARNESS_PLAN.md` 保留早期设计经验，不作为另建编排引擎的实施指令。

## APP 更新与远端运行

- APP 更新按设备安装的组件决定范围。先准备 Node 和 APP 的更新包，再按 Node、APP 的顺序应用。重连后核对运行版本。本机 DSH 插件保留独立入口。
- 0.4.8 候选将远端更新完成的操作限制为刷新状态，避免整页刷新清掉当前设备和页面；只有真实本机身份已知且匹配时才保留原自更新刷新。迟到回调按设备、Hub、产品和组件生命周期校验。
- 目录缓存与读取成功是两件事。缓存可用于保留上次列表，但后台请求失败必须显示错误和重试；不能用缓存为空掩盖失败。0.4.8 候选包含此修复，实际安装与错误态验收单独记录。
- 发布包在签名前核对与 updater 一致的大小限制和路径白名单。旧 Node 可能因上限或白名单不同而拒绝新版包。独立暂存、依赖验证和回退适用于这种迁移。
- 文件转移沿用 EasyTier 直连、croc 私有 relay 与 Hub 兼容路径。目标节点返回的读写错误会直接呈现。传输连接不可用时才尝试备用路径。
- Croc 的 relay transport 也可以使用协商出的发送端本机 relay，不等同于所有字节必须经过云端。0.4.8 候选仅恢复本机探索，仍要求配置自托管 relay；是否实际直连及吞吐改善须以目标设备验证为准。
- Agents 工作区使用目标 Node 上的 Codeg。进程通过带令牌的健康检查后，目标 Node 提供 APP 网关地址。Herdr 在目标 Node 的 PTY 里运行。Codeg 的构建基线和重放步骤见 [Codeg runtime 构建说明](codeg-runtime-rebuild.md)。

## 2026-11-07 实际部署与隔离验收边界

- 当前生产状态：三台 Node 和主机/笔记本 APP 均为 0.4.7。主机 Node apply 返回 `restart_deferred=true`、APP apply 返回 `restart_scheduled=true`；新 APP 窗口启动后 Hub Node current/runtime 与 APP current/installed 均为 0.4.7，`restart_required=false`。LAPTOP APP+Node GUI 联合更新、云端 Node 普通 RPC 更新也均完成。
- 远端设备更新完成后，主 APP 页面曾回到 DESKTOP-LOCAL 原生 DSH，而非保留启动更新的 LAPTOP-01 文件页；该页面状态保持 UX 问题仍待修。
- 主机 work-local 45 行与 Hub `/fs/list` 45 项一致；LAPTOP 默认工作区 6 项，侧栏无旧主机未分组路径。主机 DSH Hub 映射、搜索/输入区和 composer 可见。LAPTOP Agents 列表与 Codex 可用卡可见；主机 Agents 三条历史和既有完成对话可见，连接已连接且无断开弹层。未发送消息或提交任务。
- 多 Agent 协作完整任务流程、手机真机和全面吞吐优化仍未验收。目录空缓存遇后续列表请求失败可能保留空结果且错误提示弱；本次成功读到 45 项，未复现，不应写成根因已完全消除。
- DSH 插件发布冻结仍为官方 0.2.93，组件更新通路不移除；实际 DSH 宿主安装版本 0.4.2，本轮没有强制回退、升级或重启宿主。验证 UI 时记录“发行冻结版本”和“宿主运行版本”两个不同概念。
- 已签名 APP 0.4.6 隔离副本以 `TETHER_NODE_MODE=external` 运行，`TETHER_APP_BINDING=0`，不启动第二 Node；该副本复制了 owner Hub 配置，但新 Electron profile 不含 `localStorage['tether.hub']` 登录态，故登录页是隔离 profile 的预期状态。它的 app-context device 为 DESKTOP-LOCAL、hub=true、无 localApi；这些字段不能替代登录后 UI 或 DSH surface 验收。
- 0.4.6 期间的同步 90 秒只读采样每 2 秒取 `/api/health` 与 `/api/state`，46 组均成功，三台 Node 全程在线 0.4.6。Heartbeat 相邻时间差主机 1.911–2.117 秒、笔记本 1.895–4.000 秒、云端 2.000–2.003 秒。主机 Node launcher/interpreter 两个进程共享唯一设备/数据库身份；隔离 Electron 树停止后，主机 APP 与 Node 不受影响。
- 升级前主机 APP 0.4.5 曾显示 work-local 空列表和旧主机未分组路径，Codeg 背景区也出现断开提示；0.4.7 相同数据实机复验后列表为 45 行、跨设备路径不残留，Agents 历史连接正常。本次成功结果不覆盖空缓存后请求失败的潜在弱错误反馈分支。

## 更新过程的资源预算

更新包下载和解包的内存峰值高于 Node 的日常驻留量。为小内存设备设置服务软阈值时，需同时覆盖完整归档缓冲和单文件解压；不能只按空闲进程的占用设定。若下载字节已收齐却长时间不进入 prepared，优先检查 cgroup 的 `memory.events.high` 是否持续增长，并与硬上限和 OOM 计数区分。2026-11-07 已验收的小内存 Node 保留 384 MiB 硬上限，软阈值为 368 MiB；320 MiB 是此前的过渡值，不能据此恢复旧配置。阈值调整后原有 prepare 继续完成，无需为这项配置变更重启进程。DSH Web 是另一个服务，其预算应分别管理。

## 连接与兼容边界

- 客户端通过配置的服务地址连接 Tether 服务；Node 使用出站的安全 WebSocket 连接，不要求目标设备开放公网入站端口。
- `device_id` 标识设备；显示名称是用户可修改的标签，不能替代设备身份。
- 同一任务的重试需要沿用同一请求身份；事件消费按序号确认。客户端必须保留取消结果与状态不确定的区分，不能把未知结果自动当成失败并重放任务。
- 插件、APP、Node 与服务端必须使用兼容的协议版本。每次发布都应核对版本清单与制品摘要，并分别验收升级/回滚；v0.2.1 尚未完成数字签名和完整远端升级验收。
- v0.2.1 的三份 ZIP 与统一更新清单已发布；官方 HTTPS 下载、SHA-256 和部分更新器清单检查已完成。这不证明制品已在目标设备干净安装或完成软件内/远端升级。
- 设备文件操作受 Node 当前策略限制。用户界面显示的设备与工作区不能改变服务端授权范围。
- DSH 原生附件 picker 从当前 Host 的 owner-only `/tether-identity` RPC 取得 `device_id`；读取使用 DSH `remote.workspaceFiles.list/readBytes`，受当前 DSH Session workspace scope 与 Host filesystem 权限约束，不需要在 iframe origin 配置 Hub token。picker 只允许打开最近由 API 返回的目录和文件条目，`readBytes` 的 `Uint8Array` 按 256 KiB 分块形成附件，单文件限 10 MiB；设备或 Session 作用域变化后不调用当前 composer `onAddFiles`。0.2.29 候选已在隔离真实 DSH Web Host + QA Node 验证 picker、chip 与原始二进制字节回传；无消息发送或模型调用，物理 LAPTOP-01 跨设备验收仍待完成。原生附件 slot 不读取未注入的 Cordis `ctx.fileDrag` 服务，因为该 getter 会直接抛错并导致 slot entry 崩溃；拖拽保留给 DSH 原生附件组件处理。

## MCP 工具接口

在已配置并获授权的服务上，插件可向 DSH Agent 提供以下工具：

| 工具 | 用途 |
|---|---|
| `list_peers` | 查询可用设备及连接状态。 |
| `remote_task(device, prompt)` | 在目标设备提交任务。 |
| `remote_status(run_id)` | 查询任务状态。 |
| `remote_cancel(run_id)` | 请求取消任务。 |
| `remote_workspaces(device)` | 查询目标设备可用工作区。 |
| `remote_files(device, path, op, text?, dest?)` | 在策略允许范围内列出、读取、写入、创建、重命名或删除文件。 |
| `remote_audit(device, limit)` | 查询目标设备审计记录。 |

这些工具描述的是客户端可见操作。服务认证、部署拓扑、密钥管理和存储实现由具体服务发行与维护，公开客户端文档不包含其私有配置。

## 验证边界

离线回归、隔离 UI 检查、本机 DSH 验收、干净安装、真实跨设备操作和公开发布是不同的验证层。某一层通过不能替代其他层。当前进度和未验收项目见 [PROGRESS.md](PROGRESS.md)；功能需求和反馈见 [PRD.md](PRD.md) 与 [FEEDBACK.md](FEEDBACK.md)。

## 编码四原则

1. 编码前思考：先核对实际行为，写明假设与权衡。
2. 简洁优先：用满足当前需求的最少结构实现。
3. 精准修改：只改与反馈直接相关的内容。
4. 目标驱动执行：定义成功标准并按对应层级验证。

