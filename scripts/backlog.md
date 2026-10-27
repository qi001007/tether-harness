# 修改记录

- 2026-10-28：更新清单最低 updater 版本与制品版本解耦，构建拒绝版本元数据不一致；Node 独立安装说明要求配置 Hub WebSocket 地址与 Node token，不再暗示本地开放 Controller。

- 2026-10-28：Controller 部署、重启及 native surface 服务端验收脚本迁入私有 `tether-harness-server/scripts`；公开保留客户端构建与验证工具。
- 2026-10-28：发布 ZIP 插件安装说明统一指向连接页配置服务，移除过期 Hub 页面入口及本地 Controller 说明。

- 2026-10-27：提取工具词典引用的 `PLAN_NEXT_ACTION_ZH` 常量，保持其与 locale 对象同一词法作用域。
- 2026-10-27：桥接生成器增加原生工具卡片、过程分组标题/CSS及工具行所需的简体中文词典导出。
- 2026-10-27：新增 `build-native-ui-bridge.mjs`，校验上游版本和 MIT 元数据、提取原生组件作用域、记录源哈希并输出可安装的桥包。
- 2026-10-27：新增 `qa_native_ui.mjs`，在隔离 DSH Web + Edge 中验证真实只读 Controller 数据、原生渲染、文件树、明暗主题和拖拽；仅测试路由处理 CORS，不修改生产配置。
- 2026-10-27：新增 `qa_native_surface.py`，提供只读、无模型的本机 iframe harness，直接以同 Host NativeSurface + NativeSurfaceGateways 验收原生页面；此直连路径不替代真实 Node WebSocket 隧道验收。
- 2026-10-27：新增 `restart-local-services.ps1`，提供默认 DryRun 的 workspace-scoped Tether Controller/Node 服务重启预览与显式 Apply 流程，检查活动运行、健康探测、日志隔离和目标进程树。
- 2026-10-27：`restart-local-services.ps1` 增加 `-NodeOnly`，保留现有 Controller，仅按原活动 run gate 和健康检查重启目标 workspace Node。
- 2026-10-27：新增 `qa_native_surface.mjs`，使用隔离 Edge/Playwright 在本机原生 surface QA harness 中检查完整原生 UI、模型/权限/引用/轨迹菜单；网络仅允许 loopback，阻断所有写请求，不登录、不发送、不选文件上传，并为 URL 日志脱敏。
- 2026-10-27：按 Electron 实机标签修正原生预览说明的“继续”确认、折叠侧栏与 “Use the bash tool to” 历史项、访问模式菜单、renderer 重复注册日志匹配；仅拦截明确的消息/运行提交端点，核心控件缺失或菜单未打开时测试失败。
- 2026-10-27：原生预览说明改为可选（说明弹窗或 Composer 任一先就绪），移除非必需轨迹 History 子标签门禁，改验轨迹表格与 timeline；报告注明本机 harness 不覆盖目标 Node WebSocket 隧道。
- 2026-10-27：将原生对话标签验收移至侧栏展开并选择 Use the bash tool to 历史会话之后，避免欢迎新任务页上提前检查尚未出现的会话标签。
- 2026-10-27：修复多行 Python helper 直接传给 `-c` 被引号截断的问题，改用临时 `.py` 文件执行；DryRun/Apply 均实测通过。
- 2026-10-27：插件独立发布包包含桥生成脚本；发布安装器在缺少本地上游源码包时校验并采用包内预生成桥。
- 2026-10-27：发布脚本生成0.2.1 APP/插件/Node压缩包及包含大小、SHA-256、协议和最低更新器版本的统一更新清单。

- 2026-10-28：将 qa_native_* 临时 harness 源码归档到仓库外维护备份；正式回归测试源码继续保留在 tests/。

# 变更记录

- 2026-10-28：修正独立插件安装说明，统一引导至 Tether 连接页配置服务，移除旧 Hub 页面入口和本地 Controller 说明。
