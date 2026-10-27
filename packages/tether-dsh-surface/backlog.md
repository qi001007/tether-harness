# tether-dsh-surface 变更记录

## 2026-10-27

- 新增 Host companion：等待 DSH loader 收敛后读取已绑定 origin，并以 0600 权限原子发布 authenticated URL；仅清理本进程、同 origin 的 descriptor。
