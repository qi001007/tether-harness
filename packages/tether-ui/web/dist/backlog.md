# Generated Web bundle change log
- 2026-11-09：最终0.5.1 UI bundle包含Hub登录取消说明与鉴权失效时`SurfaceDeck.authReady=false`修复；SHA-256 `E73DEB69FAC92BF3B9603CCE862F5CF2DB9BD4BE7F5F6EB679C135CC4556D5EA`。
- 2026-11-09：重建 Web bundle，包含 Hub 登录取消后恢复登录说明的修复；SHA-256 `98DBFE678FD76C66293AE6E80817A046391BB9944160E84D696D5C620F329787`。
- 2026-11-09：最终`npm run build:web --prefix packages/tether-ui`产物SHA256 `A2C238672B810BA8D4936005B8280D5EA280BF61A4CD4FFFB49A4B1806E8D055`；根在候选真实Ctrl+R观察到登录后连接设备提示与Hub登录入口，未认证surface/catalog请求受`authReady`门控。
- 2026-11-09：前一首开状态构建因跨组件引用触发真实APP ErrorBoundary；共享源码已改为`authReady`显式prop/Effect guard。候选已回退到首轮可运行OIDC bundle；需要下一回合重建并重新运行候选确认。
- 2026-11-09：基于未登录OAuth2 Proxy的403 HTML响应，将精确主进程`Controller login required`标记显示为“登录后连接设备”，未登录不轮询旧deviceId的workbench目录或远端surface；403 JSON及服务错误继续显示。
- 2026-11-09：基于未登录OAuth2 Proxy的403 HTML响应，将精确主进程`Controller login required`标记显示为“登录后连接设备”，未登录不轮询旧deviceId的workbench目录或远端surface；非登录服务错误仍保留。
- 2026-11-09：业务集成候选中仅更新`app.js`为当前共享UI构建产物以恢复APP OIDC入口；原bundle备份与前后SHA256记录在0.5.0业务集成交付backlog。

- 2026-10-30: Rebuilt `app.js` with update response arbitration, stale/cache provenance, and visible stale or failed update states.
- 2026-10-30: Rebuilt `app.js` with visibility-aware single-flight native-surface polling, obsolete request cancellation, iframe document-load readiness, and bounded retry handling.
- 2026-10-30: Rebuilt `app.js` to retain a same-device, same-source loaded frame across panel visibility changes, show a non-blocking loading status, and use a 30-second bounded retry watchdog.
- 2026-10-30：重建 app.js，包含更新后 installed/latest 状态合并修正。
- 2026-10-30：重建 0.2.29 APP Web bundle；离线 APP ZIP 核实包含显式登录 authority 锁定与本机 surface 快路径修复。

- 2026-11-07：UX-06 删除远程应用专属前端入口与页面，保留 Agents 共用图标及后端服务；候选待真实加载验收。
