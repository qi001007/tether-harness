# 工作流目录

本目录定义 Tether 的 GitHub Actions 流程。`release.yml` 可从 main 手动构建尚无 tag 的 baseline，也可按已存在 tag 的精确提交构建；只有依赖、构建、回归和发行包校验全部通过后，才创建缺失 tag 并上传 Draft Release。该流程不会自动发布 Release。
