# 桌面候选打包记录

- 2026-11-27 · 生成目标架构对应的 Node 运行时、DEB 与桌面更新频道文件。
- 2026-11-25：LibreOffice 候选下载改为三次有界重试并先核对 `Content-Length`；0.5.15 CI 在 macOS x64 命中临时镜像篡改，固定 SHA 仍保持真源值，不放宽校验。
- 2026-11-24：0.5.15 安装包不可发布：managed mesh `--no-tun` 下本机 Codeg 的 `agents_runtime_status.url` 为空，APP 本地路径判失败；已安装实例用 app.asar 本机回退修复（备份 `.scratch/codeg-fix-20261124/backup/app.asar`），源码修复（node `loopback_url` + app fallback）待下次重建；冻结 `tether-python.exe` 必须随包重打才能覆盖。
- 2026-11-24：0.5.14 的 app.asar 缺 `data-maintenance.js`——`files` 显式白名单没跟着 `main.js` 的 require 更新，装完启动即 `Cannot find module`。白名单补该文件；`tests/test_candidate_build.mjs` 改为从 `main.js`/`preload.js` 解析真实 require 图和 `__dirname` 子进程入口，要求全部落在白名单里；`afterPack` 直接读 asar 头核对白名单每个 JS。DSH runtime 同时随包 pnpm 11.28.5（`components/dsh/node_modules/pnpm` 加 `components/nodejs/pnpm.cmd`/`bin/pnpm`，由 `prepare_runtime.py` 生成），取代手工指向 `D:\DeepSeek Harness` 的 shim。
- 2026-11-22：为最近两个已发布的 Windows 版本分别生成一个直达补丁，跳过上一版的用户也能一次下载一个补丁。
- 2026-11-22：桌面安装包和独立 Linux Node 一并分发随附 Tomli 的 MIT 许可证。
- 2026-11-13：候选 builder 将固定版本号的 electron-builder 输出根重定向到当前 manifest 版本目录，避免 0.5.5 使用残留的 0.5.4 静态配置时四平台共同失败。
- 2026-11-11：候选构建成功后写入路径/版本/平台所有权标记，并仅扫描隔离候选根的直接子目录；最多保留当前和最近一个有效受管候选，未知目录、无效标记与失败构建均不触发清理。
- 2026-11-09：NSIS同目录首装快照与主进程直接迁移对齐，快照apps.json和agents-runtime持久目录/WAL，跳过runtime.json和server.log；递归拒绝reparse point，并在快照前确认旧Codeg进程已停止，保持私有ACL与snapshot marker流程。

- 2026-11-09：Linux LibreOffice headless runtime 的 Debian Depends 明确包含 `libnspr4`、`libnss3`；Ubuntu 24.04最小镜像实测缺少 soffice.bin 所需 NSS/NSPR SONAME，随包 runtime 先前依赖数组为空。

- 2026-11-09：electron-builder `afterPack` 增加最终 appOutDir runtime 检查；按打包器资源目录 API 检查 Python、Node、MeshCentral、对应平台 MeshAgent、LibreOffice，以及 Caddy/Rclone/EasyTier 四个唯一可执行文件，避免不完整输出通过候选生成步骤。

- 2026-11-10：0.5.2 候选版本同步 APP/Node 元数据；Windows 候选输出改为 portable，并在构建前生成 web UI、核对认证标记及打包版本，纳入 OIDC 主进程模块。Windows runtime 装配与入口检查通过，最终 portable 为 `Tether-0.5.2-win-x64.exe`（823,706,692 字节，SHA-256 `f2ffe0faaa787ea5431f5e85e20c41f58ef7a254c3f342708d65c97a4ddadb90`）；全新数据目录冷启动退出码 0、stderr 为空、renderer/console 错误均为 0，截图显示干净的 Casdoor 登录入口。正式交付目录仍待真实登录验收后生成。

- 2026-11-08：新增 0.5.0 preview 候选装配入口，固定 electron-builder、Windows NSIS/Linux AppImage 与 deb/macOS dmg+zip 目标；准备组件下载及 SHA-256 校验脚本、PyInstaller 无桌面 Python 命令入口、Electron 资源布局与仅上传 Actions artifact 的工作流。每个平台输出目录独立；工作流从本次源码重建APP web UI。打包清单附固定源码来源与SFTPGo源归档，并明确Office预览、RustDesk远控与DSH/Herdr分发边界。Control负责main/Supervisor/APP updater资源接线。

- 2026-11-08：收紧Electron打包app文件为显式入口JS allowlist，明确排除data/.env/log/sqlite/db；远控候选新增Node.js 24.22.2、MeshCentral 1.3.1及固定MeshAgent资源清单与npm锁、源归档和许可材料；Runtime路径固定到components/nodejs、components/meshcentral、components/meshagent；macOS CLI同时生成dmg和updater zip；工作流Node版本固定24.22.2并收集Python SDK/MCP动态包资源。产出首个Windows x64 NSIS preview 安装候选；源码后续仍有更新，需在下一批次重建。

- 2026-11-08：增加固定 DSH CLI 0.2.1-rc.5 生产依赖锁、原始冻结插件0.2.93、来源与许可材料及四项定向安全依赖override；最终生产锁按官方npm安装脚本生成并完成一次有限 `npm audit --omit=dev`（0项）。候选 staging 位于 E 盘scratch；隔离 DSH宿主/插件启动由Node实施线独立确认。APP文件请求转入受限 `filesRequest` IPC/目标私网files服务，待Control完成main/preload接线后进行源码构建与最终安装候选重建。

- 2026-11-08：加入LibreOffice 26.8.2四平台官方资产SHA-256锁、MSI/DEB/DMG提取器、随包许可证/NOTICE及受信`TETHER_SOFFICE_EXE`入口检查；office_preview采用本次进程树身份跟踪和私有profile清理重试，并以同一自制DOCX/PPTX夹具实际生成可解析PDF且源哈希不变。工作流增加固定preview分支触发和FastAPI/Starlette/Uvicorn/Pydantic/AnyIO收集。准备Linux headless候选tar入口，待Node launcher落盘并和同一staging联调；Debian更新包仍待nfpm接线。

- 2026-11-08：新增固定 nFPM 2.48.0 SHA 校验和 headless Debian `tether-node` 包入口；Linux runtime tar 复用同一 staging，Debian runtime落在 `/opt/tether-node/releases/0.5.0` 并提供 current symlink 与 `tether-node.service`，身份/DB留在 `/var/lib/tether-node`，配置在 `/etc/tether-node/node.env`，不将凭据写入包。workflow会上传 `.deb` 与SHA sidecar；签名manifest的下载URL由后续候选发布步骤填充。首次真实Agent登记仍未闭合，见远控适配独立记录。
- 2026-11-08：headless Debian输出增加包身份/架构/版本/文件大小/SHA JSON片段，unit显式选择preview更新渠道；candidate PyInstaller console资源改绝对workspace路径，macOS自带Bash 3的collect参数避免`set -u`空数组错误。候选preview workflow将等根线程汇总签名发布步骤与业务UI一并接入。
- 2026-11-08：修正锁定npm树内POSIX `.bin`符号链接处理（仅保留解析后仍位于该依赖树内的链接）；macOS最低版本按固定DSH轮子要求设为14.0。候选包上传改为仅顶层安装器/更新metadata/checksum白名单，避免归档`win-unpacked`目录；组装后增加frozen `tether-python -m tether.node.agent --help`和随包Node `--version`入口检查。headless Debian升级脚本记录旧current选择并在新服务启动失败时恢复旧运行时选择，避免切换后假报成功。
- 2026-11-08：Linux候选从固定LibreOffice DEB控制字段生成随包组件的外部系统Depends元数据，Debian包仅声明官方归档中未随包解压的依赖；CI额外运行随包`soffice --headless --version`以发现缺失共享库。
- 2026-11-08：候选安装器checksum manifest仅记录正式更新器/安装器扩展名，排除electron-builder调试配置；四平台CI汇总按Electron Updater 6.8.12的Mac架构筛选规则，校验并合并x64/arm64 `preview-mac.yml`文件列表，保留两种架构各自ZIP的SHA-512与size。
- 2026-11-08：DSH locked node_modules改用目标仍在同锁定树内的安全符号链接复制；根据node-pty固定源码，Linux通过forkpty使用pty.node，不要求仅macOS构建的spawn-helper，因此移除多余node-gyp构建依赖；CI native PTY/Koffi检查有10秒清理上限及2分钟step上限。
- 2026-11-08：headless runtime接入一次码配对入口：PyInstaller dispatcher仅放行`tether.node.pair_cli`并在CI检查其帮助入口，tar随包保留`laptop/tether-node-pair`，Deb安装到`/usr/bin/tether-node-pair`；README说明由APP生成一次码、sudo交互输入及服务启动行为，不把凭据写入包。
- 2026-11-08：Linux runtime装配保留经解析后仍位于组件树内的相对符号链接；只省略未随包使用的MeshCentral CLI链接，并从LibreOffice staging去掉已验证指向同包`/opt`资源的桌面启动器链接。Headless tar/Deb提取允许安全相对链接并拒绝逃逸或悬空链接；CI Codeg构建与平台装配job分别限制15/35分钟。
- 2026-11-08：为固定 MeshCentral 1.3.1 增加 SHA-256 严格锁定的局部适配：补上上游已实现但漏列的 `agenttimestampserver` CLI 参数，并将 MeshCtrl 默认不验证TLS的三个入口改为 Node CA/主机名验证；版本、上下文或输出哈希任一不匹配即构建失败。runtime metadata 记录补丁前后哈希。
- 2026-11-08：headless Debian nfpm 2.48.0配置使用官方脚本字段 preinstall/postinstall/preremove/postremove；Node依赖复制先规范化真实路径，支持macOS /var 与 /private/var别名，并拒绝越出锁定依赖树的source。通过官方源码字段对照和本地路径别名夹具。
- 2026-11-08：Debian候选运行包补建受限`tether-easytier` system group/user（no-login、no-home），仅初始化`/var/lib/tether-easytier[/instances]`私有目录，并声明`passwd`/`util-linux`运行依赖；README说明root Node服务与非提权EasyTier子进程的权限边界。
- 2026-11-08：候选 workflow 根据 commit message 的 `[posix-only]` 标记选择纯 Linux/macOS matrix，并跳过预览聚合；普通 push 和手动 dispatch 保持完整矩阵。
- 2026-11-08：候选构建器分别替换 runtime 根和 `node-bin` extraResource 源路径，避免前缀替换拼出无效 YAML；两条资源映射都按唯一匹配检查。
- 2026-11-11：候选 run marker 改为平台无关，构建前完成直接子目录/链接校验、登记与旧受管 run 清理；失败 run 保留 marker。清理跨平台和有效旧版本保留 current + 最近一个受管 run，不接管非空无标记目录；候选测试 16 项通过。
- 2026-11-11：Linux headless Node tar/Deb builder now derives artifact paths, package metadata, Debian runtime selection and packaged install instructions from `version.json` so preview builds cannot silently land under stale 0.5.0 paths.

- 2026-11-12：候选构建输出与 runtime guard 改为随已校验 APP/Node 版本分根，0.5.3 预览不覆盖 0.5.2 资产；electron-builder 基础输出根更新为 0.5.3。
- 2026-11-12：Windows 候选 builder target 从 portable 改为 NSIS，Linux AppImage/deb 与 macOS dmg/zip 保持原样；候选测试直接验证传入 electron-builder 的平台参数。
- 2026-11-12：同步 0.5.4 候选的 APP/Node/Python 发行版本，保留插件 0.2.93；输出仍按候选版本隔离，避免覆盖已发布的 0.5.3 资产。
- 2026-11-12：将 electron-builder 固定输出根同步到 0.5.4；保持构建器的版本匹配保护，修正初次 0.5.4 CI 候选失败的路径元数据。

- 2026-11-13：NSIS customInit 在旧 Tether 卸载前为已安装升级准备同卷 tether-up 临时目录，确认短路径可写后仅设置当前安装器进程 TEMP/TMP，使后续旧卸载器继承；新装跳过。依据 pinned electron-builder 26.18.0 的 initMultiUser/customInit 调用顺序、FileFunc GetRoot 与 NSIS 内建 GetTempFileName 官方语义，以及仓库 portable.nsi 的 SetEnvironmentVariable 调用形式；本机无 makensis，真实编译留待 0.5.6 CI。
- 2026-11-13：修正 NSIS upgrade-temp 函数的预处理 include 顺序，在其定义前显式加载 LogicLib.nsh/FileFunc.nsh，避免 Windows CI 在解析 `${IfNot}` 时失败；卸载与临时目录行为不变，等待下一次 Windows CI 真编译。

- 2026-11-13：准备 Laptop 稳定入口安装 helper（默认 Plan、-Execute 才写）：固定旧 shim SHA/新稿 CRLF SHA、CreateNew 回滚备份、同目录原子替换并核对 SHA 与 ACL；未运行/上传。

- 2026-11-13：准备 0.5.7 预览候选版本：APP/Node 同步为 0.5.7，插件保持冻结 0.2.93；仅更新应用包锁文件顶层版本，不重解依赖。

- 2026-11-21：在桌面打包文件清单保留本机中转授权模块。

- 2026-11-21 Windows 包合并重复 Office 引擎，保留离线 Word/PPT 预览和 C++ 运行库。各平台仅打入对应的 Herdr 二进制及许可。

- 2026-11-22：Windows 单文件差分复用 electron-updater COPY/DOWNLOAD 计划，集中新增字节并把 SHA-512 记录到 preview.yml。隔离构建可用 TETHER_WINDOWS_DELTA_BASE_DIR 选择旧候选目录。

- 2026-11-22：Windows 发行和隔离 QA 共用 NSIS 压缩入口。核验锁定的 7-Zip 24.09 并固定四线程，复现原公仓安装器的 LZMA2 分块。压缩参数仅在本次打包时生效，打包退出后还原依赖文件。

- 2026-11-22 Windows 安装包携带原节点接管工具，配合正式更新启动流程直接改用同一 App 内的节点程序。

- 2026-11-25 唯一入口收口：入口创建只归安装器。`electron-builder.yml` 显式 `nsis.shortcutName: Tether`（productName 改名不得静默换桌面图标名）；`nsis/migration.nsh` 的 `TetherPurgeLegacyEntries` 由 `customInit` 与 `customUnInstall` 同时调用，删 `Tether APP.lnk`/`Tether APP.cmd`/`Tether-App.cmd`（current 与 all 两个 shell 上下文都扫，公共目录无权限时静默失败）。清理对 legacy 名是无条件的，与 APP 运行时的"指向另一份仍在的安装就保留"不同——安装动作本身是用户显式发起的。`desktop/install-app.ps1` 不再用 `electron.exe` 兜底图标，缺品牌图标直接 throw。
