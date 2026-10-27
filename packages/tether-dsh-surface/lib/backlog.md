# tether-dsh-surface/lib 变更记录

## 2026-10-27

- 新增 loopback origin 校验、loader readiness、descriptor 原子写入以及按 pid/origin 所有权清理。
- 活进程拥有的 descriptor 不可覆盖；确认 pid 已退出的陈旧 descriptor 才允许替换。
