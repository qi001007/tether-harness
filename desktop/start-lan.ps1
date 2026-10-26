# Start the controller on the LAN so a laptop node can connect.
# The human UI/API stays loopback-only; /ws/node requires TETHER_NODE_TOKEN.
$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { throw "Run the desktop venv setup first." }
if (-not (Test-Path (Join-Path $AppDir ".env"))) { throw "Missing .env; fill the keys first." }

$env:PYTHONPATH = $AppDir
$env:PYTHONIOENCODING = "utf-8"
$env:TETHER_HOST = "0.0.0.0"
$env:TETHER_PORT = "18890"

Write-Host "[tether] local UI/API: http://127.0.0.1:18890 (loopback only)"
Write-Host "[tether] node WS:      ws://<desktop-lan-ip>:18890/ws/node"
Write-Host "[tether] if Windows asks, allow Python on Private networks for TCP 18890."
Write-Host "[tether] from the laptop test: Test-NetConnection <desktop-lan-ip> -Port 18890"
& $Python -m uvicorn tether.controller.app:app --host 0.0.0.0 --port 18890 --log-level info