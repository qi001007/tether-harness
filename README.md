# Tether

> Phase 1 vertical slice: https://github.com/qi001007/tether-harness

A multi-device Agent Harness client. One machine issues a task, another machine's
Agent executes it locally with its own files, shell, and model key; the caller sees
the live tool/assistant stream and can cancel or continue the session.

This repository is the Phase 1 vertical slice of the interview design:

```
Chat UI (desktop, Edge --app)
   │ HTTP + SSE
Tether Controller (FastAPI + SQLite)
   │ outbound WSS + token (Tailscale / LAN)
Tether Node (Windows) → DeepSeek Harness (dsh)
```

The desktop also runs a local Agent (`DESKTOP-LOCAL`), so the chat is useful before
any second machine joins. A laptop node is the same package with a different
`.env`; no inbound port is opened on the laptop.

## What is verified

| Claim | Evidence |
|---|---|
| A real dsh Agent creates a file on the target machine | `gate2.txt` created in `work-local`, `pwsh` + `read` tool events, 13 Tether events |
| Continuing a conversation | second run in the same session answered from prior context, same `dsh_session` |
| Cancel leaves no residual process tree | before: dsh → sandbox → pwsh → python (6 procs); after: only the node daemon (0 residual) |
| Network drop does not lose events | 8s socket drop, events buffered in the node outbox, replayed with contiguous `seq`, no duplicates |
| Idempotent submission | same `request_id` + content returns the first run; different content returns 409 |
| Node crash is not a false failure | run becomes `unknown` (never auto-rerun); reconcile reports the node's ledger |
| Cross-machine execution | `LAPTOP-01` created `D:\tether-node\work\laptop-proof.txt` over Tailscale |
| Chat-first desktop Agent | `DESKTOP-LOCAL` replies in the UI; local console at `127.0.0.1:18893` |

Raw notes: `evidence/gate0.md`, `evidence/gate2.md`, `evidence/cancel_probe.json`.

## Quick start (desktop)

Prerequisites: Python 3.11+, Node 24 + npm, Edge.

```powershell
cd tether
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
npm install --prefix .runtime\npm --no-audit --no-fund "@deepseek-ai/dsh@0.2.1-rc.2"
Copy-Item .env.example .env
# edit .env: DEEPSEEK_API_KEY=...
.\desktop\tether-app.ps1
```

`tether-app.ps1` starts the controller, the local Agent node, and an Edge
`--app` window. Logs: `.runtime/logs/`.

## Quick start (laptop node)

```powershell
# clone/copy the repo to the laptop, then:
.\laptop\bootstrap-node.ps1
# edit .env: DEEPSEEK_API_KEY=...
.\laptop\tether-node.ps1
```

The laptop needs Tailscale (same account as the desktop) or a reachable controller
address. Only outbound WSS is used; the laptop opens no inbound port.

## Important: dsh runtime on Windows

`deepseek-harness-sdk==0.2.1rc2` ships a Windows runtime that resolves
`@koromix/koffi-win32-x64` to the build machine path `E:\snapshot\node\...`.
Every turn fails with `The specified module could not be found`.

Workaround used here: install the npm runtime and point the Python SDK at it:

```powershell
npm install --prefix .runtime\npm @deepseek-ai/dsh@0.2.1-rc.2
```

`tether/node/dsh_adapter.py` passes `_launch_args=(node, .../dsh/lib/bin.js,
"--profile","sdk")`. The Python SDK still owns the session, events, resume, and
shutdown; only the runtime binary comes from npm.

## Design boundaries

- Verified: the star topology (one controller, multiple nodes), the reliability
  core (`seq`/ack/journal, idempotency, `unknown`, hard cancel, resume), and one
  real harness adapter (dsh SDK).
- Designed, not implemented: a symmetric peer-to-peer Agent network where every
  device is both caller and callee; approval UI (the pinned SDK wheel lacks the
  `approval_requests` handshake); multi-task concurrency; Linux/WSL; public relay.
- Not production security: the demo uses a shared node token and a tailnet/LAN.
  The human UI/API is loopback-only; keys stay on the node. A real deployment
  needs per-device pairing, revocation, audit, and WSS/mTLS.

## Repository layout

```
tether/
  controller/      FastAPI API, SSE, device/run/event store
  node/            outbound WSS, local outbox, dsh adapter, local console
  static/          chat UI
  scripts/up.py    one-command desktop app
  laptop/          bootstrap + node scripts (no inbound port)
  desktop/         app launcher + Tailscale/LAN helpers
  evidence/        measured results
```

MIT licensed. The full design document for the interview answer is in
[DESIGN.md](DESIGN.md).