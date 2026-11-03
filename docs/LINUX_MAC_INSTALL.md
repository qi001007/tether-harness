# Linux / macOS Node 安装

2026-11-03。面向“下载后一次装好”的 Linux/macOS 目标机安装路径；Windows 仍用 `laptop\bootstrap-node.ps1`。

## 前置

- Python >= 3.10；Debian/Ubuntu 还需要 `python3-venv`（缺了可 `sudo apt install python3-venv`）。
- `curl`。脚本用 Python 的 `zipfile` 解包，不依赖 `unzip`。
- 一个 Node  enrollment token（由 APP 的“添加设备”向 Hub 申请；当前脚本通过 `--token` 接收，尚未做 APP 一键生成命令）。

## 用法

最快的一行（脚本在 tag 里固定版本，下载对应 Node ZIP 后自动建 venv）：

```bash
curl -fsSL https://raw.githubusercontent.com/qi001007/tether-harness/v0.3.5/laptop/install-node.sh \
  | bash -s -- --controller wss://8-220-198-26.sslip.io/ws/node --token <node-token>
```

也可以从 Node ZIP 解出的目录运行：

```bash
bash laptop/install-node.sh \
  --controller wss://8-220-198-26.sslip.io/ws/node \
  --token <node-token> \
  --device "$(hostname)"
```

脚本会：下载对应版本的 Node ZIP（或用 `--archive` 指向本地包）→ 建 `~/.local/share/tether-node/venv` → `pip install -e` → 写 `node.env`（600）→ 生成 `~/.local/bin/tether-node` → 启动。

常用参数：

- `--check`：只检查 Python 版本与 venv 能力，不下载/不安装。
- `--install-only`：安装并生成启动器但不启动，方便先看日志。
- `--prefix`：安装根，默认 `~/.local/share/tether-node`。
- `--version`：下载的版本，默认 `0.3.5`；0.3.5 起包含 POSIX `stop()` 修复与安装脚本。

## 实测（2026-11-03，WSL2 Ubuntu）

- `install-node.sh --check`：Python 3.10.12，检查通过。
- `install-node.sh --archive tether-node-0.3.4.zip --install-only`：editable 安装成功，37 个依赖落地，生成 `tether-node` 与 `node.env`（600）。
- WSL 直接运行 `TerminalService`：`terminal_shells` 为 bash/sh 可用、zsh/fish 不可用，默认 bash；`terminal_start` 返回 `pty:true`，`echo TETHER_LINUX_PTY_OK`、`resize` 均通过；`stop()` 的 POSIX 读线程竞态已修复（源码 0.3.5 起）。

## 远程服务器托管节点（2026-11-04，Ubuntu 24.04）

服务器 `remotestitch-hub` 上以独立 systemd 服务装了维护节点，不碰 Hub/Caddy/EasyTier：

- 设备 id：`REMOTESTITCH-HUB`；安装根 `/opt/tether-node`；工作区 `/srv/tether-admin`。
- `tether-node.service`（`Restart=always`，`MemoryHigh=220M` / `MemoryMax=384M`）；控制通道 `ws://127.0.0.1:18890/ws/node`；DirectApi `0.0.0.0:18895`，令牌校验且只接受 `10.144.0.0/24` 与回环。
- 文件写白名单：`/srv/tether-admin,/etc,/opt,/var/log,/root`；终端默认 bash、root。
- 首次用一次性 `TETHER_USER_TOKEN` 换设备令牌；令牌落 `/opt/tether-node/device-token.json`（600），随后从 `node.env` 删除一次性令牌。
- 实测：列 `/`、读 `/etc/hostname`、root 终端执行 `hostname / uptime / systemctl is-active tether-hub` 均通过。

### 一键安装（公开源，私有仓库也可用）

Hub 暴露只读 `/install/`（Caddy 静态目录 `/srv/tether-installer`，放 `install-node.sh` 与当前 `tether-node-<version>.zip`）：

```bash
curl -fsSL https://8-220-198-26.sslip.io/install/install-node.sh | sudo TETHER_USER_TOKEN='<一次性令牌>' bash -s -- \
  --base-url https://8-220-198-26.sslip.io/install \
  --controller ws://127.0.0.1:18890/ws/node \
  --device REMOTESTITCH-HUB --agent fake --systemd \
  --workspaces-root /srv/tether-admin --allowed-roots /etc,/opt,/var/log,/root
```

`install-node.sh` 新增：`--systemd`（root + 开机自启）、`--user-token`、`--base-url`、`--workspaces-root`、`--allowed-roots`。同一条命令以 `--prefix /tmp/tether-node-online --install-only` 在服务器跑通（下载 → venv → import OK）。

### 自管理风险与边界

- 独立服务/独立目录/内存上限：Node 崩溃或重启不会带走 Hub、Caddy、EasyTier；SSH 与阿里云控制台保留为 break-glass。
- root 终端等于远程 root shell，能改 sshd/网络/防火墙；高危操作前先打阿里云快照，且不要把 `18895` 暴露公网。
- 默认不启用 Node 自动更新；更新先用 `--install-only` 落地，再 `systemctl restart tether-node`，失败可回滚上一份 `/opt/tether-node/tether-node-<version>` 或备份包。
- 不要用这个节点去改 Hub 的 systemd 单元或 EasyTier 配置并把 SSH 一起改坏；涉及访问控制的改动保留第二条通道。

### 速度基线（2026-11-04，DESKTOP ↔ 首尔）

- 100 MB 直传：上传 **75.86 s / 1.318 MiB/s**；下载 **62.88 s / 1.590 MiB/s**；4×25 MB 并发 **1.086 MiB/s**（无聚合）。
- 服务器独立带宽：下行 2480 Mbps、上行 385 Mbps；本机对 Cloudflare 下行 45 Mbps；公网 RTT ≈123 ms（EasyTier peer 255 ms）。
- 同路径 SCP：20 MB 上传 206.8 s（0.097 MB/s）、下载 6.8 s（2.94 MB/s）；Node 的 4 MB 分块上传比 SSH 单流快一个数量级，但仍受跨境/校园网路径限制。
- 结论：瓶颈不是服务器或 Node 代码，是本地到首尔的公网路径与单隧道；要接近线路上限需要更近的转接点或 UDP/QUIC，单靠并发无用。

## 仍未做

- 真正的 VirtualBox/VMware Linux VM（WSL2 是轻量 VM，不等同完整桌面发行版）。
- macOS 真机；脚本是 POSIX，但未在 Darwin 上跑过。
- APP 一键生成带 token 的安装命令。
