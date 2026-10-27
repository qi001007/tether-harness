# 修改记录

- 2026-10-27：新增原生 DSH surface 服务，通过目标机 descriptor 固定回环地址，内部维护认证 CookieJar，提供受限 HTTP 与 WebSocket 隧道；Node 以异步请求处理器接入 `surface_call`，断连时取消请求并清理通道。
- 2026-10-27：修复 surface 并发锁占用、认证阻塞 event loop、same-origin 请求头与 query 路径判定；限制待处理 surface 请求数，并提高 Node 控制通道接收上限。
- 2026-10-27：将 HTTP body 上限收为 8 MiB，HTTP/WS 请求从受锁保护的 CookieJar 快照取认证 cookie，避免请求期间多线程并发修改 Jar。
- 2026-10-27：原生 HTTP 请求固定请求 gzip 编码响应，使压缩资源在 8 MiB body 上限内透传。
- 2026-10-27：新增 `fs/preview`（MD/文本/图片/PDF；DOCX/PPTX 经 WPS/Office COM 转 PDF），转换写 `preview` 审计；surface 状态区分 descriptor 缺失/无效/主机关闭，并上报 surface_protocol。
- 2026-10-27：`_resolve` 接受 `C:` 盘符根并补 `\`，修复 C 盘根刷新 `path must be absolute`；新增回归测试。
- 2026-10-27：Audit 改 SQLite WAL（100000 行上限、分页、旧 JSONL 一次性迁移），内存不再保存历史；新增 audit 分页回归。
- 2026-10-27：Node capabilities 增加 `os_label`，按 `sys.getwindowsversion().build` 区分 Windows 10/11，避免 `platform.release()` 误报。
- 2026-10-27：原生 surface 转发 HTML 时注入 `#tether-native-surface`，将内嵌 DSH `.sidebarCol` 的右边框置 0（桌面版由 `[data-windows-titlebar]` 隐藏）；gzip HTML 先解压再注入并移除 ETag/Last-Modified，JS/CSS 的 gzip 透传不变。
