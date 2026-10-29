# Public client releases

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
