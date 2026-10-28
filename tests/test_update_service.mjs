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
const { UpdateService } = require('../apps/tether-app/update-service.js')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-update-service-'))
const repoRoot = path.join(temp, 'repo')
const dataDir = path.join(temp, 'data')
const userData = path.join(temp, 'user-data')
fs.mkdirSync(path.join(repoRoot, 'tether'), { recursive: true })
for (const name of ['updates.py', 'updates_cli.py', '__init__.py']) fs.writeFileSync(path.join(repoRoot, 'tether', name), '# fixture\n')
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
const service = new UpdateService({
  repoRoot, dataDir, python: 'python-fixture', env: { TETHER_NATIVE_DSH_HOME: 'C:/Users/test/.dsh', DSH_HOME: 'ignored' },
  app: { getPath: () => userData, isPackaged: false }, exec, spawnChild
})

try {
  const checked = await service.check()
  assert.equal(checked.latest_version, '0.2.1')
  assert.ok(calls[0].includes('--component') && calls[0].includes('app'))
  assert.ok(calls[0].includes('--root') && calls[0].includes(repoRoot))
  assert.ok(calls[0].includes('--state-dir') && calls[0].includes(path.join(dataDir, 'updates')))
  assert.ok(calls[0].includes('--dsh-home') && calls[0].includes('C:/Users/test/.dsh'))

  await service.status()
  assert.equal(await service.apply('unknown-prepared-id').catch((error) => error.code), 'invalid_prepared_id')
  const prepared = await service.prepare()
  assert.equal(prepared.prepared_id, 'fixture-prepared-02')
  const result = await service.apply(prepared.prepared_id)
  assert.equal(result.status, 'installing')
  assert.ok(fs.existsSync(path.join(userData, 'update-helper-runtime', 'tether', 'updates.py')))
  assert.ok(fs.existsSync(path.join(userData, 'update-helper-runtime', 'tether', 'node', 'dsh_sessions.py')))
  assert.ok(fs.existsSync(path.join(userData, 'tether-update-helper.js')))
  assert.equal(spawnConfig.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(spawnConfig.options.stdio[3], 'ipc')
  const helperConfig = JSON.parse(fs.readFileSync(path.join(userData, 'tether-update-helper.json'), 'utf8'))
  assert.equal(helperConfig.dshHome, 'C:/Users/test/.dsh')
  assert.equal(helperConfig.stateDir, path.join(dataDir, 'updates'))
  assert.deepEqual(helperConfig.launchArgs, [path.join(repoRoot, 'apps', 'tether-app')])
  assert.equal(helperConfig.env.PYTHONPATH, path.join(userData, 'update-helper-runtime'))

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
  const ui = fs.readFileSync(path.join(projectRoot, 'packages', 'tether-ui', 'src', 'app.js'), 'utf8')
  assert.ok(ui.includes("replace('/updates?', '/updates/status?')"))
  assert.ok(ui.includes('/updates?component='))
  assert.ok(ui.includes("'Tether Desktop（APP + Node）'"))
  assert.ok(ui.includes("'Tether for DSH（插件 + Node）'"))
  assert.ok(!ui.includes('目标设备上的'), 'card titles must name the device, not "target device"')
  assert.ok(ui.includes('disabled: busy || !hasUpdate'), 'one-click must be disabled when already current')
  assert.ok(ui.includes("btn('稍后'") && ui.includes("btn('重启并安装'"))
  assert.ok(ui.includes('error.status = response.status'))
  assert.ok(ui.includes("'服务端不支持更新'"))
  assert.ok(ui.includes("lastUpdateToastRef"), 'update errors must be deduped through the toast layer')
  assert.ok(!ui.includes('git pull'))
  const build = fs.readFileSync(path.join(projectRoot, 'packages', 'tether-ui', 'scripts', 'build.mjs'), 'utf8')
  assert.ok(build.includes('createDshLocalPluginUpdateBridge(() => localPluginRpc)'))
  assert.ok(build.includes("inject: ['slots', 'layout', 'connection']"))
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
