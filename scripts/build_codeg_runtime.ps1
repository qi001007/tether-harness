param(
  [string]$SourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'third_party/codeg'),
  [string]$ExportDirectory,
  [string]$BuildId
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = (Resolve-Path $SourcePath).Path
$expectedVersion = '0.42.0'
$package = Get-Content (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne $expectedVersion) {
  throw "Expected Codeg $expectedVersion, found $($package.version)"
}

$nodeModules = Join-Path $source 'node_modules'
if (-not (Test-Path -LiteralPath (Join-Path $nodeModules 'next/dist/bin/next'))) {
  throw "Missing Codeg dependencies under $nodeModules. Run 'corepack pnpm install --frozen-lockfile' inside $source first."
}

$gitCommit = ''
try {
  $rev = (& git -C $repo rev-parse --short=12 HEAD 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -eq 0 -and $rev) { $gitCommit = $rev.Trim() }
} catch { }
if (-not $BuildId) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
  $BuildId = if ($gitCommit) { "tether-codeg-$expectedVersion-$gitCommit-$stamp" } else { "tether-codeg-$expectedVersion-$stamp" }
}

Push-Location $source
try {
  # Ensure Monaco & PDF.js static public assets (normally populated by pnpm postinstall) exist.
  if (-not (Test-Path -LiteralPath (Join-Path $source 'public/vs/loader.js') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $source 'public/pdfjs/pdf.worker.min.mjs') -PathType Leaf)) {
    & node ./scripts/hydrate-public-assets.mjs
    if ($LASTEXITCODE -ne 0) { throw "Failed to populate public/vs and public/pdfjs assets" }
  }

  # Remove stale out/ and .next/ export state before building cleanly.
  foreach ($stale in @('out', '.next')) {
    $p = Join-Path $source $stale
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
  }

  $prevBuildId = $env:TETHER_CODEG_BUILD_ID
  $prevGallery = $env:CODEG_GALLERY
  $prevTelemetry = $env:NEXT_TELEMETRY_DISABLED
  try {
    $env:TETHER_CODEG_BUILD_ID = $BuildId
    $env:CODEG_GALLERY = '0'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    & node ./node_modules/next/dist/bin/next build
    if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath (Join-Path $source 'out/workspace.html') -PathType Leaf)) {
      # Next.js 16.4 emits a one-shot upgrade notice exit on the first build in agent shells
      # after generating out/ and instructs: "Retry the same command to continue the original task."
      & node ./node_modules/next/dist/bin/next build
    }
    if ($LASTEXITCODE -ne 0) { throw "Codeg static build failed with exit $LASTEXITCODE" }
  } finally {
    $env:TETHER_CODEG_BUILD_ID = $prevBuildId
    $env:CODEG_GALLERY = $prevGallery
    $env:NEXT_TELEMETRY_DISABLED = $prevTelemetry
  }
} finally {
  Pop-Location
}

$output = Join-Path $source 'out'
foreach ($page in @('index.html', 'login.html', 'workspace.html')) {
  if (-not (Test-Path -LiteralPath (Join-Path $output $page) -PathType Leaf)) {
    throw "Static export did not produce $page"
  }
}

$buildMeta = [ordered]@{
  version    = $expectedVersion
  source     = 'third_party/codeg'
  build_id   = $BuildId
  git_commit = $gitCommit
  built_at   = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Depth 4

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
Set-Content -LiteralPath (Join-Path $destination 'tether-build.json') -Value $buildMeta -Encoding UTF8
Write-Output "Built internal Codeg $expectedVersion ($BuildId) and copied its static export to $destination"
