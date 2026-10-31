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
const nodeAgentSource = read('tether/node/agent.py')
const appRestartSource = read('tether/node/app_restart.py')

test('one click downloads every component before the first install and restarts once', () => {
  assert.match(source, /const plan = product === 'desktop'\s*\? \[\{ component: 'node', scope: nodeScope \}, \{ component: 'app', scope: null \}\]\s*: \[\{ component: 'localPlugin', scope: null \}, \{ component: 'node', scope: nodeScope \}\]/)
  assert.match(source, /for \(const step of plan\) \{[\s\S]*?prepared\[step\.component\] = await prepareUpdateComponent\(step\.component, step\.scope\)/)
  assert.match(source, /const order = product === 'desktop' \? \['node', 'app'\] : \['localPlugin', 'node'\]/)
  assert.match(source, /for \(const component of order\) \{[\s\S]*?const entry = prepared\[component\]/)
  assert.match(source, /if \(!entry \|\| entry\.failed \|\| entry\.current \|\| entry\.inProgress \|\| !entry\.preparedId\) continue/)
  assert.ok(source.indexOf('prepared[step.component] = await prepareUpdateComponent') < source.indexOf('for (const component of order)'),
    'all downloads finish before the first apply')
  assert.match(source, /if \(result\.restart_deferred !== true\) await watchNodeRestart\(entry\.scope, entry\.authority\)/,
    'a node held for the APP restart is not restarted on its own')
  assert.match(source, /setNotice\('APP 正在重启并安装更新…'\)/, 'the APP is applied last and restarts the app')
})

test('a device one click prepares plugin, node and APP before applying and installs the APP last', () => {
  assert.match(source, /export function deviceUpdateComponents\(capabilities = \{\}\) \{\s*return \['node', \.\.\.\(capabilities\.dsh_surface \? \['plugin'\] : \[\]\), \.\.\.\(capabilities\.app_version \? \['app'\] : \[\]\)\]/)
  assert.match(source, /const components = deviceUpdateComponents\(item\.capabilities\)\s*const prepared = \{\}\s*for \(const component of components\) \{[\s\S]*?prepared\[component\] = await prepareUpdateComponent\(component, scope\)/)
  assert.match(source, /for \(const component of \['plugin', 'node', 'app'\]\) \{/)
  assert.match(source, /const reconnected = await watchAppRestart\(/)
  assert.ok(source.indexOf('prepared[component] = await prepareUpdateComponent(component, scope)') < source.indexOf("for (const component of ['plugin', 'node', 'app'])"),
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
  assert.match(source, /if \(updateInfoRunning\(result\)\) \{\s*await waitForUpdateSettle\(component, entry\.scope, entry\.authority\)/)
  assert.match(source, /if \(updateInfoRunning\(result\)\) \{\s*await waitForUpdateSettle\(component, scope, entry\.authority\)/)
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

test('a remote plugin that needs a DSH restart is shown instead of up to date', () => {
  assert.match(source, /const pluginRestart = !!\(hasPlugin && plugin && !isUpdateInfoStale\(plugin\) && plugin\.restart_required\)/)
  assert.match(source, /restartPill: '插件待重启 DSH', restartAction: 'none'/)
  assert.match(source, /updateCardStateForInfos\(infos, \{ running, error: run\?\.state === 'error' \? run\.message : '',/)
})

test('the device chain waits for the target DSH to restart after a plugin apply', () => {
  assert.match(source, /const watchPluginRestart = async \(scope, authority\)/)
  assert.match(source, /status\.restart_required !== true\) return true/)
  assert.match(source, /if \(component === 'plugin'\) \{\s*const restarted = await watchPluginRestart\(/)
  assert.match(source, /插件已安装，目标 DSH 尚未完成重启/)
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
})
