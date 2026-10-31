# tether-ui backlog
- 2026-10-31：0.2.41 登录后经 APP IPC 登记设备；18892 代理保留显式用户 Authorization；极简更新 UI 视觉验收（蓝色 ↓ + 白色 blur 遮罩 42%）。
- 2026-10-31：传输块提到 1 MiB；2 MB/34.4 秒、10 MB 目标已生成，吞吐约 60–70 KB/s，1 GB 需 overlay/direct path，不能靠继续加大块解决。
- 2026-10-31：互联页设备右键菜单新增“重启 Node”（确认 + Hub 端点）；实测离线 0.80 秒、重连 2.99 秒。
- 2026-10-31：新增“文件转移”页（双设备/双目录、源文件选择、覆盖策略、进度/取消/重试）与 `transfer.js` 分块续传引擎；真实浏览器已渲染，完整目标写入待 0.2.37 安装后复验。
- 2026-10-31：DSH 目标电脑附件选择器增加可点击面包屑、当前目录搜索、名称/修改日期/大小排序；仍是独立 UI，未抽成与 Explorer 共享的 `TargetFileExplorer`。定向 13 passed。
- 2026-10-31：0.2.35 随客户端发布：极简更新按钮/白雾遮罩保持；服务端只在摘要返回进行中的 job，完成后刷新页面不再常驻遮罩；surface iframe sandbox 与 18892 代理鉴权一并生效。
- 2026-10-31：本地 18892 代理加入每进程随机会话 cookie（HttpOnly/SameSite=Strict）、同源校验、写请求 Origin 要求、API 路径白名单和 realpath 静态边界；畸形 URL 返回 400 不崩进程。surface iframe 增加 sandbox（无 top-navigation）。真机代理验收：无 cookie 401、跨站写 403、非白名单 API 403、畸形路径 400。
- 2026-10-30：连接抽屉的登录/修改密码/邀请码注册/配对码兑换共用 `connection-panel.js`，APP 与 DSH 插件只经 props 传默认地址、默认 token、本机设备与 `onConfigured`；自助改密必须带当前 Bearer token，成功后静默替换新 token；凭据只存 `localStorage['tether.hub']`，不写进 URL、不回显 token。新增凭据入口时保持这个单一来源。
- 2026-10-28：notice/工作区错误改为右上角绝对定位浮层（`renderToasts`），带 `×` 关闭与“重试工作区”，不再插入文档流挤压布局。不要再把错误条放回 header 与 main 之间。
- 2026-10-28：目录/工作区/驱动器/策略按设备缓存；`loadDir` 先显示缓存再校验并把结果回填树缓存；悬停/单点预取目录与文本/图片/PDF 预览；预览不再无条件重载父目录；`fs/list` 并发去重。目录/预览请求带 AbortController+序号，提供“停止加载”。
- 2026-10-28：设备切换增加 `projectsDevice === deviceId` 门禁并按设备保留树缓存，修复切到新设备仍用上一台路径（`not a directory`）。
- 2026-10-28：列表/树悬浮改用应用内 fixed 卡片，显示名称/路径/大小/时间，四边 1px 边框；双击忽略首次 click 的 `detail>1`，只打开一次。不要再把原生 `title` 加回文件行。
- 2026-10-28：`view !== 'chat'` 时暂停 dsh sessions 轮询，减少文件页与原生 Host 轮询争用。原生 iframe 仍保持挂载（渲染契约不允许卸载）。
- 2026-10-27：APP/DSH 连接与服务信息层级统一为服务类型、脱敏地址、连接状态、最近检测及状态请求耗时；DSH 不再将 fallback 显示为 Hub 状态，失败清除上次成功响应，URL 查询凭据禁止保存且错误不回显原文。
- 2026-10-27：服务响应耗时增加“客户端到服务接口的请求时间”提示；Hub 401/403 显示安全的凭据/权限指导，其它失败显示不可达/超时指导，不回显响应原文。
- 2026-10-27：修正无配置时地址表单错误显示“未配置”的问题；既有敏感 URL 只展示安全重填提示，避免静默覆盖。

- 2026-10-27：APP 与 DSH 统一为「连接与服务」抽屉；DSH 探测仅请求已配置 Hub 的 `/api/state`，状态/在线设备数来自真实响应，配置与断开流程保留且不展示令牌。
- 2026-10-27：APP 顶栏为“连接与服务”按钮预留完整宽度；窄窗口启用换行、保留按钮安全区并缩短按钮文案，避免遮挡更新入口。

- 2026-10-27：互联页以当前 APP `/app-context` 的设备 ID 标记并置顶本机；不再把 Hub 的 `local_device` 当作插件客户端本机，身份未知时保持列表原顺序且不标记本机。

- 2026-10-27：DSH 插件无 APP 时通过 owner RPC 获取 Node 同 DSH_HOME 短期身份；每 4 秒同步，过期清除本机状态；手动选中节点期间不自动切回本机。

- 2026-10-27：Phase 1 窄切片。`src/app.js` 从 `dsh-plugin-tether-client/lib/client.js` 机械抽取（UI 主体 2167 行逐字未改），插件 bundle 由 `scripts/build.mjs` 生成，不要手改 `lib/client.js`。缩进是契约：现有测试按 4/6 空格从生成文件抽函数。
- 2026-10-27：WebHost 回落只实现了 App 实际用到的 `FileEntryRow`/`FileTypeIcon`（含 `kind:'folder'`）/`MarkdownText` 与三个语言字典；其余 DSH 原生组件属于旧 transcript 死代码，不要误以为 Web 已覆盖。
- 2026-10-27：WebUI 通过 `web/serve.mjs` 同源反代，因为 Controller CORS 仍只允许 `dsh-app://app`。原生 surface iframe 在非 DSH origin 下的 gateway/Cookie 行为未验收，不能据此宣称 Web 端原生页可用。
- 2026-10-27：`createDshHost` 的 API base 仍是固定 loopback（插件端）；APP 本机自举/远端 Hub 由 `TETHER_CONTROLLER_URL` 切换。真正的 Relay（Controller 在 NAT 后）未做。
- 2026-10-27：权限抽屉改为响应式（`width: min(480px,100%)`，≤760px 全宽、≤520px 表格列收窄）；删掉每个模式的说明段与审计副标题，说明进 tooltip。别再往里加长句。
- 2026-10-27：网络连线用 `vector-effect: non-scaling-stroke` + `strokeWidth:1`、虚线 `3 4`，屏幕厚度恒定；不要再按 viewBox 用户单位写 0.3 那类值。
- 2026-10-27：APP 服务 chip z-index 10、打开自身抽屉时隐藏；不要盖住权限抽屉的关闭按钮。
- 2026-10-27：权限抽屉改全高：顶部策略区 `maxHeight:58%` 独立滚动，审计表 `flex:1` 填满剩余高度；不要再给审计表写 `maxHeight:260`。
- 2026-10-27：`web/dist/app.js` 现已提交，保证拉代码即得新 UI；改 `src/` 后必须重建并一起提交。
- 2026-10-27：网络线 `non-scaling-stroke`，zoom>1 为 1px、其余 1.2px；颜色 `C.sub`、opacity 0.7/0.4、虚线 4 5。要更深、放大也能看清，不要再调回 `C.mute` 或 0.75px。
- 2026-10-27：API 回退时按当前目标 base 生成 headers；Hub bearer token 只发往已配置 Hub，HTTP 鉴权失败仍终止，不继续尝试本机候选。
- 2026-10-28：用锁定的 esbuild 0.25.12 从 `web/main.js` 重建 `web/dist/app.js`，提交生成物以保证拉取即用；共享源码字节契约复核通过。
- 2026-10-28：更新中心刷新按钮绑定完整请求状态并显示旋转图标；刷新项不再并发重入。
- 2026-10-28：旋转动画改到 `.tether-spin > svg` 自身（`transform-box: view-box`），外壳不再固定 `1em`——图标 14–18px 时旧写法让图标溢出旋转盒、看起来不绕圆心。更新错误补充 405/501/401/403 短句；本机插件检查等待 22s 以覆盖子进程 20s 上限。
