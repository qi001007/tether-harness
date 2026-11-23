# 高速互联历史计划（2026-11-03，已归档）

> 本文件不再是指南。**现行组网事实、阶段划分与源码节点实测只以 [MESH_LIFECYCLE.md](MESH_LIFECYCLE.md) 为准**；进度数字在 [PROGRESS.md](PROGRESS.md)，架构边界在 [TECHNICAL.md](TECHNICAL.md)。

## 保留这段历史的原因

2026-11-03 的测速证明瓶颈不在分块大小，而在数据面：2 MB 同机经 Hub 中继 33.87 s（0.06 MB/s），DESKTOP→LAPTOP 59.36 s（0.04 MB/s）。由此定下三条至今仍成立的原则：

1. 控制面保留 Hub：登录、设备、权限、作业与审计不由 overlay 承担。
2. 数据面交给 EasyTier：直连优先、中继兜底，不引入 Tailscale/ZeroTier 等第三方服务。
3. 文件传输走私网上的独立文件面，不再经 Hub 分块转发。

## 已被取代的内容

- 手工引导步骤（服务器 systemd、`D:\TetherTools\easytier`、`bootstrap-laptop.ps1`、`tether.env` 手工分发）只对当时的台式机有效，笔记本从未产品化入网；现行路线见 MESH_LIFECYCLE 第 2、4 节。
- 原 M0–M3 里程碑中的“Remote App Gateway / 远程控制 / apps.json 应用页”不再是当前主线；是否恢复由主控另行决策。
- 早期 WSS/TCP80 中继数字（0.24 / 1.70 MB/s）和 croc 对照只作历史基准，不能当作当前吞吐或选型依据。

## 当前对应关系

| 旧计划 | 现状 |
| --- | --- |
| 数据面直连优先、relay 兜底 | 受控 EasyTier 网络；relay 仅兜底，P2P 优先（MESH_LIFECYCLE §3） |
| Node 负责安装/启动/升级 overlay | 源码节点已实现 supervisor 与 peer 状态上报（§6）；安装器托管待做（§4 第 2 步） |
| 文件传输走虚拟 IP | 目标 Node 的 SFTPGo + 限时 SFTP 转发；实测见 PROGRESS |
| 远程应用 / 远程控制 | 未实现，不在当前交付 |