# 完整原生远端页面接入

## 目标与依据

用户要求完整使用目标电脑的 DeepSeek Harness 对话页，包括原生模型选择、会话权限、目标文件引用、附件、轨迹和实时会话。单独复刻输入框外形不能满足该需求。

本机安装的 Desktop 0.2.1-rc.3 在同一个 desktop profile 中启动回环地址、动态端口的 Web Host，再由 Electron 将 `dsh-app://app` 请求转发给它。已核对安装包 `app.asar` 中的 `dsh-desktop-host/lib/index.js` 和 Electron `lib/main.js`。因此接入目标现有 Host 可以共享其工作区、会话写者和原生插件，不另启 SDK 去抢占会话。

## 链路

1. 目标 DSH 加载极薄的 Tether surface 插件，发布当前 Host 的本机描述文件。插件只读取现有 `webServer`、`connection` 服务，不新建 Web Host 或 SessionStore。
2. 目标 Tether Node 读取描述文件，仅连接其中经过校验的固定回环 origin；上游握手凭据及 cookie 留在目标 Node 内存。
3. Controller 经既有设备通道转发原生 HTTP 与 WebSocket，为每台设备提供独立的本机入口。
4. Tether 面板整体嵌入目标原生页面。原生 HTML、模块、输入区、模型菜单、权限菜单、文件引用及轨迹都由目标 Host 提供，旧日志展示仅作明确标注的辅助预览。

## 文件与权限语义

- 原生文件引用访问目标 Host 的文件服务，不能用控制机本地文件选择器冒充目标目录。
- 浏览器附件上传与目标文件引用是两种操作，均沿用原生入口和处理结果。
- 原生会话权限由目标 DSH 管理；Tether 文件管理器的独立文件策略不能声称约束了完整 DSH Host。
- 本机描述文件包含连接凭据，不能回传浏览器、写入 Controller 数据库或出现在日志及错误里。
- 节点只接受固定 Host 内的路径，不允许浏览器传入任意转发 URL。设备入口各自鉴权、限制跨站请求，并在连接结束时释放通道。

## 验收门禁

- 原生页面在真实目标 Host 上启动；目标与页面显示同一会话，不能以另一个 SDK 会话替代。
- 模型、会话权限、文件引用菜单可操作并返回目标数据；轨迹使用原生视图和原始会话记录。
- 设备切换、断线、Host 重启不串设备、不把旧响应写回新页面。
- 无模型验收覆盖界面、目录读取、文件引用草稿和轨迹。真实模型发送必须单独记录调用证据，不能用界面显示或静态测试代替。
- 大附件/响应的传输上限必须明确，超限显示错误；当前实现不声称支持无界文件或任意吞吐。

## 当前状态与实际证据

2026-10-27 已安装 companion 并更新本机 Controller / DESKTOP-LOCAL Node。正式链路为 Electron iframe → 每设备 gateway → Controller/Node WebSocket → 同一个运行中的 Desktop Host，未启动第二个 SDK 写者。

- 正式桌面验证：读取目标的模型列表；只读打开权限菜单；`@` 列出 demo 工作区的 `hello.txt` 和已有会话；选中 `hello.txt` 后成为原生文件引用标签，之后清空该验收草稿，没有发送。
- 正式桌面验证：选择原有 Use the bash tool to 会话，轨迹显示上下文、请求、工具、输出及时间线；Node 单独重启后恢复该会话；切换旧 LAPTOP-01 显示节点更新提示，切回 DESKTOP-LOCAL 恢复原有会话。
- 最终客户端补充实测：切到 Tether 文件页再返回，原生输入区的未发送草稿仍保留；验收文字已清空。切换设备的首帧同步清除旧目标 URL，避免旧页面配上新设备名。顶部文件策略单独标记，与原生会话权限区分。
- 内嵌页视觉补丁：Node 转发 HTML 时注入 `#tether-native-surface`，把 `.sidebarCol` 的 0.5px 右边框置 0。桌面版由 `[data-windows-titlebar]` 隐藏这条线，浏览器版没有该属性；实测内嵌页计算边框 `0px`，只作用于 gateway 响应。
- 独立 Microsoft Edge + 真实 Host 直连 harness 通过，页面异常为 0，重复 renderer 注册为 0；模型、权限、附件入口、引用候选和轨迹可见。报告中的一条网络失败是测试主动阻断外部头像图片，不是本机转发失败。这层自动化不替代前述正式 Node WebSocket 桌面验收。
- Python 定向与原有回归 32 项通过；JavaScript 文件树、渲染与 surface 契约 20 项通过。没有调用模型、改变权限模式或选择新模型；上传实际文件及真实发送仍需单独验证。

首次完整资源组合请求暴露 8 MiB 限额导致的 502。Node 现固定请求 gzip，并原样保留压缩头与字节，重验大资源加载通过。HTTP 请求/响应和 WebSocket 单帧传输上限均为 8 MiB，暂不支持无界大附件；超限返回明确错误。

旧笔记本节点需要同步新协议与目标插件后才能提供完整页面，双机真实验收尚未完成。此前原生展示组件仍用于文件树/Markdown 预览；旧日志预览不再作为插件入口，读取器保留为后端兼容/证据。

## 目标设备更新

每台目标设备都需要运行最新版 Tether Node，且目标 DSH desktop profile 安装本仓库的 Tether bundle。bundle 会同时装入 surface companion。更新前保留目标机自己的环境配置、凭据、数据库和 DSH 会话数据；复制源代码不能替代这些本机配置。

在已有本仓库代码及所需 runtime 依赖的目标设备上，正常退出其 DSH 后执行 `desktop/install-plugin.ps1`（CLI 路径不同时通过 `DSH_CLI` 指定目标真实 CLI），再启动目标 DSH 并重启其 Node。Controller 收到 `dsh_surface` 能力后，Tether 的该设备入口才能打开完整页面。当前未远程执行 LAPTOP-01 更新。

`scripts/qa_native_surface.py` 用 `python -m scripts.qa_native_surface` 从仓库根启动，是隔离直连验收工具。`scripts/restart-local-services.ps1` 默认只预览；`-Apply` 要求无活动运行才重启本工作区服务，`-NodeOnly -Apply` 保留 Controller 及现有 gateway 端口。
