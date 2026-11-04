# Install matrix (0.3.6)

Status of every artifact and every supported entry point. This page is the source of truth for README and the public install page.

## Artifacts

| Component | Windows 11 x64 | Linux x64 | macOS arm64 / x64 |
|---|---|---|---|
| Tether APP (Electron GUI) | `tether-app-0.3.6.zip` → `install-app.cmd` | not packaged (use WebUI / DSH plugin) | not packaged |
| DSH plugin (Tether panel) | `tether-plugin-0.3.6.zip` → `desktop/install-plugin.ps1` | installed automatically by the Linux DSH Web installer | not supported yet |
| Node (headless target agent) | `tether-node-0.3.6.zip` → `laptop/bootstrap-node.ps1` | `curl -fsSL https://8-220-198-26.sslip.io/install.sh \| sudo bash` | `tether-node-0.3.6.zip` → `bash laptop/install-node.sh --no-systemd …` (experimental) |
| croc transfer binary | `croc.exe` | `croc-linux-x64` | `croc-darwin-arm64` / `croc-darwin-x64` |

The universal Node ZIP contains all croc binaries and picks the right one at runtime from `sys.platform` + machine architecture.

## Commands verified today

### Windows 11

```powershell
# APP
Expand-Archive tether-app-0.3.6.zip -DestinationPath tether-app
.\tether-app\install-app.cmd

# DSH plugin (after DSH Desktop is installed)
Expand-Archive tether-plugin-0.3.6.zip -DestinationPath tether-plugin
powershell -ExecutionPolicy Bypass -File .\tether-plugin\desktop\install-plugin.ps1 -Restart

# Node (needs a node token from the Hub)
Expand-Archive tether-node-0.3.6.zip -DestinationPath tether-node
powershell -ExecutionPolicy Bypass -File .\tether-node\laptop\bootstrap-node.ps1 `
  -ControllerUrl wss://<hub>/ws/node -Token <node-token>
```

### Linux x64

```bash
curl -fsSL https://8-220-198-26.sslip.io/install.sh | sudo bash
```

The installer prompts once for the Tether account, downloads the latest Node from `/install/version.json`, registers the device, installs systemd units, and removes the one-time login token. Clicking “安装 DSH Web” in the APP installs DSH + the Tether plugin into the `web` profile.

### macOS (experimental)

```bash
unzip tether-node-0.3.6.zip
cd tether-node-0.3.6
bash laptop/install-node.sh --no-systemd --prefix "$HOME/.local/share/tether-node" \
  --controller wss://<hub>/ws/node --token <node-token>
```

There is no macOS APP or DSH Desktop plugin installer yet. Only the Node/transfer/terminal path is expected to work.

## Test coverage

| Check | Windows | Linux | macOS |
|---|---|---|---|
| Clean GitHub runner install | ✅ | ✅ | ✅ |
| APP renderer launch on clean runner | ✅ | n/a | n/a |
| Node starts and connects | ✅ | ✅ | ✅ (runner) |
| Real VM login → files → terminal → DSH → transfer | ❌ | ❌ | ❌ |
| One-command install without a node token | ❌ (Node) / ✅ (APP) | ✅ | ❌ |
| DSH plugin | ✅ | ✅ (Web) | ❌ |
| 100 MB croc transfer | ✅ (with Linux server) | ✅ | not measured |

## Known gaps

1. Windows Node install still requires a node token; the account-driven one-command flow only exists on Linux.
2. macOS has no APP and no DSH plugin installer.
3. The business chain has been verified on real devices, not on freshly provisioned VMs.
4. No platform-specific slim Node packages yet; the universal ZIP is larger than necessary.
5. Throughput has only been measured on two paths: campus → Seoul server, and Seoul server → mobile-data laptop.

## Next steps

1. Add platform-specific Node ZIPs (`-windows-x64`, `-linux-x64`, `-darwin-arm64`, `-darwin-x64`) and teach `install-node.sh` to select them.
2. Add an account-driven Windows installer so the Node also needs zero manual token arguments.
3. Add macOS plugin support (DSH Desktop profile path on macOS) and a real macOS runner business test.
4. Build the network-condition matrix (LAN direct, campus NAT, mobile CGNAT, loss/latency via `tc netem` in an isolated netns) and record throughput against raw TCP.
5. Run the full business chain in clean VMs for all three systems.
