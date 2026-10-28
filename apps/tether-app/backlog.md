# tether-app backlog
- 2026-10-28：将 APP 包版本和 package-lock 根元数据统一到 `0.2.9`，用于远程 APP 更新闭环版本。
- 2026-10-28：hub 模式下 supervisor 每进程生成随机本地 API token，经 `TETHER_LOCAL_API_TOKEN` 传给 Node；`main.js` 把本机设备、console 端口和 token 交给 UI server；server 只把本机设备的 fs/workspaces/drives/policy/audit/dsh sessions 路由到 `127.0.0.1:18894` 并注入 Bearer，其余仍走公网 Hub，响应带 `x-tether-local: 1`。不要把 token 写进 argv 或 `/app-context`。
- 2026-10-28：截图模式记录 renderer 错误与 DOM 状态，更新中心截图在界面未实际渲染时失败退出。
- 2026-10-28：本机 Controller 启动改为使用已安装的私有 `tether-harness-server`；无私有包且无健康本机服务时返回明确配置 Hub/安装组件提示。客户端继续外接已有服务与远端 Hub。
- 2026-10-27：更新 APP 目录说明，删除旧 `app-services.js` 专属抽屉引用；连接页由共享 UI 提供。
- 2026-10-27：移除 APP 专属服务面板挂载，APP 与 DSH 在共享 UI toolbar 使用同一“连接”按钮和服务器状态面板；Web server 的连接摘要/探测响应不含访问令牌。
- 2026-10-27：连接与服务面板移除节点身份/在线设备重复统计，改为服务类型、脱敏地址、连接结果和 `/api/state` 请求耗时；手动检测走独立健康请求，不触发服务重启，错误用固定文案。
- 2026-10-27：服务响应耗时标注为客户端到接口请求时间；401/403 显示凭据/权限提示，其它失败提示不可达/超时；Supervisor 快照对 URL userinfo/query/hash 脱敏，只管理自启 Controller 的服务按钮。
- 2026-10-27：服务状态抽屉增加 Controller 连接、本机节点身份/在线状态与在线设备数；在线数仅从 Controller `/api/state` 的设备列表计算，拿不到时显示未知。
- 2026-10-27：Controller 不可达或响应缺少设备列表时，本机在线状态与在线设备数均显示未知；有效设备列表中的未上线节点才显示否。

- 2026-10-27：将 APP 更新启动/定期检查统一交给共享 UI，避免主进程仅记录日志并与界面重复请求；界面显示可用更新与检查失败，不触发自动安装。

- 2026-10-27：supervisor 已实测两种模式：18890 已有 Controller → external（不启动子进程）；无 → standalone 启动 Controller+Node，退出后端口无 LISTENING。测试用 `TETHER_PORT=18895` + 临时 DB，别污染主库。
- 2026-10-27：`ELECTRON_RUN_AS_NODE=1` 会让 `require('electron')` 变成路径字符串并报 `app.setPath` undefined；启动前必须 `unset`，这是环境坑，不是代码 bug。
- 2026-10-27：截图/验收走 `--shot --panel=... --row=...`（`TETHER_APP_SHOT_DELAY` 可调等待），输出到 `.runtime/tether-app-shot.png`；不要往项目根写临时图。
- 2026-10-27：APP 只保证本机后端；跨机仍要可达网络或 Relay。Controller 无鉴权，禁止直接公网暴露，开公网前先做设备密钥与吊销。
- 2026-10-27：窗口加载的是本机随机端口的内嵌服务；`/api` 同源反代，Controller CORS 仍只允许 `dsh-app://app`。
- 2026-10-27：Hub 模式启动和轮询统一按配置的 `TETHER_DEVICE` 判断节点在线，避免其它在线设备造成误报。
- 2026-10-27：新增固定 CLI 的 APP 更新 IPC 与启动/六小时检查；APP 更新先下载校验，安装时独立 helper 等待进程退出后复查本机任务/原生 DSH 活动、事务应用并重启，失败结果供更新中心重试。移除启动时静默覆盖 DSH 插件的调用。
- 2026-10-27：Supervisor 为受管 Node 传 `TETHER_NODE_MANAGED=1`，Node 以退出码 75 完成更新时按原参数顺序重启；DSH 插件更新仍明确由目标设备上的用户重启 Harness。
- 2026-10-27：APP组件版本统一到0.2.1，发布包包含更新CLI与引擎入口；依赖有变化时更新器拒绝静默应用。
