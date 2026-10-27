# 目录说明

本目录保存 Tether 的开发、运行和插件构建辅助脚本。`build-native-ui-bridge.mjs` 基于本地 DeepSeek Harness runtime 的原始 client bundle 生成独立 UI 复用包，不触发上游插件注册或应用。临时 `qa_native_*` harness 已归档到仓库外维护备份；正式回归测试保留在 `tests/`。
`build_release.py` 生成独立 APP、插件、Node压缩包和带 SHA-256 的更新清单；插件归档同时带有桥生成器和可离线使用的预生成桥模块。
