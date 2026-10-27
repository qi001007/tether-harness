# 目录说明

本目录保存 Tether 的开发、运行和插件构建辅助脚本。`build-native-ui-bridge.mjs` 基于本地 DeepSeek Harness runtime 的原始 client bundle 生成独立 UI 复用包，不触发上游插件注册或应用。`qa_native_surface.mjs` 为目标设备的完整 DSH 原生页面提供本机、只读 Playwright QA。
