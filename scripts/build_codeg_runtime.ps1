param(
  [string]$SourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime/codeg-source'),
  [string]$ExportDirectory
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = (Resolve-Path $SourcePath).Path
$expectedVersion = '0.42.0'
$expectedRevision = 'e3171d69d208bdf37697b15e8b14f8c9b70825bf'
$patch = Join-Path $repo 'tether/node/agents-runtime-codeg.patch'
$package = Get-Content (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne $expectedVersion) {
  throw "Expected Codeg $expectedVersion, found $($package.version)"
}

$previousGitCeiling = $env:GIT_CEILING_DIRECTORIES
try {
  # An exported source under .runtime must not inherit the enclosing Tether checkout.
  $env:GIT_CEILING_DIRECTORIES = (Split-Path $source -Parent).Replace('\', '/')
  $revision = (& git -C $source rev-parse HEAD 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -eq 0 -and $revision -ne $expectedRevision) {
    throw "Expected Codeg revision $expectedRevision, found $revision"
  }

  & git -C $source apply --ignore-space-change --whitespace=nowarn --check $patch
  if ($LASTEXITCODE -eq 0) {
    & git -C $source apply --ignore-space-change --whitespace=nowarn $patch
    if ($LASTEXITCODE -ne 0) { throw 'Failed to apply the Tether Codeg patch' }
  } else {
    & git -C $source apply --ignore-space-change --whitespace=nowarn --reverse --check $patch
    if ($LASTEXITCODE -ne 0) { throw 'Start from a clean checkout of the pinned Codeg commit' }
  }
} finally {
  $env:GIT_CEILING_DIRECTORIES = $previousGitCeiling
}

Push-Location $source
try {
  & node ./node_modules/next/dist/bin/next build
  if ($LASTEXITCODE -ne 0) { throw "Codeg static build failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

$output = Join-Path $source 'out'
foreach ($page in @('index.html', 'login.html', 'workspace.html')) {
  if (-not (Test-Path -LiteralPath (Join-Path $output $page) -PathType Leaf)) {
    throw "Static export did not produce $page"
  }
}
if ($ExportDirectory) {
  $destination = [IO.Path]::GetFullPath($ExportDirectory, $repo)
  if (Test-Path -LiteralPath $destination) { throw "Export directory already exists: $destination" }
  Copy-Item -LiteralPath $output -Destination $destination -Recurse
} else {
  if (-not $IsWindows) { throw 'Set ExportDirectory to a fresh directory on this platform' }
  $destination = Join-Path $repo 'tether/node/bin/agents-runtime/web'
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $target = Get-Item -LiteralPath $destination
  if ($target.FullName -ne $destination -or ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Refusing to mirror into redirected directory: $destination"
  }
  & robocopy $output $destination /MIR /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "Failed to copy static export (robocopy exit $LASTEXITCODE)" }
  $global:LASTEXITCODE = 0
}
Copy-Item -LiteralPath (Join-Path $repo 'tether/node/agents-runtime-token.html') -Destination (Join-Path $destination 'token.html') -Force
Write-Output "Built Codeg $expectedVersion ($expectedRevision) and copied its static export to $destination"
