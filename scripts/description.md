# 目录说明

本目录保存 Tether 的开发、运行和插件构建辅助脚本。`build-native-ui-bridge.mjs` 基于本地 DeepSeek Harness runtime 的原始 client bundle 生成独立 UI 复用包，不触发上游插件注册或应用。临时 `qa_native_*` harness 已归档到仓库外维护备份；正式回归测试保留在 `tests/`。
`build_release.py` 生成独立 APP、插件、Node 压缩包和带 SHA-256 的更新清单；构建前校验 `version.json`、Python 工程及插件/APP package 版本一致，更新器最低版本独立于制品版本，插件归档同时带有桥生成器和可离线使用的预生成桥模块。
`qa_surface_styles.mjs` 是发布前的真实页面门禁：用无头 Edge 打开每台设备的 native surface，等待 composer 出现，断言工作区搜索框和按钮的**计算样式**（`border 0px/none`、透明背景），不是只看页面文字；DSH 升级后必须对两台设备重跑。
`qa_release_artifacts.py` 是发布制品的干净安装审计：从 Hub manifest 下载当前三件套，验签、校验 SHA-256/大小，解包检查必需文件，并拒绝 `node_modules/data/__pycache__/.env/hub.json/.credentials.yaml` 等泄露项。
