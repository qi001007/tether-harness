# docs

本目录保存 Tether 的需求、实机进度、用户反馈、技术边界、组网事实、发行产线、签名边界与恢复门禁。逐次过程记录和历史版本保留在原文件中，但不再作为现行结论；现行入口见 [PROJECT_INDEX.md](PROJECT_INDEX.md)。

- 单一事实源：`PRD.md`（需求）、`PROGRESS.md`（进度与实测）、`FEEDBACK.md`（反馈）、`TECHNICAL.md`（架构与更新事务）、`MESH_LIFECYCLE.md`（组网与传输）、`RELEASE_PIPELINE.md`（发布产线）、`INSTALL_MATRIX.md`（制品与安装）、`SIGNING.md`（签名边界）。
- `RELEASES.md` 只记录已发生的发行历史；现行版本与候选状态以 `PROGRESS.md` 顶部和 `version.json` 为准。
- `docs/release-pipeline/` 只保留设计草稿，实际运行以 `.github/workflows/` 为准。
- 旧交接、已完成计划和被取代的传输方案已删除或改写为指针，git 历史仍可追溯；删除前的根目录副本见工作区 `.scratch/cleanup-backup-20261123/`。

私有 Hub 部署、账号、密钥和用户数据不进入本目录；本机存储与清理口径在工作区 `docs/STORAGE.md`。