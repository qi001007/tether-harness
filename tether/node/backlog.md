# 修改记录
- 2026-10-28：v0.2.10 候选将 APP 重启代理改为 Explorer→临时 CMD→隐藏 PowerShell worker，避免依赖 Task Scheduler；保留按实际安装根路径匹配 Electron、等待回包和重连日志。

- 2026-10-28：Node 远程更新注册 app 组件，保留 `app_version` 能力上报；APP apply 将更新器的 `restart_required` 结果透传给 Hub。新增 app apply 与能力回归。

- 2026-10-28：console 补 `GET /api/devices/{id}/dsh/sessions/{session_id}` transcript 路由（未知会话 400 `not_found`），修复 v0.2.4 本机设备会话详情轮询 404 `local route not found`；APP 网关白名单本就含 `/dsh/sessions/` 前缀。回归在 `test_node_console_api.py`。
- 2026-10-28：WS 消息循环把 `fs_call`/`dsh_call` 改为有并发上限的任务，慢 DSH transcript 不再阻塞文件请求；断连时统一取消。回归 `test_node_concurrency.py`。
- 2026-10-28：`fs/preview` 的 Office 转换按路径+`mtime_ns`+大小+类型缓存 PDF（`data/preview-cache`，96 个/256 MB），命中不调用 COM；转换串行锁避免多实例冲突。回归 `test_office_preview_reuses_converted_pdf_until_source_changes`。
- 2026-10-28：console 在带 `--local-api-token`/`TETHER_LOCAL_API_TOKEN` 时提供 token 保护的本地设备 API（fs/workspaces/drives/policy/audit/dsh sessions），路由形状与控制端一致；无 token 时仍只读。回归 `test_node_console_api.py`。token 由 APP supervisor 每进程随机生成并经环境变量传入，不写入 argv。
- 2026-10-28：Node runtime 将 `python-dotenv` 作为必需依赖加载，缺包时不再静默忽略 `.env` 中的 Hub/Node 配置。

- 2026-10-27：Node 在与 DSH 共用的 DSH_HOME 下原子发布带 PID、device_id、更新时间的短期身份 descriptor；每 3 秒刷新，正常退出只清理自身匹配记录。

- 2026-10-27：新增原生 DSH surface 服务，通过目标机 descriptor 固定回环地址，内部维护认证 CookieJar，提供受限 HTTP 与 WebSocket 隧道；Node 以异步请求处理器接入 `surface_call`，断连时取消请求并清理通道。
- 2026-10-27：修复 surface 并发锁占用、认证阻塞 event loop、same-origin 请求头与 query 路径判定；限制待处理 surface 请求数，并提高 Node 控制通道接收上限。
- 2026-10-27：将 HTTP body 上限收为 8 MiB，HTTP/WS 请求从受锁保护的 CookieJar 快照取认证 cookie，避免请求期间多线程并发修改 Jar。
- 2026-10-27：原生 HTTP 请求固定请求 gzip 编码响应，使压缩资源在 8 MiB body 上限内透传。
- 2026-10-27：新增 `fs/preview`（MD/文本/图片/PDF；DOCX/PPTX 经 WPS/Office COM 转 PDF），转换写 `preview` 审计；surface 状态区分 descriptor 缺失/无效/主机关闭，并上报 surface_protocol。
- 2026-10-27：`_resolve` 接受 `C:` 盘符根并补 `\`，修复 C 盘根刷新 `path must be absolute`；新增回归测试。
- 2026-10-27：Audit 改 SQLite WAL（100000 行上限、分页、旧 JSONL 一次性迁移），内存不再保存历史；新增 audit 分页回归。
- 2026-10-27：Node capabilities 增加 `os_label`，按 `sys.getwindowsversion().build` 区分 Windows 10/11，避免 `platform.release()` 误报。
- 2026-10-27：原生 surface 转发 HTML 时注入 `#tether-native-surface`，将内嵌 DSH `.sidebarCol` 的右边框置 0（桌面版由 `[data-windows-titlebar]` 隐藏）；gzip HTML 先解压再注入并移除 ETag/Last-Modified，JS/CSS 的 gzip 透传不变。
- 2026-10-28：为原生 surface 的 `GET /plugins/events` 增加有界 SSE 转发：48 KiB 分块、每节点 8 条流、短轮询、90 秒空闲清理，明确 `http_stream_open/read/close` RPC；流关闭时取消异步读取任务并关闭连接。
- 2026-10-28：状态/检查请求绕开 prepare/apply 串行锁；plugin 只读请求使用活动 profile 的独立 manager，避免 profile 共享状态竞争。
- 2026-10-27：Node 宣告缓存的本机版本与 update protocol 1；异步接入 UpdateManager 的 node/plugin check/status/prepare/apply，参数只含白名单组件/动作/暂存 ID。apply 前复核 Node 本地活动 Tether run 与原生 DSH 未结束 turn，状态未知或繁忙时拒绝；下载/应用不阻塞 WS reader。Node 成功换版后优雅关闭并交由 APP supervisor 退出码 75 重启，独立节点保留原 argv 自替换；插件更新只改目标 Node 的 DSH 安装并要求目标 DSH 重启。
- 2026-10-27：远程插件 apply 必须从活动 Host companion descriptor 取得 profile，且 descriptor PID 存活；未升级 companion、profile 缺失或 Host 不在运行时拒绝更新，不再默认写 desktop。
- 2026-10-28：`capabilities` 的 `update_protocol/min_update_protocol` 必须引用 `tether.updates` 常量（新增 `max_update_protocol`），禁止再写字面量 1，避免协议升级时能力上报与实际判断漂移。
- 2026-10-29：本机 console 增加 `GET /api/devices/{device}/dsh/surface`，返回 `NativeSurface.local_url()` 的 `/?token=` 回环地址（descriptor 缺失或 DSH 不可达时 409 `descriptor_missing`）；APP 的本机 surface 因此零公网跳，不再撞 Hub 网关 30 s 超时。
- 2026-10-29：`NativeSurface._http` 遇 DSH 的 401/403 时清空 cookie jar、重新认证并重放一次（DSH 重启后旧会话失效，不能继续用旧 Cookie）；重放仍失败则原样返回 401。
- 2026-10-29：`dsh_restart` 重启时剥离继承的 `ELECTRON_RUN_AS_NODE`（否则 DSH 以纯 Node 启动，窗口永远不出现）；首次启动 20 s 内没有新 descriptor 时再补一次启动，最多两次。
