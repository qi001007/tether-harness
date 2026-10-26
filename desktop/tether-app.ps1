# Start the desktop Tether app: controller + local Agent node + app window.
param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  throw "venv missing. Run the desktop setup first (pip install -e .)."
}

$env:PYTHONPATH = $AppDir
$env:PYTHONIOENCODING = "utf-8"
$args = @((Join-Path $AppDir "scripts\up.py"))
if ($NoBrowser) { $args += "--no-browser" }
& $Python @args