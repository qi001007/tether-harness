# tether-ui

三端共享的 Tether React UI 源码与宿主适配层。`src/app.js` 是唯一页面实现，导出
`createTetherPanel({ React, Native, host })`；DSH 插件 bundle 由该文件生成，WebUI 直接打包同一份源码。
`src/terminal-dock.js` 是资源管理器底部的终端停靠面板（cwd=当前目录、shell 由目标机能力决定）；`src/apps-page.js` 提供远程应用页（apps.json 白名单、内嵌 iframe）；`src/agents-page.js` 提供 ACP Agents 页（Harness 检测、流式消息、模型切换、权限卡片）；它们同样拼进插件 bundle 与 web 构建。
`hosts/` 只负责 API base 与宿主原生组件差异（DSH 用 `tether-dsh-native-ui`，Web 用内置回落）。
DSH Hub 凭据仅附加到 Hub API base，不随本机 APP/Controller 回退请求发送。
`web/` 是本地验收入口：esbuild 打包、`serve.mjs` 把 `/api` 反代到 Controller。
