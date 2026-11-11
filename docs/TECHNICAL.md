# Tether 技术说明

## 2026-11-11 更新事务与当前部署边界

- Node 更新器先持久化事务与恢复材料，再替换文件；应用后的状态为 `awaiting_acceptance`。Hub/APP 核验目标 Node 的版本、事务 ID/状态及所需服务状态后，才调用 commit 清理备份；验收失败则调用 rollback。APP 重启后可从 Node status 发现待验收事务并继续验收。Node 提供 commit/rollback RPC，Hub 对应路由已部署。
- Hub 当前 release 为 `/opt/tether/releases/update-transaction-20261111-r1`，其中 `app.py` 与 `update_jobs.py` 已更新；部署后 health 为 ok、3 台 online、无 stale。前一 release 保留，便于回滚。
- 本地门禁结果：Node pytest 107 passed / 2 skipped；Hub 39 passed；UI update_chain 24/24；candidate+UI 40/40；workflow 10/10；生成 bundle 与 web build checks 通过。pytest exit code 0；结束时出现既有 `agent_registry.catalog` interpreter-shutdown 线程噪声。
- 端到端边界：GitHub 签名 0.5.2 preview 尚未发布，update source 尚未实际返回 0.5.2，真实设备尚未从 UI 完成 prepare/apply/restart/service acceptance/commit；尚无对应成功截图或微信送达确认。源码、定向测试及 Hub 路由健康不等于设备更新验收。
- 409 恢复与磁盘：DESKTOP-LOCAL 的 409 来自切换到候选 Node 侧部署破坏真实 APP 基线；当前已恢复 `D:\Tether\node` 0.2.3，APP 中 LAPTOP-01 DSH workspace/composer 恢复，3/4 设备在线。DESKTOP-LOCAL 当前为 0.2.3。E:.scratch 曾占 78.316 GB / 1,090,126 个文件；清除 18 个可复现旧候选输出后释放 71.87 GB，可用空间约 74.78 GB。构建候选以 owner marker、路径约束保护清理边界，并保留当前及最近一个候选；candidate tests 16/16。

本文公开 Tether 客户端、插件、Node 与服务端之间的兼容边界，不记录私有服务地址、部署操作、凭据位置或内部服务器实现。

## 2026-11-10 0.5.2 桌面认证候选

- 常规桌面登录使用系统浏览器访问 Casdoor Authorization Code + PKCE，固定 loopback 回调为 `http://127.0.0.1:18893/oauth/callback`。桌面 public client 不含 client secret；访问与刷新令牌只在 Electron 主进程内加密持久化，不下发 renderer。候选模式可从外部凭据文件调用 Casdoor 登录并完成同一 loopback 回调，该分支不在常规模式启用。
- 迁移前仅接受可验证的旧版有效会话作为兼容路径。OIDC 登录成功或用户显式退出后，主进程持久化 `oidc` 模式；后续启动不恢复旧 Hub bearer/cookie。UI 先检查认证态，未认证时暂停工作台状态读取，认证后再进入原设备工作台。
- 服务端同时接受原 web audience 与 `tether-desktop` audience；补丁在独立服务端工作树完成并通过 5 项定向测试，正式 `current` 已切换到 r7，runtime 继续复用 r6 虚拟环境。Casdoor public client 使用空 secret、固定 loopback 和 Authorization Code + refresh token；未改变应用数据库 schema。旧 web OAuth 和旧 Bearer 切换后均通过。
- 客户端的两个实机根因已修复：OIDC 分支只允许 `oidcAuth.fetch` 注入一次 Bearer，避免大小写不同的重复 `Authorization` 被服务端拒绝；设备列表和原生工作台 Controller API 统一走 `controllerFetch`，不再绕回旧 cookie session。42 项定向测试通过。
- packaged r5 已使用原账号完成真实登录并读取 4 台原设备；加密会话写入后，移除候选凭据环境变量并重启同一包，已登录状态与设备列表自动恢复。尚未完成显式退出后的第二次登录。
- packaged r5 portable 为 823,711,922 字节，SHA-256 `4674619ab9967f01371dfb25ae2b4a1d29be357d9ae9b7f45af88b0b28eebfaa`；本轮未配置代码签名，仍是 preview 候选。
- 节点工作台仍有独立兼容缺口：现有节点对 `service_catalog` 返回 `bad_op`，部分旧记录返回 `device_not_found`，所以 DSH/Codeg 未完成本轮 UI 打开验收。该结果不能归因于桌面 OIDC，也不能据后台运行状态推断工作台已通过。
- 主人提供的正式控制面只读结果显示，LAPTOP-01 与 REMOTESTITCH-HUB 的旧 `dsh_status`、`agents_runtime_status`、`drives`、`workspaces` 均返回 HTTP 200；两台 DSH 的 `running=true`、`surface=true`，Agents runtime `running=true` 且 URL 存在，drives/workspaces 非空。证据支持旧节点功能仍在线，当前断点是新 `service_catalog` 接口不兼容；后续应复用旧 status/list 接口实现 legacy compatibility，再独立评估打开服务所需的授权与路由契约，不以整机重装作为默认方案。
- 0.5.2 源码候选对结构化 `bad_op` 与 `device_not_found` 使用按 actor/target 隔离、60 秒 TTL 的 protocol 1 missing catalog，覆盖 dsh/codeg/herdr/files/desktop，标记 `legacy: true` 且不标为 ready；401/403 和其他 Controller 错误仍向 UI 抛出。Agents 对 missing Codeg 禁用启动并按错误码显示升级或重连提示；DSH 状态轮询将 missing 记录作为服务状态，不视为读取异常。候选尚待定向测试及打包后的 UI 验证，节点协议兼容和真实工作台使用仍未通过。
- 2026-11-10 UI 稳定性源码补丁：Electron 托管 OAuth 下，远端 `GET /api/devices/{id}/dsh/surface` 通过已有受限 `hubRequest` 主进程通道；不向 renderer 暴露 token、请求头或绝对 URL，保留 HTTP 状态和响应 body，并在 IPC 前后检查取消信号。Web、DSH 和显式 legacy 分支不变。`/app-context` localDeviceId 只有存在于当前 `state.devices` 时才可触发自动选择；用户手动选择仍优先。源码测试不证明 packaged UI 稳定，也不提供旧工作区协议兼容或节点升级能力；30 秒 packaged UI 实机观察待完成。

## 当前候选与生产边界（2026-11-07）

主机 APP/Node 与 cloud Node 为 0.4.9；Laptop APP/Node 仍为在线 0.4.7，旧更新 job `0b4347...` 因 `device_offline` 结束且未 apply 0.4.9，大包读取仍慢。0.4.10 是未发布候选，状态快照需有有效 `devices` 数组才可替换最后合法 UI 状态；hook focused 回归 9/9 通过，尚未部署。049 曾在短暂离线后触发 `state.devices.find` 错误，ErrorBoundary Retry 后恢复到 DESKTOP native。

049 远端更新后台收起/恢复同一任务和文件页刷新已真实验收。缓存非空路径失效的 banner、旧行和 retry 已实际观察，截图未保存；空缓存反馈/恢复点击仍待验，专属目录已恢复。代理和 relay 配置的实际效果待受控 Node 重读；Laptop engine 当前 `getproxies` 为空且未使用 `ProxyHandler`，小请求时间差不能证明实际路由变化。大帧控制传输与短暂离线仅时间重叠，因果未证实，方案暂停。官方插件发行仍为 0.2.93，DSH 宿主现有安装 0.4.2 未改。

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

## 0.5.2 旧节点兼容边界

- Files 首次仍按现代协议探测。只有返回可识别的结构化 `bad_op` 时，客户端才将该设备的 list 能力归类为 legacy，并调用 Controller 已有的 `POST /api/devices/{device_id}/fs/list`；请求仅传 `{path}`，不会复用现代 `service_open`，也不会在任意错误后盲目二次回退。
- legacy 响应必须包含匹配的可选 `device_id`、字符串 `path` 和合法 entries；客户端只接收条目名称、路径和目录类型，并把 `writable` 固定为 `false`。该兼容层只恢复旧节点浏览，不声称恢复写入、上传、删除或重命名。
- 旧 Codeg 即使本机系统路由可达，也必须先存在 Controller 可信网络及设备成员映射。`mesh_networks` 与 `mesh_network_devices` 为空时，APP 明确阻止打开；系统路由或直接 URL 不能替代 Controller 授权关系。
- OIDC 恢复使用测试凭据文件启动引导，成功后只持久化加密会话。凭据文件、数据库哈希和回滚转储属于私有运行材料，不进入公开仓库。

## 编码四原则

1. 编码前思考：先核对实际行为，写明假设与权衡。
2. 简洁优先：用满足当前需求的最少结构实现。
3. 精准修改：只改与反馈直接相关的内容。
4. 目标驱动执行：定义成功标准并按对应层级验证。

## 2026-11-11 DESKTOP-LOCAL 0.5.2 候选验收边界

- 本次可见验收针对旁路部署 `D:\Tether\node-0.5.2-r11`：计划任务 `TetherNode` 为 Running，console 端口 18894；18893 只承担 OIDC 回调并在登录后释放。Hub 显示 DESKTOP-LOCAL online、`node_version=0.5.2`、心跳 0 秒。生产 `mesh_networks` 数量为 0。
- 本地桥通过 wrong token 401 / valid token 200 核对鉴权，当前策略为 `readonly`。
- 候选 APP OIDC authenticated 且 session 持久化；真实打开 DESKTOP-LOCAL DeepSeek Harness 工作区，输入框可见并可聚焦。没有发送聊天消息，因此这项证据不代表模型回复或对话链路已验收。
- 账户恢复范围仅为 Casdoor `tether/tether-owner` 凭据与尝试元数据重置；owner/name/id/subject 保留。不得在项目文档中写入密码、token 或用户邮箱。
- 机器证据与截图分别为 `.scratch/evidence/desktop-local-0.5.2-pass.json`、`.scratch/evidence/r11-desktop-local-dsh-0.5.2.png`。回滚备份位于 `D:\Tether\rollback\node-0.5.2-r11-20261111-033300-315` 和 `D:\Tether\rollback\node-0.5.2-r11-port18894-20261111-034104-043`。
- 验收范围不包含 REMOTESTITCH-HUB 与 LAPTOP-01（仍为 0.4.11）、生产 mesh 创建、Codeg（缺少 trusted network）、Settings/About 版本显示（仍为“—”）或签名公开 0.5.2。该结果仅是 DESKTOP-LOCAL 阶段性候选验收，不能作为项目完成或正式发布结论。

## 2026-11-11 REMOTESTITCH-HUB Node 0.5.2 旁路部署边界

- 候选目录 `/opt/tether-node/releases/0.5.2-r11`，独立 venv；状态 `/opt/tether-node/state-0.5.2-r11`；备份 `/opt/tether-node/backups/pre-0.5.2-r11-20261110T205700Z`；drop-in `90-0.5.2-r11.conf`。回退命令为 `.scratch/qa/deploy-remotestitch-node-0.5.2-r11.ps1 -Phase Rollback`。
- 服务 active/running、restart 0；console 18894 仅回环。Hub online / Node 0.5.2 / 心跳约 1 秒；生产 mesh 0。identity hash、full policy、allowed roots、DSH web/gateway 原 PID 与 HTTP 401 基线保持；最近日志无 Node 错误。
- APP 选择 `REMOTESTITCH-HUB` 后，虽短暂出现读取失败/加载态，等待后真实显示 DeepSeek Harness 工作区 `tether-dsh-qa.BfHzqlTT` 和输入框。Terra 聚焦输入框并观察约 10 秒稳定；没有输入或发送。证据：`.scratch/evidence/r11-remotestitch-hub-dsh-0.5.2-pass.png` 与 `.scratch/evidence/remotestitch-hub-0.5.2-pass.json`。
- 该阶段仅验收 Node 与 DSH。Node 重启后旧 Codeg 子进程未恢复；Codeg 另受 trusted network 缺失阻塞。LAPTOP-01 仍为 0.4.11，生产 mesh 为 0，Settings/About 版本仍为“—”，无签名公开 0.5.2。测试为 63 passed / 1 skipped / 2 failed；失败是旧精确相等断言未计入新增 `app_update` 字段，故不宣称全绿或项目完成。

