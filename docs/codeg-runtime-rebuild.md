# Codeg Agents runtime rebuild

Tether maintains its internal fork of the Codeg `v0.42.0` web frontend directly under `third_party/codeg/` (upstream base commit `e3171d69d208bdf37697b15e8b14f8c9b70825bf`, Apache-2.0, see `third_party/codeg/THIRD_PARTY_ORIGIN.json`). All Tether customizations — including the native-styled `智能体` view (`tether-agent-home.tsx`), sidebar & bottom-left quick-actions navigation (`智能体` / `自动化` / `待办任务`), unified built-in `TetherFolderPickDialog` routing (`tether-folder-pick.ts`, `platform.ts`, `use-composer-attachments.ts`, `workspace-folder-dialog.tsx`), token-session integration, and per-project Herdr/CLI entry — live directly as owned source files under `third_party/codeg/`.

## Local & CI build

Use Node `24.12.0`+ and the pnpm version declared in `third_party/codeg/package.json`:

```powershell
Push-Location third_party/codeg
corepack pnpm install --frozen-lockfile
Pop-Location
pwsh -File ./scripts/build_codeg_runtime.ps1
```

Pass `-ExportDirectory <fresh-dir>` in CI to export into an isolated staging directory without mutating `tether/node/bin/agents-runtime/web/`. Without `-ExportDirectory` on Windows, the script cleans `out/` and `.next/`, runs `next build`, verifies `index.html`, `login.html`, and `workspace.html`, mirrors the export cleanly into `tether/node/bin/agents-runtime/web/` (removing stale hashed chunks), restores `token.html` from [tether/node/agents-runtime-token.html](../tether/node/agents-runtime-token.html), and stamps `tether-build.json` + `<meta name="tether-codeg-build">` with a deterministic build ID.

## Linux server binary

On Linux x86_64, if the packaged runtime directory is absent or incomplete, the first start schedules a single background install and returns `installing:true` immediately so the Hub's 20-second file-system request deadline is not held by a large download. Agents polls status for up to five minutes and reports an installation error or timeout. A later explicit start retries a failed install; status polling alone does not. The installer downloads the official Codeg `v0.42.0` archive from [GitHub Releases](https://github.com/xintaofei/codeg/releases/download/v0.42.0/codeg-server-linux-x64.tar.gz), verifies size `77,466,977` and SHA-256 `35928d4b93b5fc65bfc4d330f4d653c738af0b033307cf9d59173539d49bf679`, and extracts only the exact `codeg-server`, `codeg-mcp`, and `codeg-computer-helper` executable members. A completed download is cached until installation succeeds; incomplete downloads are discarded, so a retry does not accept a partial archive. The three executables are staged together and published by directory rename. The installed files are `<node-data-dir>/agents-runtime-linux/bin/`; bundled Tether web assets remain the runtime's `CODEG_STATIC_DIR`.

## `deepseek-acp` optional MCP patch

`tether/node/agents_runtime.py` manages `deepseek-acp@0.11.0` inside `agent_home()` and deterministically applies patch revision `tether-mcp-optional-v1` (`failOnStartupError: false` in `lib/mcp/spec.js`, recorded in `.tether-patch.json`) so optional broken user MCP entries (such as a failing `github` MCP in `~/.dsh/mcp.json`) degrade gracefully instead of aborting every ACP `session/new` call. Tether never edits the user's `~/.dsh/mcp.json` or splits `DSH_HOME`.
