# 变更记录
- 2026-11-09：Hub鉴权失效时将`SurfaceDeck.authReady`置为false，即使旧state仍缓存也不允许NativeSurface预载catalog或重试请求；保留缓存state以便登录后继续。
- 2026-11-09：Hub 登录尚未完成或用户取消登录时，说明文字优先显示登录状态及后续动作，避免标题已恢复但仍提示“正在获取设备数据”。
- 2026-11-09：APP未登录时仅将主进程明确映射的`Controller login required`作为认证状态，展示“登录后连接设备和工作区”；`SurfaceDeck`把外层`authReady`传给`NativeSurface`，未认证或无当前设备记录时不请求缓存deviceId的workbench目录/远端surface，不显示误导性的离线重连状态。泛化identity/service errors继续可见。

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
- 2026-11-09：互联页复用 /api/networks 创建个人/团队私网、明确选网后加入/移除本人设备并显示成员状态；新建业务连接前检查所选网络和两端成员均为 ready、确认具体网络与设备，再以 mode: native 写入现有 edge。
- 2026-11-09：私有网络重试失败时先刷新网络状态，再恢复并保留失败原因，避免成功的刷新清空错误提示。
