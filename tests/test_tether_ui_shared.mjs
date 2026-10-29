import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shared = fs.readFileSync(path.join(root, 'packages/tether-ui/src/app.js'), 'utf8')
const plugin = fs.readFileSync(path.join(root, 'packages/dsh-plugin-tether-client/lib/client.js'), 'utf8')
const connectionPanel = fs.readFileSync(path.join(root, 'packages/tether-ui/src/connection-panel.js'), 'utf8')
const monacoRuntime = fs.readFileSync(path.join(root, 'packages/tether-ui/src/monaco-runtime.js'), 'utf8')

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
  assert.match(shared, /const makeFile = \(base\) => \{/)
  assert.match(shared, /const requestDevice = deviceIdRef\.current/)
  assert.match(shared, /deviceIdRef\.current !== requestDevice/)
  assert.match(shared, /post\('\/api\/devices\/' \+ encodeURIComponent\(requestDevice\) \+ '\/fs\/write', \{ path: target, text: '', overwrite: false \}\)/)
  assert.match(shared, /iconButton\('plus', '新建文件', \(\) => makeFile\(path\), !path \|\| dirLoading \|\| previewBusy\)/)
})

test('DSH plus menu keeps local upload and adds a target-device file action', () => {
  const build = fs.readFileSync(path.resolve(root, 'packages/tether-ui/scripts/build.mjs'), 'utf8')
  const dsh = fs.readFileSync(path.resolve(root, 'packages/tether-ui/src/hosts/dsh.js'), 'utf8')
  assert.match(build, /name: 'tether-target-file'/)
  assert.match(build, /label: \(\) => '目标设备文件'/)
  assert.match(build, /createDshTargetAttachments\(React, Native, targetFiles, targetFilePicker\)/)
  assert.match(dsh, /pickerCommand\.open = open/)
  assert.match(dsh, /h\(Native\.ComposerAttachments/)
})

test('remote editing pins device identity and file version before saving', () => {
  assert.match(shared, /const editableFile = file && file\.editable === true && !file\.truncated/)
  assert.match(shared, /expected_version: requestFile\.version/)
  assert.match(shared, /encoding: requestFile\.encoding/)
  assert.match(shared, /newline: requestFile\.newline/)
  assert.match(shared, /export function responseBelongsToDevice/)
  assert.match(shared, /responseBelongsToDevice\(result, requestDevice\)/)
  assert.match(shared, /目标设备已切换，未保存内容已保留/)
  assert.match(shared, /目标文件已被其他程序修改/)
})

test('code editing uses Monaco models scoped by device and path', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/tether-ui/package.json'), 'utf8'))
  const webMain = fs.readFileSync(path.join(root, 'packages/tether-ui/web/main.js'), 'utf8')
  const pluginBuild = fs.readFileSync(path.join(root, 'packages/tether-ui/scripts/build.mjs'), 'utf8')
  assert.equal(manifest.dependencies['monaco-editor'], '0.57.0')
  assert.match(shared, /createTetherPanel\(\{ React, Native, host, EditorRuntime \}\)/)
  assert.match(shared, /monaco\.editor\.create\(containerRef\.current/)
  assert.match(shared, /const key = deviceId \+ '\\|' \+ path/)
  assert.match(shared, /EditorRuntime\.modelUri\(deviceId, path\)/)
  assert.match(shared, /id: 'tether\.save\.remote'/)
  assert.match(shared, /Monaco Editor 未加载，已禁止回落到伪代码编辑器/)
  assert.match(monacoRuntime, /__TETHER_MONACO_WORKER_SOURCE__/)
  assert.match(monacoRuntime, /function modelUri\(deviceId, path\)/)
  assert.match(webMain, /import \* as EditorRuntime from '\.\.\/src\/monaco-runtime\.js'/)
  assert.match(pluginBuild, /const EditorRuntime = TetherMonacoRuntime/)
})

test('loading spinners rotate the icon itself so the pivot is its own centre', () => {
  // The wrapper used to be a 1em box while glyphs are 14-18px, so the icon
  // overflowed its rotating parent and appeared to orbit off-centre.
  assert.match(shared, /\.tether-spin > svg \{[^}]*transform-origin: 50% 50%;[^}]*animation: tether-refresh-rotate/)
  assert.doesNotMatch(shared, /\.tether-spin \{[^}]*width: 1em/)
  assert.doesNotMatch(shared, /\.tether-spin \{[^}]*animation:/)
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

test('local DSH update reloads the surface once and reports profiles that still need a manual restart', async () => {
  const { activateLocalDshUpdate } = await import('../packages/tether-ui/src/app.js')
  const calls = []
  const active = await activateLocalDshUpdate({
    reloadSurface: async () => { calls.push('reload'); return { application: 'applied' } },
    status: async () => { calls.push('status'); return { runtime_version: '0.2.12', current_version: '0.2.12' } }
  })
  assert.deepEqual(calls, ['reload', 'status'])
  assert.equal(active.status, 'active')

  const staleCalls = []
  const stale = await activateLocalDshUpdate({
    reloadSurface: async () => { staleCalls.push('reload'); return { application: 'applied' } },
    status: async () => { staleCalls.push('status'); return { runtime_version: '0.2.11', current_version: '0.2.12' } }
  })
  assert.deepEqual(staleCalls, ['reload', 'status'])
  assert.equal(stale.status, 'manual_restart_required')

  const noHmrCalls = []
  const noHmr = await activateLocalDshUpdate({
    reloadSurface: async () => { noHmrCalls.push('reload'); return { application: 'restart-required' } }
  })
  assert.deepEqual(noHmrCalls, ['reload'])
  assert.equal(noHmr.status, 'manual_restart_required')

  assert.deepEqual(await activateLocalDshUpdate({ reloadSurface: async () => ({ application: 'failed' }) }), { status: 'reload_failed' })
  for (const status of [{ ok: true }, { ok: true, runtime_version: '', current_version: '0.2.12' },
    { ok: true, runtime_version: '0.2.12' }]) {
    assert.deepEqual(await activateLocalDshUpdate({
      reloadSurface: async () => ({ application: 'applied' }), status: async () => status
    }), { status: 'reload_failed' })
  }
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
  const failCache = new Map()
  const failed = await cachedUpdateCheck(failCache, 'failed', async () => ({ failed: true }), { now: () => now })
  assert.equal(failed.failed, true)
  assert.equal(failCache.has('failed'), false, 'a failed check must be retried instead of cached for five minutes')
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

test('refresh indicators have a sized rotation animation and track their request state', () => {
  assert.match(shared, /\.tether-spin > svg \{[^}]*animation: tether-refresh-rotate \.8s linear infinite[^}]*\}/)
  assert.match(shared, /@keyframes tether-refresh-rotate \{ from \{ transform: rotate\(0deg\); \} to \{ transform: rotate\(360deg\); \} \}/)
  assert.match(shared, /const refreshUpdateCenter = async \(force = false\) => \{[\s\S]*await Promise\.allSettled\(checks\)[\s\S]*setTimeout\(\(\) => setUpdateRefreshing\(false\), 280\)/)
  assert.match(shared, /iconButton\('refresh', '刷新', refreshExplorer, !path, dirLoading \|\| previewBusy\)/)
  assert.match(shared, /onClick: refreshNetwork[\s\S]*networkRefreshing \? h\('span', \{ className: 'tether-spin'/)
  assert.match(shared, /disabled: updateRefreshing[\s\S]*updateRefreshing \? h\('span', \{ className: 'tether-spin'/)
})

test('error toasts expire automatically and the update entry uses a stable label with a status dot', () => {
  assert.match(shared, /setNotice\(''\), 4000/)
  assert.match(shared, /setUpdateToast\(''\), 4000/)
  assert.match(shared, /setProjectsError\(''\), 4000/)
  assert.match(shared, /'更新状态：' \+ updateStatus/)
  assert.match(shared, /background: updateStatusColor/)
  assert.match(shared, /updateStatus === 'available' \? C\.red/)
  assert.match(shared, /updateStatus === 'failed' \? C\.amber/)
  assert.match(shared, /updateStatus === 'current' \? C\.green/)
  assert.doesNotMatch(shared, /\}, updateHasAvailable \? '更新 · 有新版本'/)
  assert.match(shared, /setComponentUpdateError\(component, result\.failed \? shortUpdateError\(result\.error\) : '', scope, false\)/,
    'background update checks stay quiet; only explicit actions toast')
})

test('connection and update triggers share deterministic status colours', async () => {
  const { updateTriggerState, isTransientUpdateError } = await import('../packages/tether-ui/src/app.js')
  assert.equal(updateTriggerState({ devices: { d: { node: { current_version: '0.2.24', latest_version: '0.2.25', update_available: true } } } }, {}), 'available')
  assert.equal(updateTriggerState({ devices: { d: { node: { current_version: '0.2.24', latest_version: '0.2.24', update_available: false } } } }, {}), 'current')
  assert.equal(updateTriggerState({}, { app: 'offline' }), 'failed')
  assert.equal(updateTriggerState({}, {}, true), 'checking')
  assert.equal(updateTriggerState({}, {}, false), 'unknown')
  assert.equal(updateTriggerState(
    { devices: { d: { node: { current_version: '0.2.24', latest_version: '0.2.24', update_available: false } } } },
    { devices: { d: { node: 'offline' } } }
  ), 'current', 'a stale error must not turn a known-current record amber')
  assert.equal(updateTriggerState(
    { devices: { d: { node: { current_version: '0.2.24', latest_version: '0.2.24', update_available: false } } } },
    { devices: { gone: { node: 'offline' } } },
    false,
    [{ device_id: 'd', online: true }, { device_id: 'gone', online: false }]
  ), 'current', 'offline devices do not colour the update trigger')
  assert.equal(updateTriggerState(
    { devices: { d: {} } },
    { devices: { d: { node: 'offline' } } },
    false,
    [{ device_id: 'd', online: true }]
  ), 'failed', 'an online device with no known record and an error stays amber')
  assert.equal(updateTriggerState(
    { devices: { d: { node: { current_version: '0.2.24', latest_version: '0.2.24', update_available: false } } } },
    {},
    true,
    [{ device_id: 'd', online: true }]
  ), 'current', 'refreshing keeps the known-current colour')
  assert.equal(isTransientUpdateError(new Error('InvalidStateError: closing socket')), true)
  assert.equal(isTransientUpdateError(new Error('update_failed')), false)
  assert.match(connectionPanel, /status === 'online'/)
  assert.match(connectionPanel, /status === 'offline'/)
  assert.match(connectionPanel, /status === 'checking'/)
})

test('device and product update cards keep one running state until the run ends', async () => {
  const { updateCardState } = await import('../packages/tether-ui/src/app.js')
  const running = updateCardState({ running: true, error: 'boom', hasUpdate: true, restartRequired: true, failed: true })
  assert.equal(running.kind, 'running')
  assert.equal(running.pill, '正在更新')
  assert.equal(running.action, 'none')
  assert.equal(running.disabled, true)

  const failedRun = updateCardState({ error: '部分组件未更新：app', hasUpdate: true })
  assert.equal(failedRun.kind, 'error')
  assert.equal(failedRun.pill, '更新失败')
  assert.equal(failedRun.action, 'retry')
  assert.equal(failedRun.disabled, false)

  const update = updateCardState({ hasUpdate: true, restartRequired: true, known: true })
  assert.equal(update.kind, 'update', 'an available update outranks a stale restart banner')
  assert.equal(update.pill, '有更新')
  assert.equal(update.action, 'update')
  assert.equal(update.label, '一键更新')

  const restart = updateCardState({ restartRequired: true, restartPill: '待生效' })
  assert.equal(restart.kind, 'restart')
  assert.equal(restart.pill, '待生效')
  assert.equal(restart.action, 'restart')
  assert.equal(restart.label, '立即生效')

  const remoteRestart = updateCardState({ restartRequired: true, restartPill: '插件待重启 DSH', restartAction: 'none' })
  assert.equal(remoteRestart.kind, 'restart')
  assert.equal(remoteRestart.action, 'none')
  assert.equal(remoteRestart.disabled, true)

  const current = updateCardState({ known: true })
  assert.equal(current.kind, 'current')
  assert.equal(current.pill, '已是最新')
  assert.equal(current.disabled, true)

  const checkFailed = updateCardState({ failed: true })
  assert.equal(checkFailed.kind, 'failed')
  assert.equal(checkFailed.pill, '检查失败')
  assert.equal(checkFailed.action, 'recheck')
})

test('a running update and a pending plugin restart keep the update trigger honest', async () => {
  const { updateTriggerState } = await import('../packages/tether-ui/src/app.js')
  const current = { localPlugin: { current_version: '0.2.24', latest_version: '0.2.24', update_available: false } }
  assert.equal(updateTriggerState(current, {}, false, null, true), 'checking',
    'a running device update must not flash intermediate card states')
  assert.equal(updateTriggerState(
    { localPlugin: { current_version: '0.2.24', latest_version: '0.2.24', runtime_version: '0.2.23', update_available: false } },
    {}
  ), 'available', 'a loaded plugin older than the installed profile is not current')
})

test('one refresh normalizes every update card to the same latest snapshot', async () => {
  const { normalizeUpdateLatest, updateNeededFor, isVersionNewer } = await import('../packages/tether-ui/src/app.js')
  const info = {
    app: null,
    localPlugin: { current_version: '0.2.24', latest_version: '0.2.26', update_available: true },
    devices: {
      laptop: {
        app: { current_version: '0.2.25', latest_version: '0.2.25', update_available: false },
        node: { current_version: '0.2.25', latest_version: '0.2.26', update_available: true },
        plugin: { current_version: '0.2.25', latest_version: '0.2.26', update_available: true }
      },
      desktop: {
        app: { current_version: '0.2.26', latest_version: '0.2.26', update_available: false },
        node: { current_version: '0.2.26', latest_version: '0.2.25', update_available: false }
      }
    }
  }
  const normalized = normalizeUpdateLatest(info)
  assert.equal(normalized.devices.laptop.app.latest_version, '0.2.26')
  assert.equal(normalized.devices.laptop.app.update_available, true)
  assert.equal(normalized.devices.desktop.node.latest_version, '0.2.26')
  assert.equal(normalized.devices.desktop.node.update_available, false)
  assert.equal(normalized.localPlugin.latest_version, '0.2.26')
  const mixed = normalizeUpdateLatest({
    localPlugin: { current_version: '0.2.26', latest_version: '0.2.27', update_available: true },
    devices: { d: { app: { current_version: '0.2.26', latest_version: '0.2.26', update_available: false } } }
  })
  assert.equal(mixed.devices.d.app.latest_version, '0.2.27', 'all components share the release version')
  assert.equal(mixed.devices.d.app.update_available, true)
  assert.equal(isVersionNewer('0.2.26', '0.2.25'), true)
  assert.equal(isVersionNewer('0.2.26', '0.2.26'), false)
  assert.equal(updateNeededFor({ current_version: '0.2.26', latest_version: '0.2.26', update_available: false }), false)
  assert.equal(updateNeededFor({ current_version: '0.2.24', latest_version: '0.2.26', update_available: false }), true)
  assert.equal(updateNeededFor({ update_available: true }), true)
})

test('legacy node responses without device_id remain valid', async () => {
  const { responseBelongsToDevice } = await import('../packages/tether-ui/src/app.js')
  assert.equal(responseBelongsToDevice({ device_id: 'A' }, 'A'), true)
  assert.equal(responseBelongsToDevice({ device_id: 'B' }, 'A'), false)
  assert.equal(responseBelongsToDevice({ path: 'x' }, 'A'), true, 'released nodes do not echo device_id')
  assert.equal(responseBelongsToDevice(null, 'A'), false)
  assert.equal(responseBelongsToDevice({}, ''), false)
})
