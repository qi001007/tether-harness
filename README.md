# Tether

Tether adds device-aware file tools and remote task actions to the DeepSeek Harness desktop app. It consists of a DSH client plugin, an optional desktop APP client, and a Node installed on each target device. A compatible Tether service is required for multi-device use.

Repo: https://github.com/qi001007/tether-harness

## Components

| Component | What it does |
|---|---|
| DSH plugin | Adds device selection, file and permission views, and optional MCP tools to the DSH desktop app. The target DSH Host remains responsible for its own model, account, and session. |
| APP client | Provides a separate desktop entry point for connecting to a configured Tether service. |
| Node | Runs on a target device and performs operations allowed by that device's policy. |
| Tether service | Connects clients and Nodes. Use an approved private service if you have access, or configure a reachable Hub that you operate or are authorized to use. |

## Connect to a service

The client and Node need the address and credentials for the same compatible service. Keep credentials in local environment configuration; never commit them or paste them into public issues.

**Optional private service:** if your organization provides the Tether service as a private dependency, install it using the package source and instructions in its private repository or approved internal catalog. This public repository intentionally does not publish the private repository URL, deployment configuration, or credentials.

**Without access to a private service:** configure a reachable, compatible Hub that you operate or are authorized to use. For the APP, put its URL, access token, and Node token in the extracted APP's local `apps/tether-app/data/hub.json` (keys: `url`, `accessToken`, `nodeToken`) or supply the corresponding `TETHER_CONTROLLER_URL`, `TETHER_ACCESS_TOKEN`, and `TETHER_NODE_TOKEN` environment variables. For a Node, set `TETHER_CONTROLLER=wss://<your-hub>/ws/node` and its assigned `TETHER_NODE_TOKEN`; configure the DSH plugin through its connection page. These values are examples; replace the host and tokens locally, and do not commit credentials. If no compatible service is reachable and configured, remote device features are unavailable.

## Download v0.2.3 packages

The [v0.2.3 GitHub Release](https://github.com/qi001007/tether-harness/releases/tag/v0.2.3) contains one ZIP per component and the update manifest:

- [APP ZIP](https://github.com/qi001007/tether-harness/releases/download/v0.2.3/tether-app-0.2.3.zip)
- [DSH plugin ZIP](https://github.com/qi001007/tether-harness/releases/download/v0.2.3/tether-plugin-0.2.3.zip)
- [Node ZIP](https://github.com/qi001007/tether-harness/releases/download/v0.2.3/tether-node-0.2.3.zip)
- [Update manifest](https://github.com/qi001007/tether-harness/releases/download/v0.2.3/tether-update.json)

These are ZIP packages, not self-contained EXE installers. They do not include or configure a Hub. Configure all components to use the same reachable, compatible service and use compatible client, plugin, Node, and service versions.

### APP ZIP

On Windows, extract the ZIP and run `apps\tether-app\Tether-App.cmd` from the extracted folder. The launcher prepares its Python environment and installs APP dependencies on first run. It requires Python 3.11+ and Node.js 24 LTS with npm available on `PATH`.

### DSH plugin ZIP

Prerequisites: Windows, the DeepSeek Harness desktop app, and access to a configured compatible Tether service. Extract the ZIP, close DeepSeek Harness, and run this command from the extracted folder:

```powershell
.\desktop\install-plugin.ps1
```

Reopen DeepSeek Harness and select **Tether** in the sidebar. This archive installs the plugin only; it does not install the APP, Node, or a service.

### Node ZIP

On Windows, extract the ZIP, then follow its included `README-INSTALL.md`. The bootstrap requires Python 3.10+, Node.js 24 LTS, and npm. Configure the Hub WebSocket URL and the Node token issued by its operator; Nodes connect outbound and do not need a public inbound port. The Node's file policy determines which operations are allowed.

The v0.2.3 packages and manifest are built from this tag and checked before publication. v0.2.3 keeps the first-run/surface fixes from v0.2.2, restores a visible APP window after a self-update relaunch, removes applied prepared updates from status, and preserves the actual installed plugin version when APP or Node metadata is rewritten. Archive and manifest checks do not by themselves establish a target-device upgrade, rollback, or cross-device acceptance. The packages are not digitally signed. The legacy `v0.2.0` release has been withdrawn; its tag remains with a withdrawal notice.

## Plugin tools

When MCP tools are enabled, the DSH Agent can use:

- `list_peers` — list connected devices.
- `remote_task(device, prompt)` — submit a task to a device.
- `remote_status(run_id)` and `remote_cancel(run_id)` — inspect or cancel a task.
- `remote_workspaces(device)` — list a device's available workspaces.
- `remote_files(device, path, op, text?, dest?)` — perform policy-scoped file operations.
- `remote_audit(device, limit)` — inspect available audit records.

The target DSH Host owns model and session behavior. Tether does not replace its memory, plugins, or credentials. File access and writes remain subject to the Node's configured policy.

## Current status

- Core plugin and file-management views are implemented; local regression and desktop checks are recorded.
- A real local DSH response has been observed, but cross-device session continuity, remote native Host behavior, and attachment transfer are not fully accepted.
- APP, plugin, and Node ZIP packages are published separately. Clean installation and upgrade on target devices still need acceptance.
- Update checks and local update flows have implementation and isolated regression evidence. The v0.2.1 updater manifest was checked over HTTPS; in-app upgrade, remote Node update, rollback, and digital signatures remain outstanding.
- APP and plugin must present the same connection page and meaningful service status. The latest design has not received final real-service/user acceptance.

See [release downloads and process](docs/RELEASES.md), [PRD](docs/PRD.md), [live progress](docs/PROGRESS.md), [feedback](docs/FEEDBACK.md), and [public technical notes](docs/TECHNICAL.md) for scope and acceptance status.

## Development

To develop both the APP and plugin together, clone the public source repository:

```powershell
git clone https://github.com/qi001007/tether-harness.git
cd tether-harness
```

The APP can be run directly from its source package after installing its dependencies:

```powershell
npm install --prefix apps/tether-app
npm --prefix apps/tether-app start
```

This is the combined source-development path, separate from the individual v0.2.1 ZIP downloads above. The shared UI source and public client packages are in `packages/`. To rebuild the browser UI bundle during client development:

```powershell
npm --prefix packages/tether-ui run build:web
```

Service provisioning, private dependencies, and operations are documented separately for authorized operators and are not part of this public client guide.
