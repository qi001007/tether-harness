# 实时进度

## 2026-11-07 APP 稳定性候选

| 业务 | 已验证 | 待验收 |
| --- | --- | --- |
| APP / Node 更新 | 原发行签名 0.4.4 已经生产 Hub 分发；主机 APP+Node、笔记本 Node、云端 Node 均已实际升级并在线。云端通过兼容基线迁移后走普通更新 RPC；笔记本首次失败因 Codeg 可执行文件被旧进程占用，回滚保持在线，停止确认空闲的 runtime 后重试成功。 | 笔记本另有一套 APP 0.3.1 与独立 Node 分离安装，需升级其 APP 并避免双 Node 抢占；更新完成还需逐页业务验收。 |
| DSH / 传输 | 0.4.4 隔离 APP 已连接三台真实设备。主机和笔记本的 DSH 输入区与搜索框就绪。云端测试消息已送达并写入目标 DSH 会话，两次隔离冷启动均通过鉴权。六方向 2 MiB 直连传输及两台 Windows 设备间双向 100 MiB 流水线传输均通过 SHA-256，后者分别为 3.69 和 3.77 MB/s。云端直写为 0.05–0.057 MB/s，同方向 SSH 直传约 0.094 MB/s。主机至云端的 EasyTier 链路采样 719 ms、14% 丢包。 | 配好云端 DSH 模型凭据后复测回复。验证 Windows 一键冷启动和 iPhone 真机映射，复测云端私网及 relay 大文件传输。 |
| 多 Agent | 主机日常入口 APP 0.4.4 已实际显示 Codeg Agent 列表和原有会话，截图已留存。重启后未运行的 EasyTier 已恢复，并补充本账户登录启动与存活维护。既有隔离 APP 委派、父子历史和 Herdr 双项目证据保留。 | 缺失设备网络时的明确错误/重试、更新旧错误清理和资源首次失败重试已修源码，待下一批签名包；生产跨节点 Herdr 与 iPhone 仍待验收。 |
| DSH 插件 | 0.2.93 官方签名、哈希和当前 DSH CLI 的独立安装通过，包含 DSH、资源管理器和设备网入口。新版 Node 内嵌 39 个原始插件文件，并在统一清单中引用原版资产。 | 用当前已登录的 DSH 宿主和 Node 验证三个插件入口及 iPhone 映射。 |

云端 DSH Web 在两个全新 Cookie 会话中均完成 303 跳转和授权，并返回 HTTP 200 及启动页面。此前的 401 出现在探测器跟随跳转时丢弃 Cookie 的情况下。隔离 APP 中「打开工作区」入口已恢复。云端隔离 Codeg 已验证可与现有 DSH 网关并存，并通过私网端口上的带令牌健康检查。

云端 DSH 本机随后复现 TCP 已连通但 HTTP 无首包。主线程处于 cgroup 内存回收等待，软阈值 300 MiB，`memory.events` 的 `high` 已超过 320 万。把线上 DSH Web 的 `MemoryHigh` 调到 384 MiB，保留 600 MiB 硬上限。恢复验证通过后保存同一值到 systemd 持久配置，读回核对了进程 ID 和重启次数。主机经私网约 0.21 秒收到未登录请求的 401。真实 APP guest 完成同源 303、Cookie 和 200 启动页面，约 5.6 秒显示工作区选择页。DSH Web 安装模板使用同一内存阈值。

云端使用独立网络命名空间和测试 Hub 演练 0.3.6 → 官方签名 0.4.2 → 0.3.6。测试节点重连复用了注册令牌和 SQLite 文件，每一步都读回相同的工作区 SHA-256。线上主机 APP/Node 0.4.3、笔记本 Node 0.4.2 和云端 Node 0.3.6 均在线。

现有私有 Croc 11.6.3 relay 上的独立双向 4 MiB 测试均通过 SHA-256。主机到云端约 0.054 MB/s，云端到主机约 0.60 MB/s。主机和云端均配置了 Croc relay，笔记本未配置。云端慢速有明显方向差异，主机上传在 Croc 和二进制直写下都偏慢。

云端隔离 Herdr 0.9.5 使用与候选相同的二进制摘要，两个项目均通过真实 PTY 启动。会话名独立，在各自 pane 执行 `pwd` 的结果与项目目录匹配。Codeg 的真实后端创建 ACP 会话，APP 收到同一连接的 WebSocket 事件，编辑器连接状态和目录均正确。早先的「连接中」是验收脚本误找表单提交按钮。两次界面提交分别因错误完成判据和观察脚本语法异常被提前结束，SQLite 均无持久化子任务，当前仍以 CLI 的完整委派作为独立证据。

隔离工作树的发行元数据已设置为 APP 和 Node 0.4.4、冻结插件 0.2.93。0.4.4 预览清单尚待发行签名。更新器试装使用临时测试密钥和回环下载地址，覆盖 APP 与 Node 同时准备和 Node 单独准备，验证已安装的测试插件仍为 0.2.93。发布与真实设备验收见 [反馈](FEEDBACK.md)。

0.4.4 候选全量回归通过 269 项 JavaScript 测试、8 项 CommonJS 测试。Python 全量回归通过 248 项、跳过 2 项。APP 更新中心实渲染和三台设备 DSH 路由检查通过。APP 与 Node ZIP 已用当前源码打包，通过更新器预检、产物哈希和临时签名的隔离安装。候选清单待正式发行签名。

续验的基础源码已锁定在本地 `candidate/0.4.4-stability` 的 `a502bab9`。从该提交导出的干净目录重新打包，APP 的 1173 个和 Node 的 1126 个归档成员与原预览逐项匹配，文本换行符归一后内容一致。远端 `main` 仍为 0.2.29，0.4.4 候选尚无远端引用可供签名工作流构建。

重打的 Node 0.4.4 ZIP 内安装脚本通过 Bash 语法检查，并在隔离的 Ubuntu WSL 用原样脚本完成安装。另用回环 HTTP 镜像在 128 KiB 后中断第一次下载。安装器第二次取全 135,721,347 字节，校验 ZIP 后从中文路径安装成功。验收脚本核对了落盘 ZIP 的 SHA-256。两个新环境均读到 `tether-harness` 0.4.4，成功导入 Node，在指定目录运行 Bash PTY 并读回命令输出，内嵌 Herdr 报告 0.9.5。清单中的插件条目与 0.2.93 官方签名清单完全一致。

发行工作流可从 `release-candidate/vX.Y.Z` 构建并保留签名候选包。正式发行草稿由版本标签或 main 手动流程生成。从官方 Herdr v0.9.5 资产在空目录恢复了 8 个运行时文件，共 106,307,290 字节，均与当前候选中的文件哈希一致。再次运行没有替换文件。GitHub runner 已完成干净构建与正式签名。

最新候选全量回归为 Python 260 项通过、2 项跳过，JavaScript 269 项与 CommonJS 8 项通过。初次全量复跑暴露了 Git Bash 测试的中文路径编码和符号链接兼容问题。修正测试环境后，在相同中文临时根目录重新通过。

主机与云端重新验证了真实 4 MiB 私网双向传输和清理。主机到云端约 0.056 MB/s，云端到主机约 1.125 MB/s，均通过 SHA-256。云端 EasyTier TCP 采样接收增量约 53 KB/s，与 APP 数据面上传同量级。历史 GitHub Linux、macOS 和 Windows 干净安装任务均在下载 0.3.6 镜像时断流，未进入导入和终端验收。本次从主机完整读取镜像的 76,539,292 字节，约 15.3 秒且与服务器文件哈希相同。GitHub runner 仍需复验。

同尺寸公网 SSH 对照中，4 MiB 上传约 1.323 MB/s、回读约 0.949 MB/s，均通过 SHA-256。这次的主要降速出现在私网的主机到云端方向。

使用同一 SSH 服务和同一份 2 MiB 随机数据，在两条路径交替上传。EasyTier 两次为 0.052 和 0.055 MB/s，公网 SSH 同轮为 0.839 和 0.095 MB/s，四次上传的 SHA-256 相同。两条路径的单次下行分别为 0.293 和 0.883 MB/s。公网也有时段波动。绕开 Tether 文件接口后，私网上传仍复现了慢速。

Ubuntu WSL 的临时 EasyTier 客户端复现了 TCP 80 拥塞。外层 TCP 累计重传约 382 KB 时，隧道内 SSH 采样 RTT 达 17.3 秒。首轮测试的 WSL 转发方式也给公网对照带来额外延迟，因此用本机回环转发重测同一份 512 KiB 数据。现网 Windows EasyTier 路径为 0.096 MB/s，公网对照前后为 0.081 和 0.238 MB/s，隔离 TCP 80 为 0.017 MB/s，均通过 SHA-256。隔离 WSS 443 建连后上传超过 42 秒观察窗口，TCP 80 的第二次隔离测试遇到本机转发 banner 连接失败。已有 UDP 11010 入口在约 20 秒内未建连。暂时没有证据支持切换现网传输方式。临时实例和路由已清理，主机、笔记本和云端均在线。

在实际隔离 Electron、Tether 网关和 Codeg 中，确定性 ACP 测试 Agent 通过 `@` 选择、提交、Codeg MCP 委派和等待状态，拿到了任务 ID、`completed` 和精确子回复。SQLite 的父子关联和各自的 ACP transcript 已读回同一结果。这项测试没有模型服务请求。

隔离 APP 复现了历史会话遮挡问题。侧栏已经选中持久化会话，Agent 主页仍覆盖右侧内容。修复后，主页默认只显示在新建会话。验证时从会话菜单关闭原标签，再从侧栏重开同一父会话，读回原任务 ID、`completed` 和精确子回复。展开父会话的子列表，独立打开子会话并读回精确回复。源码重新完成 TypeScript 检查和静态导出。

修复后的 APP 和 Node 0.4.4 预览已重打。两个包分别核对了实际通过界面测试的 1,026 个 Codeg 前端文件，SHA-256 逐项一致。冻结插件清单条目与官方 0.2.93 完全一致。JavaScript 回归 277 项和 Agents 运行时、网关、发行归档的 Python 回归 24 项通过。

隔离 APP 还用真实 Codex 父会话完成了委派。首轮停在权限卡，脚本遗漏了 `Allow` 单次授权文案。修正后仅单次允许测试委派和状态查询，APP 显示任务 `5aa2a20b-2d1c-40f3-b381-749cef7e4b32`、`completed`、`QA_CHILD_REPLY_OK`。SQLite 的子会话关联同一任务，子会话 transcript 读回精确回复和 `end_turn`。本次子端为本地确定性 ACP。

另一轮实测从真实 Codex 委派给 OpenCode 2.2.0，子端通过回环 Ollama 调用本机 Qwen2.5-Coder 1.5B。APP 显示 `b19a11b2-e76a-4f03-85ef-b30b96fd9fda`、`completed` 和 `TETHER_CROSS_OK`。Codeg 的子会话关联同一个任务 ID，OpenCode 原生数据库按子会话 ID 读回精确回复，原生结束状态为 `succeeded`。一次模型接口请求返回 HTTP 400，随后有两次 200。测试使用独立配置、回环端口与已安装模型。Qoder 当前未登录。OpenCode 1.19.5 虽可启动原生终端，Codeg 的结构化入口明确拒绝该版本。

Agents 主页复用 Codeg 的版本判断。实际隔离 APP 检测到 OpenCode 1.19.5 时显示「仅终端」，结构化按钮禁用并说明 2.x 要求。检测到 2.2.0 时，终端和结构化按钮均可用。同一份前端静态导出再次通过关闭、重开父子历史的界面回归。

包含版本提示修复的 0.4.4 APP 和 Node 预览已重打。两个 ZIP 中的 1,026 个前端文件与实际测试导出逐项通过 SHA-256，Node 内安装器保持 LF，冻结插件条目与官方 0.2.93 完全相同。最新 JavaScript 回归 277 项通过。

现网三端均报告 Herdr 可用，但均未声明项目会话能力。已核对笔记本 0.4.2 对项目请求仍使用共享 `tether` 会话。云端 0.3.6 的隔离探测中，旧 Node 还忽略了显式终端命令，只返回普通 PTY。测试会话与目录已清理，云端 Node 的 PID 和重启计数未变化。

项目 Herdr 现先检查 Node 能力。隔离 APP 回放实际笔记本清单时显示升级提示，未发出启动请求。模拟节点升级后重试，APP 重新读清单，并提交原项目目录和隔离标记。另在真实云端主机的独立网络命名空间注册 0.4.4 候选 Node，验证能力字段及失效项目拒绝，并通过 Node WebSocket 的终端接口启动两个不同的 Herdr 会话。两个 pane 都从各自的工作目录回显 `pwd`，两个测试服务均关闭。现场 APP 经生产 Hub 打开已升级远端 Herdr 仍待验收。

0.4.4 两个预览包已包含 Herdr 修复，新增归档差异逐项核对 SHA-256。JavaScript 277 项通过，终端 Python 回归 6 项通过、1 项跳过。插件清单条目仍与官方 0.2.93 一致。

云端隔离 Node 经实际 WebSocket 更新接口完成 0.4.2 → 0.4.4，基线使用官方签名，候选清单使用临时测试签名。写入版本记录前注入故障，回滚恢复全部 1,118 个基线文件的 SHA-256。旧更新器因保留备份目录，重用同一暂存标识返回 `apply_failed`。重新暂存后安装 1,124 个文件，Node 自动重连并声明项目 Herdr 可用。重连前后设备注册令牌、SQLite 文件及记录、工作区读回和列表均一致。另用候选 ZIP 自带的更新器安装合成测试包，验证回滚后可重用同一个暂存标识，并保留失败那次的备份。

隔离 APP 经现网私网映射打开云端专用测试工作区。原生 DSH 页面显示输入框，实际发送按钮提交了验证消息。目标宿主的会话归档包含该消息、`turn/start` 和 `turn/end`，结束原因是模型缺少 API key，未产生助手回复。另使用两个全新的隔离配置启动云端同一套 DSH Web 运行时，分别在 4.50 和 4.05 秒收到鉴权后的 200 启动页，均通过未授权 401、带 Cookie 的 303 和重定向后移除凭据参数的检查。现网 DSH Web 和 Node 的进程号与重启计数保持原值。

在干净的 Ubuntu WSL 环境从 Codeg 固定提交重放完整补丁。Node 24.12.0、pnpm 11.9.0 锁定依赖、Next 构建和 TypeScript 检查均通过，生成 1,019 个静态文件。加上 Tether 的原生令牌入口后，真实隔离 APP 使用这批新文件打开 Agents，验证项目名、输入框、`@` 选项和选中状态。用候选提交 `d9b6c6d8` 重打的两个预览包中，全部 1,020 个 Codeg 文件的 SHA-256 与实测输出一致，且冻结插件条目与官方 0.2.93 一致。

远端候选分支 `release-candidate/v0.4.4` 的提交 `6bcb757d` 由源码重建生成文件，源码树与本地预期逐项一致。签名构建 42332813756 全部通过，Python 260 项通过、2 项跳过，JavaScript 278 项通过。下载的签名候选包使用原发行公钥验签成功，APP 和 Node 的摘要与清单一致，插件条目仍为官方 0.2.93。GitHub 生成的 Codeg 前端也已在真实隔离 APP 中验证输入框和 `@` 选择。候选仅保留在 Actions 构建产物中。

云端从构建产物存储直接取得完整 271,746,278 字节的签名归档，约用 8.4 秒，外层 SHA-256 一致。独立网络命名空间的 Node 从官方 0.4.2 经正常镜像更新接口安装原样签名的 0.4.4。注入提交故障后恢复 1,118 个原文件，重新暂存后升级并自动重连。原注册令牌、SQLite 文件及记录、工作区字节和列表保持一致，项目 Herdr 能力就绪。该演练使用原发行公钥，安装后逐项核对了 1,020 个 Codeg 文件。

Windows 10:46 异常重启后，主机 Node 未运行。通过原安装的开始菜单入口恢复，Hub 确认三台在线，主机和笔记本均为 Node 0.4.2，云端为 0.3.6。隔离测试曾改写桌面快捷方式，原入口已恢复。候选 APP 现在保留其他有效安装的快捷方式，隔离测试禁用快捷方式写入。JavaScript 回归 278 项通过。

从候选 APP 的 Hub 路径点击主机“启动 DSH”后，目标进程成功启动，但映射页面在加载和 iframe 之间切换，70 秒内未出现可用输入框，并观测到两次 Node 心跳超时重连。本机原 APP 的直连描述请求约 32 毫秒返回，原生宿主启动页返回 200。该项仍需按跨节点映射问题修复。

## 2026-11-07 工作区清理与接手基线

- 旧原型、调试截图、历史构建包和维护备份已移到工作区外的本地清理归档。旧版 `PROJECT-REPORT.md` 是 0.3.6 的交接快照。当前状态以在用源码、[反馈](FEEDBACK.md) 和 [发行记录](RELEASES.md) 为准。
- 保留的复用点：`v0.2.93` 有双机插件更新记录，`v0.2.97` 是 Agents 加入前最后一个已发布版本。两者与当前 APP/Node 的兼容性仍需实测。DSH 更新要以宿主实际加载的版本核对，传输测速要记录同方向、同路径的基线。
- Agents 页已挂载的是 Codeg 工作区和 Herdr 等现有面板。旧 ACP 自绘视图原先未挂载，已移除其渲染代码。Codeg 上游参考为 `v0.42.0`（`e3171d6`），本机改造源码仍在工作区的 `.scratch/agents-runtime-build`。保留现有源文件、构建配置和相关制品，便于复现。

## 2026-11-03 Linux 一键安装（WSL 实测）

1. 新增 `laptop/install-node.sh`：检查 Python>=3.10/venv，下载或读取 Node ZIP，建 venv、`pip install -e`、生成 `~/.local/bin/tether-node` 与 600 权限的 `node.env`；支持 `--check`、`--install-only`、`--archive`、`--version`。
2. WSL2 Ubuntu 实测：`--check` 用 Python 3.10.12 通过；先以 0.3.4 包跑通完整安装，0.3.5 正式发布后又从 tag 的 raw 脚本重跑：下载 0.3.5 Node ZIP、安装全部依赖、生成启动器；安装后的 venv 运行 `TerminalService`，bash PTY、`echo TETHER_INSTALLED_LINUX_OK`、resize 80×20、stop 均通过（无读线程异常）。
3. **0.3.5 已发布**（CI `41684185090`，2026-11-03T17:29:28Z），Node ZIP 内含 `laptop/install-node.sh`，updater 的 `NODE_ALLOWED` 已加入该路径；一键命令：`curl -fsSL https://raw.githubusercontent.com/qi001007/tether-harness/v0.3.5/laptop/install-node.sh | bash -s -- --controller ... --token ...`。
4. 仍未做：完整 VirtualBox/VMware 桌面 Linux VM、macOS 真机、APP 一键生成带 token 的安装命令、系统服务/开机自启。WSL2 是轻量 VM，不等同完整发行版。

## 2026-11-03 Linux/POSIX 终端适配（WSL 实测）

1. WSL2 Ubuntu（Python 3.11.8）直接运行 `TerminalService`：`terminal_shells` 返回 bash/sh 可用、zsh/fish 不可用，默认 bash；`terminal_start` 返回 `pty:true`，`echo TETHER_LINUX_PTY_OK` 输出、`resize` 90×24 均通过。
2. 发现并修复 POSIX 读线程在 `stop()` 时读到 `session.fd=None` 的 `TypeError`：读线程先捕获 fd，`stop` 先置 `closed` 再关闭 fd；Windows 终端测试 6 条回归通过。
3. 新增 `tests/test_terminal_posix.py`（非 Windows 才跑，当前 Windows 上 skip）。下一步仍是用真正的 Linux VM 做一次 Node 安装/连接/终端 UI 端到端，并补一键安装脚本。

## 2026-11-03 传输直连收口

1. `transfer-page.js` 修正 `/fs/direct_info` 的 `{value:{...}}` 解包；本机设备改走 `127.0.0.1`，避免 EasyTier 自环走中继。
2. 100 MB 真机：DESKTOP `work-local` → LAPTOP `C:\Users\14675\Documents\deepseek-harness\default-workspace`，**52 s / 1.92 MB/s**；目标文件 **104,857,600 B** 核对一致。网络记录全程命中 `http://127.0.0.1:18895/fs/read` 与 `http://10.144.0.3:18895/fs/write_chunk`，没有再走 Hub 分块。对照 Hub 中继 0.04–0.06 MB/s。
3. 触发方式：转移页选中源文件 → 底部 `转移到另一侧`。Ctrl+C/V 自动化曾出现未启动队列，不作为验收路径。之前 80 MB `.tether-part` 是修复前旧 bundle/回退留下的，已清理；本轮 10 MB/100 MB 测试文件也已移入两端回收站。
4. 已发布 **0.3.4**（CI `41682125666`，发布于 2026-11-03T17:16:44Z）：包含这两处传输修正；LAPTOP 的 `web/dist/app.js` 已替换为 0.3.4 包内 bundle（8,037,246 B，含 `127.0.0.1`/`direct_info`），下次 APP 重载生效。LAPTOP 的 APP/插件元数据仍是 0.3.1/0.3.0，依赖守卫仍未修。

## 2026-11-03 0.3.3 发布与两机部署

1. `v0.3.3` 已发布：CI **41675286538** success，release id **432954597**，发布于 **2026-11-03T16:35:56Z**；资产 `tether-app-0.3.3.zip` 1,940,850 B、`tether-plugin-0.3.3.zip` 1,377,885 B、`tether-node-0.3.3.zip` 107,621 B。Hub 镜像在约 5 分钟后变为 0.3.3。
2. DESKTOP 真机：APP 加载新 UI，Node 运行 0.3.3 代码；终端 PTY 提示符/命令/中文输出通过，Git Bash 切换通过，右键菜单遮挡与自绘 shell 菜单通过。
3. LAPTOP 部署：app venv 安装 `pywinpty 3.1.2`；因 updater 的 `dependency_change_requires_manual_install` 拦截 pyproject 依赖变化，按错误提示手动把 `tether-node-0.3.3.zip` 的 `terminal.py`/`fs_service.py`/`pyproject.toml` 覆盖到 `D:\Tether\deploy\tether-app-0.2.3`，并把 `version.json` 的 node 标为 0.3.3；通过 Hub `POST /api/devices/LAPTOP-01/node/restart` 重启 Node。真机 `terminal_start` 返回 `pty:true`（120×30），`echo LAPTOP_PTY_OK` 输出成功。
4. LAPTOP 的 APP UI：已从 `tether-app-0.3.3.zip` 直接抽取 `packages/tether-ui/web/dist/app.js` 覆盖到 `D:\Tether\deploy\tether-app-0.2.3`（8,037,010 B，含 `TetherTerminalRuntime` 与 `listbox`），下次 APP 重载/重启后生效；APP/插件元数据仍显示 0.3.1/0.3.0，未强制重启 APP。安装器的依赖守卫仍阻止整包更新，后续需修成可自动安装 Python 依赖或提供显式升级包说明。

## 2026-11-03 原生终端与弹层层级（0.3.3）

1. 终端改为真 PTY：Node `terminal.py` 在 Windows 用 `pywinpty`/ConPTY，POSIX 用 `pty(3)`；`start` 返回 `pty` + cols/rows，新增 `terminal_resize`。PowerShell/PowerShell 7 启动时 `chcp 65001` + 输入/输出 UTF-8，cmd 用 `/K chcp 65001`，Git Bash 用 `-i -l`；无 PTY 后端时保留管道兼容模式。`pyproject.toml` 增加 `pywinpty; sys_platform == 'win32'`。
2. UI 换成 xterm.js（`@xterm/xterm` + FitAddon）。真机 APP 内 PowerShell 提示符 `PS C:\Users\Administrator\Documents\deepseek-harness\default-workspace>` 可见，输入 `echo TETHER_NATIVE` 输出单行；切 Git Bash 后显示 bash 提示符并可执行命令；背景/前景/光标/ANSI 色随 `body[data-ds-dark-theme]` 切换，终端底部黑条已修（viewport 透明）。
3. 终端 dock 外观贴合工作台：顶栏 `#f4f4f5` / 内容白底（暗色 `#252526` / `#1e1e1e`），仅顶部圆角 + 1px 内阴影，去掉粗边框/发送按钮；shell 下拉改自绘菜单（白底/暗底、8px 圆角、阴影、选中勾、`C.blue`），不再使用原生 `<select>`；拖拽调高保留。
4. 遮挡修复：文件悬浮卡不再压右键菜单；打开右键/设备菜单时清除悬浮卡，菜单提升到 `zIndex 120`。真机验证右键后 `[role=tooltip]` 不存在、菜单首个命中元素为“打开”。
5. DSH 原生终端仍未修改；`host.kind === 'dsh'` 隐藏 Tether 终端入口，Tether 终端只在 APP/WebUI 提供。
6. 门禁：`tests/test_terminal.py` 6 条通过（新增 PTY + resize 边界）；`build.mjs --check`、`test_tether_ui_shared.mjs`、真机 Electron 无 renderer 异常。全量 pytest 与 0.3.3 两机部署见后续条目。

## 2026-11-03 终端/Agents/登录体验（0.3.0）

1. 终端并入资源管理器：底部可调高度 dock、目录右键/工具栏入口、cwd=当前目录；移除独立“终端”活动页。真机：`D:\TetherWorkspaces\demo` → PowerShell `Get-Location` 返回同路径；切“命令提示符”后提示符仍在同目录。**DSH 宿主不显示 Tether 终端入口与停靠（`host.kind === 'dsh'` 隐藏），DSH 原生终端未被修改**；Tether 终端只在 APP/WebUI 提供。
2. Node shell 适配：`terminal_shells` 能力 + `terminal_start{cwd,shell}`；Windows 支持 PowerShell/PowerShell 7/cmd/Git Bash，POSIX 预留 bash/zsh/sh/fish；后续 VM 只需补映射。LAPTOP-01 真机返回 PowerShell（默认）/cmd/Git Bash（PowerShell 7 不可用），用 cmd 在 `D:\Tether\deploy\tether-app-0.2.3\work-local` 开会话成功。
3. APP 登录页增加 ×（关闭到托盘）并真机验证；DSH 登录已在真实 DSH 窗口复验：退出 Tether 登录后，登录卡片只占 Tether 面板，DSH 原生侧栏完整保留；随后用账号文件恢复登录。插件热重载到 0.3.0（DSH pid 40564 不变），0.3.1 继续包含该布局。
4. Agents 页：新机器人图标、Codex 2.5.0 品牌块、46 个模型下拉可切换（`session/set_model`）、可点击命令 chip；真机切换 6.1 Sol high→low 成功并写入 `[模型] gpt-6.1-sol[low]`。0.3.1 增加多 Agent 标签：`+` 再开一个会话、标签切换保留各自输出/model/权限、状态点（启动/就绪/错误/结束）、单标签关闭；真机两个 Codex 会话切换与关闭通过。
5. 传输复测：跨网 p2p tcp6 101 ms，100 MB **28.80 s / 3.64 MB/s**；同 LAN 未复现（两端 10.68.x 客户端隔离）。
6. 远程应用 apps.json 小白化按反馈后延；Her/Herdr 调研与 VM 多系统安装测试列为后续。

## 2026-11-03 Agents（ACP）页（0.2.98–0.2.99）

1. Node 新增 `acp.py` 与 `fs/acp_detect|start|prompt|poll|reply|cancel|stop`：按白名单拉起本机 ACP Harness，JSON-RPC 2.0 / ndjson over stdio，协议 1；owner-only。Windows 优先解析 `.cmd/.bat/.exe` 并用 `cmd /c` 启动，避免 npm 无扩展名 shim 的 `WinError 2`。`start` 为异步握手（立即返回 session_id，`ready`/`error` 经 poll 下发），避免远程 Hub fs 请求超时。
2. UI 活动栏新增 Agents：设备检测、Harness 卡片、流式消息、权限请求卡片、停止；消息块按 chunk 拼接，不再每块换行。
3. 真机 DESKTOP `codex-acp`：`initialize` → `session/new` → prompt → `tether-ui-ok` → `end_turn`，全程在真实 Electron APP 内完成，不切窗口。0.2.99 异步启动复验：`[就绪]` → `tether-async-ok` 单行 → `end_turn`。
4. 跨机真机：LAPTOP-01 的 `opencode acp` 由 Hub `fs/acp_*` 通道拉起，`ready`（native `ses_e5e0…`）→ prompt → `tether-open-code-ok` → `end_turn`（input 40274 / output 7 tokens），随后 `stop`；全程未让主人到 LAPTOP 输入。
5. 仍未做：真实工具调用的权限卡片、Gemini/OpenCode/Claude adapter 真机、非 owner 端到端拒绝；计划见 `docs/ACP_HARNESS_PLAN.md`。

## 2026-11-03 远程应用页（0.2.97）

1. Node 新增 `apps.json` 白名单与 `fs/apps_list`：把目标机 `127.0.0.1:<port>` 的 HTTP 服务经 EasyTier 虚拟 IP 转发；只绑 `10.144.0.0/24`，目标只接受回环，文件改动按内容哈希热更新。
2. UI 活动栏新增“远程应用”：设备选择/刷新/应用卡片/工作区内嵌 iframe（刷新、关闭）；DSH 不在此列表，继续走原生工作区。
3. 真机 Electron 验收：`Gateway Demo`（19001）经 `http://10.144.0.2:<ephemeral>/` 内嵌渲染；关闭返回列表；Hub `fs/apps_list` 返回 mesh 与应用 URL。
4. 非目标：不启动应用；GUI 软件属 M3 远程控制；CLI Agent 先用终端页，ACP 后续。

## 2026-11-03 远程终端 + 100 MB 直连

1. Node 0.2.95 新增 `fs/terminal_start|write|poll|stop`：在目标机器上启动持久 PowerShell/bash 会话，输出按字节增量轮询；走现有 Hub fs 受控通道，owner-only，不需要部署 Hub。
2. 实测用终端 API 在 LAPTOP 上执行 `Test-NetConnection`、`curl` 并读回输出，全程没有再让主人输入命令；LAPTOP Node 已升到 0.2.95。
3. 100 MB DESKTOP→LAPTOP 经 EasyTier 直连（`tcp6`，25 ms）：**25.66 s，4.09 MB/s**。对照：Hub relay 0.04–0.06 MB/s、TCP 80 中继 1.70 MB/s、本机应用网关 308 MB/s（网关不是瓶颈）。
4. 4.09 MB/s 约 32 Mbps，与 IT之家 RustDesk 互联网档 4.1–4.7 MB/s 同档；LAPTOP 当前不在有线同 LAN（25 ms），所以没到商用 LAN 15–80 MB/s。若要 LAN 级，需要两端同 LAN/有线或 UDP 直连路径。
5. 终端页 UI（`terminal-page.js`，活动栏第 4 项）已在真机 Electron 验收：选 `LAPTOP-01` → 新建终端 → `Get-Random` / `echo enter-ok` 各只显示一行；停止后回“未连接”、输入禁用。过程中发现 200 ms 轮询在公网 RTT 下会并发重入、同一块输出重复 3–6 次，已加 `inFlight` 单飞行闸修复并复测。
6. 下一步：远程应用页；ACP Harness；终端的非 owner 端到端拒绝与管理员命令失败提示补验收。

## 2026-11-03 高速互联（EasyTier + 应用网关）

1. 自建 EasyTier 2.6.4 共享节点（LGPL-3.0，PCL2 同款）：服务器 `10.144.0.1/24`，私有网络 + `private_mode`；公网只放行 22/80/443，Caddy HTTP 移到 8080，80/TCP 给 EasyTier。
2. 20 MB 实测：Hub relay 0.04–0.06 MB/s；WSS 0.24 MB/s；TCP 80 **1.70 MB/s**（12.3 s），公网 SSH 直连对照 1.82 MB/s——80 中继已接近家里上行（约 14.5 Mbps）的上限。
3. DESKTOP `10.144.0.2`、LAPTOP `10.144.0.3` 已加入；peer 显示 **direct tcp6，3.71 ms**，不是中继；同 LAN 100 MB 直连吞吐待测。
4. 通用应用网关 `tether/node/app_gateway.py` 已跑通：服务器经 `10.144.0.2:18080` 取到本机 HTTP **200/262 ms**；真实 DSH 经 `18081` 返回 **303** 并签发虚拟 IP authority 的 cookie；单测 4 条通过（pytest 166+5 skipped）。
5. 待办：LAPTOP 100 MB 直连数字；“远程应用”页 UI；EasyTier 安装/升级产品化；ACP Harness 适配。

## 2026-11-03 插件热重载（0.2.90–0.2.93）

1. DSH HMR 实测：profile 插件的模块文件变化时，`pluginManager.setPluginEnabled(entry,true)` 触发的重组合会**原地替换 surface**（同 pid/端口，约 1 秒）；从被 HMR 载入的服务端实例自己调用会撞 `HMR transactions cannot be nested`（AsyncLocalStorage 继承），触发点只在客户端页面。
2. 完整链路：Node `apply` 把 `applied-plugin.json` 镜像到 `dsh_home/storages/tether/updates/` → 页面 watcher 每 2 秒读 `/tether-updates` status → 只启用 surface（禁止停用）→ surface 发布新 `plugin_version` → Node `status()` 清 `restart_required`；8 秒内没握手则 `dsh_restart` 助手兜底。
3. 真机：DESKTOP 插件 0.2.92→0.2.93，job **9 秒**到 done（含下载/安装共 **14.3 秒**），DSH **pid 40564 不变**，descriptor 在 apply 后约 **1 秒**变为 0.2.93。LAPTOP 0.2.91→0.2.93：Node+插件 **54.6 秒**、APP **29 秒**；该机当时无打开的 DSH 页面，插件阶段走 8 秒兜底重启。
4. 三个真机缺陷与修复：0.2.90 的 8.3 短路径 `DSH-PL~1` → `plugin_source_unavailable`（0.2.91 用 `GetLongPathNameW` 展开）；禁用→启用把 `enabled:false` 持久化，真机上 surface 一直停用（0.2.92 改成只启用）；Hub 更新写 Node 的 state dir、surface 读自己的 state dir，页面看不到待重载（0.2.93 镜像）。
5. 门禁：mjs **241**、cjs **8**、pytest **162+5 skipped**、bundle check、制品审计 PASS；两机计算样式门禁 PASS（DESKTOP warm 3.9 s、LAPTOP warm 5.7 s）。两机 app/node/plugin 均 **0.2.93**。
6. 限制：热重载要求 surface 模块文件变化且有 DSH 页面在跑；只有客户端文件变化或无页面时，8 秒后仍整宿主重启。1 GB 传输、DSH 新版本实测、第三方插件测试、Authenticode、干净 Win11 安装仍未完成。

## 2026-11-03 干净目录安装验证（0.2.89）

1. 从 GitHub 下载 `tether-app-0.2.89.zip`，解到独立临时目录，不用仓库源码/`.venv`/`node_modules`。
2. `bootstrap-app.ps1` 创建独立 Python venv 并 `pip install -e .` 成功；`npm ci` 70 packages、**7 s**（缓存命中）。
3. 独立端口 18992/18990 启动：HTTP **200**，`app start 0.2.89`、托盘图标 V1，登录页完整渲染；未配置 Hub 时本地 API 502 属预期。
4. 限制：本机仍有 Python/npm，不是干净 Win11；DSH 安装/插件注入/登录后 Hub/更新链/Authenticode 未覆盖。步骤与结果：`docs/CLEAN_INSTALL.md`。
5. 临时安装目录和进程已清理，未触碰现有安装。

## 2026-11-03 商用质量外壳（EULA/隐私/SBOM/签名）

1. 新增 `scripts/generate_sbom.py`，从 npm lockfile、pyproject 和首方版本生成 CycloneDX 1.5 SBOM；当前 **115 components**，输出 `docs/sbom.cdx.json`。
2. 新增草案 `docs/EULA.md`、`docs/PRIVACY.md`（标注需法务复核，不冒充正式法律文本）。
3. 新增 `docs/SIGNING.md`：发布 manifest 已有 Ed25519 签名；Windows Authenticode **未完成**，需要 OV/EV 证书/云 HSM，不能用自签名冒充。
4. 发布制品审计已覆盖签名、哈希、必需文件和禁止泄露项；真实干净机安装仍未执行。

## 2026-11-03 传输 overlay 决策收口

1. `bench_relay.py` 实测：同机 2 MB 33.87 s（0.06 MB/s）、DESKTOP→LAPTOP 2 MB 59.36 s（0.04 MB/s），SHA-256 均一致；控制面 P50 112 ms。
2. 1 GB 外推 4.5–7 小时，当前公网 Hub relay 不满足；同机对照证明不是分块大小，而是 relay/公网带宽与往返。
3. 按主人约束**不引入 Tailscale 等第三方网络组件**，继续统一走 Hub；1 GB 不在当前交付中承诺。细则/后续选项：`docs/TRANSFER_LIMITS.md`。
4. 未改 UI、未引入第二网络栈；普通文件/目录传输保持现状。

## 2026-11-03 生命周期预热（未达目标）

1. Hub 在 `dsh_install_plugin` / `dsh_start` / `dsh_restart` 成功后后台触发 `NATIVE_SURFACES.prewarm`，希望第一次打开前缓存已开始填。
2. 部署 **`6f1964e`**，备份 `prewarm-lifecycle-20261103T090510Z`，回退 `c8bd970`；Hub 157 passed。
3. 实测：安装后等 70 s，用全新浏览器冷载仍 **76.7 s**（热载 4.3 s）。原因：prewarm 只抓 HTML 首屏 `./assets` 和 `plugins/??` 引用，覆盖不到 DSH 运行时动态加载的全部插件资源。
4. 结论：生命周期预热不是首次冷载的解；下一步若要继续，必须记录真实资源请求并批量预热，或接受首次一次性成本。当前不再盲目加预热。

## 2026-11-03 发布制品干净安装审计

1. 新增 `scripts/qa_release_artifacts.py`：从 Hub manifest 下载当前三件套，验证签名、SHA-256、大小，解包检查必需文件（主进程、Node `dsh_plugin.py`、Tether 四包、安装脚本、`version.json`），并拒绝 `node_modules/data/__pycache__/.env/hub.json/.credentials.yaml` 等泄露项。
2. 对已发布 **0.2.89** 实跑：app 1,792,944 B、node 91,599 B、plugin 1,363,707 B，**PASS**。
3. 这是“干净安装/签名”门禁的制品层；真实 Windows 干净机安装仍需单独执行。

## 2026-11-03 Hub 稳定 surface origin（跨设备统一）

1. 另一个冷载根因：gateway 端口随机，Hub 重启/网关重建后 public origin `g<port>` 变化，浏览器按 origin 的缓存全部作废，热载又变冷载。
2. 改为按设备稳定 loopback 端口（`24000 + crc32(device_id) % 2000`）；端口被占用时回退 ephemeral。origin 稳定后浏览器缓存可跨 Hub 重启继续用。
3. 实测：DESKTOP `g25660`、LAPTOP `g25800`，均等于稳定公式；两机 surface 200。Hub 全量 **157 passed**；生产部署 **`effc4eb`**，备份 `stable-gateway-20261103T083637Z`，回退 `3417bd1`。
4. 发现稳定端口在重启时可能处于 TIME_WAIT 而回退随机；稳定端口也开 `SO_REUSEADDR`，生产部署 **`c8bd970`**，备份 `stable-reuse-20261103T084840Z`，回退 `effc4eb`。
5. **复测成功**：DESKTOP node 重启后仍为 `g25660`；同一持久 profile 冷载 **5.4 s**、热载 4.1 s（此前同场景 65.5 s）。首次全新浏览器冷载仍 82 s，但后续 Hub/node 重启不再重新冷载，达到“稳定 origin + 浏览器缓存”的预期。
6. 不引入 Tailscale；所有节点同一规则。首次安装冷载仍受传输/DSH 生成限制，需另做全量预热或接受一次性成本。

## 2026-11-03 Hub 跨设备共享不可变资源缓存

1. 根因：surface mux 的缓存键是 `(device_id, path)`，同一份 DSH/插件资源每台设备各存一份；DESKTOP 热了，LAPTOP 仍要重新走公网。这是“看起来只优化单节点”的原因。
2. 改为统一 Hub 路径：对带内容哈希的 `/assets/*-<hash>.*` 和带 `rev=` 的 `/plugins/…` 使用跨设备 `("shared", path)` 缓存键；其他路径仍按设备隔离；缓存查找仍在 cookie 鉴权之后。
3. Hub 测试 **156 passed**；生产部署 **`3417bd1`**，备份 `shared-assets-20261103T082351Z`，回退 `49c52e4`；三服务 active，两机 online。
4. 实测（全新浏览器，先 DESKTOP 再 LAPTOP）：LAPTOP 冷载 **38.1 s**（此前 45.9–73.4 s），热载 4.5 s；DESKTOP 重试 51.2 s、热载 4.1 s。仍有波动，8–14 s 未达；瓶颈是首次资源传输/DSH 生成，不是页面渲染。
5. 不引入 Tailscale；下一步在 Hub/APP 侧做全量预热或启动预加载，所有节点同一套逻辑。

## 2026-11-03 冷载基线（真实 surface）

1. 门禁 `qa_surface_styles.mjs` 增加 `boot`（冷启动到 composer）和 `warm`（同浏览器重载）计时。
2. 第一次全新浏览器：DESKTOP **58.7 s**、LAPTOP **45.9 s**；同浏览器热重载 **4.1 s / 4.9 s**。
3. Hub 资产缓存热后第二次全新浏览器：DESKTOP **9.2 s**（达到 8–14 s 目标），LAPTOP **73.4 s**（公网波动）。热重载 3.2 / 5.7 s。
4. 结论：瓶颈是 LAPTOP 首次资源经公网 Hub 的传输，不是页面渲染；下一档杠杆是本机直连/Tailscale Serve（需主人确认是否开放监听）或更激进预热；不改 DSH 插件集。
5. 两机样式仍 PASS。

## 2026-11-03 Hub 更新任务断线自动重试

1. 今天 LAPTOP 的 APP 更新 job 在“检查版本”遇到一次 transient `device_offline`，只能手动重试；这是插件/APP 更新共用的可靠性缺口。
2. Hub `UpdateJobs._call_retry` 改为最多 3 次：遇到 `device_offline` 时最多等 20 s 控制链路恢复再试，其他可重试错误指数退避。
3. 新增回归 `test_transient_device_offline_is_retried`；Hub 全量 pytest 通过。生产部署 **`49c52e4`**，备份 `update-retry-20261103T080646Z`，回退 `3707a3f7`；三服务 active，两机 online。
4. 插件边界按主人定稿写入 `docs/DSH_PLUGIN_BOUNDARIES.md`；0.2.90 的“DSH 版本变化自动重装”已 revert、未发版。

## 2026-11-03 插件边界定稿（主人拍板）

1. Tether 只做三件事：启动 DSH、安装原版 DSH、注入 Tether 插件；除此之外不揽事。
2. **不管理、不更新、不修复第三方插件**；DSH 更新后第三方插件坏掉，不由 Tether 负责。
3. **不在 DSH 每次更新后自动重装 Tether 插件**；0.2.90 的“版本变化自动重装”已 revert、未发版。只有 Tether 自己的 surface 缺失/损坏时才修 Tether 自己。
4. 映射必须是带当前全部插件的真实 DSH；如果 Tether 映射导致其他插件不显示/不可用，算 Tether bug。
5. 细则写入 `docs/DSH_PLUGIN_BOUNDARIES.md`；第三方插件实测等主人选型后按矩阵执行。

## 2026-11-03 v0.2.89 运行时样式防线

1. Electron 在 iframe 载入后探测搜索框/按钮的**计算样式**；出现浏览器默认 `inset/outset` 样式时发 `tether:surface-style-broken`。
2. APP 收到后自动执行一次 `dsh_install_plugin`；如果再次出现，则用“DSH 界面样式与 Tether 版本不匹配”遮罩盖住整块画布，不再显示裸控件，并提供重试。
3. 发布 0.2.89（CI `41598308564`，app 1,792,944 B / plugin 1,363,707 B / node 91,599 B），Hub mirror 0.2.89；LAPTOP 0.2.89，本地插件 0.2.89（pid 43440）。
4. 计算样式门禁 `node scripts/qa_surface_styles.mjs DESKTOP-LOCAL LAPTOP-01` 两机 **PASS**（`bhn1Oq_searchInput`、`border 0px/none`、composer=true）。
5. 仍未完成：DSH 新版本升级矩阵（当前只有 rc.5 同版本基线）、第三方插件测试。热重载见 `2026-11-03 插件热重载（0.2.90–0.2.93）`。
6. 黑窗复测：用更新同款 `python -m tether.node.app_restart` 重启 APP，30 s / 20 ms 采样 **1,500 次**，只新增 1 个 `Chrome_WidgetWin_1`（Tether 主窗口），无 cmd/conhost/`ConsoleWindowClass`。

## 2026-11-03 v0.2.88 自动修复真实触发 + surface 健康判定

1. 本机把 DSH profile 重置为空（无插件、无 `node_modules`），重启 APP 后 **APP 自己触发** `dsh_install_plugin`：装回 4 个 0.2.88 包 + `@deepseek-ai` 依赖树，DSH 新 pid 18492，descriptor 发布，两个 iframe 均为 `bhn1Oq_searchInput` + composer。
2. 关键修复：Hub 的 surface 网关在旧缓存下可能仍返回 200，不能作为健康依据；Node `dsh_status` 新增 `surface`（descriptor pid 存活），APP 在 `running && surface=false` 时自动修复。surface 轮询遇到 `descriptor_missing`/`invalid`/`host_unreachable` 也会进入修复态。
3. 轮询范围保持“本机或 surface 报错”，避免额外 descriptor 请求破坏既有可见性/请求契约（`test_native_surface_effects` 通过）。
4. 0.2.87 CI 因该契约测试失败并卡住，已取消、未发布；0.2.88 修复后 CI `41596624981` 成功，发布 app 1,791,776 B / plugin 1,363,369 B / node 91,599 B；Hub mirror 0.2.88；DESKTOP/LAPTOP 全部 0.2.88（本地插件 pid 18492，LAPTOP 0.2.88）。
5. 新增发布门禁 `scripts/qa_surface_styles.mjs`：无头 Edge 打开两台设备的真实 surface，等待 composer，断言搜索框/按钮计算样式为 `border 0px/none`、透明背景；实测两机 **PASS**。DSH 升级/插件安装矩阵写入 `docs/DSH_UPGRADE_MATRIX.md`。

## 2026-11-03 v0.2.86 全新 profile 自动修复收口

1. 真机模拟“完全缺失插件”：LAPTOP 停 DSH、备份并移走 `node_modules`、把 profile 重置为只有 DSH base/web 的 211 B `package.json`；调用 `dsh_install_plugin` 后 4 个 Tether 包与 `@deepseek-ai` 依赖树全部装好，DSH 首次冷启动超过旧 90 s 等待，install 报 `descriptor_missing`。
2. 修复：descriptor 等待延长到 **180 s**，DSH 在等待期间掉下去时最多自动再拉起 3 次；0.2.86 发布（CI `41592795732`，06:57:46Z，app 1,791,387 B / plugin 1,363,210 B / node 91,575 B）。
3. 实测：DESKTOP 重装插件 **5.31 s**，descriptor pid 41528；LAPTOP 升级 0.2.86 后 DSH pid 25992、surface 200；真 APP 两个 iframe（g38475 / g38585）均为 `bhn1Oq_searchInput` 且 composer=true。
4. 0.2.84/0.2.85/0.2.86 连续发布；0.2.84 引入 auto install/repair，0.2.85 修 Windows 路径空格被 pnpm 拆开导致的 registry 404，0.2.86 修冷启动 descriptor 等待。Hub 生产已部署 `3707a3f7`（`dsh_install_plugin` 超时 360 s），备份 `timeout-20261103T063044Z`。

## 2026-11-03 v0.2.85 插件安装路径空格修复

1. 真机 `dsh_install_plugin` 首次失败：安装源在 `D:\DeepSeek Harness\.dsh\...`，路径含空格，CLI 转发给 pnpm 时被拆开，pnpm 退回 npm registry 并报 `tether-dsh-plugin` 404。
2. 修复：插件包统一暂存到 `data_dir/plugin-source/<version>`（部署路径无空格），profile 依赖写入 `file:` 短路径（`GetShortPathNameW`），CLI 参数使用同一短路径；安装前先把 profile 的 `tether-dsh-plugin` 依赖改成该 file spec，避免 pnpm 先解析旧版本号。
3. 安装失败时恢复 profile 并在原先 DSH 正在运行的情况下重新拉起 DSH，避免修复失败后页面没有 DSH。
4. 临时 profile 实测安装 0.2.85 成功（4 个包 + `@deepseek-ai` 依赖树）；门禁：mjs 238/238、cjs 7/7、pytest 158 passed / 1 skipped、build check、`validate_versions()`。
5. 0.2.85 待发布；发布后在 LAPTOP 再次调用 install/repair 验证真实 descriptor。

## 2026-11-03 v0.2.84 插件自动安装/修复

1. Node 新增 `tether/node/dsh_plugin.py` 与 `fs/dsh_install_plugin`：下载签名清单对应的插件 ZIP 并校验 SHA-256，或使用本地包；强制 profile 的 pnpm 使用 hoisted 布局，走官方 `dsh plugin add file:` 安装 4 个插件包和 `@deepseek-ai` UI 依赖树；装前备份 profile `package.json`，装后校验包版本、bundles、依赖树，失败恢复 profile；重启 DSH 并等待新 descriptor。
2. Electron/APP 的 surface 缺失状态新增“安装/修复插件”：检测到 `descriptor_missing` 且 DSH 正在运行时**自动执行一次** repair，成功后按新 DSH pid 重载 iframe；失败显示可重试按钮。用户不再需要手工拷包。
3. Hub 的 `FS_ACTION_TIMEOUTS` 增加 `dsh_install_plugin: 360 s`，避免长安装被 20 s 默认超时切断。
4. 验证：临时 DSH home 上用官方 CLI 安装成功，4 个插件包 0.2.83 且 `@deepseek-ai` 顶层依赖齐全；从 Hub 清单下载插件 ZIP 的路径也跑通。门禁：mjs **238/238**、cjs **7/7**、pytest **158 passed / 1 skipped**、两份 build check、`validate_versions()`。
5. 0.2.84 待发布；发布后更新 LAPTOP 并实测自动修复（备份 profile 后移除插件包/依赖树，触发 repair）。

## 2026-11-03 v0.2.83 两机 DSH 恢复、黑窗根因与 surface 自恢复

1. **LAPTOP 插件缺失**：DSH 已登录，但 `profiles/desktop/package.json` 没有 `tether-dsh-plugin`、`node_modules` 里也没有 Tether 包。受控修复：停 DSH → 备份 profile → 上传 4 个插件包并逐文件 SHA-256 校验 → 写回 bundles/dependencies → 启动 DSH。descriptor 3 s 内出现（pid 9124、origin 1871）；node 重启后能力为 app/node/plugin **0.2.82**、`dsh_native=true`、`dsh_surface=true`。LAPTOP surface 经 Hub gateway 返回 **200 / 39,514 B**；headless Edge 和真 APP iframe 都出现 composer。
2. **本机 DSH 页面**：surface 网关本身可用；卡住的是旧的 502 iframe。新增 Electron 侧 502 错误页识别（`rendererFrameText` + `isSurfaceErrorPage`），命中后走既有 `tether:surface-boot-failed` 重试链，不再把错误页当 `document-loaded` 永久保留。两个 iframe（DESKTOP g37511 / LAPTOP g44207）复验均渲染 composer。
3. **`/plugins/events` 重开崩溃**：`native_surface.py` 引用未定义的 `HTTP_STREAM_MAX_AGE` 与 `_HttpStream.created`，第一条 SSE 关闭后再开就会 `NameError`；补齐常量/字段并新增“已有活跃流时再开一条”回归。
4. **黑窗真正根因**：LAPTOP 的桌面/开始菜单快捷方式指向 `Tether-App.cmd`，双击先起可见 cmd 控制台。已重建 LAPTOP 桌面快捷方式为直接启动 `electron.exe`；APP 新增 `ensureAppShortcuts()`，每次启动用 `shell.writeShortcutLink` 自愈桌面/开始菜单。开始菜单路径受 fs 保护策略限制，等 APP 在 LAPTOP 启动后由自愈逻辑修正。
5. 门禁：mjs **237/237**、cjs **7/7**、pytest **151 passed / 1 skipped**、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.83 已发布（CI `41585359468`，05:44:39Z，app 1,785,637 B / plugin 1,362,845 B / node 86,236 B），Hub mirror 0.2.83。LAPTOP 经更新任务升到 app/node/plugin **0.2.83**（plugin job 26 s、app job 17 s），DSH pid 20892、surface 200；DESKTOP 重装本地 profile 插件到 0.2.83 并重启 DSH 到 pid 21144，两机页面均有 composer。
6. 冷启动取证：桌面快捷方式启动，20 ms 采样 **1,100 次**，只新增 3 个可见窗口（WeType `StatusBarWnd` + 两个 Tether `Chrome_WidgetWin_1`），无 `ConsoleWindowClass`/cmd/conhost。
7. **LAPTOP 侧栏样式退化**：页面能出侧栏，但工作区搜索框/按钮是浏览器默认样式。原因是手工拷包绕过了 `dsh plugin add`，profile 缺 `@deepseek-ai/dsh-client-ui-*` 依赖树；LAPTOP 组件类名为 `GAkraW_*`，静态 CSS 只匹配 DESKTOP 的 `bhn1Oq_*`。补齐 30 个 `@deepseek-ai` 运行文件（SHA-256 校验）并重启 DSH 后，类名恢复为 `bhn1Oq_searchInput`、`border: 0`，真 APP 的 LAPTOP iframe 复验通过。

## 2026-11-03 v0.2.82 DSH 认证修复入口

1. 新增 `dsh_repair_auth`：停全部 DSH、备份 `%APPDATA%\@deepseek-ai\dsh-desktop` 和 `.credentials.yaml`、重启 DSH。
2. LAPTOP 实测备份成功（appdata `...bak-tether-20261103-074108`，credentials 同名备份），DSH 重启后不再产生 `Web authentication failed` 崩溃日志；但 appdata 为空、descriptor 仍缺失，当前应处于登录/初始化态。
3. 0.2.82 已发布并刷新 mirror；LAPTOP app/node 0.2.82。下一步：本机登录 DSH，再验证 Tether 插件/页面。

## 2026-11-03 v0.2.81 DSH 停止与认证排查

1. `fs/dsh_stop` 改为停掉所有 `DeepSeek Harness.exe` 进程，实测停止后 `running=false`；用于重装/升级前收口。
2. rc.5 仍报 `desktop welcome: Web authentication failed`；备份/删除凭据、重建 `profiles/desktop` 均无效，原 profile 已恢复。
3. 尝试备份/重建 DSH 的 `%APPDATA%` 用户数据时被 Tether fs 的受保护系统路径策略拒绝；需要本机登录 DSH 或单独的受控 DSH 修复接口。
4. 0.2.81 已发布；LAPTOP app/node 0.2.81。

## 2026-11-03 v0.2.80 启动/更新黑窗收口

1. 启动 trace（桌面快捷方式，20 ms 采样）只有 Tether 主窗口，无控制台。
2. 找到更新/退出链最后一个控制台 spawn：`supervisor.killTree()` 的 `taskkill` 缺 `windowsHide`；已加 `windowsHide: true`，并加回归断言。
3. 0.2.80 已发布（CI `41543680968`），Hub mirror 0.2.80；DESKTOP app/node 0.2.80，LAPTOP app/node 0.2.80。

## 2026-11-03 v0.2.77/0.2.78 DSH 恢复入口与真实根因

1. 0.2.76 新增 `fs/dsh_restart` 与 APP“重启 DSH”入口；0.2.77 让重启 helper 接收 live host PID（DSH 命令行不含 `dsh-desktop-host` 时也能找到）；0.2.78 让 start/restart 显式传回检测到的 `dsh_home`，避免落到默认 `C:\Users\14675\.dsh`。
2. 实测 LAPTOP：重启能替换 pid（24420 → 7444 → 2800），但 DSH rc.3 启动即报 `desktop welcome: Web authentication failed`，`native-surface.json` 仍不出现。**结论**：表面缺失的第一层是 DSH 自身认证/安装坏了，Tether 插件不是首要原因；需要先修 DSH 本体。
3. APP 侧已经做到：DSH surface 缺失时显示明确状态和“重启 DSH”，不白屏；APP 其他页面不受 DSH 影响。
4. 0.2.76/0.2.77/0.2.78/0.2.79 均已发布并刷新 Hub mirror；LAPTOP Node/APP 0.2.79。已停止 rc.3 并通过官方 feed 安装 **rc.5** 成功，但 rc.5 仍报 `desktop welcome: Web authentication failed`，surface 仍缺失；下一步必须重置 DSH 认证/profile 并重新登录，而不是继续改 Tether 插件。

## 2026-11-03 v0.2.76 DSH surface 恢复入口

1. Node 新增 `fs/dsh_restart`：复用无窗口 `dsh_restart` helper，剥离 `DSH_HOME`/`ELECTRON_RUN_AS_NODE`，关闭旧 DSH 并重启，等待新的 surface descriptor。
2. APP 对远端和本机都读取 `dsh_status`；当 surface 报 `descriptor_missing`/`descriptor_invalid`/`host_unreachable` 且 DSH 正在运行时，显示“DSH 已在运行，但 Tether 插件未加载或 surface 描述符缺失”，并提供“重启 DSH”；DSH 未运行仍显示启动/安装。重启期间按 DSH pid 变化判断完成，不把旧 pid 当成功。
3. 门禁：mjs 234/234、cjs 6/6、pytest **149 passed / 1 skipped**、两份 build check、`validate_versions()` 通过。0.2.76 已发布（CI 待填），Hub mirror 0.2.76。**待完成**：LAPTOP 更新后实际点重启并验证 descriptor/页面。

## 2026-11-03 v0.2.75 图标回到最初版 + V1 立 S

1. 0.2.74 的纯黑 T 图标因“长竖杆 + 单球”误读被否；草稿已删除，**没有发布**。
2. 正式图标回到最初版：深海军蓝圆角底、左上白环、右下橙环；只把中间连接线改成 **V1 立 S**（单段三次曲线，控制点 `(580,150)`、`(444,874)`）。资产改为 `assets/tether-app-s.svg/.png/.ico`；顶栏 `TetherMark` 同步 V1。
3. 修图标缓存：使用新文件名、`app.setAppUserModelId('com.tether.app')`、重建桌面/开始菜单快捷方式并刷新 Explorer 缓存；任务栏精确裁剪与托盘日志都确认使用 V1。
4. 门禁：mjs 234/234、cjs 6/6、pytest 148 passed / 1 skipped、两份 build check、`validate_versions()` 通过。0.2.75 已发布（CI `41509643908`，19:28:43Z，app 1,783,262 B / plugin 1,362,485 B / node 84,935 B），Hub mirror 0.2.75；DESKTOP app/plugin/node 均 0.2.75；LAPTOP app/node 0.2.75、插件运行态 0.2.71（DSH 重载滞后）。

## 2026-11-03 v0.2.73 无原生标题栏、统一图标与托盘

1. 窗口改为 `frame:false`，去掉 Electron 原生标题栏；Tether 顶栏变成一体化 chrome：品牌网络标记 + 设备 + 连接 + 自绘最小化/最大化/还原/关闭，整条可拖动，按钮区不可拖动。
2. 图标按登录页网络视觉重做：1024 px 母版 + 多尺寸 `assets/tether.ico`；窗口、任务栏、悬停缩略图、托盘、桌面/开始菜单快捷方式统一使用同一 ico。
3. 关闭改为隐藏到 Windows 托盘：`Tray` 右键“打开 Tether / 退出 Tether”；关闭事件 `preventDefault + hide`；有托盘时 `window-all-closed` 不退出；第二实例恢复窗口；只有托盘退出或更新重启才真正 `app.quit()`。
4. **真机验证**：窗口顶部不再有原生标题栏，DSH 页面从 y=40 开始；最小化后 `IsIconic=true`；最大化后 `IsZoomed=true` 且按钮变“还原”，还原后 `IsZoomed=false`；关闭后窗口 `visible=false`、进程仍存活；再次启动快捷方式窗口恢复；托盘日志确认使用新 `tether.ico` 创建；任务栏截图显示新的深色网络图标。
5. 门禁：mjs **234/234**（新增 3 条 shell/tray/icon 测试）、cjs 6/6、pytest 148 passed / 1 skipped、两份 build check、`validate_versions()` 通过。0.2.73 已发布（CI `41501985896`，18:39:29Z，app 1,932,610 B / plugin 1,362,669 B / node 84,935 B），Hub mirror 0.2.73；DESKTOP app/plugin/node 均 0.2.73，LAPTOP app/node 0.2.73、插件 0.2.71（DSH 运行态重载滞后）。

## 2026-11-03 v0.2.72 消除启动黑色控制台闪窗

1. 根因：启动更新检查本身已是 `pythonw.exe`，但 `UpdateManager.checkout_state()` 仍用 `subprocess.run(["git", ...])` 执行 `git status`；`git.exe` 是控制台程序，会创建可见的 `ConsoleWindowClass` 窗口。
2. 证据：单独跑更新检查并用 20 ms 采样可见窗口，修复前抓到 3 个控制台窗口（1.3 s、3.8 s、4.5 s，均为 Git 的 `git.exe`），与“闪一下、过会儿又闪”的现象一致；完整启动 trace 中可见 `git.exe` + `conhost.exe` 由 Node/更新检查拉起。
3. 修复：Windows 上给 git 探针加 `CREATE_NO_WINDOW`；主源码与插件 vendored updater 同步；新增回归测试 `test_checkout_state_hides_the_git_console_on_windows`。核对 app restart、DSH start/install/restart、Office preview 均已使用隐藏窗口，没有第二条遗漏路径。
4. 复测：同一更新检查采样不再出现任何新窗口；通过桌面快捷方式启动 APP 的 20 ms 窗口采样只看到 `Tether` / `Tether WebUI` 两个同名主窗口，没有 `ConsoleWindowClass`、conhost 或黑色弹窗。
5. 门禁：mjs 231/231、cjs 6/6、pytest **148 passed / 1 skipped**（含新回归）、两份 build check、`validate_versions()` 通过。0.2.72 已发布（CI `41485135556`，16:52:03Z，app 1,786,116 B / plugin 1,361,440 B / node 84,935 B），Hub mirror 0.2.72；DESKTOP 已重启到 0.2.72，LAPTOP 更新任务已发。

## 2026-11-02 v0.2.71 登录页惯性网络与邀请码平滑切换

1. 左侧视觉换成 `LoginNetwork`：4 个节点用阻尼弹簧 + 漂移 + 指针推斥做惯性运动，6 条边全部是 SVG 直线；每帧直接改 `cx/cy/x1/y1/x2/y2`，不触发 React 重渲染；`prefers-reduced-motion` 时保持静止。
2. 登录与邀请码注册改成同一卡片内两个绝对定位视图，固定舞台 344 px；用 `opacity` 200 ms + `translateX` 280 ms 切换；错误提示预留固定 16 px 槽位，避免校验信息出现时位移。
3. 删除底部“返回 DSH”文字入口，DSH 宿主只保留右上角 ×；APP/网页登录仍无退出按钮。
4. **真机测量**：登录卡片切换前 `822×400`，切换后 `822×400`；两个视图均 `500×344`；登录视图 `opacity 1 / translateX 0` 对邀请码视图 `opacity 0 / translateX 16`，切换后互换；1 s 内 SVG 节点坐标发生变化，两种视图动画都持续。截图 `tether-login-view.png` / `tether-login-invite.png`。
5. 门禁：mjs 231/231、cjs 6/6、pytest 147 passed / 1 skipped、两份 build check、`validate_versions()` 通过。0.2.71 已发布（CI `41481608258`，16:32:09Z，app 1,785,837 B / plugin 1,361,368 B / node 84,818 B），Hub mirror 0.2.71；DESKTOP app/plugin/node 均 0.2.71；LAPTOP app/node 0.2.71，插件文件已到 0.2.71 但运行态仍 0.2.70，任务卡在“重新拉起 DSH”（92%，`restart_timeout`）——与 0.2.70 相同的已知问题。

## 2026-11-02 v0.2.70 账户资料服务端同步

1. Hub `users` 新增 `display_name`/`avatar`，旧库自动加列；新增 `GET/POST /api/auth/profile`，`/api/state.user` 下发资料；头像只收 png/jpeg/webp data URL，解码后 ≤64 KiB；审计只记字段名。
2. 客户端资料不再只存 `localStorage`：保存时先乐观更新再写服务端，失败回滚并提示；每 2.5 s 轮询把服务端值同步到所有已登录客户端。0.2.69 的收起行与弹窗编辑保持不变。
3. 服务端测试 155 passed；客户端 mjs 231/231、cjs 6/6、pytest 147 passed / 1 skipped、两份 build check、`validate_versions()` 通过。
4. 生产 Hub 切到 `42940b5b`（`/opt/tether/server`），重启前备份 `profile-sync-20261102T135918Z/controller.db`（SHA-256 `d6f3a4ee…`）；`tether-hub`/`tether-surface-mux`/`caddy` 均 active，`/api/health` ok。
5. **双客户端真机验证**：第二个 Web 客户端用独立 localStorage 登录后立即得到 `qi007` + 17,839 字符头像；在 APP 改成 `qi007-browser-sync` 后，服务端与第二客户端在 4 s 内同步；改回 `qi007` 后同样同步。头像反向验证：服务端把头像改成 118 字符 1×1 PNG，APP 3.2 s 内变为 118；恢复原头像后 3.2 s 内回到 17,839。测试后已恢复原昵称/头像并关闭第二客户端。
6. 0.2.69 发布（CI `41450974601`，13:17:07Z，app 1,782,006 B / plugin 1,359,464 B / node 84,818 B）；0.2.70 发布（CI `41458731074`，14:09:51Z，app 1,782,898 B / plugin 1,359,927 B / node 84,817 B），签名清单验签与资产哈希通过，Hub mirror 0.2.70。DESKTOP app/plugin/node 均 0.2.70；LAPTOP app/node 0.2.70，插件仍 0.2.68，插件任务卡在“重新拉起 DSH”（92%）——已知问题，待单独处理。

## 2026-11-02 v0.2.69 账户页收束与弹窗编辑

1. 头像：右下角相机覆盖层；移除头像改成资料卡右上角垃圾桶图标，不再有“更换头像/移除头像”文字按钮；裁剪弹窗保留明确的“移除头像”。
2. 昵称/密码默认收起：昵称是“标签 + 当前值 + 铅笔”，密码是“密码 + 修改密码”；编辑改为独立绝对定位弹窗，含 Enter/Escape、Caps Lock 与行内校验。
3. 实测设置面板在收起、昵称弹窗、密码弹窗三种状态均为 **760×560**，主页面总高 881 不变；编辑不再把页面向下拉长。跨项目准则已写入 `feedback-loading-no-layout-shift.md`。
4. 门禁：mjs 231/231、cjs 6/6、pytest 147 passed / 1 skipped、两份 build check、`validate_versions()` 通过；已发布 v0.2.69（CI `41450974601`）。

## 2026-11-02 v0.2.68 更新页版式重做

1. 顶部：左侧“更新”标题，右侧刷新；不再只有孤零零的刷新图标和一段空白。
2. 设备：本机/其他设备分组，组内用一张列表卡片；每行左边设备名和状态点，中间组件版本胶囊（APP/插件/Node 各自一个），右边固定 28px 操作位。
3. 版本：去掉斜杠和 `→`；当前版本固定显示，不随新版本更新变长。有新版本只出现蓝色圆形下载按钮；错误时操作位显示红色重试图标。
4. 真机：LAPTOP 行有无更新均为 `543×72`，只有按钮数量变化；截图 `tether-update-redesign.png` / `tether-update-redesign-alert.png`。
5. 门禁：mjs 231/231、cjs 6/6、pytest 147 passed / 1 skipped、两份 build check、`validate_versions()` 通过。0.2.68 已发布（CI `41446165778`，12:41:13Z，签名清单验签通过，app 1,781,215 B / plugin 1,359,104 B / node 84,818 B），Hub mirror 0.2.68；LAPTOP Node+APP 16.9 s；DESKTOP app/node/plugin 均 0.2.68，LAPTOP app/node 0.2.68、插件 0.2.67（插件更新任务已发）。

## 2026-11-02 v0.2.67 启动更新检查无窗口

启动闪窗根因：快捷方式本身是直接 `electron.exe`，但 APP 启动后自动更新检查用 `python.exe -m tether.updates_cli check`，创建了一个 `conhost`（短命控制台）。修复：

1. `main.js` 把 `UpdateService` 的 python 改为 `supervisor.childPython`（venv `pythonw.exe`）。
2. `supervisor.js` 的本地服务器探测 `spawnSync` 也改用 `childPython`。
3. `pythonw` 的 stdout 管道已验证（`hello` 正常回传）；更新检查/助手不会因无窗口丢失 JSON。
4. 启动监控：更新检查显示为 `pythonw.exe`，无 `python.exe`/关联 `conhost`，可见短命窗口列表为空。
5. 门禁：mjs 231/231、cjs 6/6、pytest 147 passed / 1 skipped、两份 build check、`validate_versions()` 通过。0.2.67 已发布（CI `41442922613`，12:17:27Z，签名清单验签通过，app 1,780,821 B / plugin 1,358,859 B / node 84,818 B），Hub mirror 0.2.67；LAPTOP Node+APP 20.8 s；DESKTOP app/node/plugin 均 0.2.67，LAPTOP app/node 0.2.67、插件 0.2.65（插件更新任务已发）。

## 2026-11-02 v0.2.66 恢复互联图流动与状态接力

0.2.64 为了保留拖动位置删掉了力导向动画，这个处理错了。本轮恢复：

1. 恢复 `animate`/`kick` 力导向；初始仍是环形/三角，但远端节点不再受中心拉力，避免流动后三角被拉成竖线。
2. 节点位置和速度存到 `tether.network.positions.v3`，拖动结束/组件卸载保存；重进使用 `x/y/vx/vy` 继续，不再回初始态。
3. 真机：清空保存后节点从初始 `20.2%,32.8%` 流动展开到 `15.42%,30.04%`，三角保持；拖动后切文件页再回，节点从离开时的运动状态继续（`LAPTOP 13.67%,33.04%` / `TETHER 88.69%,59.87%`）。测试状态已清理并恢复初始流动布局。
4. 门禁：mjs 231/231、cjs 6/6、pytest 147 passed / 1 skipped、两份 build check、`validate_versions()` 通过。0.2.66 已发布（CI `41440651070`，12:00:22Z，签名清单验签通过，app 1,780,669 B / plugin 1,358,856 B / node 84,818 B），Hub mirror 0.2.66；DESKTOP app/node/plugin 均 0.2.66，LAPTOP Node+APP 更新任务已发。

## 2026-11-02 v0.2.65 节点详情浮层

1. 节点详情从右侧 flex 列改为绝对浮层：`position:absolute; top/right/bottom:8px; width:300px; zIndex:8`，圆角、边框、阴影；互联页画布容器 `position:relative`。打开/关闭详情不再挤压画布。
2. 真机：打开 DESKTOP 节点详情前后，画布 stage 宽度均 **1074px**；浮层含搜索、连接开关、连接管理，独立覆盖在右侧。截图 `network-detail-overlay.png`。
3. 门禁：mjs 231/231、cjs 6/6、client pytest 147 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.65 已发布（CI `41437443163`，11:34:42Z，签名清单验签通过，app 1,779,140 B / plugin 1,358,108 B / node 84,818 B），Hub mirror 0.2.65；LAPTOP Node+APP 36.9 s；DESKTOP app/node/plugin 均 0.2.65，LAPTOP app/node 0.2.65、插件 0.2.64（插件更新任务已发）。

## 2026-11-02 v0.2.64 互联图环形布局与位置持久化

1. 初始布局：不再把所有远端放在同一条竖直轴上。两个远端用 210°/330°，三个及以上按 360°/n 均匀分布，中心节点固定 50%/50%；节点数 >12 时默认圆点模式。真机三节点呈三角形，中心节点上方不再被一条线穿过。
2. 线条/节点：链接中点的断开按钮在距任一节点 9% 以内时隐藏，避免压住节点标签；边线仍可点击断开。
3. 位置持久化：节点位置按本机设备存到 `tether.network.positions.v2`，拖动结束和组件卸载时保存；重新进入优先读已存位置。移除了持续力导向动画，避免拖完被拉回。真机把 LAPTOP 从 `20.2%,32.8%` 拖到 `35.1%,72.3%`，切文件页再回互联页仍为 `35.11%,72.32%`；测试位置已清除，恢复初始布局。
4. 拖拽交互：`startDrag` 不再切换当前设备；只有点击不拖动才 `onSelect` 并打开详情，拖动只移动节点。
5. 门禁：mjs 230/230、cjs 6/6、client pytest 147 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.64 已发布（CI `41434714235`，11:15:30Z，签名清单验签通过，app 1,778,877 B / plugin 1,358,071 B / node 84,818 B），Hub mirror 0.2.64；LAPTOP Node+APP 14.6 s；DESKTOP app/node/plugin 均 0.2.64，LAPTOP app/node 0.2.64、插件 0.2.63（插件更新任务已发）。

## 2026-11-02 v0.2.63 登录退出、登录页视觉与默认服务器

1. 插件退出：DSH 插件把 `ctx.layout.selectPanel(null)` 暴露为 `host.exitPanel`；登录页在插件宿主显示右上角 `×` 与底部“返回 DSH”，不想登录可以直接回 DSH。登录根从 `fixed` 改为 `absolute`，不再连 DSH 侧栏一起盖住。APP/网页登录不显示退出。
2. 登录视觉：登录卡片改为双栏：左侧深色品牌视觉（Tether 标记 + 设备网络连线图 + 私有设备网），右侧邮箱/密码/两步验证；窄屏自动隐藏视觉。真机截图确认双栏（APP 登录临时清 token，验后已恢复）。
3. 服务器地址：登录页移除“服务器地址”输入，固定使用已有 `defaultUrl`，没有时回退 `https://8-220-198-26.sslip.io`；连接状态页仍显示地址但不让登录时改。未来“服务器连接/自建设备网”作为独立选项再加。
4. 门禁：mjs 229/229、cjs 6/6、client pytest 147 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.63 已发布（CI `41430469293`，10:43:24Z，签名清单验签通过，app 1,779,253 B / plugin 1,358,293 B / node 84,818 B），Hub mirror 0.2.63；LAPTOP Node+APP 15.1 s；DESKTOP app/node/plugin 均 0.2.63，LAPTOP app/node 0.2.63、插件更新任务已发。

## 2026-11-02 v0.2.62 设置更新页、无终端启动与 DSH 生命周期

本轮把“更新”重新作为一个设置栏目补齐，并处理 APP 启动与 DSH 生命周期：

1. 设置新增“更新”：本机按当前入口显示 APP+Node 或 插件+Node；其他设备只显示与当前设备有 `edges` 的节点，版本行 + 蓝色圆形下载按钮 + 刷新。断开边后设备从列表消失，恢复后回来；用只读假版本验证了蓝色按钮外观。右上角蓝色下载按钮保留，仍按当前入口更新。
2. APP 黑终端：长期运行的 Controller/Node 改用 `pythonw.exe`；`Tether-App.cmd` 默认经 VBS 隐藏重入，bootstrap PowerShell `-WindowStyle Hidden`；更新助手重启 APP 用 `windowsHide: true`。桌面快捷方式真机启动，Node 为 `pythonw.exe`、`MainWindowHandle=0`，日志正常注册。
3. DSH 生命周期：新增 `tether/node/dsh_desktop.py`，注册表/asar/进程检测安装路径、版本与运行态，`/fs/dsh_status`、`/fs/dsh_start`、`/fs/dsh_install`；启动剥离 Tether 的 `DSH_HOME`；安装从官方 HTTPS nightly 源校验 SHA-512 后 `/S`。surface 在 DSH 未启动/未安装时覆盖“启动 DSH/安装 DSH”，设置→本机设备显示 DSH 版本/状态。真机检测到 rc.3，覆盖页出现并可启动；官方同版本 rc.3 安装包静默安装成功，DSH host 正常发布描述符，Tether surface 显示真实 DSH UI 与插件侧栏。
4. 兼容性：Tether 不重写 DSH 页面，而是嵌入真实 DSH Web UI，DSH 内插件会原样呈现；设置显示 DSH 版本。未安装 rc.5，不声称已验证新版本；如果上游改 surface 描述符协议，Tether 会显示 DSH 状态/重试/启动页而不是白屏。
5. Hub 更新修复：生产任务会发 `plugin restart`，但 Hub 的 `UPDATE_ACTION_TIMEOUTS` 没有 `restart`，远端插件出现“文件 0.2.62、运行态 0.2.61”。已在 Hub 加入 `restart`（仅 plugin，120 s）并部署生产 commit `638b3ce8`，`tether-hub` 于 18:14:57 CST 重启，三服务 active；LAPTOP 的 restart 动作已不再 `bad_action`，但该次 DSH 运行态重载 90 s 超时，插件运行态仍待 DSH 重启（已知项）。
6. 事故与恢复：强杀 DSH 触发其自身“Web authentication failed”崩溃循环；备份 profile 与 DSH desktop 缓存后仍复现，最终用官方**同版本** rc.3 安装包（274,333,696 B，SHA-256 `1e3876ba…`）静默重装修复，DSH 会话保留；桌面/开始菜单改指 per-user 安装，重新安装 Tether 插件后 surface 恢复。
7. 门禁：mjs 228/228、cjs 6/6、client pytest 147 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.62 已发布（CI `41424379550`，09:58:35Z，签名清单验签通过，app 1,777,012 B / plugin 1,357,270 B / node 84,818 B），Hub mirror 0.2.62；LAPTOP Node+APP 30.8 s，DESKTOP 源码 APP 重启、本机插件 0.2.62；DESKTOP app/node/plugin 均 0.2.62，LAPTOP app/node 0.2.62、插件文件 0.2.62（运行态待重载）。

## 2026-11-02 v0.2.61 权限页审计直出

权限页每次打开都要等审计：`openSettings` 先 `await` 策略、再 `await` 审计，串行两次设备往返；策略虽然已有 `policyCacheRef`，打开时却没拿它填表单，审计则完全没有预热或缓存。修复：

1. 新增按设备保存的 `auditCacheRef`，与策略一起在切换设备时并行预取（`Promise.allSettled`），同一设备的并发请求由 `permissionInflightRef` 去重。
2. `openSettings` 先用缓存同步填策略、模式、可写根与审计，再在后台 `Promise.all` 刷新；刷新完成不覆盖已显示列表，也不打断滚动。
3. 冷启动无缓存时列表内显示“正在读取审计…”，不再误报“暂无审计”；保存权限与“加载更多”同步更新缓存，清空会话时一并清理。
4. 真机实测：修复前本机策略 638 ms + 审计 677 ms（LAPTOP 1,114 ms + 715 ms），打开约需数秒；修复后 DESKTOP 点开到 68 行审计 **3 ms**，0.2.61 重启后 **19 ms**、68 行；切到 LAPTOP 后首次点开 **3 ms**、103 行。判据：有缓存时 50 ms 内出现完整审计行。
5. 门禁：mjs 226/226、cjs 6/6、client pytest 142 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.61 已发布（CI `41407506570`，07:40:28Z，签名清单验签通过，app 1,765,320 B / plugin 1,353,822 B / node 79,668 B），Hub mirror 0.2.61；LAPTOP Node+APP 19.7 s、插件 27.1 s，DESKTOP 源码 APP 重启、本机插件 0.2.61；两机 app/node/plugin 均 0.2.61 且在线。

## 2026-11-02 v0.2.60 账户设置精细化

先查成熟产品再写：GitHub 头像上传后进入裁剪、Google 账号照片旋转/裁剪/保存、Slack 上传后调整构图、Chrome 改密表单的 `current-password`/`new-password` 与约束、Authgear 的行内校验。账户页据此重做：

1. 头像：选图后必须进入圆形 240 px 取景框，支持拖动、1–3 倍缩放、复位；保存输出 256×256 JPEG，移除/取消/保存独立；上限 8 MB。真机用 480×320 偏心测试图打开弹窗，初始 `matrix(0.75,0,0,0.75,-60,0)`，拖动后 `x=0`，缩放 1.35，保存得到 7,385 B data URL 并同步活动栏；验后已取消并恢复主人原头像（9,281 B），昵称保持未设置。
2. 昵称：行内编辑，保存/取消/Enter/Escape，错误行内显示；真机保存“测试昵称”后 localStorage 生效，验后恢复为空。
3. 密码：当前/新/确认三栏，显示切换、10 位下限、不得与当前相同、两次一致；`autocomplete`、Caps Lock 提示、行内错误；无效提交不发请求。真机空/短/不一致提交显示“新密码至少 10 位”“两次输入的新密码不一致”，未改真实密码。
4. 门禁：mjs 225/225、cjs 6/6、client pytest 142 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.60 已发布（CI `41403421431`，07:03:27Z，签名清单验签通过，app 1,764,049 B / plugin 1,353,182 B / node 79,667 B），Hub mirror 0.2.60；LAPTOP Node+APP 27.4 s、插件 25.2 s，DESKTOP 源码 APP 重启、本机插件 0.2.60；两机 app/node/plugin 均 0.2.60。DESKTOP 真机账户页显示个人资料与登录安全两张卡；裁剪弹窗 240 px 圆形取景、滑块、复位、移除/取消/保存完整。

## 2026-11-02 v0.2.59 互联拓扑控制与选中态

本轮把互联页从“隐式星型线”升级为可编辑拓扑：

1. 服务端：私有 Hub 新增 `edges`/`edge_seeds` 表与 `GET/POST /api/edges`、批量、DELETE；`/api/state` 返回 `edges`；首次为 owner 建一棵以 `TETHER_DEVICE` 为根的星型边，新设备入网连到同一根，后续断开不被重连覆盖。生产备份 `edges-20261102T060941Z`（DB SHA-256 `ec85bd89…`），回退点 `d783681`，生产部署 commit `e66920b6`，重启 90 s；三服务 active，两机自动重连，边种子为 DESKTOP↔LAPTOP、DESKTOP↔TETHER-REMOTE-TEST。
2. 客户端画布：只画显式边；在线实线、离线虚线、无边不画；线中点的链图标断开，右上“连接”进入两次点选建边；点节点打开详情抽屉，列出所有设备与连接开关；右上“连接管理”是可搜索的连接表格，支持新建和逐条断开。真机：画布断开→重连、详情开关、管理表格新建/断开全部生效，边已恢复为两条。
3. 活动栏选中态：从浅灰底/深色图标改为蓝色 16% 底 + 蓝色图标，互联页选中图标清晰可见。
4. 门禁：mjs 225/225、cjs 6/6、client pytest 142 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.59 已发布（CI `41400940630`，06:39:21Z，签名清单验签通过，app 1,757,366 B / plugin 1,349,837 B / node 79,669 B），Hub mirror 0.2.59；LAPTOP Node+APP 16.0 s、插件 26.3 s，两机 app/node/plugin 均 0.2.59。LAPTOP 真机互联页显示 2 条显式边，活动栏“互联”为蓝色 16% 底 + 蓝色图标；画布/详情/连接管理切换均落到生产 Hub 并已恢复原边。

## 2026-11-02 v0.2.58 文件转移双栏根目录标识

文件转移页两栏的根列表本来就按设备分别请求 `/workspaces` 与 `/drives`：左栏 DESKTOP 是 `C:\Users\Administrator...`、`demo`，右栏 LAPTOP 是 `C:\Users\14675...`、`audit`；同名 `default-workspace`/`Tether 工作目录` 造成“所有工作区集中在一起”的误读。修复：`FilePane` 把设备名传给树分组，显示 `工作区 · 设备名` / `此电脑 · 设备名`；切换设备时先清空旧 `roots`/`entries` 再加载，避免短暂显示上一台设备的树。真机截图已确认左右分组分别为 `DESKTOP-LOCAL` / `LAPTOP-01`。

门禁：mjs 224/224、cjs 6/6、client pytest 142 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.58 已发布（CI `41396125195`，05:51:48Z，签名清单验签通过，app 1,749,053 B / plugin 1,345,886 B / node 79,668 B），Hub mirror 0.2.58；LAPTOP Node+APP 20.1 s、插件 28.9 s，DESKTOP 源码 APP 重启、本机插件 0.2.58；两机 app/node/plugin 均 0.2.58。转移页真机：左栏 `工作区 · DESKTOP-LOCAL`、右栏 `工作区 · LAPTOP-01`，工作区与盘符分别属于两台机器。

## 2026-11-02 v0.2.57 选择器树联动、文件夹上传与拖入保存

本轮处理主人对目标选择器与附件链路的 5 条反馈：

1. 树与右侧双向联动：`TargetFileExplorer` 的树行和箭头合并为一个按钮，点文件夹同时展开并导航右侧；右侧进入目录时 `revealTree` 展开祖先并加载。真机：点 `C:` 右侧出内容、树展开；右侧点 `Users` 后面包屑 `C: › Users`，树也展开到 `Users`。
2. 文件夹上传：进入非磁盘根目录后底部出现“确定”，`readFolder` 递归读取（200 文件 / 100 MiB / 单文件 10 MiB，跳过 `.tether-trash`）并以 `webkitRelativePath` 交给 DSH；临时 `folder-upload-test` 的 `a.txt`/`b.txt` 上传后对话框出现两个附件。
3. 根来源：复现确认工作区与磁盘都来自目标设备（DESKTOP 工作区 `C:\Users\Administrator...`、盘 C–G；LAPTOP 工作区 `C:\Users\14675...`、盘 C/D）；分组标题加设备名以消除误读。
4. 本地拖入保存+上传：捕获 composer `drop`，先 `onAddFiles` 上传，再后台写入目标 `D:\TetherDrop`；真机 `drop-test-2.txt` 出现附件，提示保存到 `D:\TetherDrop\drop-test-2.txt`，磁盘内容一致。
5. 存储路径：只走 D 盘（`D:\TetherDrop`，策略拒绝时 `D:\TetherWorkspaces\TetherDrop`），不回退 C；Node 新增 `/tether-device-fs/write_chunk` 路由与测试。

门禁：mjs 224/224、cjs 6/6、client pytest 142 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。0.2.57 已发布（CI `41394307331`，05:33:33Z，签名清单验签通过，app 1,748,841 B / plugin 1,345,779 B / node 79,668 B），Hub mirror 0.2.57；LAPTOP Node+APP 19.5 s、插件 19.5 s，DESKTOP 源码 APP 重启、本机插件 0.2.57。两机 app/node/plugin 均为 0.2.57。LAPTOP 真机：分组显示 `工作区 · LAPTOP-01` / `此电脑 · LAPTOP-01`；拖入 `laptop-drop-test.txt` 后附件出现、保存到 LAPTOP 自己的 `D:\TetherDrop`；远端文件与附件已清理。

## 2026-11-02 v0.2.56 白屏回归、加载叠层与设置页

本轮处理 0.2.54 之后主人反馈的 4 条问题，版本元数据到 0.2.56（0.2.55 先发布，随后补了 DSH 内联叠层修复）：

1. 白屏：`SurfaceDeck` 的 `ids` 原先按 `[当前设备, ...最近]` 计算，切换设备时数组重排，React 移动 iframe DOM 节点；iframe 重新插入文档会用过期 ticket 重载并变成空文档（`<html><head></head><body></body></html>`）。改为 `mountedRef` 固定挂载顺序，切换只改 `visibility/z-index`；非聊天页 deck 改为绝对定位 + `visibility:hidden`，不再占布局。预加载 iframe 用 `visibility:hidden` 保持 1416×829 真实尺寸，不再 `display:none` 成 0×0。
2. 选择器加载：删除 `dsh.js` 的固定 22px 状态白条、旧错误条和“文件从目标电脑读取…”页脚；`TargetFileExplorer` 用资源管理器同款绝对定位 `tether-dir-loading` 叠层，加载时保留旧列表；错误改为可重试/关闭浮层。`enter()` 不再先清空 entries，避免切换目录时列表闪空。**0.2.56 补**：DSH 页面不加载共享 UI 的全局 CSS，叠层在 DSH 里曾退回 `static` 高 20px；现改为内联 `position:absolute; inset:0; z-index:4`，转圈用 SVG `animateTransform` 自包含旋转。
3. 设置页：重做为左侧五分区（账号/连接/工作区/本机设备/关于），增加 `extraSections` 扩展接口；账号头像可点击选图，经 canvas 裁成 128×128 JPEG 存 `tether.accountAvatar`，活动栏同步显示；删除解释性长句、重复的刷新/更新/权限/切换账号入口；密码标题与按钮去重。
4. 同时修正诊断中发现的本机 surface 路径问题：Electron host 的 `apiBase` 为空时不再尝试本地 54073 回环（该路径会让插件跨端口调用本地代理时丢会话）；保持 0.2.54 的 Hub surface 路径。后续若启用本地直连，需同时补 `credentials`/CORS 会话。

真机证据（DESKTOP-LOCAL WebUI + 本机 DSH 插件）：互联页 `main` 1416×829，deck 绝对定位且不占布局；连续 3 次 DESKTOP↔LAPTOP 往返，两个 iframe 文档长度保持 720,118 / 736,068 B，标签切换 256 ms；设置页五分区、头像上传后 `tether.accountAvatar` 3,625 B、活动栏 `<img>` 22×22，测试头像已清除；转移页目录加载叠层 505×628、旧列表保留。0.2.56 DSH 选择器实测：无 22px 状态条、无解释页脚；加载叠层 639×429、`position:absolute`、`inset:0`、`z-index:4`、居中 SVG 旋转，旧列表保留。

门禁：mjs 222/222、cjs 6/6、client pytest 142 passed / 1 skipped、`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 全部通过。Electron QA 隔离壳仍受本机环境/登录态影响，未用它替代真机结论。0.2.55 已发布（CI `41344909191`，20:07:25Z，签名清单验签通过，app 1,745,709 B / plugin 1,343,083 B / node 79,648 B）；LAPTOP-01 Node+APP 22.4 s、插件 22.2 s。0.2.56 已发布（CI `41386893828`，04:12:39Z，签名清单验签通过，app 1,746,202 B / plugin 1,343,349 B / node 79,648 B），Hub mirror 0.2.56；LAPTOP Node+APP 19.5 s、插件 16.5 s，DESKTOP 源码 APP 重启到 0.2.56。最终 DESKTOP surface 文档 736,068 B、LAPTOP 720,118 B 在多轮切换中保持；互联页 1416×829；选择器 639×429 绝对叠层、无状态条。LAPTOP 状态字段曾滞后报插件 0.2.55，重启其 Node 后两机 app/node/plugin 均报告 0.2.56。

## 2026-11-02 v0.2.54 资源管理器、连接灯与设备工作区常驻

本轮把主人 7 条反馈全部落进共享源码，版本元数据到 0.2.54：

1. 原生加号成为唯一入口。删除了插件里额外的“目标电脑文件…”按钮和重复的 `tether-target-file` 命令；`dsh.js` 直接拦截 Composer 唯一的隐藏文件输入，打开共享资源管理器。
2. 互传图标改成外圈加双向箭头；文件转移页补齐真实的资源管理器能力：新建文件夹/文件、重命名、删除（进 `.tether-trash`）、同名冲突“覆盖/保留两者”、指针拖拽带浮层与落点高亮、Ctrl+A/C/X/V、右键菜单、图标工具栏。
3. 弹窗标题改为“资源管理器”，副标题只显示设备名，不再加“目标电脑 ·”；加载/错误文案放进固定 22px 状态行，列表第一行 Y 坐标加载前后不变。
4. 三处文件浏览共用 `file-cache.js`：目录列表 20 秒内存缓存、并发去重、统一失效；资源管理器、对话框选择器、互传两侧都走同一缓存键。`dsh.js` 的桥接也读同一缓存。
5. 连接灯改为实时：`/api/state` 成功 8 秒内直接显示绿色，Hub/Node 探测只在失败时转红；无需打开面板或点刷新。设置页连接区显示“已连接 / 168 ms / 02:20:45”实测。
6. 设备工作区从“45 秒后卸掉预热 iframe”改为 `SurfaceDeck` 常驻：当前设备 + 最近 2 台（最多 3 台）保持挂载，切换只切显隐；设置里可关闭“保留最近设备工作区”。实测两次回切可见耗时 9–29 ms，已加载的 LAPTOP 回切 `document.readyState=complete` 38 ms；冷下载仍约 8–14 秒（4.2 MB + 1.9 MB 插件包）。
7. 删除侧栏底部账号条；活动栏底部改为盾牌、齿轮、头像。齿轮进设置“连接”，头像进“账号”（头像/显示名称可改），不再把头像当设置入口。

真机证据（DESKTOP-LOCAL，0.2.53 源码 + 0.2.54 WebUI）：互传页左侧新建 `tether-ui-check` 成功，拖 20 B 文件到 LAPTOP 弹出同名冲突，选“保留两者”生成 `tether-picker-check (2).txt` 并 100% 完成；随后两项临时文件均已删除。设置齿轮打开“连接”，头像打开“账号”；活动栏 DOM 只有 `文件权限/设置/账号` 三个底部按钮，`.tether-account-bar` 不存在。

门禁：client pytest 142 passed / 1 skipped；mjs 222/222（Electron QA 隔离壳另计）；cjs 6/6；`build.mjs --check`、`build-web.mjs --check`、`validate_versions()` 通过。Electron QA 隔离壳仍受本机环境/登录态影响未通过，未用它替代真机结论。0.2.54 已发布（CI `41338266729`，签名清单验签通过），Hub mirror 已刷新；两机 app/node/plugin 均为 0.2.54，DESKTOP/LAPTOP surface 200（309 ms / 157 ms）。

## 2026-10-30 v0.2.29 本地发行准备（未发布）

候选分支 `dev/client-auth-20261030` 的三组件版本元数据已准备到 0.2.29，包含登录 authority 作用域修复、更新/NativeSurface 迟到状态竞态处理和原生 Composer 附件路由。隔离本机 DSH Web Host + QA Node 的 Composer → 目标工作区附件链路已通过；物理 LAPTOP-01 未安装或复验。父代理报告 Python 125 passed / 1 skipped、Hub/server 116 passed、Node 199 passed。项目 venv 的 `validate_versions()` 通过；本地 unsigned APP/Plugin/Node ZIP 与清单的版本、大小及 SHA-256 匹配，离线检查确认没有 `.scratch`、`.dev-harness`、私有 server 源码或 QA fixture。当前清单无签名；CI 签名和公开 Release 尚待完成。

## 2026-10-30 Codex 更新状态候选（未发布、未安装）

在现有登录 UI 开发分支中修复更新请求竞态；源码与两种客户端构建产物同步。最终父代理验证：24个Node测试文件、187用例全部通过（退出0）；共享源码/bundle检查通过；Web两次标准构建SHA-256一致。覆盖迟到状态/错误、连接地址代际、失败/缓存来源、安装后版本追平和灰度资格保留。此处不表示两机更新中心验收通过，也不改变正式客户端版本。

干净系统安装仍依赖 Python/npm，部分配置要求手工文件；小白安装与商店发布资格尚未完成。

更新日期：2026-10-29。

> 交接：给 Codex 的接手说明见 [HANDOFF-2026-10-29.md](HANDOFF-2026-10-29.md)（现状、故障证据、更新契约、红线与排期）。

## 2026-10-30 开发者版本：共享登录 / 邀请 / 配对 UI（未发布正式版）

分支 `dev/client-auth-20261030`，最新提交见 tag `dev/client-auth-20261030-r2`；基于 `origin/main` `98c102d`（0.2.28 冻结基线）。只改共享 `connection-panel.js` 与 APP 的调用点，DSH 插件与 APP 共用同一份源码和构建产物；**未改版本号、未发布正式 Release**。

- **四种入口**：连接抽屉新增“登录”（邮箱/密码/TOTP）、“修改密码”（当前密码/新密码）、“邀请码注册”（邀请码/邮箱/密码）、“配对码兑换”（配对码/设备 ID/名称）四个表单；服务地址可填自建/默认，提交后走 `POST /api/auth/login`、`/api/auth/password`、`/api/auth/accept-invite`、`/api/pairing/exchange`。修改密码使用当前登录 token，成功后静默换新 token 并提示其他设备旧登录失效。
- **登录态**：登录或注册成功返回个人 API token，写入 `localStorage['tether.hub']`（`{url, token}`），关闭抽屉、标记 Hub 在线、提示登录邮箱，并触发一次 `probeConnection`；配对兑换显示一次性设备 token，供 Node 配置使用。
- **APP 接线**：`app.js` 把默认服务器地址、本机设备 ID/名称、平台传给连接面板，并在 `onConfigured` 中落盘凭据与刷新连接状态；DSH 插件自然复用同一面板。
- **实测**：dev harness（`.dev-harness/`，未提交）连本地 dev Hub `127.0.0.1:18896`，登录 `member@dev.test` 返回 token，修改密码按钮由禁用变为可用，完整改密往返两次均提示成功，旧密码恢复后 200、临时密码 401；此前已实跑 owner 登录、邀请码注册、配对码兑换。服务端 72 tests、客户端 175 mjs / 6 cjs / 125 pytest、`build.mjs --check` 与 `build-web.mjs --check` 均通过；重建 `packages/dsh-plugin-tether-client/lib/client.js` 与 `packages/tether-ui/web/dist/app.js`。
- **边界**：生产 Hub 仍为冻结基线 `d6dabd6`；该分支未部署、未分发，等待主人审查后再决定合入与正式版本。

## 2026-10-29 接手修复（随 0.2.25 发布）

- 更新入口灯与更新卡同源：`updateTriggerState` 按在线设备 capability 取 node/plugin/app，known 优先于历史错误，离线设备不参与；瞬时 `InvalidStateError`/网络错误重试一次，失败结果不进入 5 分钟缓存。实测 DESKTOP-LOCAL 与 LAPTOP-01 两卡“已是最新”、头部 `current` 绿色。
- 跨节点旧节点响应兼容：`responseBelongsToDevice` 在响应缺 `device_id` 时按旧节点放行，有值必须匹配；覆盖预览、保存、新建、重命名和版本轮询。实测 LAPTOP-01 `D:\TetherWorkspaces\Tether-demo-check-1aba3266.txt` 打开成功，无“目标设备身份校验失败”。
- Monaco 主题跟随宿主：读 `body/html[data-ds-dark-theme]`，MutationObserver 调 `monaco.editor.setTheme`。实测亮色 `rgb(255,255,255)` → 加暗色标记 `rgb(13,17,23)` → 移除恢复亮色。
- 重建 `client.js` 与 `dist/app.js`，重装 DSH profile 并重启；`build.mjs --check` 通过。更新灯修复同时让 Codex 16:23 的 native surface 去边线守卫生效：APP 原生工作区侧栏边缘像素由 `219,220,220` 变为底色 `249,250,251`。
- DSH 本机卡常红/`插件 -(-)` 的独立根因是源码 updater 缺 `tether/release.py`、`tether/ed25519.py`；补齐后 `install-plugin.ps1` 复制七个 updater 文件，DSH 更新中心本机卡恢复 `0.2.24(0.2.24)` 并显示“已是最新”。
- 门禁：166 mjs / 6 cjs / 123 pytest（1 skipped）/ `build.mjs --check` / `build-web.mjs --check` / `validate_versions()`。已随 0.2.25 发布；LAPTOP-01 仍为 0.2.24，跨机编辑所需的 `version/editable` 字段待其一键更新后复验。
- 证据：`.scratch/fix-update-green.png`、`.scratch/fix-remote-open.png`、`.scratch/dsh-update-center-final2.png`、`.scratch/webui-code-monaco.png`。

## 资源管理器视觉审查（0.2.25 已发布）

- 主人已于 2026-10-29 认可第五版；`0.2.25` 已于 2026-10-29T15:12:25Z 正式发布，清单验签通过；两机安装状态待更新后回填。
- 第一版因蓝色渐变/蓝色状态条、普通代码仍有切换按钮、标签页与整体质感不足被主人驳回。第二版继续复用既有远端文件协议和资源树，没有从零重构：顶栏、活动栏、资源树、命令区、标签栏、编辑区和状态栏全部改为白灰黑中性层级，仍靠色差而不是常驻硬边线分区；拖动把手只在悬停/拖动时出现。
- 删除旧手写代码高亮旁路，代码与 Markdown 编辑统一使用 Monaco `0.57.0`。普通代码打开后直接编辑，不显示预览/编辑切换；只有 Markdown 与 CSV/TSV 等确需渲染的类型保留视图切换。Monaco 补齐 TOML/INI、YAML、XML、SQL、Shell、PowerShell、Go、Rust、C#、PHP、Ruby、Swift、Kotlin、Lua、R、Perl、Dart、Dockerfile、Less、SCSS 等语言注册，并采用接近 VSCode Light+/Dark+ 的语法色板。
- 文件标签第三版改为中性的扩展名徽标（`PY`/`JS`/`TOML` 等）、圆角页签与悬停关闭，不使用通用文件图标或彩色强调线。第五版继续保留 Monaco 22px 装饰区与 13px 白色留白，但删除第四版新增的人工分界线；亮色三层为文件树 `#efeff1`、行号区 `#f7f7f8`、代码区 `#ffffff`，暗色行号区为 `#232325`。`renderLineHighlight='line'` 继续保证当前行背景仅覆盖代码区，活动行号只加深文字颜色，不叠加矩形背景。蓝色只允许作为代码语法色，不作为工作台 chrome。目录命令区现有新建/复制/粘贴/重命名/删除逻辑保留，跨设备粘贴仍拒绝混用来源设备。
- 仓库版 `http://127.0.0.1:18892/` 已真实加载第五版 `dist/app.js`；在 DESKTOP-LOCAL 打开 `E:\遥望科技实习项目\tether\tether\node\agent.py`，实测文件树、行号区、代码区分别为 `rgb(239,239,241)`、`rgb(247,247,248)`、`rgb(255,255,255)`，留白层为 13px 且左边框宽度为 0。活动行号背景透明、文字为 `rgb(41,41,41)`，当前行代码背景从代码区起点开始。该页面是发布前的审查证据；0.2.25 已发布，安装状态待更新后回填。
- 本轮门禁：MJS 167/167、CJS 6/6、Python 123 passed / 1 skipped、定向代码视图 8/8、`build.mjs --check`、`build-web.mjs --check`、版本校验全部通过。

## 编辑器与目标端文件语义（0.2.25 已发布）

- 资源管理器代码编辑已替换为 Monaco `0.57.0`：worker 与 CSS 由现有构建器内嵌，Web 与 DSH 共用同一运行时；model URI 包含目标设备和路径，状态栏显示目标、路径、光标、编码与换行。
- Node 文件服务为可编辑文本返回 SHA-256 `version`、`device_id`、`encoding`、`newline`、`editable`；写入使用 `expected_version` 防止覆盖目标端外部修改，并保留 UTF-8 BOM/UTF-16/GB18030 与 CRLF/LF。UI 每 5 秒及窗口聚焦检查目标版本；干净文档自动刷新，脏文档提示冲突。
- DSH 加号菜单候选保留原“文件”（操作者本机上传），并注册“目标设备文件”（目标 DSH 会话工作区）。本机源码插件已重装，真实 WebUI/DSH Monaco 可见；LAPTOP-01 仍运行 0.2.24 bundle；0.2.25 已发布，跨机菜单项验收待其一键更新后完成。
- 连接/更新入口统一使用状态圆点：在线/当前为绿、离线为红、连接检测中为琥珀、未知为灰、更新检查失败为琥珀、发现更新为红；后台更新检查失败仍不弹红 toast、不点红点。
- 真实 DESKTOP-LOCAL API 创建/保存后磁盘立即变化；外部改写后旧版本保存返回 `conflict` 且目标内容未被覆盖。完整门禁：Python 123 passed / 1 skipped、MJS 164/164、CJS 6/6、bundle check 与版本校验通过；定向 Python 16 passed、共享 UI/DSH 19 passed。

## P0：Node↔Hub WebSocket 稳定性（0.2.25 已发布，待两机安装验收）

- 14:34–14:38 的 Node 重连与 Hub 接受新 WSS 的时间逐次对齐；Hub、surface mux、Caddy 均未重启（`NRestarts=0`），另一来源节点保持连接，未发现 Hub 全局事件循环停顿证据。客户端环境存在 `127.0.0.1:7890` HTTP/SOCKS 代理，而 `websockets>=15` 默认继承环境代理；故障形态符合该路径在网络/代理切换时黑洞。
- 源码候选让 Node 控制面 WSS 在运行库支持 `proxy` 参数时显式直连；更新结果绑定原接收 WebSocket，旧任务不得跨重连发送，closing socket 的 `InvalidStateError` 只按传输中断处理。
- 离线门禁：pytest 121 passed / 1 skipped、mjs 158/158、cjs 6/6、bundle check 与版本校验通过。公网只读观察持续 603.9 s：直连 Ping 59/59，P50 125 ms、最大 547 ms；DESKTOP-LOCAL 与 LAPTOP-01 无 online 状态变化，state/manifest 零失败，三组件 latest 始终 0.2.24。
- 本机实验台源码 Node 于 15:46:09 重启并加载候选；连续运行 12.8 分钟后，15:46:10 注册以来日志无新 keepalive timeout、断线或 `InvalidStateError`，DESKTOP-LOCAL 与 LAPTOP-01 均保持 online。两台设备分别显式检查 node/plugin，四次均返回 `ok=true`、current/latest=`0.2.24`。
- 边界：客户端修复已随 0.2.25 发布，但尚未安装到两台运行版；服务端 ping 参数、Hub/Caddy 部署未改。

## 2026-10-30 单一发布快照热修（0.2.28 已发布）

- `v0.2.28` 已发布：tag → `e6ce3c0`，工作流 `40918330411`；资产 app 1,658,001 B / node 73,558 B / plugin 1,302,899 B / manifest 1,566 B；草案与 Hub 清单验签、大小/SHA 一致；Release `17:10:56Z`，Hub 在 `17:13:23Z` 切到 0.2.28。
- `v0.2.27` 也已发布：tag → `6437901`，工作流 `40917015921`；保留作 0.2.28 的前置热修。
- 0.2.27 按组件取 max 仍会被 Node 的 `disk-cache` 拖住：本机 app/node latest 停在 0.2.26，插件 0.2.27。0.2.28 改为取本轮所有组件中的最高 latest，统一写给全部卡片；所有组件同版本发布，因此一个刷新只出现一个版本号。
- 保留 0.2.27 的解阻：本机产品更新跳过已最新 Node；Node 检查失败只记为部分失败，插件照常 check/prepare/apply；设备序列跳过已最新组件。
- 门禁：pytest 125/1、mjs 175、cjs 6、bundle check、Web 重建哈希一致、`validate_versions()`。本机 APP/Node 已是 0.2.28，DSH profile 仍 0.2.24、updater 已刷新到 0.2.28；强制刷新后所有卡片 latest 统一为 0.2.28，本地插件 `0.2.24(0.2.28)` 一键待点击验收。

## 2026-10-30 更新一致性与本地插件入口热修（0.2.27 候选）

- 主人实测指出：同一次刷新里本机 0.2.26、远端 APP/Node 0.2.25、插件 0.2.26 混显；DSH 本机插件卡点“一键更新”无任何动作。证据：`00:49–00:52` Node 日志 `check node failed: InvalidStateError`，DSH updater 目录没有 `prepared/applied-plugin.json`，说明本机插件更新先被 Node 检查失败挡住。
- 修复：`refreshUpdateCenter` 在所有检查结束后调用 `normalizeUpdateLatest`，把同一次刷新内各组件/设备的 latest 统一到同一快照并重算 `update_available`；本机产品更新在 Node 已是最新时跳过 Node 检查，Node 失败只记为部分失败，插件照常 check/prepare/apply；设备一键序列跳过已最新的组件。
- 新增回归：`normalizeUpdateLatest` 混合版本统一、`updateNeededFor` 当前版本判断、产品更新跳过当前 Node、刷新后归一化。
- 门禁：pytest 125/1、mjs 175、cjs 6、bundle check、Web 重建哈希一致、`validate_versions()`；本地 0.2.27 资产已构建，待发布和本机一键验收。

## 2026-10-30 更新状态机与本地更新修复（0.2.26 已发布）

- `v0.2.26` 已发布：tag → `89441d3`，工作流 `40913233051`；资产 app 1,656,746 B / node 73,558 B / plugin 1,302,240 B / manifest 1,566 B；草案与 Hub 清单均验签、大小/SHA 一致；Release `2026-10-29T16:39:47Z`，Hub 在 `16:43:13Z` 切到 0.2.26。
- 远端 `0.2.24 → 0.2.25` 一键更新已由主人在 LAPTOP-01 实测完成：`16:17:27` 离线、`16:17:31` Node 0.2.25 回来；`16:18:03` 再次离线、`16:18:09` APP 0.2.25 回来；插件最终 0.2.25，更新中心显示“已是最新”。
- 设备卡改为单一运行态：Node → 插件 → APP 全程“正在更新”，直到最终 refresh 完成才切“已是最新”；失败切“更新失败 / 重试”。逐组件 busy 不再覆盖外层运行态；运行期间顶部更新灯保持 `checking`，不闪中间态。
- 本地插件 `current_version` 改取已安装 profile；源码 checkout 只作诊断。实测 profile `0.2.24`、updater `0.2.26` 的强制 check 返回 `current_version=0.2.24`、`latest_version=0.2.26`、`update_available=true`；APP 更新中心 DESKTOP-LOCAL 卡显示 `插件 0.2.24(0.2.26) + 一键更新`，尚未点击安装。
- 插件 zip 增加 `packages/tether-dsh-surface/updater/tether/node/dsh_restart.py`；`install-plugin.ps1` 在源码存在时刷新旧 updater；本地插件 apply 若 `restart_scheduled=true` 自动重启 DSH，否则保留“立即生效”回退。
- 连接灯挂载即探测并每 15 秒刷新，不依赖连接面板；更新检查每 5 分钟刷新。
- 门禁：pytest 125 passed / 1 skipped、mjs 172/172、cjs 6/6、`build.mjs --check`、Web 重建哈希一致、`validate_versions()`。0.2.26 已发布；本机 APP/Node 已是 0.2.26，DSH profile 仍 0.2.24 且已准备一键更新；本地点击和两机 0.2.26 安装验收待回填。

## 当前实测状态：v0.2.25 已发布

- tag `v0.2.25` → `ed49c23`；发行工作流 `40898090981` 成功；资产 app 1,654,227 B、node 73,521 B、plugin 1,298,504 B、manifest 1,566 B；manifest Ed25519 验签通过、大小/SHA 与下载资产一致；Release 已发布（2026-10-29T15:12:25Z）。
- Hub `/releases/manifest` 于 2026-10-29T15:13:02Z 返回 `X-Tether-Manifest-Version: 0.2.25`、`stale=0`，三组件 latest 均为 `0.2.25`；Hub 清单签名验证通过，大小/SHA 与 GitHub 资产一致（发布后 37 秒）。
- 0.2.25 内容：资源管理器 Monaco 编辑与中性工作台、目标端文件 `version/editable` 与保存冲突检测、更新灯与卡片同源、Node 控制面 WS 绕开环境代理并把更新结果绑定原连接、源码 updater 补齐 `release.py`/`ed25519.py`。
- 门禁：pytest 123 passed / 1 skipped、mjs 167/167、cjs 6/6、`build.mjs --check`、Web bundle 重建字节一致、`validate_versions()`。
- 边界：发布时 DESKTOP-LOCAL 与 LAPTOP-01 仍运行 0.2.24；本机与跨节点一键更新、跨机 Monaco 与目标设备文件菜单验收待主人更新后回填。

## 当前实测状态：v0.2.24 已发布

- tag `v0.2.24` → `a6de4a3`；发行工作流 `40828646049` 成功；资产 app 412,251 B、node 72,254 B、plugin 416,117 B；manifest 验签通过、大小/SHA 一致；Release 已发布（2026-10-29T06:23:28Z）。
- 插件本机面板不再内嵌 DSH：桌面宿主顶层是 `dsh-app://app`，DSH 的会话 Cookie 为 `SameSite=Strict`，127.0.0.1 子 frame 收不到；`dsh-app` 子 frame 又缺 preload，会停在 `Loading plugins…`。本机显示“已在 DSH 中”，远端设备仍走 Hub surface；真机窗口（CDP 取证）无 401、无卡死。
- 更新中心 latest 统一取清单值：本机 `插件 0.2.24(0.2.24)/Node 0.2.24(0.2.24)`，LAPTOP-01 同为 `0.2.24(0.2.24)`；后台自动检查失败不再弹红 toast、不再点亮“更新”红点。
- 远程更新 LAPTOP-01（0.2.21 → 0.2.24，目标端零手工）：Node 19 文件后自动重启；插件 40 文件后 DSH 自动重启并清掉 `restart_required`；APP 34 文件后自动重启。两机 APP/Node/插件均 `0.2.24`，surface 可用。
- 本机实验台：仓库包 `0.2.24`，APP/Node 重启后上报 `0.2.24`；DSH desktop profile 指向仓库包并已加载 `0.2.24`。
- 已知边界：Hub mirror 的 GitHub latest 解析缓存 `latest_ttl=300s`（服务端 `tether-harness-server`，不在本仓），发布后最多约 5 分钟内仍可能显示旧 latest；节点/APP 的状态文件会保留 `restart_required=true`，UI 以运行版本判定完成，不阻塞更新链。

## 当前实测状态：v0.2.21 已发布

- tag `v0.2.21` → `5d01994`；发行工作流 `40821192816` 成功；资产 app 410,118 B、node 71,555 B、plugin 415,137 B，manifest 验签通过、大小/SHA 一致；Release 已发布。
- 修复两个本机侧问题：① Electron 在 DSH 重启后保留了同端口的旧会话 cookie，即使换新 token 也停在 `dsh web authentication required`；现在加载/重建 iframe 前清掉该 loopback origin 的 cookies/localStorage。本机 0.2.21 重启后原生页 `hasComposer=true`。② 本机 APP/插件更新器仍走 GitHub latest 的边缘缓存，卡片 latest 停在 0.2.19；现在优先用 Hub mirror（`hub.json` / app-context `serverUrl`），实测两者 `latest_version=0.2.21`、`manifest_source` 为 Hub mirror。
- 本机实验台与 LAPTOP-01 均已 `0.2.21`；远程更新（0.2.20 → 0.2.21，目标端零手工）：Node 19 文件、插件 40 文件后 DSH 自动重启、APP 34 文件自动重启，两机 APP/Node 0.2.21。
- 门禁：155 mjs / 6 cjs / 112 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.20 已发布

- tag `v0.2.20` → `965adf1`；发行工作流 `40819992563` 成功；资产 app 409,414 B、node 71,554 B、plugin 414,910 B，manifest 验签通过、大小/SHA 一致；Release 已发布。
- 修复两个 0.2.19 之后出现的回归：① DSH 自动重启后 APP 原生页停在 `dsh web authentication required`——描述符 token 未变但宿主会话已换；现在节点在 surface 描述符里返回 DSH host 的 `pid`/`updated_at`，APP 在 pid 变化时重建 iframe 并重新认证。② 本机插件卡 latest 仍显示 0.2.18——插件本地更新器走了 GitHub latest 的边缘缓存；现在更新器先通过 release API 解析 tag（5 分钟缓存）再取清单。
- 本机实验台与 LAPTOP-01 均已 `0.2.20`。远程实测（目标端零手工）：Node 19 文件、自动重启；插件 40 文件、DSH 自动重启后 `restart_required=false`；APP 34 文件、自动重启后 0.2.20 在线；两机 APP/Node 均 0.2.20。
- 门禁：153 mjs / 6 cjs / 112 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.19 已发布

- tag `v0.2.19` → `66fdef1`；发行工作流 `40818499641` 成功；资产 app 408,693 B、node 70,969 B、plugin 414,448 B，manifest 验签通过、大小/SHA 一致；Release 已发布。
- 远程插件更新现在自己收尾：插件 apply 记录目标 DSH 的 host pid，调度一个 detached 重启帮手关闭并重开 DeepSeek Harness；新 host 回写描述符、pid 变化后 `restart_required` 自动清除，链路等它完成再继续。正常路径不再需要人在目标机上重启 DSH。
- 本机实验台与 LAPTOP-01 均已 `0.2.19`。远程实测（DESKTOP-LOCAL → LAPTOP-01，目标端零手工）：Node 重启后约 5 s 以 0.2.19 重新注册；插件 40 个文件、DSH 自动重启后约 12 s `restart_required=false`、运行时 0.2.19；APP 34 个文件、重启后约 10 s 以 0.2.19 重连。最终三组件均 0.2.19、在线、surface 可用。
- 门禁：152 mjs / 6 cjs / 111 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.18 已发布

- tag `v0.2.18` → `787aa3c`；发行工作流 `40816719901` 成功；资产 app 405,627 B、node 68,122 B、plugin 413,538 B，manifest 验签通过、大小/SHA 一致；Release 已发布，Hub mirror 已切到 `0.2.18`。
- 修复远程一键更新的链路：节点更新重启的窗口里，后续组件的 check 会拿到 400 `device_offline`，原实现直接 `return`，APP 步被静默跳过。现在每个组件独立执行、瞬时错误重试 3 次、失败汇总提示，APP 重启仍按 `app_version` 验收；远程插件装好后显示“插件待重启 DSH”，不再假装已是最新。
- 本机实验台已升到 `0.2.18`；LAPTOP-01 为 Node/APP `0.2.17`，三组件均能看到 `0.2.18` 可更新（`manifest_source` = Hub mirror）。插件运行时仍需目标 DSH 重启一次。
- 门禁：151 mjs / 6 cjs / 109 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.17 已发布

- tag `v0.2.17` → `fdc9e35`；发行工作流 `40812163945` 成功；资产 app 404,944 B、node 68,122 B、plugin 413,162 B，manifest 验签通过、大小/SHA 一致；Release 已发布，Hub mirror 已切到 `0.2.17`。
- 修复“发布后强制刷新仍显示旧 latest”：UI 的强制刷新只清了渲染器缓存，Node 与 APP/插件本地更新器仍用 10 分钟磁盘清单缓存。现在 Node 的 check 强制拉取（status 仍缓存），APP 与 DSH 插件的 check 命令带 `--force`；本机实测 `manifest_source` 为 Hub 地址而非 `disk-cache`。
- 本机实验台已升到 `0.2.17`（源码安装，desktop profile 指向仓库包）；LAPTOP-01 仍 `0.2.15`，旧节点的缓存最多 10 分钟后才会看到 `0.2.17`，届时用更新中心直接升 `0.2.17`。`0.2.16` 的制品仍有效，但被 `0.2.17` 取代。
- 门禁：149 mjs / 6 cjs / 109 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`。

## 当前实测状态：v0.2.16 已发布

- tag `v0.2.16` → `8343fae`；发行工作流 `40810305861` 成功；4 个资产已下载：三组件均 `0.2.16`，大小/SHA-256 与 manifest 一致，`verify_signature` 通过（app 404,824 B、plugin 413,149 B、node 68,030 B）；Draft 已发布，Hub mirror 已切到 `0.2.16`（`released_at 2026-10-29T03:09:34Z`）。
- 本机实验台为源码安装（APP/Node/插件 0.2.16，desktop profile 指向仓库包）；LAPTOP-01 在线 `0.2.15`，待通过更新中心升级；TETHER-REMOTE-TEST 离线。
- 发布前门禁：149 mjs / 6 cjs / 108 pytest（1 skipped）、`build.mjs --check`、`validate_versions()`；PR #11（51 文件 +3416/−387，15 提交）。

## 实验台修复：本机 DSH 工作区直连 + 更新中心版本行（2026-10-29）

- 本机（DESKTOP-LOCAL）打开 DSH 原生工作区失败：走公网 Hub 时，DSH 启动期核心资源在网关 30 s 截止点返回 502（含插件的组合包 825 KB gzip 仍用了 14 s），DSH 报 `web boot: 1 entry did not activate`；直连 `127.0.0.1:57168` 约 1 s。修复为本机设备 surface 走节点回环 console：console 新增 `GET /api/devices/{id}/dsh/surface`（返回 `?token=` 地址，descriptor 不可用 409），Web 服务的本机快路径加入 `/dsh/surface`，UI 接受同机 token URL 并跳过“Hub loopback”误判。提交 `536832f`。真机：dev APP iframe 指向 `127.0.0.1:53057/?token=…&tether_native=1`，首屏正常，无 HARNESS 失败页。
- 插件端（DSH 面板）原先仍从 Hub 取 surface：DSH 重启后节点里旧 Cookie 失效，面板显示 `dsh web authentication required`。修复：`createDshHost.surfaceBase` 对本地设备返回 18892（APP 服务快路径，失败回退 Hub），节点 `NativeSurface._http` 遇 401/403 清空 jar 重新登录并重放一次；轮询对同机 token URL 比较 token，同端口重启也能换新。提交 `ca196eb`。真机：DSH 面板内层 iframe 为 `127.0.0.1:54805/?token=…&tether_native=1`，显示工作区而非认证错误。
- 更新中心版本行改为固定模板：本机 APP 卡 `APP 0.2.16(0.2.15)/Node 0.2.16(0.2.15)`，本机插件卡 `插件 0.2.16(0.2.15)/Node 0.2.16(0.2.15)`，其他设备两行同格式；删除“当前/· 最新/（已安装…待生效）”。提交 `5118572`。
- 本机实验台口径：插件与 APP 从仓库构建后直接替换本机（`desktop/install-plugin.ps1 -Restart` 把 desktop profile 指向仓库包，备份 `package.json.bak-tether-plugin-20261029-090410`；DSH 重启后插件 bundle 与仓库 `client.js` SHA-256 一致；dev APP 加载仓库 `packages/tether-ui/web`）。本机不通过更新中心更新；更新中心只用于其他节点。
- 门禁：`node --test tests/test_*.mjs` 143 passed、`cjs` 6 passed、`pytest` 108 passed + 1 skipped、`build.mjs --check` 通过。均为本机实验台结果；两机更新与发行包未做。

## UI 批次：色差分隔、代码编辑、CSV 表格编辑（2026-10-29 上午）

- 分界线改色差：树/详情、代码行号、标签栏、表格状态栏的 1px 硬边框去掉，分隔条只在悬停/拖动时显蓝色把手；行号改独立满高列（真机 755px 视口下 755px）。
- 代码页配色：关键字蓝 `#1a5fb4`、字符串绿 `#2f855a`、数字紫 `#6b46c1`、注释灰；暗色 `#7aa2f7/#9ece6a/#bb9af7`；红色不再用于语法。
- 代码编辑：`text`/`markdown` 可进入编辑，代码态带同步行号槽；Tab 插入两空格、`Ctrl+S` 保存、原生 `Ctrl+Z/Y` 撤销重做；未保存时关闭/切换先确认。真机插入 `# edited` → `Ctrl+Z` 回退 → 插入 `# saved` → `Ctrl+S`，磁盘首行变为 `# saved`。
- CSV/TSV：表头与单元格可编辑，`Ctrl+S` 走 RFC4180 序列化；XLSX 仍只读；截断文件禁用表格编辑。真机写入 `XAlice` 并保存成功。
- 目录加载：修复快速双击的预取竞态（预取 Promise 解析成 `undefined` 被当成响应，触发“目录读取失败”）；刷新改为覆盖式居中转圈，列表不再被顶部“正在刷新…”行挤压。提交 `970ff5c`。
- 门禁：149 mjs / 6 cjs / 108 pytest。提交 `f0f1fd6`、`970ff5c`。

## 当前状态：v0.2.14 已发布并完成两机更新，插件宿主待重载

- 公开 PR #8 合并（`e57931f`），tag `v0.2.14`；发行 CI `40688429123` 全绿，构建步骤内**强制验签**（缺 `TETHER_RELEASE_PRIVATE_KEY` 直接失败，产出后再验一次）。Release `v0.2.14` 已发布；匿名 `latest/download/tether-update.json` 为 `0.2.14`、`channel=stable`、签名 88 字节，三 ZIP 的大小与 SHA-256 与清单逐项一致。
- 私有 PR #6/#7 合并并部署：线上 `/opt/tether/server` = `2b0a795`，`/releases/manifest` 200 且返回签名的 0.2.14；备份 `server-20261028T123737Z`、`server-20261028T124217Z`，Hub/mux/Caddy active、`NRestarts=0`。`/releases/manifest` 改为先查 GitHub API 的 `tag_name` 再取不可变 `/releases/download/<tag>/...`——发布后 `latest` 重定向按 PoP 边缘缓存，曾让镜像多分钟停留在 0.2.13。
- 两机更新（经 Hub 的 check/prepare/apply，与更新页同一后端）：DESKTOP-LOCAL 与 LAPTOP-01 的 APP/Node 均报告 `0.2.14`；Node 重启后分别约 12 s / 6 s 重新在线，APP 由 helper 重启后回到在线。插件在磁盘/profile/`file:` 源均为 `0.2.14`。
- 数据保留：更新后 DESKTOP-LOCAL 3 个工作区、12 个会话；LAPTOP-01 2 个工作区、1 个会话；与更新前一致。未读取或输出 `hub.json` 内容。
- **未完成**：插件宿主内存仍是 0.2.13（DSH 于 18:58 启动，插件文件 20:46 才替换），需在更新页点“立即生效”或重启一次 DSH；0.2.14 的 `runtime_version` 仍按磁盘读取，会误报“已是最新”，修复已在 `next/0.2.15`（`3b37be0`）但尚未发行。

## 当前实测状态：v0.2.13 已发布，两机安装待主人验收

- 公开 PR #7 已合并；`v0.2.13` tag 指向 `5938b70ed3188a6095bda2bf32778ad9edee68ef`，发行 CI `40667788605` 成功，[GitHub Release v0.2.13](https://github.com/qi001007/tether-harness/releases/tag/v0.2.13) 已发布。APP、插件、Node 三个 ZIP 与 manifest 的版本、大小、SHA-256 均已核验；匿名 `latest/download/tether-update.json` 返回 HTTP 200，SHA-256 为 `3ce3fc8166d61e91eaefa1acc282a4d71e0f7a1774177075606aa63f6e8de507`，三个组件版本均为 `0.2.13`。`v0.2.12` 失败 tag 保留，未改写。
- 刷新旋转、请求期间忙态、错误 toast 4 秒自动消失、更新入口固定文案/状态圆点及附件测试仓库契约检查已包含在发布版本。定向回归 21/21、全量 Python 95 passed / 1 legacy fixture skip、JavaScript 96 passed。
- 隔离 Electron 动态验收确认更新中心刷新按钮旋转并在请求结束后停止、失败提示自动消失；文件资源管理器延迟 `fs/list` 约 1013 ms 时旋转矩阵持续变化，约 1080 ms 采样时已停止。此隔离 UI 证据不代表用户设备安装验收；主人两台设备安装与实际 UI 复验仍待完成。

## 当前实测状态：v0.2.11 已发布，LAPTOP-01 已升级并自动重连

- 正式 tag `v0.2.11` 指向 `591d4d689cf7a6a1408b13d1561fd9573de51cb6`；公开 PR #5、发行 CI `40654194962` 已完成，APP/插件/Node ZIP 与 manifest 的版本、大小和 SHA-256 已核对。下方“候选、尚未发布”是较早快照。
- 通过正式更新 API 对 LAPTOP-01 依次应用 Node、插件、APP；三组件安装状态均 `0.2.11`。Node apply 672 ms，观察到新版 Node 在线用时 2688 ms；APP apply 750 ms，响应后 9047 ms 观察到 APP/Node 都以 `0.2.11` 在线。该次验收经实际产品后端发起，未重复验收 UI 点击路径。
- 更新前后 `hub.json` SHA-256、1 个会话记录、3 个工作区树摘要一致。更新后的三组件联网检查 797–1250 ms，当前状态查询 781–1266 ms；运行中更新检查不会下载安装。
- 桌面 DSH 的真实 owner RPC 已返回 HTTP 200，运行/安装插件均为 `0.2.11`。LAPTOP-01 通过 owner pluginManager 安全重载返回 `application=applied`（HTTP 200，2141 ms），随后 `/tether-updates/status` 确认 current/runtime 均为 `0.2.11`；证据见 `maintenance/ui-regression.../laptop-official-plugin-reload.json`。此结果验证了本机 surface reload 流程，无需手工重启 DSH。
- 浏览器长期缓存仅用于已鉴权、成功返回的哈希 JS/CSS；动态 HTML 仍 `no-store`。已实测缓存头与 gzip，尚未将 Python HTTP 重复请求当作浏览器缓存命中证据。
- 原生对话目标设备附件选择器已在隔离真实 DSH Web Host + QA Node 验证：picker 列出 txt/bin，90B 与 4B 文件进入原生 composer，multipart 原始字节包含预期 `00 ff 41 80`。未发送消息、未调用模型；物理 LAPTOP-01 跨设备与模型上传仍待验收。首次冷加载约 32 秒的全部耗时尚未归因。桌面旧快捷方式对应的 `D:\Tether\app` 仍为 `0.2.9`，升级命令因自动审批用量限制未执行，不能称为已升级。

## 原生目标设备附件窄切片（2026-10-28）

- 候选源码：原生 iframe 的附件 slot 增加“目标设备文件…”浏览入口；owner-only RPC 确认当前 DSH `device_id`，读取端改用 DSH Host `remote.workspaceFiles` 并绑定 `sessionId`，当前只浏览该会话工作区，路径必须来自已列出的目录/文件。
- 复用安装版 MIT `ComposerAttachments` 组件保留预览、移除、重试、上传进度和拖拽；通过 `workspaceFiles.readBytes` 获取原始 `Uint8Array`，按 256 KiB 分块，单文件最多 10 MiB。目标设备或会话作用域切换后丢弃异步结果。
- 自动验证：附件桥接 JavaScript 回归覆盖原始二进制、路径 capability、权限拒绝、大小上限、设备/会话切换；另有隔离真实 DSH Web Host + QA Node 验证 `remote.workspaceFiles` 注入、原生 chip 与二进制 `readBytes` 回传。当前 Node `fs/read` 服务保持未修改。物理 LAPTOP-01 与模型上传验收待完成；未发布或安装到该设备。
- 后端通道补充证据：LAPTOP-01 的真实 owner `workspaceFiles.list` 对当前原生 Session 工作区 `.` 返回 HTTP 200 / `ok:true`（目录当前为空），证明无需给 iframe 配置额外 Hub token即可调用目标 Host API；此证据不覆盖 `readBytes`、UI 注入或模型上传验收。

## 演示前修复快照（2026-10-28 15:54）

- 防御与性能候选版本为 `0.2.11`，尚未作为正式客户端发行发布。公开 Python 全量 95 passed / 1 旧制品 fixture skip；JS 单进程全量 83 passed。实际 DSH owner 版本 RPC 已恢复 HTTP 200 / 78 ms，安装与运行插件版本均 `0.2.10`。
- 当前桌面开发 APP/Node 已加载候选修复；真实版本 status 三组件并发返回 281–500 ms。检查与安装锁分离，manifest 检查 4 秒超时、60 秒 singleflight 缓存；UI 5 分钟缓存、显式强刷、6–6.5 秒失败收敛。正常打开只检查，绝不自动安装。
- 流式转发已部署到私有 Hub；实际公网网关 bootstrap 加 DSH 模块图为 1969 ms，HTTP 200，已收到 graph。该证据不替代 Electron 实际 composer 完整渲染验收。
- 按主人明确要求，两台在线设备文件策略从 readonly 即时切换 full，未重启；桌面与 LAPTOP-01 均创建唯一测试文件并读回一致，笔记本写入+读回为 1250 ms，权限切换为 328 ms。系统与凭据目录仍保留保护。FilesPane 候选工具栏新增新建文件按钮。
- 15:52 复查 LAPTOP-01 已离线，版本接口为明确 409/device_offline；其上次验证的三组件仍为 `0.2.10`，不能把离线状态称为已验证在线。
- 未完成：原生 iframe 的上传加号接入远端文件选择器；候选客户端正式 CI/发行/两机安装；完整原生 composer 实际窗口复验。上述缺口保留，不能声称演示全功能完成。

## 当前修复：桌面 DSH 插件版本查询与更新目录漂移

- 已复现真实 DSH owner RPC `/tether-updates/status` 返回 HTTP 405；根因是插件使用旧 `connection.rpc.handle` 注册方式，而当前安装 SDK 提供 `connection.register(owner, channel, handler)`，原代码静默跳过注册。
- 已备份并热修复本机安装源和 desktop profile 的三个插件文件，空闲检查后只重启唯一 DSH 宿主。重启后真实 owner RPC 返回 HTTP 200，78 ms，`runtime_version=current_version=0.2.10`、`restart_required=false`。这是本机补丁验收，尚未发布新版本。
- 插件页面从已加载 bundle 的版本常量初始化当前版本；联网检查不再决定当前版本是否可见。更新器正在补齐 file: 安装源与 profile 同事务同步、失败回退、脏开发目录保护及多包版本漂移检测。
- APP 原生页面白屏另查到 `/plugins/events` 为持续事件流，旧代理缓冲至 EOF 后超时返回 502；流式转发及 APP 启动时 Node 就绪检查仍在实现和验证，尚不标记完成。

## 当前权威状态：v0.2.10 远程 APP 更新已通过 LAPTOP-01 真机验收

- 客户端 tag `v0.2.10`（`e9b8ad85ba757e8c5735a7cdcd9e930da75d322b`）已发布；公开 PR #3 合并，CI run `40643560927` 全绿，APP/Node/插件三份 ZIP 与 manifest 的 SHA-256 已核对并发布。v0.2.9 保留为历史版本。
- 私有 Hub 远程 APP 更新能力已部署；从 DESKTOP-LOCAL 桌面安装版提供的更新页发起了目标更新。LAPTOP-01 经该更新页一键更新后，Node、插件、APP 均报告 `0.2.10`，重启 helper 已记录 worker 启动和 APP launcher 打开。
- LAPTOP-01 APP apply API 返回 200；从 apply 响应到 Hub 再次观察为在线耗时 25.159 秒，从最后一次离线到在线为 17.688 秒。重连快照共 197 次观测，并确认 `app_version=0.2.10`。
- 更新前后 `hub.json` 摘要一致；会话数均为 1；三个工作区树哈希一致。真实 APP 启动日志也记录了 `0.2.10` 新进程启动。
- v0.2.9 在 LAPTOP-01 的远程替换曾成功但自动重启 helper 超时，运行版本未更新；此失败事实保留。v0.2.10 Explorer wrapper 已在目标笔记本完成实际重启和重连验收。
- v0.2.9 遗留的“APP 更新后尚未重新连接”失败浮层在 v0.2.10 成功后仍显示，已在验收时手动关闭；该 UI 自动清理问题仍归 F55 跟踪，不影响设备已更新和重连的验收结论。

下方表格保留各阶段记录；其中旧版本号与设备状态是历史快照，以本节当前状态为准。

| 需求 | 当前状态 | 下一步 / 验收边界 |
|---|---|---|
| DSH 插件与原生工作区 | 客户端已实现；本机宿主完成部分实机验证 | 跨设备完整原生工作区、真实会话发送和目标设备附件仍未完成实机验收。 |
| 文件、权限与审计 | 主要功能已实现并有本机回归记录 | 仍需在目标设备和独立安装环境复核。 |
| 多设备任务与连接状态 | 同设备 APP/插件已共享 DESKTOP-LOCAL 的同一 DSH Host/会话；`OK`/`SYNC` 与 `pwsh` 命令双向可见；两端文件页列同一目录；连接页字段一致；互联页本机置顶 | F34/F35 技术验证完成，待主人确认体验；LAPTOP-01 已在线并完成远程更新，但跨机真实会话、任务、命令与文件仍需单独验收。 |
| APP、插件、Node 独立安装 | DESKTOP-LOCAL 已从三份独立 ZIP 安装并真实升级到 v0.2.3：APP 窗口可见、Node `0.2.3` 在线、插件四包 `0.2.3`；v0.2.3 的 APP 首装 bootstrap 在临时干净目录通过，旧配置、数据库、工作区与 DSH 会话保留 | 仍需在第二台真实设备（LAPTOP-01）复验干净安装/共存；源码克隆只作开发路径。 |
| 更新检查与安装 | APP 更新中心完成真实升级：APP/Node/插件 `0.2.1→0.2.2→0.2.3`；官方清单、下载/SHA、暂存/安装、Node 重启、插件 DSH 重启和 APP 自更新均实际执行，数据保留；遗留重启标签不清、根 `version.json` 插件字段滞后、DSH 本机插件更新按钮仍报检查失败 | 客户端更新回滚/失败恢复、数字签名与双机更新未验收；遗留 UI/元数据问题列入后续版本。 |
| 远程 APP 更新（v0.2.10） | DESKTOP-LOCAL 已安装 APP 向 LAPTOP-01 发起 Node→插件→APP；LAPTOP-01 APP 新进程启动并重连，三组件报告 `0.2.10`，apply 后 25.159 秒内在线；Hub 配置哈希、会话数和工作区树哈希不变 | F56 已完成。v0.2.9 笔记本 helper 超时作为历史失败记录保留；后续发布照常执行发布和数据保留门禁。 |
| 响应速度（v0.2.4/v0.2.5） | v0.2.4 已发布并部署 DESKTOP-LOCAL（数据哈希不变，本机 `fs/list` 3–4 ms，PPTX 二次 6 ms）。首个部署发现并修复：本机设备会话详情轮询 404 `local route not found`（console 缺 transcript 路由）；报错条改为右上角可关闭浮层。v0.2.5 已发布（run 40627590181）并部署 DESKTOP-LOCAL，Hub 报告 Node `0.2.5` 在线；网关实测本机会话 transcript 200（`x-tether-local: 1`，13 ms），本机报错消失 | LAPTOP-01 已升级 Node/插件到 `0.2.4`，仍需装 `v0.2.5` APP；F38–F47 需在双机复验；本机直连只在 APP + 本机 Node 同时可用时生效。 |
| 可选服务接入 | 支持连接已配置的兼容服务 | 私有服务的部署与运维信息保存在私有文档；公开用户需配置自己可访问的 Hub。未完成网络可达性配置时，多设备功能不可用。 |
| 真实跨设备场景 | 同设备场景已验收；非默认测试 Node（同机）在 v0.2.1 时远端原生页白屏，升 v0.2.3 后正常并执行 `REMOTE-OK`；LAPTOP-01 已上线并完成 v0.2.10 远程更新 | 继续验收物理笔记本的跨机会话、任务、命令、文件及断线恢复。 |
| F36 项目清理 | 本地清理已完成 | 过程资料与截图已按清单归档；保留有效工程文档和历史决定，不改写先前决策。 |
| F37 服务端私有化与公开仓库发行清理 | 已完成 | 私有服务端仓库与公开客户端主分支边界已确认；旧 `v0.2.0` Release 的 ZIP 资产已删除，撤下说明已保存，tag 保留。公开客户端 `v0.2.1` 基础制品已发布；后续更新和服务端验收继续列入 F30。 |

已记录的自动化回归、官方下载/摘要检查和清单检查不能替代目标设备、干净安装或真实软件升级验收。当前已知限制包括：旧客户端需先手动安装一次 v0.2.1 更新基线；更新包尚无数字签名；远程 APP 更新已在 DESKTOP-LOCAL 与 LAPTOP-01 完成验收，但其他设备配置仍需按目标设备单独核验。

## 2026-10-31 客户端安全加固

- Electron 主窗口仅允许本地 UI origin 与 `about:blank` 导航，其他导航 `preventDefault` 并记录；`setWindowOpenHandler` 一律拒绝新窗口，仅把 http(s) 外链交给系统浏览器；surface iframe 带最小 sandbox（含 `allow-scripts allow-same-origin allow-forms allow-downloads allow-modals`，不含 top-navigation）；所有 `tether:*` IPC 在处理前校验 `senderFrame` 是主 frame 且 origin 为本地 UI origin。
- 本地 18892 反向代理改为每进程随机会话 cookie（HttpOnly、SameSite=Strict），校验同源、写请求 Origin 和 API 路径白名单；`/local-api/` 与本机设备路由同样受保护；静态文件经 realpath 边界检查；畸形 URL 返回 400，不再让主进程退出。
- 回归：`node --test --test-isolation=none tests/test_electron_security.mjs` 4/4；`tests/test_web_local_api.mjs` 4/4；全量 204 mjs / 6 cjs / 133 pytest（4 skipped）通过。真机：主窗口导航到外站被阻止并写入日志，sandboxed iframe 内无 `tetherApp`，surface iframe 带 sandbox 正常显示；代理无 cookie 401、跨站写 403、无 Origin 写 403、非白名单 API 403、畸形路径 400 且服务继续可访问。

## 2026-10-31 0.2.35 发布与更新验收

- `v0.2.35` 已发布（tag → `d560408`；CI `41213286072` 成功；manifest 签名本地验证通过；Release 于 15:10:19Z 发布）。
- Hub 更新任务改为“全部组件先下载校验，再按 Node → 入口产品应用”；Node 把重启推迟到 APP apply 时，Hub 在 APP apply 后统一等待 Node 新版本，修复了首轮 Node+APP 更新 90 秒超时；完成的任务不再出现在设备摘要里，避免白雾遮罩在下次打开页面时复活。
- LAPTOP-01：Node/APP 0.2.35，纯 APP 更新 **20.1 秒**；插件 0.2.35，耗时 **15.3 秒**，profile/source/health 均为 0.2.35。插件仍走整 DSH 重启，**未达到计划中的 5 秒热重载预算**，保留为下一阶段项。
- DESKTOP-LOCAL：源码开发版重启到 0.2.35，Node/APP 报告 0.2.35；18892 无 cookie 仍返回 401。
- 全量门禁：133 pytest（4 skipped）/ 204 mjs / 6 cjs 通过。

## 2026-10-31 连接与附件选择器

- Hub presence 看门狗：Node 每 2 秒心跳，Hub 4.5 秒超时、0.5 秒轮询。挂起本机 Node 模拟半开 WS：**3.75 秒**判定离线；恢复后 **1.71 秒**重连。Node 首次重连退避改为 0.1 秒，失败上限 2 秒。
- 控制面持久连接 P50 **111 ms** / P95 **172 ms**；新建 TLS 连接额外约 300 ms；surface 首屏约 **2.0 秒**。
- DSH 目标电脑附件选择器新增可点击面包屑、当前目录搜索、名称/日期/大小排序；定向 13 passed，全量 205 mjs。
- 未完成：插件热重载 5 秒目标（实测 15.3 秒，仍整 DSH 重启）；互联页连接/Node 启停、登录自动组网。

## 2026-10-31 文件转移与 0.2.37

- Node 新增分块写入：`write_chunk`（transfer id、offset/total、1 MiB 上限、`.tether-part.<id>` 临时文件、fsync 后原子替换）、`transfer_status`、`transfer_cancel`；完成时写一条 `transfer` 审计。回归 `test_fs_service.py` 14 passed。
- 共享 UI 新增“文件转移”页：双设备/双目录、源文件选择、覆盖策略、进度/取消/重试；传输引擎 `transfer.js` 负责分块、断点续传、冲突与源变化检测，6 个单测通过。
- 真实浏览器已渲染转移页并驱动到目标写入阶段；0.2.36 目标机因缺少 `write_chunk` 返回 `unknown fs op`，因此 0.2.37 发布后需在 LAPTOP-01 复验完整转移。
- 0.2.37 版本推进完成；全量 211 mjs / 6 cjs / 135 pytest（4 skipped）通过。
- 0.2.37 首轮真实 UI 验收发现两个前端问题：引擎发 `transferId` 而 Node 读 `transfer_id`；根目录响应晚到会覆盖用户刚输入的路径。两处已修并进入 0.2.38；Node 分块写入本身在 0.2.37 已可用。
- 0.2.37 Node+APP 更新实测 **17.1 秒**（prepare-first + defer 修复生效）；插件 25.2 秒。三组件到 0.2.37 后，0.2.38 仅修前端映射。
- 0.2.38 已发布（CI `41220473162`，签名验证、16:39:50Z 发布、16:40:23Z Hub 生效）；LAPTOP-01 Node+APP **16.1 秒**、插件任务 17.6 秒，真实插件状态/健康为 0.2.38。API 级 600 KB 传输 3 块 **8.5 秒**、目标 SHA-256 一致；从 262144 偏移续传后哈希一致；同名覆盖关闭返回 `exists`。
- 转移页真实 Chromium 验收通过：用真实输入事件选择 `D:/TetherWorkspaces`、目标 LAPTOP-01，进度 0→44%→87%→100%，600,000 字节目标文件 SHA-256 `1fd931aa42e4f8e0…` 与源一致；目标 Node 审计记录 `op=transfer, bytes=600000, result=ok`；测试文件已清理。
- 剩余：1 GB 传输与真实断网续传场景；插件热重载 5 秒；登录自动组网。

## 2026-10-31 互联页 Node 重启（0.2.39）

- Hub 新增 `POST /api/devices/{id}/node/restart`（按租户隔离、审计、离线拒绝）；Node 收到控制消息后若有 Tether 任务则拒绝，否则确认并退出/重启；APP supervisor 以退出码 75 重启 Node。
- 互联页设备右键菜单新增“重启 Node”（带确认）。
- 0.2.39 已发布（CI `41221456056`，16:51:25Z 发布，16:52:30Z Hub 生效）；LAPTOP-01 Node+APP 16.2 秒、插件 16.7 秒；重启实测 **0.80 秒离线、2.99 秒重连**，版本仍为 0.2.39。

## 2026-10-31 传输吞吐与 overlay 决策门

- 0.2.40 把读块/传输块从 256 KiB 提到 1 MiB（控制 WS 上限 48 MiB，安全）；CI `41221950421`，16:58:00Z 发布，17:02:51Z Hub 生效；LAPTOP-01 Node+APP 20.7 秒、插件 14.1 秒。
- 2,000,000 字节 / 2 块实测 **34.4 秒**、哈希一致；10,000,000 字节目标文件已生成（进程超时前未打印哈希，已清理）。有效吞吐约 **60–70 KB/s**，1 GB 需数小时——**当前公网 Hub 中转不满足 1 GB 传输目标**。
- 这触发计划里的 overlay 决策门：下一步用同一套 harness 对比 Headscale+tsnet / NetBird / Nebula，而不是继续调分块大小；overlay 必须优于优化后的 relay 才采用。

## 2026-10-31 登录设备登记基础（0.2.41）

- Hub 新增 `POST /api/devices/{id}/enroll`（登录会话、租户隔离、离线拒绝、审计）；设备令牌轮换，旧令牌保留 10 分钟宽限，避免 APP 重启期间锁死。
- APP 登录成功后经可信 IPC 调 Hub 登记，写回 `hub.json`（时间戳备份）并重启 Node；登录面板提示“设备已加入账号/设备未登记”。
- 18892 代理保留显式用户 Authorization，不再无条件覆盖为 owner token，成员会话不会被静默提权。
- 服务端 `test_device_enroll.py` 通过；全量 212 mjs / 135 pytest（4 skipped）。
- 0.2.41 已发布（CI `41223584060`，17:17:56Z，Hub 17:20:28Z）；LAPTOP-01 Node+APP 16.3 秒、插件 15.8 秒（真实状态/健康 0.2.41）。
- 更新 UI 视觉验收：拦截 update 响应后，蓝色 ↓ 按钮 title 为 `更新到 0.2.42`；点击出现白色半透明遮罩（`rgba(255,255,255,0.72)`、`blur(18px)`）和 `正在更新 Tether / 下载 APP / 42%`。
- 真实“登录→登记”仍缺一个专用测试账号：生产 `.env` 已没有 owner 密码，无法在不改生产凭据的前提下登录验收。

## 2026-10-31 共享 TargetFileExplorer

- 新增无 hook 的共享 `TargetFileExplorer`：root 分组、面包屑、上级/刷新、目录搜索、名称/日期/大小排序、加载/错误/空态、选中高亮；排序/搜索状态由调用方持有，便于单元 harness 与不同宿主复用。
- DSH 附件选择器与“文件转移”页已改用同一组件；DSH 定向 13 passed，全量 212 mjs / 135 pytest（4 skipped）。
- 全量 Explorer 未替换：它带右键菜单、拖拽、悬停提示、树同步等富交互，直接换成共享列表会回退现有功能；计划里的“三处同源”仍差这一处。
- 0.2.42 已发布（CI `41224711170`，17:31:36Z，Hub 生效）；LAPTOP-01 Node+APP **20.0 秒**、插件 **16.1 秒**，真实插件状态/健康 0.2.42。共享 explorer 已安装到 APP 与插件；两机 surface smoke 200。
- 共享 UI 真实验收：Chromium 中文件转移页显示“工作区/此电脑”root 分组、面包屑、目录搜索与排序；真实输入选择源文件、目标 LAPTOP-01，1,040 字节传输完成，目标 SHA-256 与源一致，目标审计记录 `transfer/ok`；测试文件已清理。

## 2026-10-31 新设备账号注册（0.2.43）

- Hub `node_socket` 支持 `user_token`：用登录个人令牌校验账号，绑定未登记/同账号设备，签发一次性设备令牌；`/enroll` 对他人设备返回 `409 device_owned`。
- Node 支持 `--user-token`：无设备令牌时随注册发送用户令牌，收到 `device_token` 后写入 `data/device-token.json`（0600）并改用它；重启时优先读设备令牌。
- APP 登录登记改为两步：先走已有设备 `/enroll`（轮换令牌），遇到 `device_not_found`/`device_offline` 才切换账号注册（写 `userToken`、清 `nodeToken`、删除旧设备令牌并重启 Node）；`device_owned` 拒绝，不劫持他人设备。
- 临时 Hub + 临时 Node 实测：用户令牌注册后在线且 owner 正确；设备令牌已持久化（97 B）；去掉用户令牌重启仍在线、归属同一账号。
- 0.2.43 已发布（CI `41225813966`，17:45:20Z，Hub 生效）；LAPTOP-01 Node+APP **18.8 秒**、插件 **17.4 秒**，真实插件状态/健康 0.2.43；两机 surface smoke 200。
- 本机开发台也已对齐 0.2.43：Node/APP 0.2.43（源码开发版重启）、DSH 插件 0.2.33→0.2.43 **10.1 秒**（DSH 重启路径），插件 health 0.2.43；共享 TargetFileExplorer 已在真实 DSH 宿主生效。
- 仍缺：真实 APP 登录→登记（无测试账号）；同账号两机可见性用真实会话未实测。

## 2026-10-31 计划完成度审计

| 计划项 | 状态 | 证据 / 缺口 |
|---|---|---|
| 更新系统 | 完成（热重载除外） | 0.2.33–0.2.43 连续签名发布；Node+APP 16–20 秒、插件 10–17 秒；蓝色按钮/白雾遮罩视觉验收；插件 5 秒热重载未达 |
| 连接 | 部分 | 控制 P95 172 ms、半开离线 3.75 秒、重连 1.71–2.99 秒；1 GB 受 relay 60–70 KB/s 限制；UI 仍多路轮询 |
| 文件上传/选择器 | 部分 | 共享 TargetFileExplorer 用于 picker+转移页，DSH 定向 13 passed；全量 Explorer 的富交互列表未替换 |
| 新页面 | 部分 | 文件转移页/分块/续传/冲突/审计/真实 UI 验收完成；互联页 Node 重启 0.80/2.99 秒验收；断开/连接控制未做 |
| 登录/组网 | 部分 | 登录、邀请、角色、租户端点；新设备 user_token 注册/设备令牌下发/Node 持久化在临时 Hub+Node 闭环；真实 APP 登录与同账号两机可见性未用真实账号验收 |
| 远程控制 | 未开始 | 需先做 Windows spike；跨系统只设计不宣称 |
| 质量/商用 | 部分 | 212+4 mjs / 135 pytest 绿、生产 smoke 200；干净 Win11 无 Python/npm 安装、Windows 代码签名、EULA/隐私/支持未完成 |

当前结论：**架构可支撑商用，功能主线已打通到“内部受控试点”**；未完成项集中在插件热重载、1 GB/overlay、真实账号验收、全量 Explorer 共享、干净安装与合规外壳。

### Overlay benchmark harness

- 新增 `scripts/bench_relay.py`：控制 P50/P95、surface 首屏、分块传输吞吐/哈希，同一命令用于 overlay 前后对比；不打印凭据，自动清理临时文件。
- 公网 relay 基线：控制 P50 109–113 ms / P95 113–117 ms；surface 首屏约 **2121 ms**；1 MiB 传输 14.9–23.9 秒（约 40–70 KB/s，哈希一致）；2 MiB 22.1 秒（约 90 KB/s）。
- 下一步：在 LAPTOP-01 安装 Headscale+tsnet / NetBird / Nebula 客户端后，用同一命令对比；达标前不宣称 overlay 更好。

## 2026-10-31 UI 事件驱动

- 新增 `/api/events` SSE 订阅：device/session 事件到达时强制刷新状态；普通 2.5 秒轮询保留作为兜底，后台/隐藏页面仍跳过普通轮询。
- 真实 Chromium 验收：暂停本机 Node 后设备卡 **4.47 秒** 变离线、在线计数 2→1；恢复后 **3.94 秒** 回在线、计数 1→2；`/api/events` 网络响应 200 `text/event-stream`。
- SSE 变更已提交源码/web bundle（`9a5f39c`）；0.2.43 安装版尚未包含，下一次发布带上。全量 216 mjs / 135 pytest 绿。
- 0.2.44 已发布（CI `41227434088`，18:05:25Z，Hub 生效）；LAPTOP-01 Node+APP **16.5 秒**、插件 **15.2 秒**（真实状态/健康 0.2.44）；本机开发台重启到 0.2.44，插件 0.2.43→0.2.44 **13.7 秒**。两机三组件均 0.2.44。
- 本机插件 apply 后 DSH 宿主仍是旧进程（01:51），公网 surface 502；运行 `tether.node.dsh_restart` 重启宿主到 33416 后，两机 surface smoke 均 200。说明插件 job 的 `done` 只代表 profile 安装，不代表 DSH 运行态已加载新插件；5 秒热重载仍未达，需要运行态握手。

## 2026-10-31 插件运行态重载

- 0.2.45：descriptor pid 失效时扫描 `dsh-desktop-host` 再安排重启；Hub 等 `restart_required` 清除才 done，超时报 `restart_timeout`，文件已到目标版本时重试可重跑重启助手。
- LAPTOP-01 实测：Node+APP **16.0 秒**；插件 **19.0 秒**，其中 **11.4 秒** 是 DSH 重启窗口，`restart_required` 清除后才 done；profile/source/runtime 均 0.2.45；两机 surface smoke 200。
- 生产 Hub 已部署 `f6062fd`，回退点 `e3c8718`（备份 `runtime-reload-20261031T182301Z`）。
- 仍是整应用重启，5 秒热重载未达。

## 2026-10-31 更新检查单飞修复

- 0.2.46：清单单飞只允许 leader 完成共享 Future；并发强制检查不再二次 `set_result`/`set_exception`，修复 `InvalidStateError: FINISHED`（本地 `node.log` 累计 158 次，最近 01:50）。
- A/B 实测：旧 0.2.45 本机 24 次并发强制检查失败 **18** 次；LAPTOP 与本机升到 0.2.46 后均 **24/24 ok**、`latest_version` 0.2.46、无 `update_failed`。
- LAPTOP-01 Node+APP **17.6 秒**；CI `41230580812`，发布 18:44:27Z，Hub 镜像 18:45Z 前生效。

## 2026-11-01 登录、连接与设置分离

- 首次启动渲染全屏登录页（无本地凭据不进入主界面），登录后设备自动登记并重载；顶栏“连接”只保留状态灯、服务器地址、检测时间、响应耗时与刷新，不再承载账号。
- 新增独立设置页（活动栏底部齿轮）：账号/连接/本机设备/更新/文件权限/关于；账号邮箱、改密、退出登录只在这里；文件权限从这里进入原权限/审计面板。
- 删除设备配对、设备令牌、权限页 Hub 连接配置；全局滚动条改为 6 px、默认透明、hover 显示；工作区右下角常驻“重新加载”。
- 文件转移页重做：来源/目标独立卡片（蓝/绿顶边与徽标、设备选择、紧凑路径栏）、中栏交换按钮、底部已选文件与目标路径；活动栏转移图标改为箭头，不再与资源管理器同图标。
- 本机 Electron 真机截图确认登录页、连接面板、设置页、文件转移页；mjs 216 通过。
- 0.2.47 已发布（CI `41277668555`，签名清单校验通过，05:41:25Z），Hub 镜像 05:45Z 强制刷新到 0.2.47；设备未自动升级，真实账号登录验收待完成。
- 0.2.48 已发布（CI `41278461096`，05:54:11Z），包含登录页服务器切换与角色显示；Hub 镜像已刷新。LAPTOP-01 Node+APP **17.1 s**、插件 **14.4 s**（`restart_required` 清除，健康 0.2.48），两机 surface smoke 200；LAPTOP APP 现显示账号登录页，待所有者登录。
- 0.2.49 已发布（CI `41280353424`，06:22:11Z），加入设置页检查更新/切换账号/会话过期回登录；Hub 镜像已刷新。LAPTOP-01 Node+APP **17.8 s**、插件 **14.6 s**（健康 0.2.49），两机 surface smoke 200。
- 0.2.50 已发布（CI `41281139696`，06:33:39Z），插件 `restart_required` 改为只由 descriptor 新 pid 清除。LAPTOP-01 Node+APP **22.6 s**、插件 **19.2 s**；本机 0.2.49→0.2.50 在 descriptor 未刷新时正确报 `restart_timeout`（不再假 done），写新 descriptor 后重试 **4.6 s** 收敛，两机 surface 200。
- `v0.2.50` 干净 clone 构建通过，APP/插件包均含 descriptor 门禁 updater；Hub `179c524` 在 `restart_timeout` 后自动再拉起 DSH 一次（服务端 149 passed）。
- 真实登录闭环已用临时 Hub 测试账号跑通：登录页（服务器地址可改）→ 登录 → 自动重载主界面 → 设置显示邮箱 → 退出登录回登录页；未使用生产凭据。

## 2026-11-01 Tailscale 直连探测

- 本机与 LAPTOP（`qi`，`100.92.162.37`）已在同一 tailnet；`tailscale ping` 显示为 **direct IPv6，5 ms RTT**（经 `[2406:280:...]:41641`），而 Hub 控制 P95 约 113 ms。
- 吞吐尚未测：LAPTOP 的 Node/DSH 只监听 loopback，没有可从 Tailscale 访问的测试端点。下一步需要临时 HTTP 端点、SSH 或 Taildrop；在拿到吞吐前不宣称 overlay 全面优于 relay。

## 2026-11-01 连接恢复与原生工作区状态修复

- Hub CORS 预检修复（服务端 `9dc93ad`）：带 `Authorization` 的 `/api/*` OPTIONS 预检此前被认证中间件 401 拦掉，登录成功后 UI 仍报 `Failed to fetch`。修复后生产预检 200，允许源 `http://127.0.0.1:18892` 与 `Authorization` 头；DESKTOP-LOCAL 与 LAPTOP-01 均在线，`/api/state` 200。
- 原生工作区“加载较慢”常驻：真机 iframe 实测 `readyState=complete`、TTFB 443 ms、load 1.06 s，DSH composer 已可交互，但提示只在离开 loading 态时复位。现改为只在 `document-loading` 显示，`document-loaded` 后立即复位。
- APP 的 `/app-context` 改读自身源（`127.0.0.1:18892`），不再每 4 秒向跨源 Hub 发必被 CORS 拦截的请求。
- 真机 Electron（源码 0.2.51）复验：DSH 页面完整渲染，含新会话按钮、工作区树、会话列表与 composer，无慢加载提示；日志无新增 `/app-context` CORS 失败。
- 门禁：client pytest 141 passed / 1 skipped，server pytest 150 passed，mjs 218/218，cjs 6/6，`build.mjs --check`、`build-web.mjs --check` 与 `validate_versions()` 通过。
- 0.2.51 已发布（CI `41296203842`，签名清单校验通过，10:13:22Z），Hub 镜像已刷新；LAPTOP-01 node+APP **~18 s**、插件 **41.5 s**（含 DSH 重启，`restart_required` 已清除），两机 surface bootstrap 均 **200**（1.31 s / 1.10 s）。
- 本机桌面 surface 曾因运行的 DSH 被换成不含 Tether 插件的 `.runtime/dsh-home` profile 而 502；Node 读取的是 `~/.dsh` 描述符。用 `tether.node.dsh_restart` 拉回默认 profile 后描述符刷新到新 pid，surface 0.94 s 恢复。LAPTOP 更新期间 Node 曾每约 20 s 重注册，插件更新两次报 `device_offline`，链路稳定后重试收敛；根因待查。
- 活动栏入口归位：盾牌专用于文件权限/审计，设置改为齿轮；资源管理器底栏新增账号区（头像、邮箱、所有者、齿轮），点齿轮或活动栏头像打开设置，权限抽屉与设置页互斥。真机截图确认底栏账号区与两个入口。
- 目标文件选择器第一批：DSH 原生加号里的“文件”改为打开 Tether 目标选择器（此前插件挂在 composer 外侧，向上找 input 找不到，interception 失效）；选择器根列表去掉重复路径行，工具栏改为上箭头/刷新图标。真机 CDP 真实鼠标点击验证；可展开文件树与文件夹选择仍待做。
- 目标选择器文件树：根节点带展开箭头，按需拉取子目录（C: 子目录已真机展开）；文件夹单击进入并保持树中展开/选中；仍复用 `TargetFileExplorer`。
- 文件转移页重做：两栏各选一台电脑，另一侧节点在下拉中标注“已在另一侧”并禁用；两栏为紧凑文件树（名称+大小），不出现“来源/目标”；中间只留双向箭头图标；活动栏图标改为双向箭头。支持拖拽、Ctrl+C/V、右键（复制/剪切/粘贴到此处/刷新），Ctrl+X 走 `.tether-trash` 删除。
- **跨机实测**：从 LAPTOP-01 复制 `tether-picker-check.txt`（20 B）到 DESKTOP 的 default-workspace，Ctrl+V 与拖拽各成功一次，进度 100% · 20 B / 20 B，目标文件出现。
- 原生工作区耗时定位：descriptor 854 ms、iframe 1 s；冷插件包 4.2 MB + 1.9 MB 经公网约 25 s + 14 s；mux 90 s 读超时切断导致 `Loading plugins…` 卡死。修复：mux 300 s、节点资源 180 s、Hub 缓存按设备共享 + 上线预热、UI 文档 90 s。冷切 45–50 s 可完成，热切 8.4 s；冷载 ≤15 s 仍需 Tailscale 直连或更小包。
- 0.2.52 已发布（CI `41325957168`，16:54:56Z，Hub 镜像已刷新）；LAPTOP-01 Node+APP **27.1 s**，本机源码 APP 与 DSH profile 插件均 0.2.52，两机 surface 200（本机 1.16 s）。LAPTOP 插件更新未做，等其 DSH 空闲时再重启。
- 冷载直连评估：本 tailnet 未启用 Tailscale Serve（启用需登录管理页），HTTPS 直连资源被混合内容阻断；备选是目标 Node 在 Tailscale 上开一个 HTTP surface 端口（token/Referer 校验），但等于新增监听面，需主人批准。Tailscale 1.102.3，自机 `user-20250925jd.tailaf6f1c.ts.net`，LAPTOP `qi.tailaf6f1c.ts.net`。
- 0.2.53：APP 启动后为其它在线节点开隐藏 iframe 后台预热（加载后保持 45 s），冷载移出用户路径；切到 LAPTOP 到 composer **5.5 s**，连续切换 5 次 **12.8 / 6.4 / 4.8 / 6.7 s**（另一次同设备无操作），全部 ≤15 s。CI `41330546926`，17:18:02Z 发布，Hub 镜像 0.2.53；LAPTOP Node+APP **19.7 s**、插件 **16.6 s**，两机 node/app/plugin 均 **0.2.53**，两机 surface **200**（1.55 s / 1.24 s）。

- 传输提速（199 MB→）：直传分片 1 MB→4 MB，读端 `MAX_READ` 同步放到 4 MB；100 MB 真机直传 **52 s→42.46 s（1.92→2.355 MiB/s）**，SHA-256 一致。实测 EasyTier peer laptop 188 ms p2p tcp6，LAPTOP WLAN 直连端口（11010/445/3389）全部被校园网客户端隔离，应用只能走 EasyTier；单请求流式上传实测 49.4 s 更慢，已删除。瓶颈在网络路径（同期 raw TCP 3.69–4.09 MiB/s），不在 base64/HTTP 层。
- - POSIX 真机门禁已修绿：`.github/workflows/posix.yml` 的 Install 步骤缺 `pytest`，Ubuntu/macOS 两个作业都停在 `No module named pytest`（不是 PTY 代码问题）。提交 `6c6ef51` 后 CI `41689772155` 两作业全绿：PTY 测试、安装器检查、node 包构建、一次性安装、安装后终端测试均通过。
- - 文件界面补齐原生化交互：互传双栏与资源管理器支持空白拖动框选（Ctrl 追加、不选文字），空白右键菜单为新建/粘贴/复制当前路径/刷新，文件菜单含“复制路径”且不再出现新建项；转移完成后进度条 4 s 自动收起。APP 真鼠标实测：互传框选 5 项、资源管理器框选 2 项，20 B 传输底栏 5 s 内恢复提示。
- - 远程服务器维护节点：在 `remotestitch-hub` 以独立 `tether-node.service` 安装 `REMOTESTITCH-HUB`（root 终端、文件白名单、内存上限 384M），Hub/Caddy/EasyTier 未改动；公开 `/install/` 一键安装入口与 `--systemd/--user-token/--base-url` 安装器已实测。首尔链路 100 MB 上传 1.318 MiB/s、下载 1.590 MiB/s，4 路并发无聚合；服务器带宽 2.4 Gbps/385 Mbps，瓶颈是本地到首尔的公网路径。
- - 安装体验修正：公开下载页 `https://8-220-198-26.sslip.io/install/`（APP/插件/Node ZIP），一键命令缩短为 `curl -fsSL https://8-220-198-26.sslip.io/install.sh | sudo bash`，只提示一次账号，自动 systemd 安装并删除一次性令牌。干净 Ubuntu/Windows 云 VM 安装已通过（Windows venv 路径 bug 已由干净环境测试抓出并修复）；macOS 安装步骤通过。
- 服务器节点补 Linux 适配：文件管理器列出 `/`、`/home`、`/srv`、`/var/log`（不再只有盘符）；终端 cwd 属于上一台设备时自动回退到服务端工作区；终端头部显示 `root · 管理员` / 普通用户。APP 真机验证：LAPTOP 终端恢复可用，服务器资源管理器可浏览整个根目录。
- 服务器 DSH Web 原型：已装 Node 24 + `@deepseek-ai/dsh` 并运行 `tether-dsh-web.service`（127.0.0.1:3080，内存上限 600M），但带 token 的网关跳转尚未接进 APP，暂不计为可用工作区。
- 网络上限复测（主机校园网 ↔ 笔记本流量）：EasyTier 走 relay(2)、257 ms；100 MB 单流 160.63 s（0.623 MiB/s），4×25 MB 并发 216.78 s（0.461 MiB/s，无聚合）。笔记本无全局 IPv6，Tailscale 也只能走 DERP(HKG) 170 ms，NAT 直连失败；服务器带宽 2.4 Gbps/385 Mbps，瓶颈是跨境中转路径，应用层无法把这条路径拉到 10 MB/s，需国内中转或同网直连。
- 详细部署记录、服务器地址与运行快照属于私有运维材料，不在本公开进度页重复列出。用户需求仍以 [反馈清单](FEEDBACK.md) 为准；产品目标见 [PRD](PRD.md)，公开协议与客户端边界见 [技术说明](TECHNICAL.md)。


## 2026-11-04 0.3.6 收尾（当前状态）

- 传输：croc 11.6.3 + 自建 relay 为主引擎；随机 100 MB 上传 **26 s**（croc 报 105 MB/18 s，峰值 5.5 MB/s）、服务器→本机下载 **106.28 s**（峰值 1.9 MB/s），两端 SHA-256 一致。croc 子进程已剔除 `HTTP(S)_PROXY`（系统代理抖动曾使 1 MB 也挂死）；`CrocTransfer()` 默认平台改用 `sys.platform`，干净 Linux/macOS 节点能选中随包二进制。
- 转移页：设备异步到达后自动补选左右设备；正反两个方向都做过真实 UI 传输（本机→LAPTOP 20 B、服务器→本机 33 B），目标 SHA 与源一致。
- Linux 文件树：`joinPath` 反斜杠与根 spinner 已修，`/lost+found`、`/srv` 不再报红；真机可浏览整个根目录。
- 终端：资源管理器“在终端中打开”停在当前目录，服务器头部显示 `bash · root · 管理员`；同会话 `id -u`/`whoami`/`pwd` 返回 `0`/`root`/`/srv/tether-admin`。
- DSH Web：APP 内 `<webview>` 满幅（1432×880）加载 `10.144.0.1:37301`，无外部窗口；Tether 插件持久安装在 `/opt/tether-node/dsh-plugin/0.3.6`，侧栏入口、面板登录、一键“修复 DSH Web 插件”和“重启 DSH Web”均真机验证；服务重启后 APP 自动恢复“DSH Web 已就绪”并可重开工作区。插件包随 Node 归档分发，`dsh_web.py` 首次安装会自动注册。
- 安全：Node DirectApi 不再监听 `0.0.0.0`，只绑 `127.0.0.1` + EasyTier 地址；服务器与 Windows 本机均实测只剩两个监听。
- 安装：`install.sh` 默认 latest；隔离前缀 `--install-only --archive` 安装最终 0.3.6 成功，`node.env` 600，随包 croc 与 `repair_plugin` 均在；GitHub 干净 runner 三平台安装/启动已通过（`41726702888`）。
- 发布口径：`/install/version.json` 与服务器资产为 0.3.6；GitHub release 仍是 **draft** `433272811`，Hub `/releases/manifest` 仍是已签名的 0.3.5，所以 APP 内更新不会提供 0.3.6，直到所有者发布草稿并切换清单。
- OpenCode 原生工作台：Node 用 `opencode serve` 起本机服务并注册到 mesh 网关；Agents 页一键打开原生 Web（LAPTOP-01 `4096 → 43075`、重启后再启 `4097 → 30667`，网关均 200）；停止会清空 `apps.json`，状态文件用于节点重启后接管。远程应用页跟随全局设备并改用自绘下拉。Node 能力尚未打进发布包。
- Agent 生态：目录扩到 21 个（Codeg 20 + DSH + Copilot），按节点显示已装/未装；已装点开按能力给终端（Codex/Qoder 原生 TUI）、OpenCode Web/CLI、DSH 工作台；未装 npm 安装默认落 `D:\Tether\agents`（OpenCode 实测 766 MB）。Codex、OpenCode Web、OpenCode CLI、Herdr 四标签并存，Herdr 自动启动且深色。LAPTOP-01 与 DESKTOP 均实测。
- Agents IA 重组：App 顶栏只切主页面，Agents 页内用“主页/表面”标签；主页为左侧垂直 Agent 列表 + 右侧详情/账号/快速启动，不再用横向图标条或水印；目录页嵌在常驻顶栏下，右栏分“启动/环境变量/账号/诊断”，支持 cwd/env、账号档案和测试启动。客户端按设备缓存先渲染，返回页面不再等网络。
- Herdr 识别：Windows 包装器显式设置隔离状态与 PATH，`D:\Tether\agents` 已追加到用户 PATH（有备份）；Herdr 新 pane 可识别并用 `herdr agent start gemini` 启动 Tether 安装的 Gemini。LAPTOP-01 本轮离线，未复核。
- Agent 工作台复测（2026-11-04）：主页为左列表（21 个）+ 右详情/账号 + 快速启动 + 底部 21 个 Agent 总览画廊；刷新纯图标；目录页可直接切活动栏。标签溢出在 500px 视口下 `522/432`，滚轮 `0→90→10`，悬停滚动条可见；Herdr 分屏边界真实拖动 `0.50→0.6959`（86→119 列），侧栏是固定宽度不可拖。账号快照新增重复保存去重；Codex 结构化无提示词启动到“已连接 · Codex”，模型 `6.1 Sol (high)` 与 slash 命令可用；DSH 插件构建补入 `agents-home.js`/`agent-accounts-panel.js`；全量 214 passed / 3 skipped。
- 账号管理（2026-11-04）：Codex 接 app-server 原生设备码登录、`account/rateLimits/read` 5h/7d 额度、每账号独立 `CODEX_HOME` 档案、自动导入当前账号、弹层一键切换/重新登录/删除/退出；DSH 自动导入 `.dsh/.credentials.yaml` 并可快照切换；OpenCode/Qoder 添加账号时在终端直接跑解析后的登录命令（OpenCode 原生 `Add credential / Select provider` 已见）。`tests/test_agent_accounts.py` 6 passed；全量 216 passed / 3 skipped。仍在用 Codex 会话切换账号后需重启才生效。
- 结构化对话页（2026-11-04）：参考 Codeg（`xintaofei/codeg`，Apache-2.0）重做 ACP 页——用户气泡、执行过程胶囊、左侧步骤轨道（思考/工具/计划）、最终 Markdown、回主页 tab、右侧会话详情卡。目录打开 14ms；账号弹层 60ms 内出现；账号 `fresh=false` 快速返回元数据、后台刷新额度。全量 216 passed / 3 skipped。真实 Codex 模型容量导致未抓到实时思考/工具流，轨道用本地演示数据验收后已删。
- 仍欠：GitHub 0.3.6 公开发布、DSH 自身 DeepSeek 登录/composer、干净 VM 全业务链、100 MB 10 s（需要国内中转或同网路径）。
- 笔记本诊断包（2026-11-06）：`tether/tools/Tether-Diagnostics.cmd` 双击后在桌面生成脱敏 zip，只读采集进程/端口/服务/安装目录/最新日志；发布在 `https://8-220-198-26.sslip.io/install/Tether-Diagnostics.zip`（HTTP 200）。LAPTOP 仍待该 zip 定位 node 启动崩溃。
- 笔记本一键修复包（2026-11-06）：`Repair-LAPTOP.cmd` 从旧 `hub.json`/`device-token.json` 读取 token（不打印），安装 0.3.6 headless node 到 `D:\Tether\node-0.3.6`，隐藏启动并注册登录任务；本机 dry-run 已找到 64 位 token。发布 `https://8-220-198-26.sslip.io/install/Tether-Laptop-Repair.zip`（HTTP 200，内含 cmd+ps1）。
- 修复包 v2（2026-11-06）：若笔记本 PATH 无 Node/npm，自动从 nodejs.org 下载最新 Node 24 便携版并注入 PATH，再跑 bootstrap；避免卡在 Node 检查。发布包已更新（HTTP 200）。
- 修复包沙箱验证（2026-11-06）：本机假 token/假控制器跑通 bootstrap（Python 3.11 venv + Node v24.12 + 615 npm 包），`tether-node.ps1` 成功监听 18893/18895 并持续重连假控制器；测试目录已删除。真实笔记本只差运行修复包。
