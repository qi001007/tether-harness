# 实时进度

更新日期：2026-10-29。

> 交接：给 Codex 的接手说明见 [HANDOFF-2026-10-29.md](HANDOFF-2026-10-29.md)（现状、故障证据、更新契约、红线与排期）。

## 2026-10-29 接手修复（随 0.2.25 发布）

- 更新入口灯与更新卡同源：`updateTriggerState` 按在线设备 capability 取 node/plugin/app，known 优先于历史错误，离线设备不参与；瞬时 `InvalidStateError`/网络错误重试一次，失败结果不进入 5 分钟缓存。实测 DESKTOP-LOCAL 与 LAPTOP-01 两卡“已是最新”、头部 `current` 绿色。
- 跨节点旧节点响应兼容：`responseBelongsToDevice` 在响应缺 `device_id` 时按旧节点放行，有值必须匹配；覆盖预览、保存、新建、重命名和版本轮询。实测 LAPTOP-01 `D:\TetherWorkspaces\Tether-demo-check-1aba3266.txt` 打开成功，无“目标设备身份校验失败”。
- Monaco 主题跟随宿主：读 `body/html[data-ds-dark-theme]`，MutationObserver 调 `monaco.editor.setTheme`。实测亮色 `rgb(255,255,255)` → 加暗色标记 `rgb(13,17,23)` → 移除恢复亮色。
- 重建 `client.js` 与 `dist/app.js`，重装 DSH profile 并重启；`build.mjs --check` 通过。更新灯修复同时让 Codex 16:23 的 native surface 去边线守卫生效：APP 原生工作区侧栏边缘像素由 `219,220,220` 变为底色 `249,250,251`。
- DSH 本机卡常红/`插件 -(-)` 的独立根因是源码 updater 缺 `tether/release.py`、`tether/ed25519.py`；补齐后 `install-plugin.ps1` 复制七个 updater 文件，DSH 更新中心本机卡恢复 `0.2.24(0.2.24)` 并显示“已是最新”。
- 门禁：166 mjs / 6 cjs / 123 pytest（1 skipped）/ `build.mjs --check` / `build-web.mjs --check` / `validate_versions()`。已随 0.2.25 发布；LAPTOP-01 仍为 0.2.24，跨机编辑所需的 `version/editable` 字段待其一键更新后复验。
- 证据：`.scratch/fix-update-green.png`、`.scratch/fix-remote-open.png`、`.scratch/dsh-update-center-final2.png`、`.scratch/webui-code-monaco.png`。

## 资源管理器视觉审查（0.2.25 已发布）

- 主人已于 2026-10-29 认可第五版；`0.2.25` 已于 2026-10-29T15:12:25Z 正式发布，清单验签通过；两机安装状态待更新后回填。
- 第一版因蓝色渐变/蓝色状态条、普通代码仍有切换按钮、标签页与整体质感不足被主人驳回。第二版继续复用既有远端文件协议和资源树，没有从零重构：顶栏、活动栏、资源树、命令区、标签栏、编辑区和状态栏全部改为白灰黑中性层级，仍靠色差而不是常驻硬边线分区；拖动把手只在悬停/拖动时出现。
- 删除旧手写代码高亮旁路，代码与 Markdown 编辑统一使用 Monaco `0.57.0`。普通代码打开后直接编辑，不显示预览/编辑切换；只有 Markdown 与 CSV/TSV 等确需渲染的类型保留视图切换。Monaco 补齐 TOML/INI、YAML、XML、SQL、Shell、PowerShell、Go、Rust、C#、PHP、Ruby、Swift、Kotlin、Lua、R、Perl、Dart、Dockerfile、Less、SCSS 等语言注册，并采用接近 VSCode Light+/Dark+ 的语法色板。
- 文件标签第三版改为中性的扩展名徽标（`PY`/`JS`/`TOML` 等）、圆角页签与悬停关闭，不使用通用文件图标或彩色强调线。第五版继续保留 Monaco 22px 装饰区与 13px 白色留白，但删除第四版新增的人工分界线；亮色三层为文件树 `#efeff1`、行号区 `#f7f7f8`、代码区 `#ffffff`，暗色行号区为 `#232325`。`renderLineHighlight='line'` 继续保证当前行背景仅覆盖代码区，活动行号只加深文字颜色，不叠加矩形背景。蓝色只允许作为代码语法色，不作为工作台 chrome。目录命令区现有新建/复制/粘贴/重命名/删除逻辑保留，跨设备粘贴仍拒绝混用来源设备。
- 仓库版 `http://127.0.0.1:18892/` 已真实加载第五版 `dist/app.js`；在 DESKTOP-LOCAL 打开 `E:\遥望科技实习项目\tether\tether\node\agent.py`，实测文件树、行号区、代码区分别为 `rgb(239,239,241)`、`rgb(247,247,248)`、`rgb(255,255,255)`，留白层为 13px 且左边框宽度为 0。活动行号背景透明、文字为 `rgb(41,41,41)`，当前行代码背景从代码区起点开始。该页面是发布前的审查证据；0.2.25 已发布，安装状态待更新后回填。
- 本轮门禁：MJS 167/167、CJS 6/6、Python 123 passed / 1 skipped、定向代码视图 8/8、`build.mjs --check`、`build-web.mjs --check`、版本校验全部通过。

## 编辑器与目标端文件语义（0.2.25 已发布）

- 资源管理器代码编辑已替换为 Monaco `0.57.0`：worker 与 CSS 由现有构建器内嵌，Web 与 DSH 共用同一运行时；model URI 包含目标设备和路径，状态栏显示目标、路径、光标、编码与换行。
- Node 文件服务为可编辑文本返回 SHA-256 `version`、`device_id`、`encoding`、`newline`、`editable`；写入使用 `expected_version` 防止覆盖目标端外部修改，并保留 UTF-8 BOM/UTF-16/GB18030 与 CRLF/LF。UI 每 5 秒及窗口聚焦检查目标版本；干净文档自动刷新，脏文档提示冲突。
- DSH 加号菜单候选保留原“文件”（操作者本机上传），并注册“目标设备文件”（目标 DSH 会话工作区）。本机源码插件已重装，真实 WebUI/DSH Monaco 可见；LAPTOP-01 仍运行 0.2.24 bundle；0.2.25 已发布，跨机菜单项验收待其一键更新后完成。
- 连接/更新入口统一使用状态圆点：在线/当前为绿、离线为红、连接检测中为琥珀、未知为灰、更新检查失败为琥珀、发现更新为红；后台更新检查失败仍不弹红 toast、不点红点。
- 真实 DESKTOP-LOCAL API 创建/保存后磁盘立即变化；外部改写后旧版本保存返回 `conflict` 且目标内容未被覆盖。完整门禁：Python 123 passed / 1 skipped、MJS 164/164、CJS 6/6、bundle check 与版本校验通过；定向 Python 16 passed、共享 UI/DSH 19 passed。

## P0：Node↔Hub WebSocket 稳定性（0.2.25 已发布，待两机安装验收）

- 14:34–14:38 的 Node 重连与 Hub 接受新 WSS 的时间逐次对齐；Hub、surface mux、Caddy 均未重启（`NRestarts=0`），另一来源节点保持连接，未发现 Hub 全局事件循环停顿证据。客户端环境存在 `127.0.0.1:7890` HTTP/SOCKS 代理，而 `websockets>=15` 默认继承环境代理；故障形态符合该路径在网络/代理切换时黑洞。
- 源码候选让 Node 控制面 WSS 在运行库支持 `proxy` 参数时显式直连；更新结果绑定原接收 WebSocket，旧任务不得跨重连发送，closing socket 的 `InvalidStateError` 只按传输中断处理。
- 离线门禁：pytest 121 passed / 1 skipped、mjs 158/158、cjs 6/6、bundle check 与版本校验通过。公网只读观察持续 603.9 s：直连 Ping 59/59，P50 125 ms、最大 547 ms；DESKTOP-LOCAL 与 LAPTOP-01 无 online 状态变化，state/manifest 零失败，三组件 latest 始终 0.2.24。
- 本机实验台源码 Node 于 15:46:09 重启并加载候选；连续运行 12.8 分钟后，15:46:10 注册以来日志无新 keepalive timeout、断线或 `InvalidStateError`，DESKTOP-LOCAL 与 LAPTOP-01 均保持 online。两台设备分别显式检查 node/plugin，四次均返回 `ok=true`、current/latest=`0.2.24`。
- 边界：客户端修复已随 0.2.25 发布，但尚未安装到两台运行版；服务端 ping 参数、Hub/Caddy 部署未改。

## 当前实测状态：v0.2.25 已发布

- tag `v0.2.25` → `ed49c23`；发行工作流 `40898090981` 成功；资产 app 1,654,227 B、node 73,521 B、plugin 1,298,504 B、manifest 1,566 B；manifest Ed25519 验签通过、大小/SHA 与下载资产一致；Release 已发布（2026-10-29T15:12:25Z）。
- Hub `/releases/manifest` 于 2026-10-29T15:13:02Z 返回 `X-Tether-Manifest-Version: 0.2.25`、`stale=0`，三组件 latest 均为 `0.2.25`；Hub 清单签名验证通过，大小/SHA 与 GitHub 资产一致（发布后 37 秒）。
- 0.2.25 内容：资源管理器 Monaco 编辑与中性工作台、目标端文件 `version/editable` 与保存冲突检测、更新灯与卡片同源、Node 控制面 WS 绕开环境代理并把更新结果绑定原连接、源码 updater 补齐 `release.py`/`ed25519.py`。
- 门禁：pytest 123 passed / 1 skipped、mjs 167/167、cjs 6/6、`build.mjs --check`、Web bundle 重建字节一致、`validate_versions()`。
- 边界：发布时 DESKTOP-LOCAL 与 LAPTOP-01 仍运行 0.2.24；本机与跨节点一键更新、跨机 Monaco 与目标设备文件菜单验收待主人更新后回填。

## 当前实测状态：v0.2.24 已发布

- tag `v0.2.24` → `a6de4a3`；发行工作流 `40828646049` 成功；资产 app 412,251 B、node 72,254 B、plugin 416,117 B；manifest 验签通过、大小/SHA 一致；Release 已发布（2026-10-29T06:23:28Z）。
- 插件本机面板不再内嵌 DSH：桌面宿主顶层是 `dsh-app://app`，DSH 的会话 Cookie 为 `SameSite=Strict`，127.0.0.1 子 frame 收不到；`dsh-app` 子 frame 又缺 preload，会停在 `Loading plugins…`。本机显示“已在 DSH 中”，远端设备仍走 Hub surface；真机窗口（CDP 取证）无 401、无卡死。
- 更新中心 latest 统一取清单值：本机 `插件 0.2.24(0.2.24)/Node 0.2.24(0.2.24)`，LAPTOP-01 同为 `0.2.24(0.2.24)`；后台自动检查失败不再弹红 toast、不再点亮“更新”红点。
- 远程更新 LAPTOP-01（0.2.21 → 0.2.24，目标端零手工）：Node 19 文件后自动重启；插件 40 文件后 DSH 自动重启并清掉 `restart_required`；APP 34 文件后自动重启。两机 APP/Node/插件均 `0.2.24`，surface 可用。
- 本机实验台：仓库包 `0.2.24`，APP/Node 重启后上报 `0.2.24`；DSH desktop profile 指向仓库包并已加载 `0.2.24`。
- 已知边界：Hub mirror 的 GitHub latest 解析缓存 `latest_ttl=300s`（服务端 `tether-harness-server`，不在本仓），发布后最多约 5 分钟内仍可能显示旧 latest；节点/APP 的状态文件会保留 `restart_required=true`，UI 以运行版本判定完成，不阻塞更新链。

## 当前实测状态：v0.2.21 已发布

- tag `v0.2.21` → `5d01994`；发行工作流 `40821192816` 成功；资产 app 410,118 B、node 71,555 B、plugin 415,137 B，manifest 验签通过、大小/SHA 一致；Release 已发布。
- 修复两个本机侧问题：① Electron 在 DSH 重启后保留了同端口的旧会话 cookie，即使换新 token 也停在 `dsh web authentication required`；现在加载/重建 iframe 前清掉该 loopback origin 的 cookies/localStorage。本机 0.2.21 重启后原生页 `hasComposer=true`。② 本机 APP/插件更新器仍走 GitHub latest 的边缘缓存，卡片 latest 停在 0.2.19；现在优先用 Hub mirror（`hub.json` / app-context `serverUrl`），实测两者 `latest_version=0.2.21`、`manifest_source` 为 Hub mirror。
- 本机实验台与 LAPTOP-01 均已 `0.2.21`；远程更新（0.2.20 → 0.2.21，目标端零手工）：Node 19 文件、插件 40 文件后 DSH 自动重启、APP 34 文件自动重启，两机 APP/Node 0.2.21。
- 门禁：155 mjs / 6 cjs / 112 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.20 已发布

- tag `v0.2.20` → `965adf1`；发行工作流 `40819992563` 成功；资产 app 409,414 B、node 71,554 B、plugin 414,910 B，manifest 验签通过、大小/SHA 一致；Release 已发布。
- 修复两个 0.2.19 之后出现的回归：① DSH 自动重启后 APP 原生页停在 `dsh web authentication required`——描述符 token 未变但宿主会话已换；现在节点在 surface 描述符里返回 DSH host 的 `pid`/`updated_at`，APP 在 pid 变化时重建 iframe 并重新认证。② 本机插件卡 latest 仍显示 0.2.18——插件本地更新器走了 GitHub latest 的边缘缓存；现在更新器先通过 release API 解析 tag（5 分钟缓存）再取清单。
- 本机实验台与 LAPTOP-01 均已 `0.2.20`。远程实测（目标端零手工）：Node 19 文件、自动重启；插件 40 文件、DSH 自动重启后 `restart_required=false`；APP 34 文件、自动重启后 0.2.20 在线；两机 APP/Node 均 0.2.20。
- 门禁：153 mjs / 6 cjs / 112 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.19 已发布

- tag `v0.2.19` → `66fdef1`；发行工作流 `40818499641` 成功；资产 app 408,693 B、node 70,969 B、plugin 414,448 B，manifest 验签通过、大小/SHA 一致；Release 已发布。
- 远程插件更新现在自己收尾：插件 apply 记录目标 DSH 的 host pid，调度一个 detached 重启帮手关闭并重开 DeepSeek Harness；新 host 回写描述符、pid 变化后 `restart_required` 自动清除，链路等它完成再继续。正常路径不再需要人在目标机上重启 DSH。
- 本机实验台与 LAPTOP-01 均已 `0.2.19`。远程实测（DESKTOP-LOCAL → LAPTOP-01，目标端零手工）：Node 重启后约 5 s 以 0.2.19 重新注册；插件 40 个文件、DSH 自动重启后约 12 s `restart_required=false`、运行时 0.2.19；APP 34 个文件、重启后约 10 s 以 0.2.19 重连。最终三组件均 0.2.19、在线、surface 可用。
- 门禁：152 mjs / 6 cjs / 111 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.18 已发布

- tag `v0.2.18` → `787aa3c`；发行工作流 `40816719901` 成功；资产 app 405,627 B、node 68,122 B、plugin 413,538 B，manifest 验签通过、大小/SHA 一致；Release 已发布，Hub mirror 已切到 `0.2.18`。
- 修复远程一键更新的链路：节点更新重启的窗口里，后续组件的 check 会拿到 400 `device_offline`，原实现直接 `return`，APP 步被静默跳过。现在每个组件独立执行、瞬时错误重试 3 次、失败汇总提示，APP 重启仍按 `app_version` 验收；远程插件装好后显示“插件待重启 DSH”，不再假装已是最新。
- 本机实验台已升到 `0.2.18`；LAPTOP-01 为 Node/APP `0.2.17`，三组件均能看到 `0.2.18` 可更新（`manifest_source` = Hub mirror）。插件运行时仍需目标 DSH 重启一次。
- 门禁：151 mjs / 6 cjs / 109 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.17 已发布

- tag `v0.2.17` → `fdc9e35`；发行工作流 `40812163945` 成功；资产 app 404,944 B、node 68,122 B、plugin 413,162 B，manifest 验签通过、大小/SHA 一致；Release 已发布，Hub mirror 已切到 `0.2.17`。
- 修复“发布后强制刷新仍显示旧 latest”：UI 的强制刷新只清了渲染器缓存，Node 与 APP/插件本地更新器仍用 10 分钟磁盘清单缓存。现在 Node 的 check 强制拉取（status 仍缓存），APP 与 DSH 插件的 check 命令带 `--force`；本机实测 `manifest_source` 为 Hub 地址而非 `disk-cache`。
- 本机实验台已升到 `0.2.17`（源码安装，desktop profile 指向仓库包）；LAPTOP-01 仍 `0.2.15`，旧节点的缓存最多 10 分钟后才会看到 `0.2.17`，届时用更新中心直接升 `0.2.17`。`0.2.16` 的制品仍有效，但被 `0.2.17` 取代。
- 门禁：149 mjs / 6 cjs / 109 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.16 已发布

- tag `v0.2.16` → `8343fae`；发行工作流 `40810305861` 成功；4 个资产已下载：三组件均 `0.2.16`，大小/SHA-256 与 manifest 一致，`verify_signature` 通过（app 404,824 B、plugin 413,149 B、node 68,030 B）；Draft 已发布，Hub mirror 已切到 `0.2.16`（`released_at 2026-10-29T03:09:34Z`）。
- 本机实验台为源码安装（APP/Node/插件 0.2.16，desktop profile 指向仓库包）；LAPTOP-01 在线 `0.2.15`，待通过更新中心升级；TETHER-REMOTE-TEST 离线。
- 发布前门禁：149 mjs / 6 cjs / 108 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`；PR #11（51 文件 +3416/−387，15 提交）。

## 实验台修复：本机 DSH 工作区直连 + 更新中心版本行（2026-10-29）

- 本机（DESKTOP-LOCAL）打开 DSH 原生工作区失败：走公网 Hub 时，DSH 启动期核心资源在网关 30 s 截止点返回 502（含插件的组合包 825 KB gzip 仍用了 14 s），DSH 报 `web boot: 1 entry did not activate`；直连 `127.0.0.1:57168` 约 1 s。修复为本机设备 surface 走节点回环 console：console 新增 `GET /api/devices/{id}/dsh/surface`（返回 `?token=` 地址，descriptor 不可用 409），Web 服务的本机快路径加入 `/dsh/surface`，UI 接受同机 token URL 并跳过“Hub loopback”误判。提交 `536832f`。真机：dev APP iframe 指向 `127.0.0.1:53057/?token=…&tether_native=1`，首屏正常，无 HARNESS 失败页。
- 插件端（DSH 面板）原先仍从 Hub 取 surface：DSH 重启后节点里旧 Cookie 失效，面板显示 `dsh web authentication required`。修复：`createDshHost.surfaceBase` 对本地设备返回 18892（APP 服务快路径，失败回退 Hub），节点 `NativeSurface._http` 遇 401/403 清空 jar 重新登录并重放一次；轮询对同机 token URL 比较 token，同端口重启也能换新。提交 `ca196eb`。真机：DSH 面板内层 iframe 为 `127.0.0.1:54805/?token=…&tether_native=1`，显示工作区而非认证错误。
- 更新中心版本行改为固定模板：本机 APP 卡 `APP 0.2.16(0.2.15)/Node 0.2.16(0.2.15)`，本机插件卡 `插件 0.2.16(0.2.15)/Node 0.2.16(0.2.15)`，其他设备两行同格式；删除“当前/· 最新/（已安装…待生效）”。提交 `5118572`。
- 本机实验台口径：插件与 APP 从仓库构建后直接替换本机（`desktop/install-plugin.ps1 -Restart` 把 desktop profile 指向仓库包，备份 `package.json.bak-tether-plugin-20261029-090410`；DSH 重启后插件 bundle 与仓库 `client.js` SHA-256 一致；dev APP 加载仓库 `packages/tether-ui/web`）。本机不通过更新中心更新；更新中心只用于其他节点。
- 门禁：`node --test tests/test_*.mjs` 143 passed、`cjs` 6 passed、`pytest` 108 passed + 1 skipped、`build.mjs --check` 通过。均为本机实验台结果；两机更新与发行包未做。

## UI 批次：色差分隔、代码编辑、CSV 表格编辑（2026-10-29 上午）

- 分界线改色差：树/详情、代码行号、标签栏、表格状态栏的 1px 硬边框去掉，分隔条只在悬停/拖动时显蓝色把手；行号改独立满高列（真机 755px 视口下 755px）。
- 代码页配色：关键字蓝 `#1a5fb4`、字符串绿 `#2f855a`、数字紫 `#6b46c1`、注释灰；暗色 `#7aa2f7/#9ece6a/#bb9af7`；红色不再用于语法。
- 代码编辑：`text`/`markdown` 可进入编辑，代码态带同步行号槽；Tab 插入两空格、`Ctrl+S` 保存、原生 `Ctrl+Z/Y` 撤销重做；未保存时关闭/切换先确认。真机插入 `# edited` → `Ctrl+Z` 回退 → 插入 `# saved` → `Ctrl+S`，磁盘首行变为 `# saved`。
- CSV/TSV：表头与单元格可编辑，`Ctrl+S` 走 RFC4180 序列化；XLSX 仍只读；截断文件禁用表格编辑。真机写入 `XAlice` 并保存成功。
- 目录加载：修复快速双击的预取竞态（预取 Promise 解析成 `undefined` 被当成响应，触发“目录读取失败”）；刷新改为覆盖式居中转圈，列表不再被顶部“正在刷新…”行挤压。提交 `970ff5c`。
- 门禁：149 mjs / 6 cjs / 108 pytest。提交 `f0f1fd6`、`970ff5c`。

## 当前状态：v0.2.14 已发布并完成两机更新，插件宿主待重载

- 公开 PR #8 合并（`e57931f`），tag `v0.2.14`；发行 CI `40688429123` 全绿，构建步骤内**强制验签**（缺 `TETHER_RELEASE_PRIVATE_KEY` 直接失败，产出后再验一次）。Release `v0.2.14` 已发布；匿名 `latest/download/tether-update.json` 为 `0.2.14`、`channel=stable`、签名 88 字节，三 ZIP 的大小与 SHA-256 与清单逐项一致。
- 私有 PR #6/#7 合并并部署：线上 `/opt/tether/server` = `2b0a795`，`/releases/manifest` 200 且返回签名的 0.2.14；备份 `server-20261028T123737Z`、`server-20261028T124217Z`，Hub/mux/Caddy active、`NRestarts=0`。`/releases/manifest` 改为先查 GitHub API 的 `tag_name` 再取不可变 `/releases/download/<tag>/...`——发布后 `latest` 重定向按 PoP 边缘缓存，曾让镜像多分钟停留在 0.2.13。
- 两机更新（经 Hub 的 check/prepare/apply，与更新页同一后端）：DESKTOP-LOCAL 与 LAPTOP-01 的 APP/Node 均报告 `0.2.14`；Node 重启后分别约 12 s / 6 s 重新在线，APP 由 helper 重启后回到在线。插件在磁盘/profile/`file:` 源均为 `0.2.14`。
- 数据保留：更新后 DESKTOP-LOCAL 3 个工作区、12 个会话；LAPTOP-01 2 个工作区、1 个会话；与更新前一致。未读取或输出 `hub.json` 内容。
- **未完成**：插件宿主内存仍是 0.2.13（DSH 于 18:58 启动，插件文件 20:46 才替换），需在更新页点“立即生效”或重启一次 DSH；0.2.14 的 `runtime_version` 仍按磁盘读取，会误报“已是最新”，修复已在 `next/0.2.15`（`3b37be0`）但尚未发行。

## 当前实测状态：v0.2.13 已发布，两机安装待主人验收

- 公开 PR #7 已合并；`v0.2.13` tag 指向 `5938b70ed3188a6095bda2bf32778ad9edee68ef`，发行 CI `40667788605` 成功，[GitHub Release v0.2.13](https://github.com/qi001007/tether-harness/releases/tag/v0.2.13) 已发布。APP、插件、Node 三个 ZIP 与 manifest 的版本、大小、SHA-256 均已核验；匿名 `latest/download/tether-update.json` 返回 HTTP 200，SHA-256 为 `3ce3fc8166d61e91eaefa1acc282a4d71e0f7a1774177075606aa63f6e8de507`，三个组件版本均为 `0.2.13`。`v0.2.12` 失败 tag 保留，未改写。
- 刷新旋转、请求期间忙态、错误 toast 4 秒自动消失、更新入口固定文案/状态圆点及附件测试仓库契约检查已包含在发布版本。定向回归 21/21、全量 Python 95 passed / 1 legacy fixture skip、JavaScript 96 passed。
- 隔离 Electron 动态验收确认更新中心刷新按钮旋转并在请求结束后停止、失败提示自动消失；文件资源管理器延迟 `fs/list` 约 1013 ms 时旋转矩阵持续变化，约 1080 ms 采样时已停止。此隔离 UI 证据不代表用户设备安装验收；主人两台设备安装与实际 UI 复验仍待完成。

## 当前实测状态：v0.2.11 已发布，LAPTOP-01 已升级并自动重连

- 正式 tag `v0.2.11` 指向 `591d4d689cf7a6a1408b13d1561fd9573de51cb6`；公开 PR #5、发行 CI `40654194962` 已完成，APP/插件/Node ZIP 与 manifest 的版本、大小和 SHA-256 已核对。下方“候选、尚未发布”是较早快照。
- 通过正式更新 API 对 LAPTOP-01 依次应用 Node、插件、APP；三组件安装状态均 `0.2.11`。Node apply 672 ms，观察到新版 Node 在线用时 2688 ms；APP apply 750 ms，响应后 9047 ms 观察到 APP/Node 都以 `0.2.11` 在线。该次验收经实际产品后端发起，未重复验收 UI 点击路径。
- 更新前后 `hub.json` SHA-256、1 个会话记录、3 个工作区树摘要一致。更新后的三组件联网检查 797–1250 ms，当前状态查询 781–1266 ms；运行中更新检查不会下载安装。
- 桌面 DSH 的真实 owner RPC 已返回 HTTP 200，运行/安装插件均为 `0.2.11`。LAPTOP-01 通过 owner pluginManager 安全重载返回 `application=applied`（HTTP 200，2141 ms），随后 `/tether-updates/status` 确认 current/runtime 均为 `0.2.11`；证据见 `maintenance/ui-regression.../laptop-official-plugin-reload.json`。此结果验证了本机 surface reload 流程，无需手工重启 DSH。
- 浏览器长期缓存仅用于已鉴权、成功返回的哈希 JS/CSS；动态 HTML 仍 `no-store`。已实测缓存头与 gzip，尚未将 Python HTTP 重复请求当作浏览器缓存命中证据。
- 原生对话目标设备附件选择器源码已实现并通过自动回归；真实安装窗口与跨设备模型上传仍未验收。首次冷加载约 32 秒的全部耗时尚未归因。桌面旧快捷方式对应的 `D:\Tether\app` 仍为 `0.2.9`，升级命令因自动审批用量限制未执行，不能称为已升级。

## 原生目标设备附件窄切片（2026-10-28）

- 候选源码：原生 iframe 的附件 slot 增加“目标设备文件…”浏览入口；owner-only RPC 确认当前 DSH `device_id`，读取端改用 DSH Host `remote.workspaceFiles` 并绑定 `sessionId`，当前只浏览该会话工作区，路径必须来自已列出的目录/文件。
- 复用安装版 MIT `ComposerAttachments` 组件保留预览、移除、重试、上传进度和拖拽；通过 `workspaceFiles.readBytes` 获取原始 `Uint8Array`，按 256 KiB 分块，单文件最多 10 MiB。目标设备或会话作用域切换后丢弃异步结果。
- 自动验证：附件桥接 5 项 JavaScript 回归通过（含原始二进制、路径 capability、权限拒绝、大小上限、设备/会话切换）。当前 Node `fs/read` 服务保持未修改。尚未在真实已安装 DSH Host 验证 `remote.workspaceFiles` 注入和实际跨设备模型上传；未发布、安装或重启。
- 后端通道补充证据：LAPTOP-01 的真实 owner `workspaceFiles.list` 对当前原生 Session 工作区 `.` 返回 HTTP 200 / `ok:true`（目录当前为空），证明无需给 iframe 配置额外 Hub token即可调用目标 Host API；此证据不覆盖 `readBytes`、UI 注入或模型上传验收。

## 演示前修复快照（2026-10-28 15:54）

- 防御与性能候选版本为 `0.2.11`，尚未作为正式客户端发行发布。公开 Python 全量 95 passed / 1 旧制品 fixture skip；JS 单进程全量 83 passed。实际 DSH owner 版本 RPC 已恢复 HTTP 200 / 78 ms，安装与运行插件版本均 `0.2.10`。
- 当前桌面开发 APP/Node 已加载候选修复；真实版本 status 三组件并发返回 281–500 ms。检查与安装锁分离，manifest 检查 4 秒超时、60 秒 singleflight 缓存；UI 5 分钟缓存、显式强刷、6–6.5 秒失败收敛。正常打开只检查，绝不自动安装。
- 流式转发已部署到私有 Hub；实际公网网关 bootstrap 加 DSH 模块图为 1969 ms，HTTP 200，已收到 graph。该证据不替代 Electron 实际 composer 完整渲染验收。
- 按主人明确要求，两台在线设备文件策略从 readonly 即时切换 full，未重启；桌面与 LAPTOP-01 均创建唯一测试文件并读回一致，笔记本写入+读回为 1250 ms，权限切换为 328 ms。系统与凭据目录仍保留保护。FilesPane 候选工具栏新增新建文件按钮。
- 15:52 复查 LAPTOP-01 已离线，版本接口为明确 409/device_offline；其上次验证的三组件仍为 `0.2.10`，不能把离线状态称为已验证在线。
- 未完成：原生 iframe 的上传加号接入远端文件选择器；候选客户端正式 CI/发行/两机安装；完整原生 composer 实际窗口复验。上述缺口保留，不能声称演示全功能完成。

## 当前修复：桌面 DSH 插件版本查询与更新目录漂移

- 已复现真实 DSH owner RPC `/tether-updates/status` 返回 HTTP 405；根因是插件使用旧 `connection.rpc.handle` 注册方式，而当前安装 SDK 提供 `connection.register(owner, channel, handler)`，原代码静默跳过注册。
- 已备份并热修复本机安装源和 desktop profile 的三个插件文件，空闲检查后只重启唯一 DSH 宿主。重启后真实 owner RPC 返回 HTTP 200，78 ms，`runtime_version=current_version=0.2.10`、`restart_required=false`。这是本机补丁验收，尚未发布新版本。
- 插件页面从已加载 bundle 的版本常量初始化当前版本；联网检查不再决定当前版本是否可见。更新器正在补齐 file: 安装源与 profile 同事务同步、失败回退、脏开发目录保护及多包版本漂移检测。
- APP 原生页面白屏另查到 `/plugins/events` 为持续事件流，旧代理缓冲至 EOF 后超时返回 502；流式转发及 APP 启动时 Node 就绪检查仍在实现和验证，尚不标记完成。

## 当前权威状态：v0.2.10 远程 APP 更新已通过 LAPTOP-01 真机验收

- 客户端 tag `v0.2.10`（`e9b8ad85ba757e8c5735a7cdcd9e930da75d322b`）已发布；公开 PR #3 合并，CI run `40643560927` 全绿，APP/Node/插件三份 ZIP 与 manifest 的 SHA-256 已核对并发布。v0.2.9 保留为历史版本。
- 私有 Hub 远程 APP 更新能力已部署；从 DESKTOP-LOCAL 桌面安装版提供的更新页发起了目标更新。LAPTOP-01 经该更新页一键更新后，Node、插件、APP 均报告 `0.2.10`，重启 helper 已记录 worker 启动和 APP launcher 打开。
- LAPTOP-01 APP apply API 返回 200；从 apply 响应到 Hub 再次观察为在线耗时 25.159 秒，从最后一次离线到在线为 17.688 秒。重连快照共 197 次观测，并确认 `app_version=0.2.10`。
- 更新前后 `hub.json` 摘要一致；会话数均为 1；三个工作区树哈希一致。真实 APP 启动日志也记录了 `0.2.10` 新进程启动。
- v0.2.9 在 LAPTOP-01 的远程替换曾成功但自动重启 helper 超时，运行版本未更新；此失败事实保留。v0.2.10 Explorer wrapper 已在目标笔记本完成实际重启和重连验收。
- v0.2.9 遗留的“APP 更新后尚未重新连接”失败浮层在 v0.2.10 成功后仍显示，已在验收时手动关闭；该 UI 自动清理问题仍归 F55 跟踪，不影响设备已更新和重连的验收结论。

下方表格保留各阶段记录；其中旧版本号与设备状态是历史快照，以本节当前状态为准。

| 需求 | 当前状态 | 下一步 / 验收边界 |
|---|---|---|
| DSH 插件与原生工作区 | 客户端已实现；本机宿主完成部分实机验证 | 跨设备完整原生工作区、真实会话发送和目标设备附件仍未完成实机验收。 |
| 文件、权限与审计 | 主要功能已实现并有本机回归记录 | 仍需在目标设备和独立安装环境复核。 |
| 多设备任务与连接状态 | 同设备 APP/插件已共享 DESKTOP-LOCAL 的同一 DSH Host/会话；`OK`/`SYNC` 与 `pwsh` 命令双向可见；两端文件页列同一目录；连接页字段一致；互联页本机置顶 | F34/F35 技术验证完成，待主人确认体验；LAPTOP-01 已在线并完成远程更新，但跨机真实会话、任务、命令与文件仍需单独验收。 |
| APP、插件、Node 独立安装 | DESKTOP-LOCAL 已从三份独立 ZIP 安装并真实升级到 v0.2.3：APP 窗口可见、Node `0.2.3` 在线、插件四包 `0.2.3`；v0.2.3 的 APP 首装 bootstrap 在临时干净目录通过，旧配置、数据库、工作区与 DSH 会话保留 | 仍需在第二台真实设备（LAPTOP-01）复验干净安装/共存；源码克隆只作开发路径。 |
| 更新检查与安装 | APP 更新中心完成真实升级：APP/Node/插件 `0.2.1→0.2.2→0.2.3`；官方清单、下载/SHA、暂存/安装、Node 重启、插件 DSH 重启和 APP 自更新均实际执行，数据保留；遗留重启标签不清、根 `version.json` 插件字段滞后、DSH 本机插件更新按钮仍报检查失败 | 客户端更新回滚/失败恢复、数字签名与双机更新未验收；遗留 UI/元数据问题列入后续版本。 |
| 远程 APP 更新（v0.2.10） | DESKTOP-LOCAL 已安装 APP 向 LAPTOP-01 发起 Node→插件→APP；LAPTOP-01 APP 新进程启动并重连，三组件报告 `0.2.10`，apply 后 25.159 秒内在线；Hub 配置哈希、会话数和工作区树哈希不变 | F56 已完成。v0.2.9 笔记本 helper 超时作为历史失败记录保留；后续发布照常执行发布和数据保留门禁。 |
| 响应速度（v0.2.4/v0.2.5） | v0.2.4 已发布并部署 DESKTOP-LOCAL（数据哈希不变，本机 `fs/list` 3–4 ms，PPTX 二次 6 ms）。首个部署发现并修复：本机设备会话详情轮询 404 `local route not found`（console 缺 transcript 路由）；报错条改为右上角可关闭浮层。v0.2.5 已发布（run 40627590181）并部署 DESKTOP-LOCAL，Hub 报告 Node `0.2.5` 在线；网关实测本机会话 transcript 200（`x-tether-local: 1`，13 ms），本机报错消失 | LAPTOP-01 已升级 Node/插件到 `0.2.4`，仍需装 `v0.2.5` APP；F38–F47 需在双机复验；本机直连只在 APP + 本机 Node 同时可用时生效。 |
| 可选服务接入 | 支持连接已配置的兼容服务 | 私有服务的部署与运维信息保存在私有文档；公开用户需配置自己可访问的 Hub。未完成网络可达性配置时，多设备功能不可用。 |
| 真实跨设备场景 | 同设备场景已验收；非默认测试 Node（同机）在 v0.2.1 时远端原生页白屏，升 v0.2.3 后正常并执行 `REMOTE-OK`；LAPTOP-01 已上线并完成 v0.2.10 远程更新 | 继续验收物理笔记本的跨机会话、任务、命令、文件及断线恢复。 |
| F36 项目清理 | 本地清理已完成 | 过程资料与截图已按清单归档；保留有效工程文档和历史决定，不改写先前决策。 |
| F37 服务端私有化与公开仓库发行清理 | 已完成 | 私有服务端仓库与公开客户端主分支边界已确认；旧 `v0.2.0` Release 的 ZIP 资产已删除，撤下说明已保存，tag 保留。公开客户端 `v0.2.1` 基础制品已发布；后续更新和服务端验收继续列入 F30。 |

已记录的自动化回归、官方下载/摘要检查和清单检查不能替代目标设备、干净安装或真实软件升级验收。当前已知限制包括：旧客户端需先手动安装一次 v0.2.1 更新基线；更新包尚无数字签名；远程 APP 更新已在 DESKTOP-LOCAL 与 LAPTOP-01 完成验收，但其他设备配置仍需按目标设备单独核验。

详细部署记录、服务器地址与运行快照属于私有运维材料，不在本公开进度页重复列出。用户需求仍以 [反馈清单](FEEDBACK.md) 为准；产品目标见 [PRD](PRD.md)，公开协议与客户端边界见 [技术说明](TECHNICAL.md)。

