# Controller

该目录实现 Tether 控制端的 HTTP/WebSocket API、设备请求路由与持久化状态协作。`app.py` 管理主控制器路由和 Hub 请求；`native_surface.py` 为每台设备创建独立的 loopback 原生 DSH 页面网关；`store.py` 保存控制器状态。
