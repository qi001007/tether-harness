# 变更记录

## 2026-11-10

- `agents-page.js`：APP 的 legacy Codeg ready 状态使用专用主进程 opener 和 token-free native webview；legacy stopped/missing/failed 均禁用，并显示未运行、未安装或状态异常，不触发旧 `agents_runtime_start`。
- `app.js`：Electron 托管 OAuth 下，远端 DSH surface descriptor 通过既有 `hubRequest` IPC 请求，保留 HTTP 状态/body，并在 IPC 前后尊重取消；本机、Web、DSH 与显式 legacy 路径不变。`/app-context` 的本机设备 ID 仅在当前设备快照中存在时才可自动选中，用户手选仍优先。r2 在在线 REMOTESTITCH-HUB 上观察约 45 秒，设备选择保持且无新增 CORS/404/HTTP 400，截图已保存；旧工作区协议仍待兼容。

## 2026-11-10

- `app.js`：桌面 UI 先读取主进程认证状态，未认证时显示登录入口并暂停工作台状态请求；认证后再加载原设备工作台。25 项 Node 定向测试及 portable 未登录页通过，正式 r7 dual audience 已部署；真实用户登录与原设备列表仍待验收。

## 2026-11-08

- `settings-panel.js`：设置→关于增加开源组件版本、许可证、官方源码与 SFTPGo NOTICE 入口；明确只用 SFTPGo 核心，不含其专有 WebAdmin/WebClient 页面，并提示随包完整第三方声明。
- `app.js` / `agents-page.js`：Agents 工作台首次进入时挂载，此后在 `chat/files/network/transfer` 间导航只隐藏、不卸载；按目标设备保留独立的 Codeg/Herdr 实例。移除 ACP 会话的组件卸载停止副作用；新账号/authority 使用新工作区实例。
- `agents-page.js`：把 Herdr/其他终端 pane 的“返回 Codeg”按钮移到内容区上方的独立工具栏，消除按钮覆盖终端内容的问题。
- `transfer-page.js`：常规双栏 copy/move 使用接收端 Controller 持久 transfer job；keep-both 文件/目录提交相对 POSIX destination_path，文件/目录覆盖确认后从目标 Node 读取 destination_fingerprint 并提交 destination_version；取消、恢复、状态查询和显式 retry 绑定创建时的接收设备；移除前端旧 Croc/分块传输执行回退。
- `app.js`：只记住用户明确选择的设备，并按当前 API authority 与认证用户 ID 隔离；有效状态快照中的匹配设备恢复时标记为手动选择，避免本机身份同步抢回。当前页面复用 `usePersisted` 保存，Hub 配置切换清空恢复标记。现有目录路径逻辑未改。
- 本机 UI bundle 以已加载 dist 为基线做局部对应改动并加载，SHA-256：`f9d5857a52d94d812482191d901c812e589c406a69de5d3d19880152cd8ca5a1`。加载后在新页面明确选择 `LAPTOP-01`、文件资源管理器及 QA 目录，再从父页面正常刷新一次；最终截图仍显示相同设备、页面、路径及原有文件。截图见 `.runtime/qa-upstream/ux01-recovery-20261107/device-context-after-verified-refresh.jpeg`。未模拟离线或验证 049 无效快照错误。
- 2026-11-08：app.js 网络图使用 Cytoscape.js 3.34.4；支持拖动位置记忆、弹簧连线、缩放/回中、节点详情和显式连接；连线状态仅在后端确认后更新。
- 2026-11-08：transfer-page 冲突处理已改为 Controller job item 的 destination_path/destination_version；目录可保留两者，覆盖确认后取 Node 指纹；去除前端legacy直接传输循环。
- 2026-11-08：桌面 APP JSON API 与设备/会话事件订阅改用 Electron 主进程 OAuth Cookie session；显式选择旧 Hub 才启用旧 token API。默认 APP 传输/目标文件操作不向 renderer 暴露 Node bearer token，并通过 Hub Controller 转发。
- 2026-11-08：APP 设置/顶栏登录退出统一使用主进程 OAuth session；OAuth 账号不显示本地密码表单，退出先由主进程处理 workbench 授权撤销与会话清理。
- 2026-11-08：身份未绑定页提供“创建新账号”和“关联已有账号”两个明确动作；新建只调用无身份参数的主进程注册方法，绑定仍由用户显式选择。Agents 页接入目标桌面原生 guest 会话，展示 prompt/只读状态并提供显式撤销；主进程工作台适配器严格校验 `/sharing` guest path、授权状态与同 origin TLS/bootstrap。
- 2026-11-08：`oidc_identity_unbound` 显示旧账号一次性绑定表单，并通过主进程IPC传递 credentials；仅组件内存临时持有，提交结束或退出后清空密码。
- 2026-11-08：网络拓扑图新增全部/我的/共享给我筛选，以 Controller `/api/state` `owner_id` 权威区分共享设备，图表、列表和计数一起过滤。
- 2026-11-08：新增 team-management.js，按私有Controller冻结API做团队创建、成员/一次性邀请令牌、接受/离队、设备能力+allowed_roots共享及撤销；组件API失败明确显示，不乐观伪报。
- 2026-11-08：remote_desktop.use暂未有可用授权入口，团队共享选择器禁用该项并标注未启用；网络图提示共享可见性不代表团队网络可达。
- 2026-11-08：Office 预览的明确转换错误（缺少LibreOffice、45秒超时、转换失败、输出缺失）不做快速自动重试，交由预览面板显示原错误并手动重试。
- 2026-11-08：设备更新失败的“重试”固定使用原`job_id`调用`POST /api/devices/{device_id}/update/retry`；任务缺少ID时明确拒绝重发，不再启动新apply作业。
- 2026-11-08：互联页读取Controller私有网络列表，在`failed`或可恢复的`provisioning`状态展示真实状态；只有`can_retry=true`时开放重试，并复用网络ID调用Controller重试接口。

- 2026-11-09：更新中心远程组件通过既有 MinimalUpdateButton 创建/呈现持久 Update Job，保留组件选择并按 APP/Node owner 合约分流；取消仅显示服务端真实状态，不承诺后端未提供的取消操作。
- 2026-11-09：若受管 APP 安装器拥有更新但目标桌面暂未运行，设备卡与更新中心明确提示先启动目标桌面 APP；不暴露 loopback、token 或队列内部信息。

- 2026-11-10：打包 Electron 远端 NativeSurface 改走受控 DSH guest，renderer 只接收 token-free endpoint/partition/grant；空文档与 did-fail-load 显示可重试错误，重试重新申请授权。
- 2026-11-11：Electron 远端 NativeSurface 严格验证 main 返回的 HTTPS endpoint：默认端口、根路径、无 userinfo/hash，且唯一查询必须精确为 `tether_native=1`；guest 完成加载时再次与批准 endpoint 精确比对。
- 2026-11-11：Node 更新在版本/在线/重启状态通过后，继续验收 `service_catalog`，并在目标声明 `dsh_surface` 时验收 DSH running/surface 与原生 surface descriptor；通过后携带 `prepared_id` commit。验收或重启超时会 best-effort rollback，并显示回滚结果；APP 重启后的 Node watcher 只对本轮有 `preparedId` 的更新提交。
- 2026-11-11：Node 持久事务 apply 后以 `awaiting_acceptance`、匹配的 `prepared_id` 作为 service health/commit 门禁；commit 前允许 `restart_required=true`，事务缺失或不匹配继续等待并最终回滚。
- 2026-11-11：联合更新中 Node 已 apply 并等待 APP 重启验收时，APP apply 失败/异常、安装未 settle 或重连失败会回滚本轮 Node 事务；记录 watcher 已执行的回滚结果，避免重复 rollback，并将回滚结果保留为最终更新错误。
- 2026-11-11：修复本机 UI 重启后的 Node 持久事务接管：仅识别有效 `awaiting_acceptance` 事务，卡片提供“待验收”入口；先完成 Node health/commit，再继续本轮 APP 更新，验收失败沿用 watcher 自动回滚。
