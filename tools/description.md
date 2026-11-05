# Tether 笔记本诊断工具

只读收集 Windows 上 Tether 的进程、监听端口、服务、安装目录与最新日志，脱敏 token 后打包到桌面。

- `Tether-Diagnostics.cmd`：双击运行。
- `tether-laptop-diagnostics.ps1`：实际采集脚本；不杀进程、不改配置。
- `Tether-Diagnostics.zip`：上面两个文件的发布包，托管在 Hub `/install/Tether-Diagnostics.zip`。
- `Repair-LAPTOP.cmd` / `repair-laptop-node.ps1`：复用旧 APP 的 node token，安装并启动 0.3.6 headless node，注册登录启动；失败时打印 node 日志。
