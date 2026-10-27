# desktop 变更记录

- 2026-10-28：LAN 与 Tailscale Controller 启动脚本迁入私有 `tether-harness-server/scripts`，公开 desktop 目录只保留客户端安装与启动入口。

## 2026-10-27

- 插件安装前加入可复现的 DeepSeek 原生 UI 桥生成步骤；源版本与许可证校验失败时中止安装。
- 独立插件压缩包包含桥生成器；没有上游源码时验证随包桥的生成完整性，并支持离线包预检。
- 2026-10-27：插件安装前从可信仓库源码复制固定五个 updater 文件，完整发布 ZIP 则验证内嵌资源；目标限制在 surface package 内并拒绝 junction/symlink。
