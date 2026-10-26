# Tether 演示视频（2–3 分钟）分镜与旁白

目标：30 秒内让看的人明白——**交互端是 DeepSeek Harness 桌面 APP，Agent 自己用 Tether 把任务派到另一台电脑**；不是换一个聊天框。

## 录制前检查

- DeepSeek Harness 桌面 APP 已打开，登录 DeepSeek 账号，选中默认工作区。
- `~/.dsh/profiles/desktop/cordis.patch.yml` 里已有 `mcp-tether`（`desktop/install-mcp.ps1`）。
- Tether 控制面在跑：`desktop/tether-app.ps1`（它的窗口只作监控，可最小化）。
- 笔记本 `laptop/tether-node.ps1` 在跑；笔记本浏览器打开 `http://127.0.0.1:18893`。
- 在 DeepSeek 里点"新会话"，从干净对话开始。
- 录屏 1080p；如果只能录桌面，笔记本画面用手机拍一小段，或最后用它的本地控制台截图。

## 分镜

### 0:00–0:15 开场：这就是 DeepSeek

画面：DeepSeek Harness 桌面 APP，左侧"新会话/插件/自动化任务"，中间是正常的 DeepSeek 对话输入框。

旁白：
> 这是 DeepSeek Harness 的官方桌面端，交互端没有换，记忆、技能、插件市场都还是 DeepSeek 的。Tether 只是给它加了几个跨设备工具。

### 0:15–0:45 让 Agent 看见设备

输入：

> 用 Tether 列出当前已接入的设备，并告诉我哪台在线。

画面：DeepSeek Agent 调用 `mcp__tether__list_peers`，回答表格：

| 设备 | 在线 | 工作区 |
|---|---|---|
| DESKTOP-LOCAL | 在线 | `E:\...\work-local` |
| LAPTOP-01 | 在线 | `D:\tether-node\work` |
| TAILSCALE-TEST | 离线 | — |

旁白：
> Agent 自己发现有三台设备、两台在线；这一步是 Tether 的 MCP 工具，不是 DeepSeek 内置的。

### 0:45–1:40 让 Agent 派活给另一台电脑

输入：

> 让 LAPTOP-01 的 Agent 在 D:/tether-node/work 建 tether-delegated.txt，内容 OK，然后读回来告诉我绝对路径和内容。

画面：
- DeepSeek Agent 调用 `mcp__tether__remote_task`；
- 回答里出现 run id、绝对路径、内容、只读校验结果；
- 镜头切到笔记本本地控制台 `127.0.0.1:18893`，看到同一个任务；
- 笔记本文件资源管理器打开 `D:\tether-node\work`，`tether-delegated.txt` 存在。

旁白：
> 这条任务没有在桌面执行；它通过 Tailscale 到了笔记本，笔记本上的 dsh Agent 用自己的 pwsh 和工作区执行。两次调用都在同一个 dsh 会话里，所以目标端是持久会话，不是一次性脚本。

### 1:40–2:10 继续 + 取消（选一个）

继续输入：

> 让 LAPTOP-01 再读一次这个文件，确认内容还是 OK。

画面：Agent 复用同一个 `dsh_session`，不需要重新建会话。

或者取消：
- 让 LAPTOP-01 跑 `python -c "import time; time.sleep(120)"`；
- 在 Tether 监控台点 cancel，或让 Agent 调 `remote_cancel`；
- 画面：状态 `cancelling → cancelled`；监控台显示残留进程 0。

旁白：
> 取消不是关网页：节点会终止整棵进程树；证据在仓库的 `cancel_probe.json`，残留为 0。

### 2:10–2:40 收尾：Agent 是主体，Tether 是工具

画面：Tether 监控台（设备/任务/事件），然后 GitHub README/DESIGN 的边界表。

旁白：
> 当前 v0.1 是星型：桌面 DeepSeek Agent 发起，笔记本被控；对等 Agent 网络是 DESIGN.md 里的 v0.2，边界写清楚了。代码、MCP 配置和实测数字都在 GitHub。

## 旁白原则

- 一句话说清"谁在哪台机器上做了什么"。
- 不读代码、不堆术语、不承诺没做的功能。
- 每个动作对应真实事件，不剪辑伪造结果。

## 备用镜头

- 远端任务失败：展示 `list_peers` 和监控台的任务状态，说明链路；不要把失败剪成成功。
- 笔记本画面不方便录：只录 DeepSeek 桌面，最后用 3 秒展示笔记本本地控制台照片/录屏。
- 如果取消没及时收敛：展示 `evidence/cancel_probe.json` 的 `residual_count: 0`，说明这是脚本实测。