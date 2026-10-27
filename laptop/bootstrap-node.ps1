#Requires -Version 5.1
# Bootstrap an isolated Tether node on a Windows laptop.
# Run from the extracted app directory:  .\laptop\bootstrap-node.ps1
param(
  [string]$ControllerUrl = "",
  [string]$DeviceName = "",
  [string]$Workspace = "",
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$NodeRoot = Split-Path -Parent $AppDir
if (-not $Workspace) { $Workspace = Join-Path $NodeRoot "work" }
$Venv = Join-Path $AppDir ".venv"
$NpmDir = Join-Path $AppDir ".runtime\npm"
$HomeDir = Join-Path $NodeRoot ".home"
$EnvFile = Join-Path $AppDir ".env"
$settingsProvided = [bool]$ControllerUrl -or [bool]$DeviceName -or [bool]$Token

$device = if ($DeviceName) { $DeviceName } else { $env:COMPUTERNAME }
if (-not $device) { $device = "tether-node" }
$envLines = @()
if (Test-Path $EnvFile) {
  $envLines = @(Get-Content -Encoding UTF8 $EnvFile)
  $envText = $envLines -join "`n"
  foreach ($key in @('TETHER_CONTROLLER', 'TETHER_DEVICE', 'TETHER_NODE_TOKEN')) {
    $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
    $count = @($envLines | Where-Object { $_ -match $pattern }).Count
    if ($count -gt 1) { throw "Duplicate $key entries found in $EnvFile. Remove duplicate entries and rerun bootstrap." }
  }
  if (-not $ControllerUrl) {
    $match = [regex]::Match($envText, '(?m)^\s*TETHER_CONTROLLER\s*=\s*["'']?([^\r\n"'']+)["'']?\s*$')
    if ($match.Success) { $ControllerUrl = $match.Groups[1].Value.Trim() }
  }
  if (-not $Token) {
    $match = [regex]::Match($envText, '(?m)^\s*TETHER_NODE_TOKEN\s*=\s*["'']?([^\r\n"'']+)["'']?\s*$')
    if ($match.Success) { $Token = $match.Groups[1].Value.Trim() }
  }
  if (-not $DeviceName) {
    $match = [regex]::Match($envText, '(?m)^\s*TETHER_DEVICE\s*=\s*["'']?([^\r\n"'']+)["'']?\s*$')
    if ($match.Success) { $device = $match.Groups[1].Value.Trim() }
    else { $settingsProvided = $true }
  }
}
if (-not $ControllerUrl -or -not $Token) {
  throw "Hub WebSocket URL and Node token are required. Pass -ControllerUrl wss://<hub>/ws/node -Token <node-token>, or configure TETHER_CONTROLLER and TETHER_NODE_TOKEN in $EnvFile."
}
if ($ControllerUrl -notmatch '^wss?://[^\s]+/ws/node/?$') {
  throw "TETHER_CONTROLLER must be a Hub WebSocket endpoint ending in /ws/node."
}
if ($ControllerUrl -match '100\.x\.x\.x|<hub>|placeholder' -or $Token -match '^<.*>$|placeholder') {
  throw "Replace placeholder Hub URL/token values in $EnvFile before bootstrapping."
}

if (-not (Test-Path $EnvFile) -or $settingsProvided) {
  foreach ($entry in @(@('TETHER_CONTROLLER', $ControllerUrl), @('TETHER_DEVICE', $device), @('TETHER_NODE_TOKEN', $Token))) {
    $key = $entry[0]
    $value = $entry[1]
    $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
    $found = $false
    for ($lineIndex = 0; $lineIndex -lt $envLines.Count; $lineIndex++) {
      if ($envLines[$lineIndex] -match $pattern) {
        $envLines[$lineIndex] = "$key=$value"
        $found = $true
      }
    }
    if (-not $found) { $envLines += "$key=$value" }
  }
  if (-not (Test-Path $EnvFile)) {
    $envLines += @('DSH_PROVIDER=deepseek-official', 'DSH_MODEL=deepseek-v4-flash', 'DSH_MAX_TOKENS=8192', "DSH_HOME=$($HomeDir -replace '\\','/')")
  }
  [System.IO.File]::WriteAllLines($EnvFile, [string[]]$envLines, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "[tether] Hub connection configuration saved to $EnvFile"
} else {
  Write-Host "[tether] keeping existing Hub configuration in $EnvFile"
}

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

Write-Host ""
Write-Host "NEXT: .\laptop\tether-node.ps1 (configured Hub connection; device $device)"
