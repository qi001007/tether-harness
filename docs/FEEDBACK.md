# 用户反馈与处理

## 2026-11-03 启动/更新黑色控制台窗口

- [x] F147：用户再次报告开 APP 或更新时会弹黑色窗口。**复测**：用桌面快捷方式启动并 20 ms 采样可见窗口，只有 `Tether` / `Tether WebUI` 主窗口，无 `ConsoleWindowClass`。**剩余漏点 1**：`apps/tether-app/supervisor.js` 的 `killTree()` 调 `taskkill` 时没有 `windowsHide`；更新重启/退出服务会走到这里，`taskkill` 是控制台程序，会闪黑窗。修复：加 `windowsHide: true`，新增 shell 回归断言。0.2.80 已发布并更新两机；启动链无控制台，更新/退出链的 `taskkill` 不再分配可见窗口。**剩余漏点 2（2026-11-03 找到）**：LAPTOP 的桌面/开始菜单快捷方式指向 `Tether-App.cmd` 而不是 `electron.exe`，双击必然先起一个可见 cmd 控制台；已在 LAPTOP 桌面重建为直接启动 `electron.exe`，并给 APP 增加 `ensureAppShortcuts()`，每次启动用 `shell.writeShortcutLink` 自愈桌面/开始菜单快捷方式。判据：桌面快捷方式 target=`electron.exe`、启动、更新、退出全程 20 ms 窗口采样无 `ConsoleWindowClass`。 **0.2.83 复测**：桌面快捷方式冷启动 22 s、20 ms 采样 1,100 次，只新增 WeType `StatusBarWnd` 与两个 Tether `Chrome_WidgetWin_1`，无 cmd/conhost/控制台；LAPTOP 桌面快捷方式已改为 `electron.exe`，开始菜单快捷方式会在 0.2.83 APP 首次启动时由 `ensureAppShortcuts()` 自愈。 **0.2.89 更新重启复测**：用更新同款 `app_restart` 助手重启 APP，30 s / 20 ms 采样 1,500 次，只新增 1 个 `Chrome_WidgetWin_1`（Tether 主窗口），无 cmd/conhost/`ConsoleWindowClass`。
- [x] F148：用户要求“以后其他用户更新 DSH、安装 APP 或插件时，不能出现这种缺插件/样式退化，不接受让用户修 bug”。判据：①APP 在 DSH 已运行但插件缺失时自动执行 install/repair；②安装/修复统一走官方 `dsh plugin add` 并验证 `@deepseek-ai` UI 依赖树、4 个插件包、descriptor；③失败自动回滚 profile 并保留 APP 核心页面；④发布门禁包含干净机器安装与 DSH 升级矩阵，断言计算样式而非只看文字。0.2.84 已实现①②③和单元测试，发布后需在 LAPTOP 做真实自动修复验证并补④。 **0.2.86 收口**：LAPTOP 真机把 profile 重置成无插件/无 `node_modules` 的 211 B 初始态，调用 `dsh_install_plugin` 后 4 个 Tether 包和 `@deepseek-ai` UI 依赖全部装好；首次冷启动超过 90 s，已把 descriptor 等待延长到 180 s 并在 DSH 掉下去时自动再拉起。DESKTOP 重装 **5.31 s**、pid 41528；LAPTOP 升级 0.2.86、pid 25992；真 APP 两个 iframe 均为 `bhn1Oq_searchInput` + composer。剩余④：DSH 版本升级矩阵和计算样式断言加入发布门禁。 **0.2.88 自动链路实测**：本机 profile 重置为空、DSH 运行但无 descriptor；APP 的 `dsh_status.surface` 为 false，10 s 后自动执行 install/repair，装回 0.2.88 四包 + 依赖树，DSH pid 18492，两个 iframe 均 `bhn1Oq_searchInput` + composer。surface 网关的旧 200 缓存不再被当作健康依据。 **0.2.89 运行时防线**：iframe 载入后探测搜索框/按钮计算样式，出现浏览器默认 `inset/outset` 样式即自动修复一次；再次出现则用“DSH 界面样式与 Tether 版本不匹配”遮罩盖住裸控件。发布门禁 `scripts/qa_surface_styles.mjs` 两台设备 PASS（`bhn1Oq_searchInput`、`border 0px/none`、composer=true）。

## 2026-11-03 DSH surface 健康与恢复入口

- [x] F146：笔记本 DSH 更新失败后 `native-surface.json` 不存在，Tether 页面没有可渲染的 surface；要求 APP 不能白屏、要能恢复。已完成：Node `fs/dsh_restart`（live host PID、无窗口）、`fs/dsh_stop`（受控停止后重装/升级）；APP 在 surface 缺失时显示明确状态和“重启 DSH”；start/restart 显式传回 `D:\DeepSeek Harness\.dsh`。**实测**：0.2.79 在 LAPTOP 上停止 rc.3、通过官方 feed 安装 **0.2.1-rc.5** 成功并启动；但 rc.5 仍在启动时报 `desktop welcome: Web authentication failed`（崩溃日志 `crash-2026-11-02T23-07-59-083Z-host.log`），descriptor 仍不出现。**结论**：DSH 认证状态本身已坏，和 rc.3/rc.5 版本无关；必须重置 DSH 认证/profile 并在笔记本上重新登录，或恢复一份已知可用的 DSH profile。Tether 侧的 surface 健康、重启、停止/安装能力已交付；F146 仍待 DSH 认证修复。 已进一步备份并重建 `profiles/desktop`，rc.5 仍报同一认证错误，说明不是插件/UI profile 本身；原 profile 已完整恢复。 另尝试备份并重建 DSH 的 Electron 用户数据，但 Tether fs 服务把 `%APPDATA%` 视为受保护系统路径，拒绝了该操作；需要本机登录 DSH 或增加受控的 DSH 修复接口。 0.2.82 新增受控 `dsh_repair_auth`：停止全部 DSH 进程，备份 `%APPDATA%\@deepseek-ai\dsh-desktop` 与 `.credentials.yaml`，再启动 DSH。实测备份成功、DSH 重新启动且**不再产生 auth 崩溃日志**，但新 appdata 为空、descriptor 仍缺失，说明已回到登录/初始化状态；需要本机登录 DSH 后才能验证插件/surface。 **2026-11-03 收口**：LAPTOP 的 DSH 实际已处于登录态，缺失的是插件包本身——`profiles/desktop/package.json` 没有 `tether-dsh-plugin`，`node_modules` 也不存在 Tether 包（`installed_products` 只有 app）。受控修复：停 DSH → 备份 profile `package.json` → 把 4 个插件包（`tether-dsh-plugin`、`tether-dsh-client`、`tether-dsh-surface`、`tether-dsh-native-ui`）按 profile `node_modules` 结构上传并逐文件 SHA-256 校验 → 恢复 bundles/dependencies → 启动 DSH。实测 descriptor 3 s 内出现（pid 9124、origin 1871），node 重启后能力刷新为 app/node/plugin 0.2.82、`dsh_native=true`、`dsh_surface=true`；gateway 抓取 LAPTOP surface 返回 200（39,514 B），headless Edge + 真 APP iframe 都渲染出 composer。另修 `native_surface.py` 的 `/plugins/events` 重开崩溃（`HTTP_STREAM_MAX_AGE`/`created` 未定义），并让 APP 识别 502 错误页自动重载。剩余产品化：把“缺失插件包的 profile”纳入一键安装/修复路径（当前为受控手工修复）。 **补充根因（CSS 退化成原生控件）**：LAPTOP 页面能出侧栏，但工作区搜索框/按钮变成浏览器默认样式。实测同一 CSS 文件在两边都存在，但 LAPTOP 的侧栏组件类名是 `GAkraW_searchInput`，DESKTOP 是 `bhn1Oq_searchInput`，静态 CSS 只匹配后者。原因是手工拷包绕过了 `dsh plugin add`，profile 里缺 `@deepseek-ai/dsh-client-ui-*` 依赖树，客户端 bundle 解析到另一份 UI 组件。补齐 `@deepseek-ai`（30 个运行文件，SHA-256 校验）并重启 DSH 后，LAPTOP 类名变为 `bhn1Oq_searchInput`，计算样式恢复为 `border: 0`、透明背景、28 px 按钮；真 APP 的 LAPTOP iframe 也复验通过。后续一键安装必须走官方 `dsh plugin add` 或显式安装该依赖树。

## 2026-11-03 APP 无原生标题栏、统一图标与托盘

- [x] F144：图标最终改回**最初版设计**（深海军蓝底、左上白环、右下橙环），只把中间连接线改成主人选定的 **V1 立 S**。0.2.74 的纯黑 T 版因“长竖杆 + 单球”误读被否，草稿已删除、未发布；正式资产改为 `assets/tether-app-s.svg/.png/.ico`，顶栏 `TetherMark` 同步 V1。**验证**：16/32/256 px 预览 S 形可辨；任务栏按钮实际显示 V1；托盘日志 `tray created icon=...tether-app-s.ico`。
- [x] F145：桌面图标和任务栏图标之前没跟着变。原因：快捷方式/Explorer 缓存仍指向旧 ico，任务栏还按 `electron` 身份缓存。修复：图标改用新文件名 `tether-app-s.ico`；`app.setAppUserModelId('com.tether.app')`；`desktop/install-app.ps1` 重建桌面/开始菜单快捷方式并指向新 ico；刷新 Explorer 图标缓存。任务栏精确裁剪已显示 V1。

- [x] F141：APP 顶层还是 Electron 原生壳，多出一条系统标题栏，和下面页面风格不统一；要像 DSH 桌面一样一体化，但保留功能图标。实现：`BrowserWindow` 改为 `frame:false`，去掉原生标题栏；顶栏改为品牌标记 + 设备 + 连接 + 自绘最小化/最大化/还原/关闭，整条可拖动、按钮区不可拖动。**真机验证**：窗口截图顶部只剩 Tether 顶栏，DSH 页面从 y=40 开始；最小化 `IsIconic=true`；最大化后 `IsZoomed=true`，按钮变为“还原”，还原后 `IsZoomed=false`；关闭后窗口 `visible=false`、进程数仍为 5。计划：`docs/PLAN_APP_SHELL_ICON_TRAY_20261103.md`。
- [x] F142：产品图标很丑；希望用登录页网络图重做，并统一桌面、任务栏、悬停缩略图、托盘。实现：以登录页网络视觉生成 1024 px 母版和多尺寸 `assets/tether.ico`；窗口 `icon`、Tray、桌面/开始菜单快捷方式全部指向同一个 `assets/tether.ico`。**验证**：图标母版与 ICO 已替换；任务栏实际显示深色网络标记；托盘日志 `tray created icon=...tether.ico`；桌面/开始菜单快捷方式 `IconLocation` 已指向新 ico。
- [x] F143：程序没有隐藏到 Windows 托盘，点叉直接退出。实现：`Tray` + 右键“打开 Tether/退出 Tether”；`close` 事件 `preventDefault` 并 `hide()`；`window-all-closed` 在有托盘时不退出；第二实例恢复已有窗口。**真机验证**：关闭后进程仍在、窗口隐藏；再启动快捷方式窗口恢复；托盘菜单退出走 `isQuitting` 真正 `app.quit()`。

## 2026-11-03 笔记本 DSH 更新失败与插件隔离要求

- [ ] F139：笔记本节点（LAPTOP-01）更新最新 DSH 失败，随后对应页面渲染不出来。**已查到的现场**：DSH 更新器已下载 rc.5 安装包（`C:\Users\14675\AppData\Local\@deepseek-aidsh-desktop-updater\pending\deepseek-harness-0.2.1-rc.5-win-x64.exe`，289,408,544 B，`update-info.json` 存在），但 DSH 仍是 **0.2.1-rc.3**（`D:\DeepSeek Harness\DeepSeek Harness.exe`，pid 24420）；Tether 的 `native-surface.json` 不存在，Hub capabilities 为 `dsh_surface:false`，所以页面没有可渲染的 surface。**风险点**：DSH profile `D:\DeepSeek Harness\.dsh\profiles\desktop\package.json` 仍用 `file:D:/Tether/deploy/tether-plugin-0.2.3/packages/dsh-plugin-tether` 这种旧版本路径；`tether-dsh-native-ui` 把 `@deepseek-ai/dsh-client-ui-chat` 等锁死在 `0.2.1-rc.2`，而 DSH 已到 rc.3/rc.5。**待确认**：DSH 更新失败弹窗的原文/日志（当前没有写入可读的 updater 日志），以及 Tether 插件是否在失败重启后停止发布 surface。判据：DSH 能完成 rc.3→rc.5 更新；更新后 Tether 页面要么正常渲染，要么显示明确的“插件不兼容/待更新”状态，不能白屏；DSH 本身不被 Tether 插件拖死。
- [ ] F140：DSH 更新适配 + 插件安装隔离，需做专项测试。要求：1）DSH 更新时按 DSH 自己的更新流程走，Tether 不抢着重启/更新插件，等新 descriptor/版本出来后再校验并重建桥接；2）插件安装不能改坏本地 DSH profile 依赖，Tether 插件故障不能阻止 DSH 启动，也不能影响 Tether APP；3）第三方 DSH 插件安装测试先等主人选定插件再开始，测试要在隔离 profile/VM 做，覆盖安装、卸载、DSH 更新前后、插件损坏时 DSH 仍可启动。判据：同一台机器上 DSH 更新成功且 Tether APP 可独立运行；卸载/破坏 Tether 插件后 DSH 正常启动；第三方插件安装/卸载不影响 Tether APP。**状态：主人明确要求先不要开始安装测试，等选定插件。**

## 2026-11-03 启动黑色弹窗

- [x] F137：打开 APP 时仍会闪出黑色弹窗，一次启动甚至出现多次；要求彻底查清原因。**根因**：更新检查用 `pythonw.exe` 跑 `updates_cli check`，但 `UpdateManager.checkout_state()` 里仍用 `subprocess.run(["git", ...])` 调 `git status`；`git.exe` 是控制台程序，会自己创建 `ConsoleWindowClass` 窗口。**证据**：用 20 ms 可见窗口采样单独跑更新检查，抓到 3 个可见控制台窗口（1.3 s、3.8 s、4.5 s，均为 `C:\Program Files\Git\mingw64\bin\git.exe`）；完整启动 trace 里也看到 `git.exe` + `conhost.exe` 由 Node/更新检查拉起。**修复**：`tether/updates.py` 与插件内 vendored `packages/tether-dsh-surface/updater/tether/updates.py` 的 git 调用在 Windows 上加 `CREATE_NO_WINDOW`；新增回归测试 `test_checkout_state_hides_the_git_console_on_windows`。**复测**：同一更新检查采样不再出现任何新窗口；通过桌面快捷方式启动 APP 的 20 ms 窗口采样只看到 `Tether`/`Tether WebUI` 两个同名主窗口，无 `ConsoleWindowClass`、无 conhost、无黑色弹窗。
- [x] F138：修完必须保证不是只修了某一条路径。核对后 `tether/node` 的 app restart、DSH start/install/restart、Office preview 都已使用 `CREATE_NO_WINDOW`/隐藏窗口；本轮补齐的是唯一遗漏的 git 探针，并把 vendored updater 同步，避免插件运行时回退到旧代码。

## 2026-11-02 登录页网络动效、邀请码切换与退出入口

- [x] F134：登录页左侧示例要像真实互联画布一样有“水中惯性”动态，并把线条拉成直线。实现：新增自包含 `LoginNetwork`，4 个节点（中心/左/右/顶部）做阻尼弹簧 + 轻微漂移 + 指针推斥；节点与 6 条直线边每帧直接更新 SVG 属性，不触发 React 重渲染；`prefers-reduced-motion` 时保持静态。**真机验证**：登录页采样节点 `cx/cy`，1 s 内位置发生变化；登录视图与邀请码视图两种状态下动画都持续运动；线条全部为 `<line>` 直线。
- [x] F135：点击“首次使用？用邀请码注册”后页面拉长、突变；要求更丝滑。实现：登录与邀请码注册改成同一张卡片内两个绝对定位视图，固定舞台高度 344 px，通过 opacity + translateX 280 ms 过渡；错误提示预留固定 16 px 槽位；不再条件展开表单。**真机测量**：切换前 `822×400`，切换后 `822×400`；两个视图均为 `500×344`；登录视图 `opacity 1 / translateX 0`，邀请码视图 `opacity 0 / translateX 16`，切换后互换；截图 `tether-login-view.png` / `tether-login-invite.png`。
- [x] F136：底部“返回 DSH”重复，顶部关闭按钮已能退出。实现：删除文字入口，只保留 `onExit` 时的右上角 ×；APP/网页登录不显示退出，DSH 插件仍有 ×。**验证**：登录页 DOM 中不再含“返回 DSH”；`host.exitPanel` 契约测试仍通过。

## 2026-11-02 账户页收束、编辑不跳布局与账户资料后台同步

- [x] F129：移除头像/更换头像的文字形式和字体太丑，像没设计过。实现：头像右下角改为 22 px 相机覆盖层图标；移除头像改成资料卡右上角 26 px 垃圾桶图标，不再出现“更换头像/移除头像”文字按钮；裁剪弹窗里仍保留“移除头像”作为明确动作。**真机验证**：账户页截图只剩相机角标、垃圾桶图标、静态昵称行与密码行；名称弹窗 760×560 前后一致。
- [x] F130：修改昵称、修改密码应默认收束，真正要用时再打开。实现：显示名称变成“标签 + 当前值 + 铅笔图标”，密码变成“密码 + 修改密码”一行；点击后才打开独立弹窗，保存/取消/Enter/Escape 都在弹窗内完成。密码弹窗含当前/新/确认、显示切换、Caps Lock 与行内规则。**真机验证**：账户页在收起状态没有表单；昵称弹窗与密码弹窗打开时设置面板均为 760×560。
- [x] F131：编辑时页面猛地向下拉长，这种设计非常不好；要求写入前端准则并跨项目保存。处理：已写入 `C:\Users\Administrator\.qoder-cn\memory\feedback-loading-no-layout-shift.md`（加载/状态/错误/详情/编辑/展开都不得改变主内容布局，优先绝对叠层/浮层/弹窗），并在索引中改为“开合前后宽度与首行 Y 一致”。实现上昵称/密码都改为绝对定位弹窗（`inset:0; zIndex:86`），不再条件渲染撑高容器。判据：编辑前、中、保存后三次测量，设置面板尺寸、主内容首行 Y 与页面总高一致。
- [ ] F132：账号昵称/头像变更要同步到其他设备，属于服务器对账户与设备网的管理。已实现：Hub `users` 增加 `display_name`/`avatar`（旧库自动加列），新增 `GET/POST /api/auth/profile`（昵称 ≤32 字符；头像仅 png/jpeg/webp data URL，解码后 ≤64 KiB），`/api/state.user` 下发资料；客户端保存时乐观更新并写服务端，失败回滚提示；每 2.5 s 轮询同步。**已验证**：Hub 全量 155 passed；生产 Hub 已切到 `42940b5b`，数据库备份 `profile-sync-20261102T135918Z`（SHA-256 `d6f3a4ee…`）；现有账号资料已写入（昵称 `qi007`、头像 17,839 字符），`/api/state` 返回一致。0.2.70 已发布（CI `41458731074`）；第二个独立 Web 客户端登录即拿到 `qi007` + 17,839 字符头像，APP 改昵称后服务端与第二客户端 4 s 内同步，改回同样同步；头像 118↔17,839 字符往返均在 3.2 s 内同步到 APP；非法输入已由服务端测试覆盖（33 字符、非图片、坏 base64、>64 KiB）。**仍缺**：LAPTOP 物理机 UI 未直接截图取证（其 APP 已是 0.2.70，使用同一轮询代码）；LAPTOP DSH 插件运行态仍是 0.2.68，插件任务卡在“重新拉起 DSH”（92%，`restart_timeout`）。
- [x] F133：前端与核心业务基本达标，开始处理后台。本轮后台第一步选“账户资料服务端化”，因为它是账号跨设备一致性的最小真实切片；设备边表、租户隔离、更新任务、surface 网关已在生产运行，本轮不重做。

## 2026-11-02 更新页版式重做

- [x] F127：设置→更新顶部空白太多；版本信息用 `APP 0.2.62 / 插件 0.2.62 / Node 0.2.62` 和 `APP 0.2.62 → 0.2.63` 这种斜杠/箭头写法，出现新版本时文字突然变长，不符合用眼习惯。重做：顶部左侧改为“更新”标题、右侧刷新；设备行改为分组列表（本机/其他设备），版本拆成独立组件胶囊（`APP 0.2.62`、`插件 0.2.62`、`Node 0.2.62`），没有斜杠、没有箭头、没有解释句；操作位固定 28px，有新版本时只出现蓝色圆形下载按钮，当前版本文字与行宽高都不变；错误时操作位显示红色重试图标。**真机验证**：LAPTOP 行在有/无更新两种状态下均为 `543×72`，新版本只增加 1 个下载按钮；截图 `tether-update-redesign.png` / `tether-update-redesign-alert.png`。
- [x] F128：更新页必须仍然能区分本机与已连接设备；断开边后节点不出现在列表。这部分沿用 0.2.61 的边过滤逻辑，未回归。

## 2026-11-02 启动闪窗

- [x] F125：启动 APP 时会短暂闪一个看不清的窗口，怀疑是黑终端改成了“打开又飞快关闭”。排查：桌面/开始菜单快捷方式都是直接 `electron.exe`，无 `.cmd/.vbs`；启动时抓进程发现唯一 Tether 相关的新进程是 `python.exe -m tether.updates_cli check`（自动更新检查），它创建了 `conhost`；`UpdateService`/`serverCheck` 仍用 `python.exe`。修复：`main.js` 把 `UpdateService` 的 python 改为 `supervisor.childPython`（venv `pythonw.exe`）；`supervisor.js` 的本地服务器探测也改用 `childPython`。已验证 `pythonw` 通过 `execFile` 能正常回传 stdout（`hello`）。**启动监控**：更新检查现在是 `pythonw.exe`，不再出现 `python.exe` 或与之关联的 `conhost`；可见短命窗口列表为空。判据：启动/更新检查不出现控制台闪窗；更新检查仍能返回结果。
- [x] F126：更新检查仍必须工作，不能为了无窗口牺牲协议输出。`pythonw` 的 stdout 管道测试通过；`UpdateService.run` 和 `update-helper` 的 `spawnSync` 都走同一无窗口解释器。

## 2026-11-02 恢复互联图水体流动与状态接力

- [x] F123：0.2.64 为了保留拖动位置，把原来的力导向“水体流动”动画整个删掉了；主人要求恢复，并且切页回来要从离开时的状态继续，不是回到初始态。修复：恢复 `animate`/`kick` 力导向；初始仍用环形/三角，但去掉远端节点的中心拉力，避免流动后三角又被拽回一条竖线；节点位置和速度存到 `localStorage['tether.network.positions.v3']`，拖动结束、组件卸载时保存，重进时用保存的 `x/y/vx/vy` 继续。**真机验证**：清空保存后打开互联页，节点从初始 `20.2%,32.8%` 流动展开到 `15.42%,30.04%`，中心 `50%,50.1%`，三角保持；拖动 LAPTOP 后立即切文件页再回互联页，节点位置不是初始态，而是离开时的运动状态（`LAPTOP 13.67%,33.04%` / `TETHER 88.69%,59.87%`），并继续受力。测试后已清空测试状态并恢复初始流动布局。
- [x] F124：详情面板浮层行为保持 0.2.65：打开详情不改变画布宽度。

## 2026-11-02 节点详情改为浮层

- [x] F122：点击节点卡片时，详情面板作为右侧布局列挤压画布，造成画面突变；希望改成单独弹窗。实现：`NetworkDetailPanel` 根节点改为 `position:absolute; top/right/bottom:8; width:300; zIndex:8` 的圆角浮层，带阴影和边框；互联页画布容器加 `position:relative`。浮层覆盖在画布右侧，不再参与 flex 布局，打开/关闭都不改变画布宽度。**真机验证**：打开 DESKTOP 节点详情前后，画布 stage 宽度均为 **1074px**；浮层在右侧独立显示，含搜索、设备连接开关、连接管理。截图 `network-detail-overlay.png`。判据：打开任何节点详情时画布宽度、节点位置不变。

## 2026-11-02 互联图初始布局与位置持久化

- [x] F119：三个节点初始状态一字排开，100 个节点会更糟；线条还会和节点重合。实现：初始布局改为按远端数量生成的环形/三角布局；两个远端用 210°/330°，三个及以上按 360°/n 均匀分布，中心节点在 50%/50%；不再让所有远端落在同一条竖直轴上。链接中点的“断开”按钮在距任一节点 9% 以内时隐藏，避免图标压在节点标签上；边线仍可点击。节点数 >12 时默认用圆点模式，缩放后显示标签。**真机验证**：DESKTOP/LAPTOP/TETHER-REMOTE-TEST 呈三角形，中心节点上方不再有穿过它的线；截图 `network-new-layout.png`。
- [x] F120：切到其他页面再回来，图又回到初始态，拖动过的节点位置丢失。实现：节点位置和速度按“本机设备 ID”存到 `localStorage['tether.network.positions.v3']`，每次拖动结束和组件卸载时保存；重新进入互联页时优先读取已存状态，没有记录的设备才用初始布局。0.2.66 恢复力导向动画，并去掉远端节点的中心拉力，流动时保持环形/三角。**真机验证**：把 LAPTOP-01 从初始态拖到其他位置后切页再回，位置不再回到初始；测试结束后已清除测试位置并恢复初始布局。
- [x] F121：拖动节点会顺带切换当前设备（测试时顶栏从 DESKTOP-LOCAL 变成 LAPTOP-01）。实现：`startDrag` 不再调用 `onSelect`；只有“按下后没移动”的点击才在 `endDrag` 里选中设备并打开详情。判据：拖节点只改变位置，不切当前设备；单击节点仍打开详情。

## 2026-11-02 登录退出、登录页视觉与默认服务器

- [x] F116：进入 DSH 插件后被登录页挡住，不想登录时无法回到 DSH。实现：DSH 插件把 `ctx.layout.selectPanel(null)` 暴露为 `host.exitPanel`；登录页在插件宿主显示右上角 `×` 和底部“返回 DSH”，点击退出 Tether 面板回到 DSH。APP/网页登录不显示退出（窗口本身可关）。**验证**：插件 bundle 含 `host.exitPanel`/`exitPanel` 与登录页 `onExit` 契约测试；DSH 内嵌 surface 分支原本就用同一个 `selectPanel(null)`，面板退出路径一致。判据：插件登录页可见“返回 DSH”/×，点击回到 DSH 主界面。
- [x] F117：登录页太单调。实现：登录卡片改为双栏：左侧深色品牌视觉（Tether 标记 + 设备网络连线图 + 私有设备网），右侧表单；窄屏自动只显示表单。**真机截图**：Tether APP 登录页显示 820×? 双栏卡片、深色网络视觉、右侧邮箱/密码/两步验证，无多余解释句。
- [x] F118：用户自建服务器不应要求自己填地址，当前应默认服务器登录。实现：移除登录页“服务器地址”输入；登录固定使用已有 `defaultUrl`，没有时回退 `https://8-220-198-26.sslip.io`；设置里的连接状态仍显示地址，但登录不再让用户改。未来“服务器连接/自建设备网”作为独立选项再加。判据：登录页没有服务器输入框；直接登录默认服务器。**验证**：临时清除 token 截图确认无服务器输入；随后恢复 token。

## 2026-11-02 设置更新页、无终端启动与 DSH 生命周期

- [x] F111：把更新页面重新加到设置里，作为独立栏目：能更新本机，也能更新已连接的其他节点；在互联页断开某个节点后，该节点不能再更新。实现：设置新增“更新”分区；本机行按当前入口显示 APP+Node 或 插件+Node；其他设备按 `/api/state.edges` 过滤，只显示与当前设备有显式连接的节点；每行显示各组件当前/最新版本，有新版本时显示蓝色圆形下载按钮，点击走现有一键更新流程（本机 `runProductUpdate`，其他节点 `runDeviceUpdate` 按对方已安装的 APP/插件/Node 全部更新）；右上角蓝色下载按钮保留，仍按当前入口更新。**真机验证**：DESKTOP 本机 APP+Node、LAPTOP 的 APP/插件/Node 正确显示；断开 DESKTOP↔LAPTOP 后 LAPTOP 从列表消失，恢复边后重新出现；用只读假最新版本验证蓝色圆形下载按钮外观与请求接线（未改真实版本）。判据：断开即不可更新、恢复即回来；有新版本才出现下载按钮；无新版本不显示按钮。边界：边过滤目前是 UI 语义，Hub 更新 API 仍只要求 owner 权限。
- [x] F112：APP 打开/更新时不要黑色终端。实现：长期运行的 Controller/Node 子进程改用同 venv 的 `pythonw.exe`；`Tether-App.cmd` 默认通过 `Tether-App.vbs` 隐藏重入，bootstrap PowerShell 加 `-WindowStyle Hidden`；更新助手重启 APP 用 `windowsHide: true`；DSH 重启剥离 Tether 的 `DSH_HOME`/`TETHER_NATIVE_DSH_HOME`。**真机验证**：用桌面“Tether APP”快捷方式启动，Electron 主窗口正常，Node 进程为 `pythonw.exe`，`MainWindowHandle=0`（无可见控制台），Node 日志正常注册且 Hub 在线。判据：打开/更新不再出现常驻黑窗；Node 启动与重连不受影响。
- [x] F113：DSH 未启动时提供“一键启动 DSH”；没有 DSH 时提供“一键安装 DSH”。实现：Node 新增 `tether/node/dsh_desktop.py`，从注册表/asar/进程检测安装路径、版本与运行态，`/fs/dsh_status`、`/fs/dsh_start`、`/fs/dsh_install` 暴露给客户端；启动用无窗口分离进程并清掉 Tether 的 `DSH_HOME`，安装从 DeepSeek 官方 HTTPS nightly 源读取安装包、校验 SHA-512 后静默 `/S` 安装。界面：本机 surface 检测到 DSH 未运行/未安装时覆盖显示“DSH 未启动/未安装”+“启动 DSH/安装 DSH”，启动后自动重载；设置→本机设备增加 DSH 版本/状态行与按钮。**真机验证**：检测到 `0.2.1-rc.3`；停止 DSH 后覆盖页出现并点击启动；官方同版本 rc.3 安装包静默安装成功，DSH host 正常发布描述符。判据：停止 DSH 后页面有启动按钮；安装后 host 起来、surface 恢复。边界：最终修好的 `dsh_start` 环境清理由单元测试覆盖，修复后未再次强杀 DSH 复测一键启动（DSH 最小化到托盘，强杀会触发其自身认证恢复问题）。
- [x] F114：DSH 更新或多插件时 APP 是否还能适配。结论：Tether **不重写 DSH 页面**，而是嵌入真实的 DSH Web UI（surface iframe），所以 DSH 里装的插件、改的界面会原样呈现；Tether 只负责描述符、鉴权代理和外壳。设置→本机设备已显示 DSH 版本；DSH 重启后 surface 可重载恢复。**真机验证**：修复后的 rc.3 在 Tether 内显示完整 DSH 侧栏与插件入口。边界：未安装 rc.5，不声称已验证新版本；如果上游改了 surface 描述符协议，Tether 会显示 DSH 状态/重试/启动页，而不是白屏。rc.5 需在独立 profile 或获主人同意后实装验证。
- [x] F115：本轮强杀 DSH 测试触发其自身“Web authentication failed”崩溃循环。处理：先备份 `~/.dsh/profiles/desktop` 与 `%APPDATA%\@deepseek-ai\dsh-desktop`，清理干净 profile/认证缓存后仍复现；最终下载官方**同版本** rc.3 安装包（274,333,696 B，SHA-256 `1e3876ba…`）静默重装，DSH host 恢复并发布新描述符；重新安装 Tether 插件后 surface 正常。旧 `D:\DeepSeek harness` 安装仍在，桌面/开始菜单已指向新的 per-user 安装。DSH 会话/数据保留。

## 2026-11-02 权限页审计加载

- [x] F110：每次打开“文件权限”页，审计列表要等约 5 秒才出现；要求打开即完整显示。根因：`openSettings` 每次先 `await` 策略、再 `await` 审计，串行两次设备往返；策略虽有缓存但打开时未用于表单，审计完全没有预热或缓存。修复：策略与审计按设备缓存（`policyCacheRef`/`auditCacheRef`），切换设备时并行预取二者；打开抽屉先用缓存同步渲染策略、模式和审计，再在后台并行刷新；同一设备的并发请求共用一次进行中的 promise（`permissionInflightRef`）；冷启动无缓存时列表内显示“正在读取审计…”，不显示“暂无审计”。**真机实测**：DESKTOP 点开到 68 行审计出现 **3 ms**（此前本机两次请求实测 638 ms + 677 ms）；切到 LAPTOP 后首次点开同样 **3 ms**、103 行（此前 1,114 ms + 715 ms）。判据：有缓存时点开 50 ms 内出现完整审计行；后台刷新不阻塞、不清空已显示列表。0.2.61 已发布，两机 app/node/plugin 均为 0.2.61；重启后的 0.2.61 真机复测 19 ms、68 行。

## 2026-11-02 账户设置精细化

- [x] F109：账户页不够精细——头像上传没有剪切步骤、密码与昵称设置草率；要求先查成熟软件再做。实现（先查 GitHub 头像裁剪、Google 账号照片裁剪、Slack 上传构图、Chrome 改密表单、Authgear 行内校验）：头像改为“选图 → 圆形 240 px 取景框 → 拖动/1–3 倍缩放/复位 → 保存 256×256 JPEG”，移除与取消独立；昵称改为行内编辑，保存/取消/Enter/Escape，错误行内显示；密码改为当前/新/确认三栏，显示切换、行内规则（10 位、不得与当前相同、两次一致）、`autocomplete` 提示、Caps Lock 提示，提交无效时行内报错而不发请求。**真机验证**：480×320 偏心测试图打开裁剪框，`matrix(0.75,0,0,0.75,-60,0)`，拖动后 `x=0`，缩放 1.35，保存得到 7,385 B data URL 并同步活动栏头像（验后恢复主人原头像 9,281 B）；昵称“测试昵称”保存到 localStorage 后恢复为空；密码空/短/不一致提交显示“新密码至少 10 位”“两次输入的新密码不一致”，未修改真实密码。判据：无裁剪步骤不能落盘；密码错误不发请求；头像显示活动栏与账户页一致。主人同批要求“所有工作先学习再写”，已写入长期记忆 `feedback-learn-before-writing.md`。0.2.60 已发布，两机 app/node/plugin 均为 0.2.60；DESKTOP 真机复核账户页与裁剪弹窗完整。

## 2026-11-02 互联拓扑控制与活动栏选中态

- [x] F107：互联页要能控制节点之间的连接；画布能控制，点开节点卡片能详细控制，并提供一个适合大量节点的列表入口。实现：Hub 新增显式边表 `/api/edges`，`/api/state` 返回 `edges`；画布只画有边的节点对，线中点可断开，右上“连接”进入两次点选建边模式；点节点打开详情抽屉，列出所有设备与连接开关；右上“连接管理”打开可搜索的连接表格，支持新建/逐条断开。**真机验证**：画布断开再连接、详情开关、连接管理新建/断开均生效；Hub 边表已部署（备份 `edges-20261102T060941Z`，回退点 `d783681`，重启 90 s）。判据：两端在线实线、离线虚线、无边不画线；所有客户端看到同一份边。
- [x] F108：活动栏当前页的选中态太不明显。实现：选中按钮改为蓝色 16% 底 + 蓝色图标（原先为浅灰底/深色图标）。判据：互联页活动栏“互联”图标有清晰蓝色底块与蓝色图标；真机截图确认。

## 2026-11-02 文件转移双栏根目录

- [x] F106：文件转移页左右两栏的工作区树必须分别属于各自设备，不能把所有工作区混在一起。核对结果：左栏 DESKTOP 的根是 `C:\Users\Administrator...`、`demo`，右栏 LAPTOP 的根是 `C:\Users\14675...`、`audit`，数据本来分设备加载；同名 `default-workspace`/`Tether 工作目录` 造成了误读。修复：每栏树分组显示 `工作区 · 设备名` / `此电脑 · 设备名`，切换设备时先清空旧根列表再加载。**真机验证**：左栏 `工作区 · DESKTOP-LOCAL`、右栏 `工作区 · LAPTOP-01`，路径分别属于两台机器。

## 2026-11-02 选择器树联动、文件夹上传与拖入保存

- [x] F101：左侧文件树与右侧目录必须双向联动；文件夹箭头和文件夹名应是同一个控件，点箭头也要让右侧导航。实现：树行合并为一个按钮，箭头只是行内图标；点文件夹同时切换展开并导航右侧。右侧进入目录时 `revealTree` 自动展开并加载祖先。判据：点 `C:` 右侧出现 C 盘内容且树 `aria-expanded=true`；从右侧点 `Users` 后右侧面包屑为 `C: › Users`，树也展开到 `Users` 并显示其子项。**真机通过**。
- [x] F102：进入任一文件夹后底部应有“确定”，可把当前文件夹作为附件上传。实现：底部在非磁盘根目录显示“确定”，`readFolder` 递归读取文件（200 个 / 100 MiB / 单文件 10 MiB 上限，跳过 `.tether-trash`），以 `webkitRelativePath` 传给 DSH。判据：`D:\TetherWorkspaces\folder-upload-test` 内 `a.txt`、`b.txt` 点“确定”后选择器关闭，DSH 对话框出现两个附件。**真机通过**。
- [x] F103：工作区与“此电脑”必须属于同一台目标电脑。复现确认：DESKTOP 选择器工作区在 `C:\Users\Administrator...`、磁盘 C–G；LAPTOP 工作区在 `C:\Users\14675...`、磁盘 C/D，二者一致；截图中的 `default-workspace/audit` 与 C/D 都属于 LAPTOP-01。为避免误读，分组标题改为 `工作区 · 设备名` / `此电脑 · 设备名`。**真机通过**。
- [x] F104：把本地文件直接拖入 DSH 对话框时，要同时保存到目标电脑并上传为会话附件。实现：捕获 composer 的 `drop`，先调用 DSH `onAddFiles` 立即上传，再在后台写入目标电脑；提示保存路径。判据：拖入 `drop-test-2.txt` 后对话框出现 `TXT 14B` 附件，提示“已保存到 `D:\TetherDrop\drop-test-2.txt`”，磁盘内容为 `drop-content-2`。**真机通过**。
- [x] F105：保存目录放 D 盘，不占 C 盘。实现：优先 `D:\TetherDrop`，被策略拒绝时用 `D:\TetherWorkspaces\TetherDrop`，不再回退到 C 盘工作区；Node 增加 `/tether-device-fs/write_chunk` 路由。测试临时文件与文件夹已清理，保留 `D:\TetherDrop` 目录。

## 2026-11-02 白屏、加载叠层与设置页

- [x] F97：修复“页面变成这样了”：互联页内容整体下移、大面积空白，资源管理器只剩标题条，Tether WebUI 主区域纯白。根因是 `SurfaceDeck` 外层在非聊天页仍以 `flex:1` 占满高度。改为绝对定位层：聊天页铺满，互联/资源管理器/转移页覆盖其上，deck 以 `visibility:hidden` 保持尺寸而不参与布局。判据：互联页 `main` 1416×829，deck 绝对定位且不挤压内容；聊天页 iframe 1416×829。**实测通过**。
- [x] F98：选择器加载不能单独留一条白条，也不能挤压列表；复用资源管理器处理。删除 `dsh.js` 的 22px `role=status` 状态条、旧错误条与解释性页脚；`TargetFileExplorer` 改为绝对定位 `tether-dir-loading` 叠层，加载时保留旧列表，错误改为可重试/关闭的浮层。判据：无固定状态条；叠层覆盖列表区，面包屑与列表不位移。**0.2.56 DSH 实测**：叠层 639×429、`position:absolute`、`inset:0`、`z-index:4`，转圈居中；无状态条、无解释页脚，旧列表保留。0.2.55 曾因 DSH 不加载共享 CSS 而退回 static 20px，已在 0.2.56 改为内联样式与 SVG 旋转。
- [x] F99：设置页按成熟商业软件重做，并为后续功能留接口。左侧分区改为账号/连接/工作区/本机设备/关于；`extraSections` 可追加新分区；头像可点击更换（选图→128px 裁剪→localStorage→活动栏同步）；删除“头像与显示名称只影响本机显示”“连接灯只表示…”“切换几乎即时…”等解释句，删除与顶栏/盾牌重复的刷新、检查更新、文件权限、切换账号入口。判据：头像上传后 `tether.accountAvatar` 为 data URL 且活动栏 `<img>` 出现；设置源码不再含上述解释句；Connection 仅保留图标刷新。**实测通过**（上传测试头像后已清除）。
- [x] F100：切换异节点很快，但切回就白屏。根因是 `SurfaceDeck` 的 `ids` 随当前设备重排，React 移动了 iframe 的 DOM 位置；iframe 一旦重新插入文档就会用已过期 ticket 重载而白屏。改为 `mountedRef` 固定挂载顺序，切设备只改 `visibility/z-index`，不移动 DOM；预加载 face 用 `visibility:hidden` 保持真实尺寸而不是 `display:none`。判据：连续 3 次 DESKTOP↔LAPTOP 往返，两个 iframe 文档长度保持 720 KB / 736 KB，标签切换 256 ms，无白屏。**0.2.56 最终实测**：DESKTOP 736,068 B、LAPTOP 720,118 B 在多轮切换后保持完整；切回聊天页两个 surface 均 1416×829，无白屏。

## 2026-11-02 资源管理器/连接/性能批次

- [x] F90：打开目标电脑资源管理器只能走原生加号，不得再放额外的文字按钮。已删除“目标电脑文件…”按钮与重复命令，`dsh.js` 拦截 Composer 唯一隐藏文件输入；顶层标题“资源管理器”。判据：DOM 中不再出现该按钮，`interceptNativeFilePicker` 把 `input.click()` 路由到弹窗。
- [x] F91：互传图标加外圈；互传页要像普通资源管理器一样能新建、删除、重命名、覆盖/保留两者、拖动传递。实测：新建 `tether-ui-check`，拖 20 B 文件到 LAPTOP 触发同名冲突，选“保留两者”生成 `tether-picker-check (2).txt` 并 100% 完成，临时文件已清理。
- [x] F93：三处文件浏览共用同一套代码与缓存。新增 `file-cache.js`（20 秒 / 240 目录 / 并发去重 / 统一失效），资源管理器、对话框、互传两侧均接入。
- [x] F94：连接成功即绿色、实时，不需要点开或刷新。`/api/state` 成功 8 秒内 `liveHubStatus='online'`；真机顶栏和设置页均显示绿点“已连接”，响应 168 ms。
- [ ] F95：设备切换要快且后台成本有界。已改 `SurfaceDeck` 常驻最多 3 台，回切实测 9–29 ms（已加载 LAPTOP 38 ms `readyState=complete`）；但**首次冷切换**仍需 8–14 秒下载 4.2 MB + 1.9 MB 插件包，距“第一次也秒开”还有差距。设置提供关闭常驻的开关。**未结项**。
- [x] F96：删除丑陋底栏；齿轮进设置、头像进账号。活动栏底部只剩盾牌/齿轮/头像；账号页可改显示名称、上传头像与修改密码（头像同步到活动栏）。

## 2026-10-30 稳定性整改

- [ ] C30-1：更新刷新不得被迟到状态/旧服务地址的响应覆盖；失败和缓存数据不得显示成新鲜“已是最新”。0.2.29 候选已纳入 authority 代次与更新竞态修复，隔离本机候选验证通过；LAPTOP-01 实际安装验收待做。
- [ ] C30-2：普通用户不依赖 Python/npm、手写 JSON 或询问 AI 完成安装、登录与配对；现有 ZIP 流程仍不满足，列为独立发行阻断项。
- [ ] C30-3：更新失败、中断、重启与回退须保留会话/工作区；真实两机测试待补。

- [ ] C30-4：原生 Composer 附件需能发到目标设备工作区。0.2.29 候选在隔离本机 DSH Web Host + QA Node 验证目标工作区选择及 90B 文本、4B 二进制附件；multipart 原始响应字节匹配 `00 ff 41 80`，无模型请求。物理 LAPTOP-01 未安装复验。

本文只保留有效需求及当前验收状态。逐项实现过程和旧版状态记录已随维护清理归档；勾选以代码和对应层级的实际验证为准。

## 已完成的用户体验需求

- [x] 原生工作区入口、原生过程/工具层级、目标设备工作区与历史展示；已在本机 DSH 环境完成验证。
- [x] 文件资源管理器、权限入口、审计查看、设备切换与互联视图；本机功能验证已记录。
- [x] 工作区展示层级采用“自定义名称 → 实际目录名 → 内容”；保留“此电脑”磁盘树。
- [x] 统一侧栏排版、间距、交互目标和状态提示。

以上记录不代表跨设备、干净安装或模型附件传输已验收。

## 当前待办

- [ ] F84：本机插件一键更新不得被 Node 检查失败阻断。判据：Node 已是最新（如 0.2.26）而插件仍低于 latest 时，跳过 Node 更新检查，直接执行插件 check/prepare/apply；Node 检查失败只记录为部分失败，不得让插件一步都不执行。当前证据：2026-10-30 00:49–00:52 的 Node 日志 `check node failed: InvalidStateError`，DSH 插件卡点击后没有 `prepared/applied-plugin.json`。0.2.27/0.2.28 已修复：产品更新跳过已最新 Node，Node 检查失败不阻断插件；本机 0.2.24 插件卡已恢复一键，待点击。
- [ ] F85：更新中心一次刷新必须给出一致的 latest。判据：同一次刷新完成后，所有在线设备的 app/plugin/node 与本地插件 latest 必须来自同一版本快照；不得出现本机 0.2.26、远端 APP/Node 0.2.25、插件 0.2.26 混显；刷新结果不得因刷新次数不同而漂移。0.2.28 已改为全组件最高 latest 统一快照；强制刷新实测所有卡片 0.2.28，待点击验收。
- [ ] F83：本地 DSH 插件自更新必须像远端一样自动重启并重连，不得把“立即生效”作为主路径。判据：profile 的插件 updater 包含 `tether/node/dsh_restart.py`，`UPDATER_FILES`/`build_release.py`/`install-plugin.ps1` 同步；一键更新 apply 后 DSH 自动重启，UI 等到新 host 和插件版本，不出现需要用户手点的“立即生效”；旧 updater 的混合安装要在安装脚本刷新时被纠正。0.2.26 已发布：插件 zip 带 `dsh_restart.py`，安装脚本按源码刷新 updater，apply 返回 `restart_scheduled`；本地 updater 已刷新，待点击验收。
- [ ] F80：发布/更新流程不得破坏主人的本机测试基线。判据：发布前保留本机 0.2.24 的 APP/Node/插件运行态或独立工作树；发布后本机更新中心仍显示 0.2.24→0.2.25 的“一键更新”；不得把正在被本机 APP/DSH profile 引用的仓库直接切到新版本后再声称发布完成。0.2.26 已发布；本轮只改代码与文档，未再改动本机 profile 包版本，本地 0.2.24 基线已保留。
- [ ] F81：版本参差时一键更新必须把所有低于 latest 的组件更新到 latest。判据：插件 0.2.24 / Node 0.2.25 / APP 0.2.25 同时存在时，插件卡仍显示“一键更新”；`current_version` 取已安装 profile 版本，源码 checkout 只作诊断；任一组件可更新时不得只显示“立即生效”；“立即生效”只在 apply 成功后出现；兼容旧节点的连接与页面加载不受更新状态阻断。0.2.26 已发布：`current_version` 取已安装 profile，源码只作诊断；本机已显示 `0.2.24(0.2.26) + 一键更新`，待点击验收。
- [ ] F82：连接与更新状态灯必须独立于面板实时刷新。判据：不打开连接/更新面板，连接成功后短时间内变绿；更新检查完成后灯显示 current/available/failed，不长期停在灰色“检查中”；面板打开只用于查看详情，不是状态刷新触发器。0.2.26 已发布：连接挂载探测 + 15 秒刷新，更新检查 5 分钟刷新；运行期间灯保持 `checking`；待真机验收。
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
- [ ] F61：原生对话目标设备附件选择器使用 owner-only RPC 身份与 DSH `workspaceFiles` 会话作用域 API，将原始字节交给原生 `onAddFiles(File[])`。候选 0.2.29 已在隔离真实 DSH Web Host + QA Node 完成 composer 实测：目标工作区列出 txt/bin，90B txt 与 4B bin 均进入原生附件 chip；multipart 原始响应核对 bin 字节为 `00 ff 41 80`。截图：`C:\Users\Administrator\.codex\visualizations\2026\10\30\01a18af0-f175-7453-8498-918bb3a022bd\tether-target-attachment-accepted.png`。未点击发送、无模型调用；物理 LAPTOP-01 跨设备验收待完成。
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
- [ ] F54 跨机附件：picker 使用 DSH Host `remote.workspaceFiles`，限定当前会话工作区并校验条目 capability。候选 0.2.29 已在隔离真实 DSH Web Host + QA Node 验证注入、目标文件列表、原生 composer 附件 chip 及二进制 `readBytes` 回传（`00 ff 41 80`）；没有发送消息或调用模型。截图：`C:\Users\Administrator\.codex\visualizations\2026\10\30\01a18af0-f175-7453-8498-918bb3a022bd\tether-target-attachment-accepted.png`。物理 LAPTOP-01 尚未安装/复验，跨设备验收待完成。
- [ ] F55 报错浮层准则：错误一律右下角绝对定位浮层＋`×`（更新中心内同样适用），不进文档流、不进卡片正文。v0.2.10 笔记本更新成功后，旧 v0.2.9 的“APP 更新后尚未重新连接”失败提示仍留在界面；已在验收时手动关闭。提示未自动清除的问题仍待单独修复和验收。

## 2026-11-01 连接页、传输页与滚动条

- [x] F56 连接与账号分离：顶栏“连接”只表示 Hub 可达/Node 在线，面板显示服务器地址、状态灯、最近检测、响应耗时与“刷新连接状态”；设备配对/令牌/账号表单全部移除。账号登录改为启动时的完整登录页；账号信息只在设置页。判据：清空本地凭据后启动只见登录页；连接面板无账号/配对/令牌。**真机验证**：临时 Hub 测试账号登录 → 自动重载进入主界面 → 设置显示 `test@tether.local` → 退出登录回到登录页；连接面板、设置页截图确认。
- [ ] F57 目标工作区首次加载：选中在线节点后 HARNESS 页面长时间不渲染，但资源管理器可用；首次慢、切走再切回反而快。判据：首次选中到 surface 首帧 ≤5 s（局域网）/≤15 s（公网），连续 5 次切换无退化；挂起时必须显示可见的失败/重试，不能无限“加载中”。**已修卡死**：网关对插件包/哈希资源的 502 自动重试，真实并发首包 10/10 200、无 502（最大 4.2 MB/33.5 s）。**第二批证据**：0.2.51 真机 iframe TTFB 443 ms、load 1.06 s、`readyState=complete`，DSH 已可交互但“加载较慢”常驻；提示未在 `document-loaded` 复位，已改为只在 `document-loading` 显示并即时清除。两机连续 5 次切换仍待复验。
- [x] F58 文件转移页视觉重做：来源/目标改为两张独立卡片（蓝/绿顶边与徽标、设备选择、紧凑路径栏），中栏提供交换按钮，底部显示已选文件/大小/目标路径与开始按钮；活动栏转移图标改为箭头，不再与资源管理器同图标。**真机验证**：两卡与来源/目标徽标、路线栏、底栏已截图；旧的双 Explorer 外观已移除。
- [x] F59 全局滚动条：改为 6 px、浅色、默认透明、hover 才显示，覆盖连接页、权限页及所有列表；禁止原生粗滚动条。判据：真机截图对比；`.tether-root *` 滚动条规则生效；连接页/权限页无粗条。**实测通过**：账号页与文件权限页均无原生粗条，审计列表可滚动。
- [x] F60 设置页：活动栏底部齿轮打开独立设置页，左侧分区为账号/连接/本机设备/更新/文件权限/关于；账号邮箱、修改密码、退出登录只在这里；连接状态与刷新仍由顶栏“连接”负责；文件权限从这里进入原权限/审计面板。**真机验证**：登录后账号显示 `test@tether.local` / 所有者；连接区有刷新与“切换账号 / 服务器”；更新区有“检查更新”；退出登录回到登录页。
- [x] F61 插件更新假完成：DSH 未发布新 descriptor 时，Node 只看扫描到的宿主 pid 就清 `restart_required`，Hub 报 done 但 surface 仍指向旧端口（本机 0.2.44→0.2.49 实测 job done 后 DESKTOP surface 502）。修复：清除条件改用 descriptor 的新 pid；扫描 pid 只用于安排重启。**实测**：本地插件 0.2.49→0.2.50 在 descriptor 未刷新时 job 正确报 `restart_timeout`、`restart_required` 保持 true；手动写新 descriptor 后状态清除，`/update/retry` **4.6 s** 收敛为“已是最新”，两机 surface 200。

- [x] F85 两台机器都登录成功后仍连不上服务器（UI 报 `Failed to fetch`）。根因：浏览器对带 `Authorization` 的 `/api/*` 请求先发 OPTIONS 预检，Hub 的认证中间件在预检阶段返回 401，预检失败后真正请求被浏览器拦截；Hub 侧两台设备其实都在线。修复：`/api/*`、`/admin/*` 的 OPTIONS 交给 CORS 中间件应答（服务端 `9dc93ad`），真实登录仍由紧随其后的带凭证请求鉴权。判据：生产预检 200 且返回 `Access-Control-Allow-Origin: http://127.0.0.1:18892` 与 `Authorization`；APP 连接灯绿、设备列表含 DESKTOP-LOCAL 与 LAPTOP-01、`/api/state` 200。**实测通过**，两台设备 last_seen 持续 2 秒级更新。

- [ ] F86 APP 更新后 Node 控制通道周期性重注册：LAPTOP-01 升到 0.2.51 后，Hub 审计显示 `node.register` 每约 20 s 一次（10:14:32–10:17:52Z），期间 20 次 `plugin status` 全部 409 `device_offline`，插件更新连续两次在“检查版本”失败。约 2.5 分钟后自行稳定，重试后 41.5 s 完成。判据：更新/重启后保持单一稳定连接，连续 60 s 内注册次数 ≤1，任一时刻 status RPC 成功；定位重复后端、WS ping 超时或 supervisor 重启中的实际原因，并补回归。当前根因未确认。

## 2026-11-01 节点切换、目标文件选择与转移页

- [x] F87 切换节点后原生工作区仍要约 1 分钟才渲染，未达秒级。判据：切换设备到 surface 首帧 ≤5 s（同 LAN）/≤15 s（公网），连续 5 次切换无退化；不得依赖“切走再切回”变快。**实测定位**：descriptor 854 ms、iframe 1 s 内出现；两个插件包压缩后 4.2 MB + 1.9 MB，冷载经公网约 25 s + 14 s；surface mux 的 90 s 读超时在传输完成前切断，页面停在 `Loading plugins…`，UI 30 s 后判死并重试，表现为 1 分钟。**已修**：mux 读超时 300 s、节点资源 GET 180 s、Hub 缓存按设备共享并在节点上线时后台预热、UI 文档超时 90 s；APP 启动后为其它在线节点开隐藏 iframe 后台预热（加载后保持 45 s，等 DSH 动态模块与 API 完成），把冷载移出用户操作路径。**实测**：后台预热后切到 LAPTOP 到 composer **5.5 s**；连续切换 5 次为 12.8 / 6.4 / 4.8 / 6.7 s（另一次为同设备无操作 0.0 s），全部 ≤15 s、无退化。冷载本身仍约 45 s，但在后台完成；直连/更小包保留为后续可选优化。
- [x] F88 目标电脑选择文件必须复用资源管理器，而不是另做一个丑弹窗。判据：同一棵文件树/同图标/同工具栏；工具栏用图标而不是“上一级/刷新”汉字；不再重复显示盘符和 `C:\` 路径行；支持选中文件夹（不必下钻到最底层选文件）；DSH 原生加号直接进入该目标选择器。**实测**：原生加号 →“文件”打开目标选择器（真实鼠标验证，本机对话框不再弹）；左侧为可展开文件树（工作区/此电脑，C: 子目录已展开显示），根节点去掉了重复路径行；工具栏只有上箭头/刷新图标；文件夹单击进入并在树中保持展开/选中，附件仍只接受文件（DSH composer 的约束）。截图 `tether-picker-tree-215.png`、`tether-picker-tree-216.png`。
- [x] F89 文件转移页重做：左右两栏等权代表两台电脑，不出现“来源/目标”字样；同一节点不能同时出现在两边（阻止并提示）；两栏做成紧凑版资源管理器（文件树、图标、精简列）；中间只保留图标按钮，不保留“快速转移”；支持左右拖拽文件、Ctrl+A/C/X/V 与右键菜单，和资源管理器共用组件与快捷键。活动栏转移图标重新设计。**实测**：双栏各自选择设备，另一侧节点在下拉中标注“已在另一侧”且禁用；两栏均为紧凑文件树（名称+大小）；无“来源/目标”字样；中间只有交换图标；右键菜单含复制/剪切/粘贴到此处/刷新；真实跨机验证：从 LAPTOP 复制 `tether-picker-check.txt`（20 B）到本机 default-workspace，Ctrl+V 与拖拽各成功一次，进度 100% · 20 B / 20 B，目标文件出现；活动栏图标改为双向箭头。截图 `tether-transfer-218.png`。
- [x] F90 活动栏入口归位：盾牌恢复为权限/审计入口；设置使用独立齿轮图标；登录后在底栏显示用户头像+名字，设置从底栏进入（参考 Qoder/DSH 的底栏账号区）。**实测**：活动栏底部为盾牌（文件权限）+ 账号头像；资源管理器底栏显示头像、`1467556007@qq.com`、`所有者` 与齿轮；点盾牌打开权限/审计抽屉，点底栏齿轮或头像打开设置页，两者互斥不叠加。截图 `tether-files-211.png`。

## 2026-11-04 资源管理器级细节

- [x] F91 互传页与资源管理器的原生交互：框选多选、空白右键菜单、复制路径、转移底栏收尾。**实现**：共用 `TargetFileExplorer` 增加空白拖动框选（Ctrl 追加）与 `user-select:none`；空白右键菜单改为新建/粘贴/复制当前路径/刷新，文件菜单只保留复制/剪切/复制路径/重命名/删除/刷新；资源管理器同步框选并支持多选高亮；选择器无自定义菜单时内置“复制路径/刷新”。转移页完成后 4 s 自动收起进度与按钮，无选中时不显示动作按钮。**实测**：APP 真鼠标右键空白出现“新建文件夹/新建文件/复制当前路径/刷新”，右键文件出现“复制/剪切/复制路径/重命名/删除/刷新”；互传右栏框选 5 个文件、资源管理器框选 2 个文件均高亮；20 B 传输完成后底栏 5 s 内恢复“拖拽文件到另一侧…”。截图 `work-local/ui-menu-blank.png`、`ui-menu-file.png`、`explorer-band2.png`、`explorer-menu-file.png`。

## 2026-11-04 三个阻塞项（方案见 [CORE_BLOCKERS_PLAN_20261103.md](CORE_BLOCKERS_PLAN_20261103.md)）

- [x] F92 文件资源管理器不可用：Linux 根目录下 `lost+found`、`srv` 显示红色“加载失败”，整盘无法正常浏览。判据：干净 Ubuntu 展开 `/` 无红色整目录错误；不可读目录显示锁并可重试；`/srv`、`/etc`、`/var/log` 可进；普通用户模式明确显示权限范围；工作区列表不依赖 DSH。**实测 2026-11-04**：真 APP（CDP 9333）切到 `REMOTESTITCH-HUB` 展开根目录，DOM 统计 `加载中…=0`、`加载失败=0`、`无权限=0`，树中可见 `lost+found`、`srv`、`etc`、`root` 等全部根目录；右侧 `/srv/tether-admin/croc-speed` 可正常列出。修复根因是 `joinPath` 反斜杠 + `loadDir` 成功时未回填根节点 `treeChildren`（spinner 常驻）。
- [ ] F93 Linux 社区 DSH 必须嵌入，不许开外部窗口。判据：无 DSH 的干净 Linux 节点点一次安装 → 自动装 DSH + Tether 插件 → APP 内嵌页面出现侧栏/工作区/composer；全程无外部浏览器；重启节点和 DSH 后自动恢复；插件缺失可一键修复。**实测 2026-11-04**：APP 内 `<webview>` 已挂载（webContentsId=2），目标 `10.144.0.1:37301` 渲染出 `DeepSeek Harness` 首页，CDP 目标只有 webview、无外部 page；Tether 四包已用 `dsh plugin --profile web add` 装进 DSH Web profile。**仍缺**：APP 在 DSH Web 重启后仍显示“DSH 未安装”、`打开工作区` 按钮不稳定；自动装插件/重启后自动恢复未完成。**2026-11-04 补充**：`tether-dsh-gateway.service` 已把 37301 固定到 `10.144.0.1`，`tether-dsh-web`/gateway 均 active；webview 能渲染 DeepSeek Harness 的登录/选择工作区页，尚未登录验证侧栏/composer。**2026-11-04 再验**：webview 容器尺寸修复后为 1432×880 满幅；DSH 侧栏出现 `Tether` 项，点击后插件面板在宿主内打开（登录表单/邀请码注册/关闭按钮），原生侧栏未消失；插件用的四包已从 `/tmp` 改到 `/opt/tether-node/dsh-plugin/0.3.6` 持久路径并注册进 `web` profile。Hub CORS 增加 `http://10.144.x.x[:port]` 与 `https://g<数字>.<域名>` 两类 Tether 自有 origin 后，插件可直连 Hub 并显示 `REMOTESTITCH-HUB`。APP 打开 webview 时把本机 `tether.hub` 写入 guest localStorage（仅缺失时），解决远端 origin 无 Hub 配置。**重启恢复实测 2026-11-04**：`systemctl restart tether-dsh-web tether-dsh-gateway` 后，APP 轮询把状态改为“DSH Web 已就绪”，重新点“打开工作区”加载出 DeepSeek Harness，guest 中 `button[aria-label=Tether]` 仍在（插件持久）。**一键修复实测**：APP 真实点击“修复 DSH Web 插件” → 后台重新注册插件并重启服务（07:26:13）→ 重开工作区，Tether 侧栏仍在。服务器 Node 已受控升级到 0.3.6（保留 0.3.5 目录回滚），`repair_plugin` 能力随包上线。**面板重启实测**：APP 点击“重启 DSH Web”（`stop`→`start`），服务 07:27:23 重启、gateway 仍 active；再点“打开工作区”加载 DeepSeek Harness，guest 仍有 Tether 按钮且 `tether.hub` 配置存在。**仍缺**：DSH 自身未登录/未选工作区，composer 未发消息；干净节点由 `dsh_web.py` 自动装插件的路径尚未在干净机上跑过。
- [ ] F94 传输速度必须以同一路径裸 HTTP 为基准。判据：同一 100 MB、同一方向、同一对设备，APP 单流 ≥ 裸 HTTP 90%；4–8 流后 ≥ 裸 HTTP 单流且路径允许时 ≥2 倍；校园网直连 100 MB <10 s；SHA-256 一致；断线续传；不再用代理器 60 MB/s 与 relay 单流直接对比。**2026-11-04 方案修订**：主传输改用 croc 11.6.3（多 TCP 并行/续传/PAKE/自建 relay），Tether 只做票据、路径权限、暂存、校验和进度；自研分片不再扩展，旧 `transfer.js` 仅作无 croc 时的临时回退，验收后删除。见 [TRANSFER_ENGINE_DECISION.md](TRANSFER_ENGINE_DECISION.md)。已落地 `tether/node/croc_transfer.py` 薄适配层与 5 条 pytest；官方二进制在本机自建 relay 完成 16 MiB 收发，文件字节一致；fs 的 send/receive/status/cancel/finish 已接，真实 8 MiB 端到端 SHA-256 一致；服务器已起 `tether-croc-relay`（10.144.0.1:19009–19012）并配好 server node 的 `TETHER_CROC/TETHER_CROC_RELAY`；APP 转移页已切 croc。**卡点**：桌面 EasyTier 当前 TUN 只有 `169.254.181.157/16`、没有 `10.144.0.2`，Windows 到 `10.144.0.1:19009` 不通；重启 EasyTier 后已恢复 `10.144.0.2/24`，并完成**随机 100 MB**：Windows→服务器 8 路 **51.43 s（约 2.04 MB/s）**、服务器→Windows 8 路 **82.43 s（约 1.27 MB/s）**，SHA-256 均一致；同方向裸 TCP 8 路 **53.9 s**，croc 已在这条路径上限，10 s 目标必须换路径。此前零文件 5.74/17.69 s 是压缩假速度，已撤回。**真实两设备 Node 闭环**：服务器 `/srv/tether-admin` → 本机 `work-local`，2 MB，`transfer_send/receive/status/finish` 成功，SHA 一致。**UI 闭环 2026-11-04**：APP 转移页 DESKTOP-LOCAL → LAPTOP-01，Ctrl+C/Ctrl+V 穿过真实覆盖冲突对话框，20 B 文件完成后目标 SHA-256 `9ba6b6a1…` 与源一致；设备列表异步到达时自动补选左右设备。**100 MB 随机数据 2026-11-04**：croc 自建 relay，上传 26 s（croc 报 105 MB/18 s，峰值 5.5 MB/s），服务器→本机下载 106.28 s（峰值 1.9 MB/s），两端 SHA-256 `f074ae36…` 一致。期间定位并修复 croc 子进程继承 `HTTP_PROXY` 导致 relay 走代理挂死的问题（`croc_transfer.py` 启动前剔除代理变量）。F94 仍未完成；croc 二进制已随 0.3.6 Node/APP 包提供。
- [ ] F95 安装、版本与管理员权限：一条零参数命令装最新版，终端权限可见。判据：`curl -fsSL .../install.sh | sudo bash` 无需 token/邮箱参数；安装后版本等于 release manifest 最新版；Linux 终端徽标 `root · 管理员` 且 `id -u` 为 0；干净 Ubuntu/Windows/macOS VM 全链路零手工修复。**进展 2026-11-04**：安装器默认改为 `latest`，从 `/install/version.json` 解析 node 版本；本地归档模式可从文件名推导版本；服务器公开资产 0.3.6（APP/插件/Node）均 HTTP 200 且 SHA 与 manifest 一致；Node/APP 含 Windows/Linux/macOS x64+ARM64 croc；隔离前缀 `--install-only --archive` 两次安装成功，Linux 侧自动选 `croc-linux-x64`、版本 11.6.3、自动 chmod 755。**干净 runner**：GitHub Actions `41726702888` 的 `linux-clean`、`macos-clean`、`windows-clean` 全部 success（Windows 作业包含安装 APP 并启动 Electron 渲染器）。**管理员终端实测**：通过 Hub `direct_info` 直连服务器 Node `10.144.0.1:18895` 启动终端，返回 `user=root`、`privileged=true`、`shell=bash`、`cwd=/srv/tether-admin`。**2026-11-04 UI 补验**：APP 切到 `REMOTESTITCH-HUB`，资源管理器进入 `/srv/tether-admin/croc-speed` 后点“在终端中打开”，终端 dock 头部显示 `bash · root · 管理员`，cwd 与目录一致。 **命令实测**：同一 Node 终端 API 写入 `id -u; whoami; pwd`，输出 `0` / `root` / `/srv/tether-admin`，哨兵 `TETHER_TERMINAL_OK` 正常回显。**GitHub 草稿**：release id `433272811`、tag `v0.3.6`、commit `e529c7aa2119`，三包已上传为 draft；尚未公开发布。**2026-11-04 重建**：APP 含直连网络、DSH webview 与 croc 代理剥离修复；Node 含插件四包。最终三项包的尺寸/SHA 以 [RELEASES.md](RELEASES.md) 的 proxy-fix rebuild 记录为准（哈希随每次重建变化，不在此复制）；服务器 `/srv/tether-installer` 与本地哈希一致，78 MB 上传约 17 s。**仍缺**：真实零参数 sudo/systemd 安装、登录/文件树/DSH/传输的干净 VM 业务全链路、草稿转公开发布。

## 验收边界

离线测试、隔离 UI、单机 DSH、本机真实模型回答、干净安装、真实跨设备操作和公开发布分别记录，不能互相替代。未完成发布与实机验收前，保持对应条目未完成。

