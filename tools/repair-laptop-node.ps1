param(
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Hub = 'wss://8-220-198-26.sslip.io/ws/node'
$Root = 'D:\Tether\node-0.3.6'
$Workspace = 'D:\TetherWorkspaces'
$Device = 'LAPTOP-01'
$ZipUrl = 'https://8-220-198-26.sslip.io/install/tether-node-0.3.6.zip'
$Log = Join-Path $Root 'node.log'

function Find-HubConfig {
  $roots = @('D:\Tether', (Join-Path $env:APPDATA 'Tether'), (Join-Path $env:LOCALAPPDATA 'Tether')) |
    Where-Object { Test-Path $_ }
  foreach ($root in $roots) {
    $found = Get-ChildItem -LiteralPath $root -Recurse -Depth 6 -File -Filter 'hub.json' |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Read-NodeToken {
  $hub = Find-HubConfig
  if ($hub) {
    try {
      $cfg = Get-Content -LiteralPath $hub -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($cfg.nodeToken) { return [string]$cfg.nodeToken }
    } catch { }
  }
  $roots = @('D:\Tether', (Join-Path $env:APPDATA 'Tether'), (Join-Path $env:LOCALAPPDATA 'Tether')) |
    Where-Object { Test-Path $_ }
  foreach ($root in $roots) {
    $found = Get-ChildItem -LiteralPath $root -Recurse -Depth 6 -File -Filter 'device-token.json' |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $found) { continue }
    try {
      $raw = Get-Content -LiteralPath $found.FullName -Raw -Encoding UTF8
      $value = $raw | ConvertFrom-Json
      if ($value -is [string]) { return $value }
      if ($value.token) { return [string]$value.token }
      if ($value.device_token) { return [string]$value.device_token }
    } catch { }
  }
  return $null
}

Write-Host '[tether] looking for the existing node credential...'
$token = Read-NodeToken
if (-not $token) {
  Write-Host ''
  Write-Host 'No existing node token found.' -ForegroundColor Yellow
  Write-Host 'Open the Tether APP on this laptop and sign in once, then run this repair again.'
  Write-Host 'The token is read locally from the APP data; it is never printed.'
  exit 2
}
Write-Host ('[tether] credential found (length ' + $token.Length + ', not printed)')

if ($DryRun) {
  Write-Host "[dry-run] hub=$Hub device=$Device root=$Root workspace=$Workspace"
  Write-Host '[dry-run] would download, bootstrap, start hidden, and register logon task'
  exit 0
}

if (-not (Test-Path (Join-Path $Root 'laptop\bootstrap-node.ps1'))) {
  $zip = Join-Path $env:TEMP 'tether-node-0.3.6.zip'
  Write-Host '[tether] downloading node 0.3.6...'
  Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $zip
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $env:TEMP -Force
  $extracted = Join-Path $env:TEMP 'tether-node-0.3.6'
  if (-not (Test-Path (Join-Path $extracted 'laptop\bootstrap-node.ps1'))) {
    throw 'downloaded node archive has an unexpected layout'
  }
  Copy-Item -Path (Join-Path $extracted '*') -Destination $Root -Recurse -Force
  Remove-Item -LiteralPath $extracted -Recurse -Force
}

Write-Host '[tether] preparing Python runtime (this can take a minute)...'
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[tether] Node.js not on PATH; fetching a portable Node 24...'
  $runtime = Join-Path $Root '.runtime\node'
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  if (-not (Get-ChildItem $runtime -Directory -ErrorAction SilentlyContinue)) {
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
    $entry = $index | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1
    if (-not $entry) { throw 'could not resolve a Node 24 release' }
    $nodeZip = Join-Path $env:TEMP ("node-" + $entry.version + "-win-x64.zip")
    Invoke-WebRequest -UseBasicParsing -Uri ("https://nodejs.org/dist/" + $entry.version + "/node-" + $entry.version + "-win-x64.zip") -OutFile $nodeZip
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $runtime -Force
  }
  $nodeDir = Get-ChildItem $runtime -Directory | Select-Object -First 1
  if (-not $nodeDir) { throw 'portable Node extraction failed' }
  $env:PATH = $nodeDir.FullName + ';' + $env:PATH
}
& (Join-Path $Root 'laptop\bootstrap-node.ps1') -ControllerUrl $Hub -DeviceName $Device -Workspace $Workspace -Token $token
if ($LASTEXITCODE -ne 0) { throw 'node bootstrap failed' }

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'tether\.node\.agent' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$runner = Join-Path $Root 'laptop\tether-node.ps1'
$args = @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $runner)
Write-Host '[tether] starting the node hidden...'
Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WindowStyle Hidden `
  -RedirectStandardOutput $Log -RedirectStandardError ($Log + '.err') | Out-Null

$taskCommand = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"'
schtasks.exe /Create /SC ONLOGON /TN 'TetherNode' /TR $taskCommand /RL LIMITED /F | Out-Null

Start-Sleep -Seconds 8
$ports = Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 18893, 18895 } |
  Select-Object LocalAddress, LocalPort
Write-Host ''
if ($ports) {
  Write-Host '[tether] node is listening:' -ForegroundColor Green
  $ports | Format-Table -AutoSize
  Write-Host 'Check the Hub: LAPTOP-01 should now be online.'
} else {
  Write-Host '[tether] node did not open its local ports.' -ForegroundColor Yellow
  if (Test-Path $Log) { Get-Content -LiteralPath $Log -Tail 40 }
  if (Test-Path ($Log + '.err')) { Get-Content -LiteralPath ($Log + '.err') -Tail 40 }
  Write-Host ''
  Write-Host 'If the log says unauthorized/401, open the Tether APP and sign in again, then rerun this repair.'
}