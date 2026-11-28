# Tether 产品界面设计准则与架构记忆（长期生效）

> 本文件是 Tether 仓库内的长期设计准则与工程约束；与工作区根目录 `docs/UI_DESIGN_RULES.md`、`AGENTS.md` 以及 `docs/TECHNICAL.md` 的跨版本兼容契约保持一致。所有修改前端界面、集成第三方组件或演进跨节点协议的开发者/AI 必须遵守。

## 1. 前端极简与图标化准则（铁律）

- **少文字、少解释性语句**：界面尽量用**图标 + 极短标签（2–6 字）**表达状态和动作，禁止在空态页、未启动页、设置页、工作台入口堆砌大段解释性文字或解释“为什么要这样设计”的说明段落。
- **直接进入，不做废话中间页**：点击左侧导航图标就应该直接进入对应功能（如点击多 Agent 直接进入 Codeg 工作台），禁止停在三按钮说明卡片页让用户重复确认。
- **默认首屏规则**：每次全新打开 Tether APP（冷启动），默认落在左侧第一个图标对应的 **DSH 页面**（不因上次关闭停留在其他 Tab 而跑偏；最小化到托盘恢复时保留当前页）。

## 2. 第三方组件内部融合准则（Codeg）

- **改造为内部源码资产，而非拼贴外壳或盲目追更**：Codeg `0.42.0` 前端源码已直接纳入本仓库 `third_party/codeg/` 作为 Tether 内部模块维护，由 `scripts/build_codeg_runtime.ps1` 与 CI 统一静态导出到 `tether/node/bin/agents-runtime/web/`，不再依赖外部仓库拉取或打补丁。
- **视觉与导航原生统一**：Codeg 内的「智能体」页必须 100% 复用 Codeg 原生 shadcn/Tailwind 设计 Token（`bg-primary`/`bg-accent`/`Button`/`Badge`/`Switch`/Lucide 图标/`AgentIcon`），禁止硬编码割裂配色或自造字号体系；「智能体」入口固定在侧边栏（与「自动化」「待办任务」平级）以及左下角快捷菜单（同样包含「智能体」「自动化」「待办任务」）。

## 3. 跨节点资源访问铁律（内置资源管理器）

- **永远调用 APP 内置目标设备资源管理器（`TetherFolderPickDialog`）**：在 Tether APP 内，无论是 **DSH 页面** 还是 **多 Agent（Codeg）页面**，凡是**创建/打开项目目录**以及**对话框上传附件/选择文件**，都必须打开 Tether 内置资源管理器浏览**当前锁定目标节点**的文件系统。
- **严禁弹出本地 OS 资源管理器**（Windows Explorer / Finder / 原生 `<input type="file">` 弹窗），且选目录/选文件请求必须锁定 `{requestId, deviceId, guest, grantId/openRevision}`，切设备或切会话立即作废未完成请求。

## 4. 跨节点版本兼容性契约

详见 [TECHNICAL.md](TECHNICAL.md) 中的「跨节点版本兼容性契约（5 条铁律）」。建立稳定基线后，严禁 `0.0.x` 小版本升级导致节点间传输或工作台整体不可用。
