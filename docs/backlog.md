# docs 变更记录
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
