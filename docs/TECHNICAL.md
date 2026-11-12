# Tether 技术说明

## 2026-11-13 原生项目入口约束

- F163 的项目上下文使用现有 `WorkbenchRoute.requestedProjectId`，没有显式选择时回退到当前会话的原生文件夹；Agent Home 不再维护本地项目 ID，也不渲染项目列。原生项目名选择项目，原有箭头独立折叠；打开文件夹与 launcher 事件进入 Agent Home，只有结构化动作才建草稿。
- 返回终端主页时保留侧栏选择；进入实际历史会话时清除显式选择，使 Home 跟随该会话项目。首次全新草稿和复用草稿都必须保留同一 `forceAgentSelection` 标记。实际验收按两个项目、无已有草稿、已有历史会话分别执行；聚焦单元测试与真实 APP 结果分别记录。

## 2026-11-12 业务恢复

- F162 私网模式入口：真实 guest 是普通 HTTP 私网 origin，浏览器只提供 `crypto.getRandomValues`，没有仅限安全上下文的 `crypto.randomUUID`。Home 两个点击回调在创建请求 ID 时先抛 TypeError，故没有 hash 导航、终端 API 请求或 PTY。上游已有 `@/lib/utils.randomUUID`，其他 Codeg context/HTTP 预览正在使用；复用该函数即可，不加依赖/新生成器或降低浏览器安全设置。回归须显式移除原生 randomUUID，分别验证 Herdr/CLI 的固定字段与请求 ID。
- Node 首跳验收：当前实际旧 0.5.2 updater/CLI 没有 commit 方法，首次升级保留传统 backup 并清 prepared，Node 重启后 current/runtime=0.5.4、restart_required=false，status.transaction=null。不能仅凭本地最新源码推断运行旧端会生成事务。QA verify 原来直接调用被主进程禁止的 `/dsh/surface`，已移除此错误探针，保留真实 service_catalog 与 fs/dsh_status；该 API 必须走产品既有受信任工作台入口。CDP helper 同时补检查 exceptionDetails，避免把受拒绝调用读成 HTTP 0。

- F158/F159：目标旧静态文件已以实际服务目录为边界替换并逐项校验，原 24 项目/167 会话不变。项目/标签新建均进入项目→Agent 主页，选定 Agent 的结构化草稿保留原生 ChatInput 并隐藏上游欢迎模板；工作台首次空快照路由由独立同步组件处理。APP 主进程已准备的 guest 在重挂载时不会再走 token 页，因此 `openNativeCodeg` 仅对本次 pane 的 service 副本指定 `/workspace?tether_home=1`；不改主进程 descriptor、认证或会话返回路径。空 header 仅在有控件时渲染，真实 guest/main y=40 对齐。当前安装 UI SHA `91A78B69F46FBC600737A569EC3F55E6BFF6D0FFEE66D3521E77A4F0E2F6D931`。
- F160：DSH 0.2.1-rc.5 的 `directory-picker` auto 默认选 native，NativeDirectoryFlow 不渲染页面弹窗而调用目标机器 OS。在原 desktop profile 的 Cordis patch 禁用稳定 auto row，插入官方 `@deepseek-ai/dsh-host-directory-picker-browse` 与 `@deepseek-ai/dsh-client-ui-directory-picker-browse`，使用默认配置；不修改原生 vendor bundle、不覆写 Tether 0.4.1 插件。原 profile 790 B/原 SHA `b863843b...` 已原位备份，追加后 SHA `aac510d0...`，原字节前缀、owner 与 ACL 均保持。Host HMR 处理配置后仅重载对应 guest，fresh boot 读到 browse client；页面目录弹窗→创建/选择专属 QA 目录→注册 dsh workspace 的实际链路通过。原 Host PID8244 保留；下一次普通 Host 重启仍需随常规回归确认持久配置加载。

- F157 登录保持：实际 Casdoor 桌面应用的 refresh 配置为 0，最新续期 JWT 与访问凭据同为 8 小时，已到期；旧客户端将任意刷新失败删除加密文件。仅将 `admin/tether-desktop` 的 refresh 窗口改为 720 小时，逐字段比对确认其他应用配置未变，原行服务器 mode-600 备份保留。客户端增加单飞续期、轮换后原子保存、临时失败保留/可重试、退出时的代际检查；主进程在状态读取/请求前确保会话有效，UI 在可重试状态保留数据并 15 秒后恢复。主代理独立 37 项 OIDC/集成与 12 项 workflow 测试通过，互联图函数与 E 原基线逐字节相同；真实登录、普通重开和过期路径验收待当前安装包补丁应用后进行。修补发行版为 0.5.4，保留 0.5.3 已发布资产。

- 最新正式安装检查点：四平台最终源 `70520a4` / CI `43149948092`，已发布 `v0.5.3-preview.1`。原始 Windows NSIS 第二次安装 exit 0，`D:\Apps\Tether\Tether.exe` / HKCU 登记为 0.5.3。真实旧 0.5.0 登记先导出再单值接管，旧程序保留；三个旧快捷方式备份后改指向正式 EXE。默认 C profile/18892 实际 info=0.5.3 / DESKTOP-LOCAL、Hub health/state 200，白名单八项布局偏好通过 CDP 迁移；没有复制 Node 凭据。PID 7992 随后出现 Error 窗口、CDP 挂起，原因尚未取得错误正文；该次启动使用了已退出父进程的重定向标准流，属于待核实因素。后台重启动作被自动审批拒绝、未执行，已请用户手动重开。不能标记稳定运行或自动 apply 成功。下文 11:37/09 点候选记录为历史。

- 11:37 后续状态优先于下方 09 点记录：CLI 共享链路已部署，运行 bundle 为 `E709FBA94A31E6E22A716D97D96A5CD3BCD0C9C4B54C59ADE4C0C095376A3D58`。typed Herdr / CLI 各 HTTP 200、返回 PTY 且持续存活，停止成功；脱敏证据 `.scratch/qa/herdr-agent-cli-final-acceptance-20261112.json`。当前候选主进程 22460，用标准 `C:\Users\Administrator\AppData\Roaming\Tether\data` profile 临时运行，仍不是正常安装更新通过。
- 实测公开 0.5.2 EXE 为 portable，`/S /D` 未安装而在临时目录运行；两个本轮临时进程已精确停止。真正原因是 `build-candidate.mjs` 的 Windows 参数覆盖配置为 portable，需将真实参数改为 NSIS。`--prepackaged` 不触发正常 afterPack，不能假定它自动生成 updater metadata。
- `hasExistingIdentity` 增加明确 OIDC + external + 有效 Hub origin + 非空 device 的已初始化 profile 路径，不要求 Node credential 或登录 session；允许登出后再次启动。它仅跳过旧目录迁移，真实认证不变；未知/缺字段 profile 仍被拒绝合并。对应行为测试通过。

- 普通 APP 的 Files 请求恢复到既有 OAuth Hub `fs/*` API，移除 app.js 中另行改道到未配齐 Caddy/EasyTier files service 的拦截。Monaco、目录树及权限/版本冲突语义保留；native Files IPC 留给明确的独立调用方。
- 传输页复用满意版 transferFile/Croc 实现。普通 OAuth APP 的 `hubOnly` 只用已授权的 read/write_chunk，禁用 renderer raw/direct 与 Croc 操作；取消停止后续分块，不宣称目标残片已清理。真实传输及 UI 证据见业务恢复计划。
- 本机 Node 受控激活复用现有 staged runtime，保留 DSH_HOME、workspace roots、identity 与 policy。readonly 模式仍允许既有允许根与 DSH 注册工作区写入，不应仅凭模式文字推断不可编辑，更未改成全盘写。
- Codeg 在主进程中复用既有隔离 token gateway。同机仍按本机身份门禁；远端现代目录只有在 fresh 已鉴权快照确认目标在线、自有、私网地址与本机 EasyTier 同网段，且没有共同 ready network 时才走既有兼容路径；共同 ready network、非自有或共享设备继续原 service_open。不是 service_open 失败后的泛化回退。严格 token URL/host、隔离 session、actor generation 与 origin guard 保留。
- 09:26 APP 已部署 owned-device 兼容 ASAR，SHA-256 `DC3AF16FB2C9F2D547321E43C2C42EF1F15184A862EA8327E9FD3CC6F426C71A`，379 成员/305 文件，主代理独立比较仅 native-workbench.js 变化；当前主进程 PID 50948，使用原数据和账号。统一入口 bundle SHA-256 `91DF01D67278DFA38ECD8A967D414AC658D861B8E528AD8346C2F102CBF55808`。客户端“关于”实测为 0.5.2；不能据此声称完整安装发行版或普通更新链路通过。
- Herdr 选择沿用 Agents Runtime 的 canonical enabled/available/env，Node Registry 只补充已存在 vendor CLI 路径；不作为第二重启用门禁。09:30 本机两个 Node 模块已部署且主代理独立核对源/运行文件 SHA 一致。Herdr capability 为 true，但 Codex QA 启动在约 7 秒返回 agent_start_failed，未达 ready，尚待诊断；没有发送模型 prompt。
- Laptop 切换 wrapper 显式复用旧 node-local.db，实际新 Node --db、CODEG_DATA_DIR、端口和 24 项目/167 会话都与旧基线匹配，没有复制 SQLite。该次确认脚本失败，ERROR 状态替换丢失 start_attempt_utc 又导致 StrictMode 回退异常；仅在候选 Codeg 已停的条件下备份并补回空字段，复用原 helper 完成 ROLLED_BACK。原 launcher SHA/ACL、0.4.11 Node、旧 Codeg 与 24/167 基线已恢复；不能把该迁移当成普通更新成功。
- 传统 CLI 补充链路已实现并通过定向测试/构建：Home 只发无凭据的 open_cli hash，外层沿现有 origin/main-frame/固定参数校验路由到设备绑定 TerminalDock；新 Node capability 声明理解 runtime_agent_type，每次仍通过已鉴权的 Codeg catalog 读取 enabled/available/env，Node Registry 仅用于缺少 vendor 路径时的查找。旧 Node 不支持时明确拒绝。此补充尚未部署，不能声称三种模式均实机通过。

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
- 现代 mesh Codeg 路由必须使用 Controller 已授权的 mesh 成员映射。旧 Codeg 可沿兼容路径使用已认证 `/api/state` 中目标在线设备的 `capabilities.direct_api.host`，但只有当它严格匹配 runtime token URL 主机、且本机现存 EasyTier 私网接口与目标同网段时才准许；APP 仍使用专用隔离 session、主进程 token bootstrap 和同源请求守卫。普通系统路由或任意直接 URL 不能替代这些授权与主机匹配条件。此兼容路径不创建生产 mesh 记录。
- 有效 `service_catalog` 的现代 Codeg 仍走现代 `service_open` 授权。2026-11-11 APP source identity 一度回退为 hostname `USER-20250925JD` 并产生 HTTP 403；QA launcher 已使用本地 Node 现有 identity `DESKTOP-LOCAL`。以修正身份进行的已鉴权 `service_open` 明确返回 HTTP 409 `edge_not_connected`：REMOTESTITCH-HUB 未配置 native edge/mesh，请求未进入目标服务启动阶段；不创建 mesh、不改权限、不转 legacy 直连。
- OIDC Electron APP 的 `NativeSurface` 对任何目标（含本机 Node identity）都优先调用主进程 `workbench.openDshSurface` managed gateway；不因本机身份相等而让 renderer 带 OAuth 状态直接请求 Hub，避免 CORS/重定向登录失败。隔离 service session 与既有 main-owned bootstrap/origin guard 保持不变。2026-11-11 bundle 已部署至 r11，源码和候选 SHA-256 均为 `3EECB0F259E3FCB00462336A6710E79AAAED301883D5640D93E6C838CA174665`；未修改 Node。
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


## 2026-11-11 Codeg 原生主页构建与候选 readiness 修复

- Codeg 原生 Agent 主页静态构建已部署到 LAPTOP-01 默认 agents-runtime/web，1007 个文件；index/workspace/token 的服务响应与构建输出 SHA-256 一致。部署保留最初旧 web 回退目录；最终实机验收后清理了本次创建的中间 web 回退树。未重启 Codeg server、Node 或 APP。
- 首次实机打开显示原生 Agent 页，但外层 Tether 遮罩持续 loading：webview 在监听注册前已完成导航，did-finish-load 被漏接。修复在注册后读取一次 URL/origin 与 isLoadingMainFrame 快照；did-start-navigation 忽略 isInPlace 同文档导航，保留主框架导航/失败事件。
- 主进程在严格验证状态 URL 后，仅给内部 token bootstrap URL 副本附加固定 `next=/workspace?tether_home=1`；外部输入验证、origin 守卫与 token 不暴露给 renderer 的约束不变。focused tests 21/21 通过，r11 候选 app.asar 与 tether-ui/web/dist/app.js 已更新并启动为 PID 9996；hash 分别为 `697F5F220B33EC8299C5B0352A34FA447390646C82F5DBBEA19FC8498A13CDD4`、`41A4EB2636D247974127D2A9D7928A3DEFC3530CE2C1C3FD28C42FB362C75381`。Terra 已通过遮罩、原生左栏/聊天区拖动和 Codex nonce 往返保留验收；关闭后重开默认原生 Agent 页已通过；Codeg 内文件编辑器分隔条已在只读 QA 文本文件视图中实测 x=810→690→810（accessibility value 56→41→56），未输入或保存。
- Electron `did-start-navigation` 的 `isInPlace` 事件语义参考：[webview-tag API](https://www.electronjs.org/docs/latest/api/webview-tag#event-did-start-navigation)。

## 2026-11-11 Codeg Agent 主页原生接入（源码阶段）

- Agent 主页使用 Codeg 已有 WorkbenchRouteContext 与 WorkspaceContent route registry，通过原生 SidebarNavButton 进入；标题条使用原生 WorkbenchPageTitle。页面动作复用 openNewConversationTab(..., { forceAgent }) / openChatModeTab({ forceAgent }) 和 openConversations()。	ether_home=1 只切换原生 route，外层 	ether:show-home 仅在 route owner 注册一次。
- 移除了每个 ConversationTabView 的固定主页覆盖层、重复 home 监听、250 ms 几何测量和 module-global 选择标记；移除了全局隐藏原生 tab、resize handle、分隔线和会话头的 CSS。原生分栏由框架现有 panel layout 管理。
- 当前仅完成 canonical source 和 tracked patch。clean source forward check 与 canonical source reverse check 通过；静态构建、部署和真实拖拽/缩放验收仍未完成。

- LAPTOP-01 静态根实机只读确认：TETHER_AGENTS_RUNTIME_DIR 为空；当前 codeg-server.exe 来自默认 gents-runtime 根，源码 _web_dir() 指向其 web 子目录；当前 index.html SHA-256 55092787645CFB0D3AEC200C1273CF46C1DE935B4E990D35C96D1AACB77ED3BE。探针终端已停止；只读证据见 .scratch/qa/codeg-runtime-static-path-laptop-20261111.json。

## 2026-11-12 互联图 NetworkGraph 恢复

- 原因：当前 worktree 的 `NetworkGraph` 使用 Cytoscape 的 cose 单次布局并把像素坐标保存到 `tether.network.positions.v3`；E 主仓库的已调图使用 requestAnimationFrame 力导向、环形/三角初始分布并保存百分比位置和速度。用户确认需要恢复互联图原视觉。
- 仅将 `NetworkGraph` 函数替换为 E 主仓库原函数，删除其唯一 Cytoscape import；外围 renderNetwork 身份/权限/连接回调、详情浮层、连接管理以及 DSH/Codeg 相关修复保持。详情组件和连接管理函数的恢复前哈希分别在两树相同，未改。
- 首次旧图卸载前对 `localStorage['tether.network.positions.v3']` 的查询为 absent；随后卸载写入 214 B Cytoscape 像素位置，其中本机节点 `(0,0)`、远端 `(378,608)`，无 `vx/vy`。该值原样备份后，仅在当前值逐字等于备份时删除这一 key；其他存储未动，当前 key 已确认 absent。备份：`.scratch/qa/network-graph-cytoscape-pre-restore-20261112-source-app.js`、`...-running-app.js`。
- 用已安装 Node v24.22.1 执行 `scripts/build-web.mjs`，exit 0；输出 bundle SHA-256 `1CD2EF1A584AD76E9C1A42E089BB949640CB4E300E29D87C301B0313C5C6570D`。仅更新 r11 `resources/tether-ui/web/dist/app.js`；替换前文件 SHA `41A4EB2636D247974127D2A9D7928A3DEFC3530CE2C1C3FD28C42FB362C75381`，更新后与构建输出一致。PID 8016 继续运行；未改 app.asar、Codeg web/backend、Node 或设备身份/连接状态。已由 Terra 实机确认流动环形/三角、缩放、拖动、浮层和切页后位置正常；跨页速度连续未验证。
