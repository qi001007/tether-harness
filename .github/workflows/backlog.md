# 变更记录
- 2026-11-13：新增 `codex/tether-056-reconnect-20261113` desktop candidate 触发，映射 APP/Node 0.5.6 与 `v0.5.6-preview.1`；保留旧版本映射，聚合结果为 draft prerelease 且 `make_latest: false`。
- 2026-11-12：增加 `codex/tether-055-native-mode-20261112` desktop candidate 触发与 0.5.5/`v0.5.5-preview.1` 选择，并纳入 preview draft 汇总；旧候选映射保持不变。
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

- 2026-11-12：新增 `codex/tether-053-business-20261112` 候选触发，APP/Node 0.5.3、插件冻结 0.2.93；预览产物使用 version-specific scratch/artifact/tag，GitHub Release 保持 draft prerelease 且 `make_latest: false`。
- 2026-11-12：候选发布聚合 job 通过现有 Herdr hydrator 仅暂存 Windows Herdr/ConPTY 五个固定文件，并传给 Node ZIP 打包；不复制完整运行时目录，仍仅生成草稿预览。

- 2026-11-12：候选发布汇总 job 在 isolated checkout 构建共享 UI；从本次 pinned Codeg web artifact 动态计算四个入口 SHA、文件数和总字节数，复制后比较实际摘要再替换 checkout 内旧 web，之后组装 APP/Node ZIP。无本机产物固定哈希或大小门禁。
- 2026-11-12：增加独立 0.5.4 登录会话修补候选分支和 `v0.5.4-preview.1` 草稿 tag；0.5.2/0.5.3 分支版本、tag 和 draft 行为保持原样。
- 2026-11-12：签名 stable 发布工作流排除 `v*-preview.*` tags，避免 preview tag 同时触发旧 signed release job。

- 2026-11-13：候选 workflow 新增 `codex/tether-057-recovery-20261113` / `v0.5.7-preview.1` 映射及发布门禁，保留 0.5.2–0.5.6 既有分支、tag 和 draft 条件。
