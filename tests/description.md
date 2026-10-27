# 目录说明

本目录存放公开客户端、插件、Node 和 Electron APP 的自动化测试。`qa_updates_electron.mjs` 会在临时 root、独立 userData 和 stub Controller 中启动 Electron 并截取更新中心，不会复用或关闭用户正在运行的 APP。
APP/插件/Node 更新事务、设备身份、更新 API authority 路由、原生 DSH 活动 turn 保护及进程生命周期由离线 fixture 覆盖。Controller 实现与服务端专属测试位于私有 `tether-harness-server` 项目。
更新 manifest 的下一版兼容性由当前 updater 对未来版本 ZIP 的真实暂存覆盖。
Node 启动配置回归实际调用 python-dotenv 读取 UTF-8 无 BOM 的临时 `.env`，包括中文路径和设备名。
Release workflow 校验回归会在临时本地 Git 仓库中执行实际 PowerShell 脚本，并模拟 Actions 的退出码包装。
