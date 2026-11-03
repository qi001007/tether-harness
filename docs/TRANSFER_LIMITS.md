# 传输吞吐与 overlay 决策

2026-11-03 实测（`scripts/bench_relay.py`，同一 Hub，1 MiB 分块）：

| 路径 | 大小 | 耗时 | 吞吐 | 哈希 |
| --- | --- | --- | --- | --- |
| DESKTOP → DESKTOP（仍经 Hub） | 2,097,152 B | 33.87 s | 0.06 MB/s | 一致 |
| DESKTOP → LAPTOP | 2,097,152 B | 59.36 s | 0.04 MB/s | 一致 |

控制面 P50 112.3 ms / P95 115.7 ms。外推 1 GB：约 4.5–7 小时，**当前公网 Hub relay 不满足 1 GB 目标**。

## 2026-11-03 EasyTier 数据面原型

- 自建 EasyTier 2.6.4 共享节点（服务器 `10.144.0.1/24`，私有网络，WSS 走 443 `/easytier`）；DESKTOP 加入为 `10.144.0.2/24`，虚拟 IP 上 TCP 22 可达。
- DESKTOP→服务器 20 MB `scp`：**82.3 s（约 0.24 MB/s）**，SHA-256 一致；是 Hub relay（0.04 MB/s）的约 6 倍，但仍是中继路径，不是同 LAN 直连。
- 下一步：LAPTOP 加入后测 direct/relay；若 direct 达到 MB/s 级，再把 Tether 文件传输切到虚拟 IP。

## 决策（按主人约束）

- **不引入 Tailscale/Headscale/NetBird/Nebula 等第三方网络组件**；所有节点继续统一走自己的 Hub。
- 不再用分块大小当主要杠杆：同机对照仍只有 0.06 MB/s，瓶颈是 relay/公网带宽与每块往返，而不是 1 MiB 太大。
- **1 GB 传输不在当前交付中承诺**；需要服务器带宽升级或 Tether 自研的 Hub 原生流式/直连路径，二者都属于新的传输层工作，不在现有 relay 上继续微调。
- 普通文件和工程目录传输仍可用；UI 不新增 overlay 选择，不引入第二个网络栈。

## 后续可选（需主人拍板）

1. 升级 Hub 服务器带宽并重跑同一 bench；目标 ≥1 MB/s 再谈 1 GB。
2. Tether 自研 Hub 原生流式传输（HTTP/2 或裸 TCP 中转），仍不引入第三方组件。
3. 接受 1 GB 目标降级，只保留现有 relay 能力并明确 UI 提示。