# 变更记录

- 2026-11-07：Node 网络归档使用同目录临时文件，针对短响应/连接重置最多重试 3 次；通过 ZIP 完整性校验后才替换目标包，失败不覆盖旧包。默认 latest 从 GitHub 最新发布 manifest 解析并从正式 release 下载，显式 `--base-url` 仍读镜像 `version.json`。

- 2026-10-28：移除局域网 Controller 和示例 token 默认值；bootstrap 从 `.env` 复用 Hub 与 Node 配置，缺项时给出修复方式，不要求 DeepSeek API key，也不显示 token。
- 2026-10-28：以 Windows PowerShell 5.1 兼容方式写 UTF-8 无 BOM `.env` 并用 UTF-8 读取既有配置；重复的 Hub/Node 配置键会在依赖安装前报错，避免 dotenv 末项胜出导致连接错配。
- 2026-11-04：`install-node.sh` 增加 `--systemd`（root + systemd unit + 开机自启 + 内存上限）、`--user-token`、`--base-url`（私库可用 Hub 公共镜像）、`--workspaces-root`、`--allowed-roots`；`--systemd` 默认安装根为 `/opt/tether-node`。公开一键安装由 Hub `/install/`（Caddy 只读静态目录 `/srv/tether-installer`）提供脚本与 node ZIP，服务器实机跑通下载→venv→import。一次性 `TETHER_USER_TOKEN` 首次注册后换设备令牌，随后从 `node.env` 删除。
