# Gate 2 evidence (real DeepSeek Harness, 2026-10-26)

Runtime: `deepseek-harness-sdk==0.2.1rc2` + npm `@deepseek-ai/dsh@0.2.1-rc.2`
(the bundled Windows wheel has the `koffi` path bug documented in `gate0.md`).

## E2a: real task creates a file and streams tools

- Run `r-5e1ff87a56be`, session `s-974208718019`
- State: `completed`, finish reason `completed`
- File `work-local/gate2.txt` exists with contents `OK\n`
- 13 Tether events, 29 dsh events
- Tool calls observed:
  - `pwsh` with `echo OK > gate2.txt` → exit 0
  - `read` on the absolute path → returned `1: OK`
- Final answer: "Command run (via the PowerShell tool …). Contents of `gate2.txt`: `OK`"

## E2b: second run resumes the same harness session

- Run `r-60dad16e4ad9`, same session `s-974208718019`
- Outcome `dsh_session=tether-s-974208718019` (same as E2a)
- Prompt explicitly said "Without reading the file again"; final answer:
  "Based on the read I already did, gate2.txt contained the single line `OK`."
- 3 Tether events; no tool call, proving context came from the resumed session.

## E5: real hard cancel and process-tree residue

- Run `r-1d5cf39046c0`, session `s-b803606245d4`
- Prompt: run `python -c "import time; time.sleep(120)"` through `pwsh`
- `POST /cancel` → `cancelling` → terminal `cancelled` in 5.4s
- Process tree **before** cancel (6 processes):
  `python(agent) → node(dsh) → node(subprocess runner) → node(sandbox runner) → pwsh → python(sleep 120)`
- Process tree **after** cancel (1 process): the agent itself only
- Residual `python.exe` / `pwsh.exe` / `node.exe` descendants: **0**
- Raw JSON: `evidence/cancel_probe.json`

## UI verification

- Desktop: `http://127.0.0.1:18890` — runs list, state badges, tool cards,
  thought cards, final answer, ack seq.
- Local node console: `http://127.0.0.1:18893` — same events from the node's
  own outbox, read-only; served only on loopback.
- Both pages were opened and inspected in the browser; the event cards show
  `read · <path>`, `result · …`, `thought`, and `assistant` correctly.

## Transport reachability (Tailscale)

- Desktop Tailscale: `100.x.x.x` (`qi001007@`, windows), service started with `tailscale up`.
- Controller listens on `0.0.0.0:18890`; local `/api/state` returns 200.
- `http://100.x.x.x:18890/api/state` returns 403: the human UI/API is
  loopback-only; only `/ws/node` is exposed to the tailnet.
- A test node with `--controller ws://100.x.x.x:18890/ws/node --device TAILSCALE-TEST`
  registered as online, proving the WSS path works over Tailscale.
- The laptop has not joined the tailnet yet; Gate 3 remains.

## Known limitation

- Approval UI is `Designed, not implemented`: SDK 0.2.1rc2 lacks the
  `approval_requests` handshake (master docs have it, the wheel does not).
- Linux/WSL and laptop (Gate 3) are not verified yet.