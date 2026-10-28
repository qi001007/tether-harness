<div align="center">
  <img src="assets/tether-icon.svg" width="88" alt="Tether icon" />
  <h1>Tether</h1>
  <p><strong>Your DeepSeek Harness workspace, across all your devices.</strong></p>
  <p>
    <a href="https://github.com/qi001007/tether-harness/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/qi001007/tether-harness?sort=semver" /></a>
    <a href="https://github.com/qi001007/tether-harness/actions/workflows/release.yml"><img alt="Release workflow" src="https://github.com/qi001007/tether-harness/actions/workflows/release.yml/badge.svg" /></a>
    <a href="https://github.com/qi001007/tether-harness/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
    <img alt="Platform: Windows 11+" src="https://img.shields.io/badge/platform-Windows%2011%2B-0078D4" />
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
| **APP** | A desktop | Electron client with a local supervisor; it can start a Node for the local machine and provides the update center, connection page, file explorer, permissions and interconnect views. | Not a second model backend. |
| **DSH plugin** | Inside DSH | The Tether panel, connection page, native surface descriptor, and local update channel. | Does not start a Node and does not make the local machine a target by itself. |
| **Node** | A target device | The headless agent that registers the device, executes file/command/DSH-surface requests, enforces policy, writes audit records, and applies Node/plugin updates. | It has no chat UI and does not run the model. |
| **Hub** | A server you operate | Authentication, device registry, request routing, surface gateways, and state sync. | Does not run models or write DSH sessions. |
| **Caddy + surface_mux** | The Hub host | TLS edge and public subdomain routing for native DSH surfaces. | Not a second Hub. |

### Do I need a Node?

**Yes, if you want a machine to be controlled.** The APP and the plugin are clients; the Node is the thing that gives a machine an executor. The APP can start a Node for you; the plugin cannot.

There are two different kinds of "target": a **file/command target** uses the Node's file policy and audit; a **native DSH target** additionally needs the target DSH Host to publish a `native-surface.json` descriptor, which is done by the DSH surface plugin (`tether-dsh-surface`).

| You install | Connect to Hub | Control others | File/command target | Native DSH target |
|---|---|---|---|---|
| APP only (with DSH) | Yes | Yes | Yes, if `nodeToken` is configured; the APP supervisor starts its Node | **No today** — the APP ZIP does not install the DSH surface plugin, so there is no descriptor |
| Plugin only (with DSH) | Yes | Yes | No — no Node | No — no Node |
| Node only | Yes, headless | n/a | Yes | No descriptor unless the DSH surface plugin is installed separately |
| APP + plugin | Yes | Yes | Yes | Yes |
| Plugin + Node | Yes | Yes | Yes | Yes |

A typical desktop uses **APP + plugin** (two views of the same machine). A laptop or a headless box can use **Node only** for file/command control, or **plugin + Node** for native DSH control. The current APP ZIP and plugin ZIP are still the older split; the packaging goal below removes this caveat.

The planned packaging is two user-facing products:

- **Tether Desktop** = APP + Node + DSH surface plugin;
- **Tether for DSH** = DSH plugin + Node + DSH surface plugin.

Both would include the runtime and the surface descriptor, so both can connect, control, and be controlled. A headless Node installer remains as an advanced option. Until that packaging lands, install **APP + plugin** for the full native experience, or **plugin + Node** for a native headless target.

## Quick start

### Prerequisites

- Windows 11 or later.
- The DeepSeek Harness desktop app installed and signed in on the device that will run the DSH Host.
- Python 3.11+ and Node.js 24 LTS with `npm` on `PATH` for the client packages.
- A reachable, compatible Tether Hub. The public repository does not include the Hub; use an operator-provided Hub or a self-hosted deployment you are authorized to run.

### 1. Choose your package

| Goal | Install |
|---|---|
| Control other machines from a desktop | APP and/or DSH plugin |
| Make this desktop a target | APP (its supervisor starts a Node) or the Node ZIP |
| Make a laptop/headless machine a target | Node ZIP |
| Work with remote machines from inside DSH | DSH plugin + a Hub |

### 2. Connect the components to the same Hub

All components must use the same Hub URL and compatible credentials.

- **APP**: create `apps/tether-app/data/hub.json` in the extracted APP with `url`, `accessToken`, `nodeToken`, and `device` (or set the corresponding `TETHER_*` environment variables). `nodeToken` is what makes the APP start a local Node.
- **DSH plugin**: open **Tether → 连接** and enter the Hub URL and access token. The plugin stores its connection settings in the DSH profile's local storage.
- **Node**: create a local `.env` with `TETHER_CONTROLLER=wss://<hub>/ws/node`, `TETHER_NODE_TOKEN=<node token>`, `TETHER_DEVICE=<device name>`, then run the Node bootstrap. Nodes connect outbound; no inbound port or VPN is required.

Never commit tokens, `.env` files, or `hub.json` to a public repository.

### 3. Verify

- Nodes expose a read-only local console; the APP-managed Node uses `http://127.0.0.1:18894`, and a standalone Node uses `18893` by default (or the configured `--console-port`).
- The Hub connection page should show the server address, connection status, last check time, and latency.
- Open **Interconnect** in the APP or plugin; the local device should be listed first, followed by the other devices.
- Open **Native workspace**; the target DSH UI should load. If a remote target stays blank, see [Status](#status).

### 4. Update

Open the APP's **Update center**. APP updates are downloaded and applied by the APP itself; Node and plugin updates are requested through the Hub and applied on the target device. Updates are deferred while a Tether task is active.

## Download

### Latest stable: v0.2.5

| Package | Download | Size | SHA-256 |
|---|---|---:|---|
| APP | [tether-app-0.2.5.zip](https://github.com/qi001007/tether-harness/releases/download/v0.2.5/tether-app-0.2.5.zip) | 347,909 B | `19daf78cc93a720a7d98d9c04dcd8b478a0c60299b38d901597dd51da91ffbab` |
| DSH plugin | [tether-plugin-0.2.5.zip](https://github.com/qi001007/tether-harness/releases/download/v0.2.5/tether-plugin-0.2.5.zip) | 370,480 B | `0e6075d5e1dccc53827f87996584debec02bc9d9aea51691125c3bdd004c8aec` |
| Node | [tether-node-0.2.5.zip](https://github.com/qi001007/tether-harness/releases/download/v0.2.5/tether-node-0.2.5.zip) | 53,665 B | `0ef4654c67d77dcb7e37e9a93df260f16a20c0ceb3e91126de2005402f71a77d` |
| Update manifest | [tether-update.json](https://github.com/qi001007/tether-harness/releases/download/v0.2.5/tether-update.json) | 997 B | — |

The manifest has a stable `latest` alias; component ZIP names include the version, so use the versioned links above for reproducible component downloads:

```text
https://github.com/qi001007/tether-harness/releases/latest/download/tether-update.json
```

Verify a Windows download with:

```powershell
Get-FileHash .\tether-app-0.2.5.zip -Algorithm SHA256
```

These are **ZIP source packages**, not self-contained EXE installers. They do not bundle Python, Node.js, DSH, or a Hub. Packages are **unsigned**; SHA-256 checks integrity against the manifest, not publisher identity.

### Package contents

- **APP ZIP**: Electron shell, shared UI, Python client/Node runtime, launcher, and bootstrap. Does not include the DSH plugin or a Hub.
- **DSH plugin ZIP**: the four Tether plugin packages and the installer. Does not include the APP, Node, or a Hub.
- **Node ZIP**: the headless Node runtime and bootstrap scripts. Does not include the APP, DSH plugin, or a Hub.

## Versioning

Tether uses **SemVer** and a single version for the client train. The source of truth is [`version.json`](version.json):

```json
{
  "schema": 1,
  "components": {
    "app": "0.2.5",
    "plugin": "0.2.5",
    "node": "0.2.5"
  }
}
```

- All APP, plugin, and Node packages in a release share the same version.
- Git tags are `vMAJOR.MINOR.PATCH`; the release workflow refuses a tag that does not match `version.json`.
- Every component ZIP carries a `version.json`; the updater merges only the component it is updating.
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

The APP update center has three rows:

1. **Tether APP** — self-update: manifest check, download, SHA-256, staging, idle apply, relaunch.
2. **Tether Node** — the selected device's Node updates itself through the Hub; the supervisor restarts it.
3. **DSH plugin** — the target device's plugin is updated through the Node; restart DSH to load it.

Safety rules:

- No automatic restart while a Tether task is active.
- Downloads are checked against the manifest SHA-256 before staging.
- Apply uses a backup and a file transaction; `data/`, `.env`, workspaces, and credentials are excluded.
- The updater never copies account credentials, sessions, or user data into a release asset.

Known residuals in 0.2.3 that are still present in 0.2.4:

- After a restart, the update card can still show a stale “restarting” label until the next refresh; the actual `current`/`latest` versions are correct.
- The root `version.json` plugin field can lag one component behind; the DSH profile and Hub status are authoritative.
- The DSH-local plugin update button can report a check failure; the APP update center is the working plugin update path.

## Networking and Tailscale

Tether's production path is:

```text
APP/plugin  ──HTTPS/WSS──▶  Hub (public TLS)  ◀──WSS outbound──  Node
                                  │
                                  └── Caddy ──▶ surface_mux ──▶ Hub surface gateway ──▶ Node ──▶ local DSH Host
```

- Nodes make **outbound** connections; no public inbound port is required.
- **Tailscale is not required** for multi-device use. The `start-tailscale.ps1` and `start-lan.ps1` scripts in the repository are local-development helpers, not the production architecture.
- The Hub must be reachable over HTTPS/WSS. Do not expose the loopback Controller port or the DSH Host port directly to the internet.
- Surface URLs use short-lived tickets and per-gateway cookies; the gateway only relays to the selected Node's local DSH Host.

## Security

**Current authentication is single-operator, not multi-tenant.** A Hub uses a shared access token for clients and a shared node token for Nodes. Anyone with those tokens can see and control every device on that Hub. Do not expose a Hub to other users, and do not use it as a public service in its current form.

Current protections:

- TLS at the Caddy edge; loopback-only Controller and mux.
- Shared-secret authentication for clients and Nodes; constant-time token comparison.
- Per-device file policy with allowed roots and read-only/read-write modes.
- Audit records on the target Node.
- Short-lived native surface tickets; HTTP/WS origin and Host checks.
- No package signature; SHA-256 is an integrity check only.

Planned (see [Status](#status)):

- User accounts and login on APP and plugin.
- One-time device pairing; per-device credentials; revoke/rotate.
- Per-user device isolation: a user can only see and control their own devices.
- Secure token storage in the OS credential store instead of plaintext JSON/`.env`.
- Email verification/password reset, rate limits, session revocation, and signed releases.

If you find a security issue, do not paste tokens, personal data, or private device information into a public issue. Open a minimal report and ask for a private channel.

## Status

| Area | Status |
|---|---|
| Public release v0.2.5 | Published; all three ZIPs and the manifest verified. v0.2.5 fixes the local-device transcript 404 and turns error banners into a dismissible overlay |
| Client update chain | Real APP/Node/plugin updates `0.2.1 → 0.2.2 → 0.2.3`; data preserved; `0.2.4` install acceptance pending |
| Response time | v0.2.4 adds the loopback fast path, per-device caching/prefetch, a stop control, Office preview caching, and concurrent Node request handling. Measured behind the APP gateway: `fs/list` 3–4 ms (Hub 264–681 ms), text preview 3 ms (261–604 ms), PPTX preview 2.9 s cold / 5 ms cached (5.3–5.6 s before) |
| Same-device APP + plugin | Verified: one DESKTOP-LOCAL DSH Host/session, bidirectional turns, a real `pwsh` command, matching file pages |
| Remote target native surface | Reproduced on a second local node: v0.2.1 showed a blank DSH panel; upgrading the Node to v0.2.3 loaded the DSH UI and executed `REMOTE-OK`. The local and remote paths use the same Hub gateway; physical second-machine acceptance is still pending. |
| Cross-device on a second physical machine | Pending; the second machine is online and reports 0.2.3, but real cross-device use has not been accepted |
| Accounts / login / per-user isolation | **Not implemented** |
| Digital signatures | Not implemented |
| Server release automation | Not implemented; the Hub uses a pinned-commit, backed-up, gated deploy with a rollback drill |

## Roadmap

- **Two products, one hidden runtime.** Ship **Tether Desktop** (APP + Node + surface plugin) and **Tether for DSH** (plugin + Node + surface plugin). Keep one shared Node runtime per device and reduce the update center to APP and plugin rows; a headless Node installer remains an advanced option.
- **Accounts and isolation.** User login, one-time device pairing, per-device credentials, per-user device isolation, an admin dashboard with invites/users/devices/health/audit, and invite-only testing.
- **Host adapter boundary.** Keep accounts, devices, routing, files and updates host-agnostic; put DSH behind a `HostAdapter` + `surface_kind` contract so alternative host/agent runtimes can be added without rewriting the network and account layer.
- **Remote surface acceptance.** Fix the blank remote DSH panel and accept real cross-device native control on a second physical machine.
- **Performance instrumentation.** v0.2.4 delivers the first measured step (loopback fast path, per-device caching/prefetch, Office preview caching, concurrent Node request handling). Still to add: per-segment timestamps, p50/p95 latency, incremental event streaming, and file range/preview hooks before optimizing state sync and remote file rendering.
- **Release hardening.** Signed packages, real update rollback drills, backup/restore drills, and a repeatable server release/rollback process.

## Development

```powershell
git clone https://github.com/qi001007/tether-harness.git
cd tether-harness
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e . pytest pytest-asyncio httpx
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
| `desktop/`, `laptop/` | Install/bootstrap scripts |
| `scripts/` | Build, native UI bridge, probes |
| `tests/` | Python and JavaScript regressions |
| `docs/` | PRD, progress, feedback, releases, technical notes |
| `.github/workflows/release.yml` | Tag-driven draft release workflow |

The Hub/Controller is a **private service** and is not part of this public repository. Operator deployment and server release details are kept in the private operations repository.

## Release process

1. Update `version.json`, `pyproject.toml`, and all component `package.json` files to the same SemVer.
2. Run the Python and JavaScript regressions.
3. Commit, create `vX.Y.Z`, and push the tag.
4. The release workflow validates the tag, runs tests, builds the three ZIPs and `tether-update.json`, and creates a **draft** GitHub Release.
5. Review the draft assets and manifest; publish it explicitly.
6. Verify the official `releases/latest/download/tether-update.json` and record the real install/upgrade result separately from the build result.

## Documentation

- [Product requirements](docs/PRD.md)
- [Live progress and acceptance boundaries](docs/PROGRESS.md)
- [User feedback](docs/FEEDBACK.md)
- [Release notes](docs/RELEASES.md)
- [Public technical notes](docs/TECHNICAL.md)
- [Core recovery and acceptance plan](docs/CORE_RECOVERY_PLAN.md)
- [Native DSH surface notes](docs/native-surface.md)

## License

MIT. See [LICENSE](LICENSE).
