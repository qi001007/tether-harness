<div align="center">
  <img src="assets/tether-app-s.svg" width="88" alt="Tether icon" />
  <h1>Tether</h1>
  <p><strong>Your DeepSeek Harness workspace, across all your devices.</strong></p>
  <p>
    <a href="https://github.com/qi001007/tether-harness/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/qi001007/tether-harness?sort=semver" /></a>
    <a href="https://github.com/qi001007/tether-harness/actions/workflows/release.yml"><img alt="Release workflow" src="https://github.com/qi001007/tether-harness/actions/workflows/release.yml/badge.svg" /></a>
    <a href="https://github.com/qi001007/tether-harness/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
    <img alt="Platform: Windows 11+" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-2563eb" />
    <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange" />
  </p>
  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#download">Download</a> ·
    <a href="#versioning">Versioning</a> ·
    <a href="#how-it-works">Architecture</a> ·
    <a href="#security">Security</a> ·
    <a href="#status">Status</a>
  </p>
</div>

---

Tether connects the **DeepSeek Harness (DSH)** desktop app on one machine to the DSH app on another. It does not replace DSH, proxy your model, or create a second conversational backend: the target device's **DSH Host remains the only place where the model runs and the session is written**. Tether adds the network, device identity, file policy, updates, and the UI that lets you choose which machine you are working on.

> **Project status: alpha.** Tether is a working research prototype, not a production multi-tenant service. Read [Status](#status) and [Security](#security) before exposing a Hub to other people.

> **Current working tree (2026-11-23): 0.5.14 (preview draft, not public).** The installed client on this workstation is 0.5.13. The transfer path is the target Node's SFTPGo over the private EasyTier mesh with time-limited SFTP relay, not Hub chunking or croc. The APP has account login (email/password + TOTP, device-code fallback), a per-device update job, and a native DSH surface. Release manifests are Ed25519-signed; Windows executables are **not** Authenticode-signed (`SIGN=0` default). Current facts, the baseline tag, and the single source for each topic are indexed in [`docs/PROJECT_INDEX.md`](docs/PROJECT_INDEX.md); setup/product expectations in older sections of this file may predate 0.5.x.

## Why Tether

- **DSH-native.** The remote surface is the real DSH web UI, not a rebuilt chat page. Your plugins, account, tools, and session history stay on the target DSH Host.
- **Choose your entry point.** The APP and the DSH plugin are independent clients. A headless Node makes any Windows machine a target.
- **No VPN required.** Nodes connect outbound to a public HTTPS/WSS Hub. Tailscale is not part of the production path.
- **Policy and audit by default.** File access is restricted to configured roots; every file operation is auditable on the target device.
- **One update contract.** APP, plugin, and Node share a version manifest and an in-app update center.

## How it works

```text
┌──────────────────┐        HTTPS / WSS         ┌────────────────────┐
│  APP  /  plugin  │ ─────────────────────────▶ │        Hub         │
│     clients      │ ◀───────────────────────── │ auth · route · state│
└──────────────────┘                            └─────────┬──────────┘
                                                          │ WSS /ws/node
                                                          ▼
                                                ┌────────────────────┐
                                                │        Node        │
                                                │  target-device     │
                                                │  agent (headless)  │
                                                └─────────┬──────────┘
                                                          │ loopback HTTP/WS
                                                          ▼
                                                ┌────────────────────┐
                                                │     DSH Host       │
                                                │ model · tools ·    │
                                                │ session authority  │
                                                └────────────────────┘
```

For the native DSH page, the Hub creates a short-lived surface gateway and the public URL `https://g<port>.<hub-suffix>/...` is routed by Caddy and `surface_mux` to that gateway. The gateway relays HTTP and WebSocket traffic to the target Node, which talks to its local DSH Host. The same path is used for a local or a remote target; there is no local-only shortcut.

### Components

| Component | Runs on | What it is | What it is not |
|---|---|---|---|
| **APP** | A desktop | Electron client with account login, a local supervisor that can start a Node, the update button/overlay, Settings, the file explorer, transfer page and interconnect views. | Not a second model backend. |
| **DSH plugin** | Inside DSH | The Tether panel, connection page, native surface descriptor, and local update channel. | Does not start a Node and does not make the local machine a target by itself. |
| **Node** | A target device | The headless agent that registers the device, executes file/command/DSH-surface requests, enforces policy, writes audit records, and applies Node/plugin updates. | It has no chat UI and does not run the model. |
| **Hub** | A server you operate | Authentication, device registry, request routing, surface gateways, and state sync. | Does not run models or write DSH sessions. |
| **Caddy + surface_mux** | The Hub host | TLS edge and public subdomain routing for native DSH surfaces. | Not a second Hub. |

### Do I need a Node?

**Yes, if you want a machine to be controlled.** The APP and the plugin are clients; the Node is the thing that gives a machine an executor. The APP can start a Node for you; the plugin cannot.

There are two different kinds of "target": a **file/command target** uses the Node's file policy and audit; a **native DSH target** additionally needs the target DSH Host to publish a `native-surface.json` descriptor, which is done by the DSH surface plugin (`tether-dsh-surface`).

| You install | Connect to Hub | Control others | File/command target | Native DSH target |
|---|---|---|---|---|
| APP only (with DSH) | Yes | Yes | Yes — the supervisor starts its Node | No — the DSH surface descriptor comes from the surface plugin |
| Plugin only (with DSH) | Yes | Yes | No — no Node | No — no Node |
| Node only | Yes, headless | n/a | Yes | No descriptor unless the DSH surface plugin is installed separately |
| APP + plugin | Yes | Yes | Yes | Yes |
| Plugin + Node | Yes | Yes | Yes | Yes |

A typical desktop uses **APP + plugin** (two views of the same machine). A laptop or a headless box can use **Node only** for file/command control, or **plugin + Node** for native DSH control. On Windows, the installer carries APP and Node together; the DSH surface plugin is installed by the Node's DSH flow.

## Quick start

### Prerequisites

- Windows 11 x64 or Linux x64; macOS arm64/x64 is experimental (unsigned, not notarized). See [`docs/INSTALL_MATRIX.md`](docs/INSTALL_MATRIX.md).
- The DeepSeek Harness desktop app installed and signed in on the device that will run the DSH Host.
- Python 3.11+ and Node.js 24 LTS with `npm` on `PATH` when running from source; release installers bundle the runtime.
- A reachable, compatible Tether Hub. The public repository does not include the Hub; use an operator-provided Hub or a self-hosted deployment you are authorized to run.

### 1. Choose your package

| Goal | Install |
|---|---|
| Control other machines from a desktop | APP and/or DSH plugin |
| Make this desktop a target | APP (its supervisor starts a Node) or the headless Node runtime package |
| Make a laptop/headless machine a target | Headless Node runtime package (Linux) |
| Work with remote machines from inside DSH | DSH plugin + a Hub |

### 2. Sign in to the same Hub

All components must use the same Hub URL.

- **APP and DSH plugin**: on first launch, enter the Hub URL and sign in with email/password (and a TOTP code if enabled), or register with an invite code. The device is enrolled automatically; no pairing code or device token is required. The session is stored locally and later launches skip the login page.
- **Node-only/headless**: create a local `.env` with `TETHER_CONTROLLER=wss://<hub>/ws/node`, `TETHER_NODE_TOKEN=<device token>`, `TETHER_DEVICE=<device name>`, then run the Node bootstrap. Nodes connect outbound; no inbound port or VPN is required.
- **Advanced/operator**: the APP's `hub.json` (`url`, `accessToken`, `nodeToken`, `device`) is still read for unattended installs. Normal users should use the account login instead.

Never commit tokens, `.env` files, or `hub.json` to a public repository.

### 3. Verify

- Nodes expose a read-only local console; the APP-managed Node uses `http://127.0.0.1:18894`, and a standalone Node uses `18893` by default (or the configured `--console-port`).
- Click the top-bar **连接** pill to see the Hub address, connection status, last check time and latency, and to refresh the check. Account e-mail, role, password change and logout are under **Settings**.
- Open **Interconnect** in the APP or plugin; the local device should be listed first, followed by the other devices.
- Open **Native workspace**; the target DSH UI should load. After 15 seconds a “loading slowly / reload” hint appears if it stalls; see [Status](#status).

### 4. Update

When a new version is available, a blue **↓** button appears in the top bar. Clicking it updates the Node plus the product you are currently using (APP or DSH plugin); a white progress overlay shows the single job, and the other product is left untouched. Updates are deferred while a Tether task is active. There is no separate update-center page.

## Download

Published builds are GitHub Releases of this repository. The current public preview is 0.5.13; 0.5.14 is a draft and not offered to users. Each release carries a signed schema 1 manifest plus platform installers:

| Package | OS | Artifact |
|---|---|---|
| Tether APP | Windows x64 | `Tether-<v>-win-x64.exe` (NSIS) |
| Tether APP | macOS arm64 / x64 | `Tether-<v>-mac-<arch>.dmg` |
| Tether APP | Linux x64 | `Tether-<v>-linux-x64.AppImage` / `.deb` |
| Node (headless) | Linux x64 | `Tether-node-runtime-<v>-linux-x64.tar.gz` / `.deb` |

- Update manifests are `latest.yml` / `preview*.yml`; the client verifies the Ed25519-signed manifest and each asset's SHA-256 before staging.
- Windows installers are unsigned (no Authenticode certificate). SHA-256 checks integrity, not publisher identity; SmartScreen may warn.
- Product form, install entry points and known gaps: [`docs/INSTALL_MATRIX.md`](docs/INSTALL_MATRIX.md) and [`docs/RELEASE_PIPELINE.md`](docs/RELEASE_PIPELINE.md).

Older ZIP packages (`tether-app-0.3.6.zip`, `tether-node-0.3.6.zip`, `tether-plugin-0.3.6.zip`) and the former mirror install scripts are retired; do not use them for new installs.

## Versioning

Tether uses **SemVer** and a single version for the client train. The source of truth is [`version.json`](version.json):

```json
{
  "schema": 1,
  "components": {
    "app": "0.5.14",
    "plugin": "0.2.93",
    "node": "0.5.14"
  }
}
```

- APP and Node share one version line; the DSH plugin has its own frozen line (0.2.93 filled by `version.json`).
- Git tags are `vMAJOR.MINOR.PATCH`; the release workflow refuses a tag that does not match `version.json`.
- Every component package carries a `version.json`; the updater merges only the component it is updating.
- `protocol` is the client/Hub update protocol (`1` today).
- `min_updater` is the oldest updater allowed to consume the manifest (`0.2.1` today). Older clients must install the `0.2.1` baseline once manually.
- There is no nightly channel. Only published releases are offered by the official manifest.

### Compatibility

| Surface | Current contract |
|---|---|
| Client update manifest | `schema: 1`, `protocol: 1`, `min_updater: 0.2.1` |
| Hub update API | `/api/devices/{device_id}/updates` for Node and plugin |
| Native DSH surface | `surface_protocol: 1`; requires a live DSH Host descriptor |
| Node registration | outbound `/ws/node` with `device_id`, token, capabilities |
| Server package | Private `tether-harness-server`; deployed independently from the client train |

## Updates

Updates are per device: the APP asks the Hub for the selected device's job, downloads in the background, and applies when no Tether task is active. On Windows, APP and Node arrive in one installer and are taken over together; on Linux the Node updates from the headless runtime package. A restart brings the device back online, and the Hub job records the transition before the old backup is removed.

Safety rules:

- No automatic restart while a Tether task is active.
- Manifests are Ed25519-signed; every asset is checked against its SHA-256 before staging.
- Apply uses a backup and a file transaction; `data/`, `.env`, workspaces, and credentials are excluded.
- The updater never copies account credentials, sessions, or user data into a release asset.
- Update-channel selection, single-package takeover and same-volume cache behavior are documented in [`docs/RELEASE_PIPELINE.md`](docs/RELEASE_PIPELINE.md); per-release accepted numbers are in `docs/PROGRESS.md`.

## Networking and Tailscale

Tether separates three planes:

```text
Control plane   APP/plugin ──HTTPS/WSS──▶ Hub ──WSS──▶ Node
Data plane      EasyTier private network (P2P first, relay fallback)
File plane      target Node SFTPGo / time-limited SFTP relay on the private network
```

- Nodes make **outbound** connections; the Hub does not need public inbound ports.
- The Hub is the only control plane: accounts, devices, permissions, jobs and audit.
- The data plane is a self-hosted EasyTier network; relay is a fallback, not the default. See [`docs/MESH_LIFECYCLE.md`](docs/MESH_LIFECYCLE.md) for the current state and phases.
- **Tailscale is not required** and is not part of the production path. The `start-tailscale.ps1` / `start-lan.ps1` helpers are local development scripts.
- Do not expose the loopback Controller port, the SFTP services, or the DSH Host port directly to the internet.

## Security

**The Hub is a personal deployment, not a multi-tenant service.** APP and plugin use account login (email/password + TOTP, with a device-code fallback); Nodes use per-device credentials issued through the account flow. Do not expose a Hub to other users in its current form.

Current protections:

- TLS at the Caddy edge; loopback-only Controller and mux.
- Per-device credentials for Nodes; account sessions stored encrypted on the client.
- Per-device file policy with allowed roots and read-only/read-write modes; audit records on the target Node.
- Short-lived native surface tickets; HTTP/WS origin and Host checks.
- Ed25519-signed update manifests and SHA-256 per asset. Windows executables are unsigned (no Authenticode); macOS builds are not notarized yet.
- Device owners grant transfer/relay consent on their own device; time-limited relay leases are revoked on expiry or when the owner turns them off.

Planned or incomplete (see [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/PROJECT_INDEX.md`](docs/PROJECT_INDEX.md)):

- Multi-user isolation on one Hub, admin dashboard, email verification/password reset, rate limits.
- Windows Authenticode and Apple Developer ID/notarization (tracked in `docs/SIGNING.md`).
- Stronger host-level hiding of device credentials.

If you find a security issue, do not paste tokens, personal data, or private device information into a public issue. Open a minimal report and ask for a private channel.

## Status

| Area | Status |
|---|---|
| Public release | 0.5.13 preview is published and pinned in the production Hub. 0.5.14 is a draft preview and is not offered to users |
| Client update chain | Per-device jobs: background download, idle apply, restart and acceptance via the Hub. Accepted timings and per-device results are in `docs/PROGRESS.md` |
| Accounts / login | Account login (email/password + TOTP), device-code fallback, encrypted session persistence; Node credentials are per device |
| Native DSH surface | Real target DSH Host page via signed short-lived tickets; local and remote use the same gateway |
| Mesh data plane | Source node has a supervisor, peer parsing and P2P status; installer-managed bootstrap is not done (`docs/MESH_LIFECYCLE.md` §4) |
| File plane | Target Node SFTPGo and owner-approved, time-limited SFTP relay; six-direction 5 MB/s remains the acceptance goal |
| Digital signatures | Update manifests signed (Ed25519); Windows Authenticode and macOS notarization not implemented |
| Server release automation | Hub deploy/pin/reload is still manual and gated |

## Roadmap

- Mesh phase 2–3: installer-managed mesh bootstrap, remove the hand-installed desktop mesh, surface connection type (direct/relay/offline) in the UI.
- File plane: meet the six-direction 5 MB/s goal and finish relay consent/lease coverage for all devices.
- Platform signing: Windows Authenticode and Apple Developer ID/notarization when certificates are available.
- Accounts and isolation: move the Hub from a personal deployment toward multi-user isolation, admin views and session revocation.
- Release hardening: Hub pin automation, rollback drills, and ARM64 gaps tracked in `docs/RELEASE_PIPELINE.md`.

## Development

```powershell
git clone https://github.com/qi001007/tether-harness.git
cd tether-harness
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
npm ci --prefix packages/tether-ui
```

Run the regressions:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
node --test tests/test_*.mjs
```

Build the release archives and manifest locally:

```powershell
.\.venv\Scripts\python.exe scripts\build_release.py
```

Run the APP from source:

```powershell
npm install --prefix apps/tether-app
npm --prefix apps/tether-app start
```

### Repository layout

| Path | Contents |
|---|---|
| `apps/tether-app/` | Electron APP, supervisor, updater helper |
| `packages/` | Shared UI, DSH plugin bundles, native UI bridge, surface plugin |
| `tether/` | Python client, Node runtime, native surface, updater, MCP tools |
| `desktop/` | Packaging, candidate build scripts and installer definitions |
| `scripts/` | Build, native UI bridge, probes |
| `tests/` | Python and JavaScript regressions |
| `docs/` | PRD, progress, feedback, releases, technical notes |
| `.github/workflows/release.yml` | Tag-driven draft release workflow |

The Hub/Controller is a **private service** and is not part of this public repository. Operator deployment and server release details are kept in the private operations repository.

## Release process

1. Bump the version with `python scripts/release_pipeline.py bump --version X.Y.Z --write` (dry-run by default); it syncs `version.json`, `apps/tether-app/package.json`, `package-lock.json` and `pyproject.toml`.
2. Run the Python and JavaScript regressions; the release matrix runs them again per platform.
3. Run the manual `release-matrix.yml` workflow with `sign=false` for an unsigned draft, or push a tag for the tag-driven `release.yml` candidate path.
4. Review the draft assets, manifest and `signing-status.json`; publish explicitly. CI never publishes on its own.
5. Record the real install/upgrade result separately from the build result in `docs/PROGRESS.md`; Hub pin/reload stays manual.
6. Signing requirements and secrets: `docs/SIGNING.md` and `docs/SIGNING_SETUP.md`. Details: `docs/RELEASE_PIPELINE.md`.

## Documentation

- [Project index — single source per topic](docs/PROJECT_INDEX.md)
- [Product requirements](docs/PRD.md)
- [Live progress and acceptance boundaries](docs/PROGRESS.md)
- [User feedback](docs/FEEDBACK.md)
- [Release history](docs/RELEASES.md)
- [Public technical notes](docs/TECHNICAL.md)
- [Mesh lifecycle](docs/MESH_LIFECYCLE.md)
- [Release pipeline](docs/RELEASE_PIPELINE.md)
- [Native DSH surface notes](docs/native-surface.md)

## License

MIT. See [LICENSE](LICENSE).
