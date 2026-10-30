# 构建脚本变更记录
- 2026-10-29：`tether_native=1`/iframe 模式只把含“全局面板”的 DSH 侧栏祖先右边框变透明，保留侧栏底色色差与独立 DSH 页面原样。
- 2026-10-29：新增 Monaco 构建助手，内嵌 editor worker 与 CSS，Web/DSH bundle 共用 `TetherMonacoRuntime`；DSH native surface 注册“目标设备文件” commandUi action。
- 2026-10-28：插件 Host 向 UI 暴露 `remote.pluginManager`，只用于用户确认后的单次本机 surface 重载。
- 2026-10-28：插件构建器在 `tether_native=1` 页面注册原生附件 rail 包装器，避免在父窗口或操作者本机打开文件选择器。
- 2026-10-28：附件 slot 使用 priority `-1000`（SDK 单槽按 priority 升序、最低优先级胜出），并注入 `fileDrag.read` 维持原生拖拽；依赖由 DSH client 模块声明。

- 2026-10-27：生成的 DSH 插件宿主通过 companion RPC 暴露本机插件更新调用；UI 自身不接触任意 URL、路径或更新包。
# 变更记录

- 2026-10-28：插件 bundle 构建器从客户端 package.json 嵌入 `PLUGIN_VERSION` 并交给 DSH Host，作为本机运行版本可信种子。
- 2026-10-29：重建 `client.js`，包含 native surface 去边线守卫、更新灯聚合、旧节点响应兼容与 Monaco 主题跟随；`build.mjs --check` 通过。
- 2026-10-30：Web 构建固定 `absWorkingDir` 到 dist 目录，使工作树中经 node_modules junction 解析的依赖模块标签与既有 bundle 路径稳定一致。
- 2026-10-30：更新缓存失效改按宿主与活动 Hub 连接身份，避免本机组件与远端组件轮询交替清空缓存。
- 2026-10-30：共享 DSH 插件桥以 owner RPC 与 remote.workspaceFiles 能力启用默认远端 Composer picker；`fileDrag` 仅作为可选 props 转发，不再决定附件集成是否挂载。

- 2026-10-30：附件 slot 注入原生 sessionId 与 uiWorkspace/sessions 服务；新草稿首次选文件会准备空白 DSH session，自动续接 workspace picker。

- 2026-10-30：附件 slot 注册不再从未注入的 ctx.fileDrag 读取服务；remote.workspaceFiles 与会话绑定足以提供目标附件，原生附件组件继续保留自身拖拽处理。
