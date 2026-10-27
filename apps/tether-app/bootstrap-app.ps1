#Requires -Version 5.1
# Prepare the Python runtime for a downloaded Tether APP (no repo clone required).
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Venv = Join-Path $Repo ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Python)) {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { & $py.Source -3 -m venv $Venv } else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { throw "Python 3.11+ not found on PATH." }
    & $python.Source -m venv $Venv
  }
}
& $Python -m pip install --disable-pip-version-check -q -e $Repo
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "[tether] Python runtime ready: $Venv"