# Tether / RemoteStitch 云端 Hub 开发交接

更新时间：2026-10-27

这份文档用于把当前代码、阿里云服务器、域名和验证结果交接给后续开发者。文档不包含密码、访问令牌或私钥内容。

## 1. 目标与当前结论

目标是让 Tether 不再依赖 Tailscale：公网 Ubuntu 主机运行现有 Controller 作为 Hub，目标机 Node 只通过出站 WSS 注册，操作者 APP 通过 HTTPS 调用 Hub API。

当前结论：**Hub 和操作者 APP 已经跑通；目标机 Node 尚未接入，因此双机端到端验收还没有完成。**

```text
目标机 Node ──出站 WSS──> Caddy :443 ──> Controller 127.0.0.1:18890
                                      ↑
操作者 Windows APP ──HTTPS /api───────┘
```

## 2. 资产清单

### 阿里云服务器

| 项目 | 值 |
|---|---|
| 产品 | 阿里云轻量应用服务器 |
| 地域 | 韩国（首尔） |
| 公网 IPv4 | `8.220.198.26` |
| 私网 IPv4 | `172.19.29.172` |
| 系统 | Ubuntu 24.04 LTS，x86_64 |
| 配置 | 2 vCPU / 2 GiB / 40 GiB ESSD，200 Mbps 峰值带宽 |
| 到期时间 | 2027-10-27 23:59:59 |
| 购买页面价格 | 首年 `¥79`（促销价，以阿里云订单为准） |
| 防火墙 | 公网 TCP `22/80/443`；未开放 `18890` |

### SSH

| 项目 | 值 |
|---|---|
| 用户 | `root` |
| 认证 | 专用 ED25519 密钥 |
| 本机私钥 | `C:\Users\Administrator\.ssh\codex-tether-hub-deploy` |
| 公钥注释 | `codex-tether-hub-deploy-2026-10-27` |

连接命令：

```powershell
ssh -i C:\Users\Administrator\.ssh\codex-tether-hub-deploy root@8.220.198.26
```

不要把私钥或 `.runtime/hub-secrets.env` 的内容粘贴到聊天、Issue、日志或提交中。专用公钥目前仍保留在服务器 `/root/.ssh/authorized_keys`，便于继续维护；项目完成后可撤销。

### 域名

| 项目 | 值 |
|---|---|
| 已购域名 | `remotestitch.com` |
| 计划 Hub 域名 | `hub.remotestitch.com` |
| A 记录 | `hub` → `8.220.198.26`（阿里云权威 DNS 已配置） |
| 当前公网状态 | 暂未生效；新注册域名当时处于 `clientHold`，需等待实名/注册局审核解除 |
| 当前可用临时域名 | `8-220-198-26.sslip.io` |
| 当前 HTTPS URL | `https://8-220-198-26.sslip.io` |
| 当前 Node WSS URL | `wss://8-220-198-26.sslip.io/ws/node` |
| 域名购买页面价格 | 首年 `¥85`、续费 `¥95/年`（以阿里云订单为准） |

服务器和域名首年页面价格合计约 `¥164`，不包含未来续费或可能新增的服务。

## 3. 代码与版本

- GitHub 仓库：`qi001007/tether-harness`
- 本地仓库：`E:\遥望科技实习项目\tether`
- 本地当前 `main`：`dd4ea7141b57e90449ab413037a74630e51abb13`
- 服务器当前部署：`b9d8eb5a5b4eb6023041b79ecb04112599110adf`
- Hub 功能提交：`b9d8eb5 feat: add self-hosted hub mode for cross-network control`
- 服务器之后本地又有 3 个纯 UI 修复提交：`9e41b85`、`69f231a`、`dd4ea71`。这些尚未部署到服务器。

继续开发前必须明确：**服务器并不等于本地最新 HEAD。** 如要升级，应先审查 `b9d8eb5..dd4ea714`，执行回归，再部署；不要直接假定线上已经同步。

原始部署说明：`deploy/hub/README.md`。

## 4. 服务器部署状态

### 路径与服务

| 项目 | 值 |
|---|---|
| 代码 | `/opt/tether/app` |
| Python 虚拟环境 | `/opt/tether/app/.venv` |
| Controller 环境文件 | `/opt/tether/app/.env`，权限 `root:tether 0640` |
| 数据库 | `/opt/tether/data/controller.db` |
| systemd unit | `/etc/systemd/system/tether-hub.service` |
| Caddy 配置 | `/etc/caddy/Caddyfile` |
| Controller 监听 | `127.0.0.1:18890` |
| 公网入口 | Caddy `:443` |

当前 Caddy 配置：

```caddyfile
8-220-198-26.sslip.io {
    reverse_proxy 127.0.0.1:18890
}
```

环境变量只列名称，不列秘密值：

```dotenv
TETHER_PORT=18890
TETHER_HOST=127.0.0.1
TETHER_DB=/opt/tether/data/controller.db
TETHER_NODE_TOKEN=<secret>
TETHER_ACCESS_TOKEN=<secret>
```

### 已核实运行状态

- `tether-hub.service`：`active`、`enabled`
- `caddy.service`：`active`
- `127.0.0.1:18890`：仅回环监听
- 公网 `:443`：由 Caddy 监听
- Caddy：`2.6.2`
- Python：`3.12.3`
- HTTPS 证书：Let's Encrypt，有效；Node.js TLS 检查 `authorized=true`
- `/api/state`：无访问令牌返回 `401`；正确访问令牌返回 `200`
- 当前服务器安全代理 `aegis.service` 为 `failed`；不影响 Tether/Caddy，但应单独检查阿里云安全中心代理。

常用检查命令：

```bash
systemctl status tether-hub --no-pager
systemctl status caddy --no-pager
journalctl -u tether-hub -n 100 --no-pager
journalctl -u caddy -n 100 --no-pager
ss -lntp | grep -E '(:443|:18890)'
sudo -u tether git -C /opt/tether/app rev-parse HEAD
```

## 5. 令牌与本地配置

生成了两个独立的 256-bit 随机令牌：

- `TETHER_NODE_TOKEN`：Node 注册 Hub
- `TETHER_ACCESS_TOKEN`：操作者 APP 调用 `/api/*`

秘密值只保存在：

```text
E:\遥望科技实习项目\tether\.runtime\hub-secrets.env
```

该目录被忽略，不能提交。操作者 APP 的项目 `.env` 已设置：

```dotenv
TETHER_CONTROLLER_URL=https://8-220-198-26.sslip.io
TETHER_ACCESS_TOKEN=<secret>
TETHER_INSECURE_TLS=0
```

修改前 `.env` 备份：

```text
E:\遥望科技实习项目\tether\.runtime\env-before-hub-20261027.bak
```

令牌必须由 APP 服务端注入，不能传给浏览器页面，不能打印进日志。

## 6. 已完成与验证结果

### Hub 功能

- Controller 增加访问令牌：`/api/*` 无令牌 `401`，正确令牌 `200`。
- APP 增加远端 Hub 模式：配置 `TETHER_CONTROLLER_URL` 和 `TETHER_ACCESS_TOKEN` 后，不再自启本地 Controller；令牌在 APP 服务端注入。
- Node 支持 `wss://`；可用 `TETHER_CA_FILE` 信任私有 CA，也保留仅演示用的不安全 TLS 回退。
- systemd、Caddy、域名和自签回退说明位于 `deploy/hub/README.md`。
- 当时回归结果：Python `32/32`、JavaScript `23/23`；插件 bundle 未修改。

### 实机证据

- APP 日志显示：`services hub controller=online node=external`。
- APP 的“服务”抽屉已实机显示：
  - `远端 Hub`
  - `Controller 运行中 · :443`
  - `Node 外部管理 · DESKTOP-LOCAL`
  - 当前 Hub `https://8-220-198-26.sslip.io`
- Windows `curl.exe` 曾因本机 Schannel 返回 `SEC_E_NO_CREDENTIALS`，但同机 Node.js HTTPS 探针成功，且服务器端 HTTPS/证书验证成功；这不是 Hub 证书故障。

## 7. 尚未完成的部分

1. **目标机 Node 未接入。** LAPTOP-01 仍未注册。为排除链路问题，已把本机 `DESKTOP-LOCAL` 通过 `wss://8-220-198-26.sslip.io/ws/node` 注册到 Hub，APP 互联页实测显示 `1 / 1 在线`；这只证明单机经 Hub 的链路，不等于双机验收。
   同时修复了 Windows Node 的 wss bug：`websockets.connect` 不能显式传 `ssl=None`，否则报 `ValueError: ssl=None is incompatible with a wss:// URI`；现在只在有 CA/不安全开关时才传 `ssl`。目标机必须拉到此修复后再接入。
2. 目标机计划是 Windows `LAPTOP-01`；历史报告路径为 `C:\tether-node\app`，但必须先到目标机重新确认路径和版本，不能直接覆盖。
3. 目标机接入后仍需验证：设备在线、文件资源管理、权限、改名、审计和任务。
4. 原生 DSH iframe 已改为每设备公网子域：Hub 设置 `TETHER_SURFACE_SUFFIX`，Caddy 按需 TLS 服务 `g<port>.<suffix>`，`surface_mux.py` 转发到该设备 loopback 网关（含 Cookie/WS）。本机 APP 与插件已实测加载原生页；目标机接入后同一路径可用。
5. 单用户共享令牌属于当前演示阶段；正式多用户产品需要账号、设备配对、令牌轮换和权限模型。
6. `hub.remotestitch.com` 需等待 `clientHold` 解除，公网 DNS 生效后再替换临时域名并申请正式证书。
7. 真实大文件上传、真实模型服务发送、原生文档持久化和第二台机器验收不能由本地 UI 或 HTTP 200 代替。

## 8. 下一步操作顺序

### A. 接入 Windows 目标机

先在目标机确认仓库路径和代码版本，然后配置目标机 `.env`：

```dotenv
TETHER_CONTROLLER=wss://8-220-198-26.sslip.io/ws/node
TETHER_NODE_TOKEN=<读取 .runtime/hub-secrets.env，不要打印>
TETHER_DEVICE=LAPTOP-01
```

使用正式证书，**不要**设置 `TETHER_INSECURE_TLS=1`。目标机拉取最新代码后，从仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\hub\join-node.ps1 `
  -HubUrl wss://8-220-198-26.sslip.io/ws/node -DeviceName LAPTOP-01
```

脚本会隐藏输入地询问 `TETHER_NODE_TOKEN`，只通过环境变量传给节点，不打印、不写盘、不进 git；随后调用 `laptop/tether-node.ps1` 建立出站 WSS。若目标机仍是旧代码（早于 `b9d8eb5`），先 `git pull`，旧 Node 不支持 `wss://`。

成功门槛：

1. 目标机只建立出站 WSS，不开放入站端口。
2. 服务器日志出现 `LAPTOP-01` 注册。
3. APP 从 `在线设备：否` 变为在线并可选择目标设备。
4. 文件/权限/改名/审计各做一次真实操作并核对服务器状态。
5. 原生 iframe 使用 g<port>.<suffix> 公网 origin；记录实际设备端口与加载结果。

### B. 域名审核通过后切换

先用公共 DNS 确认：

```powershell
Resolve-DnsName hub.remotestitch.com -Type A -Server 1.1.1.1
```

只有结果为 `8.220.198.26` 后，才把 Caddy 改为：

```caddyfile
hub.remotestitch.com {
    reverse_proxy 127.0.0.1:18890
}
```

然后依次验证 Caddy reload、HTTPS 证书、无令牌 `401`、有令牌 `200`、Node WSS 重连，再更新 APP/Node URL。不要在 DNS 尚未恢复时删掉当前可用的临时入口。

### C. 继续开发 APP

建议按以下优先级：

1. 完成真实 Windows 目标机 Node 接入和双机验收。
2. 补原生 DSH 工作区的远端反向代理/会话路由。
3. 设计设备配对、每设备凭证、吊销与轮换，替换共享密钥。
4. 加入升级部署脚本，明确线上 commit、数据库备份和回滚流程。
5. 处理 `aegis.service`，并做最小服务器加固：禁用 SSH 密码登录前先验证密钥、限制 SSH 来源、配置备份与日志轮转。

## 9. 对接时必须坚持的验证边界

- 本地插件通过不等于第二台机器通过。
- 页面能渲染不等于原生 DSH 会话、轨迹、模型权限和文件行为通过。
- HTTP `200` 不等于文件/模型/持久化业务验收通过。
- 任何升级都要记录本地 commit、服务器 commit、目标机 Node commit 和插件安装哈希。
- 不要删除现有 `.runtime` 备份、服务器数据库或专用 SSH 公钥，除非先得到主人明确授权。

