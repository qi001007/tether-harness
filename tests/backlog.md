# 修改记录
- 2026-10-29：新增 `test_explorer_navigation.mjs`：历史栈前进/后退/新导航清空 forward、目录优先的三种排序与升降序、搜索大小写与空查询过滤，以及工具栏/列头/搜索空态接线断言。
- 2026-10-28：新增本机 DSH 更新确认流程回归，覆盖 owner 在线重载、重载后运行版本核对，以及 no-HMR/运行版本未追平时停止自动操作并明确提示。
- 2026-10-28：新增原生目标设备附件与 surface owner RPC 回归，覆盖 owner identity、session workspace API、路径 capability、readBytes 二进制跨块无损、超限/拒绝及设备/会话切换后不 attach。
- 2026-10-28：共享 UI 回归断言新建文件固定当前 target device、设置 `overwrite:false` 且设备变化后丢弃旧目录 UI 更新。
- 2026-10-28：新增 DSH 本机 surface 重载回归，覆盖唯一启用项、重复匹配拒绝及 `restart-required` 状态透传。
- 2026-10-28：回归覆盖 FilesPane 在当前目标目录显示新建文件按钮，且调用目标设备文件写入接口。
- 2026-10-28：发布流水线新增 `test_*.cjs` 测试发现步骤，避免遗漏 CommonJS renderer 诊断回归。
- 2026-10-28：新增 `test_app_startup_readiness.mjs`，覆盖 supervisor 有界等待、本机 Node API 带身份/token 的只读就绪探测、以及探测超时。
- 2026-10-28：新增 `file:` 插件依赖漂移回归：profile 版本较新但源码依赖较旧时仍报告可更新；成功时同步 profile/source，源码写入失败时两处都回滚且保留无关用户文件。
- 2026-10-28：更新 APP 重启 helper 回归，覆盖 Explorer wrapper、Worker 路径、版本候选失败处理及隔离启动契约。
- 2026-10-28：新增 Node 远程 APP 更新回归，覆盖 app manager 注册、app_version 保留与 apply 的 restart_required 返回。
- 2026-10-28：新增 `test_ui_performance.mjs`（abort 不换 base、缓存/预取/停止/设备门禁/悬浮卡/本地路由断言）、`test_web_local_api.mjs`（APP 网关只转发本机设备路由）、`test_node_console_api.py`（token/设备/策略/审计/DSH 路由）、`test_node_concurrency.py`（fs 与 dsh 并发）、Office 缓存回归。
- 2026-10-28：工作区错误回归覆盖同设备失败保留列表/选择及切设备后才使用 legacy fallback。
- 2026-10-28：新增共享 UI 工作区响应验证用例，覆盖缺失/错误列表与合法空列表；Electron QA 可注入无效 workspaces 响应，验证更新中心可见且错误提示保留。

- 2026-10-28：验证当前 updater 可暂存协议不变的下一版本 manifest；构建归档验证版本元数据一致、Node 包无旧占位 Hub/token/API-key 指引，并使用实际 hostname 默认设备名。
- 2026-10-28：增加 Python dotenv 对 UTF-8 无 BOM `.env` 中中文路径和设备名的临时配置回归；Node runtime 显式依赖 python-dotenv。
- 2026-10-28：新增 Release workflow 实际 PowerShell 校验段回归，覆盖无 tag 成功、版本错配失败和 tag 指向其他提交失败，并模拟 Actions 的 `exit $LASTEXITCODE` 包装。
- 2026-10-28：Electron 更新中心 QA 修复 panel 选择器与 stub Controller 响应契约；现断言无 renderer 异常、更新中心 DOM 和 Controller online，并将截图及隔离运行日志保存到指定维护目录。此前错误 stub 缺少 `workspaces` 字段触发 React TypeError，且旧 panel 名称不匹配实际按钮标题，导致空白截图仍以 exit 0 通过。

- 2026-10-28：将 Controller 状态更新、设备名存储与 native surface gateway 测试迁入私有 `tether-harness-server/tests`；公开新增缺少私有服务组件时的 Supervisor 提示与 APP/Node 发布 ZIP 服务实现排除回归。

- 2026-10-27：回归覆盖 DSH Hub 状态探测只向已配置 URL 发起带凭据的单次请求；包括认证失败不触发本机 fallback。

- 2026-10-27：互联本机身份回归覆盖桌面/笔记本置顶及身份未知时不推断 Hub 本机。
- 2026-10-27：补 Node 隔离身份 descriptor 原子写/刷新/自清理与 DSH owner RPC→客户端 bridge 测试；覆盖过期、PID 不存活、多个设备身份冲突、APP 优先及手动节点选择保护。

- 2026-10-27：覆盖自动更新提示的可用/无更新、检查失败、选中目标切换隔离及组件范围。

- 2026-10-27：为共享更新 UI 增加一键更新顺序、无更新跳过和设备切换中止的定向覆盖。

- 2026-10-27：更新 API 认证与路由测试，直接通过导出的 `fetchApiJson` 验证 Hub 凭据隔离、本机回退及 401/403 短路，移除对旧 `api(path, options)` 源码签名的脆弱查找。
- 2026-10-27：新增干净 VM 执行生成 bridge factory 的启动 smoke，检查原生组件导出与词典常量依赖。
- 2026-10-27：调用真实 `runConversation` 回归 DSH tool/result 的 `message.isError` 到 `is_error/status` 映射。
- 2026-10-27：增加原生工具卡片适配、错误结果/畸形参数保留及折叠过程分组顺序回归检查。
- 2026-10-27：新增 `test_file_tree.mjs`，验证文件树节点身份、路径缓存隔离、工作区标题与目录名，以及异步设备切换保护。
- 2026-10-27：扩展 `test_file_tree.mjs`，用 VM 中的 React createElement stub 调用真实 `FileTree`，覆盖旧路径 key 冲突复现、workspace/drive 同路径兄弟 key 唯一、循环条目去除，以及十轮展开/收起稳定渲染。
- 2026-10-27：增加发送目标解析回归，覆盖 native DSH 精确链接、`tether-` 前缀关联、未关联历史阻止、current run 设备/工作区校验和新 session ID 唯一性。
- 2026-10-27：增加 App 选择状态回归，执行同一 workspace 的 select→toggle→toggle 及跨 workspace 显式选择非首 session 后 effect 顺序，验证展开可恢复且 session id 保留。
- 2026-10-27：新增 ProcessGroup 状态切换 hook 顺序回归测试，覆盖 live running → completed 渲染。
- 2026-10-27：新增 native DSH surface 测试，覆盖 descriptor loopback 校验、路径 SSRF 拦截、凭据/响应头隔离及 WebSocket 二进制往返和关闭。
- 2026-10-27：新增更新后端离线测试：Controller update check/status/prepare/apply 参数白名单、超时、legacy 节点提示、active Tether run 拦截、update_result 与 queued run 恢复；Node 异步准备不阻塞消息处理、原生 DSH 未结束 turn 与本地 Tether run 双重阻止 apply、成功安装后 restart 标志不因回包断连丢失、managed exit 75 和独立进程 argv 自替换。fake node 与 isolated JSONL fixture，13 项通过。
- 2026-10-27：补充认证 303 Set-Cookie、原生 same-origin 校验和 pending WebSocket receive 期间同时 send/HTTP 调用的并发回归。
- 2026-10-27：新增以 MAX_BODY 常量为准的请求大小限制测试，不构造大体积样本。
- 2026-10-27：新增 gzip 响应透传测试，验证 content-encoding 与原始压缩 bytes 保持一致。
- 2026-10-27：增加原生 client 的安全 loopback URL、child-frame recursion VM 回归，以及 companion descriptor 的权限、活 Host 防覆盖、stale Host 接管和 lifecycle cleanup 测试。
- 2026-10-27：新增原生 iframe loopback URL 与子页面防递归 VM 回归，以及 companion descriptor 发布、权限、活 Host 防覆盖、陈旧 Host 替换和卸载清理检查。
- 2026-10-27：原生页面 ready 状态绑定 deviceId，验证切设备时旧 iframe URL 不可渲染；通过客户端结构契约验证文件/日志视图只隐藏、不卸载 iframe。
- 2026-10-27：新增 preview 回归（文本/Markdown/图片/PDF/unsupported）；沿用 surface 客户端契约测试；Python 26、JavaScript 20 全过。
- 2026-10-27：新增盘符根 `_resolve("C:")` 回归；Python 27、JavaScript 20 全过。
- 2026-10-27：新增 audit SQLite 分页/迁移回归；权限/互联页契约由 JS 20 项覆盖。
- 2026-10-27：新增 HTML 原生页注入回归：gzip HTML 解压后包含 `#tether-native-surface`，去掉 content-encoding/ETag 并设 `no-store`；JS 的 gzip 字节与头保持不变；Python 29、JavaScript 20 全过。
- 2026-10-27：新增 Hub 凭据不泄露给本机回退、401/403 短路、Hub device ID 精确状态和插件 ZIP 解压后离线预检回归。
- 2026-10-27：新增更新引擎回归：SemVer边界、缺失清单/坏hash/路径穿越、保留APP用户数据、事务失败回滚、插件profile映射及0.2.1三组件发布清单。
- 2026-10-27：新增 `test_device_names.py`：显示名在节点重连后保留、旧 devices 表自动补 `display_name`、缺失设备抛 `NotFound`；Python 32、JavaScript 20 全过。
- 2026-10-27：新增更新服务 mock CLI/preload IPC/UI 契约测试及隔离临时目录 helper 测试，验证staged Python activity/apply共用prepared state目录并重启入口可启动；新增 Supervisor 真实子进程退出码75串行重启测试。
- 2026-10-27：新增 `qa_updates_electron.mjs` 隔离 UI 验收入口：临时 APP root、独立 userData、stub Controller 和不可用本地 manifest 测试源，只截取错误可重试状态，不调用发布源或安装更新。
- 2026-10-27：更新客户端定向回归增加 DSH authenticated RPC envelope/payload白名单、Electron IPC错误文案净化、设备切换epoch stale-response丢弃与旧Hub 404迁移提示检查。
- 2026-10-27：更新API authority回归验证Hub请求失败时不回退到本机Controller，且状态/检查/准备/安装继续固定在同一控制面。
- 2026-10-27：补充 APP 同源空 base 回归，确认空字符串是有效 authority，失败时只请求相对 `/api` 路径，不落到 loopback Controller。
- 2026-10-27：新增三组件真实发布 ZIP 的离线暂存/应用、插件独立 updater 文件映射、ZIP路径/符号链接、暂存哈希和版本漂移、事务锁与原生/Node忙碌保护回归。
- 2026-10-27：新增纯插件本机更新桥测试：白名单 logical endpoint、固定 CLI路径和环境、拒绝请求路径参数、活动 DSH 会话保护、非 owner 403 且不启动子进程、缺少随包 updater 安全失败；本机 companion 测试断言仅注册 `/tether-updates` channel。
- 2026-10-27：增加 Host profile 来源与远端更新保护回归：descriptor profile 仅在 PID 存活时可信；未知 profile 的远端插件 apply 不调用更新器；已知 profile 绑定到该次 apply。
- 2026-10-27：以已核实 SHA-256 的本地 0.2.0 APP/插件官方发行 ZIP 做真实基线升级；临时 APP `.env`/data 保留，并继续升级同一旧 APP 里的 Node 与旧插件 profile；缺包时只 skip，不下载。
- 2026-10-27：增加连接与服务面板行为回归：独立探测不重启受管服务、成功/失败时间与请求时延、重复设备条目移除及地址脱敏。APP supervisor 用例通过；共享 UI 用例除既有子进程 build --check 被 sandbox EPERM 阻止外通过。
- 2026-10-27：补充 401/403 凭据错误与不可达/超时提示映射、DSH auth 状态码测试及 APP 不回传敏感 URL 测试。定向 supervisor 6/6、API auth 8/8；共享 UI 功能用例通过，内部子进程检查在 sandbox EPERM，改用独立 bundle check 验证。
- 2026-10-27：增加 Hub 地址编辑输入的空配置、正常路径保留、敏感附加参数隐藏提示及断开按钮可用状态回归。
- 2026-10-28：修复更新服务 helper CLI 集成测试对仓库 `.venv/Scripts/python.exe` 的硬编码，按显式环境变量、有效项目虚拟环境和 PATH 顺序探测可运行 Python，保留真实 helper activity/apply/relaunch 断言。
# 变更记录

- 2026-10-28：附件目标读取回归覆盖跨 chunk 版本变化拒绝、PNG MIME、SDK slot priority 胜者顺序及原生 `fileDrag.read`/locale props 透传。
- 2026-10-28：增加 DSH 源码依赖与 profile 双路径插件更新及回滚测试、运行版本提示测试，以及 renderer 网络范围/日志脱敏/只读即时与稳定 frame 状态测试。
- 2026-10-28：更新 native iframe 契约回归为只允许附件 slot，并验证其 fileDrag/remote 上下文；仍断言不注册嵌套 Tether main/sidebar。
- 2026-10-28：新增当前 SDK `register(ctx, channel, handler)` 无 `rpc` 属性的 companion 回归，并验证 dirty file: Git 工作树阻止插件写入。
- 2026-10-28：surface descriptor 发布回归改用现代连接注册 API，并断言两条 owner RPC 均被注册。
- 2026-10-28：回归验证 profile 中 surface 包旧于 client 时按旧 surface 版本报告更新，且不会采用缓存安装版本掩盖差异。
- 2026-10-28：验证更新检查 5 分钟缓存/强刷/过期重查、明确超时失败，并保留只检查不安装的行为。
- 2026-10-28：新增真实本机 SSE fixture 回归，验证首字节不等 EOF、间隔事件分块读取及 close 中断上游；新增 Controller 流式转发/客户端取消关闭 RPC 回归。
- 2026-10-28：Node 更新协议回归确认 prepare 期间仍可及时回复 status/check；manifest 测试覆盖同 URL 并发 singleflight 与 prepare 新鲜读取。
- 2026-10-28：附件回归改以仓库 `build.mjs` 的 fileDrag injection contract 验证，移除对未跟踪 `.runtime/dsh-src` SDK 源码的依赖；共享 UI 增加刷新 busy/旋转、稳定更新入口圆点和 toast 4 秒收敛断言。
- 2026-10-28：新增 `test_preview_open`/`test_code_view`：预取在飞时首开复用请求体、无效/失败预取回退重试且不毒化缓存、中断不被吞；代码页标签栏/当前行/分隔条与暗色变量不变量。
- 2026-10-29：新增 `test_csv_preview`：RFC4180 引号/转义/字段内换行、CRLF/CR、BOM、空单元格、行/列上限、源截断丢弃半行、TSV/XLSX 分支、数字列右对齐与表格/纯文本切换接线。
- 2026-10-29：新增 `test_update_version_line`（版本元组/两条固定格式/无旧文案）；`test_node_console_api` 增加本机 `dsh/surface` 200/401/404/409，`test_web_local_api` 与 `test_ui_performance` 改为断言 `/dsh/surface` 走本机节点；`test_native_surface_client` 覆盖同机 token URL 与 Hub-loopback 防护豁免。
- 2026-10-29：`test_native_surface` 增加 401 后重新认证并重放一次的用例（第二次仍失败则保留 401）；`test_native_surface_client` 增加插件 `surfaceBase` 快路径与 `localDeviceId` 接线断言。
- 2026-10-29：`test_code_view` 改为断言满高行号槽、无硬分界线和蓝/绿/紫配色，新增代码编辑（Tab/Ctrl+S/脏改动确认）断言；`test_csv_preview` 增加 `serializeDelimited` 往返测试与表格就地编辑/Ctrl+S 接线断言。
- 2026-10-29：`test_explorer_navigation` 增加预取返回响应体、`loadDir` 空值回退和覆盖式加载遮罩断言（防止再出现“双击快就报目录读取失败”与加载挤行）。
