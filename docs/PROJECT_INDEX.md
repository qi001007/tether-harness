# 项目索引（2026-11-23）

当前源码工作树：`.worktrees/tether-0510-node-compat`，分支 `codex/tether-0510-node-compat`，基线标签 `baseline-pre-mesh-file-20261123`。版本：APP/Node 0.5.14、插件 0.2.93；0.5.14 预览为 draft，未公开。已公开在用版本 0.5.13，本机正式 App 实测 `ProductVersion 0.5.13`。

## 唯一事实源

| 主题 | 文档 |
| --- | --- |
| 需求与产品约束 | `PRD.md` |
| 实机进度与验收数字 | `PROGRESS.md`（按日期追加，顶部为最新） |
| 未结反馈 | `FEEDBACK.md`（勾项后保留历史） |
| 架构、更新事务与兼容边界 | `TECHNICAL.md` |
| 组网与传输（控制面 / 数据面 / 文件面） | `MESH_LIFECYCLE.md` |
| 发布产线与制品矩阵 | `RELEASE_PIPELINE.md`、`INSTALL_MATRIX.md` |
| 签名边界与接入 | `SIGNING.md`、`SIGNING_SETUP.md`（`SIGN=0` 默认，签名不是发布阻塞项） |
| 公开发行历史 | `RELEASES.md`（历史记录，现行状态看 PROGRESS / RELEASE_PIPELINE） |
| 本目录约束 | `backlog.md` |

跨仓库入口：工作区 [主控交接](../../../docs/TETHER_HANDOFF.md)、[存储记录](../../../docs/STORAGE.md)。

## 已归档或删除的旧口径

- 手工 EasyTier 引导、croc 主传输结论、Hub 中继 1 GB 结论：已从现行文档移除，历史基准见 git 历史与 `PROGRESS.md` 对应日期。
- 旧交接 `HANDOFF-2026-10-29.md`、已交付计划（终端页、应用壳图标、Codeg 原生主页、干净安装验证、UX 修订计划）已删除，保留在 git 历史。
- `docs/release-pipeline/release-matrix.draft.yml` 是设计证据，实际运行以 `.github/workflows/release-matrix.yml` 为准。

## 运行态与边界

- 正式安装与工作区在 `E:\遥望科技实习项目\.runtime\本机运行`；D 盘入口为目录联接。
- 设备更新按钮、登录和云控制台由主人操作；测试大文件与中间产物验收后清理，`.scratch` 只增不整体删。