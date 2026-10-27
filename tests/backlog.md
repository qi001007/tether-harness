# 修改记录

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
