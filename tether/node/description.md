# 目录说明

本目录实现 Tether 目标节点的运行时能力，包括控制器连接、文件操作、原生 DSH 会话读取，以及受限访问目标机自身 DSH 页面。回环 console 在 APP 传入一次性 token 时，按与 Controller 相同的路由形状提供本机设备 API（策略与审计不变；含 `/dsh/surface`，返回本机 DSH 的 `?token=` 回环地址）；WS 的 `fs_call`/`dsh_call` 并发执行，Office 预览按文件指纹缓存 PDF。

文件面由 `transfer_jobs.py` 编排：优先走已批准私网上的目标 Node SFTPGo（Windows 新实例用 Bolt，旧 SQLite 原位保留），失败或跨网时按设备主人的限时 SFTP 转发许可走 `sftp_relay*`，整件摘要由接收端核对；croc 代码保留但不再是默认路径。组网由 `mesh_runtime.py` 应用 Hub 下发的受控网络，`mesh_supervisor.py` 做 30 秒巡检、重启与 peer 状态上报；事实与阶段见 docs/MESH_LIFECYCLE.md。

Node 宣告本机版本与 update protocol 1，并在独立后台线程执行更新检查、暂存和应用，WS reader/heartbeat 不等待网络下载或文件替换。应用 Node 包后先回送结果，再关闭自身控制通道；APP Supervisor 管理的 Node 以退出码 75 请求同命令重启，独立节点以原 Python argv 替换自身。DSH Host 不由该更新流程终止。插件更新仅写选定目标节点的 DSH 安装位置并返回 `restart_required`。

Codeg 前端覆盖通过 agents-runtime-codeg.patch 从固定上游源码重放；Agents 入口使用 Codeg 原生 workbench route 和 tab API，静态 bundle 必须由 canonical source 构建生成，不手改压缩产物。APP 默认页是映射的目标 DSH 页面，不再进入 Agents 就自动打开 Codeg；Codeg 使用内置自动登录，会话与项目走共用工作区、自动同步和直连桥，不再假设两端“不互通”。

Herdr项目启动会区分终端可用与Agent就绪：agent_state=ready表示已确认就绪，blocked表示Herdr识别到等待用户操作，unverified表示Herdr CLI就绪等待到期但保留本次tab/PTY供用户查看。此分类仅处理agent start的JSON timeout；实际subprocess超时、程序缺失或其他启动错误仍按失败清理，不转发原始CLI错误消息。
