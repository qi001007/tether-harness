import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const source = read('packages/tether-ui/src/app.js')
const mainSource = read('apps/tether-app/main.js')
const preloadSource = read('apps/tether-app/preload.js')
const dshHostSource = read('packages/tether-ui/src/hosts/dsh.js')
const updateServiceSource = read('apps/tether-app/update-service.js')
const updateHelperSource = read('apps/tether-app/update-helper.js')
const installAppSource = read('desktop/install-app.ps1')
const supervisorSource = read('apps/tether-app/supervisor.js')
const appCmdSource = read('apps/tether-app/Tether-App.cmd')
const appVbsSource = read('apps/tether-app/Tether-App.vbs')
const nodeAgentSource = read('tether/node/agent.py')
const appRestartSource = read('tether/node/app_restart.py')

test('one click downloads every component before the first install and restarts once', () => {
  assert.match(source, /const plan = product === 'desktop'\s*\? \[\{ component: 'node', scope: nodeScope \}, \{ component: 'app', scope: null \}\]\s*: \[\{ component: 'localPlugin', scope: null \}\]/)
  assert.match(source, /for \(const step of plan\) \{[\s\S]*?prepared\[step\.component\] = await prepareUpdateComponent\(step\.component, step\.scope\)/)
  assert.match(source, /const order = product === 'desktop' \? \['node', 'app'\] : \['localPlugin'\]/)
  assert.match(source, /if \(!failure\) for \(const component of order\)/,
    'any failed prepare prevents applying the components that did prepare')
  assert.match(source, /product === 'desktop' \? \['app', 'node'\] : \['localPlugin'\]/,
    'the DSH product card stays an explicit standalone plugin update')
  assert.match(source, /for \(const component of order\) \{[\s\S]*?const entry = prepared\[component\]/)
  assert.match(source, /if \(!entry \|\| entry\.failed \|\| entry\.current \|\| entry\.inProgress \|\| !entry\.preparedId\) continue/)
  assert.ok(source.indexOf('prepared[step.component] = await prepareUpdateComponent') < source.indexOf('for (const component of order)'),
    'all downloads finish before the first apply')
  assert.match(source, /if \(result\.restart_deferred === true\) \{[\s\S]*?if \(!prepared\.app \|\| !prepared\.app\.preparedId\)/,
    'a node held for the APP restart is not restarted on its own')
  assert.match(source, /const reconnected = await watchAppRestart\(nodeScope, entry\.authority, entry\.expectedVersion\)/,
    'the deferred Node restart is confirmed after APP reconnects')
  assert.match(source, /else if \(prepared\.node && \(prepared\.node\.applied \|\| prepared\.node\.restartPending\)\) \{\s*const nodeReady = await watchNodeRestart\(nodeScope, entry\.authority, prepared\.node\.expectedVersion\)/,
    'the product confirms an applied or previously pending Node restart after APP reconnects')
})

test('external Node configuration skips spawn and does not expose a random local API', () => {
  assert.match(mainSource, /cfg\.nodeMode === 'external'[\s\S]*?env\.TETHER_NODE_MODE = cfg\.nodeMode/)
  assert.match(mainSource, /current\.nodeMode === 'external'[\s\S]*?nodeMode: 'external'/,
    'Hub config rewrites preserve the existing external Node selection')
  assert.match(mainSource, /localApi: supervisor\.remoteUrl && supervisor\.procs\.node/,
    'the local console token is only passed when this APP owns a Node process')
  assert.match(supervisorSource, /this\.nodeMode !== 'external' && \(this\.nodeToken \|\| this\.userToken\)/,
    'external mode leaves the separately managed Node in place')
})

test('a device one click prepares APP and Node before applying, keeping plugin separate', () => {
  assert.match(source, /export function deviceUpdateComponents\(capabilities = \{\}\) \{\s*return \['node', \.\.\.\(hasInstalledApp\(capabilities\) \? \['app'\] : \[\]\)\]/)
  assert.match(source, /const components = deviceUpdateComponents\(item\.capabilities\)\s*const prepared = \{\}\s*for \(const component of components\) \{[\s\S]*?prepared\[component\] = await prepareUpdateComponent\(component, scope\)/)
  assert.match(source, /for \(const component of \['node', 'app'\]\) \{/)
  assert.match(source, /if \(failures\.length\) break/)
  assert.match(source, /\.\.\.\(hasInstalledApp\(caps\) \? \['app'\] : \[\]\), 'node'/,
    'settings update rows show APP and Node only for remote devices')
  assert.match(source, /const reconnected = await watchAppRestart\(/)
  assert.match(source, /status\.current_version === expectedVersion && status\.restart_required !== true/,
    'APP reconnect is only confirmed after the trusted updater clears restart_required')
  assert.match(source, /else if \(prepared\.node && \(prepared\.node\.applied \|\| prepared\.node\.restartPending\)\) \{\s*const nodeReady = await watchNodeRestart\(scope, entry\.authority, prepared\.node\.expectedVersion\)/,
    'when APP manages the restart, a deferred Node apply is verified after APP reconnects')
  assert.ok(source.indexOf('prepared[component] = await prepareUpdateComponent(component, scope)') < source.indexOf("for (const component of ['node', 'app'])"),
    'a device run also downloads everything before installing')
})

test('a running update shows a determinate progress bar instead of a restart dialog', () => {
  assert.match(source, /const updateProgressBar = \(infos, active\) => \{/)
  assert.match(source, /role: 'progressbar'/)
  assert.match(source, /'aria-valuenow': percent/)
  assert.match(source, /updateProgressText\(progress\)/)
  assert.match(source, /downloading: '下载更新包'/)
  assert.match(source, /preparing: '校验更新包'/)
  assert.match(source, /installing: '安装更新'/)
  assert.match(source, /pill: '正在更新'/)
  assert.match(source, /updateProgressBar\(infos, active\)/)
  for (const removed of [
    'pendingApp', 'pendingDshRestart', 'dshRestartBusy', 'confirmDshRestart', 'updateOneClick',
    'transientUpdateError', 'checkUpdateWithRetry', "btn('稍后'", "btn('重启并安装'", "'APP 已下载'"
  ]) {
    assert.equal(source.includes(removed), false, 'the old dialog path is gone: ' + removed)
  }
  assert.equal((source.match(/btn\('立即生效'/g) || []).length, 1,
    'only the standalone local-plugin restart card keeps an inline action')
})

test('a second window attaches to a running install instead of failing it', () => {
  assert.match(source, /return !!\(info && \(info\.in_progress === true \|\| info\.status === 'in_progress'\)\)/)
  assert.match(source, /const running = options\.running === true \|\| list\.some\(updateInfoRunning\)/)
  assert.match(source, /if \(updateInfoRunning\(checked\)\) return \{ inProgress: true, checked \}/)
  assert.match(source, /if \(updateInfoRunning\(prepared\)\) return \{ inProgress: true, checked \}/)
  assert.match(source, /const waitForUpdateSettle = async \(component, scope, authority\) => \{/)
  assert.match(source, /if \(isUsableUpdateStatus\(status\) && !updateInfoRunning\(status\)\) return status/)
  assert.match(source, /const settled = await waitForUpdateSettle\(component, entry\.scope, entry\.authority\)\s*if \(!settled\) \{ failure = failure \|\| component \+ ' 更新仍在进行，尚未确认完成'; continue \}/)
  assert.match(source, /if \(updateInfoRunning\(result\)\) \{\s*const settled = await waitForUpdateSettle\(component, entry\.scope, entry\.authority\)/)
  assert.match(source, /if \(updateInfoRunning\(result\)\) \{\s*const settled = await waitForUpdateSettle\(component, scope, entry\.authority\)/)
})

test('a Node restart is not treated as complete from stale status or timeout', () => {
  assert.match(source, /const watchNodeRestart = async \(scope, authority, expectedVersion\)/)
  assert.match(source, /await loadUpdateInfo\('node', 'status', authority, scope\)/)
  assert.match(source, /target && target\.online && versionOk && isUsableUpdateStatus\(status\) && !status\.restart_required/)
  assert.match(source, /return false\s*\n\s*\}/,
    'timeout and a changed scope both fail instead of returning implicit success')
})

test('restart watchers use the version that prepare actually pinned', () => {
  assert.match(source, /const preparedRow = \(prepared\.prepared \|\| \[\]\)\.find\(\(item\) => item && item\.prepared_id === preparedId\)/)
  assert.match(source, /const expectedVersion = prepared\.to_version \|\| \(preparedRow && preparedRow\.to_version\) \|\| checked\.latest_version/)
  assert.match(source, /watchAppRestart\(scope, entry\.authority, entry\.expectedVersion\)/)
  assert.match(source, /watchNodeRestart\(entry\.scope, entry\.authority, entry\.expectedVersion\)/)
})

test('a deferred Node restart without an APP update remains pending for retry', () => {
  assert.match(source, /if \(result\.restart_deferred === true\) \{\s*if \(!prepared\.app \|\| !prepared\.app\.preparedId\) \{\s*failure = failure \|\| nodeRestartManualMessage/)
  assert.match(source, /if \(result\.restart_deferred === true\) \{\s*if \(!prepared\.app \|\| !prepared\.app\.preparedId\) \{\s*failures\.push\(nodeRestartManualMessage\)/)
})

test('a current Node with a pending restart is not reported complete', () => {
  assert.match(source, /if \(checked\.update_available !== true\) \{\s*if \(component !== 'node'\) return \{ current: true, checked \}\s*const status = await updateAction\('node', 'status'/)
  assert.match(source, /restartPending: nodeRestartIsPending\(scope, status\)/)
  assert.match(source, /status && status\.restart_required === true/)
  assert.match(source, /running !== installed/)
  assert.match(source, /prepared\.node\.restartPending\s*&& !\(prepared\.app && prepared\.app\.preparedId\)/)
  assert.match(source, /const nodeRestartManualMessage = 'Node 需要重启才能加载已安装版本；请在设备菜单中选择“重启 Node”'/)
})

test('an APP staged in the same run may recover the pending Node restart', () => {
  assert.match(source, /prepared\.node && prepared\.node\.restartPending\s*&& !\(prepared\.app && prepared\.app\.preparedId\)/)
  assert.match(source, /else if \(prepared\.node && \(prepared\.node\.applied \|\| prepared\.node\.restartPending\)\)/)
})

test('a local plugin apply that scheduled a DSH restart does not fall back to a manual button', () => {
  assert.match(source, /result\.restart_scheduled === true/)
  assert.match(source, /setNotice\('插件已安装，DSH 正在自动重启…'\)/)
  assert.match(source, /else await applyDshUpdate\(\)/)
  assert.equal(source.includes('setPendingDshRestart(true)'), false)
})

test('a one-click run owns the card until the final refresh finishes', () => {
  assert.match(source, /const \[updateRuns, setUpdateRuns\] = React\.useState\(\{\}\)/)
  assert.match(source, /const runKey = 'device:' \+ item\.device_id/)
  assert.match(source, /setUpdateRun\(runKey, \{ state: 'running' \}\)/)
  assert.match(source, /await refreshUpdateCenter\(true\)/)
  assert.match(source, /state: 'done'/)
  assert.match(source, /updateCardStateForInfos\(/)
  assert.equal(/runtimeRestartRequired\s*\? btn\('立即生效'/.test(source), false,
    'a pending restart must not hide an available one-click update')
  assert.match(source, /setInterval\(poll, runningUpdateKey \? 1200 : 4000\)/,
    'the progress bar refreshes while a run is installing')
})

test('the update center commits one normalized latest snapshot per refresh', () => {
  assert.match(source, /await Promise\.allSettled\(checks\)[\s\S]*normalizeUpdateLatest\(current\)/)
})

test('connection status is probed without opening the connection panel', () => {
  assert.match(source, /probeConfiguredHub\(\{ silent: true \}\)/)
  assert.match(source, /setInterval\(run, 15000\)/)
  assert.match(source, /if \(!document\.hidden\)/)
})

test('the APP clears the DSH origin session before reloading a restarted host', () => {
  assert.match(mainSource, /'tether:reset-surface-auth'/)
  assert.match(mainSource, /clearStorageData\(\{ origin: parsed\.origin, storages: \['cookies', 'localstorage', 'cachestorage'\] \}\)/)
  assert.match(preloadSource, /resetSurfaceAuth: \(origin\) => ipcRenderer\.invoke\('tether:reset-surface-auth', origin\)/)
  assert.match(source, /const resetSurfaceAuth = async \(url\) => \{/)
  assert.match(source, /await resetSurfaceAuth\(url\)/)
  assert.match(source, /await resetSurfaceAuth\(new URL\(data\.url\)\)/)
})

test('the local plugin updater prefers the Hub mirror when no stored hub exists', () => {
  assert.match(dshHostSource, /DSH_APP_BASE \+ '\/app-context'/)
  assert.ok(dshHostSource.includes("context.serverUrl.replace(/\\/+$/, '') + '/releases/manifest'"))
})

test('the shortcut and restart path launch Electron directly without a console', () => {
  assert.match(installAppSource, /\$Electron = Join-Path \$AppDir "node_modules\\electron\\dist\\electron\.exe"/)
  assert.match(installAppSource, /\$lnk\.TargetPath = \$Electron/)
  assert.match(installAppSource, /\$lnk\.Arguments = '"' \+ \$AppDir \+ '"'/)
  assert.equal(installAppSource.includes('Tether-App.cmd'), false)
  assert.equal(/explorer\.exe/i.test(installAppSource), false)

  assert.match(nodeAgentSource, /\[sys\.executable, "-m", "tether\.node\.app_restart", "--root", str\(root\)/)
  assert.match(nodeAgentSource, /creationflags=\(DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP \| CREATE_NO_WINDOW\)/)
  assert.equal(/explorer\.exe/i.test(nodeAgentSource), false)
  assert.equal(nodeAgentSource.includes('Tether-App.cmd'), false)

  assert.match(appRestartSource, /def electron_executable\(root: Path\) -> Path:\s*return root \/ "apps" \/ "tether-app" \/ "node_modules" \/ "electron" \/ "dist" \/ "electron\.exe"/)
  assert.match(appRestartSource, /\[str\(electron\), str\(app_dir\)\]/)
  assert.equal(appRestartSource.includes('explorer.exe'), false)
  assert.equal(appRestartSource.includes('Tether-App.cmd'), false)

  assert.match(updateServiceSource, /windowsHide: true/)
  assert.equal(updateServiceSource.includes('explorer.exe'), false)
  assert.match(updateHelperSource, /spawn\(config\.executable, config\.launchArgs/)
  assert.equal(updateHelperSource.includes('explorer.exe'), false)
  assert.equal(updateHelperSource.includes('Tether-App.cmd'), false)
  assert.ok(updateHelperSource.includes('windowsHide: true'), 'APP relaunch must not open a console')
  assert.equal(updateHelperSource.includes('windowsHide: false'), false)

  assert.match(supervisorSource, /this\.childPython = this\.python/)
  assert.match(supervisorSource, /pythonw\.exe/)
  assert.match(supervisorSource, /this\.spawnChild\(this\.childPython, args/)
  assert.match(supervisorSource, /spawnSync\(this\.childPython, \['-c'/)
  assert.match(mainSource, /new UpdateService\(\{ repoRoot, dataDir, python: supervisor\.childPython, env, app \}\)/)
  assert.match(appCmdSource, /if \/i not "%~1"=="--hidden"/)
  assert.match(appCmdSource, /wscript \/\/nologo .*Tether-App\.vbs/)
  assert.match(appCmdSource, /-WindowStyle Hidden/)
  assert.match(appVbsSource, /Tether-App\.cmd"" --hidden/)
})
