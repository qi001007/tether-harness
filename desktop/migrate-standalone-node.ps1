[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Plan','Switch','Confirm','Rollback')] [string]$Action = 'Plan',
    [string]$AppExe,
    [string]$AppDataDir,
    [string]$LegacyRoot,
    [int]$WaitForAppExit,
    [switch]$OwnerActivityVerified,
    [switch]$HubOnlineVerified,
    [ValidateRange(15,600)] [int]$StartupTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$utf8 = [Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $utf8 } catch { }
$legacyTaskNames = @('TetherNode','TetherNodeWatchdog')
$retainedEnvironment = @(
    'DSH_HOME','DSH_PROVIDER','DSH_MODEL','TETHER_WORKSPACES_ROOT','TETHER_CROC_RELAY',
    'TETHER_MESH_QUIC_NETWORK','TETHER_MESH_MEMBER_WSS','TETHER_UPDATE_CHANNEL','TETHER_UPDATE_MANIFEST_URL',
    'RCLONE_MULTI_THREAD_CUTOFF','RCLONE_MULTI_THREAD_CHUNK_SIZE','RCLONE_MULTI_THREAD_STREAMS'
)

function Fail([string]$Code) { throw "TETHER_MIGRATION_$Code" }

function Local-Path([string]$Path, [switch]$File) {
    if (!$Path -or $Path -notmatch '^[A-Za-z]:\\') { Fail 'NOT_ABSOLUTE_LOCAL_PATH' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -eq [bool]$File) { Fail 'LOCAL_PATH_WRONG_TYPE' }
    $item.FullName
}

function Physical-Path([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    for ($hop = 0; $hop -lt 16; $hop++) {
        $root = [IO.Path]::GetPathRoot($full)
        $parts = @($full.Substring($root.Length).Split('\',[StringSplitOptions]::RemoveEmptyEntries))
        $current = $root
        $redirected = $false
        for ($index = 0; $index -lt $parts.Count; $index++) {
            $current = Join-Path $current $parts[$index]
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { continue }
            $target = [string]@($item.Target)[0]
            if ($item.LinkType -notin @('Junction','SymbolicLink') -or !$target) { Fail 'REPARSE_PATH_UNVERIFIED' }
            $target = $target -replace '^(?:\\\?\?\\|\\\\\?\\)',''
            if (![IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path $current -Parent) $target }
            for ($rest = $index + 1; $rest -lt $parts.Count; $rest++) { $target = Join-Path $target $parts[$rest] }
            $full = [IO.Path]::GetFullPath($target)
            if ($full -notmatch '^[A-Za-z]:\\') { Fail 'REPARSE_PATH_UNVERIFIED' }
            $redirected = $true
            break
        }
        if (!$redirected) { return $full }
    }
    Fail 'REPARSE_PATH_LOOP'
}

function Same-PhysicalPath([string]$First,[string]$Second) {
    if (!$First -or !$Second) { return $false }
    if ($First -eq $Second) { return $true }
    try { (Physical-Path $First) -eq (Physical-Path $Second) } catch { $false }
}

function Argument([string]$Command,[string]$Name) {
    $flag = [regex]::Escape($Name)
    $match = [regex]::Match($Command, "(?:^|\s)$flag(?:=|\s+)(?:\x22([^\x22]*)\x22|(\S+))")
    if ($match.Success) { $match.Groups[1].Value + $match.Groups[2].Value }
}

function User-Processes([string]$Filter) {
    foreach ($process in Get-CimInstance Win32_Process -Filter $Filter) {
        try {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
            if ($owner.ReturnValue -eq 0 -and $owner.Sid -eq $ownerSid) { $process }
        } catch { }
    }
}

function App-Processes([string]$Path) {
    User-Processes "Name='Tether.exe'" | Where-Object {
        $_.CommandLine -notmatch '(?:^|\s)--type[=\s]' -and (Same-PhysicalPath $_.ExecutablePath $Path)
    }
}

function Hub-Base([string]$Value) {
    $uri = $null
    if (![uri]::TryCreate($Value,[UriKind]::Absolute,[ref]$uri) -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { Fail 'HUB_URL_INVALID' }
    $scheme = @{wss='https';https='https';ws='http';http='http'}[$uri.Scheme]
    if (!$scheme -or ($scheme -eq 'http' -and !$uri.IsLoopback)) { Fail 'HUB_URL_INVALID' }
    ($scheme + '://' + $uri.Authority + $uri.AbsolutePath.TrimEnd('/')) -replace '/ws/node$',''
}

function Read-Json([string]$Path) {
    try { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { Fail 'LOCAL_JSON_INVALID' }
}

function Write-Atomic([string]$Path,[byte[]]$Bytes) {
    $temp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllBytes($temp,$Bytes)
    if (Test-Path -LiteralPath $Path -PathType Leaf) { [IO.File]::Replace($temp,$Path,$null) }
    else { [IO.File]::Move($temp,$Path) }
}

function Write-Json([string]$Path,$Value) {
    Write-Atomic $Path ($utf8.GetBytes(($Value | ConvertTo-Json -Depth 15)))
}

function Result($Value) {
    try { [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 8 -Compress)); [Console]::Out.Flush() } catch { }
}

function Task-Owner($Task) {
    $principal = $Task.Principal.UserId
    try {
        if ($principal -match '^S-1-') { return $principal }
        ([Security.Principal.NTAccount]$principal).Translate([Security.Principal.SecurityIdentifier]).Value
    } catch { Fail 'TASK_OWNER_UNVERIFIED' }
}

function Find-StartupTasks([string]$Root,[string]$Database) {
    $dataRoot = Split-Path (Split-Path $Database -Parent) -Parent
    $tasks = @(Get-ScheduledTask -TaskName $legacyTaskNames -ErrorAction SilentlyContinue)
    if (!$tasks.Count) { Fail 'LEGACY_TASK_NOT_FOUND' }
    foreach ($task in $tasks) {
        if ((Task-Owner $task) -ne $ownerSid) { Fail 'LEGACY_TASK_WRONG_OWNER' }
        $matchesNode = $false
        foreach ($entry in $task.Actions) {
            if ($entry.Execute -like "$Root\*" -or $entry.WorkingDirectory -eq $Root) { $matchesNode = $true }
            $references = [regex]::Matches([string]$entry.Arguments,'(?i)[A-Za-z]:\\[^\x22\x27\r\n]*?\.(?:ps1|py|cmd|bat)(?=\s|[\x22\x27]|$)')
            foreach ($ref in $references) {
                $path = $ref.Value
                if (($path -like "$Root\*" -or $path -like "$dataRoot\*") -and
                    (Test-Path -LiteralPath $path -PathType Leaf) -and
                    ((Get-Content -LiteralPath $path -Raw) -match 'tether[.]node[.]agent|watchdog-node|tether-node')) { $matchesNode = $true }
            }
        }
        if (!$matchesNode) { Fail 'LEGACY_TASK_ACTION_UNVERIFIED' }
        $logon = [bool]($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
        [pscustomobject]@{name=$task.TaskName; path=$task.TaskPath; enabled=[bool]$task.Settings.Enabled; atLogon=$logon}
    }
}

function Read-Dotenv([string]$Root) {
    $values = @{}
    $path = Join-Path $Root '.env'
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'LEGACY_ENV_IS_LINK' }
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -notmatch '^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$') { continue }
        $key,$value = $Matches[1],$Matches[2].Trim()
        if ($value.Length -ge 2 -and $value[0] -in @('"',"'") -and $value[0] -eq $value[-1]) { $value = $value.Substring(1,$value.Length-2) }
        $values[$key] = $value
    }
    $values
}

function Local-NodeState([int]$Port) {
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/state" -TimeoutSec 4 -UseBasicParsing }
    catch { $null }
}

function Legacy-Plan($Config,[string]$RootOverride) {
    if (!$Config.device -or !$Config.url -or $Config.nodeMode -eq 'managed') { Fail 'EXISTING_EXTERNAL_PAIRING_REQUIRED' }
    $candidates = @(
        foreach ($p in User-Processes "Name='python.exe' OR Name='pythonw.exe' OR Name='tether-python.exe'") {
            if ($p.CommandLine -notmatch '(?:^|\s)-m\s+tether[.]node[.]agent(?:\s|$)') { continue }
            $port = Argument $p.CommandLine '--console-port'
            if ($port -notmatch '^\d{1,5}$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { continue }
            $listeners = @(Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue)
            if ($p.ProcessId -notin $listeners.OwningProcess) { continue }
            $snapshot = Local-NodeState $port
            if ($snapshot -and ($snapshot.device -ceq $Config.device -or $snapshot.device_id -ceq $Config.device)) {
                [pscustomobject]@{process=$p; port=[int]$port; snapshot=$snapshot}
            }
        }
    )
    if ($candidates.Count -ne 1) { Fail 'LEGACY_IDENTITY_NOT_UNIQUE' }
    $node = $candidates[0]
    $command = $node.process.CommandLine
    $exe = Local-Path $node.process.ExecutablePath -File
    $launcher = $exe
    if ($exe -notmatch '(?i)\\\.venv\\Scripts\\pythonw?\.exe$') {
        $parent = User-Processes "ProcessId=$($node.process.ParentProcessId)" | Select-Object -First 1
        if ($parent -and $parent.ExecutablePath -match '(?i)\\\.venv\\Scripts\\pythonw?\.exe$' -and
            $parent.CreationDate -le $node.process.CreationDate -and
            $parent.CommandLine -match '(?:^|\s)-m\s+tether[.]node[.]agent(?:\s|$)' -and
            (Argument $parent.CommandLine '--console-port') -eq [string]$node.port -and
            (Argument $parent.CommandLine '--workspace') -eq (Argument $command '--workspace') -and
            (Argument $parent.CommandLine '--db') -eq (Argument $command '--db')) {
            $launcher = Local-Path $parent.ExecutablePath -File
        }
    }
    if (!$RootOverride -and $launcher -match '(?i)^(.*)\\\.venv\\Scripts\\pythonw?\.exe$') { $RootOverride = $Matches[1] }
    if (!$RootOverride) { Fail 'LEGACY_ROOT_REQUIRED' }
    $root = Local-Path $RootOverride
    if (!$launcher.StartsWith("$root\",[StringComparison]::OrdinalIgnoreCase)) { Fail 'LEGACY_ROOT_MISMATCH' }
    $dbArg = Argument $command '--db'
    if (!$dbArg) { $dbArg = Join-Path $root '.runtime\node-local.db' }
    $database = Local-Path $dbArg -File
    $workspace = Local-Path (Argument $command '--workspace')
    $tasks = @(Find-StartupTasks $root $database)
    if (!($tasks | Where-Object enabled)) { Fail 'LEGACY_STARTUP_TASK_DISABLED' }
    $legacy = Read-Dotenv $root
    $device = Argument $command '--device'
    if (!$device) { $device = $legacy.TETHER_DEVICE }
    $hub = Argument $command '--controller'
    if (!$hub) { $hub = $legacy.TETHER_CONTROLLER }
    if (!$hub) { $hub = $legacy.TETHER_CONTROLLER_URL }
    $token = $legacy.TETHER_NODE_TOKEN
    if ($device -cne $Config.device -or (Hub-Base $hub) -ne (Hub-Base $Config.url) -or !$token -or
        ($Config.nodeToken -and $Config.nodeToken -cne $token)) { Fail 'LEGACY_PAIRING_MISMATCH' }
    $environment = [ordered]@{}
    foreach ($key in $retainedEnvironment) { if ($legacy[$key]) { $environment[$key] = $legacy[$key] } }
    $dshHome = Argument $command '--dsh-home'
    if ($dshHome) { $environment['DSH_HOME'] = Local-Path $dshHome }
    $localToken = Argument $command '--local-api-token'
    if (!$localToken) { $localToken = $legacy.TETHER_LOCAL_API_TOKEN }
    if ($localToken -and $localToken -notmatch '^\S{32,}$') { Fail 'LOCAL_API_TOKEN_INVALID' }
    $managed = [ordered]@{workspace=$workspace; database=$database; environment=$environment; consolePort=$node.port}
    if ($localToken) { $managed['localApiToken'] = $localToken }
    [pscustomobject]@{root=$root; executable=$exe; launcher=$launcher; process=$node.process; tasks=$tasks; snapshot=$node.snapshot; managed=$managed; token=$token}
}

function Managed-Processes($State) {
    $exe = Join-Path (Split-Path $State.appExe -Parent) 'resources\tether-runtime\tether-python.exe'
    User-Processes "Name='tether-python.exe'" | Where-Object {
        (Same-PhysicalPath $_.ExecutablePath $exe) -and
        (Same-PhysicalPath (Argument $_.CommandLine '--db') $State.database) -and
        (Same-PhysicalPath (Argument $_.CommandLine '--workspace') $State.workspace)
    }
}

function Managed-Health($State) {
    $snapshot = Local-NodeState $State.port
    if (!$snapshot -or ($snapshot.device -cne $State.device -and $snapshot.device_id -cne $State.device)) { return $false }
    $listener = @(Get-NetTCPConnection -LocalPort $State.port -State Listen -ErrorAction SilentlyContinue)
    $verified = @(Managed-Processes $State | Where-Object ProcessId -In $listener.OwningProcess)
    $verified.Count -eq 1 -and [bool](App-Processes $State.appExe)
}

function Start-App([string]$Path) {
    if (!(App-Processes $Path)) { Start-Process -FilePath $Path -WorkingDirectory (Split-Path $Path -Parent) -WindowStyle Hidden }
}

function Wait-AppShutdown([string]$Path,[int]$ExpectedPid,[switch]$Notify) {
    $running = @(App-Processes $Path)
    if (!$running.Count) { return }
    if (!$ExpectedPid -or $running.Count -ne 1 -or $running[0].ProcessId -ne $ExpectedPid) { Fail 'APP_MUST_EXIT_NORMALLY' }
    if ($Notify) {
        [Console]::Out.WriteLine('TETHER_MIGRATION_READY')
        [Console]::Out.Flush()
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 350
        if (!(App-Processes $Path)) { return }
    } while ([DateTime]::UtcNow -lt $deadline)
    Fail 'APP_DID_NOT_EXIT'
}

function Rollback-Local($State,[string]$ConfigPath) {
    if (App-Processes $State.appExe) { Fail 'APP_MUST_EXIT_NORMALLY' }
    Managed-Processes $State | ForEach-Object { Stop-Process -Id $_.ProcessId }
    Write-Atomic $ConfigPath ([IO.File]::ReadAllBytes($State.backup))
    foreach ($task in $State.tasks) {
        $registered = Get-ScheduledTask -TaskName $task.name -TaskPath $task.path
        if ((Task-Owner $registered) -ne $ownerSid) { Fail 'LEGACY_TASK_WRONG_OWNER' }
        if ($task.enabled) { Enable-ScheduledTask -TaskName $task.name -TaskPath $task.path | Out-Null }
    }
    if (!(Local-NodeState $State.port)) {
        $starter = $State.tasks | Where-Object enabled | Sort-Object name | Select-Object -First 1
        Start-ScheduledTask -TaskName $starter.name -TaskPath $starter.path
    }
    Start-App $State.appExe
}

function Verify-Online($Config,$State) {
    $token = if ($Config.accessToken) { $Config.accessToken } else { $Config.userToken }
    if (!$token) { return $false }
    try {
        $response = Invoke-RestMethod -Uri ((Hub-Base $Config.url) + '/api/state') -Headers @{Authorization="Bearer $token"} -MaximumRedirection 0 -TimeoutSec 8 -UseBasicParsing
        [bool]($response.devices | Where-Object { $_.device_id -ceq $State.device -and $_.online -eq $true -and
            $_.capabilities.node_update_owner -eq 'app_installer' -and $_.capabilities.app_update_bridge_available -eq $true -and
            $_.capabilities.node_version -eq $State.expectedVersion -and $_.capabilities.app_version -eq $State.expectedVersion })
    } catch { $false }
}

$mutex = $null
$locked = $false
try {
    if (!$AppDataDir) {
        $AppDataDir = if ($env:TETHER_APP_DATA_DIR) { $env:TETHER_APP_DATA_DIR }
        else { Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Tether\data' }
    }
    $AppDataDir = Local-Path $AppDataDir
    $configPath = Join-Path $AppDataDir 'hub.json'
    $ownDefault = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Tether\data'
    $config = Get-Item -LiteralPath $configPath -Force
    if ($config.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'APP_CONFIG_IS_LINK' }
    if (!(Same-PhysicalPath $AppDataDir $ownDefault) -and !(Same-PhysicalPath $AppDataDir $env:TETHER_APP_DATA_DIR)) {
        $configOwner = (Get-Acl -LiteralPath $configPath).GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($configOwner -ne $ownerSid) { Fail 'APP_CONFIG_WRONG_OWNER' }
    }
    $journalDir = Join-Path $AppDataDir 'private'
    $journalPath = Join-Path $journalDir 'standalone-node-migration.json'
    if ($Action -ne 'Plan') {
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $scope = [BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes((Physical-Path $AppDataDir).ToLowerInvariant() + $ownerSid))).Replace('-','') }
        finally { $hasher.Dispose() }
        $mutex = [Threading.Mutex]::new($false, ('Local\TetherNodeMigration-' + $scope))
        try { $locked = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $locked = $true }
        if (!$locked) { Fail 'MIGRATION_ALREADY_RUNNING' }
    }
    $journal = if (Test-Path -LiteralPath $journalPath -PathType Leaf) { Read-Json $journalPath }
    if ($journal -and $journal.owner -ne $ownerSid) { Fail 'JOURNAL_WRONG_OWNER' }
    if ($Action -eq 'Rollback') {
        if (!$journal -or $journal.phase -eq 'rolled_back') { Result @{status='already_rolled_back'}; return }
        if (!$OwnerActivityVerified) { Fail 'OWNER_IDLE_EVIDENCE_REQUIRED' }
        if ($PSCmdlet.ShouldProcess($journal.device,'Restore the previous Tether Node and configuration')) {
            Wait-AppShutdown $journal.appExe $WaitForAppExit -Notify
            Rollback-Local $journal $configPath
            $journal.phase = 'rolled_back'
            Write-Json $journalPath $journal
            Result @{status=$journal.phase; device=$journal.device}
        }
        return
    }
    $config = Read-Json $configPath
    if ($Action -eq 'Confirm' -or ($Action -eq 'Switch' -and $journal.phase -in @('awaiting_online','complete'))) {
        if (!$journal -or $journal.phase -notin @('awaiting_online','complete') -or
            $config.device -cne $journal.device -or $config.nodeMode -ne 'managed' -or
            $config.managedNode.database -ne $journal.database -or !(Managed-Health $journal)) { Fail 'MANAGED_HEALTH_UNVERIFIED' }
        $online = if ($Action -eq 'Confirm') {
            if (Verify-Online $config $journal) { 'configured_hub_session' }
            elseif ($HubOnlineVerified) { 'confirmed_owner_session' }
        }
        if ($online -and $PSCmdlet.ShouldProcess($journal.device,'Accept the online managed Node')) {
            $journal.phase = 'complete'
            Write-Json $journalPath $journal
        }
        Result @{status=$journal.phase; device=$journal.device; hub_verification=$online; legacy_files_retained=$true}
        return
    }
    if ($journal -and $journal.phase -ne 'rolled_back') { Fail 'PREVIOUS_SWITCH_REQUIRES_ROLLBACK' }
    if (!$AppExe) {
        $paths = @(User-Processes "Name='Tether.exe'" | Where-Object {
            $_.CommandLine -notmatch '(?:^|\s)--type[=\s]'
        } | Select-Object -ExpandProperty ExecutablePath -Unique)
        if ($paths.Count -ne 1) { Fail 'APP_PATH_REQUIRED' }
        $AppExe = $paths[0]
    }
    $AppExe = Local-Path $AppExe -File
    if ((Split-Path $AppExe -Leaf) -ne 'Tether.exe') { Fail 'APP_PATH_INVALID' }
    $appVersion = (Get-Item -LiteralPath $AppExe).VersionInfo.ProductVersion
    $versionMatch = [regex]::Match([string]$appVersion,'^\d+\.\d+\.\d+')
    $packagedNode = Join-Path (Split-Path $AppExe -Parent) 'resources\tether-runtime\tether-python.exe'
    $ready = $versionMatch.Success -and [version]$versionMatch.Value -ge [version]'0.5.12' -and
        (Test-Path -LiteralPath $packagedNode -PathType Leaf)
    $plan = Legacy-Plan $config $LegacyRoot
    $busy = [bool]($plan.snapshot.runs | Where-Object { $_.state -in @('queued','dispatching','running','cancelling') })
    if ($Action -eq 'Plan') {
        Result ([ordered]@{status='plan'; device=$config.device; app=$AppExe; app_version=$appVersion;
            switch_ready=($ready -and !$busy); legacy_executable=$plan.launcher; listener_executable=$plan.executable; tasks=$plan.tasks;
            workspace=$plan.managed.workspace; database=$plan.managed.database; console_port=$plan.managed.consolePort;
            retained_environment_keys=@($plan.managed.environment.Keys); node_runs_active=$busy})
        return
    }
    if (!$ready) { Fail 'PACKAGED_APP_0512_REQUIRED' }
    if ($busy -or !$OwnerActivityVerified) { Fail 'OWNER_IDLE_EVIDENCE_REQUIRED' }
    if (!$PSCmdlet.ShouldProcess($config.device,'Replace legacy startup with the installed App-managed Node')) { return }
    $expectedConfigHash = (Get-FileHash -LiteralPath $configPath).Hash
    Wait-AppShutdown $AppExe $WaitForAppExit -Notify
    $state = $null
    try {
        $snapshot = Local-NodeState $plan.managed.consolePort
        if (!$snapshot -or ($snapshot.runs | Where-Object { $_.state -in @('queued','dispatching','running','cancelling') })) { Fail 'NODE_BUSY_OR_UNAVAILABLE' }
        if ((Get-FileHash -LiteralPath $configPath).Hash -ne $expectedConfigHash) { Fail 'APP_CONFIG_CHANGED_DURING_HANDOFF' }
        New-Item -ItemType Directory -Force -Path $journalDir | Out-Null
        $backup = Join-Path $journalDir ("standalone-node-hub-$([guid]::NewGuid().ToString('N')).json")
        Copy-Item -LiteralPath $configPath -Destination $backup
        Set-Acl -LiteralPath $backup -AclObject (Get-Acl -LiteralPath $configPath)
        $state = [pscustomobject]@{owner=$ownerSid; phase='switching'; device=$config.device; backup=$backup; expectedVersion=$versionMatch.Value;
            appExe=$AppExe; database=$plan.managed.database; workspace=$plan.managed.workspace;
            port=$plan.managed.consolePort; tasks=$plan.tasks;
            hadLogonTask=[bool]($plan.tasks | Where-Object { $_.enabled -and $_.atLogon })}
        Write-Json $journalPath $state
        foreach ($task in $plan.tasks) {
            Disable-ScheduledTask -TaskName $task.name -TaskPath $task.path | Out-Null
            if ((Get-ScheduledTask -TaskName $task.name -TaskPath $task.path).State -eq 'Running') {
                Stop-ScheduledTask -TaskName $task.name -TaskPath $task.path
            }
        }
        $old = User-Processes "ProcessId=$($plan.process.ProcessId)" | Select-Object -First 1
        if ($old -and ($old.CreationDate -ne $plan.process.CreationDate -or !(Same-PhysicalPath $old.ExecutablePath $plan.executable))) {
            Fail 'LEGACY_PROCESS_CHANGED'
        }
        if ($old) { Stop-Process -Id $old.ProcessId -Force -ErrorAction SilentlyContinue }
        # The legacy Node can be a launcher shim plus a child interpreter. Stop the
        # whole tree; stopping only the listener lets the shim respawn it and keeps
        # the console port bound, which used to abort this migration after the
        # scheduled task had already been disabled.
        $legacyTree = @(User-Processes "Name='pythonw.exe' or Name='python.exe' or Name='tether-python.exe'" | Where-Object {
            (Same-PhysicalPath $_.ExecutablePath $plan.launcher) -or
            (Same-PhysicalPath $_.ExecutablePath $plan.executable) -or
            (([string]$_.CommandLine) -match 'tether\.node\.agent' -and
             (([string]$_.CommandLine) -match [regex]::Escape([string]$state.workspace) -or
              ([string]$_.CommandLine) -match ('--console-port\s+' + [regex]::Escape([string]$state.port))))
        })
        foreach ($legacyProcess in $legacyTree) {
            if ($legacyProcess.ProcessId -ne $PID) { Stop-Process -Id $legacyProcess.ProcessId -Force -ErrorAction SilentlyContinue }
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            $listeners = @(Get-NetTCPConnection -LocalPort $state.port -State Listen -ErrorAction SilentlyContinue)
            if (!$listeners.Count) { break }
            foreach ($listener in $listeners) {
                $ownerProcess = User-Processes "ProcessId=$($listener.OwningProcess)" | Select-Object -First 1
                if ($ownerProcess -and ((Same-PhysicalPath $ownerProcess.ExecutablePath $plan.launcher) -or
                    (Same-PhysicalPath $ownerProcess.ExecutablePath $plan.executable) -or
                    (([string]$ownerProcess.CommandLine) -match 'tether\.node\.agent'))) {
                    Stop-Process -Id $ownerProcess.ProcessId -Force -ErrorAction SilentlyContinue
                } else {
                    Fail 'OLD_CONSOLE_STILL_BOUND'
                }
            }
            Start-Sleep -Milliseconds 400
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($listeners.Count) { Fail 'OLD_CONSOLE_STILL_BOUND' }
        $next = [ordered]@{}
        foreach ($property in $config.PSObject.Properties) { $next[$property.Name] = $property.Value }
        $next['nodeMode'] = 'managed'
        $next['nodeToken'] = $plan.token
        $next['managedNode'] = $plan.managed
        Write-Json $configPath $next
        Start-App $AppExe
        $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
        do {
            if (Managed-Health $state) { break }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!(Managed-Health $state)) { Fail 'MANAGED_START_FAILED' }
        $state.phase = 'awaiting_online'
        Write-Json $journalPath $state
        Result @{status=$state.phase; device=$state.device; legacy_files_retained=$true; workspace=$state.workspace; database=$state.database}
    } catch {
        if (!$state) { Start-App $AppExe; throw }
        if (App-Processes $AppExe) {
            $state.phase = 'rollback_requested'
            Write-Json $journalPath $state
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            while ((App-Processes $AppExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
            if (App-Processes $AppExe) { Fail 'SWITCH_REQUIRES_NORMAL_APP_EXIT_FOR_ROLLBACK' }
        }
        Rollback-Local $state $configPath
        $state.phase = 'rolled_back'
        Write-Json $journalPath $state
        Fail 'SWITCH_FAILED_AND_ROLLED_BACK'
    }
} catch {
    $safe = if ($_.Exception.Message -match '^TETHER_MIGRATION_[A-Z0-9_]+$') { $_.Exception.Message } else { 'TETHER_MIGRATION_OPERATION_FAILED' }
    try { [Console]::Error.WriteLine($safe) } catch { }
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
