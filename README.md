# Tether

Tether adds device-aware file tools and remote task actions to the DeepSeek Harness desktop app. It consists of a DSH client plugin, an optional desktop APP client, and a Node installed on each target device. A compatible Tether service is required for multi-device use.

Repo: https://github.com/qi001007/tether-harness

## Components

| Component | What it does |
|---|---|
| DSH plugin | Adds device selection, file and permission views, and optional MCP tools to the DSH desktop app. The target DSH Host remains responsible for its own model, account, and session. |
| APP client | Provides a separate desktop entry point for connecting to a configured Tether service. Standalone installation and update acceptance are still in progress. |
| Node | Runs on a target device and performs operations allowed by that device's policy. |
| Tether service | Connects clients and Nodes. Use an approved private service if you have access, or configure a reachable Hub that you operate or are authorized to use. |

## Connect to a service

The client and Node need the address and credentials for the same compatible service. Keep credentials in local environment configuration; never commit them or paste them into public issues.

**Optional private service:** if your organization provides the Tether service as a private dependency, install it using the package source and instructions in its private repository or approved internal catalog. This public repository intentionally does not publish the private repository URL, deployment configuration, or credentials.

**Without access to a private service:** configure a reachable Hub that you operate or are authorized to use. Set the APP's local `TETHER_CONTROLLER_URL` to `https://<your-hub>` and its local `TETHER_ACCESS_TOKEN` to the token supplied by that Hub's operator. Configure each Node with `TETHER_CONTROLLER=wss://<your-hub>/ws/node` and its assigned `TETHER_NODE_TOKEN`. These values are examples; replace the host and tokens locally. If no compatible service is reachable and configured, remote device features are unavailable.

## Install the DSH plugin

Prerequisites: Windows, the DeepSeek Harness desktop app, and a configured Tether service. Close the DSH app normally before installing the plugin, then reopen it and select **Tether** in the sidebar.

```powershell
.\desktop\install-plugin.ps1
```

The plugin connects to the configured service; it does not create a service or network path by itself. Each target that needs the native DSH page must also have the DSH desktop app running with a compatible Tether plugin and Node.

## Install a Node

Install the Node using the package and instructions provided by your service operator. Configure its service address, device identity, and assigned credentials locally. Nodes connect outbound to the configured service; a target device does not need to expose an inbound public port. The Node's file policy determines which operations are allowed.

Use compatible client, plugin, Node, and service releases. Updating only one component can leave the system unable to connect. Legacy release packages are being removed as part of repository cleanup; do not assume older downloads remain available. New independent installation packages have not been published.

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
- APP, plugin, and Node independent installation and upgrade still need clean-install and real-device acceptance.
- Update checks and local update flows have implementation and isolated regression evidence. The latest build has not been publicly released; complete remote update acceptance and digital signatures remain outstanding.
- APP and plugin must present the same connection page and meaningful service status. The latest design has not received final real-service/user acceptance.

See [PRD](docs/PRD.md), [live progress](docs/PROGRESS.md), [feedback](docs/FEEDBACK.md), and [public technical notes](docs/TECHNICAL.md) for scope and acceptance status.

## Development

Clone the public source repository for development:

```powershell
git clone https://github.com/qi001007/tether-harness.git
cd tether-harness
```

The APP can be run directly from its source package after installing its dependencies:

```powershell
npm install --prefix apps/tether-app
npm --prefix apps/tether-app start
```

This is a source-development path, not a published standalone installer. The shared UI source and public client packages are in `packages/`. To rebuild the browser UI bundle during client development:

```powershell
npm --prefix packages/tether-ui run build:web
```

Service provisioning, private dependencies, and operations are documented separately for authorized operators and are not part of this public client guide.
