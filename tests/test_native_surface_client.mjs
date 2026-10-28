import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const clientSource = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('native surface accepts only the ticketed loopback bootstrap and avoids nested Tether registration', () => {
  const start = clientSource.indexOf('    function isSafeNativeSurfaceUrl(value) {')
  const end = clientSource.indexOf('\n\n    function App()', start)
  assert.ok(start >= 0 && end > start, 'native surface URL validator is present')
  const isSafeNativeSurfaceUrl = vm.runInNewContext(clientSource.slice(start, end) + '\n; isSafeNativeSurfaceUrl', { URL })
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:43123/tether-connect?ticket=one'), true)
  assert.equal(isSafeNativeSurfaceUrl('http://[::1]:43123/tether-connect?ticket=one'), true)
  assert.equal(isSafeNativeSurfaceUrl('http://localhost:43123/tether-connect?ticket=one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1.evil.test:43123/tether-connect?ticket=one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://user:pass@127.0.0.1:43123/tether-connect?ticket=one'), false)
  assert.equal(isSafeNativeSurfaceUrl('http://127.0.0.1:43123/tether-connect'), false)
  assert.equal(isSafeNativeSurfaceUrl('https://127.0.0.1:43123/tether-connect?ticket=one'), false)

  let plugin
  const React = { createElement() { return {} }, useState() {}, useEffect() {}, useRef() {}, useCallback() {} }
  const Native = { chatZh: {}, workspaceZh: {}, toolZh: {}, markdownLabels: () => ({}), ComposerAttachments() {} }
  const window = {
    location: { href: 'http://127.0.0.1/?tether_native=1' },
    __ModuleLoader__: { load(module) { plugin = module.factory((id) => id === 'react' ? React : id === 'tether-dsh-native-ui' ? Native : {}) } }
  }
  vm.runInNewContext(clientSource, { window, URL, setTimeout, clearTimeout, console })
  const selections = []
  const registrations = []
  const injectedSlots = []
  const readFileDrag = () => undefined
  const workspaceFiles = { list() {}, readBytes() {} }
  plugin.apply({
    layout: { selectPanel(value) { selections.push(value) } },
    connection: { rpc: { call() {} } },
    remote: { workspaceFiles, pluginManager: {} },
    fileDrag: { read: readFileDrag },
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

  const mainStart = clientSource.indexOf("h('main', { style: { flex: '1 1 auto', display: 'flex'")
  const nativeChild = clientSource.indexOf('h(NativeSurface, { deviceId, online: deviceOnline, visible:', mainStart)
  const viewBranch = clientSource.indexOf("view === 'files' ? renderExplorer() : (view === 'network' ? renderNetwork() : null)", mainStart)
  assert.ok(mainStart >= 0 && nativeChild > mainStart && viewBranch > nativeChild,
    'NativeSurface stays mounted above the file/network branch')
  assert.equal(clientSource.includes('nativeSurfaceEnabled'), false, 'legacy Tether chat toggle is removed')
})
