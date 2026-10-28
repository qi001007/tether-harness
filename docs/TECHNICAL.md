# Tether 技术说明

本文公开 Tether 客户端、插件、Node 与服务端之间的兼容边界，不记录私有服务地址、部署操作、凭据位置或内部服务器实现。

## 组成与职责

| 组件 | 职责 |
|---|---|
| DSH 插件 | 在 DeepSeek Harness 中呈现设备切换、文件与权限功能，并可提供 MCP 工具入口。 |
| APP 客户端 | 提供独立桌面入口；可连接用户已配置的本地服务或可达 Hub。v0.2.1 APP ZIP 已发布；目标环境干净安装和升级尚未验收。 |
| Node | 代表一台目标设备，执行授权范围内的文件和任务操作；连接由用户配置的 Tether 服务。 |
| Tether 服务 | 提供客户端与 Node 使用的兼容 API。可由有权限的私有服务部署提供，或由用户配置可达 Hub。其部署和运行细节不属于本公开仓库文档。 |

模型、账号凭证与 DSH 会话属于目标设备上的 DSH Host。Tether 客户端不应创建并行会话，也不应把私有服务令牌发送给目标模型或公开日志。

## 连接与兼容边界

- 客户端通过配置的服务地址连接 Tether 服务；Node 使用出站的安全 WebSocket 连接，不要求目标设备开放公网入站端口。
- `device_id` 标识设备；显示名称是用户可修改的标签，不能替代设备身份。
- 同一任务的重试需要沿用同一请求身份；事件消费按序号确认。客户端必须保留取消结果与状态不确定的区分，不能把未知结果自动当成失败并重放任务。
- 插件、APP、Node 与服务端必须使用兼容的协议版本。每次发布都应核对版本清单与制品摘要，并分别验收升级/回滚；v0.2.1 尚未完成数字签名和完整远端升级验收。
- v0.2.1 的三份 ZIP 与统一更新清单已发布；官方 HTTPS 下载、SHA-256 和部分更新器清单检查已完成。这不证明制品已在目标设备干净安装或完成软件内/远端升级。
- 设备文件操作受 Node 当前策略限制。用户界面显示的设备与工作区不能改变服务端授权范围。
- DSH 原生附件 picker 从当前 Host 的 owner-only `/tether-identity` RPC 取得 `device_id`；读取使用 DSH `remote.workspaceFiles.list/readBytes`，受当前 DSH Session workspace scope 与 Host filesystem 权限约束，不需要在 iframe origin 配置 Hub token。picker 只允许打开最近由 API 返回的目录和文件条目，`readBytes` 的 `Uint8Array` 按 256 KiB 分块形成附件，单文件限 10 MiB；设备或 Session 作用域变化后不调用当前 composer `onAddFiles`。该候选仍需实机验证 DSH Remote 注入与上传生命周期。

## MCP 工具接口

在已配置并获授权的服务上，插件可向 DSH Agent 提供以下工具：

| 工具 | 用途 |
|---|---|
| `list_peers` | 查询可用设备及连接状态。 |
| `remote_task(device, prompt)` | 在目标设备提交任务。 |
| `remote_status(run_id)` | 查询任务状态。 |
| `remote_cancel(run_id)` | 请求取消任务。 |
| `remote_workspaces(device)` | 查询目标设备可用工作区。 |
| `remote_files(device, path, op, text?, dest?)` | 在策略允许范围内列出、读取、写入、创建、重命名或删除文件。 |
| `remote_audit(device, limit)` | 查询目标设备审计记录。 |

这些工具描述的是客户端可见操作。服务认证、部署拓扑、密钥管理和存储实现由具体服务发行与维护，公开客户端文档不包含其私有配置。

## 验证边界

离线回归、隔离 UI 检查、本机 DSH 验收、干净安装、真实跨设备操作和公开发布是不同的验证层。某一层通过不能替代其他层。当前进度和未验收项目见 [PROGRESS.md](PROGRESS.md)；功能需求和反馈见 [PRD.md](PRD.md) 与 [FEEDBACK.md](FEEDBACK.md)。

## 编码四原则

1. 编码前思考：先核对实际行为，写明假设与权衡。
2. 简洁优先：用满足当前需求的最少结构实现。
3. 精准修改：只改与反馈直接相关的内容。
4. 目标驱动执行：定义成功标准并按对应层级验证。

