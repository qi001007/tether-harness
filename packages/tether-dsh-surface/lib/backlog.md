# tether-dsh-surface/lib 变更记录

- 2026-10-27：注册 owner-only `/tether-identity` RPC，只返回 `{device_id}` 业务值，不暴露 descriptor 路径、PID 或凭据。

## 2026-10-27

- 新增 loopback origin 校验、loader readiness、descriptor 原子写入以及按 pid/origin 所有权清理。
- 活进程拥有的 descriptor 不可覆盖；确认 pid 已退出的陈旧 descriptor 才允许替换。
- 2026-10-27：本机插件更新从当前 companion 安装路径解析 DSH profile；路径不在指定 DSH_HOME 的 profiles/<name>/node_modules/tether-dsh-surface 下时拒绝执行，profile 名随 CLI 传给 updater。
- 2026-10-27：Host descriptor 附带由 companion 安装路径解析的 profile；远端 Node 仅在 descriptor 合法且发布 PID 仍存活时接受该 profile，否则插件 apply 安全拒绝。
- 2026-10-28：本机插件更新状态附带 DSH 启动时实际加载的插件版本；磁盘包已更新但运行代码仍旧时明确提示重启 DSH 生效。
