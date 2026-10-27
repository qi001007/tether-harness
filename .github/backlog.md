# .github 变更记录

## 2026-10-27

- 新增 Windows 版本制品流水线：现有 tag 或手动指定的现有 tag 与 `version.json` 一致后，安装依赖、构建共享 UI、运行回归、生成 APP/插件/Node ZIP 与 manifest，并创建仅供审阅的 Draft Release；未运行工作流，未发布。
