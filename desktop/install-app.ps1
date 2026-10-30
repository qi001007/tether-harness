#Requires -Version 5.1
# Install only the Tether APP launcher (no DSH plugin changes).
# Run from anywhere: powershell -ExecutionPolicy Bypass -File desktop/install-app.ps1
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $Repo "apps\tether-app"
$Electron = Join-Path $AppDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $Electron)) {
  throw "electron.exe not found under $AppDir; run npm install first"
}
$icon = Join-Path $Repo "assets\tether.ico"
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
Write-Host "[tether] APP shortcut created on Desktop and Start Menu."
Write-Host "[tether] No DSH profile was changed."