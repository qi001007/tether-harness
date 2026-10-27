# Tether Python 后端变更记录

- 2026-10-28：公开包提取为客户端/Node运行时；Controller、静态服务页及其服务器更新路由迁入独立私有 `tether-harness-server` 项目。发行包改为显式客户端运行时清单。

- 2026-10-27：新增 APP/插件/Node 更新核心：HTTPS manifest 与下载、严格版本比较、SHA-256、白名单 ZIP 暂存、独占锁、备份、原子替换和失败回滚；CLI仅输出安全 JSON。
- 2026-10-27：插件 updater 可独立运行于 DSH surface 包；真实三组件 full release ZIP 均完成 prepare/apply 集成验证，并覆盖暂存篡改、stale update、跨 state-dir 安装锁、插件回滚和活动任务 fail-closed。
- 2026-10-27：UpdateManager/CLI 支持明确 profile 名；插件版本探测、包存在性检查和目标映射使用该 profile，拒绝路径穿越或非法 profile 名；远端 Node 仅使用当前 Host descriptor 提供的 profile。
- 2026-10-27：暂存插件更新记录目标 profile；apply 时若活动 Host profile 已变化或旧暂存无 profile 绑定则拒绝，避免跨 profile 套用准备结果。
