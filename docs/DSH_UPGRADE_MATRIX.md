# DSH 升级与插件安装验收矩阵

目标：DSH 自身升级、安装 APP/插件、插件缺失或样式退化时，用户**不需要手工拷文件**；Tether 自动安装/修复，失败时保留 DSH 和 APP 核心页面可用。

## 通过判据

- `surface` 端点返回 200，`dsh_status.running=true` 且 `dsh_status.surface=true`，descriptor 的 pid 与当前 DSH 进程一致。
- 真实页面出现 composer。
- `node scripts/qa_surface_styles.mjs DESKTOP-LOCAL LAPTOP-01` 两台都 PASS：搜索框 `border 0px/none`、按钮 `border 0px/none`、透明背景；不允许出现浏览器默认 `<input>/<button>`。
- 修复失败时，APP 显示明确状态/重试按钮，不显示裸控件页面；DSH 重新启动后核心 APP 页面仍可用。

## 矩阵

| # | 场景 | 操作 | 期望 |
| --- | --- | --- | --- |
| 1 | 干净机器装 APP + DSH | 安装 APP → 启动 → 安装 DSH → 打开工作区 | 自动安装 Tether 插件和 `@deepseek-ai` UI 依赖；descriptor 出现；样式门禁 PASS |
| 2 | fresh DSH profile | 停 DSH，备份并移走 `profiles/desktop/node_modules`，把 `package.json` 重置为只有 `dsh-base`/`dsh-web-app` | `dsh_status.surface=false` 后 APP 自动执行 `dsh_install_plugin`；最多 180 s 等到 descriptor；门禁 PASS |
| 3 | DSH 版本升级 | 用 DSH 官方安装包从 rc.N 升到 rc.M，保留 profile；启动 DSH | **不自动重装插件、不碰第三方插件**；验证带插件的真实 DSH 能映射；只有 Tether 自身 surface 缺失/损坏时才修复 Tether 自己 |
| 4 | 插件更新 | Hub plugin job 更新 Node+插件 | 插件 4 包版本一致；依赖树存在；DSH 重启后 descriptor 新 pid；门禁 PASS |
| 5 | Tether surface 被破坏 | 删除/移走 Tether 自己的包或依赖 | 自动修复 Tether；不修改其他插件；失败恢复 profile 并重新拉起原 DSH |
| 6 | 第三方插件 | 主人选定插件后，在隔离 profile/VM 做 DSH 版本 × 插件安装/卸载/更新/损坏 | 验证映射的是带插件的真实 DSH；第三方插件坏掉只记录，不由 Tether 修 |

## 命令与证据

```powershell
# 真实页面计算样式门禁（读取 apps/tether-app/data/hub.json，不打印 token）
node scripts/qa_surface_styles.mjs DESKTOP-LOCAL LAPTOP-01

# 设备健康
# GET /api/state；POST /api/devices/<id>/fs/dsh_status
# 自动修复
# POST /api/devices/<id>/fs/dsh_install_plugin
```

修复结果应包含 `ok=true`、`version_plugin`、4 个包版本、`descriptor.pid`、`backup`。profile 备份在 `package.json.bak-tether-plugin-<timestamp>`。

## 已知限制

- 当前 DSH 最新仍是 rc.5；矩阵第 3 项目前只有“同版本重装”基线，等 DeepSeek 发布新版本后必须用同一脚本重跑。
- Tether native UI 仍锁 `@deepseek-ai/dsh-client-ui-* rc.2`；如果 DSH 改变 UI 契约，Tether 可能需要发布适配版本，这不算用户要自己修的 bug。
- **不自动重装、不管理第三方插件**；第三方插件在 DSH 更新后坏掉只记录，不由 Tether 修。
- 第三方插件测试按主人要求暂缓，选型后再补第 6 项。
