# tether-ui

三端共享的 Tether React UI 源码与宿主适配层。`src/app.js` 是唯一页面实现，导出
`createTetherPanel({ React, Native, host })`；DSH 插件 bundle 由该文件生成，WebUI 直接打包同一份源码。
`hosts/` 只负责 API base 与宿主原生组件差异（DSH 用 `tether-dsh-native-ui`，Web 用内置回落）。
`web/` 是本地验收入口：esbuild 打包、`serve.mjs` 把 `/api` 反代到 Controller。