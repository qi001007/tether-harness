# Tether Python 后端变更记录
- 2026-11-07：更新器区分APP磁盘安装版本与可信运行版本；支持同版本完整重试pending APP更新，并仅在新的真实APP进程启动并报告目标版本后清除restart_required；旧pending记录缺少from_version时显示未知，不以崩溃进程的记录冒报运行版本。
- 2026-11-07：为 0.4.6 候选同步 `version.json` 与 `pyproject.toml` 的 APP/Node 版本；插件保持官方稳定 0.2.93。
- 2026-11-07：更新器 JSON 读取支持 UTF-8 BOM，兼容旧 APP `version.json` 并允许标准 APP 更新器 prepare。
- 2026-11-07：只读核对 0.4.4-stability 更新契约：统一 manifest 仍包含 APP/Node 0.4.4 与官方签名插件 0.2.93；`scripts/build_release.py` 对冻结插件验签、校验资产 SHA/大小与四个包版本，并只把原插件条目复制进新 manifest，不生成插件 ZIP；发行 workflow 从稳定版下载这两个冻结资产并验证最终清单签名。Node 的 `update_managers` 与 RPC 仍含 node/plugin/app，plugin 仍支持 check/status/prepare/apply/restart；UI 保留独立 DSH 插件卡及 APP/Node 整机更新计划，既有测试明确将插件排除在 APP/Node 一键计划之外。随后在私有服务器独立工作树只读核对 `UPDATE_COMPONENTS` 确含 app/node/plugin，更新任务支持 APP/插件各自与 Node 的序列，三组件服务能力保留。现场只读核对：真实宿主仓库版本元数据为三组件 0.4.2，当前 DSH desktop profile 四个已安装插件包均为 0.4.2；新稳定 manifest 插件为 0.2.93。更新器以已安装 profile 为 current，并只在远端 SemVer 高于当前版本时置 `update_available`；整机更新序列只准备/应用 Node 与 APP，因此 0.2.93 不会触发插件降级，也不阻断整机更新。未改业务代码、版本号、真实宿主或 Git 状态；插件更新能力保留，插件新版本未发布。
- 2026-11-03：`UpdateManager.checkout_state()` 的 `git status` 在 Windows 必须带 `CREATE_NO_WINDOW`；否则即使父进程是 `pythonw.exe`，`git.exe` 仍会创建 `ConsoleWindowClass` 黑色窗口。启动 trace 实测修复前 3 个可见控制台、修复后 0 个。插件的 vendored updater 同步同一修复。
- 2026-10-31：Node 支持 `--user-token`：无设备令牌时随注册发送用户令牌，收到 `device_token` 后写入 `data/device-token.json`（0600）并改用；重启优先读设备令牌。
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
- 2026-10-31：0.2.45 插件 apply 不能只信 `native-surface.json` 的 pid：descriptor 缺失或 pid 失效时扫描 `dsh-desktop-host` 进程再记 `dsh_pid`；Hub 必须等 `restart_required` 清掉才 `done`，超时报 `restart_timeout`，重试用 `restart` 动作重跑助手。
- 2026-10-31：0.2.46 清单单飞只允许创建 flight 的 leader 完成它；非 leader 的强制检查自行拉取并写缓存，不得 `set_result`/`set_exception` 共享 Future（二次完成会抛 `InvalidStateError: FINISHED`）。
- 2026-11-01：0.2.50 插件 `restart_required` 只能由 **descriptor 的新 pid** 清除；扫描到的 `dsh-desktop-host` pid 只用于安排重启，禁止用于判定运行态已加载（否则 surface 仍指向旧端口）。
- 2026-11-03：插件更新先走 HMR：`apply` 不再立即拉起重启，而是以 `--delay 8`/`--expect-plugin-version` 安排 `dsh_restart` 助手；DSH 在宽限内发布 descriptor `plugin_version == applied.version` 时 `status()` 直接清 `restart_required`，助手也自行退出，超时才整应用重启。`setPluginEnabled` 从**被 HMR 载入的实例**调用会撞 `HMR transactions cannot be nested`（AsyncLocalStorage 继承），因此触发点只放客户端页面，不放 surface 服务端定时器。
- 2026-11-03：`apply` 只在运行 surface 已广播 `plugin_version`（`_hot_reload_capable()`）时给 8 秒宽限，旧 surface 仍 1.5 秒重启，避免首次升级变慢。
- 2026-11-03：DSH/pnpm 会把 `file:` 源码依赖存成 Windows 8.3 短路径；`_file_dependency_path` 必须用 `GetLongPathNameW` 展开短名（不跟随符号链接），否则 `Path.name` 是 `DSH-PL~1`，更新报 `plugin_source_unavailable`。0.2.90 真机升级即撞此错，0.2.91 修复。
- 2026-11-03：真机验证“禁用→启用”会持久化 `enabled:false`：两页面并发启用失败时 surface 一直停用，只能手动恢复。重载桥已回退为只启用；hot reload 只适用于 surface 模块文件变化的发行，其余靠 8 秒宽限后的重启。
- 2026-11-03：Hub 更新走 Node 自己的 state dir，surface 的 `/tether-updates` 看不到；`apply` 现在把同一份 `applied-plugin.json` 镜像到 `dsh_home/storages/tether/updates/`，页面 watcher 才能发现待重载。`_scan_dsh_host_pid` 必须按 `dsh_home` 过滤 profile 路径，禁止把别的 DSH（或测试里的真实宿主）当成本机目标重启。
- 2026-11-07：Node updater 对已配置 Hub `/releases/manifest` 与同源下载默认绕过系统代理，第三方 GitHub 源沿用 Python 标准代理配置；`TETHER_USE_SYSTEM_PROXY=1` 可显式恢复系统代理。
- 2026-11-08：更新器优先从签名manifest指定的正式URL获取制品，失败后保留Hub与配置mirror回退。
- 2026-11-11：Node ZIP 更新新增持久事务：apply 记录逐目标备份映射并停在 awaiting_acceptance，commit 清理恢复材料，rollback 可由重建后的 manager 恢复；CLI 暴露 commit/rollback。定向 pytest 覆盖提交、重建后回滚、非法/跨组件/越界事务及 apply 中途失败。
- 2026-11-11：对齐 Node UI 验收门：awaiting_acceptance 时 status 暴露 transaction/prepared_id 并清除待验收重启提示；commit 原子清除 applied-node 的 restart_required 后才删备份。Node rollback 成功响应后请求一次重启。

- 2026-11-12：候选 metadata 提升 APP/Node 至 0.5.3，plugin 保持 0.2.93；未重建依赖、未发布。

- 2026-11-12：修复 Codeg clean CI patch 漏掉的 `src/stores/tab-store.ts`：加入 `forceAgentSelection` 类型、draft 状态保存/恢复、选 Agent 消费与会话绑定清理；clean forward 与 canonical reverse 检查通过。
