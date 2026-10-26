# Remove the isolated node install and workspace. Requires explicit confirmation.
param([switch]$Yes, [string]$Workspace = "")

$AppDir = Split-Path -Parent $PSScriptRoot
$NodeRoot = Split-Path -Parent $AppDir
if (-not $Workspace) { $Workspace = Join-Path $NodeRoot "work" }
$targets = @($AppDir, (Join-Path $NodeRoot ".home"), $Workspace)
Set-Location $env:TEMP
if (-not $Yes) {
  Write-Host "This will permanently remove:"
  $targets | ForEach-Object { Write-Host "  $_" }
  $answer = Read-Host "Type YES to continue"
  if ($answer -ne "YES") { Write-Host "Cancelled."; exit 0 }
}
foreach ($t in $targets) {
  if (Test-Path $t) {
    Write-Host "[tether] removing $t"
    Remove-Item -LiteralPath $t -Recurse -Force
  }
}
Write-Host "[tether] removed."