# 构建脚本变更记录
- 2026-10-28：插件 Host 向 UI 暴露 `remote.pluginManager`，只用于用户确认后的单次本机 surface 重载。
- 2026-10-28：插件构建器在 `tether_native=1` 页面注册原生附件 rail 包装器，避免在父窗口或操作者本机打开文件选择器。
- 2026-10-28：附件 slot 使用 priority `-1000`（SDK 单槽按 priority 升序、最低优先级胜出），并注入 `fileDrag.read` 维持原生拖拽；依赖由 DSH client 模块声明。

- 2026-10-27：生成的 DSH 插件宿主通过 companion RPC 暴露本机插件更新调用；UI 自身不接触任意 URL、路径或更新包。
# 变更记录

- 2026-10-28：插件 bundle 构建器从客户端 package.json 嵌入 `PLUGIN_VERSION` 并交给 DSH Host，作为本机运行版本可信种子。
