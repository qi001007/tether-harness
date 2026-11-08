param(
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [string]$RegistrationDir = (Join-Path $HOME '.tether\app-installations'),
  [string]$SnapshotParent = (Join-Path $env:LOCALAPPDATA 'Tether\migration-snapshots')
)

$ErrorActionPreference = 'Stop'

function Get-CanonicalLocalPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path.StartsWith('\\')) { throw 'invalid_local_path' }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not [IO.Path]::IsPathRooted($full) -or $full.StartsWith('\\')) { throw 'invalid_local_path' }
  return $full
}

function Assert-PlainPath([string]$Path, [bool]$Directory) {
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse_source_rejected' }
  if ($Directory -and -not $item.PSIsContainer) { throw 'source_not_directory' }
  if (-not $Directory -and $item.PSIsContainer) { throw 'source_not_file' }
}

function Assert-ProcessStopped([int]$ProcessId, [double]$ExpectedStartSeconds, [bool]$AllowPidReuse) {
  if ($ProcessId -le 0) { throw 'invalid_process_id' }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) { return }
  if ($AllowPidReuse) {
    try { $actual = $process.StartTime.ToUniversalTime() } catch { throw 'process_identity_unverifiable' }
    $expected = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]($ExpectedStartSeconds * 1000)).UtcDateTime
    if ([Math]::Abs(($actual - $expected).TotalSeconds) -gt 5) { return }
  }
  throw 'previous_process_still_running'
}

function Protect-PrivateTree([string]$Path, [string]$UserSid) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer) {
    $userAce = '*' + $UserSid + ':(OI)(CI)F'
    $systemAce = '*S-1-5-18:(OI)(CI)F'
  } else {
    $userAce = '*' + $UserSid + ':F'
    $systemAce = '*S-1-5-18:F'
  }
  & "$env:SystemRoot\System32\icacls.exe" $Path '/inheritance:r' '/grant:r' $userAce $systemAce | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'snapshot_acl_failed' }
}

function Write-JsonWithoutBom([string]$Path, [object]$Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
  [IO.File]::WriteAllText($Path, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $registrationDir -PathType Container)) { exit 0 }
$install = Get-CanonicalLocalPath $InstallRoot
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$files = @('hub.json', 'device-token.json', 'policy.json', 'node-hub.db', 'node-hub.db-wal', 'node-local.db', 'node-local.db-wal')

foreach ($registrationFile in Get-ChildItem -LiteralPath $registrationDir -Filter '*.json' -File) {
  Assert-PlainPath $registrationFile.FullName $false
  try { $registration = Get-Content -LiteralPath $registrationFile.FullName -Raw | ConvertFrom-Json } catch { continue }
  $origin = ([string]$registration.controller_origin).ToLowerInvariant()
  $device = ([string]$registration.device_id).Trim()
  $rootText = [string]$registration.root
  if ($registration.schema -ne 1 -or -not $origin -or -not $device -or -not $rootText) { continue }
  $digest = [Security.Cryptography.SHA256]::Create()
  try { $id = ([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($origin + "`n" + $device)))).Replace('-', '').ToLowerInvariant() }
  finally { $digest.Dispose() }
  if ($registrationFile.BaseName -ne $id) { continue }
  $legacyRoot = Get-CanonicalLocalPath $rootText
  if ($legacyRoot -ne $install -and -not $legacyRoot.StartsWith($install + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { continue }
  if (-not (Test-Path -LiteralPath $legacyRoot -PathType Container)) { continue }
  Assert-PlainPath $legacyRoot $true
  $source = Get-CanonicalLocalPath (Join-Path $legacyRoot 'apps\tether-app\data')
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { continue }
  Assert-PlainPath $source $true
    Assert-ProcessStopped ([int]$registration.pid) ([double]$registration.process_started_at) $true
  $nodeStatePath = Join-Path $source 'private\managed-node-process.json'
  if (Test-Path -LiteralPath $nodeStatePath -PathType Leaf) {
    Assert-PlainPath $nodeStatePath $false
    $nodeState = Get-Content -LiteralPath $nodeStatePath -Raw | ConvertFrom-Json
    Assert-ProcessStopped ([int]$nodeState.pid) 0 $false
  }

  $markerPath = Join-Path $registrationDir ($id + '.migration-source')
  $snapshot = Join-Path $snapshotParent $id
  if (Test-Path -LiteralPath $markerPath) {
    Assert-PlainPath $markerPath $false
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($marker.schema -ne 1 -or (Get-CanonicalLocalPath ([string]$marker.legacy_data_dir)) -ne (Join-Path $snapshot 'apps\tether-app\data')) { throw 'existing_migration_marker_invalid' }
    continue
  }
  if (Test-Path -LiteralPath $snapshot) { throw 'snapshot_already_exists' }
  New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
  $snapshotData = Join-Path $snapshot 'apps\tether-app\data'
  New-Item -ItemType Directory -Path $snapshotData -Force | Out-Null
  try {
    foreach ($name in $files) {
      $sourceFile = Join-Path $source $name
      if (Test-Path -LiteralPath $sourceFile -PathType Leaf) {
        Assert-PlainPath $sourceFile $false
        [IO.File]::Copy($sourceFile, (Join-Path $snapshotData $name), $false)
      }
    }
    if (Test-Path -LiteralPath $nodeStatePath -PathType Leaf) {
      $privateDir = Join-Path $snapshotData 'private'
      New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
      $nodeState.dataDir = $snapshotData
      Write-JsonWithoutBom (Join-Path $privateDir 'managed-node-process.json') $nodeState
    }
    if (-not (Test-Path -LiteralPath (Join-Path $snapshotData 'hub.json') -PathType Leaf)) { throw 'identity_file_missing' }
    Protect-PrivateTree $snapshot $userSid
    $temporaryMarker = $markerPath + '.' + $PID + '.tmp'
    Write-JsonWithoutBom $temporaryMarker @{ schema = 1; legacy_data_dir = $snapshotData }
    Protect-PrivateTree $temporaryMarker $userSid
    [IO.File]::Move($temporaryMarker, $markerPath)
    Protect-PrivateTree $markerPath $userSid
  } catch {
    $resolvedParent = [IO.Path]::GetFullPath($snapshotParent).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $resolvedSnapshot = [IO.Path]::GetFullPath($snapshot)
    $snapshotIsOwned = $resolvedSnapshot.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    $snapshotExists = Test-Path -LiteralPath $resolvedSnapshot -PathType Container
    if ($snapshotIsOwned -and $snapshotExists) {
      $snapshotItem = Get-Item -LiteralPath $resolvedSnapshot -Force
      if (($snapshotItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
        Remove-Item -LiteralPath $resolvedSnapshot -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
    throw
  }
}
