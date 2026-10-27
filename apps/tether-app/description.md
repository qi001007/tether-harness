# tether-app

Tether 的 Electron 外壳（Phase 2 窄切片）。`main.js` 启动内嵌 Web 服务（复用
`packages/tether-ui/web/server.mjs`，把 `/api` 反代到 Controller）、单实例窗口、
Controller 健康探测与 IPC；`preload.js` 只暴露 app info、打开数据目录、外链和状态订阅。
渲染层就是三端共用的 `tether-ui`，不复制页面。

启动：`cd apps/tether-app && npm start`。若 shell 带 `ELECTRON_RUN_AS_NODE=1`，必须先
`unset ELECTRON_RUN_AS_NODE` 再启动。数据目录为 `apps/tether-app/data`（gitignored），
日志 `data/app.log`。截图模式：`npx electron . --shot --panel=文件资源管理器 --row=<路径>`。

未做：服务监督（Controller/Node 子进程）、托盘/服务页、打包安装器、Relay/Account。