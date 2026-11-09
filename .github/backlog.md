# .github 变更记录

## 2026-10-27

- 新增 Windows 版本制品流水线：从 main 输入版本或按精确 tag 提交运行；组件版本需与 tag 一致，安装依赖、构建共享 UI、运行回归、生成 APP/插件/Node ZIP 与 manifest，并创建仅供审阅的 Draft Release；未运行工作流，未发布。
- 2026-10-28：允许 main 上为尚无 tag 的 baseline 运行完整构建验证，成功后创建指向固定 `github.sha` 的 tag 并上传 Draft；拒绝非 main 手动运行、提交不匹配的已有 tag和覆盖已发布 Release。

- 2026-11-09：候选工作流从已校验的Node发布ZIP复用8个Herdr文件，并把已校验Electron官方ZIP放入@electron/get缓存后走原安装程序。
- 2026-11-09: The common Herdr job downloads the four official v0.9.5 release assets by pinned ID and validates them through the existing hydrator; the publisher stages that verified artifact into `tether/node/bin` before building the signed Node ZIP. The hydrator uses read-only contents access; publisher permissions remain unchanged.
- 2026-11-09: CI runtime assembly uses the read-only job token with `gh api` tag/name matching for GitHub release assets and bounded curl retries for other official sources; existing pinned size/SHA checks remain.
