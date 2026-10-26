#Requires -Version 5.1
# Bootstrap an isolated Tether node on a Windows laptop.
# Run from the extracted app directory:  .\laptop\bootstrap-node.ps1
param(
  [string]$ControllerUrl = "ws://100.x.x.x:18890/ws/node",
  [string]$DeviceName = "LAPTOP-01",
  [string]$Workspace = "",
  [string]$Token = "tether-local-2026"
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$NodeRoot = Split-Path -Parent $AppDir
if (-not $Workspace) { $Workspace = Join-Path $NodeRoot "work" }
$Venv = Join-Path $AppDir ".venv"
$NpmDir = Join-Path $AppDir ".runtime\npm"
$HomeDir = Join-Path $NodeRoot ".home"

Write-Host "[tether] app dir: $AppDir"
Write-Host "[tether] node root: $NodeRoot (home + work live here)"
Write-Host "[tether] workspace: $Workspace"

function Find-Python {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return @{ Exe = $cmd.Source; Args = @() } }
  $cmd = Get-Command py -ErrorAction SilentlyContinue
  if ($cmd) { return @{ Exe = $cmd.Source; Args = @("-3") } }
  throw "Python 3.10+ not found on PATH. Install Python 3.11/3.12, reopen this terminal, then rerun."
}

$py = Find-Python
$ver = & $py.Exe @($py.Args) -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$ver -lt [version]"3.10") {
  throw "Python $ver is too old; install Python 3.11/3.12."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found on PATH. Install Node 24 LTS, reopen this terminal, then rerun."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm not found on PATH. Reinstall Node.js with npm, then rerun."
}
$nodeVer = (& node --version).Trim().TrimStart("v")
if ([version]$nodeVer -lt [version]"22.0") {
  throw "Node $nodeVer is too old; install Node 24 LTS."
}

Write-Host "[tether] python $ver / node $(& node --version)"
New-Item -ItemType Directory -Force -Path $AppDir, $NpmDir, $HomeDir, $Workspace | Out-Null

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  Write-Host "[tether] creating venv"
  & $py.Exe @($py.Args) -m venv $Venv
}

$vpy = Join-Path $Venv "Scripts\python.exe"
Write-Host "[tether] installing project (editable)"
& $vpy -m pip install --disable-pip-version-check -q -e $AppDir
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "[tether] installing npm dsh runtime (about 2 minutes)"
& npm install --prefix $NpmDir --no-audit --no-fund "@deepseek-ai/dsh@0.2.1-rc.2"
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

$envFile = Join-Path $AppDir ".env"
if (-not (Test-Path $envFile)) {
  @"
# Fill DEEPSEEK_API_KEY, then run .\laptop\tether-node.ps1
DEEPSEEK_API_KEY=
DSH_PROVIDER=deepseek-official
DSH_MODEL=deepseek-v4-flash
DSH_MAX_TOKENS=8192
DSH_HOME=$($HomeDir -replace '\\','/')
TETHER_CONTROLLER=$ControllerUrl
TETHER_DEVICE=$DeviceName
TETHER_NODE_TOKEN=$Token
"@ | Set-Content -Encoding UTF8 $envFile
  Write-Host "[tether] wrote $envFile"
} else {
  Write-Host "[tether] keeping existing $envFile"
}

Write-Host ""
Write-Host "NEXT: edit $envFile and fill DEEPSEEK_API_KEY."
Write-Host "THEN: .\laptop\tether-node.ps1"
Write-Host "Desktop controller must be started with TETHER_HOST=0.0.0.0 and TCP 18890 allowed."
Write-Host "Controller URL: $ControllerUrl"