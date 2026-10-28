# Tether Web UI 变更记录
- 2026-10-28：重建 WebUI dist bundle，包含 v0.2.13 候选刷新动效、状态圆点和自动消失 toast。
- 2026-10-28：共享 UI 更新后尝试重建 Web bundle；当前环境 `spawn EPERM` 导致失败，保留既有产物。
- 2026-10-28：重新生成 Web bundle；UI 源码无本次改动，保留发布构建产物与测试同步。

- 2026-10-28：将 React 错误边界抽为无 DOM 可测的局部组件工厂，回归覆盖 fallback 与重试恢复。
- 2026-10-28：增加 React 渲染错误边界，显示可理解的错误说明和重试入口；由 `scripts/build-web.mjs` 更新 `dist/app.js`。
- 2026-10-28：重新生成 `dist/app.js`（共享 `NativeSurface` 自动重连）；纯 Web 宿主没有 `window.tetherApp`，该路径不启用。
