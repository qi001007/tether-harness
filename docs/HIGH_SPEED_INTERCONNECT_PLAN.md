# 高速互联（局域网级）计划

2026-11-03。目标：把设备间数据面从“所有字节走 Hub relay”改成“直连优先、Hub 只做控制面”，先达到局域网级吞吐，再在其上做任意软件入口、Agent Harness 接入和远程控制。

## 现状证据

- 当前 2 MB 同机经 Hub **33.87 s（0.06 MB/s）**、DESKTOP→LAPTOP **59.36 s（0.04 MB/s）**；1 GB 外推 4.5–7 小时。
- 商用远控实测：向日葵 632 MB **82 s（7.71 MB/s）**；RustDesk 局域网千兆 100 MB **6.2 s（15.8 MB/s）**、1.8 GB **23.4 s（78.6 MB/s）**；RustDesk 50 Mbps 家宽 100 MB **8.7 s（11.5 MB/s）**。
- 差距不在文件类型，而在数据面：商用的数据不走中继；同 LAN/可打洞时直连，中继只是兜底。
- PCL2（我的世界启动器）当前联机后端是 **EasyTier**；HMCL 用 Terracotta。EasyTier 为 Rust 实现、LGPL-3.0、14.5k stars，支持 Windows/macOS/Linux，P2P + 自建共享节点，Windows 需要管理员权限创建 TUN。

## 目标架构

```
Tether APP / UI
  │ 控制面：登录、设备、权限、加入票据、应用目录、审计
  ▼
Tether Hub（现有，继续保留）
  │ 下发：网络名/密钥、虚拟 IP、对端候选、一次性票据
  ▼
EasyTier 数据面（自建共享节点在主人的服务器）
  ├─ 同 LAN 直连
  ├─ 跨网 UDP/TCP 打洞直连
  └─ 打洞失败才走自建 relay
  │
  ├─ 文件传输：直接走虚拟 IP，不再经 Hub 分块
  ├─ Remote App Gateway：把本机 127.0.0.1:端口 反代到虚拟 IP
  │    → DSH、Codex app-server、Claude Code、OpenCode、任意 Web/TCP 应用
  └─ 远程控制：后续在同一虚拟局域网上做屏幕/输入
```

原则：

- 控制面仍是 Tether Hub；数据面不再由 Hub 转发。
- 只自建共享节点/relay，不接 EasyTier 公共节点，不引入 Tailscale/ZeroTier 等第三方服务。
- 复用 EasyTier，不自己重写 P2P/NAT 穿透；Tether 只做启动、配置、权限、UI 和网关。
- 应用接入不按软件逐个写死：HTTP/WebSocket 应用走通用反代；CLI Agent 走 ACP。

## 借用清单

| 组件 | 借什么 | 许可/边界 |
| --- | --- | --- |
| EasyTier | P2P、打洞、relay、虚拟网卡、加密、自建共享节点 | LGPL-3.0；作为独立进程分发，附许可与源码入口，不静态链接 |
| PCL2 | 联机启动方式：网络名/密钥、共享节点、一键加入 | 只借集成模式，不复制其 UI |
| RustDesk / Terracotta | 直连优先、relay 兜底、并行通道、断点续传 | 架构参考；不引入其客户端 |
| ACP（JetBrains/Zed） | 统一连接 Claude Code、Codex、Gemini CLI、OpenCode、Qwen Code 等 Agent Harness | 开源协议；Tether 作为 ACP 客户端/网关 |
| OpenClaw / Agent Canvas / Paseo | ACP/Harness 网关与会话管理做法 | 参考适配层，不照搬产品 |
| QCODEG | 用户提到的多 Harness 连接项目；名字按口述可能有误 | 先按 ACP/OpenClaw 的通用适配模式落地，拿到准确仓库名后再对齐 |

## 里程碑

### M0：两节点原型（0.5–1 小时）

1. 在 Hub 服务器安装 EasyTier Linux 版，起一个私有共享节点（`private_mode` + 强密钥），只开 11010 TCP/UDP。
2. DESKTOP 安装 EasyTier Windows 版，加入同一网络；LAPTOP 通过 Tether 的启动/更新通道加入。
3. 在虚拟 IP 上测 `ping`、2 MB、100 MB 传输，记录直连/中继状态。
4. 判据：同 LAN/直连 **≥5 MB/s**（目标 10–50 MB/s），跨网 **≥1 MB/s**（受上行限制），且不再出现 0.04 MB/s 级。

### M1：Tether 集成（0.5–1 天）

- Node 负责 EasyTier 的安装/启动/停止/升级；Hub 下发网络名、密钥、虚拟 IP、票据；UI 显示“直连/中继/未连接”。
- 文件传输优先虚拟 IP，失败回退现有 Hub；续传、覆盖、SHA-256 不回归。
- Windows 用无窗口方式启动，UAC 只在安装/首次启用出现；不新增黑色控制台。
- 测试：两机直连/中继切换、断线重连、Hub 不可达、EasyTier 升级、卸载。

### M2：任意软件入口 + Agent Harness（1–2 天）

- Node 增加 `Remote App Gateway`：把本机 `127.0.0.1:<port>` 反代到虚拟 IP，带一次性票据/来源校验；UI 新增“远程应用”页，列出 DSH、Codex app-server、Claude Code、OpenCode 等已配置服务并直接打开。
- CLI Harness 用 ACP：Tether 作为 ACP Client，连接远端 `gemini --acp`、Claude Code ACP、Codex app-server 等；会话/审批/流式事件复用 ACP。
- 判据：同一套 UI 能打开至少 DSH + 一个非 DSH 应用；不需要为每个软件写单独页面。

### M3：远程控制（后续）

- 在同一虚拟局域网上做屏幕采集/输入（VNC/RDP 或自研），先证明高吞吐链路，再选协议；不在本轮实现。

## M0 操作顺序

1. 服务器：`/opt/easytier`，systemd `easytier-tether`，私有网络名/密钥；`11010` 被云安全组挡住，实际走 **443 WSS**（Caddy `handle_path /easytier*` → `127.0.0.1:11011`），不新增公网端口。
2. DESKTOP：`D:\TetherTools\easytier`，管理员启动一次，加入同一网络（`10.144.0.2/24`）。
3. LAPTOP：优先走 Tether 的启动通道；当前先把 `bootstrap-laptop.ps1` + `tether.env` 放到 `D:\TetherWorkspaces\easytier-bootstrap\`，需在 LAPTOP 上以管理员运行一次（TUN 驱动需要 UAC），之后再把这条路径产品化。
4. 量：虚拟 IP 连通性、2 MB/100 MB 传输；记录 EasyTier 的 `peer` 状态（direct/relay）。
5. 结果写回 `docs/TRANSFER_LIMITS.md`，决定是否进入 M1。

## M0 进展（2026-11-03）

- 服务器已装 EasyTier 2.6.4：`/opt/easytier`，systemd `easytier-tether`，虚拟 IP `10.144.0.1/24`，`private_mode` + `relay_all_peer_rpc`，WSS 监听 `127.0.0.1:11011`；Caddyfile 备份 `Caddyfile.bak-20261103-easytier`。
- 公网 `11010/tcp` 实测不通（云安全组），因此节点走 `wss://8-220-198-26.sslip.io/easytier`；Hub 仍走原 443 根路径，未改动。
- DESKTOP 已加入：`10.144.0.2/24`，TUN `et_5_*`，WSS peer 已建立；从 DESKTOP `Test-NetConnection 10.144.0.1 -Port 22` 成功。
- 20 MB scp over WSS relay：**82.3 s（约 0.24 MB/s）**，SHA-256 一致；是 Hub relay（0.04 MB/s）的约 6 倍，但仍是中继路径，不是 LAN 直连。
- LAPTOP 引导文件已写入 `D:\TetherWorkspaces\easytier-bootstrap\`；等待一次管理员运行，加入后测直连/中继与 100 MB。

## 下一步（M0 收尾）

1. LAPTOP 运行 `bootstrap-laptop.ps1`（管理员一次），虚拟 IP `10.144.0.3/24`。
2. 从 DESKTOP 检查 EasyTier peer 状态：direct 还是 relay；`ping 10.144.0.3`、100 MB scp/文件传输。
3. 若 direct：记录吞吐，进入 M1；若仍 relay：检查两端 LAN/防火墙/打洞，再决定是否需要在同 LAN 内做直连发现。
4. 把实测写入 `docs/TRANSFER_LIMITS.md`，再改 Tether 的传输路径。

## 风险与约束

- **LGPL-3.0**：EasyTier 独立进程分发；仓库/发行包附 LICENSE 和源码地址；不静态链接。
- **Windows TUN/管理员**：首次安装/启用需要 UAC；服务化后无黑窗；卸载要清理虚拟网卡。
- **与现有 Tailscale/VPN 共存**：本机已有 Tailscale 虚拟网卡，EasyTier 可能与其路由冲突；测试时先确认路由表，不修改用户的 Tailscale 配置。
- **服务器端口**：云厂商安全组可能未放行 11010；若 ufw 开了但外网不通，需要主人在云控制台放行，这一步不能由服务器内部完成。
- **安全**：`private_mode` + 强网络密钥 + 加密；共享节点不接公共网络；Hub 的加入票据一次性、设备绑定。
- **不改变控制面**：登录、设备、权限、审计仍由 Hub 负责；EasyTier 只承载数据。

## 验收（M0）

- 同 LAN/直连：2 MB **< 1 s**、100 MB **< 20 s**；跨网直连/中继：100 MB 不超过两端上行允许的时间。
- 虚拟 IP 可达，文件 SHA-256 一致；Hub 不可达时直连仍可用。
- 不引入公共 EasyTier 节点；不新增第三方服务。