# Open (or re-open) the Tether app window without restarting services.
param([string]$Url = "http://127.0.0.1:18890")

$edge = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { throw "Edge not found; open $Url in a browser." }
Start-Process $edge -ArgumentList "--app=$Url", "--window-size=1500,950"