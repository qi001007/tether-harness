# 原生 DSH 页面接入

## 架构

Tether 将目标设备当前运行的 DeepSeek Harness Host 页面嵌入客户端，并通过 Node 与 Controller 转发 HTTP 和实时连接。目标 Host 保持唯一的模型执行与会话写入权威；Tether 不另建 SDK 会话。目标设备安装兼容的 DSH 插件与 Node 后，才可提供此页面。

目标 Host 提供模型选择、会话权限、文件引用、附件及轨迹界面。Tether 文件管理策略与 DSH 会话权限是不同边界；节点只转发到经验证的本机 Host 连接，不接受浏览器任意指定 URL。连接凭据不得返回浏览器或进入日志。

## 验收要求

- 显示的会话必须来自目标 Host；不能以另一会话或静态历史冒充。
- 设备切换、断线及 Host 重启后不得串设备或让过期响应覆盖当前页面。
- 文件引用与附件使用目标端实际数据和处理结果；界面可见不能代替成功发送证据。
- 传输大小与失败边界须明确；超限应返回可理解的错误。
- 跨设备支持须在目标节点安装兼容版本后单独验收。

## 实时事件转发

`GET /plugins/events` 通过独立 `http_stream_open/read/close` Node RPC 转发 SSE。Node 在固定的本机 DSH Host 上建立同源认证请求，由有界异步读取器按最多 48 KiB 的块读取；每个设备最多 8 条流，读取轮询最多等待约 1 秒，90 秒没有读取轮询时自动关闭空闲流。活动浏览器每轮轮询续期，因此静默但仍连接的 SSE 不会按固定时长中断。Controller 以 `StreamingResponse` 逐块写回，浏览器断开或请求结束时关闭 Node 流。该路径只接受 GET 和 `Accept: text/event-stream`，不缓冲到 EOF，也不向浏览器暴露 DSH Cookie。

## 当前状态

已完成本机 DSH Host 页面与 Node 转发的部分桌面验证，包括页面、模型列表、权限菜单、目标文件引用和既有轨迹的展示。该验证不代表模型发送、附件传输、独立安装或跨设备验收通过。目标节点更新和双设备验收仍未完成。

旧逐项过程与本机 QA 记录已移至仓库外维护备份。公开状态见 [PROGRESS.md](PROGRESS.md) 和 [FEEDBACK.md](FEEDBACK.md)。
