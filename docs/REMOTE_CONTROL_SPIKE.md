# 远程控制 Spike（Windows 先验）

状态：**设计完成，未安装/未实测**（2026-11-01）

## 目标

在 Tether 里选中一台在线设备后，直接看到对方桌面并远程操作鼠标键盘；不是 Windows RDP，也不是只打开对方 DSH 页面。Windows 先验；macOS/Linux 只设计接口，未实测前不宣称跨系统通过。

## 候选对比

| 方案 | 许可证 | 架构 | 优点 | 代价/风险 |
|---|---|---|---|---|
| RustDesk（客户端 + Server OSS） | **AGPL-3.0**（Server Pro 为商业闭源） | hbbs 做 ID/信令、hbbr 中继；先 P2P 打洞，失败走中继；支持直接 IP；Windows/macOS/Linux | 跨平台成熟、画面/键鼠/文件完整、可自建、直连延迟低 | AGPL 对商业闭源 Tether 有传染风险；嵌入客户端源码或深度链接需法务评估；自带设备/权限模型与 Tether 重复 |
| MeshCentral | **Apache-2.0** | Node.js 服务端 + MeshAgent + 浏览器 WebSocket 控制；Web 远程桌面/终端/文件 | 许可证宽松、浏览器端成熟、跨平台、审计/多用户 | 是完整外部管理平台，不是库；需要额外服务端/Agent；认证、设备和 UI 需与 Tether 桥接；中继延迟待测 |
| 自研 Windows 采集/输入 | Tether 自有 | DXGI Desktop Duplication + H.264/WebP；SendInput；WebRTC/QUIC 传输；macOS 用 ScreenCaptureKit/CGEvent，Linux 用 PipeWire/uinput | 无许可证冲突、可完全贴合 Tether 设备/权限/审计 | 编解码、拥塞控制、输入时序、跨平台适配工作量最大；不适合作为第一步 |

## 决策

1. **不在本轮把任一方嵌入 Tether 生产代码**。先做受控 spike，用数据决定。
2. Windows 先试 **MeshCentral**（Apache-2.0，外部服务 + Agent，浏览器控制），因为它不引入 AGPL 传染，且最快验证“首帧 + 输入 RTT”。
3. 若 MeshCentral 在 Windows 上达不到指标，再用 **RustDesk 直接 IP + 自建 hbbs/hbbr** 做第二个 spike；只作为**独立进程/独立程序**接入，不复制其源码进 Tether，避免 AGPL 边界不清。
4. 两者都不达标才进入自研采集/输入；自研只做 Windows，再由接口层预留 macOS/Linux。

## Windows Spike 验收

- 首帧 ≤ **2 s**（同 LAN/Tailscale 直连）。
- 输入 RTT ≤ **100 ms**（点击到画面变化，1080p）。
- 1080p、30 fps 可用；断线后 ≤10 s 恢复。
- 只有已认证且被授权的 Tether 会话能发起；每次会话有同意/审计；不开放未认证入站端口。
- 记录：传输路径（直连/中继）、分辨率、帧率、首帧、输入 RTT、CPU/带宽。

## 接入形态（若 spike 通过）

- Tether 设备卡/互联页增加“远程控制”入口，仅对在线、已授权设备显示。
- 控制端在沙箱 iframe/独立窗口中打开；被控端显示明确的本机控制指示与一键断开。
- 设备身份、权限、审计沿用 Hub 账号/设备令牌；不新建第二套账号。
- 跨系统只实现传输/采集/输入适配接口；macOS/Linux 在真实设备验证前标为未支持。

## 不在本 Spike 范围

- 不安装或修改生产设备；不把 MeshCentral/RustDesk 暴露到公网；不做无人值守默认开启；不宣称 macOS/Linux 已通过。

## 参考

- RustDesk 企业自托管说明（客户端与 Server OSS 为 AGPL，Server Pro 商业）：https://rustdesk.com/blog/rustdesk-for-enterprise
- RustDesk 自托管架构（hbbs/hbbr、P2P 优先、直连/中继）：https://rustdesk.com/docs/en/self-host
- MeshCentral 官方仓库（Apache-2.0，Web 远程桌面/终端/文件）：https://github.com/Ylianst/MeshCentral
