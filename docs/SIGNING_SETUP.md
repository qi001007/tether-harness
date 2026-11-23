# 代码签名接入手册（Windows / Apple）

状态：2026-11 起草。当前所有安装器均为 unsigned preview；`.github/workflows/release-matrix.yml` 在 `sign=false`（即 `SIGN=0`）时不调用任何签名服务，只产出 unsigned 安装器和 `SHA256SUMS`。

边界：**Windows 证书与 Apple Developer ID 必须以主人或公司的实名主体申请、完成 CA/平台审核并保管私钥，Agent 不能代办、不能代持证书，也不能用自签名证书冒充正式签名。**

## 1. 当前签名链路

| 对象 | 现状 | 校验 |
|---|---|---|
| 更新清单 `tether-update.json` | Ed25519 签名，`TETHER_RELEASE_PRIVATE_KEY` 必须存在（`TETHER_REQUIRE_SIGNED_RELEASE=1`） | `tether.release.verify_signature` |
| Windows 安装器 | 未签名 | `Get-AuthenticodeSignature` 为 `NotSigned` |
| macOS APP/DMG | 未签名、未公证 | Gatekeeper 拦截 |
| Linux 包 | 无代码签名 | 仅 `SHA256SUMS` |

`release-matrix.yml` 的签名开关是 dispatch 输入 `sign`（布尔，默认 `false`）。摘要固定为：`SIGN=0` 不签名；`SIGN=1` 要求对应平台的 secret 齐全，缺失时 job 直接失败，不会静默退回 unsigned。

## 2. Windows：CA 证书（OV/EV Authenticode）

### 2.1 账号与费用

1. 以公司主体向 CA（DigiCert、Sectigo、GlobalSign、SSL.com 等）申请 **OV 或 EV Code Signing Certificate**。EV 的 SmartScreen 信誉积累更快，价格更高。
2. 需要材料：营业执照/统一社会信用代码、注册地址与电话、申请人身份证明、公司邮箱或电话回拨验证。CA 会做主体核验，通常 3–10 个工作日，EV 可能更久。
3. 费用参考：OV 约 200–500 美元/年，EV 约 300–700 美元/年；硬件令牌（USB token）或云 HSM 可能另计。以 CA 官网报价为准。
4. 私钥必须留在硬件令牌或受控 HSM 中；能导出 PFX 的方案要把 PFX 当作最高级别机密。

### 2.2 操作步骤

1. 完成 CA 审核，拿到证书与私钥载体。
2. 在受控 Windows 机器导出带口令的 PFX（例如 `tether-windows.pfx`）。
3. 生成 secret 值（PowerShell）：

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('E:\secure\tether-windows.pfx'))
   ```

4. 仓库 **Settings → Secrets and variables → Actions** 新建：
   - `WINDOWS_CERT_PFX_BASE64`：上一步的 Base64 字符串
   - `WINDOWS_CERT_PASSWORD`：PFX 口令
5. 手动 dispatch `release-matrix.yml`，`sign` 选 `true`。CI 会把 PFX Base64 作为 `CSC_LINK` 交给 electron-builder，并在打包后用 `Get-AuthenticodeSignature` 逐个校验 `.exe`，状态不是 `Valid` 就失败。
6. 在一台干净 Windows 机器检查文件属性“数字签名”、SmartScreen 提示和安装/更新链。SmartScreen 信誉需要真实下载量积累，首次签名后仍可能提示。

### 2.3 Azure Trusted Signing（可选替代）

1. 需要 Azure 订阅，创建 Trusted Signing 账号并完成组织身份验证（Microsoft 侧审核，通常 1–3 周；个人身份仅在部分区域开放）。
2. 创建 Public Trust 证书配置文件，给 CI 使用的服务主体分配 `Trusted Signing Certificate Profile Signer` 角色。
3. 费用参考：Basic 约 10 美元/月（含少量签名次数），以 Azure 官网为准。
4. **当前仓库尚未接入**：workflow 只支持 PFX + electron-builder。接入需要增加 `azure/trusted-signing-action` 或 signtool 的 Trusted Signing dlib，并新增 `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET` 三个 secret。此项归 P2，完成前不要删除 PFX 路径。

## 3. Apple：Developer ID + notarytool

### 3.1 账号与费用

1. 加入 **Apple Developer Program**：个人/组织 99 美元/年。组织账号需要 D-U-N-S 编号（免费申请，通常数天到两周）。
2. 需要一个 Apple ID，并在开发者后台接受协议。
3. 公证使用 App Store Connect API key（推荐）或 Apple ID + App 专用密码，不需要额外费用。

### 3.2 操作步骤

1. 在 **Certificates, Identifiers & Profiles → Certificates** 创建 **Developer ID Application** 证书，下载 `.cer`，在钥匙串中与私钥配对后导出 `.p12`（设口令）。
2. 记录 **Team ID**（Membership 页面）。
3. 生成 App Store Connect API key：**Users and Access → Integrations → App Store Connect API → +**，记录 Issuer ID、Key ID，下载一次性的 `.p8`。`notarytool` 用 `--key/--key-id/--issuer`，比 Apple ID 密码更稳。
4. 仓库 secrets：
   - `MAC_CERT_P12_BASE64`：`.p12` 的 Base64
   - `MAC_CERT_PASSWORD`：`.p12` 口令
   - `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：当前 workflow 传给 electron-builder 的公证凭据
5. dispatch `release-matrix.yml` 且 `sign=true`。CI 把 P12 Base64 作为 `CSC_LINK`、口令作为 `CSC_KEY_PASSWORD` 交给 electron-builder；macOS job 的 `signing-status.json` 记为 `developer-id-unverified`，**必须在干净 Mac 上验收**：
   - `spctl -a -vvv -t install Tether-<version>-mac-<arch>.dmg`
   - `codesign --verify --deep --strict <Tether.app>`
6. 公证建议显式执行 `xcrun notarytool submit ... --wait` 后 `xcrun stapler staple`；接入 App Store Connect API key 后改用 `APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_API_KEY_P8`（当前 workflow 未消费，属 P2）。

## 4. Secret 名清单

| Secret | 用途 | 当前是否被 workflow 使用 |
|---|---|---|
| `TETHER_RELEASE_PRIVATE_KEY` | Ed25519 清单签名（32 字节 seed 的 Base64） | 是，assemble-draft 必需 |
| `WINDOWS_CERT_PFX_BASE64` | Windows PFX Base64 → `CSC_LINK` | 是，`sign=true` 时 |
| `WINDOWS_CERT_PASSWORD` | PFX 口令 → `CSC_KEY_PASSWORD` | 是，`sign=true` 时 |
| `MAC_CERT_P12_BASE64` | macOS P12 Base64 → `CSC_LINK` | 是，`sign=true` 时 |
| `MAC_CERT_PASSWORD` | P12 口令 → `CSC_KEY_PASSWORD` | 是，`sign=true` 时 |
| `APPLE_ID` | 公证账号 | 是，`sign=true` 时传给 electron-builder |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 | 是，`sign=true` 时 |
| `APPLE_TEAM_ID` | Apple Team ID | 是，`sign=true` 时 |
| `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_API_KEY_P8` | notarytool API key | 否，P2 |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Azure Trusted Signing | 否，P2 |

secret 只进 GitHub Actions Secrets，不写入仓库、日志、发布包；证书到期前 30 天轮换，并保留签名日志与证书序列号。

## 5. 未签名降级与用户侧提示

`SIGN=0`（默认）路径：

1. package job 不设置 `CSC_LINK`，electron-builder 跳过签名；macOS 不公证。
2. 每个平台输出 `signing-status.json`（`signing_status: unsigned`）和 `SHA256SUMS`（文件名 + SHA-256）。
3. 汇总 job 仍要求清单 Ed25519 签名；draft release 的正文标注 `Signing requested: false`，**不发布、不切 Hub**。
4. 用户侧表现：
   - Windows：SmartScreen 出现“Windows 已保护你的电脑”，需“更多信息 → 仍要运行”；文件属性无数字签名。
   - macOS：Gatekeeper 提示“无法验证开发者”，需右键“打开”或在“系统设置 → 隐私与安全性”放行；首次启动可能要求手动确认。
   - Linux：无系统级签名提示，用户应按 `SHA256SUMS` 自行校验。
   - 应用内更新仍会验签 Ed25519 清单；未签名只影响安装器本身，不绕过更新清单校验。

`SIGN=1` 路径：缺任一平台 secret 时 job 失败（`docs/SIGNING_SETUP.md` 链接会出现在错误信息里）；Linux 始终 unsigned；macOS 的 `developer-id-unverified` 不代表已通过公证，必须按第 3.2 节在干净 Mac 验收。

## 6. 验收清单

- [ ] Windows 证书主体与公司一致，`Get-AuthenticodeSignature` 返回 `Valid`。
- [ ] macOS `spctl` 与 `codesign --deep --strict` 通过，DMG 已 staple。
- [ ] 干净机器安装、自动更新、回滚均通过。
- [ ] 发布记录写明证书主体、序列号、时间戳与签名时间。
- [ ] `signing-status.json`、`SHA256SUMS` 与 draft 资产一致。