# 发布产线 v1（阶段 2：可运行脚手架，未触发）

状态：阶段 2 已落地。`.github/workflows/release-matrix.yml` 与 `scripts/release_pipeline.py bump` 已就绪；本阶段未触发任何 workflow、未发布、未切 Hub、未动设备、未提交。基线为工作树 `codex/tether-0510-node-compat`（含主人未提交改动）。

## 1. 现状审计

| 流水 | 触发 | 任务 | 产物 |
|---|---|---|---|
| `release.yml` | `release-candidate/v*`、`v*` tag、main 手动 | `build-codeg`（ubuntu 编静态 web）→ `build-and-draft`（windows-latest：校验 tag/版本、pytest+mjs/cjs、签名打包）`release.yml:19-53,55-191` | `tether-app-<v>.zip`（Windows 专用运行时，`scripts/build_release.py:414`）、`tether-node-<v>.zip`、`tether-update.json`；x64/Windows 单平台，草稿 `release.yml:205-251` |
| `tether-desktop-candidate.yml` | 仅手动 dispatch（`:6-25`） | codeg web `:39-73`；四平台打包 `:74-276`；签名装配草稿 `:277-538` | `Tether-<v>-win-x64.exe`、mac x64/arm64 dmg/zip、linux x64 AppImage/deb、headless linux x64 tar/deb |
| `posix.yml` / `install-smoke.yml` | 路径触发 / 手动 | ubuntu+macos 的 Node 归档、POSIX PTY 与干净安装 | 无发行物，仅回归 |

仍需手工：草稿发布（CI 拒绝覆盖已发布，`release.yml:234-240`）；Hub 缓存/pin/reload（`docs/PROGRESS.md:92`，原型 `promote-hub-0514.ps1` 已不在本工作树 `.scratch/release-0510-upgrade`）；真机验收（`docs/SIGNING.md:11-13`）；ARM64 第三方二进制补入。版本号现可由 `scripts/release_pipeline.py bump --version X.Y.Z --write` 同步四处；stable 的 CI 仍只校验不生成。清单签名已自动：缺 `TETHER_RELEASE_PRIVATE_KEY` 直接失败（`release.yml:166-191`，candidate `:407-420`）。candidate 现已补 Windows/Ubuntu/macOS 的 pytest+node 测试 job，package 依赖该 test job；stable 仍 deselect 一项（`release.yml:163`）。

## 2. 构建矩阵

| target | GitHub runner | Electron 打包 | Node-only | 结论 |
|---|---|---|---|---|
| win-x64 | `windows-latest` | 可行（NSIS x64） | 可行 | P0 保留 |
| linux-x64 | `ubuntu-22.04` | 可行（AppImage/deb） | 可行 | P0 保留 |
| mac-arm64 | `macos-15` | 可行（dmg/zip，未公证） | 可行 | P0 保留 |
| mac-x64 | `macos-15-intel` | 可行（源码编 cryptography，`:130-145`） | 可行 | P0 保留 |
| linux-arm64 | `ubuntu-24.04-arm`（公共仓可用） | 技术上可编，但 `desktop/packaging/build-candidate.mjs:157-160` 拒绝非 mac arm64，且无 DSH | 可到 Python Node+Codeg+终端/传输，需补 herdr/croc arm64 | P1 Node-only |
| win-arm64 | `windows-11-arm`（公共仓预览；本仓已确认 public） | Electron 可编，但 codeg-server 与 herdr 无 win-arm64 | 不可 | 暂不可行 |

macOS 不用 `macos-14`：该镜像 2026-07 已停止支持，arm64 用 `macos-15`、x64 用 `macos-15-intel`（与现 candidate 一致）。

## 3. 产物命名与更新清单

- 安装器沿用 `Tether-${version}-${os}-${arch}.${ext}`（`desktop/packaging/electron-builder.yml:3`）；headless 用 `Tether-node-runtime-<v>-<platform>-<arch>.tar.gz|.deb`。
- 清单 schema 1 保持向后兼容，新增 `components.<app|node>.platforms.<os>-<arch> = {url,size,sha256,format}`；旧客户端忽略未知键，仍验签整份清单（`tether/updates.py:720-773`）。
- 选择逻辑：打包 APP 走 electron-updater 的 `latest.yml`/`preview*.yml` 与频道（`apps/tether-app/update-service.js:421-424`）；源码/Node 走 Python 更新器，按 `sys.platform`+`platform.machine()` 选包，现仅 debian 有架构映射（`tether/updates.py:642-657`），v1 补通用 selector。
- 兼容：`tether-node-<v>.zip`（通用 x64 包）保留为默认键，ARM64 只新增 `platforms` 项，不删旧字段。

## 4. 签名与公证

- 清单 Ed25519：已有，必须保留 `TETHER_REQUIRE_SIGNED_RELEASE=1`。
- Windows Authenticode：完全没有（`docs/SIGNING.md:6-7`）；需 OV/EV 证书或云签名，CI 对最终 exe/nsis 做 `signtool` 与 `/verify`。
- Apple：无 Developer ID、无公证；需证书与 `notarytool`（App Store Connect API key 更稳），否则 Gatekeeper 拦截。
- Linux：无代码签名，保留 `SHA256SUMS.json` 与 manifest SHA-256；可选 minisign。

## 5. 第三方二进制边界

- codeg-server 预编译 5 平台：win/linux/mac x64、linux/mac arm64，无 win-arm64（`desktop/packaging/component-assets.json:18-62`）。
- herdr v0.9.5 上游有 `linux-aarch64`，但 `scripts/hydrate_herdr_runtime.py:23-81` 未固定；无 windows arm64。
- croc 11.6.3 上游有 Linux/Windows ARM64，仓库只带 4 个文件（`tether/node/bin`、`scripts/build_release.py:74-80`）。
- DSH 打包只映射 4 个 target（`desktop/packaging/prepare_runtime.py:501-509`），ARM64 无 node-pty 预编译，故 ARM64 不带 DSH 面板。

## 6. 阶段计划

- P0（无新凭据）：完成。`release-matrix.yml` 四平台矩阵、每平台测试门、版本一致性检查、产物命名、ARM64 仅登记不构建。
- P1：完成版本 bump（`scripts/release_pipeline.py bump`，默认 dry-run）。linux-arm64 Node-only 引入 herdr/croc 校验和、草稿装配复用仍未做。
- P2：Windows/Apple 签名接入（步骤见 `docs/SIGNING_SETUP.md`）；Environment 审批门；Hub pin 自动化（需 Hub 侧接口与凭据）。
- P3：win-arm64 取决于 codeg-server/herdr 是否出 arm64，不能由本仓单方面完成。

## 7. 需主人提供的 secrets

`TETHER_RELEASE_PRIVATE_KEY`（已有）、Windows 证书 PFX+口令（或 Azure Trusted Signing 账号）、Apple 证书 P12+口令、`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`（或 ASC API key）、可选 Linux 签名密钥。每个 secret 的用途与申请步骤见 `docs/SIGNING_SETUP.md`；证书必须由主人或公司实名办理，Agent 不能代办。`GITHUB_TOKEN` 内置；Hub 凭据不进 CI。

## 8. 结论

| 现在能全自动 | 仍需人工 | 不可行 |
|---|---|---|
| 版本校验/版本 bump、Codeg web、四平台包、清单签名、草稿上传 | 草稿转公开、Windows/Apple 签名（需证书）、Hub pin/reload、真机验收、ARM64 二进制引入 | win-arm64 全套、ARM64 Electron+DSH、全自动 Hub 切换 |

## 9. 阶段 2 交付物

- `.github/workflows/release-matrix.yml`：仅 `workflow_dispatch`；`preflight` → `build-codeg-web` → `package`（win-x64/linux-x64/mac-arm64/mac-x64，每平台先跑 pytest 与 node 测试，再打包；`SIGN=0` 产出 unsigned + `SHA256SUMS` + `signing-status.json`）→ `assemble-draft`（签名 schema 1 清单、上传 GitHub **draft** release）。无 publish、无 Hub 步骤。
- `scripts/release_pipeline.py`：新增 `bump --version X.Y.Z`，同步 `version.json`、`apps/tether-app/package.json`、`package-lock.json`（顶层与根 packages 条目）、`pyproject.toml`；默认 dry-run，`--write` 才写；写后自检一致性。
- `tether-desktop-candidate.yml`：新增 `test` job（Windows/Ubuntu/macOS 跑 pytest + node 测试），`package` 依赖 `build-codeg-web` 与 `test`；保留手动触发、concurrency 与草稿属性。
- `docs/SIGNING_SETUP.md`：Windows CA/Azure Trusted Signing、Apple Developer ID + notarytool、费用、secret 名单、unsigned 降级与用户提示。
- `docs/release-pipeline/release-matrix.draft.yml`：保留为历史草稿，实际运行以 `.github/workflows/release-matrix.yml` 为准。

启用顺序：补 `TETHER_RELEASE_PRIVATE_KEY`（清单签名必需）→ 先 `sign=false` dispatch 一次产出 unsigned draft → 用 `scripts/qa_release_artifacts.py` 验资产 → 再补平台证书并 `sign=true`。草稿转公开、Hub pin 仍由人工执行。

边界：矩阵 draft 的清单是 `platforms` 映射（app 4 平台、node 仅 linux-x64）；旧版单包字段（`tether-app-<v>.zip`、`tether-node-<v>.zip`、顶层 `url/sha256/size`）仍由 `scripts/build_release.py` 在 promote 前合并，未在本草稿中生成。两份 `preview-mac-<arch>.yml` 也需在发布前合并为 `preview-mac.yml`。

## 10. 阶段 2 本地验证（未触发 workflow）

- `python scripts/release_pipeline.py bump --version 0.5.15`：dry-run 列出 4 个文件，仓库仍保持 0.5.14；`status` 通过。
- `.github/workflows/release-matrix.yml`、`tether-desktop-candidate.yml`、`release.yml`：PyYAML 解析通过；新 workflow 的 3 段内联 Python 均通过 `compile`；矩阵 4 target，`package` 依赖 `preflight` + `build-codeg-web`，汇总 job 只创建 draft。
- `tests/test_release_pipeline.py`（4 项）与 `tests/test_release_workflow_validation.py`（14 项）全部通过；`tests/test_candidate_build.mjs` 17 项通过。
- 未 dispatch 任何 workflow、未发布、未切 Hub、未 commit。