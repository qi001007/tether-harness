# packages 变更记录
- 2026-10-28：四个 DSH 插件包的发布版本元数据统一准备为 `0.2.12`，等待 release gate。
- 2026-10-28：原生 DSH 附件接入当前 Host 会话工作区选择器并保留 SDK 原附件显示；DSH `workspaceFiles.readBytes` 回归覆盖任意非 UTF-8 字节与分块边界。
- 2026-10-28：四个插件包版本同步递增至公开版本 `0.2.11`。
- 2026-10-28：插件包版本随 APP/Node 同步递增至 `0.2.10`。
- 2026-10-28：四个插件包版本同步到 `0.2.9`，与 APP、Node 发布版本一致。

## 2026-10-27

- 加入 DeepSeek 原生 UI 展示桥及其依赖；客户端和 bundle 显式声明本地包关系。
- 新增 Host 原生 surface companion 包，负责发布 DSH 原生 Web listener descriptor。
