# docs 变更记录
- 2026-11-12：补记 F157 服务端仅续期字段改为 720 小时且其他字段完全一致、客户端会话恢复/并发续期/临时失败处理、独立 37+12 项定向验证与原图函数无改动；记录 0.5.4 修补版及真实安装验收尚待进行。
- 2026-11-12 18 点：记录用户已手动重开正式版并解除 Error 阻塞；登记 F157 重复登录、现行 8 小时续期 JWT/失败清缓存证据和 30 天续期需求，作为恢复更新控制入口的优先依赖；原业务恢复与 Node 更新目标保留。
- 2026-11-12 14:18：记录同一正式 APP Error/控制入口阻塞再次确认；只结束本轮挂起的只读 QA 检查进程，未关闭或重启 APP、Node、DSH；保留待手动重开的后续更新与验收边界。
- 2026-11-12：补记云端唯一 node.env 的 preview 配置实际完成、原字节与文件元数据保留及备份位置；明确本机与云端均未重启，配置准备不等于 Node 更新成功。
- 2026-11-12：记录 Hub mirror 0.5.3 三制品准备、已验签清单内容比对、pin 备份切换和公开 version/pinned=0.5.3/stale=0 结果；记录桌面 Node preview/Hub URL 配置成功但未重启，以及云端 stable 默认通道原因和后续运行验收缺口。
- 2026-11-12：记录最终 0.5.3 四平台构建和 preview 发布、原始 NSIS 正式安装成功、旧登记与快捷方式备份接管、默认 profile/18892 首次 info/Hub 通过及八项布局迁移；明确随后 Error/接口挂起、后台重启被审批拒绝未执行、等待手动重开，以及 Node 来源不一致和 APP 自动 apply 仍未完成。
- 2026-11-12：记录 Laptop 迁移的实际 24/167 数据保留检查、控制脚本失败与完整回滚，明确当前仍为旧 0.4.11；补记传统 CLI 与 Herdr 共用 canonical Agent 配置的源码/构建通过及尚未部署边界。
- 2026-11-12：记录 owned-device Codeg 兼容 ASAR 实际部署、统一入口 bundle、Herdr 两模块激活与尚未 ready 的真实边界，以及 Laptop 旧 DB 复用/回退设计；普通更新包必须复用同一 CI 构建页面，不能带旧静态文件。
- 2026-11-12：补录统一 Agent 入口结构化真实回复、主页/原会话返回及通用新建入口验收；主代理复验原互联图拖拽、详情浮层与切页位置保持，记录 Laptop Prepare 完成但未 Switch，Herdr/传统 CLI/普通更新全链路仍待验收。
- 2026-11-12：PRD补齐保留原满意页面、文件业务、统一项目/Agent/模式入口、真实版本与回退要求；F155记录本机 Codeg 正常启动/打开实机结果，明确未把旧主页当新入口验收。
- 2026-11-12：F152/F153 记录实机互传、文本及 Python Monaco 保存与主代理独立读回证据；更新本机 Node 受控激活/DSH 保留、同机 Codeg 主进程部署及真实版本/更新边界。
- 2026-11-12：新增业务恢复计划，登记 F152–F156，分别记录传输、编辑器、统一 Agent、本机 Codeg 与更新实况的具体成功标准；恢复满意原版为视觉基线，不把构建/接口可达当作业务验收。
- 2026-11-11：仅同步 `PROGRESS.md`、`FEEDBACK.md`、`TECHNICAL.md` 与本 backlog 的当前真实状态：记录 E 盘 `.scratch` 清理及候选保留规则、DESKTOP-LOCAL 回滚至 Node 0.2.3 与 LAPTOP-01 DSH 恢复、Node/APP/Hub 更新事务门禁及 Hub 可回滚 release 部署；明确签名 preview、update source 0.5.2、真实设备 UI 端到端、成功截图与微信送达仍未完成，并将此前 DESKTOP-LOCAL 0.5.2 状态标为已回滚历史。记录 pytest exit 0 及既有 interpreter-shutdown 线程噪声。
- 2026-11-11：记录 REMOTESTITCH-HUB Node 0.5.2 r11 阶段性旁路部署、服务/身份/策略基线及 APP 内 DSH 可见聚焦验收；登记部署与回滚路径、截图/机器证据；更新旧节点待办为 REMOTESTITCH-HUB 已验收、LAPTOP-01 仍待升级；如实记录 63 passed / 1 skipped / 2 failed 及失败断言原因、Codeg/mesh/版本显示/签名发布缺口。
- 2026-11-10：回填 r2 UI 稳定性实机证据：在线 REMOTESTITCH-HUB 约 45 秒保持设备选择与旧节点兼容提示，新增日志无 CORS/404/HTTP 400 且主框架仅启动导航 1 次；记录截图路径、portable 大小/SHA-256、包内 UI bundle 一致性，以及旧工作区/Codeg 仍未完成的边界。
- 2026-11-10：记录节点 `service_catalog` 结构化 `bad_op` / `device_not_found` 的源码候选降级行为、Agents 禁止启动的状态提示及尚待测试/打包/界面验证的边界；不宣称节点或真机工作台通过。
- 2026-11-10：登记主人提供的 LAPTOP-01/REMOTESTITCH-HUB 旧 status/list 只读 HTTP 200 证据；明确下一步复用旧接口完成 legacy compatibility，当前 `legacy: true` catalog 仍全为 missing，不改 open 路径或要求整机重装。
- 2026-11-10：记录 packaged r5 portable 最终大小 823,711,922 字节与 SHA-256 `4674619ab9967f01371dfb25ae2b4a1d29be357d9ae9b7f45af88b0b28eebfaa`，保持 unsigned preview 边界。
- 2026-11-10：回填 0.5.2 packaged r5 原账号真实登录、4 台原设备读取和移除候选凭据环境变量后的重启免登录证据；记录重复 `Authorization` 与工作台绕开 OIDC 两个客户端根因、42 项定向测试，以及旧节点 `service_catalog` 的 `bad_op` / `device_not_found` 兼容阻塞。显式退出重登和 node2 DSH/Codeg 保持未完成。
- 2026-11-10：记录 0.5.2 visible login 的实现范围、25 项 Node 定向测试、两条冻结 `tether-python --help` 入口、Windows runtime、portable 冷启动和最终 SHA-256；补录正式 r7、Casdoor public client、dual audience、旧 web/旧 Bearer 兼容、4 条设备记录与 DESKTOP 稳定心跳证据。F149 继续把主人真实登录、原设备 UI、会话持久化和 node2 工作台列为未完成。
- 2026-11-07：登记 0.4.10 候选与真实生产状态：主机 APP/Node、cloud Node 为 0.4.9，Laptop APP/Node 仍 0.4.7 且旧任务因 device_offline 结束；记录状态快照保护回归及下载、目录缓存、代理/relay待验边界。
- 2026-11-07：登记 0.4.9 候选与当前生产边界：主机 APP+Node、cloud Node 已正常安装 0.4.8，Laptop 仍在线 0.4.7 且旧 job 以 update_timeout 结束；标记 proxy/relay 重读、048 目录屏幕复验和多 Agent 全流程仍待验。
- 2026-11-07：登记 0.4.8 源码候选的远端更新上下文、缓存失败反馈和 Croc 本机路径探索修复，保持现网 0.4.7 与待分发候选的边界；记录真实生产 APP 的 Codex 父子只读委派闭环，明确跨引擎/远端复杂协作、手机和吞吐仍待验收。
- 2026-11-07：标明早期 ACP/多 Agent 方案和恢复门禁快照的适用范围，现行实现以 Codeg 运行时及当前进度为准；技术说明区分 DSH Host 与 Codeg/CLI 的执行权威，纠正旧 APP 发行状态和小内存 Node 的过渡软阈值，避免重复实施旧方案或恢复已淘汰配置。
- 2026-11-07：收口 0.4.7 实机 UI/更新验收：三 Node 与两 APP 均在线 0.4.7、无 `restart_required`；主机/LAPTOP 文件页、主机 DSH 和两端 Agents 基础渲染通过。记录多 Agent 全流程、手机真机、吞吐优化、远端更新后主页面跳回本机 DSH，以及空缓存请求失败时的潜在弱错误反馈风险。
- 2026-11-07：记录 LAPTOP-01 APP+Node 通过主机 APP 更新中心联合升级至 0.4.7，云端 Node 普通 RPC 升至 0.4.7；主机仍 APP 0.4.5/Node 0.4.6，待排查 `node_not_found`。记录远端更新结束后 APP 页面回到本机 DSH 的待修 UX。
- 2026-11-07：更新当前实机版本与 UI 验收边界：三 Node 0.4.6、主机 APP 0.4.5、笔记本 APP 0.4.6；记录 `restart_required` 未清、0.4.7 待构建、冻结插件 0.2.93 与 DSH 实装 0.4.2，并补充隔离空 profile 不作为 DSH 验收及主机已登录 APP 最短复验清单。
- 2026-11-07：设备网登录维护程序置于受保护安装目录，复用现有运行进程，未中断网络；原启动入口改为调用该系统维护任务。
- 2026-11-07：收口 0.4.5 真实安装：两台 APP、三台 Node 已升级；区分已完成的制品安装/普通 Node RPC 与仍待补齐的远程 APP 关联和图形界面一键验收。
- 2026-11-07：记录云端正常 RPC 更新的真实内存软阈值阻塞及无重启修复，并新增资源管理器跨设备遗留会话路径反馈。
- 2026-11-07：记录三台真实 Node 与主机 APP 的 0.4.4 升级、插件三组件契约保留、笔记本旧 APP 分离安装及设备网登录恢复；待验收项保持未完成。
- 2026-11-07：记录候选分支正式签名、原公钥本地验证、GitHub 构建产物实渲染，以及 Windows 真实启动后的 Hub 映射失败。
- 2026-11-07：更新 Codeg 从固定上游源码重建的说明，并记录候选签名与发行草稿的工作流分工。
- 2026-11-07：记录现网 Herdr 能力、旧节点项目启动门禁和云端隔离 Node 双项目实测。
- 2026-11-07：记录真实 APP 中 Codex → OpenCode 2.2.0 → 本机 Qwen 的委派和原生数据库核对，以及 OpenCode 1.x 的结构化兼容边界。
- 2026-11-07：记录 Agents 主页覆盖历史会话的修复、从侧栏重开父子会话，以及真实 Codex 父端委派本地测试 Agent 的验收。
- 2026-11-07：补记同一 SSH 服务的公网与 EasyTier 交替传输对照，以及隔离 EasyTier 客户端的协议测试。
- 2026-11-07：记录 Node 0.4.4 实包的 Ubuntu WSL 干净安装与 Bash PTY，更新 APP 确定性 ACP 委派证据和剩余实机验收。
- 2026-11-07：release workflow 支持 `release-candidate/vX.Y.Z` 生成未发布草稿，并在构建前校验补齐固定版 Herdr runtime。
- 2026-11-07：补记等尺寸公网 SSH 对照，以及确定性 ACP 经真实 APP 委派和父子记录落盘的证据。
- 2026-11-07：登记 0.4.4 本地候选源码与干净目录重建证据，补记云端同包双向吞吐、旧 CI 断流位置和线上安装镜像全量复测。
- 2026-11-07：同步三条稳定性反馈和插件验收门禁，登记两次 Codeg 界面试验的脚本错误及持久化记录。
- 2026-11-07：记录真实 APP 三目标 DSH 渲染、云端 DSH 阈值持久化、0.4.4 全量回归与更新器试装，纠正 Codeg composer 测试判据。
- 2026-11-07：记录云端 DSH 软阈值回收导致的 HTTP 挂起、无重启恢复与 guest 授权证据，补记云端 Herdr 两个真实项目和 Codeg 会话状态断点。
- 2026-11-07：补记现有私有 Croc relay 双向实测与方向差异。
- 2026-11-07：记录 APP 与 Node 0.4.4 预览试装、冻结插件原件复用、两台 Windows 的 DSH 输入区与 100 MiB 双向传输验收，以及云端和多 Agent 的剩余门禁。
- 2026-11-07：补充云端升级回退演练、冻结插件独立安装和 Codeg `@` 入口的实际证据。
- 2026-11-07：用两个新 Cookie 会话验证云端 DSH Web 授权，纠正只跟随跳转的 HTTP 探测误报。
- 2026-11-07：记录 APP 更新、DSH、直连测速、多 Agent 与冻结插件的候选验证和未完成的真机验收。
- 2026-11-07：明确 Codeg clean upstream 与 Tether source export 的差别、缺失的上游补丁链、编译清理项及 token 页面 postbuild。
- 2026-11-07：新增 Codeg Agents runtime 的上游 pin、cwd 补丁入口和静态构建复现说明。
- 2026-10-30：更新 F54/F61 与技术/进度文档，记录 0.2.29 候选在隔离真实 DSH Web Host + QA Node 上完成目标 picker、90B/4B 原生附件 chip 和 `00 ff 41 80` 原始 multipart 字节核对；注明无发送/模型调用，物理 LAPTOP-01 跨设备验收仍待完成，并附 Root 提供的本机截图位置。
- 2026-10-30：记录最终候选验证：24个Node测试文件187用例通过、bundle与共享源码一致、Web连续两次标准构建哈希相同；父代理复现的“安装后仍显示有更新”断言已转绿，真实设备验收仍未执行。
- 2026-10-30：记录连接/更新稳定性与小白安装要求，区分本地候选、真实两机验收和干净系统发行阻断项；未发布、未安装。
- 2026-10-30：登记客户端开发者版本 r2（tag `dev/client-auth-20261030-r2`，基于 0.2.28）：共享连接面板新增登录/修改密码/邀请码注册/配对码兑换；修改密码用当前 token 调 `/api/auth/password`，成功后换新 token；dev harness 对 dev Hub 实跑改密往返并恢复原密码，门禁 175 mjs/6 cjs/125 pytest；未发布正式版、未部署。
- 2026-10-30：登记客户端开发者版本 `dev/client-auth-20261030`（基于 0.2.28）：共享连接面板新增登录/邀请码注册/配对码兑换，登录 token 落 `localStorage['tether.hub']`，APP 接线并重建双 bundle；dev harness 对 dev Hub 实跑登录/邀请/配对，门禁 175 mjs/6 cjs/125 pytest；未发布正式版、未部署。
- 2026-10-30：0.2.28 已发布（tag → `e6ce3c0`、工作流 `40918330411`、资产/Hub 清单验签一致）；本机卡片强制刷新后 latest 统一 0.2.28，本地 0.2.24 插件一键待验收。
- 2026-10-30：登记 0.2.27 热修候选：刷新后统一 latest 快照、本地产品更新跳过已最新 Node、插件更新不再被 Node 检查失败阻断；待发布验收。
- 2026-10-30：0.2.26 已发布（tag → `89441d3`、工作流 `40913233051`、资产与 Hub 清单验签一致）；本地 profile 0.2.24 / updater 0.2.26 已准备一键更新，待主人点击验收。
- 2026-10-29：v0.2.25 正式发布：tag `v0.2.25` → `ed49c23`，工作流 `40898090981`，资产 app 1,654,227 B / node 73,521 B / plugin 1,298,504 B；草案与 Hub 清单均验签、大小/SHA 一致；Hub 在 15:13:02Z 返回 0.2.25；两机更新验收待主人执行后回填。
- 2026-10-29：主人认可 F79 第五版，补充 0.2.25 发行说明并进入打包发布流程；发布、签名制品和两机安装状态必须按实际结果回填。
- 2026-10-29：记录 F79 第五版收口：删除行号区与代码区之间的人工分界线，保留 13px 留白，并用文件树 `#efeff1`、行号区 `#f7f7f8`、代码区白色恢复三层灰阶；18892 已打开真实 Python 文件量化复核，完整门禁 167 mjs/6 cjs/123 pytest，仍未发布。
- 2026-10-29：记录 F79 第四版修正：Monaco 行号栏加深并与代码区增加细分界线和 12px 留白，当前行背景不再覆盖行号栏；18892 已打开真实 Python 文件量化复核，完整门禁 167 mjs/6 cjs/123 pytest，仍未发布。
- 2026-10-29：记录 F79 第三版精修：资源树与行号栏色差加大、当前文件标签改为中性扩展名徽标、Monaco 装饰区加宽；18892 已在 DESKTOP-LOCAL 真实打开 JS 文件复核，完整门禁 167 mjs/6 cjs/123 pytest，仍未发布。
- 2026-10-29：记录 F79 第一版被驳回及第二版重做：工作台改为白灰黑中性层级，普通代码直接 Monaco、Markdown/表格才切换，常见语言与中性标签补齐；18892 真实打开 LAPTOP-01 远端 Python 文件，完整门禁 167 mjs/6 cjs/123 pytest，仍未发布。
- 2026-10-29：登记 F79 资源管理器视觉审查候选：VSCode 式分层色差工作台、无常驻硬分界线、Monaco minimap/状态栏与可见文件命令组；仓库版 18892 已供审查，门禁 166 mjs/6 cjs/123 pytest，仍未发布、未分发。
- 2026-10-29：接手修复 F75–F78（更新灯与卡片同源、跨节点旧节点响应兼容、Monaco 主题跟随宿主、本机 updater 缺 release/ed25519）；重建双 bundle 并重装 DSH，门禁 164 mjs/6 cjs/123 pytest；未发布、未分发。
- 2026-10-29：补录完整门禁与本机 P0 真实候选验收：源码 Node 连续 12.8 分钟无新 keepalive/断线/InvalidStateError，两台设备四次 node/plugin 显式检查成功；保留“尚未正式发布”的边界。
- 2026-10-29：登记 Monaco 编辑器、目标端文件版本/编码契约、DSH 本机/目标文件双入口与状态圆点候选；区分本机源码真机证据和 LAPTOP-01 尚未分发新 bundle 的验收边界。
- 2026-10-29：登记 P0 WebSocket 稳定性候选与 F73：区分 Hub/代理责任面证据、源码回归、公网 10 分钟只读观察和未部署边界；服务端、CI、tag、release 均未改。
- 2026-10-28：记录 v0.2.13 已发布（PR #7、CI `40667788605`、三 ZIP 与 manifest 校验），并区分隔离 Electron 刷新/Toast 动态验收和主人两机安装验收待办。
- 2026-10-28：将根版本清单、Python 包、APP 与四个插件包版本元数据准备到 `0.2.12`；不生成客户端 bundle，发布与安装仍待 release gate。
- 2026-10-28：记录目标设备附件候选改用 DSH `workspaceFiles` 的 session scope、capability 与自动回归；真实 Host Remote 注入/跨设备验收待完成。
- 2026-10-28：将公开组件元数据版本统一升级到 `0.2.11`；版本为发行候选，不表示已安装或发布。
- 2026-10-28：登记 F57（运行 DSH profile 插件仍为旧版）与 F58（桌面本机 Node 状态未知、原生工作区空白）问题；均保持待验收，不预判根因。
- 2026-10-28：记录 v0.2.10 发布验证与 LAPTOP-01 远程 APP 实机更新、重启、重连及数据保留证据；关闭 F56，并保留 v0.2.9 helper 超时历史。
- 2026-10-28：记录 v0.2.9 笔记本 APP 重启超时，以及 v0.2.10 Explorer helper 候选和待验收边界。
- 2026-10-28：记录 v0.2.9 笔记本 APP 实际重启失败与数据未变快照；更新 v0.2.10 Explorer wrapper 修复候选状态。
- 2026-10-28：更新 v0.2.9 发布与 Hub 部署、DESKTOP-LOCAL APP 自动重启证据；记录 LAPTOP-01 Node/插件已更新而 APP 尚待闭环。
- 2026-10-28：记录远程 APP 更新实现、自动重启与重连 UI 闭环；真实 LAPTOP-01 更新与数据哈希核验仍待执行。

## 2026-10-28 v0.2.4 性能批次

- 分段测量公网 Hub：`state` 110–541 ms、`workspaces` 297–646 ms、非空目录 `fs/list` 264–681 ms、文本预览 261–604 ms、PPTX 预览 5311–5610 ms。
- 修复：APP 本机文件请求经 `/local-api`/APP 网关直连 Node console（实测 3–4 ms）；UI 目录/工作区缓存、悬停预取、请求去重、AbortController 停止；预览不再重载父目录；设备切换增加 `projectsDevice` 门禁；悬浮卡替换原生 `title`；Office 按路径+mtime+大小缓存 PDF（二次 5 ms）；Node WS 的 `fs_call`/`dsh_call` 并发化，避免被 DSH 轮询阻塞。
- 版本统一 `0.2.4`；Python 83 passed/1 skipped，JavaScript 70 passed。发布、APP/Node 安装与双机复验仍按 PROGRESS/FEEDBACK 的 F30/F38–F45 跟踪。

## 2026-10-28 远端 surface 复现

- 非默认测试 Node（同机）走同一公网 Hub：v0.2.1 时远端原生 DSH 页白屏；升级 Node 到 v0.2.3 后正常加载，并从远端视图执行 `Reply with exactly REMOTE-OK.` → `REMOTE-OK`。
- 说明远端/本地走同一条 Hub surface gateway，白屏由旧 Node 代码导致；物理 LAPTOP-01 仍待 v0.2.3 上线验收。

## 2026-10-28 README 展示页与下载/版本管理重写

- 重写 README：hero/badges、Why、架构、组件与独立安装矩阵、Node 说明、下载与校验、版本/兼容、更新、Tailscale 边界、安全现状、状态、开发与发布流程。
- 明确 APP/插件可独立连接 Hub，但插件单独不能作为被控目标；Node 是目标设备执行器；生产路径不需要 Tailscale。
- 更新 `scripts/build_release.py` 内三个 ZIP 的安装说明，下一次发布生效；不重建已发布的 v0.2.3 资产。
- 记录远程目标 native surface 白屏为开放问题，登录/账户/多租户隔离未实现。
- 修正独立安装矩阵：v0.2.3 的 APP-only 不包含 DSH surface 插件，只能作为文件/命令目标；补充两产品（APP+Node / 插件+Node）、共享 runtime、账户/管理后台 Roadmap。
- Roadmap 增加 HostAdapter/surface_kind 扩展边界与性能埋点（分段时延、p50/p95、增量事件、文件 range/cache/preview），为后续 Herder/终端类 Host 和状态/文件优化预留入口。

## 2026-10-28 v0.2.3 更新器修复

- `update-helper` 重启 APP 时使用 `windowsHide: false`，修复自更新后新窗口不可见。
- `apply` 成功后删除 prepared；`status` 忽略不高于当前版本的 prepared 记录。
- APP/Node 写 `version.json` 时保留 DSH profile 中实际安装的插件版本。
- Python 78 passed/1 skipped；JavaScript 62 passed。

## 2026-10-28 v0.2.2 修复与发布准备

- APP 首次 bootstrap：修正 PowerShell 变量大小写冲突导致的 venv 空装，增加解释器可见性重试、依赖导入校验与 `bootstrap.log`。
- Node：`active_profile()` 在 descriptor 缺失或无 profile 时从 DSH Host argv 推断 profile，远程插件更新不再被 `plugin_profile_unknown` 阻塞。
- Surface 插件：RPC 注册失败不阻断 descriptor 发布；profile 从 Host argv 解析。
- 客户端本机插件更新通道不可用时给出明确降级提示。
- 版本统一 `0.2.2`；Python 76 passed/1 skipped，JavaScript 62 passed；v0.2.2 干净 bootstrap 在临时目录通过。
- 2026-10-28：APP/Node/插件通过 APP 更新中心完成 `0.2.1→0.2.2→0.2.3` 真实升级，数据保留；APP 与 DSH 插件原生工作区加载成功。遗留：重启标签不清、根 `version.json` 插件字段仍为 0.2.2、DSH 本机插件更新按钮仍报检查失败。
- 2026-10-28：同设备 APP/插件共享 DESKTOP-LOCAL 同一 DSH Host/会话；`OK`/`SYNC` 回合、`pwsh` 命令与文件页一致；两端互联页本机置顶；LAPTOP-01 离线，跨机待验收。

## 2026-10-28 本机 v0.2.1 基线安装

- DESKTOP-LOCAL 从三份独立 ZIP 安装 APP/插件/Node `0.2.1`；APP 更新中心显示 APP/Node 已是最新。
- 旧 Hub 配置、节点数据库、工作区与 DSH 会话保留；APP supervisor 启动唯一 DESKTOP-LOCAL 节点。
- 发现并记录真实缺陷：APP 首次 bootstrap 空 venv、插件 surface descriptor 未发布、插件本机更新检查 405；作为下一版本修复，不勾选 F28/F30。

## 2026-10-28 v0.2.1 发布收尾

- 更新 README、PRD、PROGRESS、FEEDBACK、TECHNICAL 与 CORE_RECOVERY_PLAN，区分已发布 ZIP 与尚未完成的安装、升级、远端更新、回滚和签名验收。
- 新增 RELEASES.md，简要记录 v0.2.1 制品和 commit、draft、检查、publish、下载核验流程。
- 更新 docs/description.md；仅改公开文档，未改代码或私有资料，未提交或推送。

## 2026-10-28 更新基础版本准备

- 明确先修复和验证更新页面、发布独立基础版本，再验证后续版本软件内升级的执行顺序；服务器接口及真实双机验收保持独立门禁。
- 记录更新页空白的测试桩根因、正常/异常数据下的隔离 Electron 验证及发布前兼容性修复；完整公开发布与真实更新仍按 F30 单独验收。
- 本地完整回归：Python 72 项通过、旧版制品回归 1 项跳过，JavaScript 60 项通过；隔离 Electron 正常/异常工作区场景可显示更新中心。基础版本尚待 GitHub 构建及制品检查。

## 2026-10-28

- 将公开管理文档压缩为当前需求、进度、反馈、技术边界和验收门禁。
- 旧反馈与详细恢复计划副本已归档到仓库外维护备份，并登记 SHA-256。
- 保留未发布、未安装、未完成跨设备验收等事实；不保留逐次操作记录和私有服务细节。
- 记录 F36/F37：本地与远端项目清理、服务端私有化及旧发行包撤下的完成边界；用户决定保留历史、保持仓库公开，不重写历史决定。
- 2026-10-28：F37 收尾：GitHub MCP 确认旧 v0.2.0 Release 的两个 ZIP 资产已删除、Release 说明为 withdrawn，tag 保留；F37 完成。F30 的新独立制品与更新端到端验收仍未完成。

# 2026-10-28 插件版本未知复验

- 记录真实 owner RPC 的 405 → 200、78 ms、运行/磁盘版本一致证据；区分本机补丁和正式发布，白屏事件流修复保持待验收。

# 2026-10-28 v0.2.11 真机收尾

- 记录 LAPTOP-01 三组件正式安装、APP 自动重启后 9047 ms 重连和数据保留证据；明确桌面/笔记本 DSH 运行版本差异、旧 D 盘安装审批阻塞、6 小时自动检查与自动安装的区别。

- 2026-10-28：记录 v0.2.14 发布（PR #8、CI `40688429123`、构建内强制验签）、私有 Hub `2b0a795` 部署与 latest-tag 解析修复、两机三组件 0.2.14 更新与重连/数据保留证据；同时登记插件宿主待重载（F69）与资源管理器/预览/跨机附件（F70–F72）。
- 2026-10-30：准备0.2.29本地候选元数据和发行记录；将隔离Host的真实附件链路、登录作用域/请求代次修复及更新竞态修复与物理LAPTOP-01未安装验收明确区分，CI签名和公开发布保持待执行。
- 2026-10-30：本地生成并离线检查0.2.29 unsigned APP/Plugin/Node归档，manifest中的三包版本、size、SHA-256均匹配；归档不含scratch、QA fixture或私有server源码，无签名。
- 2026-11-04：新增 `PROJECT-REPORT.md` 供外部 Codex 接手；该报告是快照与入口索引，不替代 PROGRESS/FEEDBACK/TECHNICAL 的事实所有权，结构化页复刻失败与验证缺口按报告第 6 节执行。
- 2026-11-07：将旧版交接快照移至本地清理归档。将插件回退候选、验收证据边界和 Codeg 源码入口收进 `PROGRESS.md`。
- 2026-11-10：记录 0.5.2 r4 旧节点 Files 只读兼容、OIDC 恢复、实机目录浏览截图、候选哈希与定向回归；明确 Codeg 仍受 Controller 可信网络缺失阻断，以及微信通知只有 SDK 返回而无手机回执。
- 2026-11-11：更新 `PROGRESS.md`、`FEEDBACK.md`、`TECHNICAL.md`，记录 DESKTOP-LOCAL 0.5.2 r11 的阶段性候选可见验收、证据/回滚位置及未完成门禁；不表示项目完成或签名公开发布。
- 2026-11-11：更新 `PROGRESS.md`、`FEEDBACK.md` 的旧 workspace/composer 截图边界说明，并记录 r11 native guest 布局修复已由当前候选真实刷新验证。
- 2026-11-11：更新 `FEEDBACK.md`、`PROGRESS.md`、`TECHNICAL.md`，记录旧 Codeg 经 authenticated direct_api + 现有 EasyTier 安全打开、Codex ACP adapter 实际安装版本与 LAPTOP-01 离线导致真实 nonce 未验收，以及原生 DSH guest 状态保持补丁的实机验收边界。
- 2026-11-11：补记 DESKTOP-LOCAL DSH 真实 `LOCAL-1111-1400` 回复及切换 Agents 后同会话原位保持截图；登记 REMOTESTITCH-HUB 现代 Codeg stopped 单次打开 HTTP 403 未捕获 structured code，不盲回退 legacy 路径。
- 2026-11-11：修正本次候选启动配置中的本机 source_device_id：以本机 Node `/state` 确认的 DESKTOP-LOCAL 为准，仅在 QA launcher 子进程设置 `TETHER_DEVICE`，不修改 Node/Hub identity。
- 2026-11-11：更正 REMOTESTITCH-HUB Codeg 待办根因：旧 hostname source identity 触发 403；修正为 DESKTOP-LOCAL 后，真实剩余门禁是 HTTP 409 `edge_not_connected`，无 native edge/mesh，不绕过或改变 Hub 授权。
- 2026-11-11：记录 Electron OIDC 本机 DSH 也经主进程 managed gateway 的单行 guard 修复；避免 renderer 直接 Hub OAuth/CORS，保留隔离授权边界。共享 bundle 与 r11 SHA-256 一致：`3EECB0F259E3FCB00462336A6710E79AAAED301883D5640D93E6C838CA174665`。
- 2026-11-11：记录最终实机验收图 `.scratch/evidence/desktop-local-delivery-final.png`：DESKTOP-LOCAL 的已有 DSH 回复在切 Agents 后返回仍原位可见；未再次发送模型请求。
- 2026-11-11：记录 Codeg Agent 主页原生 route 实现与验证边界：route/sidebar/title/tab 接线已进入 canonical source，fixed overlay、每 tab 重复事件与几何轮询、广域 resize 隐藏规则已移除；tracked patch 正向/反向 apply check 通过。构建、静态部署和真实 APP 调整大小验收待完成。

- 2026-11-11：更新 Codeg 原生主页实施计划、PROGRESS、FEEDBACK 和 TECHNICAL，记录原生路由/resize 实机证据、唯一 Codex nonce 回复、两轮静态部署与仍待复验的默认重开入口/文件编辑器分隔条。


- 2026-11-11：收尾 Codeg 原生 Agent 主页验收记录：关闭重开默认原生主页、既有 Codex nonce 会话返回与保留、真实文本编辑器分隔条拖动均通过；不重发消息，保留原始静态 web 回退。


- 2026-11-11：F150/F124 与原生 Codeg 主页计划验收结项；默认重开主页、真实 Codex 回复保留、主页/会话/编辑器分隔条拖动均通过。仅清理本次中间静态 web 回退树，保留最初 web 回退与当前部署。


- 2026-11-12：纠正互联图被 Cytoscape 取代的视觉回归：恢复已调好的流动环形/三角 NetworkGraph，只更新 r11 WebUI app.js；Terra 实机确认流动、布局、缩放、拖动、浮层和切页后位置正常。旧缓存仅在与备份逐字匹配时删除单一 key，保留原值备份；跨页速度连续未证明。
- 2026-11-12：记录 Herdr/CLI 共享配置 typed API 实测、标准 profile 复制与原图/登录保留；纠正公开 EXE 为 portable 的安装边界，记录 builder 实参覆盖及 external OIDC profile 重启修复，完整普通更新验收继续待办。
- 2026-11-12：记录本地 NSIS 验收基线安装被自动审批拒绝且未执行；保留当前可用候选，后续改用 CI 原始 0.5.3 安装包，不将被拒动作或基线生成计作自动更新通过。
