# tether-app backlog

- 2026-10-27：当前 APP 只起窗口 + 内嵌 UI 服务，Controller/Node 仍需外部启动；下一步是 ServiceSupervisor（启动/健康/退出清理），不要宣称双击即完整自举。
- 2026-10-27：`ELECTRON_RUN_AS_NODE=1` 会让 `require('electron')` 变成路径字符串并报 `app.setPath` undefined；启动前必须 `unset`，这是环境坑，不是代码 bug。
- 2026-10-27：截图/验收走 `--shot --panel=... --row=...`，输出到 `.runtime/tether-app-shot.png`；不要往项目根写临时图。
- 2026-10-27：窗口加载的是本机随机端口的内嵌服务；`/api` 同源反代，Controller CORS 仍只允许 `dsh-app://app`。