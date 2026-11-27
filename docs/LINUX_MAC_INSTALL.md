# Linux / macOS Node 安装（现行）

以发布产线产物为准（[RELEASE_PIPELINE.md](RELEASE_PIPELINE.md)、[INSTALL_MATRIX.md](INSTALL_MATRIX.md)）。

## Linux x64 / arm64

- 服务器/无桌面机器：安装 `Tether-node-runtime-<v>-linux-<架构>.deb`（或 tar.gz），由包内 systemd unit 启动；控制通道地址与设备令牌在首次登录流程中下发，不写进公开文档。
- x64 有桌面环境时优先安装 APP 的 AppImage/deb，由 APP 管理本机 Node。
- Node 以普通用户或独立服务账号运行，只把配置和令牌文件设为 600；不要手工把节点控制端口暴露到公网。
- DEB 由管理员使用 APT 升级。源码安装在当前 venv 更新依赖，校验失败时随 Node 事务恢复。
- `laptop/install-node.sh --systemd` 默认创建或使用 `tether` 服务账号，`--user` 可指定其他非 root 账号。首次安装采用 readonly 策略，默认可写目录是安装前缀下的 workspace。

## macOS

- 当前只支持 APP（dmg，arm64/x64），Node-only 未作为发行路径。
- 未做公证：Gatekeeper 提示属预期；验收需在干净 Mac 上完成，不能以 CI 构建成功代替。
- 历史 WSL2 测试和 0.3.x 安装脚本只作过程记录，已在 git 历史中；不作为当前安装说明。

## 共同边界

- 版本、架构映射和未完成平台见 RELEASE_PIPELINE §2–§5。
- 真实设备安装结果只在 `PROGRESS.md` 记录；本页不复制数字。
- 卸载时保留用户工作区与身份数据，除非用户明确选择清除。