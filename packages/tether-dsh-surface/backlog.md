# tether-dsh-surface 变更记录
- 2026-10-28：Surface 包版本随三组件发行同步到 `0.2.9`。

- 2026-10-27：增加 owner-only `/tether-identity` RPC，从同一 DSH_HOME 的有效 Node 短期 descriptor 返回唯一设备 ID；不输出凭据，多身份冲突/无有效记录均返回 unknown。

## 2026-10-27

- 新增 Host companion：等待 DSH loader 收敛后读取已绑定 origin，并以 0600 权限原子发布 authenticated URL；仅清理本进程、同 origin 的 descriptor。
- 增加本机插件自更新 RPC：走独立 DSH authenticated `/tether-updates` channel，调用随插件包发布的 Python updater；应用前检查原生 DSH 活动回合，只安装本机插件文件并报告需重启，不修改已选远端节点或终止 Host。真实发布包升级与回滚验收待完成。
- 2026-10-27：统一发布包版本为 0.2.1，并随独立插件包携带白名单本机 updater runtime。
