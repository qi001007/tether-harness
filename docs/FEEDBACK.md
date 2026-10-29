# 用户反馈与处理

本文只保留有效需求及当前验收状态。逐项实现过程和旧版状态记录已随维护清理归档；勾选以代码和对应层级的实际验证为准。

## 已完成的用户体验需求

- [x] 原生工作区入口、原生过程/工具层级、目标设备工作区与历史展示；已在本机 DSH 环境完成验证。
- [x] 文件资源管理器、权限入口、审计查看、设备切换与互联视图；本机功能验证已记录。
- [x] 工作区展示层级采用“自定义名称 → 实际目录名 → 内容”；保留“此电脑”磁盘树。
- [x] 统一侧栏排版、间距、交互目标和状态提示。

以上记录不代表跨设备、干净安装或模型附件传输已验收。

## 当前待办

- [x] F79：资源管理器需要达到明显可辨的 VSCode 式工作台体验。第一版蓝色渐变/蓝色状态条、弱语法着色、粗糙标签页及普通代码也显示视图切换，被主人驳回。第二版改为白灰黑中性层级，删除手写高亮旁路，代码与 Markdown 编辑统一走 Monaco，补齐常见语言注册；普通代码直接编辑且不显示预览切换，只有 Markdown 与表格保留必要切换。第三版重做扩展名徽标页签，但仍误把“加宽装饰区”当作“代码与行号栏已有分界和留白”，被主人指出边界仍贴着代码，当前行背景还覆盖行号栏。第四版修正留白和当前行范围，但新增细线又违背了原本依靠色差分区的要求。第五版删除行号区与代码区之间的人工边线，保留 13px 白色留白；亮色三层调整为文件树 `#efeff1`、行号区 `#f7f7f8`、代码区 `#ffffff`，暗色行号区同步调整为 `#232325`。仓库版 18892 已在 DESKTOP-LOCAL 真实打开 `agent.py`，实测三层分别为 `rgb(239,239,241)`、`rgb(247,247,248)`、`rgb(255,255,255)`，留白层 13px 且左边框宽度为 0；活动行号背景透明、文字为 `rgb(41,41,41)`，当前行矩形只从代码区开始。主人已于 2026-10-29 明确认可第五版；0.2.25 已于 2026-10-29T15:12:25Z 正式发布（tag `v0.2.25` → `ed49c23`）。
- [x] F75：更新入口的灯必须与更新卡一致——卡片全“已是最新”时头部为绿色，只有可见卡确实失败才琥珀。实现：`updateTriggerState` 与设备卡共用同一分组口径（在线设备按 capability 取 node/plugin/app，known 优先于历史错误，离线设备不参与）；瞬时 `InvalidStateError`/网络错误重试一次，失败结果不进入 5 分钟缓存。实测：DESKTOP-LOCAL 与 LAPTOP-01 两卡“已是最新”、头部 `current` 绿色；DSH 面板同样为绿。同次重建让 native surface 去边线守卫生效：APP 原生工作区侧栏边缘像素由 `219,220,220` 变为底色 `249,250,251`。边界：已随 0.2.25 发布；LAPTOP-01 待一键更新后复验。
- [x] F76：打开其他节点文件不得误报“目标设备身份校验失败”。根因：旧节点（0.2.24）`fs/preview` 不返回 `device_id`，新 UI 硬性要求。实现：`responseBelongsToDevice` 在缺省时按旧节点放行、有值必须匹配，覆盖预览/保存/新建/重命名/stat。实测：LAPTOP-01 `D:\TetherWorkspaces\Tether-demo-check-1aba3266.txt` 打开成功，无错误 toast；证据 `.scratch/fix-remote-open.png`。边界：0.2.25 已发布；LAPTOP-01 待一键更新后复验 `version/editable` 字段。
- [x] F77：代码编辑器主题必须跟随宿主——亮色宿主 `tether-light`、暗色宿主 `tether-dark`，切换实时生效。实现：读 `body/html[data-ds-dark-theme]`，MutationObserver 调 `monaco.editor.setTheme`。实测：亮 `rgb(255,255,255)` → 加暗色标记 `rgb(13,17,23)` → 移除恢复；DSH 面板使用同一 bundle。边界：已随 0.2.25 发布。
- [x] F78：本机 DSH 更新卡必须显示真实版本，不得常红或 `插件 -(-)`。根因：源码安装的 `packages/tether-dsh-surface/updater` 缺 `tether/release.py`、`tether/ed25519.py`，而 `local-updates.js` 的 `UPDATER_FILES` 校验要求它们，导致每次检查都返回 `updater_missing`；发行 zip 由 `build_release.py` 从 `tether/` 补齐，所以只有本机源码安装中招。修复：补齐源码 updater 两文件，`install-plugin.ps1` 清单同步为七个文件；回归 `test_dsh_local_updates`/`test_release_archive`。实测：DSH 更新中心本机卡 `已是最新`、`插件 0.2.24(0.2.24)/Node 0.2.24(0.2.24)`，LAPTOP-01 也绿，顶部连接/更新均绿；证据 `.scratch/dsh-update-center-final2.png`。边界：已随 0.2.25 发布。
- [x] F73：修复 Node↔Hub WebSocket 在网络/代理切换窗口成串 keepalive timeout，并让更新检查不再因 closing socket 误报 `InvalidStateError`。源码候选已禁用控制面环境代理、绑定更新结果到原 WebSocket；公网直连 603.9 s 稳定。本机实验台源码 Node 于 15:46:09 重启，连续运行 12.8 分钟后无新 keepalive timeout、断线或 `InvalidStateError`，DESKTOP-LOCAL 与 LAPTOP-01 均 online；两台 node/plugin 四次显式检查均成功返回 0.2.24。已随 0.2.25 发布；服务端、Hub/Caddy 部署未改。
- [x] F66：分发链路双端发力——发布可被客户端与服务端同时确认，且具备成熟软件的防错。判据：①CI 缺签名密钥即失败、产物验签通过；②Hub `/releases/manifest` 返回签名清单且发布后 1 分钟内跟到新版本；③两机经更新接口升到 0.2.14，Node/APP 自动重启并重连；④会话与工作区数量不变。实测：CI `40688429123` 全绿并验签；Hub 返回 0.2.14 `sig=true`；DESKTOP-LOCAL 与 LAPTOP-01 均 `app=node=0.2.14`，重连 12 s / 6 s；桌面 3 工作区 12 会话、笔记本 2 工作区 1 会话，前后一致。
- [x] F67：APP 自更新不得在退出后因缺模块失败。根因：助手只暂存固定文件清单，`updates.py` 新增 `import .release` 后助手 `ModuleNotFoundError`。改为遍历整包暂存，回归用真实 `import tether.updates_cli` 覆盖。
- [ ] F68：所有加载/刷新图标必须绕自身圆心旋转。源码与回归已改（旋转 `<svg>` 自身，不再用 1em 外壳），0.2.14 已装两机；**待补**真机截图（更新中心刷新键、资源管理器加载键各一张）。
- [ ] F69：插件更新后宿主真正运行 0.2.14。现状：两台磁盘/profile/`file:` 源均 `0.2.14`，DSH 宿主内存仍为 `0.2.13`（宿主 18:58 启动、文件 20:46 替换）。判据：更新页出现“待生效/立即生效”，点击后 owner `pluginManager` 重载成功且运行版本为 `0.2.14`；`next/0.2.15` 已修 `runtime_version` 误读磁盘的问题。
- [ ] F70：资源管理器补齐 Windows 顶栏能力：前进/后退/上一级、刷新、新建文件与文件夹、剪切/复制/粘贴按钮、重命名/删除、排序/视图、搜索；快捷键 Ctrl+C/X/V/A、F2、Delete、Backspace、Alt+←/→；前进历史栈。判据：真机逐项可点可用并截图。
- [ ] F71：资源管理器代码编辑升级为 Monaco `0.57.0`，使用按“设备+路径”隔离的 model、Python/JS/CSS 等语言服务、行号/活动行、Cascadia/Consolas、亮暗主题、`Ctrl+S` 与目标路径状态栏。DESKTOP-LOCAL 的真实 WebUI 与 DSH 窗口已显示 Monaco；0.2.25 已发布，待 LAPTOP-01 一键更新后打开 `.py/.js/.css/.md` 做跨机截图验收。
- [ ] F72：原生对话“+”必须同时保留两条明确路径：原有“文件”选择操作者本机文件并上传给目标 DSH；新增“目标设备文件”从目标 DSH 会话工作区选择。源码/bundle 与 19 项共享回归已完成；LAPTOP-01 仍运行已发布 0.2.24 bundle，真宿主仅见旧“文件”；0.2.25 已发布，待 LAPTOP-01 一键更新后复验新菜单项和真实上传。
- [x] F74：资源管理器的新建、重命名、编辑必须直接作用于当前目标设备，而不是只改本机 UI。文件响应现在回传并核对 `device_id`；保存携带 SHA-256 `expected_version`、编码与换行风格，目标端被其他程序改写时返回 `conflict` 并保留未保存内容；打开文件时每 5 秒/窗口聚焦检查目标版本。DESKTOP-LOCAL 真实 API 已验证创建、保存后磁盘立即变化，外部改写后旧保存被拒绝且未覆盖目标内容。

- [x] F64：刷新按钮请求期间旋转并在请求结束后停止；错误 toast 4 秒自动消失；更新入口固定显示“更新”，以圆点表示可用更新或检查失败；附件测试改为检查仓库自己的注入契约。v0.2.13 已发布，源码回归及隔离 Electron 动态验收通过。隔离验收不替代实际设备验收。更新操作仍需由用户明确触发，不得自动安装或重启设备。
- [x] F65：两机安装与更新中心实机复验。v0.2.14 已经由更新接口安装到 DESKTOP-LOCAL 与 LAPTOP-01，三组件文件同版本、APP/Node 重启后自动重连（见 F66）。资源管理器与代码预览的观感复验转入 F70–F72 单独跟踪。

- [x] F66：本机连接页仍停在 `web boot: 1 entry did not activate`。根因不是插件坏：本机 surface 走公网 Hub，DSH 启动期从节点上行拉 MB 级包，核心资源在网关 30 s 截止点 502（含插件的组合包 825 KB gzip 也用了 14 s）；直连 `127.0.0.1` 约 1 s。修复：本机设备的 `/dsh/surface` 走节点回环 console（新增该路由返回 `?token=` 地址），UI 接受同机 token URL 且不再误判为“Hub loopback 网关”；插件端（DSH 面板）原先仍从 Hub 取描述符，DSH 重启后节点重放旧 Cookie，面板显示 `dsh web authentication required`——现在 `createDshHost.surfaceBase` 对本地设备先走 18892 快路径（失败回退 Hub），节点遇 401/403 清空 jar 重新登录并重放一次。判据：dev APP 的 iframe 指向 `127.0.0.1:<dsh-port>/?token=…&tether_native=1`，首屏无 HARNESS 失败页；DSH 面板内层 iframe 同样指向本机 token 地址且显示工作区；143 JS + 6 cjs + 108 pytest 全绿。证据：`E:/遥望科技实习项目/.overnight/t6-gateway.png`（修复前 502）、`t6-app-connected.png`、`t7-plugin-surface.png`、`apps/tether-app/data/app.log`。
- [x] F67：更新中心版本行随检查/刷新漂移且夹汉字。改为固定模板：`APP X(Y)/Node X(Y)` 与 `插件 X(Y)/Node X(Y)`，括号内为该组件各自的最新版本；本地与其他设备同格式，删除“当前 / · 最新 /（已安装…待生效）”。判据：dev APP 显示 `APP 0.2.16(0.2.15)/Node 0.2.16(0.2.15)`；DSH 插件面板显示 `插件 0.2.16(0.2.15)/Node 0.2.16(0.2.15)`；源码断言无旧文案。证据：`E:/遥望科技实习项目/.overnight/t6-update-panel.png`、`t6-dsh-plugin.png`。
- [x] F68：相邻色块之间的 1px 分界线改成色差；代码页行号栏要一直延伸到页面底部；语法配色改成蓝/绿/黑/紫，红色只留给报错。修复：树/详情栏、代码行号、标签栏、表格状态栏的硬边框全部去掉，分隔条只在悬停/拖动时显蓝色把手；行号改为独立满高列（真机实测 755px 视口下 755px）；关键字 `#1a5fb4`、字符串 `#2f855a`、数字 `#6b46c1`、注释灰（暗色 `#7aa2f7/#9ece6a/#bb9af7`）。判据：截图中无硬分界线；`getComputedStyle` 实测三种 token 颜色正确；147 JS 全绿。证据：`.overnight/t8-code-page.png`、`.overnight/t8-table-edit.png`。
- [x] F69：资源管理器里的代码文件要能编辑并保存，快捷键要像 VSCode（至少撤销）。修复：`text`/`markdown` 均可进入编辑；代码编辑态带同步行号槽、Tab 插入两空格、`Ctrl+S` 保存、原生 `Ctrl+Z/Y` 撤销重做；有未保存改动时关闭/切换文件先确认。判据：真机插入 `# edited` → `Ctrl+Z` 回退 → 插入 `# saved` → `Ctrl+S`，磁盘文件首行变为 `# saved`。证据：`.overnight/t8-code-edit.png`。
- [x] F70：CSV 与表格要能修改。修复：`.csv`/`.tsv` 表格单元格与表头可直接编辑，`Ctrl+S` 按 RFC4180 重新序列化（引号/逗号/换行/双引号），保留原换行风格；`.xlsx` 无写入器，保持只读；截断过的文件禁用表格编辑避免丢数据。判据：真机在 `demo.csv` 单元格写入 `X` 并 `Ctrl+S`，磁盘变为 `XAlice,...`，原有引号字段保持不变。证据：`.overnight/t8-table-edit.png`。
- [x] F71：资源管理器里快速双击文件夹偶发“目录读取失败”，必须点重试；刷新时顶部插入“正在刷新…”行会把列表往下挤、闪一下。根因：单击触发的目录预取 Promise 解析成 `undefined`，双击的 `loadDir` 复用它当响应（与 T2 预览首开同型）。修复：预取 Promise 返回响应体，`loadDir` 在复用值为空时回退到带重试的请求；加载改为覆盖式居中转圈，列表不位移（实测加载前后头部 top 均为 78px）。判据：注入 400ms `fs/list` 延迟后 50ms 内双击 folderA 直接进入、无错误；149 JS 全绿。证据：`.overnight/t8-loading.png`、`.overnight/t8-folder-open.png`。

- [ ] F63：旧快捷方式启动旧安装版，可能再次出现版本回退。`D:\Tether\app` 的 APP/Node 仍 `0.2.9`，运行中的桌面开发 APP/Node 为 `0.2.11`。已备好精确进程/活动门禁、配置摘要与回退备份保护的升级脚本，但自动审批因用量限制无法完成，命令未执行；保持待处理。
- F59 补充实测：桌面运行/安装插件均 `0.2.11`，真实 owner RPC 为 HTTP 200；LAPTOP-01 安装文件已 `0.2.11`，旧 DSH Host 仍 HTTP 405，待加载新宿主代码。远程 APP/Node 自动重启不能替代 DSH 插件宿主重启验收。
- F60 补充实测：LAPTOP-01 升级 `0.2.11` 后，三组件检查 797–1250 ms，当前版本查询 781–1266 ms。5 分钟 UI 检查缓存与强制刷新已发布；现有自动检查周期为 6 小时，自动检查不会下载安装。

- [ ] F60：更新中心检查慢和长期“检查中”。候选已拆开 Node 读状态与下载/安装长锁；增加 manifest singleflight/4 秒超时和 UI 5 分钟缓存/6–6.5 秒失败收敛。桌面真实 status 为 281–500 ms；候选待正式发行与双机 UI 验收。
- [ ] F61：原生对话目标设备附件选择器候选代码使用 owner-only RPC 身份与 DSH `workspaceFiles` 会话作用域 API，将原始字节交给原生 `onAddFiles(File[])`。自动回归仍需随更新后重跑；尚未验证安装 Host 的 API 注入、原生窗口及真实上传。
- [x] F62：演示前开启文件管理写权限并验证即开即用。两设备 full 策略即时生效，无重启；跨机新建并读回成功，LAPTOP-01 往返 1250 ms。仅证明文件管理通道，未证明模型命令执行链路。

- [x] F56：通过桌面 APP 一键更新另一台设备的 APP、插件与 Node，并验证自动重启、重新连回和用户数据保留。v0.2.10 已在 LAPTOP-01 完成实机更新；三组件报告 `0.2.10`，APP 新进程启动，Hub 在 apply 响应后 25.159 秒内恢复在线（最后一次离线至在线 17.688 秒）。更新前后 `hub.json` SHA-256、会话数量和三个工作区树哈希一致。v0.2.9 自动重启 helper 超时作为历史失败记录保留。
- [ ] F57：DSH 插件安装后仍显示旧版三卡更新页，本机 `/tether-updates` status RPC 与远端插件更新状态也失败。已确认 profile 四个包为 `0.2.5`，实际 `file:` 源码根原为 `0.2.1`，所以只更新 profile 会在 DSH 重装时重新加载旧 UI；本地开发 Hub 也未提供 updates 路由。更新器已增加对该 `file:` 加载契约的漂移检测与同事务双路径更新回归，仍待安装版 DSH 重启后复验共享 UI、RPC、远端插件状态和原生工作区。
- [ ] F58：Tether Desktop `0.2.10` 本机产品卡的 Node 版本显示“未知”，原生 DSH 工作区空白；目标 LAPTOP-01 设备卡三组件 `0.2.10` 正常。当前 APP 管理 Node 控制台与 Hub/表面网关均有在线响应，但本机卡状态作用域和原生 iframe 地址/授权链路尚未定位。需在本地 DSH 插件更新并重启后，用 Electron 原生窗口和 DSH 原生页面分别复验；未确认根因前不改 Hub/服务端路由。
- [x] F59：新版插件更新中心仍显示“当前插件未知”。已修正 owner RPC 注册，并在 DESKTOP-LOCAL 验证 HTTP 200；LAPTOP-01 通过 owner `pluginManager.setPluginEnabled(id:'include:tether-dsh-surface', enabled:true)` 安全重载后返回 `application=applied`（HTTP 200，2141 ms），随即 `/tether-updates/status` 确认 current/runtime 均为 `0.2.11`，无需手动重启 DSH。证据：`maintenance/ui-regression.../laptop-official-plugin-reload.json`。

- [ ] F01：完成目标设备原生 Host 页面、真实会话发送与附件的跨设备验收。现有本机 Host 展示验证不覆盖旧节点升级后的双机行为。DESKTOP-LOCAL 同设备原生 Host、真实会话/命令/文件已验收；非默认测试 Node 在 v0.2.1 时远端原生页白屏，升 v0.2.3 后正常并执行 `REMOTE-OK`；LAPTOP-01 离线，物理跨设备与附件待验收。
- [x] F28：从独立制品干净安装 APP、DSH 插件和 Node，分别确认安装、启动与后台管理；源码克隆仅作开发路径。DESKTOP-LOCAL 已完成三组件安装/启动并升级到 `v0.2.3`，`v0.2.3` 的 APP 首装 bootstrap 在临时干净目录通过；LAPTOP-01 的第二台设备复验归入双机验收。
- [x] F29：同一设备上的 APP 与插件连接同一 DSH Host 和会话，双向同步任务/状态，确认 Host 是唯一会话写入者且后台实例不会抢占设备身份。已用同一 `OK` 会话验证：DSH→APP 与 APP→DSH 的回合、`pwsh` 命令、文件页一致；公网 Hub 仅一个 DESKTOP 节点。
- [ ] F30：完成后续版本更新、真实更新服务、远端 Node 更新及回滚/数据保留验收。APP、Node、插件已通过 APP 更新中心从 `0.2.1` 经 `0.2.2` 真实升级到 `0.2.3`，数据保留；遗留重启标签不清、根 `version.json` 插件字段滞后、DSH 本机插件更新按钮仍报检查失败。客户端更新回滚/失败恢复、数字签名和双机更新仍未验收。
- [x] F32：测量 APP 请求链路各阶段时延后定位响应慢的原因。已完成分段测量：公网 Hub `state` 110–541 ms、`workspaces` 297–646 ms、非空目录 `fs/list` 264–681 ms、文本预览 261–604 ms、PPTX 预览 5311–5610 ms；根因是每条文件请求都经公网 Hub、UI 重复/串行请求、无缓存/预取/取消、Office 每次重转，以及 Node WS 消息循环被 `dsh_call` 阻塞。候选 v0.2.4 已实现对应修复，实测见 F38–F44；安装验收仍按 F30/F38 跟踪。
- [ ] F33：发送前清楚检查当前 Host 的账号与模型可用性，失败时说明责任端和处理方式。
- [ ] F34：在真实 APP 和 DSH 环境验证互联列表中的本机设备排序。技术验证完成：APP 与 DSH 插件互联页均把 DESKTOP-LOCAL 标为本机并置顶，LAPTOP-01 离线；待主人确认体验。
- [ ] F35：让 APP 与插件的 Hub/服务入口打开同一连接信息页，并在真实环境确认两端展示同一连接状态与可用操作。当前实现或隔离对照不代表真实安装验收。真实 APP 与 DSH 插件连接页均显示同一服务地址、已连接、检测时间与耗时；待主人确认体验。
- [x] F36：完成本地及公开源码树清理，归档临时截图与过程资料，保留有效工程文档及用户历史记录；不重写既有历史决定。公开主分支清理已同步并完成全树检查。
- [x] F37：服务端已独立上传至私有仓库；公开客户端仓库继续保持公开并保留当前源码。公开主分支旧服务端源码已删除，MCP 全树检查未发现禁路径；旧 `v0.2.0` Release 的两个 ZIP 资产已删除，Release 说明标记为 withdrawn，tag 保留。后续 `v0.2.1` 客户端基础制品已发布；真实安装和更新验收仍归 F30 跟踪。

## 2026-10-28 性能批次（v0.2.4 候选）

判据统一为：桌面 APP 选中 DESKTOP-LOCAL 时，目录切换命中缓存/本地直连不出现整屏加载；远端文件请求不再被 DSH 轮询阻塞；Office 同一文件第二次预览命中缓存；取消按钮能终止当前目录或预览请求；悬浮卡片四边完整。v0.2.4 已发布并安装到 DESKTOP-LOCAL（数据哈希不变，Node `0.2.4` 在线，本机 `fs/list` 3–4 ms、PPTX 二次预览 6 ms）；LAPTOP-01 更新与双机复验仍未做。

- [ ] F38：切换设备后资源管理器必须显示新设备的第一个工作区，不能沿用上一台设备的路径。实现：目录初始化增加 `projectsDevice === deviceId` 门禁；设备切换保留按设备分键的树/目录缓存。证据：浏览器实测 DESKTOP-LOCAL↔LAPTOP-01 往返，面包屑与列表均切到对应设备的 `C:\Users\<user>\...`，不再出现 `not a directory`。
- [ ] F39：本机文件操作走回环直连，不再绕公网 Hub。实现：Node console 增加 token 保护的 `/api/devices/{id}/fs|workspaces|drives|policy|audit|dsh/sessions`；APP 网关仅把本机设备这些路由转发到 `127.0.0.1:18894`。证据：隔离 Node + APP 网关实测 `fs/list` 3–4 ms（Hub 基线 264–681 ms），文本预览 3 ms（基线 261–604 ms）。
- [ ] F40：预加载/缓存/去重。实现：目录列表按设备缓存并先显示后校验；`loadDir` 结果回填树缓存；双击/单点悬停预取目录与文本/图片/PDF 预览；预览不再无条件重载父目录；`fs/list` 并发去重。证据：浏览器中关闭预览返回列表无重新加载，目录重复请求消失；代码断言见 `tests/test_ui_performance.mjs`。
- [ ] F41：可强制停止加载。实现：目录/预览请求使用 AbortController + 序号门；加载区提供“停止加载/停止”，顶部刷新按钮在忙时不再只能等待。证据：浏览器可见停止入口；中断后不会再把旧响应写回界面（单元覆盖 abort 不切换 API base）。
- [ ] F42：双击行为。实现：单击忽略 `event.detail > 1`，双击 `preventDefault` 后只触发一次打开；目录双击进入、文件双击预览。证据：浏览器实测双击目录进入 `D:\TetherWorkspaces\demo`，列表与树同步展开。
- [ ] F43：悬浮信息条边框。实现：去掉原生 `title`，改为应用内 `position: fixed` 卡片（1px 四边框、圆角、阴影），显示名称/路径/大小/修改时间；树与主列表共用。证据：浏览器截图确认四边完整，无三边黑框。
- [ ] F44：Office 预览缓存。实现：Node 按“路径+`mtime_ns`+大小+类型”缓存转换后的 PDF，上限 96 个/256 MB，命中不重新调用 COM。证据：隔离 Node 实测 PPTX 首次 2879 ms、第二次 5 ms（Hub 基线每次 5311–5610 ms）；源文件变化后重新转换由 `test_office_preview_reuses_converted_pdf_until_source_changes` 覆盖。
- [ ] F45：远端文件请求被 DSH 轮询阻塞。实现：Node WS 将 `fs_call`/`dsh_call` 改为受并发上限约束的任务，不再顺序 await 阻塞后续请求。证据：`test_node_concurrency.py` 证明慢 DSH 调用期间文件调用可同时开始；真实 LAPTOP-01 需升级 v0.2.4 后复验。

- [ ] F46：选中本机设备时不得反复报 `local route not found`（远端设备正常）。根因：会话详情每 1.5 秒轮询 `/api/devices/{id}/dsh/sessions/{id}`，APP 网关把本机该路由转发给 Node 本地 API，而 console 只实现了会话列表、缺 transcript。v0.2.5 已补齐并部署 DESKTOP-LOCAL：网关实测本机会话 transcript 200（`x-tether-local: 1`，13 ms）；待双机复验确认不再复现。
- [ ] F47：报错不得把页面往下挤压，且必须可手动关闭。v0.2.5 把 notice/工作区错误改为右上角浮层（绝对定位、不参与布局），每条带 `×` 关闭按钮，工作区错误保留“重试工作区”。浏览器实测浮层显示/关闭且主区域不动。

## 2026-10-28 更新中心与跨机附件批次

- [ ] F48 更新中心命名：卡片以设备名开头（`设备名 · Node` / `设备名 · DSH 插件`），本机卡为 `本机 Tether APP` / `本机 DSH 插件`；"目标设备上的"说法已移除（源码断言 `!ui.includes('目标设备上的')`），v0.2.6 安装后复验。
- [ ] F49 多设备覆盖：更新中心为**每台已知设备**各出一张设备卡（本机置顶），打开更新中心即对全部在线设备检查；卡片按 Node→已安装 DSH 插件→APP 更新；离线设备显示"离线"且按钮禁用。真实目标设备验证仍待完成。
- [x] F50 报错简洁与去重：更新错误统一短句（设备离线/Hub 不可达/节点版本过旧/服务端不支持更新/设备不存在），并经 `lastUpdateToastRef` 去重——同一错误不随轮询重复弹；错误只出现在右下浮层，卡片内不再有红色长文。
- [ ] F51 更新后状态闭环：一键更新期间按钮禁用；Node 更新后 UI 每 2 秒核对 `capabilities.node_version`，进程到新版即清除"节点重启中"并显示"已是最新"；插件更新后出现"已重启 DSH，重新检查"，点击后若已最新则收敛为"已是最新"。待真实更新流程复验。
- [ ] F52 插件端检查更新提取不到版本：本机 RPC 通道失败时卡片显示"失败"浮层提示；同时每台设备的 Hub 卡片（含本机）始终提供版本与一键更新，作为可靠通道。local RPC 失败根因（旧 surface 插件未注册 `/tether-updates`）需升级 surface 插件后复验。
- [x] F53 一键更新端到端验证：经 Hub 真实执行 DESKTOP-LOCAL DSH 插件 `0.2.3→0.2.5`：check available=true → prepare prepared_id `bc04336b…` to 0.2.5 → apply ok restart_required=true → 复查 current=0.2.5、installed_latest=true。链路可用；期间两次 409/504 为设备忙/超时，已映射为短句。
- [ ] F54 跨机附件：picker 已从隐藏 Hub/localStorage 依赖改为 DSH Host `remote.workspaceFiles`；限定当前会话工作区并校验条目 capability。需要在实际运行的 Host 确认 `remote.workspaceFiles` 注入与 `readBytes` 字节回传后再关闭此项。
- [ ] F55 报错浮层准则：错误一律右下角绝对定位浮层＋`×`（更新中心内同样适用），不进文档流、不进卡片正文。v0.2.10 笔记本更新成功后，旧 v0.2.9 的“APP 更新后尚未重新连接”失败提示仍留在界面；已在验收时手动关闭。提示未自动清除的问题仍待单独修复和验收。

## 验收边界

离线测试、隔离 UI、单机 DSH、本机真实模型回答、干净安装、真实跨设备操作和公开发布分别记录，不能互相替代。未完成发布与实机验收前，保持对应条目未完成。

