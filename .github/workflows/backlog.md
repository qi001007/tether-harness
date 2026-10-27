# 变更记录

- 2026-10-28：允许从 main 输入新版本号生成首个 Draft Release；验证组件版本与本次提交，构建验证通过后才创建缺失 tag，并拒绝不同提交的已有 tag 及已发布 Release 覆盖。
- 2026-10-28：成功校验路径显式以退出码 0 结束，避免无 tag 时 `git show-ref` 的预期退出码 1 泄漏到 GitHub Actions PowerShell 包装层。
