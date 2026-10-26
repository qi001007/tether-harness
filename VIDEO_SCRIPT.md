# Tether 演示视频（2–3 分钟）分镜与旁白

目标：30 秒内让看的人明白——**交互端是 DeepSeek Harness 桌面 APP；Tether 插件页能直接看到目标机 Agent 的对话、推理和工具调用，也能发起新任务**。不是换一个聊天框，也不是 iframe。

## 录制前检查

- DeepSeek Harness 桌面 APP 已打开，登录，侧栏能看到 `Tether`（`desktop/install-plugin.ps1`）。
- `~/.dsh/profiles/desktop/cordis.patch.yml` 里已有 `mcp-tether`（`desktop/install-mcp.ps1`）。
- Tether 控制面在跑：`desktop/tether-app.ps1`（它的窗口只作监控，可最小化）。
- 目标机（桌面或笔记本）有 `~/.dsh/sessions` 原生会话；没有也能演示 Tether 任务对话。
- 笔记本 `laptop/tether-node.ps1` 在跑；笔记本浏览器打开 `http://127.0.0.1:18893`。
- 在 DeepSeek 里点"新会话"，从干净对话开始。
- 录屏 1080p；如果只能录桌面，笔记本画面用手机拍一小段，或最后用它的本地控制台截图。

## 分镜

### 0:00–0:15 开场：这就是 DeepSeek

画面：DeepSeek Harness 桌面 APP，左侧"新会话/插件/Tether/自动化任务"，中间是正常的 DeepSeek 对话输入框。

旁白：
> 这是 DeepSeek Harness 的官方桌面端，交互端没有换，记忆、技能、插件市场都还是 DeepSeek 的。Tether 以官方插件和 MCP 工具的形式接进来。

### 0:15–0:55 插件页：目标机的原生对话

画面：
- 点侧栏 `Tether`，左侧出现设备和项目；`default-workspace` 下的 `Tether 查看在线设备` 是目标机 DSH 的原生会话；
- 中间展示同一条对话：右侧用户气泡、可展开的"思考"、`mcp__tether__list_peers` 工具卡片、最终回答和表格；
- 切到 `LAPTOP-01`，选一条已有的 Tether 任务，展示同样的对话布局：思考 → `pwsh` 工具 → 只读校验回答。

旁白：
> 这里不是任务列表，是目标机 Agent 的对话本身。原生 DSH 会话从目标机的 session 日志读出来，按 DSH 的消息结构还原；推理、工具调用、结果和最终回答都在。原生会话目前只读，不会写坏目标机正在进行的对话；输入框发消息会在同一工作区新建 Tether 任务。

### 0:55–1:15 文件与三档权限

画面：
- 点"文件"标签，打开 `D:\TetherWorkspaces\demo\hello.txt`，编辑并保存；
- 点"权限设置"，展示 `默认只读` / `锁定` / `全盘读写` 三档、可写根目录、审计表；
- 指出一条 `write · ok` 和一条 `denied`（`C:\Windows` 或凭据读取）。

旁白：
> 文件走目标机 Node 的 OS 文件服务。默认只读：全盘可读，写只允许项目根和已有 DSH 工作区；锁定档全部只读；全盘读写要显式二次确认，系统目录和凭据仍然拒绝。每次写入和删除都有 intent/result 审计，删除进 `.tether-trash`。

### 1:15–1:45 让 Agent 看见设备

输入：

> 用 Tether 列出当前已接入的设备，并告诉我哪台在线。

画面：DeepSeek Agent 调用 `mcp__tether__list_peers`，回答表格：

| 设备 | 在线 | 工作区 |
|---|---|---|
| DESKTOP-LOCAL | 在线 | `E:\...\work-local` |
| LAPTOP-01 | 在线 | `D:\tether-node\work` |
| TAILSCALE-TEST | 离线 | — |

旁白：
> 插件页是给人看的；MCP 是给 Agent 用的。Agent 自己发现有三台设备、两台在线，这不是 DeepSeek 内置能力。

### 1:45–2:25 让 Agent 派活给另一台电脑

输入：

> 让 LAPTOP-01 的 Agent 在 D:/tether-node/work 建 tether-delegated.txt，内容 OK，然后读回来告诉我绝对路径和内容。

画面：
- DeepSeek Agent 调用 `mcp__tether__remote_task`；
- 回答里出现 run id、绝对路径、内容、只读校验结果；
- 镜头切到笔记本本地控制台 `127.0.0.1:18893`，看到同一个任务；
- 笔记本文件资源管理器打开 `D:\tether-node\work`，`tether-delegated.txt` 存在。

旁白：
> 这条任务没有在桌面执行；它通过 Tailscale 到了笔记本，笔记本上的 dsh Agent 用自己的 pwsh 和工作区执行。两次调用都在同一个 dsh 会话里，所以目标端是持久会话，不是一次性脚本。

### 2:25–2:50 收尾：Agent 是主体，Tether 是工具

画面：切回 Tether 插件页的对话页，然后 GitHub README 的边界表。

旁白：
> 当前 v0.1 是星型：桌面 DeepSeek Agent 发起，笔记本被控；对等 Agent 网络和原生会话写回是 DESIGN.md 里的下一阶段，边界写清楚了。插件、MCP 配置、实测数字和截图都在 GitHub。

## 旁白原则

- 一句话说清"谁在哪台机器上做了什么"。
- 不读代码、不堆术语、不承诺没做的功能。
- 每个动作对应真实事件，不剪辑伪造结果。

## 备用镜头

- 远端任务失败：展示 `list_peers` 和任务状态，说明链路；不要把失败剪成成功。
- 笔记本画面不方便录：只录 DeepSeek 桌面，最后用 3 秒展示笔记本本地控制台照片/录屏。
- 如果取消没及时收敛：展示 `evidence/cancel_probe.json` 的 `residual_count: 0`，说明这是脚本实测。
- 笔记本 Node 未升级时，文件页和原生会话只演示桌面节点；README 已注明升级路径。
