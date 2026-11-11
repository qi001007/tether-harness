# 变更记录
- 2026-11-11：Actions run 42937706743 的 build jobs 全绿，但因首个 preview 标签错误为 preview.2 而被发布脚本拒绝；已改回首个合法标签 preview.1。
- 2026-11-11：将 `v0.5.2-preview.2` 作为公开 prerelease 发布，使 Hub 可按固定 tag 无认证拉取；继续使用 preview channel 且 `make_latest: false`，不影响 stable/latest。
- 2026-11-11：为避开已运行的旧候选任务，将 manifest 与 draft 发布 tag/name 统一到 `v0.5.2-preview.2` / Preview 2；0.5.2 artifact 与预览分支保持不变，并同步测试期望。
- 2026-11-11：desktop preview workflow 按 workflow 与 ref 稳定分组并启用并发取消，避免旧提交与新提交竞争固定 preview tag；测试增加对应最小断言。
- 2026-11-11：desktop preview candidate workflow 对齐 APP/Node 0.5.2、专用预览分支及 `v0.5.2-preview.1`；汇总 job 校验四平台与 Linux Node artifact、SHA256 清单和 macOS 更新元数据版本。
- 2026-11-09：修复 preview 发布聚合 job 缺少 psutil 导致 build_release.py 导入失败，固定安装 psutil 7.2.2；四个平台的上一轮安装包构建已成功。本次连同正常安装登录、Codeg 数据迁移和 Linux LibreOffice 系统依赖修复重新冻结构建。
- 2026-11-08：候选打包工作流将 macOS x64 package job 时限提高到 65 分钟，其他平台保持 35 分钟；preview draft 汇总 job 限时 20 分钟。
- 2026-11-07：发行先从固定 Codeg 提交重建前端。候选分支保留验签后的 Actions 构建产物，版本标签和 main 手动流程生成发行草稿。

- 2026-11-07：Draft release 与 POSIX Node smoke workflow 接受 APP/Node 同版本和官方签名冻结插件分离；下载固定 GitHub 版本资产交由构建器验签/核 hash，Draft 冻结模式仅上传 APP、Node 与统一 manifest。
- 2026-10-28：发布门禁增加独立 `test_*.cjs` Node 回归测试步骤，覆盖 CommonJS renderer 诊断模块。
- 2026-10-28：允许从 main 输入新版本号生成首个 Draft Release；验证组件版本与本次提交，构建验证通过后才创建缺失 tag，并拒绝不同提交的已有 tag 及已发布 Release 覆盖。
- 2026-10-28：成功校验路径显式以退出码 0 结束，避免无 tag 时 `git show-ref` 的预期退出码 1 泄漏到 GitHub Actions PowerShell 包装层。
- 2026-11-07：release workflow 仅接受精确 `release-candidate/vX.Y.Z` 分支创建缺失 tag；手动 main 与既有 tag 校验保留。构建前通过固定 SHA/大小的 Herdr runtime hydration 补齐干净 checkout。
