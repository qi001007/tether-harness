# Public client releases

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
