# Tether 演示视频（2–3 分钟）分镜与旁白

目标：让看视频的人 30 秒内明白"我在桌面上和 Agent 对话，任务在另一台电脑上真实执行"；
2 分钟内看到本地 Agent、远端 Agent、取消、继续四件事。

## 录制前检查

- 桌面：`desktop/tether-app.ps1` 已启动，Edge 窗口标题是 `Tether`。
- 桌面 UI 左侧能看到 `DESKTOP-LOCAL`（local）和 `LAPTOP-01`（peer），两个都是 online。
- 笔记本：`laptop/tether-node.ps1` 正在运行；笔记本浏览器打开 `http://127.0.0.1:18893`。
- 桌面点一次 `+ New chat`，让对话从干净状态开始。
- 录屏工具：OBS 或 Win+G；1080p；如果只能录桌面，笔记本画面用手机拍一小段也可以，不要伪造。

## 分镜

### 0:00–0:15 开场

画面：桌面 Tether 窗口，左侧两个 Agent，右侧是聊天框。

旁白：
> 这是 Tether，一个多设备的 Agent Harness 客户端。每台电脑跑同一个 Agent；我可以在这里和本机 Agent 对话，也可以把任务交给另一台电脑上的 Agent。

### 0:15–0:50 本地 Agent

在 `DESKTOP-LOCAL` 下输入：

> 用 pwsh 在当前目录建 demo.txt，内容 OK，然后读回来告诉我。

画面：
- 用户消息气泡；
- thought 卡片；
- `tool/call pwsh`；
- `tool/result`；
- assistant 最终回答。

旁白：
> 本机的 Agent 已经在跑。它调用 pwsh 建文件、读回来；工具调用和结果都在同一个对话里。

### 0:50–1:30 远端 Agent（核心）

左侧切到 `LAPTOP-01`，输入：

> 用 pwsh 在 D:\tether-node\work 建 laptop-demo.txt，内容 OK，然后读回来。

画面：
- 桌面聊天窗口实时出现工具卡片；
- 镜头切到笔记本：终端/本地控制台 `127.0.0.1:18893` 同步滚动，显示同一个任务；
- 桌面上出现最终回答。

旁白：
> 这条任务没有在桌面执行，而是通过 Tailscale 发到笔记本；笔记本上的 Agent 用它自己的 pwsh 和工作区执行。笔记本只主动外连，没有开入站端口。

### 1:30–2:00 取消 + 继续

在 `LAPTOP-01` 输入：

> 运行 python -c "import time; time.sleep(120)"，等它结束。

等 tool 卡片出现后点 `Cancel run`。

画面：
- 状态从 running → cancelling → cancelled；
- 笔记本终端显示任务结束；
- 如果方便，切到笔记本任务管理器/命令行展示没有残留 python 进程（可选）。

然后同一会话输入：

> 刚才那个命令是干什么的？一句话。

旁白：
> 取消不是把网页关掉：节点会终止整棵进程树，残留为 0；同一会话还能继续提问。

### 2:00–2:30 收尾

画面：DESIGN.md 的 "Verified / Designed / Not implemented" 表，或 GitHub 仓库首页。

旁白：
> 当前 v0.1 是星型控制面，已经把远端真跑、断线重放、幂等、取消和继续跑通；对等 Agent 网络是 v0.2 的设计目标，边界在 DESIGN.md 里写清楚了。代码和证据在 GitHub。

## 旁白原则

- 一句话说清"谁在哪台机器上做了什么"。
- 不读代码；不堆术语；不承诺没做的功能。
- 每个演示动作都对应真实事件，不剪辑伪造结果。

## 备用镜头（如果某个动作卡住）

- 远端任务失败：切回 `DESKTOP-LOCAL` 演示同样的工具流，并在旁白说明"远端链路本次未成功，证据在仓库"。
- 取消没有及时收敛：展示 `evidence/cancel_probe.json` 的 `residual_count: 0`，说明这是脚本实测。
- 笔记本画面不方便录：只录桌面，最后用 3 秒展示笔记本本地控制台的照片/录屏。