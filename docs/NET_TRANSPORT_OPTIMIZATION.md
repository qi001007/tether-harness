# 传输优化：连接复用与并行分片（2026-11-24）

分支 `codex/net-transport-opt`，基线 `baseline-pre-mesh-file-20261123` + 现有 HEAD。只动 `tether/node`（console、sftp relay 客户端、transfer_jobs），不发布、不切 Hub、不改安全组。网关命令：`python -m pytest tests/test_fs_service.py tests/test_fs_croc.py tests/test_croc_transfer.py tests/test_sftp_relay*.py tests/test_node_console_api.py tests/test_dsh_rpc.py`（113 passed / 4 skipped）。

## 1. 基线（同一 100 MiB 随机文件，SHA-256 `c8a661bf…9314388`）

台式 → 云端 Node（managed mesh SOCKS `127.0.0.1:53061` → `10.224.0.3:52010`，wss 150 ms；`scripts/mesh_file_bench.py`，收端 `/tmp/netbench`）

| 场景 | 时间 | 吞吐 | 断连/重传 | SHA |
| --- | --- | --- | --- | --- |
| 首字节（`/ping`，新连接） | — | 0.23–0.27 s | — | — |
| 100 MiB，1 流 | 206.8 s | 0.51 MB/s | 0 | 一致 |
| 100 MiB，4 流 × 25 MiB | 92.0 s | 1.14 MB/s | 0 | 一致 |
| 24 MiB，1 流 | 47.6 s | 0.53 MB/s | 0 | 一致 |
| 24 MiB，4 流 × 6 MiB | 13.6 s | 1.85 MB/s | 0 | 一致 |

链路分母：同时段 peer 表为笔记本 `10.240.0.2` p2p/tcp6 10.25 ms、云端 `10.240.0.3` p2p/wss 150 ms；云端路径单流 0.51 MB/s 与 `NETWORK_ARCHITECTURE.md` 的 0.44 同量级，说明瓶颈仍是 relay/smoltcp 丢包，不是应用层分片。笔记本侧本轮没有可部署接收端的通道（无 shell，52000 仅 Caddy），P2P 方向未复测。

## 2. 改动（都带本地可复现的前后数字）

| 改动 | 证据 | 前后 |
| --- | --- | --- |
| `console.py`：`protocol_version = "HTTP/1.1"`，本地设备 API 复用连接 | `tests/test_node_console_api.py::test_local_api_keeps_the_connection_alive…`（在 HTTP/1.0 下失败） | 200 次 `/state`：服务端 accept 200 → 1，4.80 → 2.57 ms/请求 |
| `sftp_relay_client.py`：桥并发 10 → 32、backlog 8 → 32 | 8 个分片读 + 换路 challenger + 探针会打到旧上限，challenger 被静默丢弃，慢路永远换不掉 | 上限不再挡换路；回归 `test_relay_bridge_admits_every_range_reader_and_a_challenger` |
| `transfer_jobs.py`：多分片阈值 32 MiB → 8 MiB | 上表 24 MiB：1 流 0.53 vs 4 流 1.85 MB/s（3.5×） | 8–32 MiB 文件也走并行分片 |

未改并说明理由：rclone `--transfers 4`（8 并发在旧 TUN 实测会拥塞坍塌）、croc `--transfers ≤8`（已退居 legacy）、`--sftp-concurrency`（rclone 默认 64，32Ki×64≈2 MB 在途，不是瓶颈）。

## 3. 限制

- 100 MiB 只测到云端 relay 路径；笔记本 P2P 4.09 MB/s 的历史数字没有本轮复测条件。
- 阈值下调只改变 8–32 MiB 文件的并行度，单文件吞吐上限仍由链路决定，没有新增私有协议或自适应层。
- 路由探测、按 offset 换路、失败退避沿用既有实现，本轮只解除挡在换路前面的连接上限。

## 4. 回滚

`git revert` 本分支三个提交即可；不涉及配置、设备状态、Hub 或 ACL，croc/SFTP 行为保持原样。压测临时目录 `.scratch/netopt/`、云端 `/tmp/netbench/` 与接收端进程已清理。