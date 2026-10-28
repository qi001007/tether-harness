# 修改记录
- 2026-10-28：原生 DSH UI 包 package.json 发布版本升至 `0.2.12`。
- 2026-10-28：仅复用当前安装的 MIT attachment factory 并导出 ComposerAttachments，原生上传卡片、移除/重试、进度及拖拽展示继续由 DSH 组件负责。
- 2026-10-28：标明 attachment factory 是 bridge 生成期来源且嵌入 client bundle，不加入运行时依赖，避免更新器依赖变更门禁。
- 2026-10-28：原生 DSH UI 包版本递增至 `0.2.11`。
- 2026-10-28：原生 DSH UI 包版本递增至 `0.2.10`。
- 2026-10-28：原生 DSH UI 包版本随三组件发行同步到 `0.2.9`。

- 2026-10-27：生成包内补入工具词典依赖常量，修复 bridge factory 启动时的词法引用错误。
- 2026-10-27：桥接原生 GenericToolCard、工具行模型与过程分组标题/样式，输出工具卡片简体中文词典。
- 2026-10-27：新增 DSH 原生 UI factory-body 提取桥、MIT 归属信息、源 bundle SHA-256 清单和生成说明，供 Tether 复用原生展示组件。
- 2026-10-27：补充导出原生文件图标与 DisclosureRow primitive，FileTree 文件、文件夹和展开箭头改用原生图标呈现。
- 2026-10-27：桥接 Sidebar Files 原生 Entry 单行并复用在 Tether FileTree；补上 Host noop 插件入口、client external 和 Cordis 加载顺序；为 SessionNodeItem 增加隐藏未支持菜单/重命名的适配开关。
- 2026-10-27：统一发布包版本为 0.2.1。
