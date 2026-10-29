# tether-dsh-surface 变更记录
- 2026-10-29：随已验收的客户端批次将 Surface 包发行元数据推进到 `0.2.25`，并保留本机 updater 文件完整性修复。
- 2026-10-28：Surface 包 package.json 发布版本升至 `0.2.12`。
- 2026-10-28：Surface 包版本递增至公开版本 `0.2.11`。
- 2026-10-28：Surface 包版本递增至 `0.2.10`。
- 2026-10-28：Surface 包版本随三组件发行同步到 `0.2.9`。

- 2026-10-27：增加 owner-only `/tether-identity` RPC，从同一 DSH_HOME 的有效 Node 短期 descriptor 返回唯一设备 ID；不输出凭据，多身份冲突/无有效记录均返回 unknown。

## 2026-10-27

- 新增 Host companion：等待 DSH loader 收敛后读取已绑定 origin，并以 0600 权限原子发布 authenticated URL；仅清理本进程、同 origin 的 descriptor。
- 增加本机插件自更新 RPC：走独立 DSH authenticated `/tether-updates` channel，调用随插件包发布的 Python updater；应用前检查原生 DSH 活动回合，只安装本机插件文件并报告需重启，不修改已选远端节点或终止 Host。真实发布包升级与回滚验收待完成。
- 2026-10-27：统一发布包版本为 0.2.1，并随独立插件包携带白名单本机 updater runtime。
# 变更记录

- 2026-10-28：按当前 HostConnectionService `register(ctx, channel, handler)` 注册本机更新与身份 RPC；旧 `rpc.handle` 保留兼容，无可用 API 时显式报错。
- 2026-10-28：插件 file: 源码位于 Git 工作树时，更新前/应用前要求工作树干净，避免覆盖未提交源码。
- 2026-10-28：覆盖当前 DSH connection 注册 API、无 `rpc` 属性的 Host、缺失注册 API 显式失败，以及脏源码 checkout 保护。
- 2026-10-28：Surface 包版本升至 `0.2.13`。
- 2026-10-28：本机插件更新器 status/check 子进程上限 20s、同一请求单飞（重叠返回 `update_busy`），并区分「宿主加载时版本」与「磁盘版本」：磁盘变了而上报 `reload_required/restart_required`，否则更新中心会把旧宿主误报成已是最新。
- 2026-10-29：Surface 包版本升至 `0.2.16`，与三组件发行版本一致。
- 2026-10-29：源码 updater 补 `tether/release.py`、`tether/ed25519.py`；`local-updates.js` 的 `UPDATER_FILES` 校验现在能在源码安装的 profile 中通过，不再误报 `updater_missing`。
