# Tether

> DeepSeek Harness stays the Agent. Tether is the plugin and MCP tool that let it work on other machines.

A multi-device Agent Harness client. You work inside the **DeepSeek Harness desktop
app**: a native DSH client plugin adds a Tether page for the target DSH workspace/session tree, a filesystem tree, devices, permissions and live native sessions; the same control plane also exposes seven MCP tools, so
the DeepSeek Agent can delegate a task to another computer. The target machine runs
its own Harness Agent with its own files, shell, and model key.

Repo: https://github.com/qi001007/tether-harness

```
DeepSeek Harness desktop app (Agent + Tether plugin page + MCP tools)
        │  client plugin: loopback HTTP        │ MCP stdio
        ▼                                      ▼
Tether Controller (FastAPI + SQLite) ◄──── Tether MCP server
        │ outbound WSS + token (Tailscale / LAN)
        ├──► Node DESKTOP-LOCAL → dsh + OS file service + policy/audit
        └──► Node LAPTOP-01    → dsh + OS file service + policy/audit
```

The Tether plugin page is the **remote DSH workspace/session browser**; local conversation stays in DSH's own chat, while the page mirrors native remote transcripts and can start new native sessions on the target. Tether does not replace DSH memory, skills, or marketplace.

## What is verified

| Claim | Evidence |
|---|---|
| DeepSeek Harness desktop Agent calls Tether itself | In the official desktop app, the Agent called `list_peers` and returned the paired devices with online flags |
| Agent-to-Agent delegation | The desktop Agent called `remote_task` for `LAPTOP-01`; the laptop created `D:\tether-node\work\tether-delegated.txt` with `OK` |
| Same harness session on the target | A second read-only verification run reused `dsh_session=tether-s-d0332f33ad47` |
| Real dsh writes/reads files | `tether-delegated.txt` is 2 bytes, bytes `4F 4B`, no BOM/newline |
| Cancel leaves no residual tree | before: dsh → sandbox → pwsh → python (6 procs); after: only the node daemon (0 residual) |
| Network drop does not lose events | 8s socket drop; events buffered in the node outbox; 13 events, contiguous `seq`, no duplicates |
| Idempotent submission | same `request_id` + content returns the first run; different content returns 409 |
| Node crash is not a false failure | run becomes `unknown`; never auto-reruns; `reconcile` reports the node ledger |
| Cross-machine over Tailscale | `LAPTOP-01` registered and executed over `100.x`; controller UI/API stays loopback-only |
| DSH plugin installs and renders | Clean remove/reinstall via `desktop/install-plugin.ps1`; sidebar `Tether`; device/project/file/task page renders |
| Existing DSH workspace is writable in readonly mode | `default-workspace` write resolves to `D:\DeepSeek harness\workspace`; audit records `intent` + `result` |
| Readonly really blocks outside writes | `C:\Users\...\Documents\tether-full-test.txt` → HTTP 400 `path outside allowed roots` |
| Full-disk mode is explicit and still guards the OS | `mode=full` allowed the same write; `C:\Windows\...` stayed denied; `.dsh/.credentials.yaml` unreadable |
| Delete is recoverable | delete moved the file to `D:\TetherWorkspaces\.tether-trash\<timestamp>-<name>` |
| Native DSH conversation mirror | `session.v4.jsonl.zstd` parsed into 2 turns / 8 blocks; page shows the same title, reasoning, tool calls and answer |
| Tether task becomes a native DSH session | run `r-00aac51ff0ac` → `tether-s-91e5ba584d36` in target `~/.dsh/sessions`; attached to the demo workspace registry |
| One workspace tree | `/workspaces` + native sessions merged by `cwd`; `DSH`/`Tether` are badges, not separate sections |
| File tree | workspace paths + C:/D:/E: drives load lazily; `hello.txt` opens in the editor |
| Plugin live task + cancel | run `r-f358e95993e9`: first event in 1261 ms; cancel → `cancelled` |
| New project location | `demo` created under `D:\TetherWorkspaces\demo`; node workspace and DSH workspace unchanged |

Screenshots: `docs/screenshots/dsh-plugin-workspaces.png`,
`docs/screenshots/dsh-plugin-native-chat.png`,
`docs/screenshots/dsh-plugin-dark.png`,
`docs/screenshots/dsh-plugin-files.png`,
`docs/screenshots/dsh-plugin-permissions.png`,
`docs/screenshots/deepseek-desktop.png`,
`docs/screenshots/deepseek-after-tether.png`,
`docs/screenshots/deepseek-delegated.png`.
Raw notes: `evidence/gate0.md`, `evidence/gate2.md`,
`evidence/dsh_plugin_fs.md`, `evidence/cancel_probe.json`.

## Quick start (DSH plugin + MCP)

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

# 2) Install the Tether client plugin into the DSH desktop profile
#    (close the DeepSeek app first; it rewrites profile files on exit)
.\desktop\install-plugin.ps1
# then start DeepSeek Harness and click "Tether" in the sidebar

# 3) Optional: add Tether MCP so the DSH Agent can delegate tasks
.\desktop\install-mcp.ps1
# restart DeepSeek Harness, then ask its Agent:
#    用 Tether 列出当前已接入的设备
#    让 LAPTOP-01 的 Agent 在 D:/tether-node/work 建一个文件并读回来
```

`install-plugin.ps1` only appends `tether-dsh-plugin` to
`~/.dsh/profiles/desktop/package.json` and installs its two packages. It does not
touch the other bundles or `cordis.patch.yml`; removing the package restores the
original DSH boot.

The desktop app keeps its own memory/plugins. Tether MCP adds these tools:

- `list_peers`
- `remote_task(device, prompt)`
- `remote_status(run_id)`
- `remote_cancel(run_id)`
- `remote_workspaces(device)`
- `remote_files(device, path, op, text?, dest?)` — list/read/write/mkdir/rename/delete
  under the target node's policy
- `remote_audit(device, limit)`

## The DSH plugin page

The sidebar entry opens a native client page (no iframe, no second web app):

- **Workspaces**: one tree, not a Tether-vs-DSH split. It merges
  `~/.dsh/storages/workspace.json`, projects under `D:\TetherWorkspaces`, and
  native sessions by `cwd`; each workspace expands to its sessions. A tiny
  `DSH`/`Tether` badge records where a workspace/session came from, but both live
  in the same workspace. The `+` in the panel header creates a workspace under
  `D:\TetherWorkspaces` and registers it in the target DSH workspace store; the
  `+` on a workspace starts a new session. DSH keeps its workspace list in
  memory, so restart/reopen DSH if a newly created workspace is not visible in
  its own sidebar yet (the workspace.json entry is already written).
- **Conversation**: native DSH transcripts read from
  `~/.dsh/sessions/**/session.vN.jsonl.zstd`: user messages, a collapsible process
  group with reasoning/tool rows, and the final answer. Turn chrome and typography
  are copied from `ui-chat`: the completed row is 33px with a 0.5px bottom rule,
  reads `已完成，用时 N秒`, and carries a 14px chevron; prose is 14/24 with a 16px
  block rhythm, 600 strong, and 0.8em inline-code chips. A running turn instead
  ends with `深度求索中，用时 N秒 ···`, the whale icon, and the 1.5s mask shimmer.
  Existing sessions are read-only; sending from the composer starts a **new
  native DSH session** in the selected workspace through the target's SDK (under
  the target `~/.dsh`), so it appears in the target DSH and in this tree. Writing
  into an existing native session still needs a DSH Host proxy and is Designed.
- **Files**: a lazy file tree in the sidebar. Roots are the known workspaces and
  this PC's drives (`C:`, `D:`, ...); directories load on expand and files open
  in the editor. Read follows the target policy; writes/mkdir/rename/delete are
  refused in readonly/locked mode.
- **Devices**: online state, platform, agents, workspace. Click a device to switch.
- **Permissions**: readonly / locked / full-disk, editable writable roots, and the
  last 80 audit entries.

The left side uses a VSCode-style fixed activity bar: workspaces, files and
devices are separate panels. Its glyphs are DSH's own 16px/1px artwork
(`workspace-tree`, `folder-open`, `globe`, `plus`, `chevron`), not a parallel
icon style. Clicking the active icon or the chevron collapses
the panel; the bar stays. The panel width is draggable, double-click resets, and
the active panel and width are stored in `localStorage`.

The surface follows six visual rules: hierarchy comes from background layers
(base / sidebar / hover / active), not 1px frames; dark mode uses thinner text
weights; assistant replies/tool cards fade in with an ink-like blur; times,
steps and token counts use tabular numerals; drag handles respond on hover and
reset with a short spring; buttons/rows compress on press. Colors come from DSH
theme tokens, so light and dark follow the app.

The native reader only reads existing DSH logs; new Tether tasks run through the
target's SDK in the target DSH home and workspace, so they are native sessions
and are attached to the workspace registry. Existing native sessions are never
written or put under a second writer. The reader defaults to `~/.dsh`; set
`TETHER_NATIVE_DSH_HOME` if needed. It requires `zstandard`, installed by
`pip install -e .`.

### File policy

- **readonly (default)**: all disks readable; writes allowed only under
  `D:\TetherWorkspaces`, the node workspace, and existing DSH workspaces.
- **locked**: everything readable, every write/mkdir/rename/delete denied; used to
  hand over a read-only live machine temporarily.
- **full**: explicit opt-in in the permissions drawer, with a confirmation dialog.
  Writes are still refused under Windows/Program Files/ProgramData, `.ssh`,
  `.dsh`, `.aws`, `.config`, and `AppData`; `.dsh/.credentials.yaml` is unreadable.
- **delete** moves to `D:\TetherWorkspaces\.tether-trash\<time>-<name>` instead of
  erasing.
- Every write/delete/policy change is audited on the node before and after the
  operation (`phase=intent` / `result`).

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

Existing nodes must be updated to the current `tether/node/` code (copy the repo
over `C:\tether-node\app` and restart `tether-node.ps1`) to get the filesystem
service, policy and audit. New projects default to `D:\TetherWorkspaces`; override
with `TETHER_WORKSPACES_ROOT` before starting the node.

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
- **Thin client**: the plugin page talks to the controller over loopback HTTP with
  CORS allowlisted to the `dsh-app://app` origin; the planned `@Remote` host service is not implemented yet. The controller
  strips `/api` from the tailnet and keeps the node token server-side.
- **v0.1 topology**: one controller, multiple nodes; the desktop is the initiator,
  the laptop is a controlled node. The target peer-to-peer Agent network is in
  `DESIGN.md` §9 and is **not implemented**.
- **Verified**: real dsh execution, MCP delegation, session continuation, event
  replay, idempotency, `unknown`, hard cancel with 0 residual, Tailscale, DSH
  plugin install/render, file policy/audit, recoverable delete.
- **Designed / not implemented**: symmetric peer Agents (every device initiates),
  approval UI (the pinned SDK wheel lacks the handshake), multi-task concurrency,
  Linux/WSL, public relay, production auth, full Host Remote proxy, and a
  target-DSH project/session/chat mirror (the plugin currently shows Tether
  projects and Tether run events).

## Repository layout

```
tether/
  mcp_server.py    MCP tools the Agent calls (list_peers/remote_task/...)
  controller/      FastAPI API, SSE, device/run/event store, fs proxy
  node/            WSS, outbox, dsh adapter, fs_service (policy/audit), console
  static/          optional monitor UI
  scripts/up.py    control plane + local node + monitor window
  desktop/         plugin/MCP installers, app launcher, Tailscale/LAN helpers
  laptop/          bootstrap + node scripts (no inbound port)
  evidence/        measured results
packages/
  dsh-plugin-tether/         DSH bundle + cordis patch
  dsh-plugin-tether-client/  native DSH client page (workspaces/files/devices)
```

MIT licensed. Full design: [DESIGN.md](DESIGN.md). Reviewer path:
[REVIEWER_GUIDE.md](REVIEWER_GUIDE.md). Demo script:
[VIDEO_SCRIPT.md](VIDEO_SCRIPT.md).