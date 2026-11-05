$ErrorActionPreference = 'SilentlyContinue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$desktop = [Environment]::GetFolderPath('Desktop')
$out = Join-Path $desktop ("Tether-Diagnostics-$stamp")
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Save($name, $content) {
  $content | Out-File -FilePath (Join-Path $out $name) -Encoding utf8
}

$redact = {
  param($text)
  if ($null -eq $text) { return '' }
  ([string]$text) `
    -replace '(?i)(token|secret|password|passwd|api[_-]?key)\s*[=:]\s*\S+', '$1=<redacted>' `
    -replace '(?i)Bearer\s+\S+', 'Bearer <redacted>'
}

Save 'system.txt' (@(
  'host=' + $env:COMPUTERNAME,
  'user=' + $env:USERNAME,
  'time=' + (Get-Date).ToString('o'),
  'os=' + ((Get-CimInstance Win32_OperatingSystem).Caption),
  'version=' + ((Get-CimInstance Win32_OperatingSystem).Version),
  'build=' + ((Get-CimInstance Win32_OperatingSystem).BuildNumber)
) -join "`r`n")

Save 'tether-processes.txt' ((Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match '(?i)tether|electron|python|node' } |
  Select-Object ProcessId, ParentProcessId, Name, ExecutablePath,
    @{n='CommandLine';e={ & $redact $_.CommandLine }} |
  Format-List | Out-String))

Save 'tether-ports.txt' ((Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 18890..18899 -or $_.LocalPort -in 3080,37301,15888 } |
  Select-Object LocalAddress, LocalPort, OwningProcess |
  Sort-Object LocalPort | Format-Table -AutoSize | Out-String))

Save 'tether-services.txt' ((Get-Service | Where-Object { $_.Name -match '(?i)tether' } |
  Select-Object Name, Status, StartType | Format-Table -AutoSize | Out-String))
Save 'tether-scheduled-tasks.txt' ((Get-ScheduledTask | Where-Object { $_.TaskName -match '(?i)tether' } |
  Select-Object TaskName, State | Format-Table -AutoSize | Out-String))

$roots = @(
  'D:\Tether',
  (Join-Path $env:LOCALAPPDATA 'Programs\Tether'),
  (Join-Path $env:LOCALAPPDATA 'Tether'),
  (Join-Path $env:APPDATA 'Tether'),
  (Join-Path $env:USERPROFILE '.dsh')
) | Where-Object { Test-Path $_ } | Select-Object -Unique

$inventory = foreach ($root in $roots) {
  "--- $root"
  Get-ChildItem -LiteralPath $root -Force |
    Select-Object Mode, LastWriteTime, Length, Name |
    Format-Table -AutoSize | Out-String
  $envFile = Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -File -Filter 'node.env' |
    Select-Object -First 1
  if ($envFile) { 'node.env=' + $envFile.FullName + ' (not copied)' }
}
Save 'tether-roots.txt' ($inventory -join "`r`n")

$logFiles = foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -File -Include '*.log', '*.out', '*.err' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 5
}
$logFiles = $logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 8
Save 'tether-log-index.txt' (($logFiles | Select-Object LastWriteTime, Length, FullName |
  Format-Table -AutoSize | Out-String))
$i = 0
foreach ($file in $logFiles) {
  $i++
  $tail = Get-Content -LiteralPath $file.FullName -Tail 300
  Save ("log-$i-" + ($file.Name -replace '[^\w\.-]', '_') + '.txt') (($tail | ForEach-Object { & $redact $_ }) -join "`r`n")
}

$zip = "$out.zip"
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
Remove-Item -LiteralPath $out -Recurse -Force
Write-Host ''
Write-Host 'Tether diagnostics saved to:' -ForegroundColor Green
Write-Host $zip
Write-Host ''
Write-Host 'Please send this zip back. It contains logs and process/port state only; tokens are redacted.'
Start-Process explorer.exe -ArgumentList "/select,`"$zip`""