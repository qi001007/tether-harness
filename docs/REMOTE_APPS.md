# 远程应用页（0.2.97）

目标：在 Tether UI 里选一台在线设备，打开它本机正在运行的任意 HTTP 服务；不把入口绑死在 DSH。

## 数据来源

目标 Node 读取自己的数据目录（APP 为 `apps/tether-app/data/apps.json`）里的白名单：

```json
{
  "apps": [
    { "name": "Open WebUI", "port": 8080, "path": "/" },
    { "name": "本地文档", "port": 19001, "path": "/docs/" }
  ]
}
```

- `port` 必须是目标机器 `127.0.0.1` 上的 HTTP 端口；`path` 以 `/` 开头。
- 文件修改后在下一次刷新/打开页面时生效，无需重启 Node（按文件内容哈希重建）。
- 转发只绑定 EasyTier 虚拟 IP（`10.144.0.0/24`），不监听公网；目标地址只能是回环地址。
- DSH 不在这个列表里：DSH 有本地票据，继续走“原生工作区”的认证 surface。

## 使用

1. 目标机器已加入 EasyTier 私有网络（虚拟 IP `10.144.0.x`）。
2. 把要暴露的服务写进 `apps.json`。
3. 在 APP 活动栏点“远程应用”→ 选设备 → 点应用卡片；应用会在 Tether 工作区内嵌打开，可刷新/关闭。
4. 想换端口或路径：改 `apps.json`，回到页面点“刷新”。

## 验收（2026-11-03，0.2.97 源码）

- 真机 Electron：`DESKTOP-LOCAL` 的 `Gateway Demo`（19001）经网关 `http://10.144.0.2:<ephemeral>/` 内嵌渲染，`Directory listing for /` 可见；关闭返回卡片列表。
- Hub 通道 `fs/apps_list` 返回 `mesh=10.144.0.2`、应用列表与 URL；无虚拟网卡时返回 `mesh_unavailable`，不硬失败。
- 单元测试：配置解析/坏文件、无网络、回环代理、`apps.json` 热更新，5 passed。

## 非目标与后续

- 不负责启动应用；应用需要先在目标机器上运行并监听回环端口。
- GUI 软件（非 HTTP）不在这一层，属于后续远程控制（M3）。
- CLI Agent（Codex/Claude Code/OpenCode）先用“终端”页运行；结构化接入走 ACP（后续）。
- 网关目前是 VPN 内无额外口令的透明代理，安全性依赖 EasyTier 私有网络；面向团队共享前要加按用户/应用的鉴权。