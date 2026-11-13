# 变更记录

- 2026-11-13：现有安装升级时，customInit 在调用旧卸载器前创建安装卷根的 tether-up 并检查可写，只设置本安装器进程 TEMP/TMP。修正 GetRoot 返回不含尾斜杠、GetTempFileName 为内建指令的实际语义；保留新装和身份保留流程。未改系统环境或卸载门禁，真实编译和 055→056 正常更新待 CI / 实机验收。
- 2026-11-13：在非卸载器构建分支的函数定义前显式 include LogicLib.nsh 与 FileFunc.nsh，使 migration.nsh 的函数体能在定义时解析条件宏与 GetRoot；不改条件和升级流程。本机无 makensis，真实编译待下一次 Windows CI。
