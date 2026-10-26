# Add the Tether MCP server to the DeepSeek Harness desktop profile.
# The desktop app must be closed while this runs; it rewrites this file on exit.
$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$Profile = Join-Path $HOME ".dsh\profiles\desktop\cordis.patch.yml"
if (-not (Test-Path $Profile)) {
  throw "Desktop profile not found at $Profile. Launch DeepSeek Harness once, then rerun."
}
$text = Get-Content -LiteralPath $Profile -Raw
if ($text -match "mcp-tether") {
  Write-Host "[tether] MCP entry already present in $Profile"
  exit 0
}

$backup = "$Profile.bak-tether-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item -LiteralPath $Profile -Destination $backup
Write-Host "[tether] backup: $backup"

$python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Missing $python; install the project venv first." }

$block = @'

# Tether MCP bridge: the desktop Agent keeps its own memory/plugins; this only
# adds tools to list paired machines and delegate tasks to them.
- insert:
    - id: mcp-tether
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tether
        transport: stdio
        command: '__PYTHON__'
        args:
          - '-m'
          - 'tether.mcp_server'
        env:
          PYTHONPATH: '__APPDIR__'
          TETHER_CONTROLLER_HTTP: 'http://127.0.0.1:18890'
        cwd: '__APPDIR__'
'@

$block = $block.Replace("__PYTHON__", $python).Replace("__APPDIR__", $AppDir)
if ($text.Trim() -eq "[]") {
  $new = $block.TrimStart()
} else {
  $new = $text.TrimEnd() + "`r`n" + $block
}
[System.IO.File]::WriteAllText($Profile, $new, [System.Text.UTF8Encoding]::new($false))
Write-Host "[tether] MCP entry added. Restart DeepSeek Harness, then ask its Agent to list Tether peers."