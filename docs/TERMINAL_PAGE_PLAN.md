# 远程终端页

2026-11-03。目标：在 Tether UI 里选一台在线设备，开一个持久 shell，直接执行命令并看输出；不要求用户去另一台机器手工输入。

## 入口与布局

- 左侧活动栏新增“终端”，与原生工作区/文件资源管理器/文件转移/互联同级。
- 顶部：设备选择、连接状态、启动/停止按钮；下方显示当前 shell 与 cwd。
- 主体：等宽输出区（`pre-wrap`，自动滚到底），占满剩余高度；底部输入行，Enter 发送，↑/↓ 暂不做历史。
- 空态：说明“选择设备后新建终端；命令以目标节点用户身份执行”。

## 数据与状态

- `fs/terminal_start` → `session_id`；`fs/terminal_write`（base64 命令）；`fs/terminal_poll`（`since` 字节偏移）；`fs/terminal_stop`。
- 仅 owner 可调用；终端运行在目标 Node 的进程用户下，不自动提权；输出上限 512 KB/会话。
- 轮询 200 ms；页面不可见时暂停；`closed` 后自动停止并保留最后输出。
- 切换设备/停止时关闭旧会话，避免孤儿 shell。

## 验收

- 在 DESKTOP 选 LAPTOP，启动后执行 `hostname`、`Test-NetConnection`、`curl`，输出可见；
- 停止后端口/会话关闭；刷新页面不会自动重开；
- 非 owner 调用被 Hub 拒绝；
- 输出区不因加载/刷新改变布局；
- 需要管理员权限的命令明确失败，不静默提权。

## 验收结果（2026-11-03，0.2.96 源码）

- 真机 Electron 窗口：活动栏“终端”→ 选 `LAPTOP-01` → 新建终端，状态“已连接”，cwd `D:\Tether\deploy\tether-app-0.2.3\work-local`。
- 单次发送 `Get-Random` 只显示一行随机数（`1130607955`）；Enter 发送 `echo enter-ok` 只显示一行。
- 点“停止”后状态回“未连接”、输入禁用；既有输出保留。
- 过程中发现并修复：200 ms 轮询在公网 RTT 下会并发重入，同一输出块被追加 3–6 次；加 `inFlight` 单飞行闸后复测为一行。修复在 `terminal-page.js`，需同时重建 `lib/client.js` 与 `web/dist/app.js`。
- 仍需补：非 owner 端到端拒绝（后端单测已覆盖）、管理员命令失败提示的真机截图。

## 非目标

- 不做分屏、标签、命令历史、文件上传；这些后续再加。
- 不替代 DSH 的 Agent 会话；终端是原始 shell。