# 工作流目录

本目录定义 Tether 的 GitHub Actions 流程。`release.yml` 先从固定 Codeg 源码构建 Agents 前端，再检查并签署 APP 和 Node 制品。候选分支保存签名产物供验收。main 手动流程或版本标签在依赖、构建、回归和发行包校验通过后生成发行草稿。
