# 传输引擎选型（2026-11-04，已被取代）

> 结论已失效。当时的决定是“删除自研 4 MB 分片，主路径改用 croc 11.6.3”；后续产品转向**目标 Node 的 SFTPGo + 私网 SFTP / 限时转发**作为文件面。现行事实见 [MESH_LIFECYCLE.md](MESH_LIFECYCLE.md)、[TECHNICAL.md](TECHNICAL.md) 和 [PROGRESS.md](PROGRESS.md)。croc 代码仍随包保留，但不是默认文件面。

## 保留的决定内容（仍适用）

- 不再自研分片协议、确认、重试、续传和拥塞控制；文件传输使用成熟组件。
- 不再把 Hub/base64 当作大文件数据面。
- 不用代理器或别的链路数字当基准；只认可同一路径、同一对设备的对照。
- Tether 只负责身份、票据、路径权限、暂存、校验、进度、取消和审计。

## 历史细节

分片方案的失败分析、croc/Syncthing/aria2/RustDesk 对比、croc 迁移顺序和当时的实测数字，已由 git 历史保留（删除前版本可在 `git log -- docs/TRANSFER_ENGINE_DECISION.md` 找到）。