# 客户端变更记录
- 2026-10-30：0.2.27 热修版本元数据与 bundle。
- 2026-10-30：客户端 package/version 推进到 `0.2.26`；bundle 由统一构建重建。
- 2026-10-29：主人认可资源管理器第五版后，将客户端 package/version 元数据推进到 `0.2.25`；生成 bundle 由统一发布构建重建。
- 2026-10-28：客户端 package.json 与 version.json 发布版本升至 `0.2.12`；生成 bundle 留待统一构建。
- 2026-10-28：Host 更新流程新增受控本机插件重载 Remote 注入；仅在唯一启用的 surface 插件可寻址时请求应用，并区分需整宿主重启的结果。
- 2026-10-28：原生 iframe 增加“目标设备文件…”附件入口，使用 owner identity RPC、固定 Hub API endpoint 与服务端策略化 fs 路由；异步会话/设备切换会拒绝过期附件。
- 2026-10-28：插件客户端发布版本递增至 `0.2.11`，并更新生成 bundle 的版本常量。
- 2026-10-28：插件客户端版本递增至 `0.2.10`。
- 2026-10-28：插件客户端包版本随三组件发行同步到 `0.2.9`。

## 2026-10-27

- 修复实时运行事件中工具结果错误标志未传递到工具行的问题。
- 对话过程改为原生“已调用工具”分组与 GenericToolCard，保留外层轮次和行详情折叠状态。
- 增加原生展示桥依赖；使用上游组件展示目标设备工作区、会话与对话。
- 修复文件树相同物理路径在不同展示位置共用 key 引发的重复行。
- 按“工作区名称 → 实际文件夹名 → 内容”展示资源树，保留独立磁盘树。
- 收敛会话发送目标，保留用户上翻阅读位置并拒绝旧设备异步响应。
- 修复顶部“对话/文件”切换与活动栏面板不同步；Composer 禁用提示按历史只读、设备离线、未选项目和无效会话目标分别说明。
- 修复新建会话 CTA 挤压 Composer 宽度的问题；输入区改为满宽纵向 footer，说明与 CTA 放在上方一行。
- 对话默认改为整页承载目标设备的 DSH 原生工作区 iframe；加入严格 loopback URL 校验、设备切换过期保护、离线/不支持状态与重试，旧日志界面改为显式次级预览。
- 在嵌套原生 surface URL 上跳过 Tether 插件注册并选择原生 conversation panel，避免 Tether iframe 递归。
- 2026-10-27：`lib/client.js` 从 `packages/tether-ui` 生成，插件本身仍走原 `__ModuleLoader__` 装配，不新增 DSH external。
- 2026-10-27：将客户端包与更新提示版本统一到 0.2.1。
- 2026-10-28：client bundle 重新生成，包含共享 UI 刷新状态、旋转图标与自动消失 toast；package/version 元数据升至 `0.2.13`。
- 2026-10-29：客户端 package.json 与 version.json 升至 `0.2.16`，`lib/client.js` 重新生成以更新 `PLUGIN_VERSION`。
- 2026-10-30：从共享 NativeSurface 源码重建 `lib/client.js`，采用可见时单飞轮询、过期请求取消、同来源保留工作区 iframe、文档加载提示和有界重试。
- 2026-10-30：client 包和 version.json 升至发行候选 `0.2.29`；附加候选说明记录 auth scope、原生附件和更新竞态修复。
- 2026-11-02：client 包、version.json 与重新生成的 `lib/client.js` 升至 `0.2.54`；原生加号现在是唯一附件入口（不再注册 `tether-target-file` 命令），选择器标题“资源管理器”，桥接目录读取接入共享 `file-cache.js`。
- 2026-11-02：client 包、version.json 与 `lib/client.js` 升至 `0.2.55`；选择器去掉 22px 状态条/解释页脚，改用 `tether-dir-loading` 叠层与可重试错误浮层，设置页同步新版分区和头像。DSH 会按插件版本缓存 bundle，升级后必须让 `rev`/版本变化并等 DSH 重启完成。
- 2026-11-02：client 包、version.json 与 `lib/client.js` 升至 `0.2.56`；选择器叠层改内联绝对定位 + SVG `animateTransform`，因为 DSH 内嵌页不加载共享 UI 的全局 CSS。DSH 的 surface bundle 会按内容 rev 变化，需等新 rev 出现后再验收。
- 2026-11-02：client 包、version.json 与 `lib/client.js` 升至 `0.2.57`；树行统一点击、`revealTree`、文件夹递归上传、本地拖入先上传后写 `D:\TetherDrop`。拖入保存走 Node 的 `/tether-device-fs/write_chunk`，要求目标 Node 同步升级。
- 2026-11-02：client 包、version.json 与 `lib/client.js` 升至 `0.2.58`；共享转移页增加每栏设备标识与切设备清旧根，插件端 UI 同步。
