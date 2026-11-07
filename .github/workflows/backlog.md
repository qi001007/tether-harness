# 变更记录
- 2026-11-07：发行先从固定 Codeg 提交重建前端。候选分支保留验签后的 Actions 构建产物，版本标签和 main 手动流程生成发行草稿。

- 2026-11-07：Draft release 与 POSIX Node smoke workflow 接受 APP/Node 同版本和官方签名冻结插件分离；下载固定 GitHub 版本资产交由构建器验签/核 hash，Draft 冻结模式仅上传 APP、Node 与统一 manifest。
- 2026-10-28：发布门禁增加独立 `test_*.cjs` Node 回归测试步骤，覆盖 CommonJS renderer 诊断模块。
- 2026-10-28：允许从 main 输入新版本号生成首个 Draft Release；验证组件版本与本次提交，构建验证通过后才创建缺失 tag，并拒绝不同提交的已有 tag 及已发布 Release 覆盖。
- 2026-10-28：成功校验路径显式以退出码 0 结束，避免无 tag 时 `git show-ref` 的预期退出码 1 泄漏到 GitHub Actions PowerShell 包装层。
- 2026-11-07：release workflow 仅接受精确 `release-candidate/vX.Y.Z` 分支创建缺失 tag；手动 main 与既有 tag 校验保留。构建前通过固定 SHA/大小的 Herdr runtime hydration 补齐干净 checkout。
