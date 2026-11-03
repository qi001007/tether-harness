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

## 仍未做

- 真正的 VirtualBox/VMware Linux VM（WSL2 是轻量 VM，不等同完整桌面发行版）。
- macOS 真机；脚本是 POSIX，但未在 Darwin 上跑过。
- APP 一键生成带 token 的安装命令，以及安装后的系统服务/开机自启。
