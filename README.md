# Tether

> DeepSeek Harness stays the Agent. Tether is the MCP tool that lets it work on other machines.

A multi-device Agent Harness client. You chat with the **DeepSeek Harness desktop
app** as usual (same memory, skills, and plugin marketplace). When a task belongs
on another computer, the Agent calls Tether's MCP tools; the target machine runs
its own Harness Agent with its own files, shell, and model key, and the result
comes back into the DeepSeek conversation.

Repo: https://github.com/qi001007/tether-harness

```
DeepSeek Harness desktop app (Agent, your normal UI)
        │ MCP stdio: mcp__tether__list_peers / remote_task / remote_status / remote_cancel
        ▼
Tether MCP server ──HTTP──► Tether Controller (FastAPI + SQLite)
                                   │ outbound WSS + token (Tailscale / LAN)
                                   ├──► Node DESKTOP-LOCAL → dsh
                                   └──► Node LAPTOP-01    → dsh
Tether's own chat page is an optional monitor, not the Agent.
```

## What is verified

| Claim | Evidence |
|---|---|
| DeepSeek Harness desktop Agent calls Tether itself | In the official desktop app, the Agent called `list_peers` and returned 3 devices / 2 online |
| Agent-to-Agent delegation | The desktop Agent called `remote_task` for `LAPTOP-01`; the laptop created `D:\tether-node\work\tether-delegated.txt` with `OK` |
| Same harness session on the target | A second read-only verification run reused `dsh_session=tether-s-d0332f33ad47` |
| Real dsh writes/reads files | `tether-delegated.txt` is 2 bytes, bytes `4F 4B`, no BOM/newline |
| Cancel leaves no residual tree | before: dsh → sandbox → pwsh → python (6 procs); after: only the node daemon (0 residual) |
| Network drop does not lose events | 8s socket drop; events buffered in the node outbox; 13 events, contiguous `seq`, no duplicates |
| Idempotent submission | same `request_id` + content returns the first run; different content returns 409 |
| Node crash is not a false failure | run becomes `unknown`; never auto-reruns; `reconcile` reports the node ledger |
| Cross-machine over Tailscale | `LAPTOP-01` registered and executed over `100.x`; controller UI/API stays loopback-only |

Screenshots: `docs/screenshots/deepseek-desktop.png`,
`docs/screenshots/deepseek-after-tether.png`,
`docs/screenshots/deepseek-delegated.png`.
Raw notes: `evidence/gate0.md`, `evidence/gate2.md`, `evidence/cancel_probe.json`.

## Quick start (desktop Agent)

Prerequisites: Windows, Python 3.11+, Node 24 + npm, the official DeepSeek Harness
desktop app (https://www.deepseek.com/harness/).

```powershell
# 1) Tether control plane + local node (the Tether window is only a monitor)
cd tether
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
npm install --prefix .runtime\npm --no-audit --no-fund "@deepseek-ai/dsh@0.2.1-rc.2"
Copy-Item .env.example .env   # fill DEEPSEEK_API_KEY
.\desktop\tether-app.ps1

# 2) Add Tether MCP to the DeepSeek Harness desktop profile
#    (close the DeepSeek app first; it rewrites this file on exit)
.\desktop\install-mcp.ps1

# 3) Restart DeepSeek Harness, then ask its Agent:
#    用 Tether 列出当前已接入的设备
#    让 LAPTOP-01 的 Agent 在 D:/tether-node/work 建一个文件并读回来
```

The desktop app keeps its own memory/plugins. Tether only adds four MCP tools:

- `list_peers`
- `remote_task(device, prompt)`
- `remote_status(run_id)`
- `remote_cancel(run_id)`

## Quick start (laptop node)

```powershell
# clone/copy this repo to the laptop, then:
.\laptop\bootstrap-node.ps1
# edit .env: DEEPSEEK_API_KEY, TETHER_CONTROLLER=<desktop Tailscale IP>
.\laptop\tether-node.ps1
```

The laptop needs Tailscale (same account as the desktop) or a reachable controller
address. Only outbound WSS is used; the laptop opens no inbound port. Its local
console is `http://127.0.0.1:18893`.

## Important: dsh runtime on Windows

`deepseek-harness-sdk==0.2.1rc2` ships a Windows runtime that resolves
`@koromix/koffi-win32-x64` to the build-machine path `E:\snapshot\node\...`.
Every turn fails with `The specified module could not be found`.

Workaround used by the Tether node: install the npm runtime and point the Python
SDK at it (`tether/node/dsh_adapter.py:npm_launch_args()`). The SDK still owns the
session, events, resume, and shutdown; only the runtime binary comes from npm.

The desktop app has its own bundled runtime and is not affected.

## Design boundaries

- **Agent-first**: the interaction surface is DeepSeek Harness (or another MCP
  Agent such as Qoder/Codex). Tether does not replace its memory/plugins.
- **v0.1 topology**: one controller, multiple nodes; the desktop is the initiator,
  the laptop is a controlled node. The target peer-to-peer Agent network is in
  `DESIGN.md` §9 and is **not implemented**.
- **Verified**: real dsh execution, MCP delegation, session continuation, event
  replay, idempotency, `unknown`, hard cancel with 0 residual, Tailscale.
- **Designed / not implemented**: symmetric peer Agents (every device initiates),
  approval UI (the pinned SDK wheel lacks the handshake), multi-task concurrency,
  Linux/WSL, public relay, production auth/audit.

## Repository layout

```
tether/
  mcp_server.py    MCP tools the Agent calls (list_peers/remote_task/...)
  controller/      FastAPI API, SSE, device/run/event store
  node/            outbound WSS, local outbox, dsh adapter, local console
  static/          optional monitor UI
  scripts/up.py    control plane + local node + monitor window
  desktop/         MCP installer, app launcher, Tailscale/LAN helpers
  laptop/          bootstrap + node scripts (no inbound port)
  evidence/        measured results
```

MIT licensed. Full design: [DESIGN.md](DESIGN.md). Reviewer path:
[REVIEWER_GUIDE.md](REVIEWER_GUIDE.md). Demo script:
[VIDEO_SCRIPT.md](VIDEO_SCRIPT.md).