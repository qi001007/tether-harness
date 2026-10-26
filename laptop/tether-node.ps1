# Start the Tether node. Values come from .env unless overridden here.
param(
  [string]$ControllerUrl = "",
  [string]$DeviceName = "",
  [string]$Workspace = ""
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$NodeRoot = Split-Path -Parent $AppDir
if (-not $Workspace) { $Workspace = Join-Path $NodeRoot "work" }
$Venv = Join-Path $AppDir ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $Python)) {
  throw "venv missing. Run .\laptop\bootstrap-node.ps1 first."
}
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
$env:PYTHONPATH = $AppDir
$env:PYTHONIOENCODING = "utf-8"

$args = @("-m", "tether.node.agent", "--workspace", $Workspace, "--agent", "dsh")
if ($ControllerUrl) { $args += @("--controller", $ControllerUrl) }
if ($DeviceName) { $args += @("--device", $DeviceName) }

Write-Host "[tether] local console: http://127.0.0.1:18893"
Write-Host "[tether] workspace: $Workspace"
& $Python @args