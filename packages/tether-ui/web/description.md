# Tether Web UI

本目录包含共享 Tether UI 的浏览器入口、静态 HTML/HTTP 服务与生成后的 Web bundle。`main.js` 负责创建 React 页面并隔离渲染异常；`server.mjs` 提供静态资源及 Controller API 代理。配置 `localApi` 时，本机设备的 fs/workspaces/drives/policy/audit/dsh sessions/dsh surface 直连 Node 回环 console 并注入一次性 token，响应带 `x-tether-local: 1`；其余 `/api` 仍反代 Hub/Controller。
