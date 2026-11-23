# 工作流目录

本目录定义 Tether 的 GitHub Actions 流程。`release.yml` 先从固定 Codeg 源码构建 Agents 前端，再检查并签署 APP 和 Node 制品。候选分支保存签名产物供验收。main 手动流程或版本标签在依赖、构建、回归和发行包校验通过后生成发行草稿。
`release-matrix.yml` 是仅手动触发的 P0 四平台矩阵：每平台先跑 pytest/node 测试，再打包；`SIGN=0` 产出 unsigned 安装器、`SHA256SUMS` 与 `signing-status.json`，汇总 job 生成 schema 1 清单和 GitHub 草稿，不发布、不调用 Hub。`tether-desktop-candidate.yml` 的 `package` 依赖新增的 `test` job。
