import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const Module = require('node:module')
const { UpdateService, stageUpdaterRuntime } = require('../apps/tether-app/update-service.js')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-update-service-'))
const repoRoot = path.join(temp, 'repo')
const dataDir = path.join(temp, 'data')
const userData = path.join(temp, 'user-data')
fs.mkdirSync(path.join(repoRoot, 'tether'), { recursive: true })
for (const name of ['updates.py', 'updates_cli.py', 'release.py', 'ed25519.py', '__init__.py']) fs.writeFileSync(path.join(repoRoot, 'tether', name), '# fixture\n')
fs.mkdirSync(path.join(repoRoot, 'tether', 'node'), { recursive: true })
for (const name of ['__init__.py', 'dsh_sessions.py']) fs.writeFileSync(path.join(repoRoot, 'tether', 'node', name), '# fixture\n')

const calls = []
const exec = async (_python, args) => {
  calls.push(args)
  const command = args[2]
  const result = command === 'status'
    ? { ok: true, component: 'app', current_version: '0.2.0', prepared: [{ prepared_id: 'fixture-prepared-01', to_version: '0.2.1' }] }
    : command === 'prepare'
      ? { ok: true, component: 'app', prepared_id: 'fixture-prepared-02', to_version: '0.2.1', size: 12, sha256: 'abc' }
      : { ok: true, component: 'app', update_available: true, current_version: '0.2.0', latest_version: '0.2.1' }
  return { stdout: JSON.stringify(result) }
}
let spawnConfig
const spawnChild = (_executable, args, options) => {
  spawnConfig = { args, options }
  const child = new EventEmitter()
  child.disconnect = () => {}
  child.unref = () => {}
  setImmediate(() => child.emit('message', { ready: true }))
  return child
}
fs.mkdirSync(dataDir, { recursive: true })
fs.writeFileSync(path.join(dataDir, 'hub.json'), JSON.stringify({ url: 'https://hub.test' }))
const service = new UpdateService({
  repoRoot, dataDir, python: 'python-fixture', env: { TETHER_NATIVE_DSH_HOME: 'C:/Users/test/.dsh', DSH_HOME: 'ignored' },
  app: { getPath: () => userData, isPackaged: false }, exec, spawnChild
})

try {
  const checked = await service.check()
  assert.equal(checked.latest_version, '0.2.1')
  assert.ok(calls[0].includes('--component') && calls[0].includes('app'))
  assert.ok(calls[0].includes('--root') && calls[0].includes(repoRoot))
  assert.ok(calls[0].includes('--state-dir') && calls[0].includes(path.join(dataDir, 'updates', 'app')),
    'the APP shares its prepared update state with the node restart deferral')
  assert.ok(calls[0].includes('--dsh-home') && calls[0].includes('C:/Users/test/.dsh'))
  assert.ok(calls[0].includes('--manifest-url') && calls[0].includes('https://hub.test/releases/manifest'), 'the APP updater prefers the Hub mirror')
  assert.ok(calls[0].includes('--force'), 'a manual check must bypass the manifest disk cache')

  await service.status()
  const statusCall = calls.find((args) => args[2] === 'status')
  assert.ok(statusCall && !statusCall.includes('--force'), 'status keeps the short-lived cache')
  assert.equal(await service.apply('unknown-prepared-id').catch((error) => error.code), 'invalid_prepared_id')
  const prepared = await service.prepare()
  assert.equal(prepared.prepared_id, 'fixture-prepared-02')
  const result = await service.apply(prepared.prepared_id)
  assert.equal(result.status, 'installing')
  assert.ok(fs.existsSync(path.join(userData, 'update-helper-runtime', 'tether', 'updates.py')))
  assert.ok(fs.existsSync(path.join(userData, 'update-helper-runtime', 'tether', 'release.py')))
  assert.ok(fs.existsSync(path.join(userData, 'update-helper-runtime', 'tether', 'ed25519.py')))
  assert.ok(fs.existsSync(path.join(userData, 'update-helper-runtime', 'tether', 'node', 'dsh_sessions.py')))
  assert.ok(fs.existsSync(path.join(userData, 'tether-update-helper.js')))
  assert.equal(spawnConfig.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(spawnConfig.options.stdio[3], 'ipc')
  const helperConfig = JSON.parse(fs.readFileSync(path.join(userData, 'tether-update-helper.json'), 'utf8'))
  assert.equal(helperConfig.dshHome, 'C:/Users/test/.dsh')
  assert.equal(helperConfig.stateDir, path.join(dataDir, 'updates', 'app'))
  assert.deepEqual(helperConfig.launchArgs, [path.join(repoRoot, 'apps', 'tether-app')])
  assert.equal(helperConfig.env.PYTHONPATH, path.join(userData, 'update-helper-runtime'))
  const helperSource = fs.readFileSync(path.join(projectRoot, 'apps', 'tether-app', 'update-helper.js'), 'utf8')
  assert.ok(helperSource.includes("data.status === 'in_progress' || data.in_progress === true"),
    'the helper must not relaunch over an installer another window already started')

  const pythonCandidates = [
    process.env.TETHER_TEST_PYTHON,
    path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(projectRoot, '.venv', 'bin', 'python'),
    'python',
    'python3'
  ].filter(Boolean)
  const triedPython = new Set()
  let python
  let pythonExecutionBlocked = false
  for (const candidate of pythonCandidates) {
    if (triedPython.has(candidate)) continue
    triedPython.add(candidate)
    const probe = spawnSync(candidate, ['--version'], { windowsHide: true, encoding: 'utf8' })
    if (probe.status === 0) {
      python = candidate
      break
    }
    if (probe.error?.code === 'EPERM') pythonExecutionBlocked = true
  }
  if (!python && pythonExecutionBlocked) {
    process.stdout.write('SKIP temporary helper CLI integration: sandbox denied Python process creation with EPERM\n')
  } else if (!python) {
    throw new Error('no runnable Python found; set TETHER_TEST_PYTHON or add python to PATH')
  } else {
  const applyArgsPath = path.join(temp, 'apply-args.json')
  const launchMarkerPath = path.join(temp, 'restarted.txt')
  fs.writeFileSync(path.join(userData, 'update-helper-runtime', 'tether', 'updates_cli.py'), [
    'import json, os, sys',
    "target = os.environ['TETHER_UPDATE_TEST_ARGS']",
    "calls = json.load(open(target, encoding='utf-8')) if os.path.exists(target) else []",
    'calls.append(sys.argv)',
    "json.dump(calls, open(target, 'w', encoding='utf-8'))",
    "print(json.dumps({'ok': True, 'version': '0.2.1', 'restart_required': True}))"
  ].join('\n'))
  helperConfig.pid = 2147483647
  helperConfig.python = python
  helperConfig.launchArgs = ['-e', "require('node:fs').writeFileSync(process.env.TETHER_UPDATE_TEST_LAUNCH, 'started')"]
  fs.writeFileSync(path.join(userData, 'tether-update-helper.json'), JSON.stringify(helperConfig))
  const helperChild = spawn(process.execPath, [path.join(userData, 'tether-update-helper.js'), path.join(userData, 'tether-update-helper.json')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TETHER_UPDATE_TEST_ARGS: applyArgsPath, TETHER_UPDATE_TEST_LAUNCH: launchMarkerPath },
    windowsHide: true,
    stdio: 'ignore'
  })
  const exit = await new Promise((resolve, reject) => {
    helperChild.once('error', reject)
    helperChild.once('exit', resolve)
  })
  assert.equal(exit, 0)
  const launchDeadline = Date.now() + 3000
  while (!fs.existsSync(launchMarkerPath) && Date.now() < launchDeadline) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.ok(fs.existsSync(launchMarkerPath), 'helper relaunches after apply: ' + (fs.existsSync(path.join(userData, 'update-helper.log')) ? fs.readFileSync(path.join(userData, 'update-helper.log'), 'utf8') : 'no helper log'))
  assert.ok(fs.existsSync(applyArgsPath), 'helper ran activity/apply CLI: ' + (fs.existsSync(path.join(userData, 'update-helper.log')) ? fs.readFileSync(path.join(userData, 'update-helper.log'), 'utf8') : 'no helper log'))
  const cliCalls = JSON.parse(fs.readFileSync(applyArgsPath, 'utf8'))
  assert.equal(cliCalls.length, 2)
  for (const args of cliCalls) assert.ok(args.includes(helperConfig.stateDir), 'helper actions use the same persistent state directory as prepare')
  assert.equal(cliCalls[0][1], 'activity')
  assert.equal(cliCalls[1][1], 'apply')
  assert.ok(cliCalls[1].includes(helperConfig.preparedId))
  assert.equal(JSON.parse(fs.readFileSync(helperConfig.resultPath, 'utf8')).ok, true)

  // The staged runtime must import on its own: updates.py imports .release which
  // imports .ed25519. A hardcoded staging list silently broke APP self-update.
  const closureDir = path.join(temp, 'closure')
  stageUpdaterRuntime(projectRoot, path.join(closureDir, 'tether'))
  const closure = spawnSync(python, ['-c', 'import tether.updates_cli'], {
    cwd: closureDir,
    env: { ...process.env, PYTHONPATH: closureDir, PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf8',
    windowsHide: true
  })
  assert.equal(closure.status, 0, 'staged updater runtime imports: ' + String(closure.stderr || closure.stdout).slice(0, 500))
  }

  const source = fs.readFileSync(path.join(projectRoot, 'apps', 'tether-app', 'main.js'), 'utf8')
  assert.ok(!source.includes('updateInstalledPlugin'))
  const preload = fs.readFileSync(path.join(projectRoot, 'apps', 'tether-app', 'preload.js'), 'utf8')
  for (const channel of ['updates-status', 'updates-check', 'updates-prepare', 'updates-apply']) assert.ok(preload.includes(channel))
  const invoked = []
  const exposed = {}
  const electronMock = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } },
    ipcRenderer: { invoke: async (...args) => { invoked.push(args); return { ok: true } }, on() {}, off() {} }
  }
  vm.runInNewContext(preload, { require: () => electronMock })
  await exposed.tetherApp.updatesStatus()
  await exposed.tetherApp.updatesCheck()
  await exposed.tetherApp.updatesPrepare()
  await exposed.tetherApp.updatesApply('fixture-prepared-02')
  assert.deepEqual(invoked.map((args) => args[0]), [
    'tether:updates-status', 'tether:updates-check', 'tether:updates-prepare', 'tether:updates-apply'
  ])
  assert.deepEqual(invoked[3], ['tether:updates-apply', 'fixture-prepared-02'])
  const { createDshHost, createDshLocalPluginUpdateBridge } = await import(new URL('../packages/tether-ui/src/hosts/dsh.js', import.meta.url))
  const { fetchApiJson, isUpdateTargetCurrent, updateAuthorityBase, updateErrorText } = await import(new URL('../packages/tether-ui/src/app.js', import.meta.url))
  assert.equal(isUpdateTargetCurrent('device-a', 4, 'device-b', 5), false)
  assert.equal(isUpdateTargetCurrent('device-a', 4, 'device-a', 4), true)
  assert.equal(updateErrorText({ message: "Error invoking remote method 'tether:updates-check': Error: 更新文件下载失败。" }), '更新文件下载失败。')
  const authorityState = { devices: { 'device-a': { node: { authorityBase: 'https://hub.example' } } } }
  const pinnedBase = updateAuthorityBase(authorityState, 'device-a', 'node')
  const updateRequests = []
  const updateFetch = async (url) => {
    updateRequests.push(url)
    return { ok: true, json: async () => ({ ok: true }) }
  }
  for (const endpoint of ['/updates/status?component=node', '/updates?component=node', '/updates/prepare', '/updates/apply']) {
    await fetchApiJson('/api/devices/device-a' + endpoint, {}, {
      activeBase: 'https://hub.example', apiBaseList: ['https://hub.example', 'http://127.0.0.1:18890'],
      pinnedBase, fetcher: updateFetch
    })
  }
  assert.ok(updateRequests.every((url) => url.startsWith('https://hub.example/')))
  const failedUpdateBases = []
  await assert.rejects(fetchApiJson('/api/devices/device-a/updates?component=node', {}, {
    activeBase: 'https://hub.example', apiBaseList: ['https://hub.example', 'http://127.0.0.1:18890'],
    pinnedBase: 'https://hub.example', fetcher: async (url) => { failedUpdateBases.push(url); throw new Error('Hub connection changed') }
  }), /Hub connection changed/)
  assert.deepEqual(failedUpdateBases, ['https://hub.example/api/devices/device-a/updates?component=node'])
  const appAuthorityState = { devices: { 'device-a': { plugin: { authorityBase: '' } } } }
  const appPinnedBase = updateAuthorityBase(appAuthorityState, 'device-a', 'plugin')
  assert.equal(appPinnedBase, '')
  const sameOriginRequests = []
  for (const endpoint of ['/updates/status?component=plugin', '/updates?component=plugin', '/updates/prepare', '/updates/apply']) {
    await fetchApiJson('/api/devices/device-a' + endpoint, {}, {
      activeBase: '', apiBaseList: ['', 'http://127.0.0.1:18890'], pinnedBase: appPinnedBase,
      fetcher: async (url) => { sameOriginRequests.push(url); return { ok: true, json: async () => ({ ok: true }) } }
    })
  }
  assert.ok(sameOriginRequests.every((url) => url.startsWith('/api/devices/device-a/')))
  const failedSameOrigin = []
  await assert.rejects(fetchApiJson('/api/devices/device-a/updates/prepare', {}, {
    activeBase: '', apiBaseList: ['', 'http://127.0.0.1:18890'], pinnedBase: appPinnedBase,
    fetcher: async (url) => { failedSameOrigin.push(url); throw new Error('APP proxy offline') }
  }), /APP proxy offline/)
  assert.deepEqual(failedSameOrigin, ['/api/devices/device-a/updates/prepare'])
  const localRpcCalls = []
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false })
  let rpcReply = { ok: true, value: { ok: true } }
  const fakeCtx = { connection: { rpc: { call: async (...args) => { localRpcCalls.push(args); return rpcReply } } } }
  const localBridge = createDshLocalPluginUpdateBridge(() => fakeCtx.connection.rpc)
  const dshHost = createDshHost({ localPluginUpdates: localBridge })
  await dshHost.localPluginUpdates('status', { component: 'node', url: 'https://untrusted.invalid' })
  await dshHost.localPluginUpdates('apply', { prepared_id: 'prepared-local', component: 'node' })
  assert.deepEqual(localRpcCalls, [
    ['/tether-updates', 'status', {}],
    ['/tether-updates', 'apply', { prepared_id: 'prepared-local' }]
  ])
  rpcReply = { ok: false, error: { code: 'update_busy', message: 'busy' } }
  await assert.rejects(dshHost.localPluginUpdates('apply', { prepared_id: 'prepared-local' }), (error) => error.code === 'update_busy')
  globalThis.fetch = savedFetch
  const ui = fs.readFileSync(path.join(projectRoot, 'packages', 'tether-ui', 'src', 'app.js'), 'utf8')
  assert.ok(ui.includes("replace('/updates?', '/updates/status?')"))
  assert.ok(ui.includes('/updates?component='))
  assert.ok(ui.includes("'Tether Desktop（APP + Node）'"))
  assert.ok(ui.includes("'Tether for DSH（插件）'"))
  assert.ok(ui.includes("'Tether Desktop（APP + Node）'"))
  assert.ok(!ui.includes('目标设备上的'), 'card titles must name the device, not "target device"')
  assert.ok(ui.includes('disabled: off'), 'one-click must be disabled when already current')
  assert.ok(ui.includes("role: 'progressbar'") && ui.includes("'aria-valuenow': percent"),
    'a running install shows determinate progress instead of a confirm dialog')
  assert.ok(!ui.includes("btn('稍后'") && !ui.includes("btn('重启并安装'") && !ui.includes('APP 已下载'),
    'the extra APP restart dialog is gone from the one-click path')
  assert.ok(ui.includes('error.status = response.status'))
  assert.ok(ui.includes("'服务端不支持更新'"))
  assert.ok(ui.includes("lastUpdateToastRef"), 'update errors must be deduped through the toast layer')
  assert.ok(!ui.includes('git pull'))
  const build = fs.readFileSync(path.join(projectRoot, 'packages', 'tether-ui', 'scripts', 'build.mjs'), 'utf8')
  assert.ok(build.includes('createDshLocalPluginUpdateBridge(() => localPluginRpc)'))
  const inject = build.match(/inject: \[([^\]]+)\]/)?.[1]
  assert.ok(inject, 'generated DSH client must declare its allowed client services')
  assert.deepEqual([...inject.matchAll(/'([^']+)'/g)].map(([, service]) => service), [
    'slots', 'layout', 'connection', 'remote', 'remote.pluginManager', 'commandUi', 'uiWorkspace', 'sessions'
  ])

  if (process.platform === 'win32') {
    const executableAlias = 'D:\\Apps\\Tether\\Tether.exe'
    let physicalExecutable = 'E:\\Project\\Runtime\\Apps\\Tether\\Tether.exe'
    let installerTemp
    const updater = new EventEmitter()
    updater.app = { baseCachePath: 'C:\\Users\\fixture\\AppData\\Local', name: 'Tether' }
    updater.configOnDisk = { value: Promise.resolve({ updaterCacheDirName: 'tether-app-updater' }) }
    const legacyCache = path.join(updater.app.baseCachePath, 'tether-app-updater')
    const stagedLegacyCache = 'E:\\Other\\tether-app-updater'
    let downloadCalls = 0
    let cacheHit = false
    updater.downloadUpdate = async () => {
      downloadCalls++
      if (cacheHit) await updater.downloadedUpdateHelper.validateDownloadedPath()
      else updater.emit('download-progress', { transferred: 3000, total: 3000 })
      return []
    }
    const installCalls = []
    let installError = null
    updater.quitAndInstall = (...args) => {
      installCalls.push({ args, temp: process.env.TEMP, tmp: process.env.TMP, installerTemp: process.env.TETHER_UPDATER_TEMP })
      if (installError) throw installError
    }
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === 'electron-updater') return { autoUpdater: updater }
      return originalLoad.call(this, request, parent, isMain)
    }
    let packagedService
    const appEvents = new EventEmitter()
    try {
      packagedService = new UpdateService({
        repoRoot, dataDir, python: 'python-fixture', env: { TETHER_UPDATE_CHANNEL: 'preview' },
        app: { on: appEvents.on.bind(appEvents), getPath: (name) => name === 'exe' ? executableAlias : userData,
          getVersion: () => '0.5.5', isPackaged: true },
        exec,
        stopManagedNode: async () => { stopEnv = { temp: process.env.TEMP, tmp: process.env.TMP } }
      })
    } finally {
      Module._load = originalLoad
    }

    const originalMkdirSync = fs.mkdirSync
    const originalMkdtempSync = fs.mkdtempSync
    const originalRmdirSync = fs.rmdirSync
    const originalStatfsSync = fs.statfsSync
    const originalRealpathNative = fs.realpathSync.native
    const originalTemp = process.env.TEMP
    const originalTmp = process.env.TMP
    const originalInstallerTemp = process.env.TETHER_UPDATER_TEMP
    let stopEnv
    let mkdirError = null
    let mkdirPath = ''
    let probePrefix = ''
    let removedProbe = ''
    let beforeInstallTemp = null
    const updateInfo = { version: '0.5.6', files: [{ size: 1000 }, { size: 2000 }] }
    const reserveBytes = 512n * 1024n * 1024n
    let freeBytes = 2n * 3000n + reserveBytes
    let statfsError = null
    let statfsCalls = 0
    let legacyIsRelocated = false
    let cacheRedirected = false
    const loadWithoutUpdater = Module._load
    Module._load = (request, ...args) => {
      if (request === 'electron-updater/out/DownloadedUpdateHelper') {
        return { DownloadedUpdateHelper: class {
          constructor(cacheDir) {
            this.cacheDir = cacheDir
            this.file = path.join(temp, 'tether-installer-fixture.exe')
            fs.writeFileSync(this.file, 'fixture')
            this.downloadedFileInfo = { fileName: 'tether-installer-fixture.exe', sha512: '', isAdminRightsRequired: false }
          }
          async validateDownloadedPath() { return cacheHit ? this.file : null }
        } }
      }
      return loadWithoutUpdater.call(Module, request, ...args)
    }
    fs.mkdirSync = (directory) => {
      mkdirPath = directory
      if (mkdirError) throw mkdirError
      return directory
    }
    fs.mkdtempSync = (prefix) => { probePrefix = prefix; return `${prefix}fixture` }
    fs.rmdirSync = (directory) => { removedProbe = directory }
    fs.realpathSync.native = (filename) => {
      if (filename === executableAlias) return physicalExecutable
      if (legacyIsRelocated && filename === legacyCache) return stagedLegacyCache
      if (cacheRedirected && filename === updater.downloadedUpdateHelper?.cacheDir) return 'C:\\unexpected-cache'
      return filename
    }
    fs.statfsSync = (cacheRoot, options) => {
      statfsCalls++
      assert.equal(cacheRoot, updater.downloadedUpdateHelper.cacheDir)
      assert.deepEqual(options, { bigint: true })
      if (statfsError) throw statfsError
      return { bavail: freeBytes, bsize: 1n }
    }
    process.env.TEMP = 'before-temp'
    process.env.TMP = 'before-tmp'
    process.env.TETHER_UPDATER_TEMP = 'before-installer-temp'
    const receiptFile = path.join(dataDir, 'updates', 'windows-app-receipt.json')
    originalMkdirSync(path.dirname(receiptFile), { recursive: true })
    const readReceipt = () => JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
    try {
      assert.equal(updater.autoDownload, true)
      assert.equal(updater.channel, 'preview')
      assert.equal(updater.allowPrerelease, true)
      assert.equal(updater.allowDowngrade, false)
      let finishDownload
      updater.checkForUpdates = async () => {
        updater.emit('update-available', updateInfo)
        const downloadPromise = new Promise(resolve => { finishDownload = resolve }).then(async () => {
          await updater.downloadUpdate()
          updater.emit('update-downloaded', updateInfo)
        })
        return { isUpdateAvailable: true, updateInfo, downloadPromise }
      }
      freeBytes = 1n
      await assert.rejects(packagedService.check(), { code: 'insufficient_update_cache_space' })
      assert.equal(finishDownload, undefined)
      freeBytes = 2n * 3000n + reserveBytes
      assert.equal((await packagedService.check()).update_available, true)
      assert.equal(updater.autoInstallOnAppQuit, false, 'an incomplete package cannot install on exit')
      const preparing = packagedService.prepare()
      finishDownload()
      const background = await preparing
      assert.equal(downloadCalls, 1, 'one-click joins the automatic download')
      assert.equal(installCalls.length, 0)
      assert.equal(updater.autoInstallOnAppQuit, true)
      assert.equal((await packagedService.status()).prepared[0].prepared_id, background.prepared_id)
      appEvents.emit('quit', {}, 1)
      assert.equal(readReceipt().status, 'prepared', 'an abnormal exit does not arm the installer')
      freeBytes = 1n
      appEvents.emit('quit', {}, 0)
      assert.equal(updater.autoInstallOnAppQuit, false, 'low disk space also prevents quit-time installation')
      freeBytes = 2n * 3000n + reserveBytes
      updater.emit('update-not-available', { version: '0.5.4' })
      assert.equal((await packagedService.status()).update_available, false)
      assert.equal(updater.autoInstallOnAppQuit, false)
      assert.throws(() => packagedService.assertElectronPrepared(background.prepared_id), { code: 'invalid_prepared_id' })
      downloadCalls = 0
      packagedService.windowsReceipt = null

      packagedService.electronUpdateInfo = updateInfo
      freeBytes = 2n * 3000n + reserveBytes - 1n
      await assert.rejects(packagedService.prepare(), (error) => error.code === 'insufficient_update_cache_space'
        && error.message.includes('需要 0.6 GB') && error.message.includes('当前可用 0.5 GB'))
      assert.equal(readReceipt().status, 'failed')
      assert.equal(readReceipt().error_code, 'insufficient_update_cache_space')
      assert.equal(readReceipt().payload_bytes, undefined)
      assert.equal(downloadCalls, 0, 'low cache space must stop before downloadUpdate')
      assert.equal(path.parse(updater.downloadedUpdateHelper.cacheDir).root, 'E:\\')
      assert.equal(path.dirname(updater.downloadedUpdateHelper.cacheDir), path.dirname(path.dirname(physicalExecutable)),
        'a linked D: app downloads and stages beside its physical E: installation')
      installerTemp = path.join(updater.downloadedUpdateHelper.cacheDir, 'install-temp')

      packagedService.electronDownloaded = false
      packagedService.electronUpdateInfo = { version: '0.5.6', files: [{ url: 'missing-size.exe' }] }
      await assert.rejects(packagedService.prepare(), (error) => error.code === 'update_size_unavailable')
      assert.equal(downloadCalls, 0, 'missing metadata size must stop before downloadUpdate')

      packagedService.electronUpdateInfo = updateInfo
      statfsError = Object.assign(new Error('fixture statfs failure'), { code: 'EACCES' })
      await assert.rejects(packagedService.prepare(), (error) => error.code === 'update_cache_space_unavailable')
      assert.equal(downloadCalls, 0, 'statfs failure must stop before downloadUpdate')

      statfsError = null
      packagedService.electronDownloaded = false
      freeBytes = 2n * 3000n + reserveBytes
      const activity = packagedService.activity
      packagedService.activity = async () => { throw Object.assign(new Error('busy'), { code: 'update_busy' }) }
      const preparedWhileBusy = await packagedService.prepare()
      await assert.rejects(packagedService.validateElectronPrepared(preparedWhileBusy.prepared_id), { code: 'update_busy' })
      await assert.rejects(packagedService.apply(preparedWhileBusy.prepared_id), { code: 'update_busy' })
      packagedService.activity = activity
      assert.equal(downloadCalls, 1, 'sufficient cache space must reach the existing downloader')
      assert.equal(readReceipt().download_method, 'network')
      assert.equal(readReceipt().payload_bytes, 3000)

      const priorStatfsCalls = statfsCalls
      packagedService.electronDownloaded = true
      packagedService.electronUpdateInfo = { version: '0.5.6', files: [] }
      packagedService.windowsReceipt = null
      cacheHit = true
      await packagedService.prepare()
      assert.equal(statfsCalls, priorStatfsCalls, 'already-downloaded same-process updates skip the redundant gate')
      assert.equal(readReceipt().download_method, 'cache')
      assert.equal(readReceipt().payload_bytes, 0)

      const preparedId = 'a'.repeat(32)
      packagedService.electronUpdateInfo = updateInfo
      packagedService.electronDownloaded = true
      packagedService.preparedIds.add(preparedId)
      freeBytes = 3000n + reserveBytes - 1n
      const stopBeforeSpaceFailure = stopEnv
      const installBeforeSpaceFailure = installCalls.length
      const mkdirBeforeSpaceFailure = mkdirPath
      let beforeInstallAfterSpaceFailure = false
      await assert.rejects(packagedService.apply(preparedId, {
        beforeInstall: async () => { beforeInstallAfterSpaceFailure = true }
      }), (error) => error.code === 'insufficient_update_cache_space'
        && error.message.includes('需要 0.6 GB') && error.message.includes('当前可用 0.5 GB'))
      assert.equal(beforeInstallAfterSpaceFailure, false)
      assert.equal(stopEnv, stopBeforeSpaceFailure)
      assert.equal(installCalls.length, installBeforeSpaceFailure)
      assert.equal(packagedService.preparedIds.has(preparedId), true, 'low-space apply keeps the prepared update retryable')
      assert.equal(packagedService.electronDownloaded, true)
      assert.equal(mkdirPath, mkdirBeforeSpaceFailure, 'low-space apply must fail before creating the installer temp directory')

      freeBytes = 3000n + reserveBytes
      cacheRedirected = true
      await assert.rejects(packagedService.apply(preparedId), (error) => error.code === 'update_cache_space_unavailable')
      assert.equal(installCalls.length, installBeforeSpaceFailure, 'a cache redirected off the install volume cannot launch')
      cacheRedirected = false

      await packagedService.apply(preparedId, {
        beforeInstall: async () => { beforeInstallTemp = { temp: process.env.TEMP, tmp: process.env.TMP } }
      })
      assert.equal(readReceipt().status, 'installing')
      packagedService.app.getVersion = () => updateInfo.version
      await packagedService.startAppUpdateBridge()
      assert.equal(readReceipt().status, 'completed')
      assert.equal(readReceipt().target_version, updateInfo.version)
      await packagedService.closeAppUpdateBridge()
      packagedService.app.getVersion = () => '0.5.5'
      assert.equal(mkdirPath, installerTemp)
      assert.equal(probePrefix, path.join(installerTemp, 'write-probe-'))
      assert.equal(removedProbe, `${probePrefix}fixture`)
      assert.deepEqual(beforeInstallTemp, { temp: 'before-temp', tmp: 'before-tmp' })
      assert.deepEqual(stopEnv, { temp: 'before-temp', tmp: 'before-tmp' })
      assert.deepEqual(installCalls[0], { args: [true, true], temp: installerTemp, tmp: installerTemp, installerTemp })
      assert.equal(process.env.TEMP, 'before-temp')
      assert.equal(process.env.TMP, 'before-tmp')
      assert.equal(process.env.TETHER_UPDATER_TEMP, 'before-installer-temp')

      delete process.env.TEMP
      delete process.env.TMP
      delete process.env.TETHER_UPDATER_TEMP
      const missingEnvPreparedId = 'd'.repeat(32)
      packagedService.preparedIds.add(missingEnvPreparedId)
      installError = null
      await packagedService.apply(missingEnvPreparedId)
      assert.deepEqual(installCalls[1], { args: [true, true], temp: installerTemp, tmp: installerTemp, installerTemp })
      assert.equal(process.env.TEMP, undefined)
      assert.equal(process.env.TMP, undefined)
      assert.equal(process.env.TETHER_UPDATER_TEMP, undefined)
      process.env.TEMP = 'before-temp'
      process.env.TMP = 'before-tmp'

      const failedPreparedId = 'b'.repeat(32)
      packagedService.preparedIds.add(failedPreparedId)
      installError = new Error('synchronous install call failure')
      await assert.rejects(packagedService.apply(failedPreparedId), /synchronous install call failure/)
      assert.equal(process.env.TEMP, 'before-temp')
      assert.equal(process.env.TMP, 'before-tmp')
      assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'update-result.json'), 'utf8')).ok, false)

      const mkdirFailedPreparedId = 'c'.repeat(32)
      packagedService.preparedIds.add(mkdirFailedPreparedId)
      mkdirError = Object.assign(new Error('access denied'), { code: 'EACCES' })
      const priorStopCalls = stopEnv
      await assert.rejects(packagedService.apply(mkdirFailedPreparedId), { code: 'app_update_temp_dir_failed' })
      assert.equal(installCalls.length, 3)
      assert.equal(stopEnv, priorStopCalls, 'temp directory failure must happen before stopping the managed node')
      assert.equal(process.env.TEMP, 'before-temp')
      assert.equal(process.env.TMP, 'before-tmp')

      mkdirError = null
      legacyIsRelocated = true
      packagedService.windowsCachePromise = null
      await packagedService.windowsUpdateLocation()
      assert.equal(updater.downloadedUpdateHelper.cacheDir, stagedLegacyCache,
        'reuse an existing user cache junction already on the installation volume')

      legacyIsRelocated = false
      physicalExecutable = 'C:\\Program Files\\Tether\\Tether.exe'
      packagedService.windowsCachePromise = null
      await packagedService.windowsUpdateLocation()
      assert.equal(updater.downloadedUpdateHelper.cacheDir, legacyCache,
        'Program Files updates use the current user cache when it is on the same volume')

      physicalExecutable = 'D:\\Program Files\\Tether\\Tether.exe'
      packagedService.windowsCachePromise = null
      mkdirError = Object.assign(new Error('installed volume is read-only to this user'), { code: 'EACCES' })
      await assert.rejects(packagedService.windowsUpdateLocation(),
        (error) => error.code === 'app_update_cache_location_unavailable')
      assert.equal(packagedService.windowsCachePromise, null, 'cache setup failure can be retried')
    } finally {
      Module._load = loadWithoutUpdater
      fs.mkdirSync = originalMkdirSync
      fs.mkdtempSync = originalMkdtempSync
      fs.rmdirSync = originalRmdirSync
      fs.statfsSync = originalStatfsSync
      fs.realpathSync.native = originalRealpathNative
      if (originalTemp === undefined) delete process.env.TEMP
      else process.env.TEMP = originalTemp
      if (originalTmp === undefined) delete process.env.TMP
      else process.env.TMP = originalTmp
      if (originalInstallerTemp === undefined) delete process.env.TETHER_UPDATER_TEMP
      else process.env.TETHER_UPDATER_TEMP = originalInstallerTemp
    }
  }

  const originalElectronUpdater = service.electronUpdater
  const originalAppEnv = service.env
  const originalGetVersion = service.app.getVersion
  service.electronUpdater = {}
  service.deviceId = 'DESKTOP-LOCAL'
  service.env = { TETHER_DEVICE: 'stale-environment-id', TETHER_CONTROLLER_URL: 'wss://HUB.EXAMPLE:443/ws/node' }
  service.app.getVersion = () => '0.5.6'
  const bridgeStatus = await service.status()
  assert.equal(bridgeStatus.device_id, 'DESKTOP-LOCAL')
  assert.equal(bridgeStatus.controller_origin, 'https://hub.example')
  assert.equal(bridgeStatus.current_version, '0.5.6')
  assert.ok(!Object.hasOwn(bridgeStatus, 'token'))

  const identity = { actorId: 'actor-1', controllerOrigin: 'https://hub.example',
    deviceId: 'DESKTOP-LOCAL', endpoint: 'http://127.0.0.1:43123/v1/update' }
  assert.equal(service.shouldRefreshAppUpdateBridgeRegistration(identity), true)
  service.rememberAppUpdateBridgeRegistration(identity)
  assert.equal(service.shouldRefreshAppUpdateBridgeRegistration(identity), false,
    'a healthy registered identity does not repeat state and registration requests')
  assert.equal(service.shouldRefreshAppUpdateBridgeRegistration({ ...identity, actorId: 'actor-2' }), true)
  assert.equal(service.shouldRefreshAppUpdateBridgeRegistration({ ...identity, controllerOrigin: 'https://other.example' }), true)
  assert.equal(service.shouldRefreshAppUpdateBridgeRegistration({ ...identity, deviceId: 'LAPTOP-01' }), true)
  assert.equal(service.shouldRefreshAppUpdateBridgeRegistration({ ...identity, endpoint: 'http://127.0.0.1:43124/v1/update' }), true)
  const reconnected = (online, lastSeen, available = false) => service.isAppUpdateBridgeReconnect({
    device_id: 'DESKTOP-LOCAL', online, last_seen: lastSeen,
    capabilities: { app_update_bridge_registration: 1, app_update_bridge_available: available }
  })
  assert.equal(reconnected(true, '2026-11-13T00:00:00Z'), true)
  assert.equal(reconnected(true, '2026-11-13T00:00:00Z'), false,
    'repeated healthy event snapshots do not trigger another registration')
  assert.equal(reconnected(true, '2026-11-13T00:00:00Z', true), false)
  assert.equal(reconnected(false, '2026-11-13T00:00:01Z'), false)
  assert.equal(reconnected(true, '2026-11-13T00:00:02Z'), true,
    'an online event after the Node was offline refreshes the bridge')
  const restartedService = new UpdateService({ repoRoot, dataDir, python: 'python-fixture',
    env: {}, app: { getPath: () => userData, isPackaged: false }, deviceId: 'DESKTOP-LOCAL', exec })
  assert.equal(restartedService.shouldRefreshAppUpdateBridgeRegistration(identity), true,
    'a new APP process has no in-memory registration key and can rebind after Node restart')
  service.electronUpdater = originalElectronUpdater
  service.env = originalAppEnv
  service.app.getVersion = originalGetVersion
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
