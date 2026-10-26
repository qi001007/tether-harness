# Install the Tether client plugin into the DeepSeek Harness desktop profile.
# The plugin is plain ESM; there is no build step.
param(
  [switch]$Restart
)
$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$Plugin = Join-Path $AppDir "packages\dsh-plugin-tether"
if (-not (Test-Path (Join-Path $Plugin "package.json"))) {
  throw "Plugin package not found at $Plugin"
}

$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$ProfileDir = Join-Path $DshHome "profiles\desktop"
$ProfilePkg = Join-Path $ProfileDir "package.json"
if (-not (Test-Path $ProfilePkg)) {
  throw "Desktop profile not found at $ProfilePkg. Launch DeepSeek Harness once, then rerun."
}

$candidates = @(
  $env:DSH_CLI,
  "D:\DeepSeek harness\resources\runtime\cli\bin\dsh.cmd",
  (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd")
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $candidates) {
  throw "dsh CLI not found. Set DSH_CLI to resources\runtime\cli\bin\dsh.cmd."
}
$Dsh = @($candidates)[0]

$backup = "$ProfilePkg.bak-tether-plugin-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item -LiteralPath $ProfilePkg -Destination $backup
Write-Host "[tether] profile backup: $backup"

$env:DSH_HOME = $DshHome
# Remove first so pnpm refreshes hard-linked client files when the source changed.
& $Dsh plugin --profile desktop remove tether-dsh-plugin | Out-Null
& $Dsh plugin --profile desktop add "file:$Plugin"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed with exit code $LASTEXITCODE" }

Write-Host "[tether] plugin installed. Restart DeepSeek Harness to load it."
Write-Host "[tether] The sidebar entry is named Tether."
if ($Restart) {
  $exe = "D:\DeepSeek harness\DeepSeek Harness.exe"
  if (-not (Test-Path $exe)) { throw "Set the DeepSeek Harness path in install-plugin.ps1 (-Restart)." }
  Get-Process "DeepSeek Harness" -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Start-Process $exe
  Write-Host "[tether] DeepSeek Harness restarted."
}
