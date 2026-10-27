param(
    [switch]$Apply,
    [switch]$DryRun,
    [switch]$NodeOnly
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $DryRun) { throw 'Choose either -DryRun or -Apply.' }
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$StateUrl = 'http://127.0.0.1:18890/api/state'
$Workspace = Join-Path $Root 'work-local'
$Logs = Join-Path $Root '.runtime\service-logs'

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Workspace Python interpreter not found: $Python"
}

$ProcessHelper = @'
import json, os, sys
import psutil

root = os.path.normcase(os.path.realpath(sys.argv[1]))
apply = sys.argv[2] == "1"
node_only = sys.argv[3] == "1"
def inspect(p):
    try:
        info = p.as_dict(attrs=["pid", "name", "cmdline", "cwd"])
        info["cmdline"] = info.get("cmdline") or []
        info["name"] = info.get("name") or ""
        info["cwd"] = os.path.normcase(os.path.realpath(info.get("cwd") or ""))
        return info
    except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
        return None
def is_python(info):
    return info and info["name"].lower().startswith("python")
def flag_value(args, flag):
    try: return args[args.index(flag) + 1]
    except (ValueError, IndexError): return None
def role(info):
    if not is_python(info) or info["cwd"] != root: return None
    args = info["cmdline"]
    if ("-m" in args and "tether.node.agent" in args and
        flag_value(args, "--device") == "DESKTOP-LOCAL"):
        return "node"
    if ("-m" in args and "uvicorn" in args and "tether.controller.app:app" in args and
        flag_value(args, "--port") == "18890"):
        return "controller"
    return None
def owned_python_descendants(proc):
    result = []
    try: descendants = proc.children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied): return result
    for child in descendants:
        info = inspect(child)
        if not is_python(info) or info["cwd"] != root: continue
        command = " ".join(info["cmdline"]).lower()
        if "deepseek" in command or "dsh" in command: continue
        result.append(child)
    return result

matches = []
for proc in psutil.process_iter():
    info = inspect(proc)
    found_role = role(info)
    if found_role and (not node_only or found_role == "node"):
        matches.append((found_role, proc, owned_python_descendants(proc)))

report = [{"role": role_name, "pid": proc.pid, "child_pids": [child.pid for child in children]}
          for role_name, proc, children in matches]
if apply:
    ordered = []
    seen = set()
    for _, proc, children in matches:
        for child in reversed(children):
            if child.pid not in seen: ordered.append(child); seen.add(child.pid)
        if proc.pid not in seen: ordered.append(proc); seen.add(proc.pid)
    for proc in ordered:
        try: proc.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied): pass
    _, alive = psutil.wait_procs(ordered, timeout=5)
    for proc in alive:
        try: proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied): pass
    psutil.wait_procs(alive, timeout=3)
print(json.dumps(report, separators=(",", ":")))
'@

$NodeOnlyMode = if ($NodeOnly) { '1' } else { '0' }
function Invoke-ProcessHelper([string]$ApplyFlag, [string]$Phase) {
    $HelperPath = Join-Path ([IO.Path]::GetTempPath()) ("tether-process-helper-" + [guid]::NewGuid().ToString('N') + ".py")
    try {
        [IO.File]::WriteAllText($HelperPath, $ProcessHelper, [Text.UTF8Encoding]::new($false))
        & $Python $HelperPath $Root $ApplyFlag $NodeOnlyMode
        if ($LASTEXITCODE -ne 0) { throw "Could not $Phase local service processes with psutil." }
    } finally {
        Remove-Item -LiteralPath $HelperPath -ErrorAction SilentlyContinue
    }
}
$RawTargets = Invoke-ProcessHelper '0' 'inspect'
$Targets = $RawTargets | ConvertFrom-Json
if ($null -eq $Targets) { $Targets = @() }
elseif ($Targets -isnot [System.Array]) { $Targets = @($Targets) }

$ActiveStates = @('queued', 'dispatching', 'running', 'cancelling')
$State = $null
$StateError = $null
try {
    $State = Invoke-RestMethod -Uri $StateUrl -Method Get -TimeoutSec 3
} catch {
    $StateError = $_.Exception.Message
}
$ActiveRuns = @()
if ($null -ne $State) {
    $ActiveRuns = @($State.runs | Where-Object { $ActiveStates -contains [string]$_.state })
}

Write-Output "Mode: $(if ($Apply) { 'Apply' } else { 'DryRun' }); NodeOnly: $([bool]$NodeOnly)"
if ($NodeOnly) { Write-Output 'Scope: DESKTOP-LOCAL Node only; Controller will not be restarted.' }
if ($State) {
    Write-Output "Controller state: reachable; active runs: $($ActiveRuns.Count)"
} else {
    Write-Output "Controller state: unavailable"
}
if ($Targets.Count -eq 0) {
    Write-Output 'Matching workspace service processes: none'
} else {
    foreach ($Target in $Targets) {
        Write-Output ("Matched {0} launcher PID {1}; scoped Python child PIDs: {2}" -f `
            $Target.role, $Target.pid, (($Target.child_pids -join ', ') -replace '^$', 'none'))
    }
}

if (-not $Apply) {
    Write-Output 'DryRun only: no processes stopped and no services started.'
    return
}
if (-not $State) {
    throw 'Refusing to restart because GET /api/state did not return successfully.'
}
if ($ActiveRuns.Count -gt 0) {
    throw "Refusing to restart while $($ActiveRuns.Count) active run(s) exist."
}

Invoke-ProcessHelper '1' 'stop' | Out-Null

New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$ControllerOut = Join-Path $Logs "controller-$Stamp.out.log"
$ControllerErr = Join-Path $Logs "controller-$Stamp.err.log"
$NodeOut = Join-Path $Logs "node-$Stamp.out.log"
$NodeErr = Join-Path $Logs "node-$Stamp.err.log"
if ($NodeOnly) {
    $Deadline = [DateTime]::UtcNow.AddSeconds(15)
    $Healthy = $false
    while ([DateTime]::UtcNow -lt $Deadline) {
        try {
            $null = Invoke-RestMethod -Uri $StateUrl -Method Get -TimeoutSec 1
            $Healthy = $true
            break
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if (-not $Healthy) {
        throw 'Retained Controller health check failed within 15 seconds; Node was not started.'
    }
} else {
    $env:TETHER_HOST = '0.0.0.0'
    $env:TETHER_PORT = '18890'
    $env:TETHER_DEVICE = 'DESKTOP-LOCAL'
    $env:TETHER_CONTROLLER = 'ws://127.0.0.1:18890/ws/node'
    $env:TETHER_AGENT = 'dsh'

    $Controller = Start-Process -FilePath $Python -ArgumentList @(
        '-m', 'uvicorn', 'tether.controller.app:app', '--host', '0.0.0.0', '--port', '18890',
        '--ws-max-size', '16777216', '--log-level', 'info'
    ) -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $ControllerOut -RedirectStandardError $ControllerErr
    Write-Output "Started Controller PID $($Controller.Id)"

    $Deadline = [DateTime]::UtcNow.AddSeconds(15)
    $Healthy = $false
    while ([DateTime]::UtcNow -lt $Deadline) {
        try {
            $null = Invoke-RestMethod -Uri $StateUrl -Method Get -TimeoutSec 1
            $Healthy = $true
            break
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if (-not $Healthy) {
        throw "Controller health check failed within 15 seconds; see $ControllerOut and $ControllerErr"
    }
}

$Node = Start-Process -FilePath $Python -ArgumentList @(
    '-m', 'tether.node.agent', '--workspace', $Workspace, '--agent', 'dsh',
    '--device', 'DESKTOP-LOCAL', '--controller', 'ws://127.0.0.1:18890/ws/node'
) -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $NodeOut -RedirectStandardError $NodeErr
Write-Output "Started Node PID $($Node.Id)"
Write-Output "Logs: $Logs"
