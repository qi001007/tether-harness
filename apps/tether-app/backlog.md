# tether-app backlog

- 2026-10-27：supervisor 已实测两种模式：18890 已有 Controller → external（不启动子进程）；无 → standalone 启动 Controller+Node，退出后端口无 LISTENING。测试用 `TETHER_PORT=18895` + 临时 DB，别污染主库。
- 2026-10-27：`ELECTRON_RUN_AS_NODE=1` 会让 `require('electron')` 变成路径字符串并报 `app.setPath` undefined；启动前必须 `unset`，这是环境坑，不是代码 bug。
- 2026-10-27：截图/验收走 `--shot --panel=... --row=...`（`TETHER_APP_SHOT_DELAY` 可调等待），输出到 `.runtime/tether-app-shot.png`；不要往项目根写临时图。
- 2026-10-27：APP 只保证本机后端；跨机仍要可达网络或 Relay。Controller 无鉴权，禁止直接公网暴露，开公网前先做设备密钥与吊销。
- 2026-10-27：窗口加载的是本机随机端口的内嵌服务；`/api` 同源反代，Controller CORS 仍只允许 `dsh-app://app`。