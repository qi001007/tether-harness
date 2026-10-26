# Laptop node setup

This side only runs the Tether node and DeepSeek Harness. It does not need the
desktop UI, Raven, or an inbound port.

## 1. Prerequisites

- Windows 10/11
- Python 3.11 or 3.12 on PATH (`python --version` works)
- Node.js 24 LTS + npm on PATH (`node --version`, `npm --version` work)
- Tailscale, signed in with the **same account as the desktop** (`qi001007@`)

If Python or Node is missing, install it and reopen PowerShell before continuing.

### Tailscale

Download and install on the laptop:

- https://tailscale.com/download/windows
- Direct installer: https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe

Sign in with the same account as the desktop. Then verify:

```powershell
tailscale ip -4
Test-NetConnection 100.x.x.x -Port 18890
```

The first command should print a `100.x` address for the laptop. Replace
`100.x.x.x` with the **desktop's** `tailscale ip -4` address; the second command
should succeed. Do not use the laptop's own `100.x` in `TETHER_CONTROLLER`.

## 2. Copy and extract

Any drive works. Recommended layout:

```
D:\tether-node\app
```

The node root is the parent of `app` (`D:\tether-node`). The extracted directory
must contain `pyproject.toml`, `tether\`, and `laptop\`.

The bootstrap puts everything next to the app, so nothing is written to C:
unless you choose C: yourself:

```
D:\tether-node\app\.venv
D:\tether-node\app\.runtime\npm
D:\tether-node\.home
D:\tether-node\work
```

## 3. Bootstrap

```powershell
cd D:\tether-node\app
.\laptop\bootstrap-node.ps1
```

Then edit `D:\tether-node\app\.env` and fill only:

```
DEEPSEEK_API_KEY=sk-...
```

`TETHER_CONTROLLER` must point at the desktop's Tailscale address
(`ws://<desktop-100.x>:18890/ws/node`). Fill it from the desktop's
`tailscale ip -4`. `TETHER_NODE_TOKEN` must match the desktop `.env`.

## 4. Run

The desktop controller listens on `0.0.0.0:18890`; the human UI/API stays
loopback-only, and only `/ws/node` is reachable from the tailnet with a token.

On the laptop:

```powershell
cd D:\tether-node\app
.\laptop\tether-node.ps1
```

You should see `[online] ... LAPTOP-01` and the local console URL:

```
http://127.0.0.1:18893
```

The local console is read-only and shows the same tool/assistant events as the
desktop; it is served from the node's own outbox, so it keeps updating even when
the desktop link is down.

## 5. Remove

```powershell
cd D:\tether-node\app
.\laptop\uninstall-node.ps1
```

It asks for confirmation before removing the app directory, `.home`, and `work`.