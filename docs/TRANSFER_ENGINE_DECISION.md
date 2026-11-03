# 传输引擎选型：改用 croc，停止自研分片

日期：2026-11-04。结论：**删除 Tether 自己写的 4 MB 分片传输，主路径改用 croc v11.6.3**。Tether 只做身份、票据、路径权限、进度、取消和审计；分片、并行、重试、续传、加密、relay 全部交给 croc。

## 为什么现在这套不行

`packages/tether-ui/src/transfer.js` 自己实现了“读 4 MB → 写 4 MB → 下一块”的协议，没有采用任何成熟传输栈。它的问题不是块大小或双缓冲能补的：

- 协议行为（分片、确认、重试、续传、校验）全部由我们维护，边界情况会持续长出来；
- 单文件仍是单流串行，高 RTT 链路上无法利用多连接；
- 直连失败时退回 Hub + base64，体积和 CPU 都翻倍；
- 没有成熟的拥塞控制、并行端口、传输完整性设计。

继续在这套协议上优化，就是继续自己造轮子。

## 调研结果

| 方案 | 定位 | 多连接 | 断点续传 | 自建 relay | 可嵌入 Node | 结论 |
|---|---|---|---|---|---|---|
| **croc v10** | 两台设备一次性传文件/目录 | ✅ 官方：多 TCP 端口并行 | ✅ 官方 README | ✅ `croc relay` / `croc serve` | ✅ 单二进制 CLI，子进程调用 | **选它** |
| Syncthing 2.x | 持续文件夹同步 | ✅ v2 默认 3 连接（1 元数据 + 2 数据） | ✅ BEP `DownloadProgress` | ✅ 可自建 | ⚠️ 常驻 daemon + REST + 设备/文件夹配置 | 过重，留给以后“持续同步” |
| aria2 | 多连接下载器 | ✅ `-s/-x` 多连接 | ✅ `-c` + `.aria2` | ✅ 不依赖 relay | ✅ 单二进制 + JSON-RPC | 只下载，要在发送端另建 Range 服务；作为备选/基准 |
| RustDesk | 完整远程桌面 | 会话内文件传输 | 会话内 | ✅ | ❌ 文件传输不是独立库/CLI | 不适合直接复用 |
| magic-wormhole | 一次性传文件 | 单流 | 有限 | ✅ | ✅ Python | 速度与多连接不如 croc |

### croc 的官方能力

- `p2p with relay fallback`、`end-to-end encryption (PAKE)`、`multiple file transfers`、`resuming transfers that are interrupted`、`cross-platform`。
- 官方 Go 文档：croc “blazingly fast because it does parallel transfer over multiple TCP ports”；relay 用于“staple the parallel incoming and outgoing connections”。
- `--local` 只用局域网直连，`--no-local` 只用 relay；自建 relay 用 `croc relay`，客户端 `--relay host:port`。
- 代码短语是 PAKE 的共享秘密，不是普通密码；Tether 可以把它当作一次性票据通过已认证控制通道传递。

来源：
- https://github.com/schollz/croc
- https://pkg.go.dev/github.com/schollz/croc/v10
- https://www.openwall.com/lists/oss-security/2023/09/08/2（并行 TCP 端口的安全报告，侧面确认实现）

### 其他方案的官方依据

- Syncthing BEP：块大小 128 KiB–16 MiB，request pipelining，`DownloadProgress` 支持续传；Syncthing 2.0 release notes 明确“v2 设备间默认 3 条连接：1 条索引元数据、2 条数据”。来源：https://docs.syncthing.net/specs/bep-v1.html 、https://github.com/syncthing/syncthing/releases/tag/v2.0.0
- aria2 官方手册：多源/多连接、`--max-connection-per-server`、`--split`、`-c`、JSON-RPC。来源：https://aria2.github.io/manual/en/html/aria2c.html
- RustDesk 官方仓库：自托管远程桌面；文件传输是会话功能，不是独立传输库。来源：https://github.com/rustdesk/rustdesk

## 目标架构

```
Tether APP / Hub
  │ 控制面：谁发给谁、源路径、目标路径、一次性 code、审计
  ▼
源 Node ── croc send --code <一次性> ──┐
                                      ├─ 直连（同网/EasyTier 可达）或自建 relay
目标 Node ── croc --yes <code> ───────┘
  │
  ├─ 写入 .tether-incoming/<transfer_id>/ 暂存
  ├─ 完成后校验大小/SHA-256
  └─ 由 Tether fs 服务移动到目标路径（走原权限策略）
```

原则：

- **数据面不再经过 Tether 自己的分片协议**；croc 负责并行 TCP、加密、续传和 relay。
- Tether 只负责：票据生成/传递、源路径读权限、目标路径写权限、暂存目录、完成校验、审计。
- 自建 relay 只跑在主人的服务器上，不接 croc 公共 relay，不引入第三方网络。
- 直连优先：两端在 EasyTier 网内且可达时用 `--local` 或直连地址；失败才走自建 relay。
- 传输完成后才把文件移出暂存目录；取消/失败清理暂存，不污染目标目录。

## 集成设计

### 1. 打包

- Node ZIP / APP 附带 `croc`（Windows x64、Linux x64/arm64、macOS x64/arm64），版本固定并在 manifest 写 SHA-256。
- croc 是 MIT；发行包附 LICENSE 和源码地址。
- 不依赖用户机器预装 Go 或 croc。

### 2. 控制面

- `transfer_prepare`：校验源/目标设备、路径、权限，创建 `transfer_id`，生成一次性 code（随机 6 词或 16 字节），返回给 APP；code 不写日志。
- `transfer_start`：源 Node 启动 `croc send --code <code> --yes <path>`；目标 Node 启动 `croc --yes <code>`，cwd 为 `.tether-incoming/<transfer_id>`。
- `transfer_status`：返回阶段（准备/连接/传输/校验/完成/失败）、已传字节、总字节、速度、路径、错误码。
- `transfer_cancel`：杀掉两端 croc 进程，删除暂存；源端不删原文件。
- 同一设备同一时间只跑一个 croc 任务；会话过期自动取消。

### 3. relay

- 服务器 systemd 跑 `croc relay --port 19009 --transfers 4`（实际端口可配；不要写死 9009，Windows 开发机上 9010 已被 Logitech G Hub 占用，croc 会直接 panic）。只对 Tether 设备网段/公网最小范围开放；端口需在主人在云控制台放行。
- 如果端口不能放行，改用 `croc serve` + Caddy 同源 WebSocket relay（Caddy 反代 `/ws`），仍需先做一次真实连通验证；不能假设可用。
- relay 只转发密文；不落盘文件内容。

**本机实测（2026-11-04）**：croc 11.6.3 Windows 官方二进制，`croc relay --host 127.0.0.1 --port 19009 --transfers 4`；16 MiB 文件经 loopback relay 收发成功，发送端显示 `975 MB/s`、接收端 `471 MB/s`，接收文件字节数完全一致。这个数字只证明引擎和输出格式可用，不代表任何真实链路速度。

### 4. 进度与校验

- 优先解析 croc 输出的百分比/速度；同时用暂存目录文件大小做兜底，二者取较可信值。
- 完成后 Tether 计算 SHA-256，与源端 `stat` 的大小和哈希比对；不一致则失败并保留暂存供排查。
- 断点续传由 croc 自己处理；Tether 只把同一个 code/暂存目录用于重试，不自己记块偏移。

### 5. 兼容与回退

- 功能开关 `transfer.engine = croc`；旧 `transfer.js` 分片路径只作为“目标机没有 croc”的临时回退，两个平台验收后删除。
- 不再扩展旧分片协议，不再在旧协议上做多流/直拉。

## 已落地（2026-11-04）

- 新增 `tether/node/croc_transfer.py`：只做二进制发现、命令拼装、进度解析、状态和取消；不实现分片/续传/加密。
- `tests/test_croc_transfer.py` 5 条通过：send/receive 参数、code 只走 `CROC_SECRET`、缺 relay/短 code/缺源文件拒绝、取消。
- fs 增加 `transfer_send/receive/status/cancel/finish`；接收写 `workspace/.tether-incoming/<id>`，完成后移动到目标。旧分片 status/cancel 在无 croc 上下文时兼容。
- 真实 croc 11.6.3 端到端：8 MiB 本机自建 relay 发送/接收，`finish` 后目标文件 SHA-256 一致。**croc 子进程必须带 `--ignore-stdin`**，否则管道 stdin 会被当成发送源，产生 0 字节 `croc-stdin-*`。
- 服务器已装 croc 11.6.3 到 `/opt/tether-tools/croc/croc`，`tether-croc-relay.service` 绑定 `10.144.0.1:19009–19012` 并 active；服务器 `tether-node` 已写 `TETHER_CROC=/opt/tether-tools/croc/croc` 与 `TETHER_CROC_RELAY=10.144.0.1:19009`，重启后 active。unit 模板在 `deploy/tether-croc-relay.service`。
- `tether/node/bin/` 已放 Windows x64 `croc.exe` 与 Linux x64 `croc`，`build_release.py` 的 Node runtime 打包已包含 `node/bin`；macOS 二进制尚未收。**注意 Windows 文件系统上用 `scp` 目标名 `croc` 会覆盖 `croc.exe`，必须显式校验 `file` 类型；本次已修复。**
- Node capabilities 增加 `transfer_engine: croc`、`croc.available/version/relay`。
- **尚未接入**：APP 转移页已切 croc，但 croc 二进制还没随 Node ZIP/APP 打包；服务器 relay 已起，桌面 EasyTier 当前只有 `169.254.*`、没有 `10.144.*`，跨机 100 MB 被这个环境问题挡住。

**100 MB 真机（2026-11-04，Windows `10.144.0.2` ↔ 服务器 `10.144.0.1`，croc 自建 relay）**：

| 方向 | 数据 | relay 端口数 | 实际耗时 | SHA-256 |
|---|---|---:|---:|---|
| Windows → 服务器 | 随机 100 MB | 8 | **51.43 s**（约 2.04 MB/s） | 一致 |
| 服务器 → Windows | 随机 100 MB | 8 | **82.43 s**（约 1.27 MB/s） | 一致 |
| 服务器 → Windows | 全零 100 MB | 8 | 17.69 s | 一致（**压缩假速度，不得作为验收**） |

同方向裸 TCP 对照（服务器→Windows）：单流 65.2 s，8 路并行 53.9 s（100 MB，均约 1.6–1.9 MB/s）。随机数据下 croc 上传 51.4 s 已与 8 路裸 TCP 的 53.9 s 基本一致，证明 croc 已经跑在这条路径的上限；**10 s 目标不是应用层能补的，必须换网络路径（国内中转、同网直连或提升出口）**。之前 5.74/17.69 s 来自全零文件被 croc 压缩，已从验收口径撤回。

**当前卡点**：桌面 EasyTier 重启后已恢复 `10.144.0.2/24`（本次实测）。尚未做的是：croc 二进制随正式 Node ZIP/APP 发布、服务器→Windows 裸 TCP 对照、笔记本移动网方向测试、干净 VM 安装矩阵。

## 验收

1. 同一 100 MB、同一方向、同一对设备：croc 直连/relay 各自记录时间、MB/s、连接数；与同路径裸 TCP 对照。
2. 校园网直连目标 100 MB <10 s；移动网按上下行物理上限给出预计时间，实际不低于上限的 80%。
3. 传输中拔网/切网，重试后续传，最终 SHA-256 一致。
4. 取消后源文件不变、目标暂存清理、目标目录无半文件。
5. 目标路径无写权限时在启动前拒绝，不产生任何数据。
6. Windows、Linux、macOS 各跑一次真实安装 + 传输，不要求用户装 Go/croc。

## 迁移顺序

1. 在服务器和两台测试机安装同版本 croc，先用 CLI 手动跑通直连/relay、续传和 100 MB 速度，确认 relay 端口方案。
2. 加 Node 的 `croc_transfer` 适配层（只做进程/票据/暂存/校验，不实现传输）。
3. APP 转移页切到新接口；旧分片路径只保留回退。
4. 两平台验收后删除旧分片代码和 `write_raw` 数据路径。

## 不再做的事

- 不再自己设计分片大小、确认、重试、续传、拥塞控制。
- 不再用 Hub/base64 作为大文件数据面。
- 不再把“代理器 60 MB/s”当成 Tether 路径的基准；只用同一路径的裸 TCP 对照。
