# 构建脚本变更记录

- 2026-10-27：生成的 DSH 插件宿主通过 companion RPC 暴露本机插件更新调用；UI 自身不接触任意 URL、路径或更新包。
# 变更记录

- 2026-10-28：插件 bundle 构建器从客户端 package.json 嵌入 `PLUGIN_VERSION` 并交给 DSH Host，作为本机运行版本可信种子。
