# .github 变更记录

## 2026-10-27

- 新增 Windows 版本制品流水线：从 main 输入版本或按精确 tag 提交运行；组件版本需与 tag 一致，安装依赖、构建共享 UI、运行回归、生成 APP/插件/Node ZIP 与 manifest，并创建仅供审阅的 Draft Release；未运行工作流，未发布。
- 2026-10-28：允许 main 上为尚无 tag 的 baseline 运行完整构建验证，成功后创建指向固定 `github.sha` 的 tag 并上传 Draft；拒绝非 main 手动运行、提交不匹配的已有 tag和覆盖已发布 Release。
