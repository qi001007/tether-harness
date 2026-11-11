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
  assert.match(source, /const plan = product === 'desktop'\s*\? \[\.\.\.\(localCapabilities\.node_self_update_enabled === false \? \[\] : \[\{ component: 'node', scope: nodeScope \}\]\), \{ component: 'app', scope: null \}\]\s*: \[\{ component: 'localPlugin', scope: null \}\]/,
    'the desktop plan omits a Node self-update owned by an installer and always includes APP')
  assert.match(source, /for \(const step of plan\) \{[\s\S]*?prepared\[step\.component\] = await prepareUpdateComponent\(step\.component, step\.scope\)/)
  assert.match(source, /const order = product === 'desktop' \? \['node', 'app'\] : \['localPlugin'\]/)
  assert.match(source, /if \(!failure\) for \(const component of order\)/,
    'any failed prepare prevents applying the components that did prepare')
  assert.match(source, /const components = product === 'desktop' \? \['app', \.\.\.\(nodeUpdateManaged \? \[\] : \['node'\]\)\] : \['localPlugin'\]/,
    'the desktop card reflects installer-owned Node while DSH remains plugin-only')
  assert.match(source, /for \(const component of order\) \{[\s\S]*?const entry = prepared\[component\]/)
  assert.match(source, /if \(!entry \|\| entry\.failed \|\| entry\.current \|\| entry\.inProgress \|\| !entry\.preparedId\) continue/)
  assert.ok(source.indexOf('prepared[step.component] = await prepareUpdateComponent') < source.indexOf('for (const component of order)'),
    'all downloads finish before the first apply')
  assert.match(source, /if \(result\.restart_deferred === true\) \{[\s\S]*?if \(!prepared\.app \|\| !prepared\.app\.preparedId\)/,
    'a node held for the APP restart is not restarted on its own')
  assert.match(source, /const reconnected = await watchAppRestart\(nodeScope, entry\.authority, entry\.expectedVersion\)/,
    'the deferred Node restart is confirmed after APP reconnects')
  assert.match(source, /else if \(prepared\.node && !prepared\.node\.rollbackAttempted\s*&& \(prepared\.node\.applied \|\| prepared\.node\.restartPending\)\) \{\s*const nodeReady = await watchNodeRestart\(nodeScope, entry\.authority, prepared\.node\.expectedVersion, prepared\.node\.preparedId\)/,
    'the product checks Node after APP reconnect only while its transaction remains pending')
})

test('external Node configuration skips spawn and exposes local API only after explicit validation', () => {
  assert.match(mainSource, /cfg\.nodeMode === 'external'[\s\S]*?env\.TETHER_NODE_MODE = cfg\.nodeMode/)
  assert.match(mainSource, /current\.nodeMode === 'external'[\s\S]*?nodeMode: 'external'/,
    'Hub config rewrites preserve the existing external Node selection')
  assert.match(mainSource, /localApi: supervisor\.remoteUrl && localApiReady && supervisor\.hasLocalNodeApi\(\)/,
    'the local API is exposed only after authenticated readiness and explicit ownership/configuration')
  assert.match(supervisorSource, /this\.nodeMode === 'external' && \(externalPort !== undefined \|\| externalToken !== undefined\)/)
  assert.match(supervisorSource, /hasLocalNodeApi\(\)/)
  assert.match(supervisorSource, /this\.nodeMode !== 'external' && \(this\.nodeToken \|\| this\.userToken\)/,
    'external mode leaves the separately managed Node in place')
})

test('a device one click prepares APP and Node before applying, keeping plugin separate', () => {
  assert.match(source, /export function deviceUpdateComponents\(capabilities = \{\}\) \{\s*return \[\.\.\.\(capabilities\.node_self_update_enabled === false \? \[\] : \['node'\]\), \.\.\.\(hasInstalledApp\(capabilities\) \? \['app'\] : \[\]\)\]/,
    'device update components honor Node ownership and installed APP capability')
  assert.match(source, /const componentNames = \[\.\.\.\(nodeUpdateManaged \? \[\] : \['node'\]\), \.\.\.\(hasApp \? \['app'\] : \[\]\)\]/)
  assert.match(source, /const updateOrigin = hasApp \? 'app'\s*: capabilities\.node_self_update_enabled === true && !installerOwnedNode \? 'node' : ''/,
    'device updates select the APP or Node owner for the remote update job')
  assert.match(source, /h\(MinimalUpdateButton, \{[\s\S]*?originProduct: updateOrigin, triggerLabel: '一键更新'/,
    'the device button starts the Hub-owned job with its selected component owner')
  assert.match(source, /devicePath \+ '\/update\/apply'[\s\S]*?body: JSON\.stringify\(\{ origin_product: originProduct \}\)/,
    'one-click submits the chosen origin to the device update job API')
  assert.match(source, /devicePath \+ '\/update\/job'[\s\S]*?const timer = setInterval\(poll, 1000\)/,
    'the device card follows the persistent job instead of running a second local prepare sequence')
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
  const start = source.indexOf('export async function runUpdateSequence(')
  const end = source.indexOf('\n}', start)
  const sequence = source.slice(start, end)
  assert.match(sequence, /if \(updateInfoRunning\(checked\)\) return \{ attached: true, updated: false \}/)
  assert.match(sequence, /if \(updateInfoRunning\(prepared\)\) return \{ attached: true, updated: false \}/)
  assert.match(sequence, /if \(updateInfoRunning\(result\)\) return \{ attached: true, updated: false \}/)
  assert.ok(sequence.indexOf('updateInfoRunning(prepared)') < sequence.indexOf('const result = await apply('),
    'a second window attaches before starting apply when preparation is already running')
  assert.match(source, /const waitForUpdateSettle = async \(component, scope, authority\) => \{/)
  assert.match(source, /if \(isUsableUpdateStatus\(status\) && !updateInfoRunning\(status\)\) return status/)
  assert.match(source, /const settled = await waitForUpdateSettle\(component, entry\.scope, entry\.authority\)\s*if \(!settled\) \{\s*const reason = component \+ ' 更新仍在进行，尚未确认完成'\s*failure = component === 'node' \? await rollbackPreparedNode\(reason\) : failure \|\| reason\s*continue/,
    'a still-running Node update is rolled back after settling times out')
  assert.match(source, /const latest = await apiRef\.current\(devicePath \+ '\/update\/job'/)
  assert.match(source, /const restored = latest && latest\.status !== 'done' \? latest : null/,
    'a second device window restores the existing nonterminal job')
  assert.match(source, /const next = await apiRef\.current\(devicePath \+ '\/update\/job'/)
  assert.match(source, /const timer = setInterval\(poll, 1000\)/,
    'the attached job is observed until its terminal status')
})

test('a Node restart is not treated as complete from stale status or timeout', () => {
  assert.match(source, /const watchNodeRestart = async \(scope, authority, expectedVersion, preparedId\)/)
  assert.match(source, /await loadUpdateInfo\('node', 'status', authority, scope\)/)
  assert.match(source, /target && target\.online && versionOk && isUsableUpdateStatus\(status\) && statusVersionOk/)
  assert.match(source, /const verifyNodeServices = async \(scope, authority, capabilities\)/)
  assert.match(source, /\/fs\/service_catalog/)
  assert.match(source, /\/fs\/dsh_status/)
  assert.match(source, /fetchSurfaceDescriptor\(scope\.deviceId\)/)
  assert.match(source, /surfaceInfo\.response\.ok[\s\S]*?surfaceInfo\.data\.nativeService/)
  assert.match(source, /updateAction\('node', 'commit', preparedId, scope, authority\)/)
  assert.match(source, /return false\s*\n\s*\}/,
    'timeout and a changed scope both fail instead of returning implicit success')
})

test('prepared Node restart commits only the matching awaiting-acceptance transaction', () => {
  const start = source.indexOf('const watchNodeRestart = async')
  const end = source.indexOf('const watchAppRestart = async', start)
  const watcher = source.slice(start, end)

  assert.match(watcher, /status\.current_version === expectedVersion/)
  assert.match(watcher, /const transaction = status\.transaction \|\| status\.node_transaction/)
  assert.match(watcher, /transaction\.prepared_id === preparedId\s*&& transaction\.state === 'awaiting_acceptance'/)
  assert.match(watcher, /if \(!preparedId && !status\.restart_required\) return true/)
  assert.match(watcher, /if \(!transactionReady\) continue/)
  assert.match(watcher, /if \(!preparedId && !status\.restart_required\) return true[\s\S]*?if \(!transactionReady\) continue[\s\S]*?verifyNodeServices[\s\S]*?updateAction\('node', 'commit', preparedId, scope, authority\)/)
  assert.doesNotMatch(watcher, /transactionReady[\s\S]{0,120}!status\.restart_required/,
    'restart_required must not gate the prepared transaction acceptance path')
})

test('Node apply commits only after service acceptance and rolls back on acceptance failure', () => {
  assert.match(source, /if \(action === 'apply' \|\| action === 'commit' \|\| action === 'rollback'\) body\.prepared_id = preparedId/)
  assert.match(source, /rollbackPreparedNode\(reason\)/)
  assert.match(source, /const rollbackAppliedNode = async \(scope, authority, preparedId, reason\) => \{[\s\S]*?updateAction\('node', 'rollback', preparedId, scope, authority\)/)
  assert.match(source, /Node 验收失败，已自动回滚/)
  assert.match(source, /Node 验收失败且自动回滚失败/)
  assert.match(source, /withUpdateTimeout\(verifyNodeServices\(scope, authority, target\.capabilities \|\| \{\}\), 20000, 'Node 服务验收超时'\)/)
})

test('APP phase failures roll back an applied deferred Node exactly once', () => {
  const start = source.indexOf('const runProductUpdate = async (product)')
  const end = source.indexOf('\n      React.useEffect', start)
  const update = source.slice(start, end)
  assert.match(update, /const rollbackPreparedNode = async \(reason\) => \{/)
  assert.match(update, /if \(!node \|\| !node\.applied \|\| !node\.preparedId\) return reason/)
  assert.match(update, /node\.rollbackAttempted = true\s*node\.rollbackFailure = await rollbackAppliedNode\(node\.scope \|\| nodeScope, node\.authority, node\.preparedId, reason\)\s*return node\.rollbackFailure/)
  assert.match(update, /if \(node\.rollbackAttempted\) return node\.rollbackFailure \|\| reason/)
  assert.match(update, /if \(!applied \|\| applied\.ok === false\) failure = await rollbackPreparedNode\('APP 更新失败'\)/,
    'a false APP apply result rolls back the applied Node')
  assert.match(update, /catch \(error\) \{\s*const reason = component === 'node' \? 'Node 更新失败' : component === 'app' \? 'APP 更新失败'[\s\S]*?failure = component === 'app' \? await rollbackPreparedNode\(reason\) : failure \|\| reason/,
    'an APP apply exception rolls back the applied Node')
  assert.match(update, /if \(!reconnected\) failure = await rollbackPreparedNode\('APP 更新后尚未重新连接，请稍后刷新'\)/,
    'failed APP restart acceptance rolls back the applied Node')
  assert.match(update, /if \(typeof nodeReady === 'string'\) \{\s*prepared\.node\.rollbackAttempted = true/,
    'a rollback returned by watchNodeRestart is recorded so it is not repeated')
  assert.match(update, /failure = await rollbackPreparedNode\(nodeFailure\)/,
    'watcher failure uses its rollback text as the final run failure')
  assert.match(update, /prepared\.node\.rollbackFailure = nodeReady/)
  assert.match(update, /failure = component === 'node' \? await rollbackPreparedNode\(reason\) : failure \|\| reason/)
})

test('APP restart completes only this run prepared Node and ignores old pending restarts', () => {
  assert.match(source, /watchNodeRestart\(nodeScope, entry\.authority, prepared\.node\.expectedVersion, prepared\.node\.preparedId\)/)
  assert.match(source, /watchNodeRestart\(entry\.scope, entry\.authority, entry\.expectedVersion, entry\.preparedId\)/)
  assert.match(source, /if \(!preparedId && !status\.restart_required\) return true[\s\S]*?if \(!transactionReady\) continue[\s\S]*?updateAction\('node', 'commit', preparedId, scope, authority\)/)
  assert.match(source, /restartPending[\s\S]*?!\(prepared\.app && prepared\.app\.preparedId\)/)
})

test('restart watchers use the version that prepare actually pinned', () => {
  assert.match(source, /const preparedRow = \(prepared\.prepared \|\| \[\]\)\.find\(\(item\) => item && item\.prepared_id === preparedId\)/)
  assert.match(source, /const expectedVersion = prepared\.to_version \|\| \(preparedRow && preparedRow\.to_version\) \|\| checked\.latest_version/)
  assert.match(source, /watchAppRestart\(nodeScope, entry\.authority, entry\.expectedVersion\)/)
  assert.match(source, /watchNodeRestart\(entry\.scope, entry\.authority, entry\.expectedVersion, entry\.preparedId\)/)
})

test('a deferred Node restart without an APP update rolls back its applied package', () => {
  assert.match(source, /if \(result\.restart_deferred === true\) \{\s*if \(!prepared\.app \|\| !prepared\.app\.preparedId\) \{\s*failure = await rollbackPreparedNode\(nodeRestartManualMessage\)/)
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
  assert.match(source, /else if \(prepared\.node && !prepared\.node\.rollbackAttempted\s*&& \(prepared\.node\.applied \|\| prepared\.node\.restartPending\)\)/)
})

test('a reloaded local UI discovers and adopts only a valid pending Node transaction', () => {
  const start = source.indexOf('const prepareUpdateComponent = async')
  const end = source.indexOf('const openUpdateCenter', start)
  const prepare = source.slice(start, end)
  assert.match(prepare, /const transaction = status\.transaction \|\| status\.node_transaction/)
  assert.match(prepare, /transaction\.prepared_id[\s\S]*?transaction\.state === 'awaiting_acceptance'[\s\S]*?transaction\.to_version/)
  assert.match(prepare, /acceptancePending: true[\s\S]*?preparedId[\s\S]*?expectedVersion[\s\S]*?authority:[\s\S]*?scope/)
  assert.match(prepare, /restartPending: nodeRestartIsPending\(scope, status\)/)
  assert.match(source, /component === 'node' && scope && scope\.deviceId === \(appLocalDevice \|\| deviceId\)[\s\S]*?result\.update_available !== true[\s\S]*?loadUpdateInfo\('node', 'status'/,
    'a no-update check after UI reload also loads transaction status')
  const cardStart = source.indexOf('const productCard =')
  const cardEnd = source.indexOf('const deviceCard =', cardStart)
  const card = source.slice(cardStart, cardEnd)
  assert.match(card, /nodeAcceptancePending/)
  assert.match(card, /restartAction: nodeAcceptancePending \? 'update'/)
  assert.match(card, /restartPill: nodeAcceptancePending \? '待验收'/)
  assert.match(card, /updateButton\(card, \(\) => runProductUpdate\(product\)/,
    'the pending acceptance card stays clickable and enters the product update runner')
  assert.match(source, /restartAction === 'update' \? '继续验收'/)
})

test('a recovered Node transaction commits before APP apply and rolls back on failed acceptance', () => {
  const start = source.indexOf('const runProductUpdate = async (product)')
  const end = source.indexOf('\n      React.useEffect', start)
  const update = source.slice(start, end)
  assert.match(update, /prepared\.node && prepared\.node\.acceptancePending/)
  assert.match(update, /watchNodeRestart\(prepared\.node\.scope, prepared\.node\.authority,\s*prepared\.node\.expectedVersion, prepared\.node\.preparedId\)/)
  assert.match(update, /if \(nodeReady === true\) prepared\.node\.current = true\s*else \{[\s\S]*?prepared\.node\.rollbackAttempted = typeof nodeReady === 'string'/)
  assert.match(update, /prepared\.node\.current = true[\s\S]*?const order = product === 'desktop' \? \['node', 'app'\]/)
  assert.ok(update.indexOf('prepared.node.acceptancePending') < update.indexOf("updateAction('app', 'apply'"),
    'the recovered Node acceptance commits before applying APP')
  assert.match(update, /if \(!entry \|\| entry\.failed \|\| entry\.current \|\| entry\.inProgress \|\| !entry\.preparedId\) continue/,
    'after acceptance, the existing order skips another Node apply and still handles an APP update')
})

test('a current Node without a valid acceptance transaction remains current', () => {
  const start = source.indexOf('const prepareUpdateComponent = async')
  const end = source.indexOf('const openUpdateCenter', start)
  const prepare = source.slice(start, end)
  assert.match(prepare, /if \(transaction && typeof transaction\.prepared_id === 'string'[\s\S]*?transaction\.state === 'awaiting_acceptance'[\s\S]*?typeof transaction\.to_version === 'string'/)
  assert.match(prepare, /return \{ current: true, checked, status,[\s\S]*?restartPending: nodeRestartIsPending\(scope, status\) \}/)
  assert.match(source, /restartPending: nodeRestartIsPending\(scope, status\)/)
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
  assert.match(mainSource, /new UpdateService\(\{ repoRoot, dataDir, python: supervisor\.childPython, env, app,\s*stopManagedNode: \(\) => packaged \? supervisor\.stopManagedNode\(\) : Promise\.resolve\(\{ stopped: false \}\) \}\)/)
  assert.match(appCmdSource, /if \/i not "%~1"=="--hidden"/)
  assert.match(appCmdSource, /wscript \/\/nologo .*Tether-App\.vbs/)
  assert.match(appCmdSource, /-WindowStyle Hidden/)
  assert.match(appVbsSource, /Tether-App\.cmd"" --hidden/)
})
