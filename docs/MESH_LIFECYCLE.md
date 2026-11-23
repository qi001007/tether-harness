# Mesh 生命周期（EasyTier 常驻 / 自动入网 / P2P 优先）

2026-11-24 只读审计结论。证据：`C:\Program Files\Tether\MeshRuntime\*`、`node-0.5.2-r11\.runtime\managed-mesh\`、`tether/node/mesh_runtime.py`、`fs_service.py`、`easytier-cli -p 127.0.0.1:15888 peer`。

## 1. 现状（两套并存）

- 外挂网络 `tether-mesh`：计划任务 `Tether-Private-Mesh`（登录触发、Administrator、RunLevel Highest）跑 `start-desktop.ps1 -Watch`，10 秒巡检重启 `easytier-core.exe`；密钥在 `tether.env`；TUN `10.144.0.2/24`、listener tcp/udp 11010、RPC 15888。全部由人手装，仓库与安装器没有这段。
- 实测 peer 表：只有 `desktop`（Local）与 `tether-relay`（cost=p2p、tcp,wss、107.5 ms、PortRestricted），NAT 为 Symmetric。日志见 tcp 80/wss 反复 `connect timeout`/`handshake timeout`、连接加了又删；最后事件 2026-11-23 19:42，`desktop.err.log` 为空。
- 受控网络 `tnet-4aa537797a3943e5ab43`（Hub `network_id=5066…`）：`mesh_runtime.py` 以 `--no-tun --use-smoltcp` 启动，`disable_relay_data=true`，SOCKS `127.0.0.1:53061` 映射服务 IP `10.224.0.1`，ACL 只放 52000-52063/20222；`.transport-runtime.toml` 追加 quic 与 `wss://…/tether-mesh-relay?network=5066…`。日志长期 `hole punching task failed`、`sync_route_info failed`，即只有中继、无 P2P。
- 感知面：Node 仅在被 Hub 调用时执行 `mesh_apply/status/remove/restore`（45 秒短 authority），`status` 恒返回 `peers: null`、`peer_connectivity: unknown`；`/mesh/<id>/route` 只回 SOCKS；注册只上报 `mesh_restore_on_register`；UI 对 DSH 走 mesh 优先、Hub 兜底，无连接类型展示。没有周期心跳上报 mesh 健康。

## 2. 笔记本为何不在网

- 入网没有产品化：安装器只带 `easytier-core/cli` 组件，**不带** `MeshRuntime` 与启动脚本；受控实例只有在 Hub 下发 `mesh_apply` 后才启动。笔记本（0.5.5）从未收到该授权，所以本机也只出现在外部网络里。
- 成员 WSS 阶段是手工脚本：`member-wss-stage-20261121` 的 apply 脚本写死 `D:/Tether/node-0.5.2-r11`，只对桌面生效。
- 权限路线二选一：外挂要靠管理员建 TUN；受控路线刻意 no-TUN/免管理员，因此不产生 `10.144.0.0/24` 路由，两者不能互访。
- 防火墙只随 TUN 网卡生成 `EasyTier et_5_*` 放行；no-TUN 实例没有入站规则。桌面 NAT 为 Symmetric、云安全组仅放行 22/80/443（11010 外网不通），历史 P2P 走的是 tcp6。

## 3. 目标态设计

- 唯一入口：Node 启动即按本地记录 `restore_stopped_network()` 自恢复（已存在），失败退避重试（5 s→60 s 上限），Hub 不可达不阻塞进程。
- 默认无 TUN：userspace+smoltcp+SOCKS 作为产品默认（无 UAC）；需要全网段 IP 时才请求一次提权装 TUN，并复用同一实例身份，禁止双实例。
- 连接策略：`disable_relay_data` 按 Hub 是否有 relay 动态设为 false，relay 只做兜底；优先 P2P（udp 直连，失败回落 tcp6/tcp80）。
- 可观测：Node 每次 `mesh_status` 及 30 秒心跳附带 `state/cost/tunnel/latency/loss/nat`（解析 `easytier-cli peer`），Hub 透出给 UI，UI 显示 直连/中继/未连接。
- 恢复：监听 Windows 网络变更与休眠唤醒，RPC/SOCKS 探活失败即重启实例；配置 revision 变化且无活跃作业时才重启。

## 4. 分阶段

1. 源码节点（不改设备）：加 mesh supervisor、peer 解析、状态上报；判据：`cost=p2p` 出现在 status，断网重连 ≤60 s。
2. 安装器/更新器托管：首启由 Hub 下发 bootstrap 配置；卸载/迁移外挂实例，删除 `Tether-Private-Mesh`。
3. UI 与传输择优：状态徽标、自动入网开关；传输按 `cost/latency` 选路。判据：surface 数字、传输 MB/s 对比基线。

风险：安全组 11010 需或继续走 tcp80；Symmetric NAT 打洞失败率高；IPv6 可用性不稳；relay 放开后 ACL 与限额必须保持；免管理员模式下无 TUN 路由。

## 5. 修复前临时操作

笔记本先按桌面同一 `tether.env` 以管理员 TUN 方式入 `tether-mesh`，只恢复 `10.144` 可达；产品工作台仍需 Hub 下发受控网络，不能用手工实例替代。后续以第 4 节第 2 步自动化收口。
## 6. 第 1 阶段已实现（2026-11-23 源码节点实测）

- 代码：`tether/node/mesh_supervisor.py`（30 秒单飞巡检，stopped→`restore_stopped_network`，退避 5/10/20/40/60 秒；旧 launch 签名→`relaunch`；unverified 不杀）、`mesh_runtime.py`（按 record 记录的可执行文件做归属判定、RPC 白名单 `127.0.0.1/32`、`easytier-cli -o json peer list` 解析 peers/cost/tunnel/latency/loss/nat）、`fs_service.py`（`mesh_summary`）、`agent.py`（启动即 supervise）、`console.py`（`GET /mesh` 摘要、route 附 peer 字段）。
- 原 409 根因：实例由旧 Node 从 `runtime-overrides\easytier-window-512k` 启动，`_owned_process` 只认当前 core 路径 → `state=unverified` → route 409 `network_not_connected`；且 `--rpc-portal-whitelist 192.0.2.1/32` 让本机 cli 读不到 peers。
- 实测（DESKTOP-LOCAL，node PID 43468）：route 200、state ready、cost p2p、tunnel tcp6、latency 3.61 ms、loss 0.0、nat Symmetric、remote_peer_count 4（含笔记本 `qi` 10.240.0.2 p2p 3.61 ms）。
- 自愈：手动结束受管 core（PID 20652）后，25 秒内 route 由 409 回到 200，下一轮巡检恢复 p2p 健康；期间未新建第二个实例。
