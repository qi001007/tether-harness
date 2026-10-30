import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')
const mainSource = fs.readFileSync(path.join(root, 'apps/tether-app/main.js'), 'utf8')
const preloadSource = fs.readFileSync(path.join(root, 'apps/tether-app/preload.js'), 'utf8')
const dshHostSource = fs.readFileSync(path.join(root, 'packages/tether-ui/src/hosts/dsh.js'), 'utf8')

test('one-click device updates keep going after a transient component failure', () => {
  assert.match(source, /const transientUpdateError = \(error\) => \{/)
  assert.match(source, /code === 'device_offline' \|\| code === 'update_busy' \|\| code === 'surface_timeout'/)
  assert.match(source, /const checkUpdateWithRetry = async \(component, scope, attempts = 3\)/)
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout\(resolve, 2000\)\)/)
  assert.match(source, /const checkedApp = await checkUpdateWithRetry\('app', scope\)/)
  assert.match(source, /failures\.push\(component\)/)
  assert.match(source, /failures\.push\('app'\)/)
  assert.match(source, /const message = failures\.length \? '部分组件未更新/)
  assert.equal(source.includes('if (!await updateOneClick(component, scope)) return'), false,
    'a failed step must not abort the remaining components')
})

test('a one-click device run owns the card until the final refresh finishes', () => {
  assert.match(source, /const \[updateRuns, setUpdateRuns\] = React\.useState\(\{\}\)/)
  assert.match(source, /const runKey = 'device:' \+ item\.device_id/)
  assert.match(source, /setUpdateRun\(runKey, \{ state: 'running' \}\)/)
  assert.match(source, /await refreshUpdateCenter\(true\)/)
  assert.match(source, /state: 'done'/)
  assert.match(source, /updateCardState\(/)
  assert.equal(/runtimeRestartRequired\s*\? btn\('立即生效'/.test(source), false,
    'a pending restart must not hide an available one-click update')
})

test('a local product update skips a current node and still runs the plugin', () => {
  assert.match(source, /const localNodeInfo = localId \? infoFor\('node', localId\) : null/)
  assert.match(source, /if \(localId && updateNeededFor\(localNodeInfo\)\)/)
  assert.match(source, /if \(nodeFailure && !failure\) failure = 'Node 更新失败'/)
  assert.match(source, /if \(!updateNeededFor\(infoFor\(component, item\.device_id\)\)\) continue/)
})

test('the update center commits one normalized latest snapshot per refresh', () => {
  assert.match(source, /await Promise\.allSettled\(checks\)[\s\S]*normalizeUpdateLatest\(current\)/)
})

test('a local plugin apply that scheduled a DSH restart does not fall back to a manual button', () => {
  assert.match(source, /outcome\.result\.restart_scheduled === true/)
  assert.match(source, /setNotice\('插件已安装，DSH 正在自动重启…'\)/)
  assert.match(source, /else setPendingDshRestart\(true\)/)
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
  assert.match(source, /else if \(component === 'plugin'\) \{/)
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
