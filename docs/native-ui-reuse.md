# DSH 原生 UI 复用桥

本页记录展示组件桥（文件树 `FileEntryRow`、Markdown 和文件类型图标）。F09 完整原生页面现整体接入目标已运行的 Desktop Host，具体链路与验收见 `native-surface.md`；下面“完整 Host 未接入”的描述属于此前展示层阶段记录。

## 来源与生成

Tether 复用 DSH 的 Markdown、思考行、轮次过程、运行状态和 Workspace/Session 行。本仓库的 `packages/tether-dsh-native-ui` 由 `scripts/build-native-ui-bridge.mjs` 从本机安装的 `0.2.1-rc.2` bundle 中提取原 factory 词法作用域并在作用域内返回原展示组件。生成文件头记录整个源 bundle 的 SHA-256。

生成器不执行源字符串、不注册上游 module ID，也不调用上游 `apply`。Host 使用 `lib/index.js` 加载无操作插件入口；Cordis patch 先加载 client bridge assembly，再加载 Tether client assembly。需要同版本 DSH runtime 已安装到 `.runtime/npm/node_modules`；可从仓库根目录手工运行 `node scripts/build-native-ui-bridge.mjs`。安装脚本在安装插件前运行生成器，确保桥包与当前 runtime 对应。桥包和复制的上游代码按 MIT 许可证分发，归属信息与许可证放在包目录。

## 直接复用的上游导出

- Chat bundle：`MarkdownText`、`FileTypeIcon`、原生文件夹/箭头图标、`DisclosureRow`、`UserStyleBubble`、`UserContent`、`ReasoningRow`、`TurnProcessNodeView`、`ProcessGroupHeader`、过程分组 CSS 映射、`RunningStatus`、`markdownLabels`。
- Tool bundle：`GenericToolCard` 及其原生工具模型。Tether 调用记录适配为原生参数视图和结果块；工具识别、图标、摘要、输入/输出详情和错误样式均由原生组件处理。
- Workspace bundle：`ProjectRowItem`、`SessionNodeItem`。桥包为 Tether adapter 增加了可关闭上游重命名与菜单的参数，避免暴露当前不支持的空操作。
- Sidebar Files bundle：`FileEntryRow` 直接返回上游 `Entry` 的原生单行 button；Tether 仍维护递归和远端树状态，只将当前项回调接入原生 row。
- Locale：Chat、Workspace 的上游 `zh` 字典，以及 Conversation 包中工具组件所用的 `zh` 字典；所有来源固定为 `0.2.1-rc.2` 并记录版本、许可证和哈希。

Tether 将当前远端会话/轮次投影适配到这些展示组件，并保留 Tether 自己的远端数据请求与事件回调。FileTree 继续由 Tether 管理递归和远端树状态，但每个资源项直接复用 DSH `Entry` 原生 button、图标、文本与 hover 样式。轮询只在用户原本贴近对话底部时自动跟随，切换会话重置到底部，上翻时保留阅读位置。完整 DSH `ChatView` 和完整 Host 工作区控制器/树投影并未代理接入，因此不能描述为完整远端原生工作区或 100% 原生远端页面。

本轮反馈还修复了轮次从运行中切为完成时条件分支改变 hook 数量、运行状态组件引用未定义变量，以及工具详情只显示参数或返回值其中之一的问题。`tests/test_native_render_contract.mjs` 以运行中到完成的连续 render 检查 hook 数量稳定；真实 DSH Web 运行仍由隔离 QA 验证。

后续 F08 修正：在外层轮次下增加原生“已调用工具”过程标题及独立折叠，单条思考和工具继续分别折叠。收起容器时隐藏内容而不卸载行，以保留已展开的行详情。原手写工具行及其 JSON 摘要被原生 `GenericToolCard` 取代；参数 `{ "device": "LAPTOP-01", ... }` 的摘要由原生模型生成“工具调用 · mcp__tether__remote_task · LAPTOP-01”，完整参数及返回值放入展开详情。验证结果完成后记录到实时进度。

F08 桌面验收已完成：同一历史会话中两条远程工具调用显示原生图标和设备摘要，第一条展开后同时包含输入与输出，第二条保持收起。分别收起内层分组和外层轮次，再展开后第一条详情仍保持打开。追加修复实时 `tool/result` 的错误标志映射。最终渲染契约 6/6、文件树回归 11/11；安装后的 client 与 bridge 哈希一致。

本次首次桌面启动暴露 Conversation 中文词典引用常量 `PLAN_NEXT_ACTION_ZH` 的依赖缺失。生成器现从同一源 bundle 提取常量，在词典前声明；新增在干净 VM 中实际执行整个生成 factory 的测试，避免仅语法检查漏报。修复后已重装并确认桌面成功加载。本次未运行新模型会话。

## 验证

2026-10-27 实测：隔离 DSH Web + Microsoft Edge 中插件稳定挂载、原生 Markdown 与工作区行可见；文件树读取真实 Controller，10 次展开收起保持 7 个可见根节点，重复 ID 与 React key 警告为 0；明暗主题与 900px 视口检查通过，拖拽宽度 280→328→双击复位 280；console/page/network 错误为 0。测试来源 origin 的 CORS 适配只在浏览器测试路由中使用，生产 CORS 未改。

实际 DeepSeek 桌面也已重新安装并验证：文件树 demo 下只出现一个 hello.txt，点击可读取原内容；对话与侧栏切换同步；最后一版满宽输入区与只读提示已在桌面确认。安装前通过应用菜单正常退出，profile 留有自动备份，安装产物与源码哈希一致。Python 回归 9/9、文件树/会话绑定回归 11/11、渲染契约 1/1。本轮没有触发模型请求或修改远端文件；浏览器未覆盖运行中到完成的完整模型交互，相关 hook 顺序由渲染契约测试覆盖。隔离 QA 服务已停止，原有 Controller/Node 保持运行。

从仓库根目录运行 `node scripts/build-native-ui-bridge.mjs` 可验证输入版本/许可证并再生成桥包；运行 `node --check packages/tether-dsh-native-ui/lib/client.js` 和 `node --check packages/dsh-plugin-tether-client/lib/client.js` 可验证输出语法。安装器成功生成后再调用 DSH plugin 安装流程。仅有静态检查不能证明桌面端加载和 React 运行时渲染成功。
