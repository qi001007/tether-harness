# Tether Web UI 变更记录

- 2026-10-28：将 React 错误边界抽为无 DOM 可测的局部组件工厂，回归覆盖 fallback 与重试恢复。
- 2026-10-28：增加 React 渲染错误边界，显示可理解的错误说明和重试入口；由 `scripts/build-web.mjs` 更新 `dist/app.js`。
