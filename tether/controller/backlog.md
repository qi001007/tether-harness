# Controller 修改记录

- 2026-10-27：新增 `native_surface.py`，实现按设备隔离的 loopback HTTP/WS gateway、单次短时 bootstrap ticket、HttpOnly Secure Partitioned cookie、同源校验、HTTP 代理过滤、8 MiB体积限制和二进制 WebSocket 中继；bootstrap 固定跳转到 `/?tether_native=1` 以避免原生子页递归。
- 2026-10-27：扩展 `app.py`，接收 `surface_result`，在应用关闭时清理 gateway，并提供 DSH surface descriptor API 与能力/在线状态错误。
- 2026-10-27：允许无Origin但带有效单次ticket的顶层/iframe document导航完成bootstrap；显式Origin仍必须为 `dsh-app://app`。
- 2026-10-27：设备表新增 `display_name`（旧库自动 `ALTER TABLE`），设备重连只更新 `host_name` 不覆盖别名；新增 `POST /api/devices/{id}/name`（1–64 可打印字符、404/广播）和 `rename_device` store 方法。
