# DSH plugin + filesystem policy evidence (2026-10-27)

Environment: DeepSeek Harness desktop `0.2.1-rc.3`, Tether plugin installed into
`~/.dsh/profiles/desktop` via `desktop/install-plugin.ps1`; controller and node
run from this repo (`.venv`).

## Plugin

- Clean install (remove, then `desktop/install-plugin.ps1`):
  - profile `bundles` = `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`,
    `tether-dsh-plugin` (no other bundle changed)
  - the first broken attempt left a stale `node_modules/tether-dsh-plugin/lib/client.js`
    with `dsh.client`; the loader then reported
    `duplicate factory registration for "tether"`. Removing the package and
    reinstalling from source fixed it. The bundle package now has no `dsh.client`;
    the client lives in `tether-dsh-client`.
- After restart: sidebar button `aria-label="Tether"` exists; clicking it renders:
  - devices: `DESKTOP-LOCAL` (local, online), `LAPTOP-01` (online), `TAILSCALE-TEST` (offline)
  - projects: `default-workspace` (DSH), `demo` (Tether root), `Tether 工作目录` (node workspace)
  - files, task list, event stream, permission drawer
- Screenshots: `docs/screenshots/dsh-plugin-native-chat.png`,
  `dsh-plugin-files.png`, `dsh-plugin-run-chat.png`, `dsh-plugin-permissions.png`.

## Filesystem API checks

All calls went through `POST /api/devices/DESKTOP-LOCAL/fs/<op>`; the controller
forwarded them over the node WebSocket and waited for `fs_result`.

| Check | Request | Result |
|---|---|---|
| mkdir in new-project root | `mkdir D:/TetherWorkspaces/demo` | `{"path":"D:\\TetherWorkspaces\\demo"}` |
| write + read | write `hello.txt` `"hello tether\n"` | 13 bytes; read returns the same text |
| list | `list D:/TetherWorkspaces/demo` | `hello.txt`, 13 B, `writable: true` |
| readonly write outside roots | write `C:/Users/Administrator/Documents/tether-full-test.txt` | HTTP 400, `read-only: path outside allowed roots` |
| existing DSH workspace in readonly | write `.../Documents/deepseek-harness/default-workspace/tether-plugin-check.txt` | allowed; resolves to `D:\DeepSeek harness\workspace` |
| delete | delete the same file | moved to `D:\TetherWorkspaces\.tether-trash\20261027-023528-tether-plugin-check.txt` |
| enable full disk | `POST /policy {"mode":"full"}` | mode `full` |
| locked mode | `POST /policy {"mode":"locked"}` | write inside `D:\TetherWorkspaces` → 400 `writes disabled (locked policy)` |
| full-disk write outside roots | write `C:/Users/Administrator/Documents/tether-full-test.txt` | allowed, 9 bytes |
| protected system path | write `C:/Windows/tether-should-fail.txt` | HTTP 400, `protected system path: C:\Windows` |
| credential read | read `C:/Users/Administrator/.dsh/.credentials.yaml` | HTTP 400, `credential store is protected` |
| restore policy | `POST /policy {"mode":"readonly"}` | mode `readonly` |

Audit (`GET /api/devices/DESKTOP-LOCAL/audit`) contains both `intent` and
`result` rows for writes/deletes; denied rows include the reason. Files:
`E:\遥望科技实习项目\tether\.runtime\policy.json` and `audit.jsonl` (node-side,
authoritative); the controller only proxies.

## Task stream / cancel through the plugin UI

- Agent was temporarily `--agent fake` for this check (no model tokens).
- Prompt `slow plugin ui test`, run `r-f358e95993e9`:
  - first event (`assistant: fake adapter started`) visible **1261 ms** after
    clicking Start (UI poll interval 1.2 s; target < 2 s)
  - events were contiguous: `1 assistant`, `2 log`, `3 log`
  - Cancel → controller state `cancelling` → node state `cancelled`
    (`finish_reason=cancelled`)
- The UI's task list is filtered by the selected workspace; legacy sessions
  created with a relative workspace (`work-local`) are matched by basename.

## Native DSH conversation mirror

- Source: `C:/Users/Administrator/.dsh/sessions/--C-Users-Administrator-Documents-deepseek-harness-default-workspace--/session-d49909ca-d5c5-4e23-ad37-116cb258bcff/session.v4.jsonl.zstd`
- `DshSessionStore` decompresses all zstd frames (107,980 bytes, 52 events) and
  builds a transcript with title `Tether 查看在线设备`, 2 turns, 8
  reasoning/tool/text blocks (3 + 5), status `completed`.
- The page renders the same data as DSH: right-aligned user bubble, collapsed
  "思考" rows, `mcp__tether__list_peers` / `mcp__tether__remote_task` tool cards,
  the final answer and a 2-step turn footer.
- `tests/test_dsh_sessions.py` covers user-message filtering, tool/result linking,
  run status and the live `assistant/attempt` stream.
- Screenshots: `docs/screenshots/dsh-plugin-native-chat.png`,
  `docs/screenshots/dsh-plugin-run-chat.png`,
  `docs/screenshots/dsh-plugin-laptop-chat.png`.
- The native log is read-only. The composer starts a new Tether run in the same
  workspace; native write-back (`session/prompt`) is Designed.

## Visual system checks

- With the DSH light and dark themes, `getComputedStyle` over every element inside
  `.tether-root` reports `border*Width = 0`; hierarchy is background layers
  (`--dsw-alias-bg-base`, `--dsw-specific-sidebar-fill`,
  `--dsw-alias-interactive-bg-hover/active`).
- Dark (`body[data-ds-dark-theme]`): root background `rgb(21,21,23)`, panel
  `rgb(27,27,28)`, root font weight `350`, strong labels `500`.
- `.tether-ink` exists on reasoning/tool/reply blocks and
  `document.getAnimations()` reports the fade/blur animation; `prefers-reduced-motion`
  disables it.
- `.tether-num` computes `font-variant-numeric: tabular-nums` and
  `font-feature-settings: "tnum"`.
- Sidebar and file-list drag handles show an accent line on hover/active; width
  has no transition during drag and a 180 ms spring on reset.

## MCP file tools

`tether.mcp_server` now exposes 7 tools; calling `remote_workspaces("DESKTOP-LOCAL")`
returned the same 3 projects as the plugin, and
`remote_files("DESKTOP-LOCAL", "D:/TetherWorkspaces/demo", "list")` returned
`hello.txt` (30 B, writable). The MCP layer uses the same controller/Node policy,
so it cannot bypass readonly/locked.

## Known limitation

- The plugin client calls the controller at `http://127.0.0.1:18890` with CORS
  allowlisted to `dsh-app://app`; the planned `@Remote` host service is not
  implemented yet. The controller API remains loopback-only, and the controller
  never exposes the node token.
  - `Origin: dsh-app://app` → `access-control-allow-origin: dsh-app://app`
  - `Origin: https://evil.example` → 200 without `access-control-allow-origin`
    (browser blocks the response)
  - preflight `OPTIONS` from `dsh-app://app` returns `allow-methods: GET, POST`
- `LAPTOP-01` still runs the previous node build (no `fs` capability); its files
  and new projects require updating `C:\tether-node\app` and restarting the
  node. Task delegation over Tailscale is unaffected.
