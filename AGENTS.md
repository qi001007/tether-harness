# Tether 源码仓库协作约定

1. **界面与交互铁律**：修改任何前端页面、DSH 嵌入流或 `third_party/codeg/` 前，必读 [docs/UI_DESIGN_RULES.md](docs/UI_DESIGN_RULES.md)（极简图标优先、冷启动默认 DSH、Codeg 内部融合、全路径内置资源管理器）。
2. **跨节点版本兼容契约**：修改 Node/Hub/APP 通信协议或文件传输逻辑前，必读 [docs/TECHNICAL.md](docs/TECHNICAL.md) 顶部「跨节点版本兼容性契约（5 条铁律）」。
3. **产品文档总索引**：见 [docs/PROJECT_INDEX.md](docs/PROJECT_INDEX.md)。
4. **内部 Codeg 重建**：Codeg 前端源码位于 `third_party/codeg/`，使用 `scripts/build_codeg_runtime.ps1` 构建并同步到 `tether/node/bin/agents-runtime/web/`，详见 [docs/codeg-runtime-rebuild.md](docs/codeg-runtime-rebuild.md)。
