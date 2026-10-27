# Join a Windows target to the public Tether Hub.
# Run from the repository root on the target machine:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\hub\join-node.ps1 `
#     -HubUrl wss://8-220-198-26.sslip.io/ws/node -DeviceName LAPTOP-01
# The token prompt keeps the secret out of the command line and out of git.
param(
  [Parameter(Mandatory = $true)][string]$HubUrl,
  [string]$DeviceName = $env:COMPUTERNAME,
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if (-not $HubUrl.StartsWith("wss://")) {
  throw "HubUrl must start with wss:// (the Hub terminates TLS)."
}
if (-not (Test-Path (Join-Path $AppDir "tether\node\agent.py"))) {
  throw "Run this from the Tether repository root; tether\node\agent.py not found under $AppDir."
}
if (-not (Test-Path (Join-Path $AppDir ".venv\Scripts\python.exe"))) {
  throw "Python venv missing. Run .\laptop\bootstrap-node.ps1 first."
}
$head = ""
if (Test-Path (Join-Path $AppDir ".git")) {
  $head = (& git -C $AppDir rev-parse --short HEAD 2>$null)
}

if (-not $Token) {
  $secure = Read-Host "Paste TETHER_NODE_TOKEN (input hidden)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null }
}
if (-not $Token) { throw "A node token is required." }

$env:TETHER_NODE_TOKEN = $Token
$env:TETHER_INSECURE_TLS = "0"
Write-Host "[join] device: $DeviceName"
Write-Host "[join] hub:    $HubUrl"
Write-Host "[join] commit: $head (needs b9d8eb5 or newer for wss)"
Write-Host "[join] starting outbound node; no inbound port is opened"

& (Join-Path $AppDir "laptop\tether-node.ps1") -ControllerUrl $HubUrl -DeviceName $DeviceName