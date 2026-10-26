# Reviewer guide (10 minutes)

This file is for an AI or human reviewer who wants to decide whether the claims in
`DESIGN.md` are backed by code and measurements.

## Read in this order

1. `DESIGN.md` §0.3 — current implementation vs target architecture. Do not read
   the peer-to-peer section as implemented; it is explicitly v0.2.
2. `DESIGN.md` §3 — the star topology and why the Node exists.
3. `DESIGN.md` §5 — event journal, idempotency, `unknown`, hard cancel.
4. `DESIGN.md` §8 — the measured results.
5. `evidence/gate2.md` and `evidence/cancel_probe.json` — raw numbers.
6. Code: `tether/controller/store.py`, `tether/node/dsh_adapter.py`,
   `tether/static/index.html`.

## Claim → evidence map

| Claim | Where to check |
|---|---|
| Real dsh executes on the target machine | `evidence/gate2.md` E2a; `work-local/gate2.txt`; tool events in the transcript |
| Session continuation | `evidence/gate2.md` E2b; same `dsh_session` in both Run outcomes |
| Cancel leaves no descendants | `evidence/cancel_probe.json`: `tree_before` 6 procs, `tree_after` 1, `residual_count: 0` |
| Network drop does not lose events | `evidence/gate2.md` transport section; controller `add_event`/`set_ack` in `store.py` |
| Idempotent submission | `tests` not present yet; verified via API: same `request_id` → one Run, different content → 409 |
| Node crash is not a false failure | `mark_device_unknown` in `store.py`; `unknown` never auto-retries |
| Cross-machine execution | `evidence/gate2.md` E6/cross-machine; `LAPTOP-01` created `D:\tether-node\work\laptop-proof.txt` |
| DeepSeek desktop Agent calls Tether | `docs/screenshots/deepseek-delegated.png`; run `r-56ca1f58b1a3` + verify run `r-8fa5928462a6`; file `D:\tether-node\work\tether-delegated.txt` |
| Agent-to-Agent delegation | same screenshot; the desktop Agent called `mcp__tether__remote_task` for `LAPTOP-01`; target session `tether-s-d0332f33ad47` |
| Tether MCP server | `tether/mcp_server.py`; `desktop/install-mcp.ps1`; profile entry in `~/.dsh/profiles/desktop/cordis.patch.yml` |
| Tether window is a monitor | `tether/static/index.html`; the Agent interaction is in DeepSeek Harness desktop |
| One-command control plane | `desktop/tether-app.ps1` + `scripts/up.py` |
| dsh Windows wheel bug | `evidence/gate0.md`; `tether/node/dsh_adapter.py:npm_launch_args()` |
| SDK has no session/cancel | `deepseek-harness-sdk==0.2.1rc2` protocol only has prompt/resume/wait; hard cancel documented in `DESIGN.md` §5.3 |

## Verified / Designed / Not implemented

- **Verified**: DeepSeek Harness desktop Agent calling Tether MCP, Agent-to-Agent
  delegation, star controller/node, real dsh, session resume, event replay,
  idempotency, `unknown`, hard cancel with 0 residual, Tailscale cross-machine,
  control plane app, monitor UI.
- **Designed**: symmetric peer Agent network (every device same package, two-way
  delegation), approval UI, capability routing, Linux/WSL, public relay,
  multi-task concurrency.
- **Not implemented**: the Designed list; production authentication/audit/sandbox.

## Questions a reviewer may ask

**Why a star instead of peer-to-peer?**
The exam asks for a client that can operate other machines' harnesses; the star is
the smallest reliable slice. The target peer architecture is in `DESIGN.md` §9,
including the exact changes (multi-controller node, peer registry/pairing, local
Agent tools). The current code already models Device/Session/Run/Event, so the
reliability core is reusable.

**Why not make Tether the chat UI?**
DeepSeek Harness already owns the Agent surface: memory, skills, plugin marketplace,
approval UI, model settings. Tether cannot and should not replicate those. Tether
exposes four MCP tools and the reliability/routing layer; the Tether web UI is a
monitor for devices/tasks/events.

**Why the Python SDK rather than ACP?**
The SDK is the supported high-level API for session/events/resume. ACP would
require a handwritten client and a second protocol surface. ACP is the v0.2
adapter path for Qoder/Codex/Claude Code.

**Why is cancel hard?**
The pinned SDK wheel has no `session/cancel` and `Session.run()` blocks until
idle. We close the runtime, terminate the process tree, mark `cancelled` or
`unknown`, and repair the interrupted turn with `resume_session`. The document
does not claim cooperative cancel.

**Why npm dsh?**
The SDK's bundled Windows wheel resolves `koffi.node` to the build path
`E:\snapshot\node\...` and fails every turn. The npm package ships the native
module; `_launch_args` points the same Python SDK at it. Evidence: `gate0.md`.

**Is this production secure?**
No. It uses a demo node token, Tailscale/LAN, loopback-only UI/API, and model keys
only on the node. Production needs per-device pairing, revocation, audit, WSS/mTLS.
The gaps are in `DESIGN.md` §7.3.

## Run it

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
npm install --prefix .runtime\npm @deepseek-ai/dsh@0.2.1-rc.2
Copy-Item .env.example .env   # fill DEEPSEEK_API_KEY
.\desktop\tether-app.ps1
```

Install the official DeepSeek Harness desktop app from
https://www.deepseek.com/harness/ . Close it, then run `.\desktop\install-mcp.ps1`
and restart the app. In the DeepSeek chat, ask: "用 Tether 列出当前已接入的设备".

Laptop: `.\laptop\bootstrap-node.ps1`, fill `.env`, `.\laptop\tether-node.ps1`.

## Honesty rules used here

- Every "verified" claim has a script or measured JSON.
- Every "designed" claim is labeled as such, even if the design is detailed.
- No fake screenshots or edited task output.
- The known limitations are in `DESIGN.md` §10, not hidden in a footnote.