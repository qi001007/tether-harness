# desktop

桌面插件与 MCP 安装、APP 启动和网络辅助脚本。插件安装器在有匹配上游源码时生成原生 UI 桥，并验证或复制固定的插件本机更新器文件到 surface package；独立发布包会校验并使用随包资源，再通过 DSH 插件管理器更新现有 Tether 插件。私有 Controller 的 LAN/Tailscale 启动脚本位于 `tether-harness-server/scripts`。使用前应保存当前对话和文件编辑。
