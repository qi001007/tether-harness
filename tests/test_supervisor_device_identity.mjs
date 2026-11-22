import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Supervisor } from '../apps/tether-app/supervisor.js'
import { idleForMigration, ownerDevice } from '../apps/tether-app/standalone-node-migration.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('an old Windows installation can hand over only its own idle device', () => {
  const device = { device_id: 'a', owner_id: 'owner', online: true }
  const state = { user: { user_id: 'owner' }, devices: [device], runs: [] }
  const sessions = { sessions: [] }, jobs = { jobs: [{ state: 'interrupted' }] }, copy = { state: 'idle' }
  assert.equal(ownerDevice(state, 'a'), device)
  assert.equal(ownerDevice({ ...state, user: { user_id: 'other' } }, 'a'), null)
  assert.equal(idleForMigration(state, sessions, jobs, copy, 'a'), true)
  assert.equal(idleForMigration(state, { sessions: [{ status: 'running' }] }, jobs, copy, 'a'), false)
  assert.equal(idleForMigration(state, sessions, [{ state: 'verifying' }], copy, 'a'), false)
  assert.equal(idleForMigration(state, sessions, jobs, { state: 'running' }, 'a'), false)
  assert.equal(idleForMigration({ ...state, runs: [{ device_id: 'a', state: 'dispatching' }] },
    sessions, jobs, copy, 'a'), false)
})

test('the packaged Node adopts the existing data and workspace under the App installer', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-adoption-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const database = path.join(dataDir, 'original.db')
  fs.writeFileSync(database, 'existing')
  const token = 'x'.repeat(40)
  let childArgs, childEnv
  const supervisor = new Supervisor({
    repoRoot: root, dataDir,
    env: { TETHER_CONTROLLER_URL: 'https://hub.example', TETHER_NODE_TOKEN: 'test',
      TETHER_PYTHON: process.execPath, TETHER_NODE_UPDATE_OWNER: 'app_installer' },
    managedNode: { workspace: dataDir, database, consolePort: 21234, localApiToken: token,
      environment: { DSH_HOME: dataDir, TETHER_NODE_UPDATE_OWNER: 'node_zip', PYTHONPATH: 'external' } },
    spawnChild: (program, args, options) => {
      assert.equal(program, process.execPath)
      childArgs = args
      childEnv = options.env
      fs.closeSync(options.stdio[1])
      return Object.assign(new EventEmitter(), { pid: 123 })
    }
  })
  supervisor.healthy = async () => ({ devices: [] })
  supervisor.startPolling = () => {}
  await supervisor.start()
  assert.equal(childArgs[childArgs.indexOf('--workspace') + 1], dataDir)
  assert.equal(childArgs[childArgs.indexOf('--db') + 1], database)
  assert.equal(childArgs[childArgs.indexOf('--console-port') + 1], '21234')
  assert.equal(childEnv.DSH_HOME, dataDir)
  assert.equal(childEnv.TETHER_LOCAL_API_TOKEN, token)
  assert.equal(childEnv.TETHER_NODE_UPDATE_OWNER, 'app_installer')
  assert.equal(childEnv.PYTHONPATH, root)
})

test('Hub APP status reports only its configured device as online', async (t) => {
  const supervisors = []
  t.after(() => supervisors.forEach((supervisor) => fs.rmSync(supervisor.dataDir, { recursive: true, force: true })))
  const startWith = async (devices) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-'))
    const supervisor = new Supervisor({
      repoRoot: root,
      dataDir,
      env: { TETHER_CONTROLLER_URL: 'https://hub.example', TETHER_DEVICE: 'node-a' }
    })
    supervisors.push(supervisor)
    supervisor.healthy = async () => ({ devices })
    supervisor.startPolling = () => {}
    return supervisor.start()
  }

  const otherNodeState = await startWith([
    { device_id: 'node-b', online: true },
    { device_id: 'node-c', online: false }
  ])
  assert.equal(otherNodeState.node.deviceOnline, false)
  assert.equal(otherNodeState.onlineDeviceCount, 1)

  const configuredNodeState = await startWith([
    { device_id: 'node-a', online: true },
    { device_id: 'node-b', online: false }
  ])
  assert.equal(configuredNodeState.node.deviceOnline, true)
  assert.equal(configuredNodeState.onlineDeviceCount, 1)
})

test('Hub APP external Node mode does not start or stop a second Node', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-external-node-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const spawned = []
  const supervisor = new Supervisor({
    repoRoot: root,
    dataDir,
    env: {
      TETHER_CONTROLLER_URL: 'https://hub.example',
      TETHER_DEVICE: 'node-a',
      TETHER_NODE_TOKEN: 'device-token',
      TETHER_NODE_MODE: 'external'
    },
    spawnChild: (...args) => { spawned.push(args); throw new Error('external Node mode must not spawn') }
  })
  supervisor.healthy = async () => ({ devices: [{ device_id: 'node-a', online: true }] })

  const started = await supervisor.start()
  assert.equal(started.mode, 'hub')
  assert.equal(started.node.state, 'external')
  assert.equal(started.node.deviceOnline, true)
  assert.equal(supervisor.procs.node, null)
  assert.equal(spawned.length, 0)

  const stopped = await supervisor.stop()
  assert.equal(stopped.node.state, 'stopped')
  assert.equal(supervisor.procs.node, null)
  assert.equal(spawned.length, 0)
})

test('external Node local API is opt-in and rejects malformed credentials or ports', (t) => {
  const dataDirs = []
  t.after(() => dataDirs.forEach((dataDir) => fs.rmSync(dataDir, { recursive: true, force: true })))
  const make = (extra = {}) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-external-api-'))
    dataDirs.push(dataDir)
    return new Supervisor({ repoRoot: root, dataDir, env: {
      TETHER_CONTROLLER_URL: 'https://hub.example', TETHER_DEVICE: 'node-a',
      TETHER_NODE_MODE: 'external', ...extra
    } })
  }
  const absent = make()
  assert.equal(absent.hasLocalNodeApi(), false)
  for (const config of [
    { TETHER_CONSOLE_PORT: '18894' },
    { TETHER_LOCAL_API_TOKEN: 'x'.repeat(40) },
    { TETHER_CONSOLE_PORT: '0', TETHER_LOCAL_API_TOKEN: 'x'.repeat(40) },
    { TETHER_CONSOLE_PORT: '65536', TETHER_LOCAL_API_TOKEN: 'x'.repeat(40) },
    { TETHER_CONSOLE_PORT: '18894x', TETHER_LOCAL_API_TOKEN: 'x'.repeat(40) },
    { TETHER_CONSOLE_PORT: '18894', TETHER_LOCAL_API_TOKEN: 'short' },
    { TETHER_CONSOLE_PORT: '18894', TETHER_LOCAL_API_TOKEN: 'x'.repeat(31) },
    { TETHER_CONSOLE_PORT: '18894', TETHER_LOCAL_API_TOKEN: 'x'.repeat(32) + ' ' }
  ]) assert.throws(() => make(config), /invalid external local Node API configuration/)

  const token = 'a'.repeat(40)
  const configured = make({ TETHER_CONSOLE_PORT: '43210', TETHER_LOCAL_API_TOKEN: token })
  assert.equal(configured.hasLocalNodeApi(), true)
  assert.equal(configured.consolePort, 43210)
  assert.equal(configured.localApiToken === token, true)
  assert.equal(JSON.stringify(configured.snapshot()).includes(token), false)
  assert.equal(fs.readdirSync(configured.logsDir).join('').includes(token), false)
})

test('attached managed Node remains eligible for the local API without a child handle', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-attached-node-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const supervisor = new Supervisor({ repoRoot: root, dataDir, env: { TETHER_NODE_MODE: 'managed' } })
  supervisor.node = { state: 'running', pid: 12345, deviceOnline: true }
  supervisor.procs.node = null

  assert.equal(supervisor.hasLocalNodeApi(), true)
  for (const state of ['stopped', 'error']) {
    supervisor.node.state = state
    assert.equal(supervisor.hasLocalNodeApi(), false)
  }
})

for (const identityAvailable of [true, false]) test(identityAvailable
  ? 'managed Node persists the spawned process identity and stops its console child before an update'
  : 'managed Node starts and safely stops its own live child when OS identity lookup is unavailable', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-managed-identity-'))
  const childScript = path.join(dataDir, 'managed-tree.cjs')
  fs.writeFileSync(childScript, `
    if (process.argv[2] === 'console') {
      require('node:http').createServer((request, response) => {
        response.writeHead(request.headers.authorization === 'Bearer ' + process.env.TETHER_LOCAL_API_TOKEN ? 200 : 401)
        response.end()
      }).listen(Number(process.env.TETHER_CONSOLE_PORT), '127.0.0.1')
    } else {
      require('node:child_process').spawn(process.execPath, [__filename, 'console'], { stdio: 'inherit' })
    }
  `)
  const portProbe = http.createServer()
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  const port = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const options = { repoRoot: root, dataDir, preserveManagedNodeOnExit: true,
    env: { TETHER_CONTROLLER_URL: 'https://hub.example', TETHER_DEVICE: 'node-a', TETHER_NODE_TOKEN: 'fixture-device',
      TETHER_PYTHON: process.execPath, TETHER_CONSOLE_PORT: String(port) } }
  const { spawn } = await import('node:child_process')
  const first = new Supervisor({ ...options,
    spawnChild: (executable, _args, options) => spawn(executable, [childScript], options) })
  first.healthy = async () => ({ devices: [] })
  if (!identityAvailable) first.processIdentity = () => null
  t.after(async () => {
    await first.stop()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
  assert.equal((await first.start()).node.state, 'running')
  const child = first.procs.node
  const state = first.readManagedNodeState()
  assert.equal(state.pid, child.pid)
  const reopened = new Supervisor(options)
  if (!identityAvailable) {
    reopened.processIdentity = () => null
    assert.equal(state.processCreatedAt, undefined)
    await assert.rejects(reopened.attachManagedNode(), { code: 'managed_node_process_mismatch' })
    assert.deepEqual(await first.stopManagedNode(), { stopped: true })
    assert.equal(first.processAlive(child.pid), false)
    assert.equal(first.readManagedNodeState(), null)
    return
  }
  assert.equal(state.processCreatedAt, first.processIdentity(child.pid).created)
  assert.ok(state.processPath)
  if (process.platform === 'win32') {
    const { processCreatedAt, processPath, ...legacyState } = state
    first.writeManagedNodeState(legacyState)
    reopened.managedNodeState = reopened.readManagedNodeState()
  }

  assert.equal(await reopened.attachManagedNode(), true)
  assert.equal(reopened.node.pid, child.pid)
  assert.equal(reopened.readManagedNodeState().processCreatedAt, state.processCreatedAt)
  assert.deepEqual(await reopened.stopManagedNode(), { stopped: true })
  assert.equal(reopened.processAlive(child.pid), false)
  assert.equal(reopened.readManagedNodeState(), null)
})

test('missing controller device data remains unknown while an explicit empty list means zero', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-state-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const supervisor = new Supervisor({ repoRoot: root, dataDir, env: { TETHER_DEVICE: 'node-a' } })
  assert.equal(supervisor.deviceOnline(null), null)
  assert.equal(supervisor.deviceOnline({}), null)
  assert.equal(supervisor.onlineDevices({}), null)
  assert.equal(supervisor.deviceOnline({ devices: [] }), false)
  assert.equal(supervisor.onlineDevices({ devices: [] }), 0)
})

test('local APP explains that a Hub or private server package is required', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-no-server-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const supervisor = new Supervisor({
    repoRoot: root,
    dataDir,
    env: { TETHER_PYTHON: 'missing-private-server-python' }
  })
  supervisor.healthy = async () => null

  const state = await supervisor.start()
  assert.equal(state.mode, 'missing-server')
  assert.equal(state.controller.state, 'error')
  assert.match(state.error, /配置 Hub/)
  assert.match(state.error, /tether-harness-server/)
  assert.equal(supervisor.procs.controller, null)
  assert.equal(supervisor.procs.node, null)
})

test('manual probe performs a status request without restarting managed services and records safe timing', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-probe-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const supervisor = new Supervisor({ repoRoot: root, dataDir, env: { TETHER_CONTROLLER_URL: 'https://user:secret@hub.example/path?token=hidden' } })
  supervisor.mode = 'hub'
  supervisor.controller.state = 'online'
  let requests = 0
  supervisor.requestState = async () => { requests += 1; return { devices: [] } }
  const result = await supervisor.probe()
  assert.equal(requests, 1)
  assert.equal(result.controller.state, 'online')
  assert.equal(result.lastProbe.status, 'online')
  assert.equal(Number.isFinite(result.lastProbe.durationMs), true)
  assert.equal(result.error, '')
  assert.equal(supervisor.procs.controller, null)
  assert.equal(supervisor.procs.node, null)
  supervisor.requestState = async (_timeout, onFailure) => { onFailure('unreachable'); return null }
  const failed = await supervisor.probe()
  assert.equal(failed.controller.state, 'offline')
  assert.equal(failed.lastProbe.status, 'offline')
  assert.equal(failed.error, '服务不可达或响应超时')
  assert.equal(failed.remoteUrl, 'https://hub.example/path')
  assert.equal(JSON.stringify(failed).includes('secret'), false)
})

test('manual probe classifies authentication rejection without exposing the response body', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-auth-probe-'))
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { 'Content-Type': 'text/plain' })
    response.end('secret-token-invalid-detail')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  const supervisor = new Supervisor({ repoRoot: root, dataDir, env: { TETHER_CONTROLLER_URL: 'http://127.0.0.1:' + server.address().port } })
  supervisor.mode = 'hub'
  supervisor.controller.state = 'online'
  const result = await supervisor.probe()
  assert.equal(result.lastProbe.status, 'offline')
  assert.equal(result.lastProbe.errorKind, 'auth')
  assert.equal(result.error, '认证失败')
  assert.equal(JSON.stringify(result).includes('secret-token-invalid-detail'), false)
})

test('managed Node exit 75 starts exactly one replacement with the same command', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-restart-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const spawned = []
  const supervisor = new Supervisor({
    repoRoot: root,
    dataDir,
    env: { TETHER_PYTHON: 'python-fixture' },
    spawnChild: (_python, args, options) => {
      const child = new EventEmitter()
      child.pid = 500 + spawned.length
      spawned.push({ child, args, options })
      return child
    }
  })
  supervisor.mode = 'standalone'
  const command = ['-m', 'tether.node.agent', '--device', 'device-a']
  const original = supervisor.spawnProcess('node', command)
  supervisor.procs.node = original
  supervisor.node = { state: 'running', pid: original.pid, deviceOnline: true }
  original.emit('exit', 75)

  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(spawned.length, 2)
  assert.deepEqual(spawned[1].args, command)
  assert.equal(spawned[1].options.env.TETHER_NODE_MANAGED, '1')
  assert.equal(supervisor.node.state, 'running')
  assert.equal(supervisor.node.deviceOnline, true)
  assert.equal(supervisor.node.pid, spawned[1].child.pid)
})

test('real managed child exit 75 is restarted once and then stops cleanly', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-supervisor-real-restart-'))
  const statePath = path.join(dataDir, 'starts.json')
  const childScript = path.join(dataDir, 'managed-node-fixture.cjs')
  fs.writeFileSync(childScript, [
    "const fs = require('node:fs')",
    "const statePath = process.env.TETHER_FIXTURE_STATE",
    "if (process.env.TETHER_NODE_MANAGED !== '1') process.exit(92)",
    "const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { starts: 0 }",
    'state.starts += 1',
    "fs.writeFileSync(statePath, JSON.stringify(state))",
    'process.exit(state.starts === 1 ? 75 : 0)'
  ].join('\n'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const supervisor = new Supervisor({
    repoRoot: root,
    dataDir: path.join(dataDir, 'logs-home'),
    env: { TETHER_PYTHON: process.execPath, TETHER_FIXTURE_STATE: statePath }
  })
  supervisor.mode = 'standalone'
  const child = supervisor.spawnProcess('node', [childScript])
  supervisor.procs.node = child
  supervisor.node = { state: 'running', pid: child.pid, deviceOnline: true }
  let spawnError = null
  child.once('error', (error) => { spawnError = error })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (fs.existsSync(statePath)) {
      try {
        if (JSON.parse(fs.readFileSync(statePath, 'utf8')).starts >= 2 && supervisor.node.state === 'stopped') break
      } catch (_) { /* wait for the fixture write */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (spawnError && spawnError.code === 'EPERM') { t.skip('sandbox denied process creation with EPERM'); return }
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.equal(state.starts, 2)
  assert.equal(supervisor.node.state, 'stopped')
})
