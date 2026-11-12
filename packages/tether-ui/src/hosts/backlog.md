# UI 宿主适配变更记录
- 2026-11-10：Electron host 新增只接收 targetId 的 `openLegacyCodeg` 桥；token URL 不经过 preload、IPC 返回值或 renderer。
- 2026-11-10：Electron host 通过主进程认证桥接取得状态、发起系统浏览器登录并在授权后给固定 Controller 请求附加访问令牌；刷新与身份切换由主进程会话处理。25 项 Node 定向测试、portable 未登录冷启动和正式 r7 dual audience 部署通过；真实登录及原设备列表待验收。
- 2026-10-28：暴露一次性本机 surface 重载接口；唯一启用的 `tether-dsh-surface` 插件由 `remote.pluginManager` 重新应用，其 `application` 状态原样返回并区分 `restart-required`。
- 2026-10-28：新增 owner-only 目标身份绑定附件读取桥；固定配置 Hub 地址、逐块请求原始 base64 字节、单文件 10 MiB 上限，并在目标设备或会话变化时拒绝 addFiles。

- 2026-10-27：DSH 本机身份先查同机 APP 上下文，再经 owner-only RPC 读取 Node descriptor；未知时不使用 Hub 或 Controller 的 local_device。

- 2026-10-27：DSH 宿主适配按 API base 限定 Hub Authorization，避免请求回退到本机 APP/Controller 时携带远端 token。
- 2026-10-27：Electron 宿主增加状态/检查/准备/安装四个白名单 IPC；更新中心在 DSH/浏览器宿主中直接使用目标设备 API，不通过 APP IPC，也不猜测本机设备身份。
- 2026-10-27：DSH 宿主增加本机插件更新方法，白名单只接受 status/check/prepare/apply，并将 apply payload 收窄为 prepared_id；真实动作由插件实例自己的 RPC 完成。
- 2026-10-27：DSH Hub 检测返回同次 `/api/state` 的客户端请求耗时，异常交由 UI 以固定安全文案显示。
- 2026-10-27：DSH Hub HTTP 错误仅向 UI 返回状态码属性用于 401/403 分类；错误消息不包含响应原文或凭据。
# 变更记录

- 2026-10-30：Web/Electron host 读取已选择的 `tether.hub`，仅向匹配 Hub 地址添加 Bearer，并将其作为唯一请求候选；连接探测使用相同的已选地址与凭据。
- 2026-10-30：本机 surface 继续使用 host 本地 API 地址，远端 surface 使用已选 Hub；普通网络 fallback 不会因请求代次递增而被误锁定。

- 2026-10-28：DSH Host 接收 bundle 内嵌插件版本，供本机更新卡在 RPC 失败时仍显示实际运行版本。
- 2026-10-29：DSH host 新增 `surfaceBase(isLocal)`：本地设备的 surface 描述符先问本机 APP 服务（18892），其余仍走 API base 列表；web/electron host 的 `surfaceBase` 保持同源。
- 2026-10-30：DSH Composer 的默认隐藏文件输入点击改进入当前会话的远端工作区选择器；原生文件选择器保留为显式“本机文件…”入口。owner RPC 身份、会话工作区 capability 与原始字节校验继续限定远端选择。

- 2026-10-30：DSH Composer slot 按原生 session-maybe contract 注入 sessionId；新草稿选择目标文件时调用官方 uiWorkspace.startSession 创建空会话，并在新 session 挂载后自动续开远端 picker。缺少工作区时显示提示，不静默回退本机文件对话框。

- 2026-11-10：Electron host 增加 targetId-only openDshSurface 窄桥，供远端 NativeSurface 使用。
- 2026-11-12：Electron host 暴露已有 `tetherApp.info()` 只读桥给 About 使用，直接展示当前 APP 版本，不增加 IPC。
