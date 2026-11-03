# Windows 代码签名与发布签名

## 当前状态

- 发布 manifest 已用 Ed25519 签名，客户端会验签；`qa_release_artifacts.py` 会校验 manifest 与三件套 SHA-256。
- **Windows 可执行文件尚未 Authenticode 签名**：APP 的 Electron 入口、任何安装器和生成的快捷方式都没有证书签名，SmartScreen 仍可能提示未知发布者。

## 正式发布需要

1. 取得 OV/EV 代码签名证书（含私钥，硬件令牌或云 HSM）。
2. 对最终可执行文件/安装器运行 `signtool sign /fd SHA256 /tr <RFC3161> /td SHA256`，再做 `/verify /pa`。
3. CI 使用签名服务或受控 runner；证书私钥不进入仓库、不进入发布 ZIP。
4. 在干净 Windows 机器上验证文件属性、SmartScreen 和安装/更新链。
5. 保留签名日志和证书序列号，发布记录中写明签名主体与时间戳。

## 未完成原因

当前没有可用的代码签名证书/云签名服务；不能用自签名证书冒充正式签名。取得证书后按上述步骤接入 CI，再更新发布门禁。