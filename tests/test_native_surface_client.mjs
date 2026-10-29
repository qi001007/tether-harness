import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const clientSource = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const webHostSource = fs.readFileSync(new URL('../packages/tether-ui/src/hosts/web.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('native surface accepts only ticketed loopback, public ticket and same-host token URLs', () => {
  const start = clientSource.indexOf('    function isSafeNativeSurfaceUrl(value) {')
  const end = clientSource.indexOf('\n\n    function App()', start)
  assert.ok(start >= 0 && end > start, 'native surface URL validator is present')
  const isSafeNativeSurfaceUrl = vm.runInNewContext(clientSource.slice(start, end) + '\n; isSafeNativeSurfaceUrl', { URL })
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:43123/tether-connect?ticket=one'), true)
  assert.equal(isSafeNativeSurfaceUrl('http://[::1]:43123/tether-connect?ticket=one'), true)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:57168/?token=local-one'), true)
  assert.equal(isSafeNativeSurfaceUrl('http://[::1]:57168/?token=local-one'), true)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:57168/'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:57168/other?token=local-one'), false)
  assert.equal(isSafeNativeSurfaceUrl('https://g46285.8-220-198-26.sslip.io/?token=local-one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://localhost:43123/tether-connect?ticket=one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1.evil.test:43123/tether-connect?ticket=one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://user:pass@127.0.0.1:43123/tether-connect?ticket=one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://user:pass@127.0.0.1:43123/?token=local-one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:43123/tether-connect'), false)
  assert.equal(isSafeNativeSurfaceUrl('https://127.0.0.1:43123/tether-connect?ticket=one'), false)
  assert.ok(clientSource.includes("const sameHostToken = parsed.pathname === '/' && !!parsed.searchParams.get('token')"),
    'same-host token URLs bypass the hub-loopback guard')
  assert.ok(clientSource.includes('surfaceBase: () => DSH_APP_BASE'),
    'the DSH host asks the local APP server for the local surface first')
  assert.ok(clientSource.includes('host.surfaceBase(isLocalTarget)'),
    'the surface descriptor asks the host for its fast path')
  assert.ok(clientSource.includes("host.kind === 'dsh' && !isLocalTarget ? '?via=hub' : ''"),
    'only remote surfaces go through the hub; the local device stays on the local route')
  assert.ok(clientSource.includes('localDeviceId: appLocalDevice'),
    'the panel passes the local device into the surface')
  assert.ok(webHostSource.includes('surfaceBase: () => apiBase'),
    'the APP/web host keeps the same-origin surface base')

  let plugin
  const React = { createElement() { return {} }, useState() {}, useEffect() {}, useRef() {}, useCallback() {} }
  const Native = { chatZh: {}, workspaceZh: {}, toolZh: {}, markdownLabels: () => ({}), ComposerAttachments() {} }
  const window = {
    location: { href: 'http://127.0.0.1/?tether_native=1' },
    __ModuleLoader__: { load(module) { plugin = module.factory((id) => id === 'react' ? React : id === 'tether-dsh-native-ui' ? Native : {}) } }
  }
  const monacoStart = clientSource.indexOf('var TetherMonacoRuntime=')
  const monacoEnd = clientSource.indexOf('    const EditorRuntime = TetherMonacoRuntime', monacoStart)
  assert.ok(monacoStart > 0 && monacoEnd > monacoStart, 'generated bundle contains the Monaco runtime boundary')
  const executableClientSource = clientSource.slice(0, monacoStart)
    + 'var TetherMonacoRuntime = { monaco: {} };\n'
    + clientSource.slice(monacoEnd)
  vm.runInNewContext(executableClientSource, { window, URL, setTimeout, clearTimeout, console })
  const selections = []
  const registrations = []
  const commands = []
  const injectedSlots = []
  const readFileDrag = () => undefined
  const workspaceFiles = { list() {}, readBytes() {} }
  plugin.apply({
    layout: { selectPanel(value) { selections.push(value) } },
    connection: { rpc: { call() {} } },
    remote: { workspaceFiles, pluginManager: {} },
    fileDrag: { read: readFileDrag },
    inject(services, apply) {
      assert.equal(Array.from(services).join(','), 'commandUi')
      apply({
        get() { return { register(command) { commands.push(command); return () => {} } } },
        effect(register) { return register() }
      })
    },
    slots: {
      inject(name, register) { injectedSlots.push(name); register() },
      register(options, component) { registrations.push({ options, component }) }
    }
  })
  assert.deepEqual(selections, [null])
  assert.deepEqual(injectedSlots, ['conversation.input.attachments'], 'native iframe may inject only its attachment slot')
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'conversation.input.attachments')
  assert.equal(registrations[0].options.priority, -1000)
  assert.equal(registrations[0].options.locale, 'conversation')
  assert.equal(registrations[0].options.inject().readFileDrag, readFileDrag)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'tether-target-file')
  assert.equal(commands[0].label(), '目标设备文件')
})

test('native surface state is device-bound and its iframe remains mounted while hidden views change', () => {
  const stateStart = clientSource.indexOf('    function nativeSurfaceStateForDevice(state, deviceId, online) {')
  const nativeStart = clientSource.indexOf('\n\n    function NativeSurface(', stateStart)
  assert.ok(stateStart >= 0 && nativeStart > stateStart, 'device-bound surface state helpers are present')
  const helpers = vm.runInNewContext(clientSource.slice(stateStart, nativeStart) + '\n;({ nativeSurfaceStateForDevice, nativeSurfaceContainerStyle })')

  const oldReady = { deviceId: 'device-a', status: 'ready', url: 'http://127.0.0.1:40001/tether-connect?ticket=a' }
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.nativeSurfaceStateForDevice(oldReady, 'device-b', true))), {
    deviceId: 'device-b', status: 'loading', url: ''
  })
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.nativeSurfaceStateForDevice(oldReady, 'device-b', false))), {
    deviceId: 'device-b', status: 'offline', url: ''
  })
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.nativeSurfaceStateForDevice(oldReady, 'device-a', false))), {
    deviceId: 'device-a', status: 'offline', url: ''
  })
  assert.equal(helpers.nativeSurfaceStateForDevice({ deviceId: 'device-b', status: 'ready', url: 'http://127.0.0.1:40002/tether-connect?ticket=b' }, 'device-b', true).status, 'ready')
  assert.equal(helpers.nativeSurfaceContainerStyle(false).display, 'none')
  assert.equal(helpers.nativeSurfaceContainerStyle(true).display, 'flex')

  const mainStart = clientSource.indexOf("h('main', { className: 'tether-workbench', style: { flex: '1 1 auto', display: 'flex'")
  const nativeChild = clientSource.indexOf('h(NativeSurface, { deviceId, online: deviceOnline, visible:', mainStart)
  const viewBranch = clientSource.indexOf("view === 'files' ? renderExplorer() : (view === 'network' ? renderNetwork() : null)", mainStart)
  assert.ok(mainStart >= 0 && nativeChild > mainStart && viewBranch > nativeChild,
    'NativeSurface stays mounted above the file/network branch')
  assert.equal(clientSource.includes('nativeSurfaceEnabled'), false, 'legacy Tether chat toggle is removed')
})


test('the native frame reloads when the DSH host pid changes', () => {
  assert.match(clientSource, /key: deviceId \+ ':' \+ \(currentState\.pid \|\| 0\)/)
  assert.match(clientSource, /pid && \(prev\.pid \|\| 0\) !== pid/)
  assert.match(clientSource, /pid: Number\(data\.pid\) \|\| 0/)
})


test('the DSH plugin embeds the local workspace with the current same-origin session', () => {
  const start = clientSource.indexOf('    function isSafeNativeSurfaceUrl(value) {')
  const end = clientSource.indexOf('\n\n    function App()', start)
  assert.ok(start >= 0 && end > start)
  const isSafe = vm.runInNewContext(clientSource.slice(start, end) + '\n; isSafeNativeSurfaceUrl',
    { URL, window: { location: { origin: 'http://127.0.0.1:43123' } } })
  assert.equal(isSafe('http://127.0.0.1:43123/'), true)
  assert.equal(isSafe('http://127.0.0.1:43124/'), false)
  assert.ok(clientSource.includes("host.kind === 'dsh' && localDeviceId && id === localDeviceId"))
})

test('the local device id participates in the surface effect dependencies', () => {
  assert.ok(clientSource.includes('}, [deviceId, online, attempt, localDeviceId])'))
  assert.ok(clientSource.includes('}, [deviceId, online, localDeviceId])'))
})

test('an embedded DSH page never registers the Tether plugin', () => {
  assert.ok(clientSource.includes('window.top !== window.self'))
  assert.ok(clientSource.includes("embedded || new URL(window.location.href).searchParams.has('tether_native')"))
  assert.ok(clientSource.includes("const nativeSurfaceStyleId = 'tether-native-surface-chrome'"))
  assert.ok(clientSource.includes(':has([aria-label="全局面板"])'))
  assert.ok(clientSource.includes('border-right-color: transparent !important'))
})
