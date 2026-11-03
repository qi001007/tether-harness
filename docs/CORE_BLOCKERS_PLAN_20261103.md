# 三个阻塞项技术方案

更新：2026-11-03。范围：文件资源管理器、Linux 社区 DSH 嵌入、传输速度。安装/版本/管理员权限作为同一批的验收条件。**不再跑独立测速**；每一项都以“改完在真实链路验收”为准。

## 结论

1. 文件树不是“整台机器不能读”，而是**单个目录的权限失败被当成了整棵树错误**，再叠加节点服务账号与读策略不一致。Linux 上 `/lost+found`、`/srv` 这类 700 目录必然读不了，界面却画成红色“加载失败”。
2. Linux DSH 已有可安装的社区版 Web，缺的是**同源反代 + 自动装 Tether 插件 + 嵌入页面**。此前“打开 DSH Web”开外部窗口，是把认证问题推给浏览器，必须删掉。
3. 慢的根因是传输代码**严格串行：读 4 MB → 写 4 MB → 再读下一块**，100 MB 要 25 个来回；单流又受 257 ms RTT 的 BDP 限制。代理器的 60 MB/s 不是这条链路，不能直接比。改成流水线、多流、源→目标直拉后，目标是**同一方向、同一链路上跑满裸 HTTP 的上限**。

---

## 一、文件资源管理器

### 证据

- `tether/node/fs_service.py:536` 对目录本身 `iterdir()` 抛 `PermissionError` 时直接 `raise FsError(..., "denied")`，整个 `list` 失败。
- `packages/tether-ui/src/transfer-page.js:218` 对 `list` 的任何异常都 `setError(...)`；树节点展开失败在 `:240` 被吞掉，右侧只剩红色“加载失败”。
- Linux 根目录把 `/` 作为唯一盘符后，`/lost+found`、`/srv` 等 root-only 目录仍会被列出来，但节点服务若不是 root，展开必然失败。

### 方案

1. **错误分型，不再一刀切**
   - `list` 返回 `denied`、`not_found`、`not_dir`、`io_error` 四类；权限失败用结构化结果或 403 错误码，不混成通用 500。
   - 对目录项先判 `os.access(child, R_OK | X_OK)`，不可读的条目带 `readable:false`，前端画锁，不画红。
2. **树节点独立状态**
   - `treeChildren` 从“只有成功数组”改成 `{status: loading|ok|denied|error, entries, reason}`。
   - 锁图标 + 悬停说明“需要管理员权限”；点击可重试；只有真正的 I/O 错误才显示红色和“重试”。
3. **服务权限与读根一致**
   - Linux 一键安装走 `sudo`，systemd 默认 `User=root`，终端徽标显示 `root · 管理员`；这样 `/etc`、`/var/log`、`/srv` 与整个 `/` 都可读。
   - 如果用户用 `--no-systemd` 以普通用户运行，则读根只声明实际可读范围，UI 明确“普通用户，部分目录不可读”，并给“以管理员重启节点”的动作，而不是等展开时才报错。
   - 写根保持不变：工作区 + 显式授权目录；**读整个 `/` 不等于能写整个 `/`**。
4. **默认隐藏伪文件系统和系统目录**
   - `/proc`、`/sys`、`/dev`、`/run` 默认不显示；`lost+found` 默认折叠/隐藏；设置里给“显示系统目录”开关。
   - 工作区仍来自 Node 的 `workspaces`，**不依赖 DSH**；DSH 没装也能浏览文件。
5. **路径与挂载点**
   - 统一 `posixpath.join`，避免 `//srv`；根 `/` 只出现一次。
   - 额外挂载点（`/home`、`/mnt/*`、`/media/*`）作为独立 drive 条目，而不是在 `/` 下重复展开造成“重复 home”。

### 验收

- 干净 Ubuntu 24（root 服务）展开 `/`：`lost+found` 显示锁或隐藏，`/srv` 正常列出，`/etc`、`/var/log` 可进，无红色“加载失败”。
- 普通用户模式：不可读目录显示锁，不显示“加载失败”；点击给原因和“以管理员重启”。
- 树与右侧目录状态一致；展开/收起不改变布局；换设备不串目录。
- 实测截图 + 目录列表响应时间（根目录 ≤1 s，普通目录 ≤500 ms）。

---

## 二、Linux 社区 DSH 嵌入

### 现状

- `tether/node/dsh_web.py` 已能安装 Node 24 + `@deepseek-ai/dsh`，systemd 跑 Web（3080），网关 37301。
- `packages/tether-ui/src/app.js:2958` 的“打开 DSH Web”用 `window.open(url, '_blank')`，外部打开；iframe 直连又因 SameSite cookie 失败。
- 插件未自动装，导致即使页面打开也没有 Tether 侧栏/工作区。

### 方案（主路径）

1. **一键安装 = DSH + Tether 插件**
   - 节点能力 `dsh_web_install` 扩展为：装 DSH → 用官方 `dsh plugin add`（或 profile `node_modules` 的受控安装）装 `tether-dsh-plugin`、client、surface、native-ui 四包 → 写 `apps.json` → 启动 → 校验 descriptor。
   - 安装进度分阶段回传：下载、解包、插件、启动、就绪；失败给具体阶段和日志尾部，不再只给“安装失败”。
   - 安装完成后自动刷新 APP 的 DSH surface，不需要用户再点第二次。
2. **同源反代，不再外开**
   - DSH 只监听 `127.0.0.1:3080`，不直接暴露公网。
   - Node 的认证 surface 增加 `/dsh/` 反代：转发 HTTP、SSE、WebSocket；注入 DSH 进程 token；只允许已认证的 Tether 会话访问。
   - Cookie 处理：去掉 `Domain`，`SameSite=None; Secure` 改成同源可用的 `SameSite=Lax`；`Path=/` 重写为 `/dsh/`；`__Host-` 前缀按“改名 + 双向 Cookie 头映射”处理。目标是 iframe 内是**第一方**，不再触发 SameSite 拦截。
   - HTML 注入 `<base href="/dsh/">`，重写绝对资源路径和重定向 `Location`。
3. **APP 内嵌**
   - 删除“打开 DSH Web”外部按钮；改为嵌入 surface 卡片：加载中、启动中、未安装、错误四种状态，全部在页面内。
   - 未安装时显示“一键安装 DSH（Linux 社区版）”；安装完直接进嵌入式工作区，显示侧栏、文件树、composer。
   - 节点重启/DSH 重启后自动重连，保留上次页面，不白屏。
4. **备选（只在同源反代被 DSH 的 cookie 前缀卡死时）**
   - 给每台设备一个 HTTPS 子域 `dsh-<device>.<hub-domain>`，DSH 直接以 `SameSite=None; Secure` 提供，仍用 iframe 嵌入；不默认开外部窗口。
   - 这是域名方案，不引入第三方服务；证书沿用 Hub 的 sslip.io/自有域名。

### 为什么不直接搬 Windows 桌面版

Windows 是 DSH 桌面进程 + Tether 插件注入；Linux 社区版目前可稳定提供的是 Web UI，桌面壳不是官方制品。远程嵌入应复用**同一套 DSH Web UI + 同一套插件**，而不是把 Linux 桌面窗口截图传回来。后者需要 Xvfb + VNC，延迟和清晰度都不适合作为主路径。

### 验收

- 干净 Ubuntu（无 DSH）：APP 点一次安装 → 进度到就绪 → 嵌入式 DSH 出现 composer/侧栏/工作区，插件版本可见。
- 不出现任何外部浏览器窗口；iframe 首次加载和刷新都保持登录态；WebSocket 不断线。
- 重启节点、重启 DSH 后自动恢复；插件缺失时给“一键修复”，不要求用户手工拷包。
- 安装失败时能重试并保留已下载缓存。

---

## 三、传输速度

> **2026-11-04 修订**：传输引擎改用 croc v10，见 [TRANSFER_ENGINE_DECISION.md](TRANSFER_ENGINE_DECISION.md)。本节的“流水线 / 单文件多流 / 源→目标直拉”属于自研分片方案，**不再实现**；保留在此仅作历史记录。

### 现在的真实路径

`packages/tether-ui/src/transfer.js:64` 的循环是严格串行：

1. `readBytes` 从源设备读 4 MB（`transfer-page.js:117` 的 `/fs/read_raw`）；
2. 等它完全返回；
3. 再 `writeBytes` 往目标设备写这 4 MB（`transfer-page.js:143` 的 `/fs/write_raw`）；
4. 等确认后才读下一块。

100 MB = 25 次“读往返 + 写往返”。在 257 ms RTT 的 relay 路径上，光来回就占掉大部分时间；单条 TCP 流还受 BDP 限制，窗口填不满。直连探测失败时还会退回 Hub 控制面 + base64，体积 +33%、CPU 再翻倍，这就是 0.42–1.23 MB/s 的来源。

### 关于 60 MB/s

代理器显示的 60 MB/s 是**代理出口到测速点的下行**，通常多连接、直连、没有 257 ms relay；它不经过“笔记本上行 → 校园网 NAT → 阿里云 relay → 服务器”这条路径。把它和 Tether 的单流数字直接比，单位一样但链路不是同一条。Tether 要对比的是：**同一文件、同一方向、同一对设备上的裸 HTTP 上限**。这也是下面验收的口径。

另外方向必须分开：笔记本用流量时，上传受移动网上行限制，下载受下行限制；游戏下载是下行，之前的 100 MB 测试如果方向相反，不能用同一个数要求。

### 方案

**A. 流水线（先做，改动最小）**

- 双缓冲：读第 N+1 块的同时写第 N 块，队列深度 2–4；不再“读完才写”。
- 块大小 4 MB → 8 MB；读取和写入都走 DirectApi 原始字节，禁止 base64 回退处理大文件。
- HTTP/1.1 keep-alive 复用连接；目标文件句柄在传输期间保持打开，不每块 open/close。
- 多文件队列并行 4 条；单文件仍顺序，保证进度和续传简单。
- 预期：同样链路达到裸 HTTP 单流的 80–100%，100 MB 从约 52 s 降到与单流上限一致。

**B. 单文件多流（核心提速）**

- 把文件切成 N 个 range（N=4–8），每条连接独立 `read_raw(offset, len)` → `write_raw(offset, len)`，服务端用 `pwrite` 按偏移写，不互相覆盖。
- 每流内部仍然流水线；总进度按已完成字节汇总；任一流失败只重试该 range。
- 4 条流在 257 ms RTT 下可把有效窗口放大约 4 倍；这是下载管理器/商用远控常用的做法，不依赖 UDP，不受云防火墙影响。
- 预期：路径允许时，吞吐 ≥ 裸 HTTP 单流的 2–4 倍；校园网直连 100 MB 目标 <10 s。

**C. 源→目标直拉（去掉第三跳）**

- 现在数据可能经过控制端 APP 中转（源→APP→目标），多走一跳和一份上行。
- 目标 Node 向源 Node 申请一次性传输票据，直接通过虚拟 IP 拉取 `read_stream`；APP 只做控制、进度和取消。
- 两端都在 EasyTier 网内时，数据只走一次虚拟链路；本机作为源时走本地读 + 直写目标。
- 票据绑定设备、路径、有效期，校验来源；不新增公网端口。

**D. 链路与套接字**

- 传输前显示路径类型：直连 / relay / Hub；relay 时提示预期上限。
- 大流量 socket 调大 `SO_SNDBUF/SO_RCVBUF`，Linux 服务端可用时启用 BBR；控制通道保留 `TCP_NODELAY`，数据通道不逐包 flush。
- QUIC/UDP 仍不作为默认：云安全组未放行 UDP，等主人明确放行再评估。

**E. 内置链路测速（一次，产品功能）**

- 设置/互联页加“链路测速”：16 MB 内存数据，按当前方向跑 TCP，显示 RTT、MB/s、直连/relay。
- 传输页开始前用最近一次结果估算剩余时间；不再靠外部 speedtest 或代理器数字解释。
- 这个功能本身也是验收工具，不单独跑一次性脚本。

### 验收

- 同一 100 MB 文件、同一方向、同一对设备：裸 HTTP 单流 vs APP 单流，APP ≥ 90%；开 4 流后 APP ≥ 裸 HTTP 单流，路径允许时 ≥2 倍。
- 校园网直连：100 MB <10 s；移动网按上行/下行物理上限给出预计时间，实际不低于该上限的 80%。
- SHA-256 一致；断线可续传；进度单调；取消后目标不留半文件（或明确标记 partial）。
- 传输期间控制通道仍可响应（终端、列表不卡死）。

---

## 四、安装、版本与管理员权限（同批验收）

1. **一条命令，零参数**：`curl -fsSL https://<hub>/install.sh | sudo bash`。不再要求 token/邮箱/控制器参数；登录用浏览器设备码，终端只显示短码和 URL。
2. **版本必须是最新**：安装脚本读 release manifest（版本、sha256、资产 URL），不复用镜像缓存；安装后把实际 `version.json` 上报 Hub。APP 显示“已安装 X / 最新 Y”，只有协议不兼容才标“旧”，不再把元数据滞后当成旧版本。
3. **管理员权限可见**：Linux 服务默认 root，终端徽标 `root · 管理员`，`id -u` 返回 0；Windows 显示当前用户，需提权时给 UAC 动作，不假装有权限。
4. **干净环境矩阵**：GitHub Actions 已有 Ubuntu/macOS/Windows 安装冒烟；补真实 VM（Ubuntu 22/24、Debian 12、Windows 11、macOS 14）跑完整链路：下载 → 安装 → 登录 → 文件树 → 终端 → 一键 DSH → 100 MB 传输。每个环境记录失败点和修复，不接受“测试全绿但用户还要改 bug”。

---

## 进展（2026-11-04）

- 文件树：已定位并修复根因——`app.js` 的 `joinPath` 永远拼反斜杠，`/srv` 被拼成 `\srv` 后 API 判成“非绝对路径”。`joinPath`/`pathSegments`/`parentOf`/新建/重命名/粘贴已改为分隔符感知；不可读目录显示灰色“无权限，点击重试”，不再标红。回归 `tests/test_posix_paths.mjs` + `test_file_tree.mjs` 共 15 条通过。干净 Linux 真机仍待验。
- 传输：自研流水线已停止扩展。选型改为 croc 11.6.3（多 TCP 并行/续传/PAKE/自建 relay），新增 `tether/node/croc_transfer.py` 薄适配层与 5 条 pytest；官方二进制在本机自建 relay 上完成 16 MiB 收发，文件字节一致。fs API、APP 转移页、二进制打包、服务器 relay 尚未接；旧分片代码仅作临时回退。
- DSH：外部 `window.open` 已删除；APP 改为 `<webview>` 内嵌 DSH Web，主进程只允许回环/私有网段，拦截 guest 导航与弹窗。隔离 Electron 启动到渲染器 `0 console error`；但该次未登录，更新中心断言失败，webview 真机未验。自动装插件、同源反代仍未做。
- DSH 同源反代、安装器最新 manifest、多流/直拉尚未动。

## 五、顺序

| 顺序 | 项 | 预计 | 完成判据 |
|---|---|---|---|
| 1 | 文件树错误分型 + 权限/读根 + 树节点状态 | 0.5 天 | 干净 Ubuntu 无红色加载失败，`/srv` 可进 |
| 2 | 传输流水线 + 8 MB + 禁 base64 + 文件句柄复用 | 1 天 | APP 单流 ≥ 裸 HTTP 90% |
| 3 | 单文件 4–8 流 + 源→目标直拉 | 1–2 天 | 100 MB 校园直连 <10 s，SHA 一致 |
| 4 | Linux DSH 同源反代 + 插件自动安装 + 内嵌 | 1–2 天 | 无 DSH 的干净机一键装完，页面内可用 |
| 5 | 安装器零参数 + 最新 manifest + 版本对比 + VM 矩阵 | 与 1–4 并行 | 新 VM 全链路零手工修复 |

先做 1 和 2，因为它们是“现在完全不能用”和“核心业务不可用”的直接原因；3 在同一传输引擎上继续，4 独立推进。每一项单独提交、单独真机验收，不再用一轮轮裸测速代替实现。
