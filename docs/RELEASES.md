# Public client releases

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
