# Windows 安装器扩展

此目录为 electron-builder 的 NSIS 安装流程提供扩展。`migration.nsh` 接入升级前的设备身份保留，并为旧卸载器设置当前安装盘上的短临时路径；`preserve-legacy-data.ps1` 只处理既有安装数据的保留。编译入口仍为现有 desktop candidate 构建，不单独维护安装引擎。
