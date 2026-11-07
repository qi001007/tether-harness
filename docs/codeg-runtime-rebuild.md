# Codeg Agents runtime rebuild

Start from a clean checkout of Codeg `v0.42.0` at commit `e3171d69d208bdf37697b15e8b14f8c9b70825bf`. The complete source patch includes the embedded Agents home, token-session integration, saved conversation behavior, OpenCode version rule, and per-project Herdr entry. [Tether Codeg patch](../tether/node/agents-runtime-codeg.patch)

Place the checkout at `.runtime/codeg-source`. Use Node `24.12.0` and the pnpm version declared by Codeg. Run the following from the Tether repository root.

```powershell
Push-Location .runtime/codeg-source
corepack pnpm install --frozen-lockfile
Pop-Location
pwsh -File ./scripts/build_codeg_runtime.ps1 -ExportDirectory .runtime/codeg-built
```

The script verifies the package version and Git revision, applies the patch once, builds the export, checks the required pages, and copies the export into a new directory. It restores `token.html` from the tracked [Tether token bridge](../tether/node/agents-runtime-token.html), which transfers the query token into Codeg local storage before redirecting. The APP gateway maps the Agents route to the export root.

The release workflow rebuilds this export on Linux and uses it as the only Codeg web directory in the Windows packaging job. A push to `release-candidate/vX.Y.Z` stores verified signed packages as an Actions artifact. The draft-release step runs on a version tag or manual main dispatch.

## Linux server binary

On Linux x86_64, if the packaged runtime directory is absent or incomplete, the first start schedules a single background install and returns `installing:true` immediately so the Hub's 20-second file-system request deadline is not held by a large download. Agents polls status for up to five minutes and reports an installation error or timeout. A later explicit start retries a failed install; status polling alone does not. The installer downloads the official Codeg `v0.42.0` archive from [GitHub Releases](https://github.com/xintaofei/codeg/releases/download/v0.42.0/codeg-server-linux-x64.tar.gz), verifies size `77,466,977` and SHA-256 `35928d4b93b5fc65bfc4d330f4d653c738af0b033307cf9d59173539d49bf679`, and extracts only the exact `codeg-server`, `codeg-mcp`, and `codeg-computer-helper` executable members. A completed download is cached until installation succeeds; incomplete downloads are discarded, so a retry does not accept a partial archive. The three executables are staged together and published by directory rename. The installed files are `<node-data-dir>/agents-runtime-linux/bin/`; bundled Tether web assets remain the runtime's `CODEG_STATIC_DIR`. The upstream CLI and web export are ignored, and the optional Linux executables are not added to the shared cross-platform Node archive. On the first launch into an empty runtime data directory, Tether reads the authenticated delegation settings and enables delegation only if it is currently off, preserving the remaining settings. It writes a bootstrap marker after a successful read so later user preferences, including opting out, remain untouched.
