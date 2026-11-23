# 传输吞吐与文件面（历史基准，2026-11-03）

> 本文件只保留最早一轮基准，**不是现行结论**。现行文件面、选路与实测以 [MESH_LIFECYCLE.md](MESH_LIFECYCLE.md) 和 [PROGRESS.md](PROGRESS.md) 为准；Node 文件服务与 SFTPGo 配置见 [TECHNICAL.md](TECHNICAL.md)。

## 2026-11-03 Hub 中继基准（已过时）

| 路径 | 大小 | 耗时 | 吞吐 | 哈希 |
| --- | --- | --- | --- | --- |
| DESKTOP → DESKTOP（经 Hub） | 2,097,152 B | 33.87 s | 0.06 MB/s | 一致 |
| DESKTOP → LAPTOP（经 Hub） | 2,097,152 B | 59.36 s | 0.04 MB/s | 一致 |

外推 1 GB 约 4.5–7 小时。该结果只证明“所有字节走 Hub 分块”不可用，促成了数据面改用 EasyTier。

## 仍成立的原则

- 不再用分块大小当主要杠杆；大文件走私网文件面，不经 Hub 分块。
- 不引入 Tailscale / ZeroTier 等第三方组网；不把 Hub 暴露给其他用户。
- 1 GB 单文件不在当前交付承诺内；当前收尾目标是三台设备六个方向以真实文件传输接近或达到 5 MB/s，判据和数字只在 `PROGRESS.md` 维护。
- 速度对照必须同一文件、同一对设备、相近时段；不同链路的数字不能直接比较。

## 已移除的旧结论

- croc 作为主传输引擎、EasyTier WSS/TCP80 中继对照、5.9 时代 100 MiB 单条耗时：均已被后续原生 SFTP/SFTPGo 文件面取代，需要时查 git 历史。