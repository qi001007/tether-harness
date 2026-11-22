# Windows 安装器扩展

此目录为 electron-builder 的 NSIS 安装流程提供扩展。`migration.nsh` 在升级前解析已有 App 的实际安装路径，使安装器和旧卸载器使用同一目录。既有目录联接继续指向升级后的 App，卸载临时文件留在 App 所在盘。首次安装使用所选空目录或新目录，交互式安装可为已有其他文件的目录建议专用子目录。`preserve-legacy-data.ps1` 处理以前登记在联接路径下的设备身份和应用状态。编译入口仍为现有 desktop candidate 构建。

旧安装若把默认工作目录放在 `resources/tether-source/work-local`，脚本先校验快照，再迁入 App 配置目录的 `work-local`。已有不同内容时保留快照并结束安装。
