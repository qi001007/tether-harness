# 安装矩阵（现行形态）

本页只描述客户端制品的打包形态；产线、版本和草稿流程以 [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md) 为准，签名边界见 [SIGNING.md](SIGNING.md)。

## 制品

| 组件 | 形态 | 产物名 |
| --- | --- | --- |
| Tether APP（Electron） | Windows x64 NSIS 安装器 | `Tether-<v>-win-x64.exe` |
| Tether APP | macOS arm64 / x64 | `Tether-<v>-mac-<arch>.dmg`（附 zip） |
| Tether APP | Linux x64 | `Tether-<v>-linux-x64.AppImage` / `.deb` |
| Node（headless） | Linux x64、arm64 | `Tether-node-runtime-<v>-linux-{x64,arm64}.tar.gz` / `.deb` |
| 更新清单 | 全部 | `latest.yml` / `preview*.yml` + schema 1 组件清单 |

- 版本号唯一来源是仓库根 `version.json`；`scripts/release_pipeline.py bump` 同步四处版本，默认 dry-run。
- Windows 安装器默认 unsigned（`SIGN=0`），发布信任来自 Ed25519 签名的更新清单与 SHA-256；没有 Authenticode 证书时不冒充已签名。
- 旧版单包字段（`tether-app-<v>.zip`、`tether-node-<v>.zip`、顶层 `url/sha256/size`）由矩阵的清单装配步骤生成，兼容旧客户端。
- Linux arm64 构建 Node-only；win-arm64 与 ARM64 DSH 不可行，原因见 RELEASE_PIPELINE §2。

## 安装入口

- Windows：运行 NSIS 安装器，首次选择安装位置，之后更新沿用原位置。
- Linux：deb / AppImage（APP）或 node-runtime 包（headless）。
- macOS：dmg 安装 APP；未公证，Gatekeeper 提示属预期，验收在干净 Mac 上做。
- 行为验收、真实设备矩阵和未完成项在 `PROGRESS.md`；本页不复制实测数字。