# Tether APP 集成计划（APP / 插件 / WebUI 同一套 UI）

状态：**Phase 1 已实现；Phase 2 已起 Electron 壳（服务监督未做）**；Relay/Account 仍是设计。

## Phase 2 当前切片（2026-10-27）

- `apps/tether-app`：Electron 单实例窗口，内嵌 `packages/tether-ui/web/server.mjs`
  （随机 loopback 端口，`/api` 同源反代到 Controller），加载与 WebUI/插件同一份构建。
- 主进程按 4s 探测 `/api/state`，状态经 IPC 暴露；数据目录 `apps/tether-app/data`
  （gitignored），日志 `data/app.log`；截图模式 `--shot --panel=... --row=...`。
- 验收：Electron 窗口内原生工作区、文件树/明细/预览入口、互联、权限均来自真实 Controller；
  APP 实机截图 `docs/screenshots/tether-app-files.png`（同一套 UI 与类型图标）。
- 未做：ServiceSupervisor（Controller/Node 子进程启停、端口冲突、退出清理）、托盘、
  APP 服务页、打包/快捷方式。当前双击 APP 仍要求 Controller 已由外部启动，不能宣称完整自举。

## Phase 1 当前切片（2026-10-27）

- `packages/tether-ui/src/app.js`：唯一 UI 源码，导出 `createTetherPanel({ React, Native, host })`。
  由 `client.js` 机械抽取，UI 主体 2167 行逐字未改。
- `packages/tether-ui/src/hosts/dsh.js` / `hosts/web.js`：API base 与原生组件适配；
  Web 回落实现 `FileEntryRow` / `FileTypeIcon` / `MarkdownText`。
- `packages/dsh-plugin-tether-client/lib/client.js`：**生成物**，由
  `node packages/tether-ui/scripts/build.mjs` 把共享源码嵌进原 `__ModuleLoader__` 壳；
  不新增 DSH external、不改装配方式，插件行为与 `03f0351` 一致。
- WebUI：`packages/tether-ui/web`（esbuild 打包、无框架改造），`web/serve.mjs` 把 `/api`
  反代到 Controller，避开当前只允许 `dsh-app://app` 的 CORS。命令：
  `npm --prefix packages/tether-ui run build:web`、`node packages/tether-ui/web/serve.mjs`。
- 回归：`tests/test_tether_ui_shared.mjs` 断言插件 bundle 与共享源码逐字一致并能在 VM 启动；
  JS 23/23 通过。WebUI 在 Edge 1600×1000 实机验收：原生工作区 iframe、文件树/明细/面包屑、
  互联卡片+拓扑、权限/审计抽屉均读取真实 Controller 数据。证据截图：
  `docs/screenshots/webui-files-1600.png`、`docs/screenshots/webui-network-1600.png`。
- 已知边界：Web 回落组件只覆盖插件用到的三个原生组件；原生 surface 的 iframe 在
  Web origin 下未做网关/Cookie 重验（当前本机可显示，不作为验收结论）；Electron 未开始。

## 0. 目标与边界

最终形态：

- **APP 是主体**：桌面应用，带本地 Web 服务、Controller/Node/Relay 的启动与健康管理。
- **插件是 DSH 适配器**：只负责注册 DSH slot、加载共享 UI、展示目标 DSH 原生页；
  不再自己实现一套页面。
- **WebUI 是 APP 自带入口**：浏览器访问 APP 的本地 Web 服务，页面/交互与插件完全相同。
- **插件、APP、WebUI 共用一份 React UI 源码**，不是三份复制；APP 只多出网络服务、
  中继/配对、日志、启动器等 APP 专属功能。
- 插件在没有 APP 时必须还能用当前 Controller + Tailscale 直连模式应急。

非目标（本计划不承诺）：

- 不重写 WireGuard/TUN，不做三层虚拟网卡。
- 不在没有公网可达点、且双方都在 NAT 后时承诺公网直连。
- 不以“UI 截图一样”代替共享代码；共享 UI 必须是同一构建产物。

## 1. 当前状态

```
DSH plugin (client.js)
  ├─ React UI：原生工作区 iframe / 文件 / 互联 / 权限
  ├─ DSH Native bridge：FileEntryRow、FileTypeIcon、Markdown
  └─ fetch http://127.0.0.1:18890（Controller）

Controller (FastAPI + SQLite)
  ├─ /api/state、fs、native surface、权限/审计、设备显示名
  └─ Node 出站 WS：/ws/node

Node (Python)
  ├─ 目标文件服务、DSH SDK/adapter、surface 转发
  └─ 目标 DSH Host 的原生页面

启动：
  scripts/up.py 起 Controller + 本地 Node + Edge --app
  desktop/tether-app.ps1 只是薄启动器
```

问题：

- UI 全部在 `packages/dsh-plugin-tether-client/lib/client.js`，无法被 APP/Web 直接复用。
- Web 入口还是旧的 `tether/static/index.html`，和插件 UI 不一致。
- 没有 APP 进程；没有服务启动/健康/退出管理。
- 没有自己的 Relay/Account，公网依赖 Tailscale。
- 插件把 Controller 地址写死为 `127.0.0.1:18890`。

## 2. 目标架构

```
┌──────────────────── Tether APP（Electron） ────────────────────┐
│ Renderer：共享 React UI         │ APP 专属页：服务/网络/日志    │
│ Main：ServiceSupervisor        │ WebServer（本地 UI + API）    │
│  ├─ Controller（Hub 模式）     │  ├─ Relay/Account（Hub 模式） │
│  ├─ Node（本机执行）           │  └─ local API facade           │
│  └─ Python sidecar（打包）     │                               │
└───────────────┬──────────────────────────────┬────────────────┘
                │ loopback                      │ 出站 TLS/WSS
        DSH 插件（同一 UI bundle）        Tether Relay/Account
                │                              ▲
                └──────────── 目标 DSH 原生页 ──┘
```

### 2.1 运行形态

- **Hub**：Controller + Relay/Account + 本地 Node + WebUI/APP。适合主机、局域网中心，
  或部署在公网 VPS 的 headless 模式。
- **Node**：本机 Node + 本地 API facade + UI；通过 Relay 连 Hub，或被 Hub 控制。
- **Standalone**：Controller + 本地 Node，无 Relay；当前单机行为，供插件兜底。
- **插件**：始终调用本机 `127.0.0.1` 的 APP/Controller；若无 APP，走旧的
  `TETHER_CONTROLLER`（Tailscale/局域网）直连。

### 2.2 三个界面共享什么

共享：

- 原生工作区 iframe 容器；
- 文件资源管理器（树/明细/面包屑/右键/预览/编辑）；
- 互联（设备卡片、网络图、缩放/拖拽/改名/标签）；
- 权限/审计抽屉；
- 设备切换、顶栏、通知、弹窗、右键菜单；
- DSH token 和视觉规则。

宿主差异通过适配器隔离：

```ts
interface TetherHost {
  apiBase(): string
  native: {
    FileEntryRow: React.ComponentType
    FileTypeIcon: React.ComponentType
    MarkdownText: React.ComponentType
  }
  openNativeSurface(url: string): void
  windowChrome?: 'dsh' | 'electron' | 'browser'
}
```

- `DshHost`：使用 `tether-dsh-native-ui` + `window.__ModuleLoader__`。
- `WebHost`：普通 React + 内置图标/Markdown 渲染。
- `AppHost`：在 WebHost 上增加 Electron 窗口控制、打开日志/数据目录、系统通知。

## 3. 代码拆分

新增/改造：

```
packages/
  tether-ui/                 # 唯一 UI 源码：页面、组件、样式、图标
    src/api.ts               # Tether API client（fetch/SSE/轮询）
    src/hosts/dsh.tsx
    src/hosts/web.tsx
    src/hosts/electron.tsx
    src/pages/...
  dsh-plugin-tether-client/  # 只保留 DSH 适配和打包入口
apps/
  tether-app/                # Electron main/preload/renderer
tether/
  app/                       # 服务监督、Hub/Node 模式、local API facade
  relay/                     # Relay/Account（配对、设备密钥、转发）
  controller/                # 保留；Hub 模式启动
  node/                      # 保留；Node 模式启动
desktop/                     # 安装器/快捷方式/打包脚本
```

构建：

- `packages/tether-ui` 用 Vite/ESBuild 输出两种包：
  - `web`（APP/WebUI，包含 React 和图标）；
  - `dsh`（external：React、DSH native bridge，由 DSH 提供）。
- DSH 插件仍输出 `window.__ModuleLoader__.load({id, factory})` 外壳；内部调用
  `mountTetherApp(host)`，不再复制页面代码。
- APP/WebUI 加载同一个 `web` 构建；APP 的专属页面单独打包，不进插件。

### 3.1 API 边界

`TetherApi` 统一：

- `getState()`（设备/会话/运行）
- `fs.*`（list/read/write/preview/mkdir/rename/delete）
- `surfaceUrl(deviceId)`
- `renameDevice(deviceId, name)`
- `policy.*` / `audit.*`
- 将来 `edges.*` / `relay.status`

插件/APP/WebUI 不直接拼 URL；API base 由 host 适配器提供：

- APP/WebUI：同源 `http://127.0.0.1:<port>`。
- 插件：本机 APP 的健康检查通过则用 APP；否则用旧 Controller URL。

CORS/认证：

- 生产 CORS 只允许 `dsh-app://app`、APP Web origin、loopback。
- APP WebUI 默认只监听 loopback；开放局域网时必须加会话登录，不能把无认证 UI
  暴露到 LAN。
- 设备名/边等写接口仍只允许授权客户端；当前单用户 loopback 模型保留。

## 4. APP 壳与后端

### 4.1 Electron

推荐 Electron 而不是 Tauri：

- DSH/现有 UI 都是 Chromium 体系，iframe、原生 surface、DevTools 行为一致；
- 现有启动器、Edge `--app`、React 页面迁移成本最低；
- Tauri 的 WebView2/Rust 适配不会带来这个项目需要的收益。

APP 组件：

- `main`：单实例、窗口、托盘、生命周期、自动更新（以后）。
- `preload`：只暴露必要 IPC：打开日志/数据目录、服务状态、复制配对码。
- `renderer`：共享 UI + APP 专属服务页。
- `ServiceSupervisor`（Python sidecar 或 Electron 主进程）：
  - 启动/停止 Controller、Node、Relay；
  - 健康检查、端口冲突、崩溃重启、日志轮转；
  - 退出时杀进程树，避免残留；
  - 把服务状态通过 `/api/app/status` 和 IPC 暴露给 UI。
- 打包：
  - Python 用 PyInstaller/embedded runtime，避免要求系统 Python；
  - 数据目录按主人偏好放 D/E 盘，C 盘只留必要 Electron 小数据；
  - 卸载保留用户数据，提供清理入口。

### 4.2 Hub / Node 模式

- APP 首次启动让用户选：
  - **作为控制端（Hub）**：启动 Controller + Relay/Account + 本机 Node；
  - **作为被控端（Node）**：启动 Node + local API facade；
  - **仅本机（Standalone）**：Controller + Node，无 Relay。
- Hub 需要公网可达或局域网可达；没有公网 VPS 时，Hub 可运行在局域网主机上，
  跨网设备无法直接发现。
- APP 专属“服务”页：
  - 当前模式、Controller/Node/Relay 状态；
  - 端口、TLS/证书、配对码、设备密钥轮换/吊销；
  - 启动/停止/重启、日志、复制诊断信息；
  - Tailscale 应急开关（过渡期）。
- 插件打开时：
  - 探测本机 APP `GET /api/app/status`；
  - 通过 same-controller API 工作，并在顶栏显示“APP 已连接 / APP 未运行，使用直连”。

## 5. 网络服务（替代 Tailscale）

### 5.1 目标

把“Tailscale 的四件事”做进 APP/Relay：

1. 设备身份与配对（设备公钥、配对码、吊销）；
2. 加密传输（TLS/WSS）；
3. NAT 穿透（STUN/QUIC 可选）；
4. 穿透失败时的 Relay（类似 DERP）。

Tether 只需要应用层 HTTP/WS，不需要 TUN/虚拟 IP。

### 5.2 组件

- `tether/relay`：Controller/Node 的出站长连接入口，按 `device_id` + channel 转发。
- `/api/enroll`：配对码 + 设备公钥换 `device_id` + 短期令牌 + Relay URL。
- TLS：Caddy/nginx 或 Python 服务内建证书；每设备密钥、轮换、吊销、审计。
- 局域网直连优先；跨 NAT/对称 NAT 回退 Relay；以后加 P2P。
- Relay 只转发业务帧，不理解文件/DSH 内容；可选端到端 payload 加密。

### 5.3 与现有 Controller/Node 的关系

- Controller 仍负责 UI/API 的单用户模型；Hub APP 启动它。
- Node 仍负责目标文件/shell/DSH；Node APP 启动它。
- Relay 是新的网络入口，不取代 Controller 的业务状态；现有 Node/Controller 消息
  通过 Relay 透传，减少协议重写。
- 旧 `TETHER_CONTROLLER` 直连模式保留，作为 Tailscale/局域网应急。

## 6. 分阶段落地

### Phase 0：冻结与基线（不改行为）

- 保存当前插件截图、DOM/交互回归、client 哈希。
- 给当前 API/页面补最低限度的共享 UI 契约测试。
- 验收：当前 32/32 Python、20/20 JS 继续通过；插件功能不变。

### Phase 1：共享 UI 抽取（先不动 APP）

- 新建 `packages/tether-ui`，从 `client.js` 搬页面、组件、样式、图标；
- 加 `DshHost` / `WebHost` 适配；
- 插件改成薄适配入口；WebUI 用同一构建；
- 现有 native surface、文件预览、权限、网络图、改名全部保留。

验收：

- 插件与 WebUI 的相同操作产生相同 DOM/视觉；关键截图逐张对比；
- 插件 bundle 仍能在 DSH `__ModuleLoader__` 加载；
- 无重复页面源码；client 功能回归通过。

### Phase 2：APP 壳 + 本地服务监督（先不接 Relay）

- Electron APP 起 Controller/Node/WebUI；
- 插件探测 APP 并使用它，APP 未运行时回落直连；
- APP 专属服务页/托盘/日志/单实例；
- 数据目录、端口、退出清理、安装器。

验收：

- 不敲终端，双击 APP 即可打开同一 UI；
- 插件打开后显示 APP 状态；关掉 APP，插件回落并说明原因；
- 文件/原生页/权限/改名/网络图均可用；
- 关 APP 后无残留 Python 进程，端口释放。

### Phase 3：本地 Relay/Account 原型

- `tether/relay` + 本地三进程（Relay + Controller + 2 模拟 Node）；
- 配对码、设备密钥、channel 转发、断线重连、帧上限；
- Hub/Node 模式切换；
- 测试现有 state/fs/run 经 Relay 与直连语义一致。

验收：

- 本机三进程，Tailscale 关闭仍能上线/执行/重连；
- 断 Relay 显示离线；恢复后重连；
- 无串设备、无重放、无入站 Node 端口。

### Phase 4：公网与 Tailscale 退场

- Relay 部署到 VPS/公网主机，TLS/域名；
- 主机 Hub + 笔记本 Node 双机，卸载 Tailscale；
- 局域网直连优先，Relay 回退；
- 吊销/轮换/审计/限流。

验收：

- 关闭 Tailscale，双机仍可上线；
- Node 不开放入站端口；
- 设备吊销立即生效；
- 100 台模拟设备不串设备，队列/帧大小受限。

### Phase 5：打包与团队功能

- 安装包/启动器/桌面快捷方式/GitHub Release；
- Account/Team 登录、设备邀请、边 ACL、审计；
- P2P/QUIC 可选，Relay 保持回退；
- 插件市场/独立下载两种分发。

## 7. 迁移与兼容

- **先插件后 APP**：插件保持当前直连/Tailscale 模式；APP 安装后通过健康检查切换，
  不要求重装插件。
- **数据**：沿用现有 Controller SQLite 和 `~/.dsh` surface；APP 启动前备份，
  不覆盖用户会话/模型 key。
- **端口**：v1 固定 Controller/UI 18890；APP 端口冲突时给出明确错误并允许改端口，
  插件通过本机状态文件/环境读取实际端口（不把端口写死为唯一发现方式）。
- **降级**：APP/Relay 不可用时，插件可切回旧 Controller URL；不能因为 APP 启动失败
  而让当前插件完全不可用。
- **UI**：APP/WebUI 不使用 DSH 原生组件时由 `WebHost` 提供同尺寸/同交互的替代；
  不能出现“APP 里是另一套按钮/字体”。

## 8. 风险

1. DSH 插件加载器对 bundle/React external 的限制，需要先做最小打包验证。
2. 原生 surface 的 loopback gateway/CORS/Cookie 在 APP/Web origin 下要重验；
   不能因为换 UI 容器破坏已验收的原生页。
3. Python sidecar 打包（体积、杀软、Windows 防火墙）和自动更新。
4. 公网 Relay 的运维成本：域名/TLS/带宽/DDoS/吊销；Tailscale 正是替用户承担这些。
5. Relay 鉴权不足会变成开放代理；必须先做每设备密钥和吊销，再暴露公网。
6. APP、插件、WebUI 三端状态不能各自维护；共享 API client 和同一份后端状态是硬约束。
7. 当前是单用户 loopback 信任模型；团队/多用户前不能把 APP WebUI 暴露到 LAN。

## 9. 验收矩阵

| 能力 | 插件 | APP | WebUI |
|---|---|---|---|
| 原生 DSH 工作区 | 已验收 | 同一 iframe/gateway | 同一 iframe/gateway |
| 文件树/预览/编辑/右键 | 已验收 | 同一组件 | 同一组件 |
| 权限/审计 | 已验收 | 同一组件 | 同一组件 |
| 互联/缩放/拖拽/改名 | 已验收 | 同一组件 | 同一组件 |
| 服务启动/停止/日志 | 不负责 | APP 专属 | 只读状态 |
| Relay/配对/设备密钥 | 不负责 | APP 专属 | 受权可见 |
| 无 APP 回落 | Tailscale/直连 | — | — |
| 同一套交互 | 共享 bundle | 共享 bundle | 共享 bundle |

## 10. 建议的第一刀

先做 **Phase 1 的共享 UI 抽取**，不动网络：

1. 把 `client.js` 的页面/组件/样式搬进 `packages/tether-ui`；
2. 插件只保留 DSH 适配入口；
3. 用 WebHost 起一个本地页面，逐页对比截图和交互；
4. 确认插件仍能加载、现有 Python/JS 回归通过。

这一刀完成后，APP 壳和 WebUI 才有可复用的主体；否则先把 Relay 做出来，也会被
旧的单文件 UI 卡住。Phase 2 再让 APP 接管服务启动，Phase 3 才接 Relay。