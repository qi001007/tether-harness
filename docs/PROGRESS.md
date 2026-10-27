# 实时进度

更新日期：2026-10-27。

| 需求 | 当前状态 | 证据或下一步 |
|---|---|---|
| 跨项目设计准则记忆 | 已写入 | 用户授权的 ad_hoc 记忆更新记录 |
| 文件树重复与两层根节点 | 已验证 | 11 项前端回归；浏览器 10 次展开收起节点数 7→7；桌面 demo 仅一个 hello.txt，可打开 |
| DeepSeek 原生组件复用 | 已验证（展示层） | Workspace/Session、Markdown、思考、轮次状态和 Files Entry 已在真实 DSH Web 及桌面加载；完整远程 Host 代理未接入 |
| 侧栏与视觉一致性 | 已验证 | 明暗背景、900px 无横向溢出；宽度拖拽 280→328、复位至 280；控制台错误与 React key 警告为 0 |
| 当前桌面插件部署 | 已安装并验证 | 正常退出后重装，profile 自动备份；安装的 client/bridge 哈希与源码一致 |
| 最终满宽输入区 | 已桌面验证 | 新建按钮移入说明行，输入框不再被压缩，历史只读状态保持 |
| 原生过程分组与工具行（F08） | 已桌面验证 | 复用原生分组标题、工具图标、摘要及输入/输出卡片；内层分组、外层轮次分别收起再展开均保留工具详情状态；两条调用顺序一致 |
| 完整原生输入区、文件引用及轨迹（F09） | 本机完整链路已验证 | 同一个 Desktop Host；原生模型/权限菜单、hello.txt 引用标签、历史轨迹和 Node 重连恢复均已在正式设备通道验证 |
| 目标已有会话继续交互 | 同 Host 通道已实现，真实发送未验 | 原生编辑器可编辑，沿用现有 Host 写者；本轮不发送模型请求，不再通过另一个 SDK 进程恢复该会话 |
| LAPTOP-01 原生会话/文件视图 | 节点与插件待更新 | 真实显示节点更新提示；本轮未远程更新笔记本或调用模型，双机验收未完成 |
| 原生工作区单一入口（F10） | 已桌面验证 | 活动栏显示器图标直接显示目标 DSH Host 页面；Tether 自写对话/工作区树和“日志预览”入口已移除；`native-workspace-final.png` |
| 文件资源管理器（F11） | 已桌面验证 | 左树 `工作区/此电脑/未分组`，右侧名称/修改日期/类型/大小；点文件夹左右同步；面包屑/后退/上级；刷新图标转圈；右键打开/重命名/删除/新建/刷新；`file-explorer-final.png`、`file-context-final.png` |
| 文件渲染（F12） | 已桌面验证 | Markdown 渲染、文本编辑、图片/PDF 直显；DOCX/PPTX 经目标机 WPS COM 转 PDF；`file-markdown-final.png`、`file-pdf-final.png`、`file-pptx-final.png`；Python 26/26、JS 20/20 |
| 权限页收口（F13） | 已桌面验证 | 只保留侧边盾牌；可写根目录逐行添加/编辑/删除；审计最近 200/500 条并说明审计范围；`file-permissions-final.png` |
| DSH Electron userData 修复 | 已恢复 | 原 `dsh-desktop` 的本地 welcome cookie 损坏导致启动 `Web authentication failed`；备份为 `dsh-desktop.bak-auth-20261027-105309`，改用新 userData，重装插件并恢复 MCP 配置后正常 |
| 文件夹整行/文件图标/刷新/顶栏（F14） | 已桌面验证 | 文件夹整行展开收起；左右 `FileTypeIcon`；`C:` 根刷新与右键刷新不再报 `path must be absolute`；顶栏独立背景层；Tether 图标 16×16 居中 |
| 权限精简/审计 SQLite/互联页（F15） | 已桌面验证 | 权限文案短句；审计 SQLite WAL 上限 100000、分页、旧 JSONL 迁移；点空白/Escape 关闭抽屉；互联页节点卡片 + 本机居中拓扑，`network-final.png` |
| 互联画布/多设备/动态节点（F16） | 已桌面验证 | 刷新旋转并重拉状态；移除页脚说明；设备列表 8/页分页；11 台临时设备验证 1/2；画布铺满、可拖边界/双击复位；节点拖拽惯性/自由力导向 |
| 自绘设备菜单（F17） | 已桌面验证 | 替换原生 select；DSH 字体/色阶、在线点、平台/workspace 副行、互联入口；点击外部（含 iframe）与 Escape 关闭；`device-menu-final.png` |
| 顶栏接缝/菜单精简/Win11（F18） | 已桌面验证 | 去掉顶栏接缝并回到原色；菜单改单行设备名 + 系统版本；按 build 识别 Windows 11（22631/26200）；互联卡片同步；`device-menu-final.png` |
| 玻璃圆点/阻尼/整体色系（F19） | 已桌面验证 | 阻尼 0.95 缩短惯性尾摆；缩放 <72% 显示玻璃球、隐藏文字；顶栏与活动栏同 C.soft；菜单 OS 小字置底；当时截图 `network-zoom-final.png`（现已被 F21 覆盖） |
| 苹果式毛玻璃球（F20，已被 F21 取代） | 已桌面验证 | 30/24px 中性毛玻璃、backdrop blur、7s 柔光漂移、内阴影；在线仅 5px 绿点；暗色单独渐变；当时截图 `network-zoom-final.png`（现已被 F21 覆盖） |
| 纯色正圆与原生页接缝（F21，取代 F20） | 已桌面验证 | 41% 缩放 30/24px 正圆：`corner-shape: superellipse(1)`、border/shadow 均为 0、不透明 `color-mix`；连线不穿圆；内嵌 DSH `.sidebarCol` 边框 0；resizer 无 hover 线；截图 `network-zoom-final.png`、`native-workspace-final.png` |
| 连线端点/线语义/标签/连接设计（F22） | A–D 已桌面验证，E 仅设计 | 线按节点边缘裁剪；两端在线实线、任一端离线虚线；卡片 `插件互联`/`插件版本过旧`，App 互联预留；普通节点去蓝环；显式边/命令面板/批量连接/100+ 聚合见 `DESIGN.md` §12.1；截图 `network-final.png`、`network-zoom-final.png` |
| 线贴圆/细长比例/节点框/改名（F23） | 已桌面验证（F23-F 仅设计） | 线端点贴入圆边 1px；弹簧静止长度 35、低缩放位置展开，41% 线/圆约 6 倍；100% 非本机节点白底胶囊 + 轻阴影；`display_name` 持久化、重连不覆盖；卡片/节点右键改名；截图 `network-final.png`、`network-zoom-final.png`、`network-rename-menu.png` |
| 中性连线/小圆/连通语义（F24） | 已桌面验证（E/F 仅设计） | 线中性灰、无状态色；实线=连通（不加绿点），虚线=有关系但离线/未连接；节点 28/22px；Tailscale 可选与纯插件 NAT 边界、改名并发风险已记录；截图 `network-final.png`、`network-zoom-final.png` |
| 更长的线/更小的圆/缩放颜色连续（F25） | 已桌面验证 | 弹簧静止长度 40、布局半径 40；缩放圆 22/16px，外框/填充/连线同中心；本机黑圆、子节点 8% 蓝 tint；放大/缩小同色，跨阈值只变形状不变色；截图 `network-final.png`、`network-zoom-final.png` |
| 去掉 Tailscale 依赖（F26） | 仅设计 | 应用层 Relay/Account：两端出站 TLS/WSS、按 device_id 转发、Node 不入站；局域网直连优先，Relay 做 NAT 回退，P2P 可选；见 `DESIGN.md` §12.3 |
| APP / 插件 / WebUI 一体化（F27） | 仅计划 | APP 为主体、插件为 DSH 适配、Web 为 APP 自带服务；共享 UI、服务监督、Hub/Node、Relay、Tailscale 回落与分阶段验收见 `docs/APP_PLAN.md` |

本表中的“已验证”只用于本轮实际执行且有结果的项目。

本轮检查：Python 后端回归 9/9；文件树、选择与发送绑定回归 11/11；运行中到完成的渲染契约 1/1。浏览器未模拟完整运行中到完成的模型会话，该项不能替代真实模型测试。

F08 追加检查：渲染/适配契约现为 6/6，包含实际生成 bridge factory 的干净 VM 启动检查及实时工具错误事件映射；文件树回归仍为 11/11。首次桌面安装暴露的词典常量依赖缺失已修复并重新安装，最终 client/bridge 安装哈希与源码一致，桌面已成功加载并读取原历史会话。本次仅查看历史，无模型调用或远端文件修改。

F09 检查：Python 24/24、JavaScript 20/20；独立真实 Host 浏览器验收通过，无页面异常及重复组件注册。正式 Electron 验证经 Controller/Node 的完整协议链路，不仅是隔离 harness。大组合前端资源已改为 gzip 转发并重验；附件传输及单帧上限为 8 MiB。实际附件上传和模型发送未验，不能标为跨机任务成功。

F10–F13 检查：Python 26/26、JavaScript 20/20。桌面实测：默认工作区文件页、demo 明细、MD/PDF/DOCX/PPTX 预览、右键菜单、盾牌权限页均出图；Office 转换依赖目标机 WPS/Office，转换会写 `preview` 审计。DSH Electron userData 的本地 welcome cookie 损坏已通过新 userData 恢复，旧目录保留备份；插件重装、MCP 配置恢复。未发送模型请求，未远程更新笔记本。

F14 检查：Python 27/27、JavaScript 20/20（新增盘符根解析测试）；桌面实测 demo 文件夹整行打开/收起、右侧类型图标、C: 顶部刷新与右键刷新均无报错；顶栏色差和 Tether 图标尺寸/对齐已截图确认。

F15 检查：Python 28/28、JavaScript 20/20（新增 SQLite 审计分页/迁移测试）；桌面实测权限页短文案、审计 36 条/上限 100000、点空白关闭抽屉、互联页节点卡片与网络拓扑均出图（`network-final.png`）。旧 `audit.jsonl` 已迁移为 `.migrated`。

F16 检查：仍为 Python 28/28、JavaScript 20/20；桌面用 9 台临时设备验证刷新前 7/11、刷新后 1/2，设备列表 8/页分页、画布显示全部节点；拖边界与双击复位、节点拖拽回弹已实际操作。临时设备已删除。

F17 检查：同一回归 28/28、20/20；桌面实测自绘菜单排版、LAPTOP-01 离线、互联入口，点击 iframe 区域关闭菜单；安装后 client 哈希与源码一致。

F18 检查：同一回归 28/28、20/20；`/api/state` 中 DESKTOP-LOCAL 的 `os_label` 为 `Windows 11 · 22631`，旧 LAPTOP 由 UI 解析为 `Windows 11 · 26200`；桌面确认菜单单行、无 workspace 路径、顶栏无接缝；client 哈希与源码一致。

F19 检查：同一回归 28/28、20/20；桌面实测滚轮 600 单位缩到 40%，文字消失、玻璃球可见；client 哈希与源码一致。阻尼与惯性尾摆仍需主人实际手感验收。

F20 检查：同一回归 28/28、20/20；桌面 40% 缩放截图确认中性毛玻璃球、绿点状态和 30/24px 尺寸，client 哈希与源码一致（该视觉已被 F21 取代）。

F21 检查：Python 29/29、JavaScript 20/20（新增 HTML 网关清理回归）；桌面 41% 缩放实测两枚节点 30/24px、`corner-shape: superellipse(1)`、`border: 0px`、`box-shadow: none`、不透明 `color(srgb …)`；取消选中蓝环；内嵌 DSH `.sidebarCol` 计算边框 `0px`，注入样式存在；`network-zoom-final.png` 与 `native-workspace-final.png` 已更新；装后 client 哈希 `879a275f…` 与源码一致，Node 重启后设备恢复在线。

F22 检查：Python 29/29、JavaScript 20/20；桌面 100% 时虚线端点距 LAPTOP 圆点约 3px、距中心胶囊边缘约 2px；41% 时两端分别停在 30/24px 圆边外约 3.5px；卡片只显示 `插件互联` 与 `插件版本过旧`，不再堆叠文件能力错误；中心节点选中态无蓝色 outline；`network-final.png`、`network-zoom-final.png` 已更新；装后 client 哈希 `9ed6b555…` 与源码一致。显式边与连接交互未实现，设计已写入 `DESIGN.md` §12.1。

F23 检查：Python 32/32、JavaScript 20/20（新增显示名持久化/旧库迁移/缺失设备回归）；桌面 41% 两节点中心距约 171px、线长约为 24px 节点的 6 倍，线端点贴入圆边 1px；100% LAPTOP 白底胶囊和轻阴影可见；改名 UI 实测 `LAPTOP-01 → Laptop-UI`，`/api/state` 同步；另一客户端 POST `Laptop-Sync` 后 3 秒内页面卡片同步，随后复位；改名 `DESKTOP-LOCAL → Desktop-Test` 后重启本机 Node，状态仍为 `Desktop-Test`，之后复位；卡片和画布节点右键均出现“重命名 / 打开原生工作区”。装后 client 哈希 `71b2a54f…` 与源码一致。团队权限/审计/并发版本冲突未实现。

F24 检查：连线改为 `C.mute` 中性灰，实线只表达连通、不加绿色中心点；41% 节点 28/22px，线端点 13/10px 仍贴圆；100% 分机节点白底框可见；桌面截图确认无线色、无蓝环。当前 32/32 Python、20/20 JS；装后 client 哈希 `ddfca5fa…` 与源码一致。Tailscale 可选/relay 边界与改名并发风险只写设计，F24-E/F 未实现。

F25 检查：弹簧静止长度 40、半径 40；41% 中心距约 195px、圆 22/16px，线端点 9/6px 进入圆边 2px 且同中心；本机缩小圆为黑色，子节点为 8% 蓝 tint（选中 13%），与放大态胶囊底色一致，跨 72% 阈值只有形状变化、无颜色突变。当前 32/32 Python、20/20 JS；装后 client 哈希 `fe5f325e…` 与源码一致。

F26 检查：仅完成架构设计，无代码改动；未安装/部署 Relay，未关闭 Tailscale 做双机验证。不能把 §12.3 说成已实现。

F27 检查：仅写计划 `docs/APP_PLAN.md`，无代码改动；共享 UI、APP 壳、服务监督、Relay 都未实现。
