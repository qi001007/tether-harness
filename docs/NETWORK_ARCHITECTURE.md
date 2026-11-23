# 网络架构：控制面 / 数据面 / 文件面（2026-11-23）

本文件是组网与传输的唯一架构事实源。实机数字随时间追加到 `PROGRESS.md`，生命周期细节见 `MESH_LIFECYCLE.md`（自愈与 supervisor），本文件只定边界与选路。

## 1. 三层边界

| 层 | 承担 | 不承担 |
| --- | --- | --- |
| 控制面 Hub | 登录（OIDC）、设备与配对、作业与票据、审计、更新清单 | 任何大文件字节 |
| 数据面 managed mesh（EasyTier 2.6.4） | 节点间私网：VIP `10.240.0.x`、服务 IP `10.224.0.x`、SOCKS `127.0.0.1:53061`、ACL 仅 `52000-52063`/`20222` | 身份、权限、作业状态 |
| 文件面（现状） | croc 11.6.3 私有 relay（`10.144.0.1:19009–19016`）+ 目标 Node 的 SFTPGo（rclone，限时 grant） | — |

- 无 TUN 是产品默认（免 UAC）：EasyTier 以 `--no-tun --use-smoltcp` 运行，`proxy_network` 把对端 `service_ip:PORT` 映射到本机 `127.0.0.1:PORT`，端口号 1:1。
- 外挂 `tether-mesh`（TUN `10.144.0.0/24`、管理员计划任务）只是开发机历史路径，不属于产品。

## 2. 路径选择（复用既有设计，不另造）

1. 控制面为一次传输签发短时 grant，候选列表含 `direct`（目标 service_ip）、`transit`（中转节点，按既有“设备对中转同意”记录）、`relay`（croc/SFTP）。
2. 用 `tether/node/route_selection.py` 的 `rank_routes` 并行探 1 MiB：`timeout 1.5 s`、首个成功后 `settle 300 ms`，**按实测 MB/s 排序**（不看 RTT），保留至少一条备用。
3. 顺序：直连 > 最快中转 > relay。直连 < 2 MB/s 且存在中转时才试中转；全部失败才落 croc。
4. 中途换路：持续 5 s 低于探测值 50% 且进度 < 20% 时，在分片边界按 offset 续传换路，不重发已校验分片。
5. 中转节点只做字节转发（store-and-forward 或流式），不落盘明文；同一 grant 内有效。

## 3. 安全

- 每个 endpoint 都凭 grant：`actor_id/target_id/network_id/instance_id/operation_id/service_ip/expires_at` 全字段校验（`fs_service._transfer_authority`）。
- SFTP 走 mTLS 或一次性 SFTPGo 账号（≤1 h），传输后即刻回收；接收端核对整件 SHA-256。
- mesh 内部只放白名单端口；SOCKS 绑 `127.0.0.1`；RPC 白名单 `127.0.0.0/32`。不因文件面放宽 ACL、安全组或设备更新。

## 4. 实测（100 MiB，2026-11-23，本机校园网）

| 路径 | 方向 | 时间 | MB/s | SHA-256 |
| --- | --- | --- | --- | --- |
| croc relay（现行基线） | 台式→云 | 40 s | 2.51 | 一致 |
| croc relay（现行基线） | 云→笔 | 77–92 s | 1.09–1.31 | 一致 |
| managed mesh SOCKS，1 流 | 台式→云 | 239.2 s | 0.44 | 一致 |
| managed mesh SOCKS，4 流 | 台式→云 | 停滞 >60 s/流 | 不可用 | — |
| managed mesh SOCKS，1 流 | 云→台式 | ~120 s（16 MiB 样本） | ~0.14 | 未取全量 |
| managed mesh，中转 1 跳 | 台式→云→云 | 4.2 s（2 MiB 样本） | 0.49 | 一致 |
| 外挂 TUN HTTP，1 流 | 台式→云 | 40.2 s | 2.61 | 一致 |
| 外挂 TUN HTTP，4 流 | 台式→云 | 33.7 s | 3.11 | 一致 |
| 外挂 TUN HTTP，8 流 | 台式→云 | 48.0 s | 1.91 | 一致（拥塞） |
| 公网 scp/SSH | 台式→云 | >10 min 未完成 | <0.18 | 中止 |

结论：该国际链路（首尔，RTT 116–120 ms、丢包 10–12%）物理上限约 3 MB/s，多流会拥塞崩溃；smoltcp 用户态栈再降 6 倍，中转每多一跳再减半。**managed mesh 当前不具备大文件数据面资格**，文件面继续用 croc/SFTP；≥5 MB/s 只能在直连低时延对上尝试（历史最佳台式→笔 tcp6 4.09 MB/s，本轮未能复测：笔记本没有可执行的节点通道，其 52000 只有 Caddy 应用入口且需票据，无法部署接收端）。

约束记录：本机 Windows 动态保留段覆盖 `51972-52071`，`52000-52063` 全部 `bind` 失败（WinError 10013），只有 `20222`/`52072+` 可绑；文件面若占用该段需换段或显式预留。

## 5. 验收与回滚

- 达标线：同一 100 MiB、同一方向、同一设备对，≥5 MB/s 或明显优于 croc 基线，SHA-256 一致。
- 回滚：文件面改动只在分支 `codex/tether-mesh-file`，不发布、不切 Hub、不改安全组与更新通道；不达标即弃用该分支，croc/SFTP 保持原样，无设备侧残留。