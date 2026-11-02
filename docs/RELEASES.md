# Public client releases

## v0.2.67

Silent startup update check:

- The automatic update check and the local server probe now run with `pythonw.exe` instead of `python.exe`. The update check was the source of a short-lived conhost window at APP startup; the console is gone.
- `pythonw` stdout through `execFile` was verified (`hello`), so update JSON parsing and the updater helper keep working.
- Startup monitor: the update check appeared as `pythonw.exe`, no `python.exe` or associated `conhost`, and the visible short-lived window list was empty.

Gates: mjs 231/231, cjs 6/6, client pytest 147 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41442922613` succeeded; published at 2026-11-02T12:17:27Z (app 1,780,821 B, plugin 1,358,859 B, node 84,818 B; signed manifest verified). Hub mirror refreshed to **0.2.67**. LAPTOP-01 Node+APP **20.8 s**; DESKTOP app/node/plugin **0.2.67**; LAPTOP app/node **0.2.67** with the plugin update job dispatched.

## v0.2.66

Restore the fluid network layout and resume motion across page switches:

- Bring back the force animation that was accidentally removed in 0.2.64. The initial state remains radial/triangular; remote nodes no longer receive the centre pull, so the flow settles into a wide triangle instead of collapsing back into a vertical line.
- Node positions **and velocities** are stored under `tether.network.positions.v3`, saved on drag end and on unmount. Returning to the network page continues from the saved `x/y/vx/vy` state instead of resetting.
- Real run: starting from a cleared snapshot, the nodes flowed from `20.2%,32.8%` to `15.42%,30.04%` with the centre at `50%,50.1%`; after dragging LAPTOP-01 and immediately switching to files and back, the graph resumed from the mid-motion state (`LAPTOP 13.67%,33.04%`, `TETHER 88.69%,59.87%`) rather than the initial layout. The test state was cleared afterwards.

Gates: mjs 231/231, cjs 6/6, client pytest 147 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41440651070` succeeded; published at 2026-11-02T12:00:22Z (app 1,780,669 B, plugin 1,358,856 B, node 84,818 B; signed manifest verified). Hub mirror refreshed to **0.2.66**. DESKTOP app/node/plugin **0.2.66**; LAPTOP Node+APP update dispatched.

## v0.2.65

Floating network detail panel:

- The node detail panel is now an absolute floating card over the right side of the canvas (`top/right/bottom: 8 px`, width 300, rounded, shadow) instead of a flex column. Opening or closing it no longer resizes or shifts the graph. The network body is the positioning context.
- Real run: the canvas stage stayed **1074 px** wide before and after opening the DESKTOP node details; the floating panel rendered with search, per-device switches and the connection manager link.

Gates: mjs 231/231, cjs 6/6, client pytest 147 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41437443163` succeeded; published at 2026-11-02T11:34:42Z (app 1,779,140 B, plugin 1,358,108 B, node 84,818 B; signed manifest verified). Hub mirror refreshed to **0.2.65**. LAPTOP-01 Node+APP **36.9 s**; DESKTOP app/node/plugin **0.2.65**; LAPTOP app/node **0.2.65** with the plugin update job dispatched.

## v0.2.64

Radial network layout and persistent node positions:

- The network canvas now starts in a radial/triangular layout. Two remotes use 210°/330°; three or more are spread at 360°/n around the local device. The old collinear vertical arrangement is gone, and link buttons within 9% of a node are hidden so they no longer sit on top of a node label.
- Dragged node positions are stored under `tether.network.positions.v2` per local device, saved on drag end and on unmount, and restored when returning to the network page. The continuous force animation was removed so a dropped node stays where it was placed.
- Dragging a node no longer switches the current device; only a click without movement selects the device and opens its details.
- More than 12 devices default to compact dots until zoomed in.
- Real run: the three-device graph formed a triangle with no line through the centre label; LAPTOP-01 was dragged from `20.2%,32.8%` to `35.1%,72.3%`, the page was switched to files and back, and the node remained at `35.11%,72.32%`. The test position was cleared afterwards.

Gates: mjs 230/230, cjs 6/6, client pytest 147 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41434714235` succeeded; published at 2026-11-02T11:15:30Z (app 1,778,877 B, plugin 1,358,071 B, node 84,818 B; signed manifest verified). Hub mirror refreshed to **0.2.64**. LAPTOP-01 Node+APP **14.6 s**; DESKTOP app/node/plugin **0.2.64**; LAPTOP app/node **0.2.64** with the plugin update job dispatched.

## v0.2.63

Login exit, a visual login panel and the default server:

- The DSH plugin's login screen now has an explicit exit: a `×` and a “返回 DSH” action call `ctx.layout.selectPanel(null)`, so a user who does not want to sign in can return to DSH instead of being trapped in the Tether panel. The login root uses absolute positioning so it does not cover the DSH sidebar.
- The login card is now two columns: a dark brand visual with a device-network diagram and the form on the right; the visual is hidden on narrow screens.
- The server-address input is gone. Login uses the stored/default server, falling back to `https://8-220-198-26.sslip.io`; the connection status view still shows the address. Separate “server connection / self-built device network” choices can be added later.
- Real run: the APP login was rendered with the two-column visual and no server field; the token was restored afterwards. The plugin exit is covered by the generated bundle contract (`host.exitPanel` / `exitPanel`).

Gates: mjs 229/229, cjs 6/6, client pytest 147 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41430469293` succeeded; published at 2026-11-02T10:43:24Z (app 1,779,253 B, plugin 1,358,293 B, node 84,818 B; signed manifest verified). Hub mirror refreshed to **0.2.63**. LAPTOP-01 Node+APP **15.1 s**; DESKTOP app/node/plugin **0.2.63**; LAPTOP app/node **0.2.63** with the plugin update job dispatched.

## v0.2.62

Settings updates, windowless launch and DSH lifecycle:

- Settings has a new **更新** section. The local row follows the entry product (APP+Node or plugin+Node); other rows are limited to devices with an explicit edge to the current device. Each row shows current/latest versions and a blue circular download button when an update exists; disconnecting an edge removes that device immediately, reconnecting brings it back. The top-right update button is unchanged.
- The APP no longer opens a console window: long-running Controller/Node processes use `pythonw.exe`, the `.cmd` launcher re-enters hidden through the VBS, bootstrap PowerShell is hidden, and the update helper relaunches the APP with `windowsHide: true`.
- The local DSH is detected (registry/asar/process), shown with its version in Settings, and can be started or installed from the surface overlay and the device section. Starting strips Tether's `DSH_HOME` so the real desktop profile is used; installing reads DeepSeek's official HTTPS nightly feed and verifies SHA-512 before `/S`.
- The surface embeds the real DSH web UI, so DSH plugins render as they are; the app does not reimplement DSH pages.
- Hub fix: the update job sends `plugin restart`, but the Hub action allowlist rejected it. Production now accepts `restart` for the plugin only (120 s), commit `638b3ce8`.
- Incident: force-stopping DSH triggered its own “Web authentication failed” recovery loop. The profile and desktop caches were backed up, and the official **same-version** rc.3 installer was used to repair DSH; sessions were preserved and the Tether plugin was reinstalled.

Gates: mjs 228/228, cjs 6/6, client pytest 147 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41424379550` succeeded; published at 2026-11-02T09:58:35Z (app 1,777,012 B, plugin 1,357,270 B, node 84,818 B; signed manifest verified). Hub mirror refreshed to **0.2.62**. LAPTOP-01 Node+APP **30.8 s**; DESKTOP source APP restarted with the local plugin on 0.2.62. Both devices report app/node **0.2.62**; LAPTOP plugin files are **0.2.62** with a DSH runtime reload still pending (the restart action now reaches the device but exceeded the 90 s verification window).

## v0.2.61

Instant permissions audit view:

- The 文件权限 drawer now paints from a per-device cache as soon as it opens, then refreshes policy and audit in parallel in the background. Previously every open awaited policy and then audit, two sequential device round trips.
- Switching devices prefetches both resources; concurrent requests for the same device share one in-flight promise. A cold open without a cached snapshot shows “正在读取审计…” inside the list instead of a false “暂无审计”.
- Saving a policy and loading more audit rows update the same cache, and the caches are cleared when the session resets.
- Real run: opening the drawer took **3 ms** to show 68 audit rows on DESKTOP and **3 ms** for 103 rows after switching to LAPTOP; the freshly restarted 0.2.61 app showed 68 rows in **19 ms**. Before the change the two serial requests measured 638 ms + 677 ms on DESKTOP and 1,114 ms + 715 ms on LAPTOP.

Gates: mjs 226/226, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41407506570` succeeded; published at 2026-11-02T07:40:28Z (app 1,765,320 B, plugin 1,353,822 B, node 79,668 B; signed manifest verified). Hub mirror refreshed to **0.2.61**. LAPTOP-01 Node+APP **19.7 s**, plugin **27.1 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. Both devices report app/node/plugin **0.2.61** and are online.

## v0.2.60

Mature account settings, built after checking mainstream products:

- Avatar upload now opens a circular 240 px crop stage instead of cutting the raw image. Drag to reposition, zoom 1–3×, reset, then save a 256×256 JPEG; remove, cancel and save are separate actions, and images are limited to 8 MB.
- Display name is edited inline with save/cancel and Enter/Escape, with errors next to the row.
- Password change has current/new/confirm fields with show/hide toggles, inline rules (10-character minimum, must differ from the current password, both entries must match), `autocomplete` hints, a Caps Lock warning and inline errors. An invalid submit shows the rules without sending a request.
- Real run on DESKTOP: an off-centre 480×320 test image opened the crop stage at `matrix(0.75,0,0,0.75,-60,0)`, dragged to `x=0`, zoomed to 1.35 and saved a 7,385 B data URL that updated the activity-bar avatar; the original avatar (9,281 B) was restored afterwards. A test display name persisted and was cleared. Invalid password submits showed the inline errors without changing the real password; the crop dialog was cancelled with data unchanged.

Gates: mjs 225/225, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41403421431` succeeded; published at 2026-11-02T07:03:27Z (app 1,764,049 B, plugin 1,353,182 B, node 79,667 B; signed manifest verified). Hub mirror refreshed to **0.2.60**. LAPTOP-01 Node+APP **27.4 s**, plugin **25.2 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. Both devices report app/node/plugin **0.2.60** and are online.

## v0.2.59

Editable device topology and a clearer activity selection:

- The Hub now stores explicit undirected device edges (`edges`, `edge_seeds`) and exposes `GET/POST /api/edges`, `/api/edges/batch`, `DELETE /api/edges/{from}/{to}`; `/api/state` includes them. A one-time star is seeded from `TETHER_DEVICE` for each owner, and new devices join the same root without recreating user-removed edges.
- The network canvas draws only explicit edges (solid when both online, dashed otherwise, none when absent). Each edge midpoint has a link control to disconnect; the top-right “连接” enters a two-click connect mode.
- Clicking a canvas node (or a left device card) opens a detail drawer listing every other device with a connection switch. The header “连接管理” opens a searchable table for creating and removing connections, suitable for many nodes.
- The selected activity-bar item now has a blue 16% background and blue icon instead of a faint gray block.
- Real run: canvas disconnect/reconnect, detail switches, and manager create/remove all hit the production Hub; the original two edges were restored. Production Hub deploy commit `e66920b6`, DB backup `edges-20261102T060941Z`, rollback point `d783681`, 90 s restart.

Gates: mjs 225/225, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41400940630` succeeded; published at 2026-11-02T06:39:21Z (app 1,757,366 B, plugin 1,349,837 B, node 79,669 B; signed manifest verified). Hub mirror refreshed to **0.2.59**. LAPTOP-01 Node+APP **16.0 s**, plugin **26.3 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. Both devices report app/node/plugin **0.2.59**; LAPTOP briefly reconnected after the restart. Real run: LAPTOP network page showed 2 explicit edges and the blue selected activity item; canvas/detail/manager toggles hit the production Hub and the original edges were restored.

## v0.2.58

Transfer pane root labels and stale-root reset:

- Both transfer panes already loaded `/workspaces` and `/drives` per device; the repeated `default-workspace` / `Tether 工作目录` names made the two trees look shared. Each pane now labels its groups `工作区 · <device>` and `此电脑 · <device>`.
- Switching a pane's device clears the previous roots and entries before loading, so a slow or failed request cannot leave the other device's workspaces visible.
- Real check: left `工作区 · DESKTOP-LOCAL` with `C:\Users\Administrator...` / `demo`; right `工作区 · LAPTOP-01` with `C:\Users\14675...` / `audit`.

Gates: mjs 224/224, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41396125195` succeeded; published at 2026-11-02T05:51:48Z (app 1,749,053 B, plugin 1,345,886 B, node 79,668 B; signed manifest verified). Hub mirror refreshed to **0.2.58**. LAPTOP-01 Node+APP **20.1 s**, plugin **28.9 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. Both devices report app/node/plugin **0.2.58**. Transfer page verified: left `工作区 · DESKTOP-LOCAL` with `C:\Users\Administrator...` / `demo`, right `工作区 · LAPTOP-01` with `C:\Users\14675...` / `audit`; disks C–G vs C–D.

## v0.2.57

Picker tree sync, folder upload and local-drop save+upload:

- The picker tree row and its chevron are one button: clicking a folder toggles expansion and navigates the right pane; navigating from the right pane reveals and expands the same path in the tree. Real run: `C:` expanded on both sides; opening `Users` from the right moved the breadcrumb to `C: › Users` and expanded the tree to `Users`.
- A folder can be attached with the new “确定” footer action. `readFolder` recursively reads the target folder (200 files / 100 MiB / 10 MiB per file, skips `.tether-trash`) and passes files with `webkitRelativePath` to the DSH composer. Real run: a temporary folder with two text files produced two attachment chips.
- Workspace and drive roots are verified to come from the same target device; group labels now include the device name (`工作区 · LAPTOP-01`, `此电脑 · LAPTOP-01`).
- Local files dropped on the composer are uploaded immediately through the DSH attachment API and saved in the background to `D:\TetherDrop` (fallback `D:\TetherWorkspaces\TetherDrop`, never C:). Real run: `drop-test-2.txt` appeared as a 14 B attachment, the toast reported `D:\TetherDrop\drop-test-2.txt`, and the bytes on disk matched.
- The Node device-fs surface now exposes `write_chunk` so the save path works through the Hub surface gateway; Python coverage writes and reads back the dropped bytes.

Gates: mjs 224/224, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41394307331` succeeded; published at 2026-11-02T05:33:33Z (app 1,748,841 B, plugin 1,345,779 B, node 79,668 B; signed manifest verified). Hub mirror refreshed to **0.2.57**. LAPTOP-01 Node+APP **19.5 s**, plugin **19.5 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. Both devices report app/node/plugin **0.2.57**. Real runs: DESKTOP tree `C:`/`Users` stayed in sync; a temporary folder uploaded `a.txt`/`b.txt` as two attachments; `drop-test-2.txt` was uploaded and saved to `D:\TetherDrop` with matching bytes. LAPTOP's picker showed `工作区 · LAPTOP-01` / `此电脑 · LAPTOP-01`, and a dropped `laptop-drop-test.txt` was uploaded and saved to its own `D:\TetherDrop`; the remote file and attachment were removed after the check.

## v0.2.56

Self-contained picker loading overlay:

- 0.2.55 replaced the picker's status strip with the explorer's `tether-dir-loading` class, but the embedded DSH page does not load the shared UI's global CSS. The element fell back to `position:static` at 20 px and the spinner landed at the lower-left. The overlay now carries inline `position:absolute; inset:0; z-index:4` and a self-contained SVG `animateTransform` spinner, so it works in the WebUI, transfer page and DSH surface alike.
- Real DSH picker: overlay 639×429, absolute, centered; no 22 px status bar, no explanatory footer, old list retained while loading.
- Includes all 0.2.55 surface, picker and settings changes below.

Gates: mjs 222/222, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41386893828` succeeded; published at 2026-11-02T04:12:39Z (app 1,746,202 B, plugin 1,343,349 B, node 79,648 B; signed manifest verified). Hub mirror refreshed to **0.2.56**. LAPTOP-01 Node+APP **19.5 s**, plugin **16.5 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. Final DESKTOP surface document 736,068 B and hidden LAPTOP surface 720,118 B remained intact through repeated device switches; the network page stayed 1416×829; the real DSH picker rendered a 639×429 absolute overlay with no status strip. A LAPTOP Node restart cleared the stale plugin version report; both machines now report app/node/plugin **0.2.56**.

## v0.2.55

Surface switch regression, in-place loading and settings rebuild:

- Fixed returning-device white screens: `SurfaceDeck` now keeps a stable mount order and only toggles `visibility/z-index`; React no longer moves iframes in the DOM, so the expired ticket is never used for a reload. Non-chat views are covered by an absolutely positioned deck; preloaded frames keep a real 1416×829 viewport while hidden. Three DESKTOP↔LAPTOP round trips retained 720,118 / 736,068-byte documents and switched in 256 ms.
- Removed the picker's fixed 22 px status bar, old error strip and explanatory footer. `TargetFileExplorer` now uses the explorer's absolute `tether-dir-loading` overlay, keeps the previous list visible, and reports errors as a retryable/dismissible floating notice.
- Rebuilt settings as five sections (account / connection / workspace / device / about) with an `extraSections` extension point and no explanatory sentences. Avatars can be chosen from a local image, cropped to 128×128 JPEG, persisted in `tether.accountAvatar` and shown in the activity bar. Duplicate refresh/update/permissions/switch-account actions were removed.
- Kept the Hub surface path for the Electron host after diagnosing that the local-loopback surface loses the local proxy session for cross-port plugin calls.

Gates: mjs 222/222, cjs 6/6, client pytest 142 passed / 1 skipped, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41344909191` succeeded; published at 2026-11-01T20:07:25Z (app 1,745,709 B, plugin 1,343,083 B, node 79,648 B; signed manifest verified). Hub mirror refreshed to **0.2.55**. LAPTOP-01 Node+APP **22.4 s**, plugin **22.2 s**; DESKTOP source APP restarted and the local DSH plugin reinstalled. 0.2.56 supersedes the picker overlay in this release.

## v0.2.54

Explorer parity, shared file cache and resident surfaces:

- Transfer page: create folder/file, rename, delete to `.tether-trash`, overwrite/keep-both conflict dialog, pointer drag with drop highlight, context menu and `Ctrl+A/C/X/V`. Real desktop run created a folder, dragged a 20 B file to LAPTOP, chose “保留两者”, produced `tether-picker-check (2).txt` at 100% and cleaned both temp items.
- Composer picker: title “资源管理器”, device name only (no “目标电脑 ·”), fixed 20/18/22 px header/status rows so loading cannot shift the list; native composer plus is the only entry (extra text button and duplicate command removed).
- One `file-cache.js` (20 s TTL, 240 dirs, in-flight dedupe, explicit invalidation) now serves the explorer, composer picker and both transfer panes.
- Connection pill reads `/api/state`; a successful poll keeps it green for 8 s without opening a panel. Settings shows “已连接 · 168 ms”.
- `SurfaceDeck` keeps the active + two most recent device workspaces mounted; returning switches measured 9–29 ms (already-loaded LAPTOP `readyState=complete` in 38 ms). A cold first load still takes 8–14 s for the 4.2 MB + 1.9 MB plugin bundles. A settings checkbox can disable retention.
- Bottom account bar removed: shield/gear/avatar only; gear opens connection settings, avatar opens account (display name, password, logout).

Gates: client pytest 142 passed / 1 skipped, mjs 222/222 (excluding the stale isolated Electron QA harness), cjs 6/6, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41338266729` succeeded and released at 2026-11-01T18:49:50Z (app 1,741,992 B, plugin 1,341,462 B, node 79,648 B, signed manifest verified). Hub mirror refreshed to **0.2.54** (`distribution_state: latest`). Both machines were updated to **0.2.54** (LAPTOP via Hub Node+APP then plugin jobs; DESKTOP source APP restarted and local DSH plugin reinstalled). Final `/api/state`: both devices report app/node/plugin 0.2.54; DESKTOP and LAPTOP surfaces return 200 in 309 ms / 157 ms.

## v0.2.53

Background surface warmup:

- After startup the APP opens a hidden frame for each other online DSH surface and keeps it for 45 s, so the cold 4.2 MB plugin bundle finishes outside the user's switch. Switching to LAPTOP reached the composer in **5.5 s**; five alternating switches measured **12.8 / 6.4 / 4.8 / 6.7 s** (the remaining run was a no-op on the same device), all within the 15 s WAN target.
- The cold load itself is still about 45 s and happens in the background; a direct Tailscale asset path remains an optional future optimization.
- Includes 0.2.52 (shared transfer page, picker tree, activity bar/account footer, surface timeout/cache fixes).
- APP, plugin, and node are 0.2.53.

Gates: client pytest 142 passed / 1 skipped, server pytest 150 passed, mjs 221/221, cjs 6/6, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41330546926` succeeded; published at 2026-11-01T17:18:02Z (app 1,733,027 B, plugin 1,337,207 B, node 79,648 B); the Hub mirror was refreshed to **0.2.53**. LAPTOP-01 Node+APP **19.7 s**, plugin **16.6 s** (`restart_required` cleared); both machines report node/app/plugin **0.2.53**, both surfaces **200** (DESKTOP 1.55 s, LAPTOP 1.24 s).

## v0.2.52

Shared explorer, picker tree and surface stability:

- The file transfer page is rebuilt on `TargetFileExplorer`: two compact explorer panes, one computer per side, the same node cannot be picked on both sides, no “source/target” wording, an icon-only swap, drag across panes, `Ctrl+A/C/X/V` and a context menu (copy, cut, paste here, refresh). A real 20 B copy from LAPTOP-01 to DESKTOP completed through both the clipboard and drag paths.
- The target-file picker expands folders in place; the DSH native plus file action now opens the target picker instead of the local dialog. Root rows no longer repeat full paths and the toolbar uses icons.
- The activity bar restores the permission/audit shield, moves settings to a gear in the explorer footer, and shows the signed-in account there.
- Cold DSH surfaces no longer die on the first 4.2 MB plugin bundle. The surface mux read timeout is 300 s, asset caches are shared per device, nodes prewarm on registration, node asset GETs use 180 s, and the UI document watchdog is 90 s. Warm node switches measured **8.4 s**; a cold LAPTOP switch loads in 45–50 s instead of failing at 60 s. Reaching ≤15 s cold still needs a direct Tailscale surface or a smaller bundle.
- APP, plugin, and node are 0.2.52.

Gates: client pytest 142 passed / 1 skipped, server pytest 150 passed, mjs 220/220, cjs 6/6, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. CI run `41325957168` succeeded; the signed manifest was published at 2026-11-01T16:54:56Z (app 1,731,946 B, plugin 1,336,677 B, node 79,648 B); the Hub mirror was refreshed to **0.2.52**. LAPTOP-01 Node+APP updated in **27.1 s**; the desktop source APP and DSH profile plugin are 0.2.52. LAPTOP plugin update is pending a free moment for its DSH restart. Both public surfaces returned 200 (desktop 1.16 s).

## v0.2.51

Native workspace state fixes:

- The “加载较慢” banner now clears as soon as the DSH frame reports loaded. It used to stay pinned after a fast load, so a working workspace looked stuck behind a permanent loading hint; it is now shown only while the frame is actually loading.
- The APP reads `/app-context` from its own origin instead of the cross-origin Hub, removing the blocked request and CORS console noise that repeated every four seconds.
- Includes 0.2.50 (descriptor-gated plugin reload) and 0.2.49/0.2.48/0.2.47.
- APP, plugin, and node are 0.2.51.

Gates: client pytest 141 passed / 1 skipped, server pytest 150 passed, mjs 218/218, cjs 6/6, `build.mjs --check`, `build-web.mjs --check`, `validate_versions()`. Real Electron: the embedded DSH page rendered with its composer and no slow banner; iframe timing TTFB 443 ms, load 1.06 s.

CI run `41296203842` succeeded; the signed manifest was verified (app 1,720,676 B, plugin 1,332,698 B, node 79,561 B) and published at 2026-11-01T10:13:22Z; the Hub mirror was refreshed to **0.2.51**. LAPTOP-01 node+APP **~18 s** and plugin **41.5 s** (including the DSH restart, `restart_required` cleared); both public surfaces bootstrap **200** (DESKTOP 1.31 s, LAPTOP 1.10 s). During the LAPTOP plugin update the node reconnected every ~20 s for a few minutes and the job failed twice with `device_offline`; after it settled, the retry converged. The reconnect cause is still under investigation.

## v0.2.50

Plugin runtime reload guard:

- A plugin update no longer reports done from a live process scan alone. `restart_required` clears only when the DSH surface descriptor publishes a new host pid; a scanned `dsh-desktop-host` pid is used only to schedule the restart. The local 0.2.44→0.2.49 update exposed the old behavior: the job was done while `native-surface.json` still pointed at a dead port and the public surface returned 502.
- Includes 0.2.49 (settings actions, session expiry) and 0.2.48 (login server field, account role).
- APP, plugin, and node are 0.2.50.

Gates: pytest 138 passed / 4 skipped, mjs 216/216, cjs 6/6, `build.mjs --check`, `validate_versions()`. CI run `41281139696` succeeded; the signed manifest was verified (app 1,720,428 B, plugin 1,332,625 B, node 79,560 B) and published at 2026-11-01T06:33:39Z; the Hub mirror was refreshed to **0.2.50**. LAPTOP-01 Node+APP **22.6 s**, plugin **19.2 s** with `restart_required` cleared and health 0.2.50. Local plugin 0.2.49→0.2.50 correctly failed with `restart_timeout` while the descriptor was stale (no false done); after a fresh descriptor, `/update/retry` converged in **4.6 s** and both public surfaces returned 200.

Clean-clone check: a fresh clone of tag `v0.2.50` builds publishable archives and both APP and plugin archives contain the descriptor-gated updater. Local app zip 1,728,036 B vs CI 1,720,428 B (the committed web bundle vs the CI rebuild); plugin 1,332,628 B vs 1,332,625 B.

## v0.2.49

Settings and session follow-ups:

- Settings now has a working “检查更新” action and “切换账号 / 服务器” in the connection section; logging out or switching clears the stored session and returns to the full-screen login page.
- An expired or rejected session (HTTP 401) now clears the token and returns to the login page instead of leaving the workbench in an error state.
- Includes 0.2.48 (login server field, account role) and 0.2.47 (login/connection/settings split, transfer redesign, hidden scrollbars, workspace reload hint).
- APP, plugin, and node are 0.2.49.

Gates: pytest 138 passed / 4 skipped, mjs 216/216, cjs 6/6, `build.mjs --check`, `validate_versions()`. CI run `41280353424` succeeded; the signed manifest was verified (app 1,720,412 B, plugin 1,332,610 B, node 79,544 B) and published at 2026-11-01T06:22:11Z; the Hub mirror was refreshed to **0.2.49**. LAPTOP-01 Node+APP **17.8 s**, plugin **14.6 s** with `restart_required` cleared and health 0.2.49; both public surfaces returned 200.

## v0.2.48

Login follow-ups:

- The login page keeps an editable server address, so a fresh device can sign in to a different Hub without hand-editing local storage.
- The account role returned by login is persisted with the session and shown in Settings as 所有者/成员/管理员; the login → main UI → settings → logout lifecycle was verified with a temporary local Hub.
- Includes 0.2.47 (full-screen login, status-only connection panel, settings page, transfer redesign, hidden scrollbars, workspace slow-load reload hint).
- APP, plugin, and node are 0.2.48.

Gates: pytest 138 passed / 4 skipped, mjs 216/216, cjs 6/6, `build.mjs --check`, `validate_versions()`. CI run `41278461096` succeeded; the signed manifest was verified (app 1,720,014 B, plugin 1,332,412 B, node 79,543 B) and published at 2026-11-01T05:54:11Z; the Hub mirror was refreshed to **0.2.48**. LAPTOP-01 Node+APP **17.1 s**, plugin **14.4 s** with `restart_required` cleared and health 0.2.48; both public surfaces returned 200. The LAPTOP APP now shows the account login page, to be signed in by its owner.

## v0.2.47

Login, connection and settings split:

- First run renders a full-screen account login page (email/password/TOTP, invite registration as a secondary action). The workbench is not rendered until a session token exists; login saves the session, enrolls the device, and reloads. The top-bar connection pill is status-only again: address, light, last check, latency and refresh.
- New settings page from the activity bar: account (email, password change, logout), connection, local device (name/id/platform/versions, restart Node), updates, file permissions, about. Device pairing, device tokens and the permission drawer's manual Hub config are removed.
- File transfer page: source/target cards with blue/green top borders and badges, device pickers, compact path bar, swap button and a selected-file footer; the transfer activity icon no longer matches the explorer.
- Workspace reload control is always available after load, and a “loading slowly” hint appears after 15 s. Global scrollbars are 6 px, transparent until hover.

Gates: pytest 138 passed / 4 skipped, mjs 216/216, cjs 6/6, `build.mjs --check`, `validate_versions()`. Real Electron checks: login page renders, a bad credential shows `invalid credentials`, connection panel shows the green light and refresh, settings shows all six sections, and the redesigned transfer page was captured. CI run `41277668555` succeeded; the signed manifest was verified (app 1,719,833 B, plugin 1,332,323 B, node 79,543 B) and published at 2026-11-01T05:41:25Z. The Hub mirror was force-refreshed to **0.2.47** at 05:45Z. Installed acceptance is pending a logged-in account; devices were not auto-updated.

## v0.2.46

Manifest single-flight hotfix:

- Concurrent forced update checks shared one manifest `Future`, and every caller completed it. The second completion raised `InvalidStateError: FINISHED` (158 occurrences in the local Node log, latest 01:50). Only the leader now completes and clears the flight; other callers fetch and cache independently, and followers receive an `UpdateError` rather than a raw exception.
- Regression test starts two forced checks and finishes them out of order.
- APP, plugin, and node are 0.2.46.

Gates: pytest 138 passed / 4 skipped, mjs 216/216, cjs 6/6, `build.mjs --check`, `validate_versions()`. CI run `41230580812` success; the signed manifest was verified (app 1,717,917 B, plugin 1,330,930 B, node 79,543 B) and published at 2026-10-31T18:44:27Z; the Hub mirror served 0.2.46 before 18:45Z.

Installed acceptance: LAPTOP-01 Node+APP **17.6 s**. A concurrent A/B on the Hub: 24 simultaneous forced checks on the old 0.2.45 DESKTOP-LOCAL produced **18 failures** (`HTTPError` from the double-completed flight); after LAPTOP-01 moved to 0.2.46 and DESKTOP-LOCAL restarted onto 0.2.46, both returned **24/24 ok** with `latest_version` 0.2.46 and no `update_failed`. This removes the observed `InvalidStateError: FINISHED` source from the Node log.

## v0.2.45

Plugin runtime reload verification:

- A stale `native-surface.json` pid no longer hides a live DSH host: the updater checks the descriptor pid and falls back to scanning for the `dsh-desktop-host` process before scheduling the restart helper.
- The Hub job no longer reports `done` from the installed profile alone. It waits until the plugin status clears `restart_required` (the DSH host pid changed after the restart); a host that never reloads fails the job with `restart_timeout` instead of a false success.
- Retrying after `restart_timeout` re-runs the restart helper even when the plugin files are already at the target version.
- APP, plugin, and node are 0.2.45.

Gates: pytest 137 passed / 4 skipped, mjs 216/216, cjs 6/6, `build.mjs --check`, `validate_versions()`. CI run `41228715930` success; the signed manifest was verified (app 1,717,888 B, plugin 1,330,898 B, node 79,514 B) and published at 2026-10-31T18:21:15Z; the Hub mirror served 0.2.45 by 18:22Z.

Installed acceptance on LAPTOP-01 through the Hub: Node+APP **16.0 s** (plugin stayed 0.2.44), then the plugin job took **19.0 s** and stayed in `restarting` for an 11.4 s DSH restart window before `restart_required` cleared and the job reported done. Real plugin status/health is 0.2.45 in profile, source and runtime packages. Production Hub deployed at `f6062fd` (backup `/opt/tether/backups/runtime-reload-20261031T182301Z`, previous commit `e3c8718`); both devices' public surface smoke returned 200. This verifies the reload is detected, but it is still a full DSH restart: the 5 s hot-reload target remains open.

## v0.2.44

Event-driven UI refresh:

- The shared UI subscribes to the Hub's `/api/events` SSE stream. Device and session events force a state refresh even when the window is hidden; the ordinary 2.5 s poll remains as a fallback and still pauses in hidden windows.
- Verified in Chromium by suspending the local Node: the device card went offline at 4.47 s and the online count changed 2→1; after resume it returned online at 3.94 s with 1→2.
- APP, plugin, and node are 0.2.44.

Gates: mjs 216/216, cjs 6/6, pytest 135 passed / 4 skipped, `validate_versions()`. CI run `41227434088` success; signed manifest verified, published at 2026-10-31T18:05:25Z and served by the Hub. LAPTOP-01 Node+APP **16.5 s**, plugin job **15.2 s** with real status/health 0.2.44. The DESKTOP-LOCAL dev bench was restarted to 0.2.44 and its plugin moved 0.2.43→0.2.44 in **13.7 s**; both machines now run 0.2.44 for all three components. The local DSH host did **not** restart with the plugin apply (the job marked done from the installed profile), leaving the local public surface at 502; running `tether.node.dsh_restart` restarted the host to pid 33416 and both machines' surface smoke returned 200. Plugin `done` is therefore profile installation, not a verified runtime reload; the 5 s hot-reload target remains open.

## v0.2.43

New-device account enrollment:

- A Node with no device token can register with the logged-in account's personal token. The Hub validates the token, binds an unowned device (or the same owner's device) to the account, and returns a one-time device token; the Node persists it with owner-only permissions and uses it on later connections.
- The APP login path first tries the existing-device enrollment endpoint; on `device_not_found`/`device_offline` it switches the local Node to account registration, `device_owned` is refused. The supervisor can start the Node with a user token instead of a pre-shared node token.
- APP, plugin, and node are 0.2.43.

Gates: mjs 212/212, cjs 6/6, pytest 135 passed / 4 skipped, `validate_versions()`. CI run `41225813966` success; signed manifest verified, published at 2026-10-31T17:45:20Z and served by the Hub. LAPTOP-01 Node+APP **18.8 s**, plugin job **17.4 s**, real plugin status/health 0.2.43.

A live temp Hub/Node test passed: account-token registration came online under the right owner, the device token was persisted (97 B), and a restart without the user token stayed online as the same owner. The DESKTOP-LOCAL dev bench was also aligned to 0.2.43: Node/APP 0.2.43 from source, DSH plugin 0.2.33→0.2.43 in **10.1 s**, plugin health 0.2.43. A live APP login→enroll with a real account remains open because no test account credentials are available.

## v0.2.42

Shared target file explorer:

- A hook-free `TargetFileExplorer` now provides the root groups, breadcrumb, up/refresh, directory search, sortable columns, selection and loading/error/empty states for both the DSH attachment picker and the file-transfer page.
- Sorting and search state stay with the caller so the same tree is usable in the plugin, the APP and the unit harness. The full Explorer keeps its richer context menu, drag and hover interactions instead of being replaced.
- Includes the 0.2.41 login enrollment foundation. APP, plugin, and node are 0.2.42.

Gates: mjs 212/212, cjs 6/6, pytest 135 passed / 4 skipped, `validate_versions()`. CI run `41224711170` success; signed manifest verified, published at 2026-10-31T17:31:36Z, and served by the Hub immediately after. LAPTOP-01 Node+APP **20.0 s**; the plugin job finished in **16.1 s** and its real status/health is 0.2.42.

Real Chromium acceptance after the release: the transfer page showed the shared workspace/drive groups, breadcrumb, directory search and sortable columns; a real-input 1,040-byte transfer to LAPTOP-01 produced a matching SHA-256 and a target audit row `transfer/ok`. Test files were removed.

## v0.2.41

Login device enrollment foundation:

- After a successful account login the APP calls a trusted IPC; the main process asks the Hub to enroll the local device, rotates the device token with a 10-minute grace for the old token, writes the new token into `hub.json` (timestamped backup), and restarts the Node.
- The Hub endpoint is session-authenticated, tenant-scoped, refuses offline devices, and audits the enrollment. Existing node-token authentication is unchanged.
- The local 18892 Hub proxy now keeps an explicit user Authorization header instead of overwriting it with the owner token, so a logged-in member session is not silently elevated.
- APP, plugin, and node are 0.2.41.

Gates: mjs 212/212, cjs 6/6, pytest 135 passed / 4 skipped, `validate_versions()`. CI run `41223584060` success; signed manifest verified, published at 2026-10-31T17:17:56Z, Hub served 0.2.41 at 17:20:28Z. LAPTOP-01 Node+APP **16.3 s**, plugin job **15.8 s** with its real status/health at 0.2.41.

The minimal update UI was visually verified in Chromium with intercepted update responses: the blue ↓ button showed `更新到 0.2.42`, and clicking it produced the white translucent overlay (`rgba(255,255,255,0.72)`, `blur(18px)`) with `正在更新 Tether / 下载 APP / 42%`. A live login→enroll acceptance with a dedicated test account remains open because the production owner credentials are not available in the environment; the server endpoint and token rotation are covered by `tests/test_device_enroll.py`.

## v0.2.40

Transfer throughput experiment:

- Node reads and transfer chunks are now 1 MiB (was 256 KiB), reducing round trips while staying below the 48 MiB control-socket limit.
- APP, plugin, and node are 0.2.40.

Gates: mjs 211/211, cjs 6/6, pytest 135 passed / 4 skipped, `validate_versions()`. CI run `41221950421` success; signed manifest verified, published at 2026-10-31T16:58:00Z, Hub served 0.2.40 at 17:02:51Z.

Installed acceptance on LAPTOP-01: Node+APP **20.7 s**, plugin **14.1 s**. A 2,000,000-byte transfer in two 1 MiB chunks took **34.4 s** with a matching SHA-256; a 10,000,000-byte transfer produced a 10,000,000-byte target (the harness timed out before printing its hash). Effective end-to-end throughput is roughly **60–70 KB/s** over the public Hub relay, so a 1 GB transfer would take hours: the 1 GB acceptance target is **not met on the current WSS relay**. This is the planned overlay decision gate; benchmark Headscale+tsnet / NetBird / Nebula against the same harness before deciding.

## v0.2.39

Node restart control:

- The device context menu on the 互联 page can request a Node restart. The Hub endpoint is tenant-scoped, audited, refuses offline devices, and the Node refuses the request while a Tether task is active.
- A managed Node exits with code 75 and is restarted by the APP supervisor; a standalone Node re-executes itself. The control socket reconnects through the presence watchdog.
- Includes all 0.2.38 transfer fixes. APP, plugin, and node are 0.2.39.

Gates: mjs 211/211, cjs 6/6, pytest 135 passed / 4 skipped, `validate_versions()`. CI run `41221456056` success; signed manifest verified; release published at 2026-10-31T16:51:25Z and served by the Hub at 16:52:30Z.

Installed acceptance on LAPTOP-01: Node+APP 0.2.39 in **16.2 s**, plugin in **16.7 s**. A restart request through the Hub took the Node offline in **0.80 s** and back online in **2.99 s**, still reporting 0.2.39.

## v0.2.38

File-transfer correctness hotfix:

- The transfer page now maps the engine's `transferId` to the node's `transfer_id` for status/write/cancel, so a real transfer no longer fails with `transfer_id must be 8-32 lowercase hex characters`.
- The directory browser no longer lets a late roots response overwrite a path the user just entered.
- Includes the 0.2.37 chunked node writes and file transfer page. APP, plugin, and node are 0.2.38.

Gates: mjs 211/211, cjs 6/6, pytest 135 passed / 4 skipped (0.2.37 gate), `validate_versions()`. CI run `41220473162` success; the signed manifest was verified, the release was published at 2026-10-31T16:39:50Z, and the Hub served 0.2.38 at 16:40:23Z.

Installed acceptance on LAPTOP-01: Node+APP 0.2.36→0.2.38 in **16.1 s**; the plugin job finished in 17.6 s and its real status/health reported 0.2.38 (the Hub capabilities snapshot still said 0.2.37 until the next registration). A direct API transfer of a 600,000-byte file used 3 chunks in **8.5 s**; the target SHA-256 matched, a resumed transfer continued from offset 262144 with a matching hash, and writing over an existing file without overwrite returned `exists`. The transfer page was also exercised in Chromium with real input events: progress 0→44%→87%→100%, the 600,000-byte target matched the source SHA-256, and the target audit recorded `transfer` with `bytes=600000, result=ok`; the test files were removed.

## v0.2.37

Resumable file transfer release:

- The node filesystem service accepts binary chunks (`write_chunk`) with a transfer id, offset and total size, writes to a `.tether-part.<id>` file, fsyncs, and atomically replaces the destination only on the final chunk. `transfer_status` reports the partial offset and `transfer_cancel` removes it.
- New “文件转移” page: two device/directory panes, source-file selection, overwrite policy, progress bar, cancel and retry. It reuses the 0.2.36 resumable transfer engine and reads/writes through the existing Hub file routes; every completed destination write is audited on the target node.
- APP, plugin, and node are 0.2.37.

Gates: pytest 135 passed / 4 skipped, mjs 211/211, cjs 6/6, `validate_versions()`. CI run pending. Installed acceptance is recorded after the LAPTOP-01 update.

## v0.2.36

Connection and picker release (includes all 0.2.35 security fixes):

- Node reconnects immediately after a dropped control socket (0.1 s first delay, 2 s failure cap, jitter) instead of the old 0.5–5 s ladder. The Hub presence watchdog marks a half-open device offline after 4.5 s and fails its pending RPCs.
- The DSH target-computer attachment picker gains clickable breadcrumbs, current-directory search, and name/date/size sorting, matching the resource manager's directory list more closely.
- APP, plugin, and node are 0.2.36.

Gates: pytest 133 passed / 4 skipped, mjs 205/205, cjs 6/6, `validate_versions()`. CI run `41217509435`. Installed acceptance is recorded after the LAPTOP-01 update.

## v0.2.35

Security and update-throughput release (includes the 0.2.33 bridge and 0.2.34 restart fixes):

- Electron only navigates the main window to the local UI origin; `window.open` never creates an Electron window and HTTP(S) links go to the system browser; surface iframes are sandboxed without top navigation; every `tether:*` IPC checks the main frame and local origin.
- The 18892 local proxy requires a per-process HttpOnly `SameSite=Strict` session cookie, enforces same-origin writes and an API path allowlist, resolves static files through `realpath`, and returns 400 for malformed URLs instead of crashing the main process.
- Restart helpers no longer pass `windowsHide` to Python 3.13 `Popen`; a helper that cannot be scheduled returns `restart_failed` instead of a false success.
- The Hub update job now downloads and verifies every component before applying anything, applies Node first, tolerates a Node restart deferred to the APP restart, and keeps finished jobs out of the device summary so the update overlay does not return on the next page load.
- APP, plugin, and node are 0.2.35.

Gates: pytest 133 passed / 4 skipped, mjs 204/204, cjs 6/6, `validate_versions()`, CI run `41213286072` success. The draft manifest signature was verified locally, then the release was published at 2026-10-31T15:10:19Z. Assets: app 1,690,717 B `50dc9acc71d8248ab585fb44c002adde15b4c6a6343ca55c2de46b29a3219e4c`, plugin 1,319,939 B `bf08879b24027543145fd74192af6c0c67a311bc4c79f87f940bd520ded323cb`, node 77,452 B `533bb5657de761a83ab7e4127173fb12e348f93123b07be0161da6ab2f3d6a1f`.

Accepted on LAPTOP-01 through the Hub job: Node+APP reached 0.2.35 (an initial deferred-restart deadlock was fixed in Hub `bc3df99`; the APP-only retry finished in **20.1 s**), plugin reached 0.2.35 (profile/source/health all 0.2.35) in **15.3 s**. The 15.3 s path still restarts DSH; the planned 5 s plugin hot-reload budget is **not met** and remains open. DESKTOP-LOCAL runs the 0.2.35 source bench (Node/APP report 0.2.35); no installed-package claim is made for it.

## v0.2.31

Silent one-click update release:

- One click now downloads every behind component (node, plugin, APP) before installing any of them, then restarts the APP once. The node is held for that single restart instead of restarting between plugin and APP.
- The update card shows `正在更新` with a determinate download/install progress bar; the extra “APP 已下载 / 重启并安装” and “立即生效” dialogs are gone from the one-click path.
- A second update surface attaches to the running install (`status: in_progress`) instead of failing with `update_busy`; a cross-process lock left by a dead process is taken over.
- Explicit updates on a dirty git checkout install packaged files only. User edits and unrelated files are preserved; background checks still report checkout state but never block the update button.
- Installed shortcuts and restart helpers launch the Electron executable directly with `windowsHide` and `CREATE_NO_WINDOW`; no `explorer.exe`, `.cmd`, or console window is used.
- APP, plugin, and node are all 0.2.31.

Gates: pytest 130 passed / 4 skipped (update suites 72 passed / 1 skipped), Node 204/204, `validate_versions()`. This note records the published packages only: no local or laptop installation was performed, and neither device is claimed to be running 0.2.31.

## v0.2.30

Target-computer file explorer release:

- Both Composer attachment entry points now open a target-computer file modal with 工作区 (workspaces) and 此电脑 (drives) roots, so files can be picked from the device being controlled.
- The node serves the modal through a same-origin `/tether-device-fs` API: drives, workspaces, directory listing, and a raw-byte read that returns base64 so non-UTF-8 files keep their exact bytes.
- APP, plugin, and node are all 0.2.30. A node-only or plugin-only update leaves the other component on the old attachment path.

This note records the published packages only. DESKTOP-LOCAL and LAPTOP-01 still report 0.2.29 until one-click update is run on each.

## v0.2.29 candidate (unpublished)

This candidate includes the scoped login authority fix, update/watchdog race fixes, and native Composer attachment routing. The DSH native Composer path was exercised on an isolated local Host with a QA Node: it selected a target workspace and transferred a 90-byte text file and a 4-byte binary file. The captured multipart response contained the expected bytes `00 ff 41 80`; no model request was sent.

Validation reported by the parent agent: Python 125 passed / 1 skipped, Hub/server 116 passed, Node 199 passed. A local isolated Host/Node acceptance passed; physical LAPTOP-01 is not installed or re-tested. Local unsigned archives were generated and inspected offline; all three ZIP sizes and SHA-256 values match the generated unsigned manifest, and archive contents exclude `.scratch`, `.dev-harness`, private server source, and QA fixtures:

| Component | Archive size | SHA-256 |
| --- | ---: | --- |
| APP | 1,679,519 B | `88c1eb977c0d87a31e39ac8f0b14ebdd0bdff913a4b9b3e2aab7d77e6c34bd53` |
| Plugin | 1,311,593 B | `cc8af66be94e3af76d9fb31696c2b0bfe7444a58d74d7f773fe737b7da1fbc1c` |
| Node | 73,559 B | `3bd105c9a37377a5e49b85917dd9cecdcb5923daeb5102bca7d434e6a7bd5ebc` |

The local `tether-update.json` is 1,458 B with SHA-256 `7360e03739d71f091536a733f7fc2d2bf4d07bb898852428825e4361e5c021d8`; it has no signature. This is a release candidate record only: no public release, signature, deployment, or tag is claimed. CI signing and physical LAPTOP-01 installation remain release gates.

## v0.2.28

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.28) · tag `v0.2.28` → `e6ce3c0` · workflow run `40918330411` · assets app 1,658,001 B / node 73,558 B / plugin 1,302,899 B / manifest 1,566 B. Published 2026-10-29T17:10:56Z.

Hotfix for a single release snapshot:

- `normalizeUpdateLatest` now takes the highest latest version across the whole refresh and applies it to every component, not a per-component maximum. A Node disk-cache record at 0.2.26 can no longer leave app/node cards at 0.2.26 while the plugin updater reports 0.2.27.
- Includes the 0.2.27 fixes: a local product update skips an already-current Node, a failed Node check no longer aborts the plugin, and device sequences skip components already at the normalized latest.

Gates: pytest 125 passed / 1 skipped, mjs 175/175, cjs 6/6, `build.mjs --check`, reproducible Web bundle, `validate_versions()`.

## v0.2.27

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.27) · tag `v0.2.27` → `6437901` · workflow run `40917015921` · assets app 1,658,045 B / node 73,558 B / plugin 1,302,922 B / manifest 1,566 B. Published 2026-10-29T17:02:57Z.

Hotfix for update consistency and the local plugin entry:

- Each update-center refresh commits one normalized latest snapshot after all checks; local and remote cards can no longer show `0.2.26`, `0.2.25` and `0.2.26` for the same release. `update_available` is recomputed from each card's current version against that snapshot.
- A local product update skips a Node that is already at the normalized latest and continues to the plugin; a failed Node check is reported as a partial failure but no longer aborts the plugin check/prepare/apply.
- Device one-click sequences skip components whose normalized record is already current, so a flaky check on one component does not delay or block the others.
- The plugin updater and DSH restart packaging from 0.2.26 remain in place.

Gates: pytest 125 passed / 1 skipped, mjs 175/175, cjs 6/6, `build.mjs --check`, reproducible Web bundle, `validate_versions()`.

## v0.2.26

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.26) · tag `v0.2.26` → `89441d3` · workflow run `40913233051` · assets app 1,656,746 B / node 73,558 B / plugin 1,302,240 B / manifest 1,566 B.

Released for the update-state and local-updater correction:

- Device one-click updates keep a single `正在更新` state for the whole Node → plugin → APP run; per-component intermediate states are suppressed until the final refresh. The header update dot also stays in the running state, and a failed run ends in `更新失败` with retry.
- Local plugin status uses the installed DSH profile as `current_version`; a newer source checkout is diagnostic only. A profile at 0.2.24 with source at 0.2.26 now reports an available update instead of a false `待生效`.
- When an update is available, the card always offers `一键更新`; `立即生效` is only the fallback after an apply that did not schedule a restart.
- The plugin archive now ships `tether/node/dsh_restart.py`, and the installer refreshes stale updater files from a source checkout, so local plugin self-updates can auto-restart DSH like remote plugin updates.
- Connection status is probed on mount and every 15 seconds without opening the panel; update checks refresh every 5 minutes.

Gates: pytest 125 passed / 1 skipped, mjs 172/172, cjs 6/6, `build.mjs --check`, reproducible Web bundle, `validate_versions()`. Published at 2026-10-29T16:39:47Z; the downloaded draft matched the manifest size/SHA-256 and verified its Ed25519 signature; the Hub manifest served 0.2.26 at 16:43:13Z with matching hashes. Installed acceptance is recorded separately after completion.

## v0.2.25

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.25) · tag `v0.2.25` → `ed49c23` · workflow run `40898090981` · assets app 1,654,227 B / node 73,521 B / plugin 1,298,504 B / manifest 1,566 B.

Released for the accepted remote-development workspace and connection-stability batch:

- The file explorer now uses Monaco `0.57.0` for editable code and Markdown, with device/path-isolated models, VSCode-like syntax themes, minimap, `Ctrl+S`, target path status, encoding/newline preservation, SHA-256 conflict detection, and target-device version polling. Ordinary code opens directly in the editor; only Markdown and table formats expose rendering switches.
- File create, rename, save, copy and paste continue to execute on the selected target device. Responses are device-bound when the node supplies an identity, while released nodes through 0.2.24 remain compatible when the field is absent. The DSH composer keeps local upload and adds a separate target-device file entry.
- The accepted explorer chrome uses neutral white/gray/black layers. The file tree, line-number gutter and code surface are `#efeff1`, `#f7f7f8` and `#ffffff`; the gutter keeps 13px visual whitespace without an artificial divider. Current-line background starts in the code area and the active line number only changes text color.
- Connection and update entries now share semantic status dots. Update availability is red, current/online is green, failure/offline is mapped by the corresponding card state, and background update-check failures remain silent outside the update center.
- Node control WebSockets opt out of inherited environment proxies when the installed `websockets` runtime supports it. Update replies are bound to the socket that received the request, so closing connections no longer leak `InvalidStateError` into a replacement connection.
- The source-installed DSH updater includes the same `release.py` and `ed25519.py` files as release archives, preventing the local plugin card from reporting `updater_missing`.

Gates: pytest 123 passed / 1 skipped, mjs 167/167, cjs 6/6, targeted editor regression 8/8, both shared bundles rebuilt and checked, and `validate_versions()` passed. DESKTOP-LOCAL held the candidate Node connection for 12.8 minutes without a keepalive timeout, disconnect, or `InvalidStateError`. Published at 2026-10-29T15:12:25Z; asset size/SHA-256 and the Ed25519 signature were re-verified from the downloaded draft. The Hub manifest served 0.2.25 at 2026-10-29T15:13:02Z with a valid signature and matching hashes. Installed two-device update acceptance is recorded separately after completion.

## v0.2.24

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.24) · tag `v0.2.24` → `a6de4a3` · workflow run `40828646049`.

- The plugin no longer embeds the local DSH page. The desktop host runs at `dsh-app://app`, and DSH mints its session cookie with `SameSite=Strict`, so the cookie is never sent to a `127.0.0.1` subframe (401); a `dsh-app` subframe has no preload and stalls at `Loading plugins…`. The local device now shows “已在 DSH 中”; remote devices keep using the Hub surface.
- The update center shows one manifest latest for every device (falling back to the current version only when the manifest has none). The display clamp that substituted the current version for a newer local build is gone, so local and remote cards can no longer disagree.
- Background update checks no longer raise a red toast or light the red dot on 更新; explicit actions still report errors.
- Updater hardening: a plugin apply while DSH is closed no longer leaves `restart_required` set forever (it clears when the next host publishes after the apply); the DSH restart helper strips an inherited `ELECTRON_RUN_AS_NODE` and relaunches once more if no new descriptor appears within 20 s; the APP check timeout is 90 s so the Hub→GitHub fallback fits.

Gates: pytest 117 passed / 1 skipped, mjs 158/158, cjs 6/6, `build.mjs --check` and `validate_versions` pass; both bundles rebuilt. Real desktop DSH window (CDP): the local panel settles on the local message with no 401 or stalled frame; the update center reports `0.2.24(0.2.23)` locally and `0.2.21(0.2.23)` for LAPTOP-01 with the same latest.

## v0.2.23

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.23) · tag `v0.2.23` → `d7ddaaf` · workflow run `40823756564` · assets app 411,239 B / node 71,555 B / plugin 415,745 B.

The Tether plugin entry no longer activates inside an embedded DSH page (`window.top !== window.self`), which removed the DSH-inside-DSH recursion. The local iframe still pointed at a cross-origin loopback or gateway URL, so the desktop host kept failing; 0.2.24 removed that path.

## v0.2.22

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.22) · tag `v0.2.22` → `5968952` · workflow run `40822614336` · assets app 410,782 B / node 71,554 B / plugin 415,460 B.

The plugin’s native panel switched to the current DSH session (loopback token URL) and the node re-authenticates once on a rotated session. In the desktop host the Strict cookie still blocks the subframe; 0.2.24 replaced this with the local state.

## v0.2.21

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.21) · tag `v0.2.21` → `5d01994` · workflow run `40821192816`.

Patch release for the remaining local-side update issues:

- The Electron APP kept a stale DSH session cookie on a reused port, so the native frame still showed `dsh web authentication required` even with a fresh token. The APP now clears cookies/localStorage for the loopback surface origin before loading or remounting the frame.
- The APP and DSH-plugin local updaters followed GitHub's edge-cached `latest` redirect and still showed `0.2.19` for the local cards. They now prefer the Hub mirror manifest (`hub.json` / app-context `serverUrl`); the API-based latest resolution stays as the fallback.

Verified on the lab bench: after installing 0.2.21 and restarting DSH, the native frame settled with `hasComposer=true` (no auth page), and both the APP and plugin updaters reported `latest_version=0.2.21` with `manifest_source` = the Hub mirror. A full remote update of LAPTOP-01 (0.2.20 → 0.2.21, no manual steps) applied Node (19 files), plugin (40 files, automatic DSH restart, `restart_required=false`) and APP (34 files, automatic restart); both machines report APP/Node 0.2.21.

## v0.2.20

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.20) · tag `v0.2.20` → `965adf1` · workflow run `40819992563`.

Fixes two regressions seen after the 0.2.19 automatic DSH restart:

- The native workspace kept showing `dsh web authentication required` after a DSH restart: the descriptor token stayed the same while the host session changed. The node now returns the DSH host `pid`/`updated_at` with the surface descriptor; the APP remounts the iframe and re-authenticates whenever that pid changes.
- The local plugin card still showed latest `0.2.18` after 0.2.19 shipped: the plugin updater followed GitHub's edge-cached `latest` redirect. It now resolves the latest tag through the release API (5-minute cache) before fetching, like the Hub mirror.

Verified on the lab bench: after installing 0.2.20 and restarting DSH, the native frame loads the current token URL (no auth error) and the plugin updater reports `latest_version=0.2.20`. A full remote update of LAPTOP-01 (0.2.19 → 0.2.20, no manual steps on the target) applied Node (19 files), plugin (40 files, automatic DSH restart, `restart_required=false`) and APP (34 files, automatic restart); both machines report APP/Node 0.2.20.

## v0.2.19

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.19) · tag `v0.2.19` → `66fdef1` · workflow run `40818499641`.

Remote plugin updates now finish on their own. A plugin bundle cannot be swapped inside a running DSH host, so the apply records the current host pid and schedules a detached restart helper on the target: it closes and reopens the DeepSeek Harness desktop app, the new host rewrites the surface descriptor, and the update status clears `restart_required` once the pid changes. The device chain waits for that restart before moving on.

End-to-end verification from DESKTOP-LOCAL to LAPTOP-01 (0.2.17 → 0.2.19, no manual steps on the target):

- Node: 40 s prepare/apply, the Node restarted itself and re-registered as `0.2.19` in about 5 s.
- Plugin: 40 files applied; the target DSH closed and reopened automatically; `restart_required` cleared and the runtime reported `0.2.19` about 12 s after apply.
- APP: 34 files applied; the APP restarted and reconnected as `0.2.19` in about 10 s.
- Final state: LAPTOP-01 online with APP/Node `0.2.19`, plugin runtime `0.2.19`, surface available.

The restart helper only targets the DeepSeek Harness executable; if it cannot be scheduled the plugin stays pending instead of pretending to be current. Chain hardening from 0.2.18 (per-component continuation, transient retries) is included.

## v0.2.18

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.18) · tag `v0.2.18` → `787aa3c` · workflow run `40816719901`.

Patch release for the remote one-click update chain. A node update briefly drops the control link, so the next component's check could return 400 `device_offline`; the chain aborted and silently skipped the APP, leaving a remote laptop on an older APP while its Node had updated.

- Each component now runs independently; a failed step is recorded and the remaining components still run.
- Checks retry transient errors (`device_offline`, `update_busy`, network, 5xx; three attempts, 2 s apart).
- Failures are collected into one notice; the APP restart is still verified against the device's reported `app_version`.
- A remote plugin that needs a DSH restart now shows `插件待重启 DSH` instead of `已是最新`.

Assets: app 405,627 B, node 68,122 B, plugin 413,538 B; manifest signature verified locally, sizes and SHA-256 match. Verified on the lab bench: LAPTOP-01 (Node/APP 0.2.17) sees all three components at 0.2.18 with `manifest_source` = the Hub mirror. The plugin runtime still needs one DSH restart on the target after apply.

## v0.2.17

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.17) · tag `v0.2.17` → `fdc9e35` · workflow run `40812163945`.

Patch release for the update check. The update center's force refresh only cleared the renderer cache; the Node and the local APP/plugin updaters still served a 10-minute disk manifest, so a just-published release could still show the previous version as latest.

- The Node's update check now calls `UpdateManager.check(force=True)`; status keeps the short-lived cache.
- The APP and DSH-plugin updater commands pass `--force` for check.
- Verified on the lab bench: a local Node/plugin check now reports `manifest_source` = the Hub mirror instead of `disk-cache`, and shows `latest_version=0.2.17` immediately after the release.

Assets: app 404,944 B, node 68,122 B, plugin 413,162 B; manifest signature verified locally, sizes and SHA-256 match, `min_updater=0.2.1`. The Hub mirror serves 0.2.17. Nodes on 0.2.15/0.2.16 can update directly once their old-version manifest cache expires (up to 10 minutes on the pre-fix build).

## v0.2.16

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.16) · tag `v0.2.16` → `8343fae` · workflow run `40810305861`.

- The local DSH workspace loads over the loopback surface instead of the public Hub: the node console serves `/dsh/surface`, the APP web server routes it through the local fast path, and the DSH plugin asks the host for that base. The node also refreshes a stale DSH session once on 401/403.
- The update center renders a fixed `APP|插件 X(Y)/Node X(Y)` line with per-component latest versions instead of mode-dependent text.
- The explorer separates panes by background shade (no 1px dividers), the code gutter spans the full height, syntax colours are blue/green/purple with red reserved for errors, code files are editable (Tab, `Ctrl+S`, native undo, dirty guard), and CSV/TSV tables edit in place with RFC4180 serialization. XLSX stays read-only.
- A fast folder double-click no longer shows a false "目录读取失败"; directory refreshes use a centred overlay instead of shifting the list.

Pre-release gates: `build.mjs --check`, 149 JS / 6 cjs / 108 pytest (1 skipped), `validate_versions()`. Assets: app 404,824 B `bd95088a…`, plugin 413,149 B `b52c751d…`, node 68,030 B `53fdfcc5…`; the manifest signature was verified locally and all sizes/SHA-256 values match. The Hub mirror serves 0.2.16. This desktop is the lab bench (source install); LAPTOP-01 is online at 0.2.15 and updates through the update center.

## v0.2.6

Update-center rework from feedback F48–F55:

- Cards are titled by device (`设备名 · Node`, `设备名 · DSH 插件`, `本机 Tether APP`, `本机 DSH 插件`); the modal lists every known device (local first), and opening it checks all online devices. Remote APP updates are explicitly out of scope (one-line note).
- Update errors are short one-liners, deduplicated through the bottom-right toast layer, and never rendered inside cards.
- After a one-click Node update the UI polls `capabilities.node_version` and converges the card to `已是最新`; plugin cards show `已重启 DSH，重新检查` and converge after the user restarts DSH. The one-click chain was verified end-to-end: DESKTOP-LOCAL plugin `0.2.3 → 0.2.5` via check → prepare (`bc04336b…`) → apply → status `current=0.2.5, installed_latest=true`.
- The local DSH-plugin card degrades to a short failure toast when the DSH-side RPC channel is unavailable; every device's Hub card remains the reliable version/update path.

The cross-machine attachment issue (F54) is recorded as pending a design decision; it is a browser file-picker boundary, not a routing bug. Packages are unsigned; install acceptance remains separate.

## v0.2.5

Fixes found in the first v0.2.4 deployment:

- Selecting the local device repeatedly raised `local route not found`: the session-detail poll requests `/api/devices/{id}/dsh/sessions/{session_id}`, the APP gateway forwards that route for the local device to the Node console, and the console only served the session list. The console now serves session transcripts (and the controller-matching 400 `not_found` for unknown IDs); devices reached through the Hub were never affected.
- Error banners no longer push the page content down: notices and workspace errors render as a dismissible overlay in the top-right corner with a close button; the workspace error keeps its retry action.

Verified behind the APP gateway against an isolated Node: session list 200, transcript of a real DSH session 200, unknown session 400 `not_found`. Browser check: the overlay appears without layout shift and closes via `×`. Tests: Python 83 passed / 1 skipped, JavaScript 72 passed. Packages are unsigned; install and dual-machine acceptance remain separate gates.

Deployment status: published after CI run 40627590181 verified the three ZIPs and manifest SHA-256 values. DESKTOP-LOCAL was overlaid with the v0.2.5 package (data untouched — `hub.json`, `policy.json` and workspace hashes unchanged) and restarted; the Hub reports Node `0.2.5` online, and the local session transcript answers through the APP gateway with `x-tether-local: 1` in 13 ms, so the repeated `local route not found` on the local device is gone. The second machine still needs the v0.2.5 APP.

## v0.2.4

Response-time release driven by live Hub measurements:

- APP routes file, workspace, drive, policy, audit, and DSH session requests for the local device directly to the loopback Node console instead of the public Hub. The console API is token-protected; the APP supervisor generates a per-process random token and passes it to the Node through `TETHER_LOCAL_API_TOKEN`.
- The shared UI caches directory/workspace data per device, seeds the tree from directory loads, prefetches directories and lightweight previews on hover, coalesces duplicate requests, aborts stale directory/preview requests, and exposes a stop control.
- Device switching is gated on the workspace response belonging to the new device, fixing the previous `not a directory` error when the old path was reused.
- Office previews are cached on the Node by path, `mtime_ns`, size, and kind; repeat previews do not invoke Word/PowerPoint COM again.
- Node WebSocket handling runs `fs_call` and `dsh_call` as bounded tasks, so a slow DSH transcript no longer blocks file requests.
- File rows use an in-app hover card instead of the native `title` tooltip; single click no longer fires twice during a double click.

Measured on an isolated Node behind the APP gateway: `fs/list` 3–4 ms (Hub baseline 264–681 ms), text preview 3 ms (baseline 261–604 ms), PPTX preview 2.9 s cold and 5 ms cached (baseline 5.3–5.6 s every time). Tests: Python 83 passed / 1 skipped, JavaScript 70 passed. These are local measurements; install, remote Node upgrade, and dual-machine acceptance remain separate gates. Packages are unsigned.

Deployment status: the release was built by CI (run 40624603316), the three ZIPs and manifest were downloaded and their SHA-256 values verified, and the draft was published. DESKTOP-LOCAL's installed APP was stopped, overlaid with the v0.2.4 package (data, `.venv`, `node_modules` and `work-local` untouched — `hub.json`, `policy.json` and workspace hashes unchanged), and restarted: the Hub reports Node `0.2.4` online, the local fast path answers with `x-tether-local: 1` in 3–4 ms, and the first PPTX preview cost 3814 ms with 6 ms on the second open. The second machine and the remote Node/plugin update are still pending.

## v0.2.3

Fixes found during the v0.2.1 to v0.2.2 upgrade acceptance:

- APP self-update now relaunches the APP with a visible window; the previous helper started the child with `windowsHide: true`.
- Applied prepared updates are removed from the update status, and prepared records that are not newer than the current version are ignored.
- APP and Node metadata writes preserve the plugin version actually installed in the DSH profile instead of regressing it.

This release includes the v0.2.2 first-run bootstrap and surface profile fixes. Packages are unsigned; real upgrade, rollback, and cross-device acceptance remain separately recorded.

Real upgrade on DESKTOP-LOCAL: APP, Node, and plugin moved from `0.2.1` through `0.2.2` to `0.2.3` through the APP update center; user data, database integrity, workspace files, and DSH sessions were preserved. Known residuals: restart labels remain after restart, the root `version.json` plugin field still reports `0.2.2` while the DSH profile is `0.2.3`, and the DSH-local plugin update button still reports a check failure; the APP update center is the working plugin update path.

## v0.2.2

This release fixes three defects found during the v0.2.1 baseline installation:

- APP first-run bootstrap now verifies the virtual-environment interpreter path and installed runtime, retries venv creation when Windows reports the interpreter late, and fails visibly instead of starting a broken APP.
- The DSH surface publishes its descriptor with the profile inferred from the live DSH Host argv; a failed RPC registration no longer prevents descriptor publication. This lets remote plugin updates identify the profile for out-of-tree plugin installations.
- The local plugin update channel now falls back to a clear "use the APP update center" message when the DSH RPC transport is unavailable.

The release publishes separate APP, plugin, and Node ZIPs plus `tether-update.json`. Packages are unsigned. Real in-app upgrade, rollback, and cross-device acceptance are recorded separately from the package checks.

## v0.2.1

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.1) publishes separate APP, DSH plugin, and Node ZIP packages plus `tether-update.json`. These are ZIP packages, not self-contained EXE installers, and do not include a Hub/server. Configure all components to use the same compatible Hub.

Official HTTPS downloads and SHA-256 values were checked; APP and Node updater checks against the official manifest passed, and the plugin package offline preflight passed. Clean installation, in-app upgrade, remote Node update, rollback, and real cross-device use remain unverified. Packages are unsigned, and the live service update API is not part of this public release.

The [release workflow](https://github.com/qi001007/tether-harness/actions/runs/40593437735) completed successfully: Python 75 passed / 1 skipped and JavaScript 60 passed. This CI result and the package checks do not establish a target-device installation.

## Release procedure

Pin the intended source commit, run the release workflow to create a draft, inspect all three ZIPs and the manifest (URLs, sizes, and SHA-256), publish the draft, then download the official HTTPS assets and recheck size and SHA-256. Record installation, upgrade, rollback, and service-side acceptance separately.
