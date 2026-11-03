# 传输吞吐与 overlay 决策

2026-11-03 实测（`scripts/bench_relay.py`，同一 Hub，1 MiB 分块）：

| 路径 | 大小 | 耗时 | 吞吐 | 哈希 |
| --- | --- | --- | --- | --- |
| DESKTOP → DESKTOP（仍经 Hub） | 2,097,152 B | 33.87 s | 0.06 MB/s | 一致 |
| DESKTOP → LAPTOP | 2,097,152 B | 59.36 s | 0.04 MB/s | 一致 |

控制面 P50 112.3 ms / P95 115.7 ms。外推 1 GB：约 4.5–7 小时，**当前公网 Hub relay 不满足 1 GB 目标**。

## 2026-11-03 EasyTier 数据面原型

- 自建 EasyTier 2.6.4 共享节点（服务器 `10.144.0.1/24`，私有网络，WSS 走 443 `/easytier`）；DESKTOP 加入为 `10.144.0.2/24`，虚拟 IP 上 TCP 22 可达。
- DESKTOP→服务器 20 MB `scp`（经 EasyTier WSS 中继）：**82.3 s（约 0.24 MB/s）**，SHA-256 一致；是 Hub relay（0.04 MB/s）的约 6 倍，但仍是中继路径。
- 同一文件走公网 SSH 直连（不经 EasyTier）：**11.5 s（约 1.82 MB/s）**。说明家里上行不是瓶颈，**WSS 中继路径把速度压掉了约 7.5 倍**。
- 把 Caddy 的 HTTP 移到 8080、把 80/TCP 让给 EasyTier TCP 中继后，同一 20 MB：**12.3 s（约 1.70 MB/s）**，已接近 SSH 直连的 1.82 MB/s，是 Hub relay 的约 42 倍。
- 服务器安全组只放行 22/80/443；11010 TCP/UDP 从外网不通。80/TCP 中继已绕过该限制，不要求改云安全组。
- DESKTOP 的 NAT 类型是 `Symmetric`；跨网 P2P 打洞可能失败，同 LAN 直连是最稳的快速路径。
- 下一步：LAPTOP 运行 `run-bootstrap.cmd`（一次 UAC）加入后测 direct/relay；若 direct 达到 MB/s 级，再把 Tether 文件传输切到虚拟 IP。

## 决策（按主人约束）

- **不引入 Tailscale/Headscale/NetBird/Nebula 等第三方网络组件**；所有节点继续统一走自己的 Hub。
- 不再用分块大小当主要杠杆：同机对照仍只有 0.06 MB/s，瓶颈是 relay/公网带宽与每块往返，而不是 1 MiB 太大。
- **1 GB 传输不在当前交付中承诺**；需要服务器带宽升级或 Tether 自研的 Hub 原生流式/直连路径，二者都属于新的传输层工作，不在现有 relay 上继续微调。
- 普通文件和工程目录传输仍可用；UI 不新增 overlay 选择，不引入第二个网络栈。

## 后续可选（需主人拍板）

1. 升级 Hub 服务器带宽并重跑同一 bench；目标 ≥1 MB/s 再谈 1 GB。
2. Tether 自研 Hub 原生流式传输（HTTP/2 或裸 TCP 中转），仍不引入第三方组件。
3. 接受 1 GB 目标降级，只保留现有 relay 能力并明确 UI 提示。

## 2026-11-03 当前 overlay 复测（p2p tcp6）

- EasyTier `peer`：LAPTOP cost=`p2p`、lat **101.46 ms**、tunnel **tcp6**；relay `10.144.0.1` 为 172.40 ms。
- LAPTOP 经 `10.144.0.2:18080` 拉 DESKTOP 的 100 MB：**104,857,600 B / 28.80 s = 3,640,449 B/s（3.64 MB/s）**。
- 两台机器的局域网 IPv4 是 `10.68.37.100` 与 `10.68.68.241`，但 ICMP/TCP 探测不可达（客户端隔离/防火墙），EasyTier 实际走 tcp6 公网直连；因此这是**跨网 p2p**，不是同 LAN 档。
- 结论：同 LAN 15–80 MB/s 仍未复现；需要同交换机/AP 且关闭客户端隔离，或 EasyTier UDP 直连。当前跨网 p2p 3.64 MB/s；Hub relay 仍为 0.04–0.06 MB/s、TCP80 中继 1.70 MB/s。

## 2026-11-03 打洞开关对照

- DESKTOP 侧加 `--disable-tcp-hole-punching true` 后：latency 在 7–53 ms 间波动，100 MB **37.21 s / 2.82 MB/s**，低于原始参数下的 **28.80 s / 3.64 MB/s**。
- 结论：瓶颈不在 TCP 打洞本身，更像 EasyTier 单流/TUN 吞吐或本机 TCP 窗口；关闭打洞无收益。两端 EasyTier 已恢复原始启动参数，未保留实验配置。