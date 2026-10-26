# Reviewer guide (10 minutes)

This file is for an AI or human reviewer who wants to decide whether the claims in
`DESIGN.md` are backed by code and measurements.

## Read in this order

1. `DESIGN.md` §0.3 — current implementation vs target architecture. Do not read
   the peer-to-peer section as implemented; it is explicitly v0.2.
2. `DESIGN.md` §3 — the star topology and why the Node exists.
3. `DESIGN.md` §6.2 — the DSH client plugin (slots, layout, data sources).
4. `DESIGN.md` §5 — event journal, idempotency, `unknown`, hard cancel.
5. `DESIGN.md` §7.4 — file policy, protected paths, audit, recoverable delete.
6. `DESIGN.md` §8 — the measured results.
7. `evidence/gate2.md`, `evidence/dsh_plugin_fs.md`, `evidence/cancel_probe.json`.
8. Code: `tether/controller/store.py`, `tether/node/fs_service.py`,
   `tether/node/dsh_sessions.py`, `tether/node/dsh_adapter.py`,
   `packages/dsh-plugin-tether-client/lib/client.js`; tests in
   `tests/test_dsh_sessions.py` and `tests/test_fs_service.py`.

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
| DSH plugin installs without touching other bundles | `~/.dsh/profiles/desktop/package.json` bundles list; `desktop/install-plugin.ps1`; screenshot `dsh-plugin-native-chat.png` |
| Sidebar follows the VSCode contract | `ActivityBar`/`SidePanel` in `client.js`: fixed bar, three switchable panels, active-icon/chevron collapse, draggable panel and file-list boundaries, widths/panel in `localStorage` |
| Sidebar icons are the host's artwork | `GLYPHS` copies `ui-primitives/src/icons/artwork.ts` paths (`workspace-tree-outline`, `folder-open`, `folder-close`, `globe-outline`, 16px grid, 1px stroke); screenshot `dsh-plugin-workspaces.png` |
| Turn chrome matches `ui-chat` | `.tether-turn-head` is 33px with a 0.5px `border-l2`; label `已完成，用时 N秒` + 14px chevron; `.tether-md` 14/24 with 16px block gap; screenshot `dsh-plugin-native-turn.png` |
| Running state uses the native shimmer | `.tether-running` + `.tether-shimmer` (whale icon, 1.5s mask sweep); a real 6s run showed `深度求索中，用时 1秒 ···` and completed at 9秒; screenshot `dsh-plugin-streaming.png` |
| Surfaces use background layers, not frames | computed `border*Width` of `.tether-root *` is 0; colors come from `--dsw-*` theme tokens; dark mode lowers weights 600→500 / 400→350 |
| Reply/digit/drag motion | `.tether-ink` animation, `.tether-num` tabular numerals, resizer active line + 180ms reset transition |
| Plugin page is native, not iframe | `packages/dsh-plugin-tether-client/lib/client.js` uses `__ModuleLoader__` + `ctx.slots.inject('main' / 'sidebar.panellist')` |
| Native DSH conversation is mirrored | `tether/node/dsh_sessions.py` parses `~/.dsh/sessions/**/session.v4.jsonl.zstd`; `tests/test_dsh_sessions.py`; screenshot `dsh-plugin-native-chat.png` |
| Tether tasks become native DSH sessions | run `r-00aac51ff0ac` → native `tether-s-91e5ba584d36` under target `~/.dsh/sessions`; `attach_session` adds it to `~/.dsh/storages/workspace.json` |
| Workspaces are one tree, not two categories | `workspaceNodes` merges `/workspaces` and `/dsh/sessions` by cwd; source badges only; screenshot `dsh-plugin-workspaces.png` |
| File tree covers workspaces and drives | `FileTree` + `/fs/list` + `/drives`; screenshot `dsh-plugin-files.png` |
| Reasoning/tool events are rendered, not dumped | `build_transcript()` maps `reasoning`, `tool-call`, `tool/result`; the page shows collapsible think rows and tool cards |
| Existing DSH workspace writable in readonly | `evidence/dsh_plugin_fs.md`; audit rows for `default-workspace` |
| Readonly blocks outside writes | HTTP 400 `path outside allowed roots` in `evidence/dsh_plugin_fs.md` |
| Full mode still guards OS/credentials | `C:\Windows` write and `.dsh/.credentials.yaml` read both HTTP 400 |
| Delete is recoverable | `.tether-trash` path in `evidence/dsh_plugin_fs.md` |
| Plugin task stream and cancel | run `r-f358e95993e9`; first event 1261 ms; terminal `cancelled` |
| Tether MCP server | `tether/mcp_server.py`; `desktop/install-mcp.ps1`; profile entry in `~/.dsh/profiles/desktop/cordis.patch.yml` |
| Tether window is a monitor | `tether/static/index.html`; the Agent interaction is in DeepSeek Harness desktop |
| One-command control plane | `desktop/tether-app.ps1` + `scripts/up.py` |
| dsh Windows wheel bug | `evidence/gate0.md`; `tether/node/dsh_adapter.py:npm_launch_args()` |
| SDK has no session/cancel | `deepseek-harness-sdk==0.2.1rc2` protocol only has prompt/resume/wait; hard cancel documented in `DESIGN.md` §5.3 |

## Verified / Designed / Not implemented

- **Verified**: DSH plugin install/render, unified workspace/session tree, lazy
  workspace+drive file tree, native DSH conversation mirror, new Tether tasks
  written as native DSH sessions under the target home/workspace, three-level
  file policy with audit, recoverable delete, DeepSeek Harness desktop Agent
  calling Tether MCP, Agent-to-Agent delegation, star controller/node, real dsh,
  session resume, event replay, idempotency, `unknown`, hard cancel with 0
  residual, Tailscale cross-machine, control plane app, monitor UI.
- **Designed**: write-back into an **existing** native DSH session
  (`session/prompt` host proxy), symmetric peer Agent network (every device same
  package, two-way delegation), `@Remote` host service for the plugin, approval
  UI, capability routing, Linux/WSL, public relay, multi-task concurrency.
- **Not implemented**: the Designed list; production authentication/audit/sandbox;
  the laptop node still runs the previous build without `fs` or the native reader.

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
exposes a DSH client page for remote workspaces plus seven MCP tools; the Tether web
UI is only a monitor.

**Did you copy DSH's UI source?**
The page is a native DSH client plugin using the same slot system
(`main`, `sidebar.panellist`) and the same visual language (fonts, gray scale,
8px radii). It does not literally import DSH's internal chat components: a client
bundle may only require `PLATFORM_MODULES` (`react`, slot/layout services, etc.),
and copying router/global-store components would create a second app. There is no
iframe and no custom chat; the layout is reimplemented against the same tokens.

**Is the native conversation a copy or a live mirror?**
Existing native sessions are a live, read-only mirror: `dsh_sessions.py`
decompresses the target's `session.vN.jsonl.zstd` log and the page polls it every
1.5 s, rebuilding reasoning/tool/answer blocks. It never appends to an existing
session or competes for its writer. Sending from the composer starts a **new**
native DSH session through the target SDK in the target `~/.dsh` and the chosen
workspace; it is attached to the workspace registry, so the target DSH and this
tree show it in the same place. Writing into an **existing** DSH session
(`session/prompt` host proxy) is Designed.

**Why does the plugin call 127.0.0.1:18890 instead of a Host Remote?**
v0.1 keeps the controller loopback-only and adds CORS for the `dsh-app://app`
origin; the client never sees the node token. The `@Remote` host service is the
cleaner v0.2 path (typed RPC, no CORS) and is listed as Designed.

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