#Requires -Version 5.1
# Install only the Tether APP launcher (no DSH plugin changes).
# Run desktop\install-app.cmd, or:
#   powershell -ExecutionPolicy Bypass -File desktop/install-app.ps1
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $Repo "apps\tether-app"
$Electron = Join-Path $AppDir "node_modules\electron\dist\electron.exe"
$NodeVersion = "22.11.0"

function Resolve-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { return @{ Exe = $node.Source; Npm = (Join-Path (Split-Path $node.Source) "npm.cmd") } }
  $runtime = Join-Path $Repo ".runtime\node"
  $nodeExe = Join-Path $runtime "node.exe"
  if (-not (Test-Path $nodeExe)) {
    Write-Host "[tether] Node.js not found; downloading Node $NodeVersion..."
    $zip = Join-Path $env:TEMP "tether-node-$NodeVersion.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip
    $extract = Join-Path $env:TEMP "tether-node-$NodeVersion"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $inner = Get-ChildItem -Path $extract -Directory | Select-Object -First 1
    if (-not $inner) { throw "Node.js archive layout is unexpected" }
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    Get-ChildItem -Path $inner.FullName | Move-Item -Destination $runtime -Force
    Remove-Item -Recurse -Force $extract
    Remove-Item -Force $zip
  }
  return @{ Exe = $nodeExe; Npm = (Join-Path $runtime "npm.cmd") }
}

$node = Resolve-Node
if (-not (Test-Path $Electron)) {
  Write-Host "[tether] Installing Electron dependencies (first run, may take a few minutes)..."
  Push-Location $AppDir
  try {
    & $node.Npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed in $AppDir" }
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path $Electron)) { throw "electron.exe is still missing after npm install" }

$PythonVenv = Join-Path $Repo ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonVenv)) {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if (-not $python) {
    $pythonHome = Join-Path $Repo ".runtime\python"
    $pythonExe = Join-Path $pythonHome "python.exe"
    if (-not (Test-Path $pythonExe)) {
      Write-Host "[tether] Python not found; downloading Python 3.11.9..."
      $installer = Join-Path $env:TEMP "tether-python-3.11.9.exe"
      Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -OutFile $installer
      $args = @("/quiet", "InstallAllUsers=0", "PrependPath=0", "Include_pip=1", "Include_venv=1", "TargetDir=$pythonHome")
      $process = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
      if ($process.ExitCode -ne 0 -or -not (Test-Path $pythonExe)) { throw "Python installation failed" }
      Remove-Item -Force $installer
    }
    $env:PATH = "$pythonHome;$env:PATH"
  }
  $bootstrap = Join-Path $AppDir "bootstrap-app.ps1"
  if (-not (Test-Path $bootstrap)) { throw "bootstrap-app.ps1 is missing from the APP package" }
  Write-Host "[tether] Preparing the Python runtime (first run)..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $bootstrap
  if (-not (Test-Path $PythonVenv)) { throw "Tether Python runtime was not created" }
}

$icon = Join-Path $Repo "assets\tether-app-s.ico"
if (-not (Test-Path $icon)) { $icon = $Electron }
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if (-not $folder) { continue }
  $lnk = $shell.CreateShortcut((Join-Path $folder "Tether APP.lnk"))
  $lnk.TargetPath = $Electron
  $lnk.Arguments = '"' + $AppDir + '"'
  $lnk.WorkingDirectory = $AppDir
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = "Tether APP"
  $lnk.Save()
}
Write-Host "[tether] Installed. Open 'Tether APP' from the Desktop or Start Menu."
Write-Host "[tether] No DSH profile was changed."
