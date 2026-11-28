# Third-party notices

## Tomli

- Project: [Tomli](https://github.com/hukkin/tomli), version 2.3.0
- License: MIT, included in `tether/node/_tomli/LICENSE`.
- Tether uses this bundled parser on Python 3.10. Python 3.11 and later use the standard-library `tomllib`.

## Herdr

- Project: herdrdev/herdr (https://herdr.dev)
- License: Apache-2.0 (see `tether/node/bin/LICENSE.herdr`)
- Bundled binaries: `herdr.exe`, `herdr-linux-x86_64`, `herdr-macos-x86_64`, `herdr-macos-aarch64`
- Windows ConPTY helpers and Microsoft notices are included under `tether/node/bin/conpty` and `tether/node/bin/THIRD-PARTY-NOTICES.herdr`.

## Codeg agent icons

- Project: xintaofei/codeg (https://github.com/xintaofei/codeg)
- License: Apache-2.0
- The SVG brand marks under `packages/tether-ui/src/agent-icons/` are copied from Codeg's `docs/images/agents` and used only in the Tether agent catalog. See `packages/tether-ui/src/agent-icons/NOTICE.md`.

## Codeg web frontend (internal fork)

- Project: xintaofei/codeg (https://github.com/xintaofei/codeg), base `v0.42.0` (`e3171d69d208bdf37697b15e8b14f8c9b70825bf`)
- License: Apache-2.0 (see `third_party/codeg/LICENSE` and `third_party/codeg/THIRD_PARTY_ORIGIN.json`)
- Tether maintains the web frontend source under `third_party/codeg/` and builds the static runtime shipped in `tether/node/bin/agents-runtime/web/`.

## Codeg chat UI structure

- Project: xintaofei/codeg (https://github.com/xintaofei/codeg)
- License: Apache-2.0
- The structured conversation layout (activity capsule, step rail, thought/tool rows, conversation detail panel) in `packages/tether-ui/src/agents-page.js` is adapted from Codeg's chat/message components. No Codeg runtime code is bundled; only the layout/interaction design is reused.
