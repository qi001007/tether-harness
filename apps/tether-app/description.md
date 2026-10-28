# tether-app

Tether 的 Electron 外壳与服务监督（Phase 2）。`main.js` 启动内嵌 Web 服务（复用
`packages/tether-ui/web/server.mjs`，`/api` 反代到 Controller）、单实例窗口、IPC 与截图模式；
`supervisor.js` 先探测本机 Controller，健康则只连接（external）；否则仅在 APP Python 环境已安装私有 `tether-harness-server` 组件时启动本机 Controller。缺少私有组件且没有 Hub 时，会显示配置 Hub 或安装私有组件的明确错误，不从网络获取私有源码。Controller 可用后启动本地 Node；受管 Node 以退出码 75 重启自身时按原命令重启，日志在 `data/logs`，退出只杀自己启动的进程树。
`update-service.js` 通过固定组件的 JSON CLI 执行 APP 更新状态、检查与准备；安装由 userData 中的独立 helper 等待 APP 退出后事务应用并重启。helper 在 APP 退出前后都核对 Tether 与原生 DSH 活动状态。
`preload.js` 暴露服务状态/启停/日志目录和受信任的 APP 更新 IPC；连接入口与状态页由三端共用的 `packages/tether-ui/src/app.js` 提供。
截图模式会记录 renderer console、加载/崩溃事件和 DOM 文本；指定更新面板截图时要求更新中心确实挂载。

Hub 状态中的节点在线标记按本机配置的 `TETHER_DEVICE` 精确匹配设备 ID。Hub 模式下 supervisor 为每次进程生成随机本地 API token，Web 服务只把本机设备的文件/工作区/策略/审计/DSH 会话路由直连 Node 回环 console，其余请求仍走公网 Hub。

启动：`cd apps/tether-app && npm start`。若 shell 带 `ELECTRON_RUN_AS_NODE=1`，先
`unset ELECTRON_RUN_AS_NODE`。数据目录 `apps/tether-app/data`（gitignored）。截图模式：
`npx electron . --shot --panel=... --row=...`。

边界：APP 客户端发行包不含私有 Controller；使用 Hub 或安装私有服务组件。未做：托盘、打包安装器、开机自启、端口冲突处理。
