#Requires -Version 5.1
# Prepare the Python runtime for a downloaded Tether APP (no repo clone required).
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Venv = Join-Path $Repo ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$Log = Join-Path $Repo "bootstrap.log"

function Wait-Path($Path, $Tries = 20) {
  for ($i = 0; $i -lt $Tries; $i++) {
    if (Test-Path $Path) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

if (-not (Test-Path $Python)) {
  if (Test-Path $Venv) { Remove-Item -Recurse -Force $Venv }
  $created = $false
  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCmd) {
    & $pythonCmd.Source -m venv $Venv
    if ($LASTEXITCODE -eq 0 -and (Wait-Path $Python)) { $created = $true }
  }
  if (-not $created) {
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCmd) {
      if (Test-Path $Venv) { Remove-Item -Recurse -Force $Venv }
      & $pyCmd.Source -3 -m venv $Venv
      if ($LASTEXITCODE -eq 0 -and (Wait-Path $Python)) { $created = $true }
    }
  }
  if (-not $created) { throw "Python 3.11+ not found or virtual environment creation failed: $Venv" }
}
Write-Host "[tether] installing Python dependencies..."
& $Python -m pip install --disable-pip-version-check -q -e $Repo 2>&1 | Tee-Object -FilePath $Log -Append
if ($LASTEXITCODE -ne 0) { throw "pip install failed; see $Log" }
& $Python -c "import websockets, tether.node.agent" 2>&1 | Tee-Object -FilePath $Log -Append
if ($LASTEXITCODE -ne 0) { throw "Tether runtime dependencies are incomplete; see $Log" }
Write-Host "[tether] Python runtime ready: $Venv"