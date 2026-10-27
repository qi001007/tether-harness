# 变更记录

- 2026-10-28：移除局域网 Controller 和示例 token 默认值；bootstrap 从 `.env` 复用 Hub 与 Node 配置，缺项时给出修复方式，不要求 DeepSeek API key，也不显示 token。
- 2026-10-28：以 Windows PowerShell 5.1 兼容方式写 UTF-8 无 BOM `.env` 并用 UTF-8 读取既有配置；重复的 Hub/Node 配置键会在依赖安装前报错，避免 dotenv 末项胜出导致连接错配。
