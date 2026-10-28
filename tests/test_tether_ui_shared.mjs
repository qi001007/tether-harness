import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shared = fs.readFileSync(path.join(root, 'packages/tether-ui/src/app.js'), 'utf8')
const plugin = fs.readFileSync(path.join(root, 'packages/dsh-plugin-tether-client/lib/client.js'), 'utf8')
const connectionPanel = fs.readFileSync(path.join(root, 'packages/tether-ui/src/connection-panel.js'), 'utf8')

test('DSH plugin bundle is up to date with the shared tether-ui source', () => {
  const bundledPanel = connectionPanel.replace(/^export /gm, '').trim()
  assert.ok(plugin.includes(bundledPanel), 'plugin bundle embeds the shared connection component')
  assert.match(fs.readFileSync(path.join(root, 'packages/tether-ui/scripts/build.mjs'), 'utf8'), /connectionPanel/)
})

test('the shared panel body is copied byte for byte into the plugin bundle', () => {
  const start = shared.indexOf('    const C = {')
  const end = shared.indexOf('    return { App, TetherIcon }')
  assert.ok(start > 0 && end > start)
  const body = shared.slice(start, end)
  assert.ok(plugin.includes(body), 'plugin bundle must embed the shared UI body unchanged')
  assert.equal((plugin.match(/function App\(\) \{/g) || []).length, 1, 'only one App implementation ships')
  assert.equal((plugin.match(/function createTetherPanel\(/g) || []).length, 1)
})

test('remote FilesPane exposes a new-file action for the current target directory', () => {
  assert.match(shared, /const makeFile = \(base\) => askValue\('新建文件'/)
  assert.match(shared, /post\(fsPath\('write'\), \{ path: target, text: '' \}\)/)
  assert.match(shared, /iconButton\('plus', '新建文件', \(\) => makeFile\(path\), !path \|\| dirLoading \|\| previewBusy\)/)
})

test('connection panels show service checks without duplicate device totals or credentials', async () => {
  const { hubAddressForEditor, hubProbeErrorText, hubUrlNeedsReplacement, safeServiceAddress } = await import('../packages/tether-ui/src/app.js')
  assert.equal(safeServiceAddress('https://user:secret@hub.example:8443/api?token=hidden#frag'), 'https://hub.example:8443/api')
  assert.equal(safeServiceAddress('not a url'), '未配置')
  assert.equal(hubAddressForEditor(''), '')
  assert.equal(hubAddressForEditor('https://hub.example:8443/base'), 'https://hub.example:8443/base')
  assert.equal(hubAddressForEditor('https://user:secret@hub.example/base?token=hidden'), '')
  assert.equal(hubUrlNeedsReplacement('https://user:secret@hub.example/base?token=hidden'), true)
  assert.equal(hubUrlNeedsReplacement('https://hub.example/base'), false)
  assert.equal(hubUrlNeedsReplacement('not a url'), true)
  assert.equal(hubProbeErrorText({ status: 401 }), '访问令牌无效或没有访问权限，请检查 Hub 凭据。')
  assert.equal(hubProbeErrorText({ status: 403 }), '访问令牌无效或没有访问权限，请检查 Hub 凭据。')
  assert.equal(hubProbeErrorText(new Error('secret response')), 'Hub 不可达或请求超时，请检查服务地址与网络后重试。')
  assert.equal(hubProbeErrorText({ status: undefined }), 'Hub 不可达或请求超时，请检查服务地址与网络后重试。')
  assert.doesNotMatch(shared, /\['(?:本机节点|当前目标|在线设备|目标在线)'/)
  assert.match(connectionPanel, /服务响应耗时/)
  assert.match(shared, /Hub 不可达或请求超时/)
  assert.match(shared, /url\.username \|\| url\.password \|\| url\.search \|\| url\.hash/)
  assert.match(shared, /createConnectionPanel/)
  assert.match(shared, /hubCheckedAt/)
  assert.match(shared, /host\.kind === 'dsh' \|\| host\.kind === 'app'/)
  assert.match(shared, /Connection\.Panel/)
  assert.match(shared, /errorKind === 'auth' \? 401/)
  assert.match(connectionPanel, /重新检测/)
  assert.match(fs.readFileSync(path.join(root, 'packages/tether-ui/src/hosts/dsh.js'), 'utf8'), /probeConnection: async/)
  assert.match(fs.readFileSync(path.join(root, 'packages/tether-ui/src/hosts/electron.js'), 'utf8'), /probeConnection: async/)
  const webMain = fs.readFileSync(path.join(root, 'packages/tether-ui/web/main.js'), 'utf8')
  assert.match(webMain, /createAppErrorBoundary\(React\)/)
  assert.match(webMain, /root\.render\(React\.createElement\(AppErrorBoundary, null, React\.createElement\(panel\.App\)\)\)/)
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'packages/tether-ui/web/main.js'), 'utf8'), /createAppServices/)
})

test('Web UI error boundary renders a retry action and recovers its children', async () => {
  const { createAppErrorBoundary } = await import('../packages/tether-ui/web/app-error-boundary.js')
  class Component {
    constructor(props) { this.props = props }
    setState(next) { this.state = { ...this.state, ...next } }
  }
  const React = { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }
  const Boundary = createAppErrorBoundary(React)
  const children = { type: 'shared-panel' }
  const boundary = new Boundary({ children })
  boundary.state = Boundary.getDerivedStateFromError(new Error('render failed'))
  const fallback = boundary.render()
  assert.equal(fallback.props.role, 'alert')
  assert.match(fallback.children[0].children[0], /界面遇到错误，请重试重新加载/)
  const retry = fallback.children[1]
  assert.equal(retry.children[0], '重试')
  retry.props.onClick()
  assert.equal(boundary.render(), children)
})

test('DSH Hub probe does not treat local fallbacks as Hub connectivity', async () => {
  const { createDshHost } = await import('../packages/tether-ui/src/hosts/dsh.js')
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  let stored = null
  let requests = 0
  globalThis.window = { localStorage: { getItem: () => stored } }
  globalThis.fetch = async () => { requests += 1; return new Response(JSON.stringify({ devices: [] }), { status: 200 }) }
  try {
    const host = createDshHost()
    assert.equal(await host.probeHub(), null)
    assert.equal(requests, 0)
    stored = JSON.stringify({ url: 'https://user:pass@hub.example/path?secret=1', token: 'hidden' })
    const result = await host.probeHub()
    assert.deepEqual(result.state, { devices: [] })
    assert.equal(Number.isFinite(result.durationMs), true)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = previousFetch
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('one-click updates check, prepare, and apply only a current prepared package', async () => {
  const { runUpdateSequence } = await import('../packages/tether-ui/src/app.js')
  const calls = []
  const result = await runUpdateSequence({
    check: async () => { calls.push('check'); return { update_available: true } },
    prepare: async () => { calls.push('prepare'); return { prepared_id: 'verified-package' } },
    apply: async (id) => { calls.push('apply:' + id); return { ok: true } }
  })
  assert.deepEqual(calls, ['check', 'prepare', 'apply:verified-package'])
  assert.equal(result.updated, true)
})

test('one-click updates stop when there is no update or the selected device changes', async () => {
  const { runUpdateSequence } = await import('../packages/tether-ui/src/app.js')
  let prepared = false
  const noUpdate = await runUpdateSequence({
    check: async () => ({ update_available: false }),
    prepare: async () => { prepared = true; return { prepared_id: 'x' } }, apply: async () => ({})
  })
  assert.equal(noUpdate.updated, false)
  assert.equal(prepared, false)

  let current = true
  const stale = await runUpdateSequence({
    check: async () => ({ update_available: true }),
    prepare: async () => { current = false; return { prepared_id: 'x' } },
    apply: async () => assert.fail('stale device must not be updated'),
    isCurrent: () => current
  })
  assert.equal(stale.cancelled, true)
})

test('one-click updates stop on rejected stages and pass the fresh authority through', async () => {
  const { runUpdateSequence } = await import('../packages/tether-ui/src/app.js')
  for (const [stage, rejection] of [
    ['check', null], ['check', { ok: false, update_available: false }],
    ['prepare', null], ['prepare', { ok: false }],
    ['apply', null], ['apply', { ok: false }]
  ]) {
    const calls = []
    const result = await runUpdateSequence({
      check: async () => { calls.push('check'); return stage === 'check' ? rejection : { update_available: true, authorityBase: '' } },
      prepare: async (checked) => { calls.push('prepare:' + checked.authorityBase); return stage === 'prepare' ? rejection : { prepared_id: 'pkg' } },
      apply: async (id, checked) => { calls.push('apply:' + id + ':' + checked.authorityBase); return stage === 'apply' ? rejection : { ok: true } }
    })
    assert.deepEqual(result, { failed: true, stage })
    const lastCall = stage === 'check' ? ['check'] : stage === 'prepare' ? ['check', 'prepare:'] : ['check', 'prepare:', 'apply:pkg:']
    assert.deepEqual(calls, lastCall)
  }

  const order = []
  await runUpdateSequence({
    check: async () => ({ update_available: true, authorityBase: '' }),
    prepare: async (checked) => { order.push(checked.authorityBase); return { prepared_id: 'pkg' } },
    apply: async (_id, checked) => { order.push(checked.authorityBase); return { ok: true } }
  })
  assert.deepEqual(order, ['', ''])
})

test('automatic update checks report availability, failures, and stale targets safely', async () => {
  const { cachedUpdateCheck, checkUpdateAvailability, dedupeUpdateCheck, deviceAfterLocalIdentity, localPluginNeedsRestart, localPluginVersionSeed, orderNetworkDevices, shortUpdateError, updateAvailableFor, updateCheckKey, withUpdateTimeout } = await import('../packages/tether-ui/src/app.js')
  assert.deepEqual(await checkUpdateAvailability(async () => ({ update_available: true })), {
    current: true, updateAvailable: true, result: { update_available: true }
  })
  assert.equal((await checkUpdateAvailability(async () => ({ update_available: false }))).updateAvailable, false)
  assert.equal((await checkUpdateAvailability(async () => ({ ok: false, message: 'offline' }))).failed, true)
  assert.equal((await checkUpdateAvailability(async () => { throw new Error('offline') })).failed, true)
  assert.equal(shortUpdateError(Object.assign(new Error('timeout'), { code: 'update_timeout' })), '更新检查超时，请手动刷新重试')
  let now = 1000
  let checks = 0
  const cache = new Map()
  const cachedCheck = () => cachedUpdateCheck(cache, 'device:node', async () => ({ update_available: ++checks > 0 }), { now: () => now })
  await cachedCheck()
  await cachedCheck()
  assert.equal(checks, 1)
  now += 300_001
  await cachedCheck()
  assert.equal(checks, 2)
  await cachedUpdateCheck(cache, 'device:node', async () => ({ update_available: true, forced: true }), { force: true, now: () => now })
  assert.equal(cache.get('device:node').value.forced, true)
  await assert.rejects(withUpdateTimeout(new Promise(() => {}), 5), (error) => error.code === 'update_timeout')
  assert.equal(localPluginNeedsRestart({ current_version: '0.2.10', runtime_version: '0.2.5' }), true)
  assert.equal(localPluginNeedsRestart({ current_version: '0.2.10', runtime_version: '0.2.10' }), false)
  assert.equal(localPluginNeedsRestart({ current_version: '0.2.10' }), false)
  assert.deepEqual(localPluginVersionSeed({ kind: 'dsh', pluginVersion: '0.2.10' }), { current_version: '0.2.10', runtime_version: '0.2.10' })
  assert.equal(localPluginVersionSeed({ kind: 'web', pluginVersion: '0.2.10' }), null)

  let current = true
  const switched = await checkUpdateAvailability(async () => {
    current = false
    return { update_available: true }
  }, () => current)
  assert.deepEqual(switched, { cancelled: true })

  const info = { devices: {
    alpha: { node: { update_available: true } },
    beta: { plugin: { update_available: true } }
  }, app: { update_available: true }, localPlugin: { update_available: true } }
  assert.equal(updateAvailableFor(info, 'app', 'beta'), true)
  assert.equal(updateAvailableFor(info, 'dsh', 'alpha'), true)
  assert.equal(updateAvailableFor(info, 'web', 'alpha'), true)
  assert.equal(updateAvailableFor(info, 'web', 'beta'), true)
  assert.equal(updateAvailableFor(info, 'web', 'gamma'), false)
  assert.equal(updateAvailableFor({ devices: { alpha: { node: { update_available: true } } } }, 'web', 'beta'), false)

  const devices = [{ device_id: 'DESKTOP-LOCAL' }, { device_id: 'LAPTOP-01' }, { device_id: 'NODE-02' }]
  assert.deepEqual(orderNetworkDevices(devices, 'DESKTOP-LOCAL').map((item) => item.device_id), ['DESKTOP-LOCAL', 'LAPTOP-01', 'NODE-02'])
  assert.deepEqual(orderNetworkDevices(devices, 'LAPTOP-01').map((item) => item.device_id), ['LAPTOP-01', 'DESKTOP-LOCAL', 'NODE-02'])
  assert.deepEqual(orderNetworkDevices(devices, '').map((item) => item.device_id), ['DESKTOP-LOCAL', 'LAPTOP-01', 'NODE-02'])
  assert.equal(deviceAfterLocalIdentity('NODE-02', 'LAPTOP-01', false), 'LAPTOP-01')
  assert.equal(deviceAfterLocalIdentity('NODE-02', 'LAPTOP-01', true), 'NODE-02')
  assert.equal(deviceAfterLocalIdentity('NODE-02', '', false), 'NODE-02')
  assert.match(shared, /const localId = appLocalDevice\s*\n/)
  assert.doesNotMatch(shared, /appLocalDevice\s*\|\|\s*\(state && state\.local_device\)/)
  assert.doesNotMatch(shared, /appLocalDeviceRef\.current\s*\|\|\s*data\.local_device/)

  const pending = {}
  let calls = 0
  let release
  const wait = new Promise((resolve) => { release = resolve })
  const first = dedupeUpdateCheck(pending, 'alpha:node', async () => { calls += 1; await wait; return 'checked' })
  const duplicate = dedupeUpdateCheck(pending, 'alpha:node', async () => { calls += 1; return 'duplicate' })
  const otherDevice = dedupeUpdateCheck(pending, 'beta:node', async () => { calls += 1; return 'separate-target' })
  assert.equal(first, duplicate)
  assert.equal(await otherDevice, 'separate-target')
  release()
  assert.equal(await first, 'checked')
  assert.equal(calls, 2)
  assert.deepEqual(pending, {})

  const firstEpoch = updateCheckKey('node', { deviceId: 'alpha', epoch: 1 })
  const returnedEpoch = updateCheckKey('node', { deviceId: 'alpha', epoch: 3 })
  assert.notEqual(firstEpoch, returnedEpoch)
  assert.equal(updateCheckKey('node', { deviceId: 'alpha', epoch: 3 }), returnedEpoch)
})

test('the shared factory accepts a DSH host and a Web host without DSH globals', async () => {
  const { createTetherPanel } = await import('../packages/tether-ui/src/app.js')
  const { createDshHost } = await import('../packages/tether-ui/src/hosts/dsh.js')
  const { createWebHost, createWebNative } = await import('../packages/tether-ui/src/hosts/web.js')
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState() { return [null, () => {}] },
    useEffect() {}, useRef() { return { current: null } }, useCallback(fn) { return fn }, useId() { return 'id' }
  }
  const Native = {
    chatZh: {}, workspaceZh: {}, toolZh: {}, markdownLabels: () => ({}),
    FileEntryRow: () => null, FileTypeIcon: () => null, MarkdownText: () => null
  }
  const dsh = createTetherPanel({ React, Native, host: createDshHost() })
  assert.equal(typeof dsh.App, 'function')
  assert.equal(typeof dsh.TetherIcon, 'function')
  assert.equal(createDshHost().apiBase(), 'http://127.0.0.1:18890')
  assert.equal(createWebHost().apiBase(), '')

  const web = createTetherPanel({ React, Native: createWebNative(React), host: createWebHost({ apiBase: '/tether' }) })
  assert.equal(typeof web.App, 'function')
  const native = createWebNative(React)
  const row = native.FileEntryRow({ entry: { name: 'demo', type: 'directory' }, tree: { onToggle() {} }, expanded: false })
  assert.ok(row && row.type === 'button')
  const markdown = native.MarkdownText({ text: '# Title\n\nbody **bold**' })
  assert.ok(markdown && markdown.type === 'div')

  const ppt = native.FileTypeIcon({ path: 'demo-slides.pptx', size: 16 })
  const pdf = native.FileTypeIcon({ path: 'sample.pdf', size: 16 })
  const folder = native.FileTypeIcon({ kind: 'folder', size: 15 })
  assert.equal(ppt.type, 'svg')
  assert.equal(ppt.children[0].props.fill, '#dd6b20')
  assert.equal(pdf.children[0].props.fill, '#d64545')
  assert.equal(folder.children[0].props.stroke, 'currentColor')
})
