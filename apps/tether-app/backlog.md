# tether-app backlog
- 2026-11-11：为 external 常驻 Node 增加显式 loopback API 桥配置：仅接受有效端口和至少 32 位安全 token；Supervisor 不启动/停止外部 Node，snapshot 不含凭据；APP 启动及每次 mesh route 前用 Bearer+设备路径验证 API，route 回包须匹配设备、网络和本机 SOCKS 地址。未配置仍拒绝；不涉及 Codeg 可见验收。
- 2026-11-10：旧节点 Files 在结构化 `service_catalog bad_op` 分类后新增最小只读 `list`：冷/热缓存均走固定认证 `POST /api/devices/{target}/fs/list`，请求体只含 `path`，严格校验设备、路径和目录项并强制 `writable:false`；现代 list 与旧节点 drives/workspaces 原路径不变。旧 Codeg 网络目录为空或没有 ready 网络时返回明确的安全配置错误，仍禁止直连或放宽成员/`service_ip` 校验。
- 2026-11-10：修复 Electron legacy Codeg guest 初始生命周期：`prepareGuest` 先按隔离 session 唯一匹配活动记录，允许已由 attach 参数门禁验证的 `about:blank` 初始页；已导航 HTTP(S) 仍必须与授权 endpoint 严格同源，其他 URL 全部失败关闭。
- 2026-11-10：修正旧节点 Codeg 打开契约：网络目录严格读取生产 `devices`（不接受 `members` 别名）；legacy 分类缓存冷/过期时先重新执行一次 catalog，仍仅以结构化 `bad_op` 进入兼容路径；guest 私密 token URL 首次加载失败时保留安全重试，成功后才标记已准备。
- 2026-11-10：第二段旧节点兼容仅对 `bad_op` 分类读取 `agents_runtime_status`；Codeg ready 只公开状态和 legacy open marker。打开时重新校验严格 token URL、ready 网络双端成员与目标 `service_ip`，经本机 SOCKS 隔离 session 加载；IPC 仅返回无查询 root origin、本地 view ID 与 partition。legacy view/close/clear 不调用远端 ping/revoke/start，token URL 只由主进程 guest 准备阶段加载一次。
- 2026-11-10：legacy catalog 仅由结构化 `service_catalog bad_op` 建立 actor+target+generation 缓存；`device_not_found`、认证、网络及其他错误直接上抛。`drives`/`workspaces` 冷缓存会先分类一次：legacy 在 `service_open` 前走现有主进程认证 Controller GET，现代目录复用于同次原生 open；严格校验状态、设备 ID 与数组字段，其他文件操作继续使用原生 Files service。
- 2026-11-10：原生 workbench catalog 仅对结构化 `bad_op` / `device_not_found` 降级为 protocol 1 的五服务 `missing` 目录，标记 `legacy: true`，按 actor+target 缓存 60 秒；401/403 与其他错误继续上抛，清理 actor 时清除该缓存。为旧协议节点提供升级说明，为身份未连接记录提供重连说明，避免 DSH 5 秒轮询反复命中同一失败请求。r2 已在在线 REMOTESTITCH-HUB 上约 45 秒稳定显示升级说明与禁用按钮；portable 构建退出码 0，大小 823,673,294 字节，SHA-256 `38cb0ccd3403af7d4dd870e199ae552a6c70447a4d24878db9aaabef089e5bca`。下一步仍需复用旧节点 status/list 接口适配，暂不改 open 路径或要求重装，未宣称 Codeg/DSH 真机工作台可用。
- 2026-11-10：实机确认 OIDC 登录成功，`oidc-session.json` 已加密落盘且 `desktopAuthMode=oidc`；随后设备列表与原生工作台 catalog 因仍直接使用 Electron session fetch、未携带 OIDC Bearer 而收到登录重定向。将 native workbench `getActorId` 与 `tether:hub-request` 的 Controller API 请求统一改走 `controllerFetch`，保留原 URL、方法、请求体、redirect 和路由 allowlist；legacy cookie 探测与显式旧账号绑定保持原路径。
- 2026-11-10：修复 Electron Controller OIDC 401：诊断确认 `validate /api/auth/me` 返回 200，而紧接的 `controllerFetch` 对 `/api/auth/me` 和 `/api/events` 返回 401；根因是 `controllerFetch` 预先写入 Authorization 后，`oidcAuth.fetch` 再追加 Bearer，形成重复 Authorization 值。移除 OIDC 分支预先注入，让 `oidcAuth.fetch` 唯一添加 Bearer；保留 Controller URL 限制和 `redirect: 'error'`，legacy bearer 分支不变。此前移除 `credentials: 'omit'` 并非根因。
- 2026-11-10：修复候选 OIDC Casdoor 生产请求形状：OAuth 参数按 Casdoor camelCase 约定放在 `POST /api/login` query，JSON body 仅含登录字段；账号密码不进入 query/header。回归断言覆盖请求边界。
- 2026-11-10：candidate-only OIDC QA 登录入口：仅候选模式且配置凭据文件时，由候选自身调用 Casdoor `/api/login` 并把 authorization code/state送入既有 loopback callback；交互式/MFA 响应明确失败，常规模式仍打开系统浏览器。新增定向单测；未构建安装包，需 packaged candidate 实际验收。
- 2026-11-10：0.5.2 visible login 接入系统浏览器 Casdoor Authorization Code + PKCE，固定回调 `http://127.0.0.1:18893/oauth/callback`；访问/刷新令牌仅由主进程加密保存，旧版有效会话仅在迁移前作为兼容入口，成功登录及显式退出均持久化 `oidc` 模式，启动时不再回退旧 bearer/cookie。登录状态先于工作台状态轮询，UI 按认证状态门控。25 项 Node 定向测试通过；Windows runtime 与 portable 冷启动通过。正式 Hub 已切换 r7 dual audience，旧 web OAuth/旧 Bearer 保持可用，4 条设备记录保留；真实用户登录与原设备 UI 仍待验收。
- 2026-11-09：正式安装包使用默认运营 Controller 时提供匹配的 OIDC issuer，避免未配置环境变量的新安装无法跳转登录；显式 QA issuer 和自建 Controller 保持原配置。仅完成配置分支验证，尚未启动候选 APP 验证登录窗口。
- 2026-11-09：旧版首次迁移在原身份校验和stage切换中新增Codeg持久数据接续：复制apps.json及agents-runtime数据库/配置/附件/WAL，拒绝符号链接或reparse tree；runtime.json、server.log不迁移，且旧Codeg进程存活/身份无法确认时拒绝复制。仅计划用隔离fixture核验，未读取正式数据或启动APP。
- 2026-11-08：工作台服务与远程桌面连接改为使用本机 Node 按可信 network_id 查询的 loopback SOCKS5 route；Electron隔离session走该route，TLS CA/主机名/leaf校验也经成熟 `socks@2.8.10` 代理连接，关闭/清理时复位session代理。未启动APP或重跑远控场景。
- 2026-11-08：添加 `tether:files-request` 受信主进程/preload桥接到native-workbench files service。IPC只接adapter受限target/op参数；主进程使用iconv-lite支持UTF-8、BOM UTF-8、UTF-16 LE/BE、GB18030文本编码和换行保留，并拒绝GB18030往返有损文本。增加固定iconv-lite运行依赖。仅做语法检查，未执行Node files集成。
- 2026-11-08：主进程接入 `native-workbench.js` adapter；创建持久 Hub-login Electron partition，通过受信 IPC 提供登录、目录查询、打开、关闭和可见性保活。主进程只接收/处理 bootstrap 与 TLS descriptor，renderer仅从 adapter拿公开 endpoint/状态，不提供 actor/CA/bootstrap；登录完成以Controller `/api/auth/me` 确认，不向renderer传ID token。
- 2026-11-07：0.4.10 候选版本元数据将 APP/Node 对齐为 0.4.10，官方插件发行版本保持 0.2.93；仅登记候选版本，未安装或发布。
- 2026-11-07：0.4.9 候选版本元数据将 APP/Node 对齐为 0.4.9，官方插件发行版本保持 0.2.93；仅登记候选版本，未安装或发布。
- 2026-11-07: 候选发行元数据提升 APP/Node 至 0.4.8，插件保持 0.2.93；本次只更新版本元数据，候选未安装。
- 2026-11-07：发行元数据提升 APP/Node 至 0.4.7，冻结插件仍为 0.2.93。
- 2026-11-07：增加基于Hub/device哈希的本机APP安装绑定记录；启动版本由进程启动时捕获，配置与新发设备凭据刷新保留同一运行版本，供独立Node安全识别APP安装与运行态。
- 2026-11-07：为 0.4.6 候选同步 APP package.json/lock 元数据；插件版本继续冻结为官方稳定 0.2.93，不含插件新版。
- 2026-11-07：下一批候选 APP/Node 元数据为 0.4.5，插件仍引用独立稳定版 0.2.93；真实现网目前仍为 0.4.4。
- 2026-11-07：支持 `hub.json` 中的 `nodeMode=external`，Hub 模式下复用外部 Node，不再启动/停止第二个 Node；外部模式不向 UI 暴露随机本机 API token，重新登记凭据时保留该设置。
- 2026-11-07：启动时保留指向其他有效 Tether 安装的快捷方式，仍修复本安装和失效链接。
- 2026-11-07：候选版本元数据同步至 APP `0.4.4`、冻结插件 `0.2.93`、Node `0.4.4`；pyproject 与 APP npm 根锁版本同步为 `0.4.4`，插件源码版本保持独立。
- 2026-11-07：DSH Web guest 绑定首次批准的主框架 origin，并阻止跨源服务端重定向；Electron 安全导航策略拆为可单测 helper。
- 2026-11-03：窗口改为 `frame:false` 无原生标题栏，顶栏自绘窗口控制；关闭默认隐藏到 `Tray`，只有托盘“退出”或更新重启才 `app.quit()`。`window-all-closed` 在有托盘时保持进程；第二实例恢复窗口。图标统一使用 `assets/tether-app-s.ico`。
- 2026-10-31：登记决策抽成 `enrollment.js` 纯函数（device/account/refuse/error），4 个单测覆盖；main.js 只做 fetch/写配置/重启。
- 2026-10-31：登录登记改为两步：已有设备走 `/enroll` 轮换令牌；`device_not_found`/`device_offline` 才写 `userToken`、清 `nodeToken`、删除旧设备令牌并重启；`device_owned` 拒绝。supervisor 可在只有用户令牌时启动 Node。
- 2026-10-31：新增可信 IPC `tether:enroll-device`：用登录会话调 Hub 登记，轮换设备令牌（旧令牌 10 分钟宽限）、备份并写回 `hub.json`、重启 Node；preload 暴露 `enrollDevice`。
- 2026-10-31：0.2.35 发布（tag `v0.2.35`）；含导航/IPC 加固、Python 3.13 重启修复与更新任务吞吐修正；LAPTOP-01 Node/APP 0.2.35（纯 APP 更新 20.1 秒），本机开发版重启到 0.2.35。
- 2026-10-31：Electron 主窗口只允许本地 UI origin 导航，`setWindowOpenHandler` 拒绝新窗口（http(s) 仅交系统浏览器），所有 `tether:*` IPC 校验 `senderFrame === mainFrame` 且 origin 为本地 UI。真机验证：外站导航被阻止并记录，主 frame `tetherApp.info()` 正常，sandboxed iframe 无该 API。
- 2026-10-30：0.2.27 热修版本元数据；更新中心 latest 归一化。
- 2026-10-30：APP/Node 一键更新卡改为单一运行态；版本元数据推进到 `0.2.26` 候选。
- 2026-10-29：主人认可资源管理器第五版后，将 APP package 与 lock 根元数据推进到 `0.2.25`；实际发布与安装状态仍以 release/进度文档的后续验收为准。
- 2026-10-28：APP package.json 与 package-lock 根元数据升至 `0.2.12`，等待 release gate。
- 2026-10-28：公开 APP 版本升至 `0.2.11`，并在窗口首次加载前增加最多 8 秒服务启动等待和最多 3 秒本机 Node API 就绪探测；超时仍展示 UI。
- 2026-10-28：窗口加载前最多等待 supervisor 8 秒；Hub 模式的 APP 本机 Node 启动后，以当前设备身份和本进程 token 对本机 policy 只读接口最多轮询 3 秒，超时或启动失败仍加载可诊断 UI。回归 `test_app_startup_readiness.mjs`。
- 2026-10-28：Electron renderer 记录脱敏的 console/load/navigation 诊断、本机与配置 Hub 的请求错误/HTTP 状态，以及 frame 即时与 3 秒稳定后的就绪/composer 标记；不记录 headers、body 或页面文字。
- 2026-10-28：APP 包与 package-lock 根版本递增至 `0.2.10`，对应 Explorer broker 重启修复候选。
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
- 2026-10-28：APP package.json 与 package-lock 根元数据升至 `0.2.13`，等待 release gate。
- 2026-10-28：APP 自更新助手的运行时改为**遍历 `tether/` 整包**暂存，不再手写文件清单；必须覆盖 `updates.py/updates_cli.py/release.py/ed25519.py`。原因：`updates.py` 新增 `import .release` 后，旧清单让助手在 APP 退出后直接 `ModuleNotFoundError`，自更新必失败。回归 `test_update_service.mjs`（真实 import 闭环）。
- 2026-10-28：surface 启动失败自动恢复：main 监听子 frame 的 `web boot: N entry did not activate`，经 preload `onSurfaceBootFailed` 通知 renderer；`NativeSurface` 换新 ticket 重建 iframe（1/2/4s，最多 3 次），surface 接口的 502/504/device_offline/surface_timeout 也自动重试。
- 2026-10-29：APP package.json 发布版本升至 `0.2.16`，等待 release gate。
- 2026-10-29：APP 的 `check` 命令超时 45 s → 90 s：本机更新器按 Hub mirror → GitHub 逐源回退，两个源各 15 s 再加 latest API 解析会撞上 45 s，慢网下会误报检查失败。
- 2026-10-30：APP 包、package-lock 根版本元数据统一至发行候选 `0.2.29`；不改变 Electron 依赖锁定版本。
- 2026-11-01：APP 包与 package-lock 根版本升至 `0.2.51`；本轮 APP 主进程代码未改，修复在共享 UI。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.54`；共享 UI 新增常驻 `SurfaceDeck` 与设置开关，不改变 Electron 依赖或主进程窗口参数。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.55`；本轮只更新共享 UI bundle（surface 层叠、选择器叠层、设置页），Electron 主进程与依赖未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.56`；选择器叠层改为内联样式/SVG，DSH 内嵌页不再依赖共享 CSS。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.57`；本轮共享 UI 增加树联动、文件夹上传、本地拖入保存；Electron 主进程未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.58`；共享 UI 只增加转移页设备分组标识与切设备清旧根。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.59`；共享 UI 增加显式设备拓扑、节点详情/连接管理；Hub `/api/edges` 已先行部署。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.60`；本轮只更新共享 UI 账户页（头像裁剪/昵称/密码），Electron 主进程与依赖未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.61`；共享 UI 权限抽屉改为缓存直出，Electron 主进程与依赖未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.62`；长期运行的 Controller/Node 改用 `pythonw.exe`，`.cmd` 默认经 VBS 隐藏重入，bootstrap PowerShell 隐藏，更新助手重启 APP 设置 `windowsHide: true`，确保打开/更新不再出现黑色终端。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.63`；本轮只改共享 UI 登录页，Electron 主进程未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.64`；本轮只改共享 UI 互联图，Electron 主进程未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.65`；本轮只改共享 UI 节点详情浮层，Electron 主进程未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.66`；共享 UI 恢复互联图力导向流动，Electron 主进程未改。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.67`；`UpdateService` 与本地 serverCheck 改用 `supervisor.childPython`（pythonw），消除启动更新检查的短命控制台/`conhost`；`pythonw` stdout 经 `execFile` 验证可回传。
- 2026-11-02：APP 包与 package-lock 根版本升至 `0.2.68`；本轮只改共享 UI 更新页，Electron 主进程未改。
- 2026-11-03：APP 包与 package-lock 根版本升至 `0.2.83`；启动时 `ensureAppShortcuts()` 用 `shell.writeShortcutLink` 把桌面/开始菜单 `Tether APP.lnk` 修回 `electron.exe`（旧快捷方式指向 `.cmd` 会弹黑窗）；主进程识别 surface 网关 502 错误页并触发既有 `tether:surface-boot-failed` 重试，避免旧 iframe 永久停在错误页。
- 2026-11-03：APP 包与 package-lock 根版本升至 `0.2.84`；surface 缺失且 DSH 正在运行时自动调用 `dsh_install_plugin`，成功后按新 pid 重载；失败显示“安装/修复插件”重试按钮，用户不再手工拷包。
- 2026-11-03：APP 包与 package-lock 根版本升至 `0.2.88`；自动修复改用 `dsh_status.surface`（descriptor pid 存活）判断，surface 轮询的插件缺失错误也进入修复态；本机空 profile 已实测 APP 自动装回并渲染。
- 2026-11-03：APP 包与 package-lock 根版本升至 `0.2.89`；iframe 载入后探测默认控件样式，命中后自动修复一次，再次命中显示“DSH 界面样式与 Tether 版本不匹配”遮罩，避免裸控件页面。
- 2026-11-04：主窗口开启 `webviewTag` 供 Linux DSH Web 顶层内嵌；`will-attach-webview` 删除 guest preload、强制 sandbox/contextIsolation/webSecurity，只允许回环与 RFC1918 地址；`did-attach-webview` 拒绝新窗口并把 guest 导航锁在首次 origin。DSH 外部 `window.open` 已删除；真机 webview 与插件自动安装仍待验。
- 2026-11-04：APP 默认直接连接 Hub 与 mesh，不跟随系统代理：`main.js` 在 ready 前 `appendSwitch('no-proxy-server')`，只有 `TETHER_USE_SYSTEM_PROXY=1` 才保留系统代理。实测系统代理故障时 Python 节点仍能注册 Hub，但 Electron 渲染器访问 `/api/state` 全部 ERR_FAILED、界面显示 0 台设备；切换直连后 example.com 与 Hub 都可达，设备恢复。不要再在 `whenReady` 里用 `setProxy({mode:'system'})` 覆盖该开关。
- 2026-11-07：修复 Linux DSH WebView 在 guest 初始 `about:blank` 时把 origin 锁为 `null`、导致首个 LAN 导航被拦截的问题；现在允许首个受限 LAN HTTP(S) 导航建立 origin，之后继续限制同源。新增 Electron 导航守卫回归断言。
- 2026-11-08：新 workbench `persist:tether-wb-*` WebView 不再走 legacy 私网地址规则，`will-attach-webview` 改向主进程 workbench授权记录校验partition与精确origin；增加基于Hub login partition的受限`hubRequest` IPC（固定Controller origin，仅GET/POST `/api/`，不向renderer回传Cookie/token）和`workbenchLogout`清理入口。OAuth登录前先用旧actor撤销并清workbench session；若撤销/清理失败，不允许切换账号并在退出时返回`revocation_pending`。共享UI host已接主进程桥，账号事件/行为仍待整体APP验证。
- 2026-11-08：新增锁定 `eventsource@3.0.7`（支持APP当前 Electron Node 20 runtime）作为 Hub `/api/events` 成熟SSE客户端；事件仅经登录 partition的固定Controller URL取回、只转发JSON device/session事件到可信主窗口，登录切换和登出关闭订阅。Hub业务HTTP同样经主进程固定origin/路由allowlist访问，不把session cookie或ID token暴露给renderer。
- 2026-11-08：新增仅在OIDC返回`oidc_identity_unbound`的待绑定状态开放的`workbenchBindLegacy`主进程IPC：凭据仅用于Controller旧账号登录并建立旧session，然后由OAuth2Proxy注入服务端的Casdoor ID token调用显式`iss/sub`绑定；主进程再确认 `/api/auth/me` 才发 authenticated。密码、ID token与Controller session cookie不写localStorage或回传renderer；用户输入表单与实登录待联调。
- 2026-11-08：APP默认数据目录改为Electron平台用户目录；首次加载Hub配置/Supervisor前递归无覆盖复制旧`data`树，包含Node数据库、Electron持久会话、升级/用户记录及日志，保留旧副本且目标已有文件不覆盖。旧数据非空时要求安装器停旧APP和受管Node并带`TETHER_DATA_MIGRATION_QUIESCED=1`，否则明确拒绝启动。`TETHER_APP_DATA_DIR`显式隔离目录，`TETHER_APP_CANDIDATE=1`隔离环境变量/旧Hub配置/快捷方式/安装登记、external Node模式和候选截图路径。

- 2026-11-08：--shot启动时隐藏APP窗口（普通启动仍显示），供隔离候选调用既有capturePage截图时不抢桌面焦点。数据迁移仅在旧APP与受管Node停机后设置TETHER_DATA_MIGRATION_QUIESCED=1执行；语法检查通过，候选首屏待隔离启动验证。

- 2026-11-08：候选模式跳过安装注册与watcher、快捷方式、worktree .env/hub.json加载，强制external Node；--shot隐藏窗口并走原capturePage。旧data全目录迁移只在安装器停旧APP及Node后显式标记quiesced；候选仍需父代理隔离启动观察。

- 2026-11-08：为--shot分支补loadURL/wait/renderState/capturePage阶段日志和分别30s/10s/15s有界等待；shot隐藏页启用paintWhenInitiallyHidden且关闭后台节流，仅限诊断模式。用于本次候选首屏定位，不改变常规APP渲染策略。

- 2026-11-08：OIDC登录窗口仅允许精确Controller/Issuer HTTPS origin，或明确配置的localhost回环HTTP origin；修复本机隔离Casdoor HTTP端口被登录导航守卫误拦的问题，仍不开放任意私网URL。
- 2026-11-08：候选 APP/Node 版本统一到 `0.5.0`，plugin 继续固定 `0.2.93`；锁定 `electron-updater@6.8.12` 作为平台包更新器运行依赖，正式发布仍待候选验证和签名条件。
- 2026-11-08：packaged APP 主进程从 `resources/tether-source`, `resources/tether-ui/web`, `resources/tether-runtime` 解析源码/UI/固定组件；设置 packaged Python、Agents/Herdr、SFTPGo、Caddy、rclone、EasyTier 绝对路径，不读worktree `.env`，关闭源码树登记更新绑定。
- 2026-11-08：打包 APP 的更新入口切到 `electron-updater`：preview channel 检查、下载、显式应用和已下载状态由成熟更新组件执行；源码开发模式保留 Tether 签名清单/更新助手。活动状态仍通过现有更新 CLI fail-closed 检查。真实已发布更新清单、Windows/macOS签名与安装更新尚待候选制品验证。
- 2026-11-08：打包更新真正退出安装前，先要求旧版 APP 活动检查通过，再按私有PID/创建时间/可执行路径/local API token停止本APP拥有的Node；新APP重启后由Supervisor按同一Hub配置恢复Node。
- 2026-11-08：为打包 Node 注入固定绝对资源路径 `TETHER_NODEJS_EXE`（`components/nodejs`）、`TETHER_MESHCENTRAL_ROOT`、`TETHER_MESHAGENT_EXE`，覆盖Windows x64、Linux x64和macOS x64/arm64；远控Node服务尚未启用，缺少制品时不使用系统PATH回退。
- 2026-11-08：打包 APP 的 Hub 受管 Node 改为独立后台子进程；私有 `data/private` 状态文件保存随机local API token、device/controller/data目录、PID、进程创建时间与可执行路径。重开时先校验进程身份+token本地API，再复用原Node；显式Stop只关匹配进程，APP退出保留当前Hub Node。Linux目录/文件使用0700/0600，Windows通过icacls仅授当前用户权限。尚未注册系统登录启动任务；系统重启后的自动恢复仍待安装器/平台验证。
- 2026-11-08：packaged APP新增 `TETHER_DSH_RUNTIME_DIR=resources/tether-runtime/components/dsh` 固定资源映射，供Node受管DSH宿主使用，不回退到系统Node或任意用户目录。
- 2026-11-08：新增受控登录启动IPC：已安装非候选APP在Windows/macOS使用Electron登录项，在Linux使用当前用户XDG autostart；默认不启用，候选模式无法改系统项。打包APP明确设置 `TETHER_NODE_UPDATE_OWNER=app_installer`，由electron-updater安装完整APP/Node资源树，Node单独更新入口应据此拒绝写入APP-owned运行树。
- 2026-11-08：主进程为office-preview设置只读打包LibreOffice可执行路径（按Windows/Linux/macOS布局），renderer不能选择或覆写程序路径。
- 2026-11-08：增加受控`workbenchRegisterAccount` IPC，仅允许主进程确认的未绑定OIDC态向固定Controller注册路由发空请求；成功后主进程重新取`/api/auth/me`可信用户并发布authenticated事件，身份资料不由renderer传入。
- 2026-11-08：远程桌面隔离session通过可信本机EasyTier SOCKS5路由访问目标服务；TLS预检/证书回调也沿代理做CA、主机名与叶证书校验，固定运行依赖`socks@2.8.10`。公开给UI的服务状态包含原生会话截止时间。
- 2026-11-08：远程桌面 guest capability 有明确24小时原生截止，主进程只向UI给出截止时间；SOCKS路由从受信本机Node route callback获取，renderer不接触proxy配置。

- 2026-11-08：0.5.0 packaged APP 首启从 per-user app-installations 登记中按 Controller origin、device ID、credential fingerprint 与本地安装根唯一发现旧版数据；确认登记 APP 与私有 managed Node PID 已退出后，只备份并迁移 hub.json、device-token.json、node-hub/node-local SQLite 主文件及 WAL，跳过 Chromium LevelDB 和旧进程状态。新目标非空拒绝合并，身份在副本上复核后才原子切入；默认 packaged Hub 指向已核验公开入口，迁入或用户配置优先。未做正式进程停止/复制，待候选安装器验证。

- 2026-11-08: 0.5.0 首迁移接收 NSIS <installation-id>.migration-source marker，先验证用户本地 snapshot 路径、快照身份指纹和旧 APP/Node 停止状态；迁移成功后移除 marker。白名单补入 policy.json，保留文件访问权限策略；不迁移 managed Node 运行状态。

- 2026-11-09：packaged APP 的 installer-owned 远程更新通过仅绑定 127.0.0.1 临时端口、随机 Bearer 和严格四动作桥接到 electron-updater；Node 凭据仅经子进程环境传递。提交更新前校验下载活动/准备标识，Controller 收到 accepted 后才请求 APP 停 Node 并退出安装。更新通道显式环境变量优先，否则按包内 app-update.yml channel 决定；candidate mode 默认 preview。
- 2026-11-09: native-workbench service opens now preserve only structured `detail.code` on HTTP errors and handle only `service_starting` in the existing pending open with a 30s AbortSignal-bounded catalog-ready wait, same operation ID, and actor-change cancellation; HTTP 401/403 fail immediately. Focused Node harness passed startup-ready retry/same-ID, auth-stop, and actor-cancel cases; actual QA cold-start observation remains pending due the QA Node lacking the `dsh_native` session-list capability.
- 2026-11-09：APP 安装提交在 ACK 后遇到停止 Node/quitAndInstall 错误时写入既有 update-result.json；Electron status 回传匹配目标版本的错误，下一次 prepare/apply 清除旧错误。源码/legacy ZIP apply 恢复32位准备标识及进程内准备集合校验。
- 2026-11-09: cold-start verification did not run: QA-SOURCE DSH-Web is stopped but the source-owned DSH desktop reports running under its isolated `source/node/dsh-home`; the DSH session-list API returns `node_update_required`, so active work cannot be ruled out. No QA DSH process was started/stopped.
- 2026-11-09: startup open stores each successful descriptor before the actor-generation guard so a login change can still revoke the returned grant; final syntax/module-load check passed.

- 2026-11-10：新增远端 DSH surface 主进程票据兑换：仅接 targetId，校验可信 gateway/303/token-free endpoint，隔离 partition 并复用 grant 清理；通用 Hub IPC 拒绝 DSH surface 路由。
- 2026-11-10：修复 `dsh-native` guest attach：主进程已兑换 ticket 后，`prepareGuest` 直接复用隔离 session，禁止落入 legacy Codeg 的 `loadURL` 流程；保留本地 close/clear/view 清理语义。
- 2026-11-10：修正生产 DSH gateway 校验：`g<port>` 子域端口保持 1..65535 范围约束，公网 URL 严格使用默认 HTTPS 端口，不再错误要求公网端口等于目标 DSH 端口。
- 2026-11-11：远端 DSH ticket 改由 main-owned 隐藏 BrowserWindow 在随机隔离 partition 中做真实 document navigation；锁定 gateway Origin，只接受精确 `/?tether_native=1` 与合规 `__Host-tether_` Cookie，失败销毁窗口并清 session/cache，renderer 始终看不到 ticket。
- 2026-11-11：远端 DSH hidden bootstrap 的脱敏失败日志新增固定阶段事件（创建、导航、endpoint 校验、Cookie 校验、record 完成）；只沿用安全 target/service ID，不记录 URL、host、ticket、Cookie 或原始异常。
- 2026-11-11：修复 CHIPS Cookie 验证：在每次新建的专用随机 partition 中用空过滤器读取 Cookie，保留 `__Host-tether_`、HttpOnly、Secure、根路径校验，并要求规范化 domain 精确匹配最终 endpoint hostname。
- 2026-11-11：修复 Electron 33 managed guest 预提交 attach：main 在注册导航事件前同步按唯一隔离 session 取得无秘密 policy；`dsh-native` 接受空 URL/about:blank 后只允许精确 token-free endpoint 的主框架导航，其他路径、查询、fragment 和跨源均失败，子框架不受影响。

- 2026-11-11：旧 Codeg 兼容打开在现代 ready mesh/SOCKS 路由不匹配时，可回退到当前已鉴权 Controller 快照中的在线目标 capabilities.direct_api.host；仅当它精确匹配 runtime token URL 且命中本机 RFC1918 EasyTier 接口同网段时走 OS 私网直连。专用 session、单 origin 请求守卫与主进程 token bootstrap 保留，匹配现代 mesh 时仍优先 SOCKS。
- 2026-11-11：旧 Codeg 兼容打开在现代 ready mesh/SOCKS 路由不匹配时，可回退到当前已鉴权 Controller 快照中的在线目标 `capabilities.direct_api.host`；仅当它精确匹配 runtime token URL 且命中本机 RFC1918 EasyTier 接口同网段时走 OS 私网直连。专用 session、单 origin 请求守卫与主进程 token bootstrap 保留，匹配现代 mesh 时仍优先 SOCKS。

- 2026-11-11：legacy Codeg 在服务目录状态可能陈旧或已停止时，点击启动并打开后先复用目标 Agents Runtime 启停/轮询，再由主进程用新鲜鉴权状态与严格 URL 校验；managed legacy guest 允许首次 bootstrap 的空/about:blank URL，后续 origin 守卫不变。
- 2026-11-11：严格校验 legacy Codeg token URL 后，仅在主进程 bootstrap 副本添加固定 `next=/workspace?tether_home=1`，确保 packaged APP 打开原生 Agents route；renderer 仍只接收 root endpoint，token 与 origin guard 不变。
- 2026-11-12：现代目录中的同机 Codeg 仅在本地目标复用既有隔离 token 网关；运行时停止时只启动一次并重新读取 ready 状态，远端现代 Codeg 继续走原 `service_open`。保留身份代次、在线直连路由、严格 token URL、origin 守卫及 session 清理。`legacy` 标记表示既有 token URL wire mode。新增同机启动/隔离、远端路由、错误身份/URL与账号切换行为用例；25 项 native-workbench catalog 用例通过。

- 2026-11-12：modern remote Codeg 仅在 fresh Controller snapshot 确认当前 actor、目标为该 actor 在线自有设备、没有共同 ready network，且 direct_api 私网地址与本机 EasyTier 子网匹配时，复用既有隔离 token gateway；共享/非owner/无旧网条件继续原 `service_open`，状态/网络目录错误原样失败。启动后状态 URL 仍严格匹配证明过的 direct host，token 不进入 renderer。

- 2026-11-12：新增 0.5.3 APP 候选版本，package.json 与 package-lock.json 同步，Node 版本由 version.json/pyproject.toml 保持同号；插件冻结 0.2.93，尚未构建或发布。
