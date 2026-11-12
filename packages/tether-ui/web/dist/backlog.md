# Generated Web bundle change log

- 2026-11-12: Rebuilt `app.js` with the authenticated Hub file route and restored transfer UI; Node v24.22.1 build succeeded, 8,202,984 B, SHA-256 `37A2FF04F8AB2F192798D7A968F267244C1367E119B9A8112E86688E80390240`. Bidirectional `transferFile` QA passed between DESKTOP-LOCAL 0.5.2 and LAPTOP-01 0.4.11; read-back SHA-256 matched for both 4,259,967 B Chinese text files. QA samples retained under `D:\Tether\work\codex-transfer-qa-20261112-a7ad7a5f9480` on both devices.
- 2026-10-30: Rebuilt `app.js` with update response arbitration, stale/cache provenance, and visible stale or failed update states.
- 2026-10-30: Rebuilt `app.js` with visibility-aware single-flight native-surface polling, obsolete request cancellation, iframe document-load readiness, and bounded retry handling.
- 2026-10-30: Rebuilt `app.js` to retain a same-device, same-source loaded frame across panel visibility changes, show a non-blocking loading status, and use a 30-second bounded retry watchdog.
- 2026-10-30：重建 app.js，包含更新后 installed/latest 状态合并修正。
- 2026-10-30：重建 0.2.29 APP Web bundle；离线 APP ZIP 核实包含显式登录 authority 锁定与本机 surface 快路径修复。

- 2026-11-11：从共享 UI 源码重建 app.js，修复 layered 原生 DSH guest 容器宽度收缩并保留页面切换中的 native-document 状态。
- 2026-11-11：从共享 UI 源码重建 app.js，让 OIDC Electron APP 本机 DSH 使用主进程 managed gateway。
- 2026-11-11：从共享 UI 源码重建 app.js，更新 Codeg native-service guest load 状态快照及 in-place 导航处理。
- 2026-11-12：从共享 UI 源码重建 `app.js`，包含统一 Agent 导航、Herdr 面板启动值归一及 About 客户端版本读取；8,206,204 B，SHA-256 `91DF01D67278DFA38ECD8A967D414AC658D861B8E528AD8346C2F102CBF55808`。尚未部署。

- 2026-11-12：重建 `app.js`，恢复原互联图动画布局与拖动位置行为；Node v24.22.1 构建成功，8,198,437 B，SHA-256 `1CD2EF1A584AD76E9C1A42E089BB949640CB4E300E29D87C301B0313C5C6570D`，已同步至当前 r11 WebUI，Terra 实机确认流动环形/三角布局、缩放、拖动、浮层与切页位置正常；跨页速度连续未证明。
- 2026-11-12：恢复版 pp.js 已由 Terra 实机验收，流动环形/三角布局、缩放、拖动、浮层和切页位置正常；未验证跨页速度连续。
