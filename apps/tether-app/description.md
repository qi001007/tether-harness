# tether-app

Tether 的 Electron 外壳与服务监督（Phase 2）。`main.js` 启动内嵌 Web 服务（复用
`packages/tether-ui/web/server.mjs`，`/api` 反代到 Controller）、单实例窗口、IPC 与截图模式；
`supervisor.js` 先探测本机 Controller，健康则只连接（external），否则用仓库 `.venv`
启动 Controller，健康后启动本地 Node，日志在 `data/logs`，退出只杀自己启动的进程树。
`preload.js` 暴露服务状态/启停/日志目录；APP 专属 UI 在 `packages/tether-ui/src/app-services.js`
（右上 `服务` 抽屉，不进插件 bundle）。渲染层仍是三端共用的 `tether-ui`。

启动：`cd apps/tether-app && npm start`。若 shell 带 `ELECTRON_RUN_AS_NODE=1`，先
`unset ELECTRON_RUN_AS_NODE`。数据目录 `apps/tether-app/data`（gitignored）。截图模式：
`npx electron . --shot --panel=... --row=...`。

边界：APP 只保证本机有后端；跨机仍需可达网络（LAN/端口转发/Tailscale）或 Relay。
Controller 当前无鉴权，不要直接暴露公网。未做：托盘、打包安装器、开机自启、端口冲突处理。