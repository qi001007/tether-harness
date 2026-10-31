# Tether Python 后端变更记录
- 2026-10-31：Node 新增 `restart_node` 控制消息：有活跃 Tether 任务时拒绝，否则确认、关闭控制 WS 并由 supervisor 以退出码 75 重启；0.2.39 实测 0.80 秒离线、2.99 秒重连。
- 2026-10-31：FS 服务新增 `write_chunk`/`transfer_status`/`transfer_cancel`：分块二进制写入、断点偏移校验、临时文件 fsync 后原子替换、完成时 `transfer` 审计；`test_fs_service.py` 14 passed。
- 2026-10-31：0.2.35 发布；版本推进到三组件 0.2.35，Node/APP/插件更新链路随 Hub 任务实测（APP 20.1 s，插件 15.3 s，DSH 重启路径）。
- 2026-10-31：0.2.34 修复 Python 3.13 不支持 `Popen(windowsHide=...)` 导致的“更新成功但未重启”：APP/DSH restart helper 改用 `creationflags=CREATE_NO_WINDOW`，调度失败返回 `restart_failed` 并记录 traceback；Node capabilities 增加 `plugin_version`/`installed_products`。两机 Node/APP/插件均升到 0.2.34。
- 2026-10-30：Updater 版本与三组件发行候选统一至 `0.2.29`。
- 2026-10-30：0.2.27 热修版本元数据；更新器实现沿用 0.2.26 的 profile 基准与 `restart_scheduled`。
- 2026-10-30：`_plugin_details` 以已安装 profile 为更新基准（源码只作诊断）；插件 apply 返回 `restart_scheduled`；`UPDATER_VERSION` 推进到 `0.2.26`。

- 2026-10-29：将三组件与 updater 版本统一推进到 `0.2.25`，纳入 Node WebSocket 直连/重连隔离和目标端文件版本安全保存候选。

- 2026-10-28：Node `status`/`check` 不再等待 prepare/apply 的长锁；manifest check 增加 60 秒进程内单飞缓存，check 下载限时 4 秒，prepare 仍强制刷新 manifest。

- 2026-10-28：插件更新器识别 DSH profile 中明确声明的 `file:` 源码依赖；状态版本取 profile/source 包中的最低版本，应用时在一个备份/回滚事务内同步两个加载位置，避免重装时恢复旧共享 UI。
- 2026-10-28：插件状态版本同时取四个 profile 包与 `file:` 源码包的最低版本；旧 surface 等任一包落后都会继续报告更新，缺失包不再由旧状态文件掩盖。
- 2026-10-28：Node console 增加本地设备 API（token 保护，复用 FsService 策略/审计）；Office 预览增加磁盘缓存；WS `fs_call`/`dsh_call` 并发化。详见 `tether/node/backlog.md`。
- 2026-10-28：公开包提取为客户端/Node运行时；Controller、静态服务页及其服务器更新路由迁入独立私有 `tether-harness-server` 项目。发行包改为显式客户端运行时清单。

- 2026-10-27：新增 APP/插件/Node 更新核心：HTTPS manifest 与下载、严格版本比较、SHA-256、白名单 ZIP 暂存、独占锁、备份、原子替换和失败回滚；CLI仅输出安全 JSON。
- 2026-10-27：插件 updater 可独立运行于 DSH surface 包；真实三组件 full release ZIP 均完成 prepare/apply 集成验证，并覆盖暂存篡改、stale update、跨 state-dir 安装锁、插件回滚和活动任务 fail-closed。
- 2026-10-27：UpdateManager/CLI 支持明确 profile 名；插件版本探测、包存在性检查和目标映射使用该 profile，拒绝路径穿越或非法 profile 名；远端 Node 仅使用当前 Host descriptor 提供的 profile。
- 2026-10-27：暂存插件更新记录目标 profile；apply 时若活动 Host profile 已变化或旧暂存无 profile 绑定则拒绝，避免跨 profile 套用准备结果。
- 2026-10-28：0.2.14 起清单默认强制 Ed25519 验签（仅 loopback 开发源与显式 `TETHER_ALLOW_UNSIGNED_RELEASE=1` 例外）；`channel` 参与校验，beta 需 `TETHER_UPDATE_CHANNEL=beta`；`apply` 用缓存清单复核 rollout（hold/排除立即生效）；签名错误码 `channel_not_selected` 进入错误优先级，避免被 `manifest_unavailable` 掩盖。
- 2026-10-29：0.2.16 版本元数据统一：`UPDATER_VERSION` 升至 `0.2.16`；更新协议常量保持 `1`，无迁移。
- 2026-10-29：0.2.24 插件 `restart_required` 的清除条件是“记录的 Host pid 被替换”或“apply 时没有运行中的 Host，之后有 Host 在 apply 之后发布 descriptor”；apply 记录写 `applied_at`（epoch ms），DSH 关闭时安装不再永久挂“待重启”。
