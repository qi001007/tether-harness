# docs 变更记录

## 2026-10-28 v0.2.2 修复与发布准备

- APP 首次 bootstrap：修正 PowerShell 变量大小写冲突导致的 venv 空装，增加解释器可见性重试、依赖导入校验与 `bootstrap.log`。
- Node：`active_profile()` 在 descriptor 缺失或无 profile 时从 DSH Host argv 推断 profile，远程插件更新不再被 `plugin_profile_unknown` 阻塞。
- Surface 插件：RPC 注册失败不阻断 descriptor 发布；profile 从 Host argv 解析。
- 客户端本机插件更新通道不可用时给出明确降级提示。
- 版本统一 `0.2.2`；Python 76 passed/1 skipped，JavaScript 62 passed；v0.2.2 干净 bootstrap 在临时目录通过。

## 2026-10-28 本机 v0.2.1 基线安装

- DESKTOP-LOCAL 从三份独立 ZIP 安装 APP/插件/Node `0.2.1`；APP 更新中心显示 APP/Node 已是最新。
- 旧 Hub 配置、节点数据库、工作区与 DSH 会话保留；APP supervisor 启动唯一 DESKTOP-LOCAL 节点。
- 发现并记录真实缺陷：APP 首次 bootstrap 空 venv、插件 surface descriptor 未发布、插件本机更新检查 405；作为下一版本修复，不勾选 F28/F30。

## 2026-10-28 v0.2.1 发布收尾

- 更新 README、PRD、PROGRESS、FEEDBACK、TECHNICAL 与 CORE_RECOVERY_PLAN，区分已发布 ZIP 与尚未完成的安装、升级、远端更新、回滚和签名验收。
- 新增 RELEASES.md，简要记录 v0.2.1 制品和 commit、draft、检查、publish、下载核验流程。
- 更新 docs/description.md；仅改公开文档，未改代码或私有资料，未提交或推送。

## 2026-10-28 更新基础版本准备

- 明确先修复和验证更新页面、发布独立基础版本，再验证后续版本软件内升级的执行顺序；服务器接口及真实双机验收保持独立门禁。
- 记录更新页空白的测试桩根因、正常/异常数据下的隔离 Electron 验证及发布前兼容性修复；完整公开发布与真实更新仍按 F30 单独验收。
- 本地完整回归：Python 72 项通过、旧版制品回归 1 项跳过，JavaScript 60 项通过；隔离 Electron 正常/异常工作区场景可显示更新中心。基础版本尚待 GitHub 构建及制品检查。

## 2026-10-28

- 将公开管理文档压缩为当前需求、进度、反馈、技术边界和验收门禁。
- 旧反馈与详细恢复计划副本已归档到仓库外维护备份，并登记 SHA-256。
- 保留未发布、未安装、未完成跨设备验收等事实；不保留逐次操作记录和私有服务细节。
- 记录 F36/F37：本地与远端项目清理、服务端私有化及旧发行包撤下的完成边界；用户决定保留历史、保持仓库公开，不重写历史决定。
- 2026-10-28：F37 收尾：GitHub MCP 确认旧 v0.2.0 Release 的两个 ZIP 资产已删除、Release 说明为 withdrawn，tag 保留；F37 完成。F30 的新独立制品与更新端到端验收仍未完成。

