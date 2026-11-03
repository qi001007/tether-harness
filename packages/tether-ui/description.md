# tether-ui

三端共享的 Tether React UI 源码与宿主适配层。`src/app.js` 是唯一页面实现，导出
`createTetherPanel({ React, Native, host })`；DSH 插件 bundle 由该文件生成，WebUI 直接打包同一份源码。
`src/terminal-page.js` 提供远程终端页（设备选择、持久 shell、200 ms 增量轮询），同样拼进插件 bundle 与 web 构建。
`hosts/` 只负责 API base 与宿主原生组件差异（DSH 用 `tether-dsh-native-ui`，Web 用内置回落）。
DSH Hub 凭据仅附加到 Hub API base，不随本机 APP/Controller 回退请求发送。
`web/` 是本地验收入口：esbuild 打包、`serve.mjs` 把 `/api` 反代到 Controller。
