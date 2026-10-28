# UI 宿主适配变更记录

- 2026-10-27：DSH 本机身份先查同机 APP 上下文，再经 owner-only RPC 读取 Node descriptor；未知时不使用 Hub 或 Controller 的 local_device。

- 2026-10-27：DSH 宿主适配按 API base 限定 Hub Authorization，避免请求回退到本机 APP/Controller 时携带远端 token。
- 2026-10-27：Electron 宿主增加状态/检查/准备/安装四个白名单 IPC；更新中心在 DSH/浏览器宿主中直接使用目标设备 API，不通过 APP IPC，也不猜测本机设备身份。
- 2026-10-27：DSH 宿主增加本机插件更新方法，白名单只接受 status/check/prepare/apply，并将 apply payload 收窄为 prepared_id；真实动作由插件实例自己的 RPC 完成。
- 2026-10-27：DSH Hub 检测返回同次 `/api/state` 的客户端请求耗时，异常交由 UI 以固定安全文案显示。
- 2026-10-27：DSH Hub HTTP 错误仅向 UI 返回状态码属性用于 401/403 分类；错误消息不包含响应原文或凭据。
# 变更记录

- 2026-10-28：DSH Host 接收 bundle 内嵌插件版本，供本机更新卡在 RPC 失败时仍显示实际运行版本。
