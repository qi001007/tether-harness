# 目录说明

本目录实现 Tether 目标节点的运行时能力，包括控制器连接、文件操作、原生 DSH 会话读取，以及受限访问目标机自身 DSH 页面。回环 console 在 APP 传入一次性 token 时，按与 Controller 相同的路由形状提供本机设备 API（策略与审计不变；含 `/dsh/surface`，返回本机 DSH 的 `?token=` 回环地址）；WS 的 `fs_call`/`dsh_call` 并发执行，Office 预览按文件指纹缓存 PDF。

Node 宣告本机版本与 update protocol 1，并在独立后台线程执行更新检查、暂存和应用，WS reader/heartbeat 不等待网络下载或文件替换。应用 Node 包后先回送结果，再关闭自身控制通道；APP Supervisor 管理的 Node 以退出码 75 请求同命令重启，独立节点以原 Python argv 替换自身。DSH Host 不由该更新流程终止。插件更新仅写选定目标节点的 DSH 安装位置并返回 `restart_required`。
