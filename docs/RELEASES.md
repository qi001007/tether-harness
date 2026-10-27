# Public client releases

## v0.2.1

[GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.1) publishes separate APP, DSH plugin, and Node ZIP packages plus `tether-update.json`. These are ZIP packages, not self-contained EXE installers, and do not include a Hub/server. Configure all components to use the same compatible Hub.

Official HTTPS downloads and SHA-256 values were checked; APP and Node updater checks against the official manifest passed, and the plugin package offline preflight passed. Clean installation, in-app upgrade, remote Node update, rollback, and real cross-device use remain unverified. Packages are unsigned, and the live service update API is not part of this public release.

The [release workflow](https://github.com/qi001007/tether-harness/actions/runs/40593437735) completed successfully: Python 75 passed / 1 skipped and JavaScript 60 passed. This CI result and the package checks do not establish a target-device installation.

## Release procedure

Pin the intended source commit, run the release workflow to create a draft, inspect all three ZIPs and the manifest (URLs, sizes, and SHA-256), publish the draft, then download the official HTTPS assets and recheck size and SHA-256. Record installation, upgrade, rollback, and service-side acceptance separately.
