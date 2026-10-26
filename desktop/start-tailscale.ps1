# Start the controller for Tailscale peers.
# UI/API stays loopback-only; only /ws/node is reachable from the tailnet, with a token.
param(
  [string]$TailscaleIP = "100.x.x.x",
  [int]$Port = 18890
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { throw "Run the desktop venv setup first." }
if (-not (Test-Path (Join-Path $AppDir ".env"))) { throw "Missing .env; fill the keys first." }

$env:PYTHONPATH = $AppDir
$env:PYTHONIOENCODING = "utf-8"
$env:TETHER_HOST = "0.0.0.0"
$env:TETHER_PORT = "$Port"

Write-Host "[tether] local UI/API: http://127.0.0.1:$Port (loopback only)"
Write-Host "[tether] node WS from tailnet: ws://$TailscaleIP`:$Port/ws/node"
Write-Host "[tether] laptop test: Test-NetConnection $TailscaleIP -Port $Port"
Write-Host "[tether] if Windows asks, allow Python on Private networks for TCP $Port."
& $Python -m uvicorn tether.controller.app:app --host 0.0.0.0 --port $Port --log-level info