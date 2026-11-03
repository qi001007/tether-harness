# 干净目录安装验证（0.2.89）

> 这不是“干净 Windows”验证：本机已有 Python/npm，只验证发布包在无仓库依赖的独立目录能否完成 bootstrap 并启动。

## 步骤

1. 从 GitHub Release 下载 `tether-app-0.2.89.zip`（1.8 MB）。
2. `Expand-Archive` 到 `%TEMP%\tether-clean-0.2.89\tether-app-0.2.89`，不使用仓库源码、`.venv` 或 `node_modules`。
3. 运行 `apps\tether-app\bootstrap-app.ps1`：创建独立 `.venv`、`pip install -e .`，输出 “Python runtime ready”。
4. `npm ci --prefix apps\tether-app`：70 packages，缓存命中 **7 s**。
5. 用独立端口启动：`TETHER_APP_PORT=18992`、`TETHER_PORT=18990`、`TETHER_DEVICE=CLEAN-TEST`，运行发布包自带 Electron。

## 结果

- `http://127.0.0.1:18992/` 返回 **200**。
- `data/app.log` 记录 `app start 0.2.89`、`tray created icon=...\assets\tether-app-s.ico`。
- 窗口渲染出完整登录页（邮箱/密码/两步验证码、邀请码注册、左侧私有设备网视觉），不是白屏或裸控件。
- 启动时 `/api/state` 等本地 API 为 502：发布包没有私有 controller，且未配置 `data/hub.json`；这是登录前的预期状态。

## 未覆盖

- 干净 Windows（无 Python/npm）、DSH 安装与插件注入、登录后 Hub/设备连接、更新链、Authenticode。
- 正式发布前仍需在干净 Win11 机器跑完整链路，并用测试账号登录。