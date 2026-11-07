import assert from 'node:assert/strict'
import test from 'node:test'
import { createTetherPanel, dshWebGuestSameOrigin, MinimalUpdateButton } from '../packages/tether-ui/src/app.js'
import { createWebNative } from '../packages/tether-ui/src/hosts/web.js'

function createHookRenderer(initialProps) {
  const hooks = []
  let cursor = 0
  let props = initialProps
  let pendingEffects = []
  let output
  let component = null

  const React = {
    createElement(type, elementProps, ...children) { return { type, props: elementProps || {}, children } },
    useState(initial) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { current: initial }
      return hooks[index]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const prior = hooks[index]
      const changed = !prior || !dependencies || dependencies.some((value, i) => !Object.is(value, prior.dependencies?.[i]))
      if (changed) pendingEffects.push({ index, effect, dependencies })
    }
  }

  const render = () => {
    cursor = 0
    output = component(props)
    const effects = pendingEffects
    pendingEffects = []
    for (const item of effects) {
      const prior = hooks[item.index]
      prior?.cleanup?.()
      const cleanup = item.effect()
      hooks[item.index] = { dependencies: item.dependencies, cleanup }
    }
    return output
  }
  return {
    React,
    setComponent(value) { component = value },
    render,
    update(nextProps) { props = nextProps; return render() },
    output: () => output,
    dispose() { for (const hook of hooks) hook?.cleanup?.() }
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const walk = (node, predicate) => {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const match = walk(child, predicate)
    if (match) return match
  }
  return null
}

test('remote update completion keeps this page while local completion reloads it', async () => {
  const previous = {
    window: globalThis.window,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  }
  let timerId = 0
  const timeouts = new Map()
  const intervals = new Map()
  globalThis.window = { location: { reloadCount: 0, reload() { this.reloadCount += 1 } } }
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timeouts.set(id, { callback, delay }); return id }
  globalThis.clearTimeout = (id) => timeouts.delete(id)
  globalThis.setInterval = (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id }
  globalThis.clearInterval = (id) => intervals.delete(id)

  const renderUpdate = async (localDeviceId, switchDeviceBeforeDone = false) => {
    let refreshed = 0
    let summaryChecks = 0
    globalThis.window.location.reloadCount = 0
    const api = async (path, options) => {
      if (path.endsWith('/update/apply')) return { job_id: 'job-047', status: 'running' }
      if (path.endsWith('/update/job')) return { job_id: 'job-047', status: 'done' }
      if (path.includes('/update?')) return { update_available: summaryChecks++ === 0, target_version: '0.4.7' }
      throw new Error('unexpected update request: ' + path + ' ' + JSON.stringify(options))
    }
    const initialProps = {
      React: null,
      h: null,
      api,
      deviceId: 'LAPTOP-01',
      localDeviceId,
      onRemoteDone: async () => { refreshed += 1 },
      host: { kind: 'app', hubConfig: () => ({ url: 'https://hub.example' }) },
      C: { ink: '#111', blue: '#08f', sub: '#666', red: '#d00' }
    }
    const renderer = createHookRenderer(initialProps)
    const props = rendererProps => ({ ...rendererProps, React: renderer.React, h: renderer.React.createElement })
    renderer.setComponent((rendererProps) => MinimalUpdateButton(props(rendererProps)))
    renderer.render()
    await tick()
    renderer.render()
    const updateButton = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '更新到最新版本')
    assert.ok(updateButton)
    await updateButton.props.onClick()
    renderer.render()
    await tick()
    const poll = [...intervals.values()].find((timer) => timer.delay === 1000)
    assert.ok(poll)
    await poll.callback()
    await tick()
    renderer.render()
    const [doneTimerId, doneTimer] = [...timeouts.entries()].find(([, timer]) => timer.delay === 800) || []
    assert.ok(doneTimer)
    timeouts.delete(doneTimerId)
    if (switchDeviceBeforeDone) {
      renderer.update({ ...initialProps, deviceId: 'OTHER-DEVICE', localDeviceId: 'DESKTOP-LOCAL' })
      await tick()
      renderer.render()
    }
    await doneTimer.callback()
    await tick()
    renderer.render()
    const reloadCount = globalThis.window.location.reloadCount
    renderer.dispose()
    return { refreshed, reloadCount, output: renderer.output() }
  }

  try {
    const remote = await renderUpdate('DESKTOP-LOCAL')
    assert.equal(remote.reloadCount, 0)
    assert.equal(remote.refreshed, 1)
    assert.equal(walk(remote.output, (node) => node.props && node.props.role === 'dialog'), null)

    const local = await renderUpdate('LAPTOP-01')
    assert.equal(local.reloadCount, 1)
    assert.equal(local.refreshed, 0)

    const switched = await renderUpdate('DESKTOP-LOCAL', true)
    assert.equal(switched.reloadCount, 0)
    assert.equal(switched.refreshed, 0)
  } finally {
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value
  }
})

test('NativeSurface cancels obsolete device requests, pauses hidden polling, and waits for iframe load', async () => {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
    abortTimeout: AbortSignal.timeout,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  }
  let timerId = 0
  const timers = new Map()
  globalThis.setTimeout = (callback, delay) => {
    const id = ++timerId
    timers.set(id, { callback, delay })
    return id
  }
  globalThis.clearTimeout = (id) => timers.delete(id)
  AbortSignal.timeout = () => new AbortController().signal
  const listeners = new Set()
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(name, listener) { if (name === 'visibilitychange') listeners.add(listener) },
    removeEventListener(name, listener) { if (name === 'visibilitychange') listeners.delete(listener) }
  }
  globalThis.window = { location: { origin: 'https://controller.example', protocol: 'https:' } }

  let calls = 0
  let firstSignal
  let pollSignal
  let holdNextFetch = false
  let surfaceBase = 'https://controller.example'
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1
    if (calls === 1) {
      firstSignal = options.signal
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    if (holdNextFetch) {
      holdNextFetch = false
      pollSignal = options.signal
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    return { ok: true, status: 200, json: async () => ({ available: true, url: 'https://g46285.example.test/tether-connect?ticket=fresh', pid: 7 }) }
  }

  const host = { kind: 'web', apiBase: () => '', surfaceBase: () => surfaceBase, apiHeaders: () => undefined }
  const renderer = createHookRenderer({ deviceId: 'device-a', online: true, visible: true, localDeviceId: '' })
  const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
  renderer.setComponent(surface)
  try {
    renderer.render()
    await tick()
    renderer.update({ deviceId: 'device-b', online: true, visible: true, localDeviceId: '' })
    assert.equal(firstSignal.aborted, true, 'device changes abort the obsolete descriptor request')
    await tick()
    assert.ok(calls >= 2, 'the newly selected device requests its own descriptor')

    renderer.render()
    const iframe = walk(renderer.output(), (node) => node.type === 'iframe')
    assert.ok(iframe, 'the frame mounts after a valid descriptor')
    const beforeLoad = timers.size
    assert.ok(beforeLoad > 0, 'a bounded document load watchdog is active')
    iframe.props.onLoad()
    renderer.render()
    assert.ok(timers.size < beforeLoad, 'document load clears its watchdog')

    const loadedUrl = iframe.props.src
    const loadedCalls = calls
    renderer.update({ deviceId: 'device-b', online: true, visible: false, localDeviceId: '' })
    assert.equal(walk(renderer.output(), (node) => node.type === 'iframe').props.src, loadedUrl, 'hiding for another panel retains the loaded document')
    renderer.update({ deviceId: 'device-b', online: true, visible: true, localDeviceId: '' })
    assert.equal(walk(renderer.output(), (node) => node.type === 'iframe').props.src, loadedUrl, 'returning to the workspace keeps the same iframe URL')
    assert.equal(calls, loadedCalls, 'visibility changes do not fetch another descriptor for a valid same-source frame')

    surfaceBase = 'https://controller-next.example'
    renderer.update({ deviceId: 'device-b', online: true, visible: true, localDeviceId: '' })
    renderer.render()
    await tick()
    await tick()
    renderer.render()
    const refreshedFrame = walk(renderer.output(), (node) => node.type === 'iframe')
    assert.ok(refreshedFrame, 'a source change obtains a new descriptor and mounts the new document')
    const watchdogCount = [...timers.values()].filter((value) => value.delay === 90000).length
    iframe.props.onLoad()
    assert.equal([...timers.values()].filter((value) => value.delay === 90000).length, watchdogCount,
      'a stale iframe onLoad cannot clear the new document watchdog')
    refreshedFrame.props.onLoad()
    renderer.render()

    refreshedFrame.props.onError()
    renderer.render()
    await tick()
    await tick()
    await tick()
    await tick()
    renderer.render()
    const retryFrame = walk(renderer.output(), (node) => node.type === 'iframe')
    assert.ok(retryFrame, 'a real iframe error gets one fresh descriptor ticket retry; calls=' + calls + ' output=' + JSON.stringify(renderer.output()))
    const callsAfterRetry = calls
    retryFrame.props.onError()
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.type === 'iframe'), null, 'a second load failure stops and shows an error state')
    assert.equal(calls, callsAfterRetry, 'failed frames do not trigger an infinite ticket loop')

    const pollTimer = [...timers.entries()].find(([, value]) => value.delay === 8000)
    assert.ok(pollTimer, 'visible surfaces schedule descriptor polling')
    timers.delete(pollTimer[0])
    const callsBeforePoll = calls
    holdNextFetch = true
    pollTimer[1].callback()
    await tick()
    assert.equal(calls, callsBeforePoll + 1, 'only one poll request is in flight')
    globalThis.document.visibilityState = 'hidden'
    for (const listener of listeners) listener()
    assert.equal(pollSignal.aborted, true, 'hiding the view aborts an in-flight poll')
    await tick()
    assert.equal([...timers.values()].some((value) => value.delay === 8000), false, 'hidden surfaces do not keep polling')
    renderer.dispose()

    globalThis.document.visibilityState = 'hidden'
    renderer.update({ deviceId: 'device-c', online: true, visible: true, localDeviceId: '' })
    await tick()
    renderer.render()
    assert.equal([...timers.values()].some((value) => value.delay === 8000), false, 'a surface mounted while hidden waits for visibility')
    const callsAfterHiddenMount = calls
    globalThis.document.visibilityState = 'visible'
    for (const listener of listeners) listener()
    await tick()
    assert.equal(calls, callsAfterHiddenMount + 1, 'returning visible triggers an immediate fresh descriptor poll')
    assert.ok([...timers.values()].some((value) => value.delay === 8000), 'visible polling resumes after a hidden mount')
    renderer.dispose()
    assert.equal(timers.size, 0, 'visibility return timers are cleaned up on unmount')
    assert.equal(timers.size, 0, 'unmount clears load and polling timers')
  } finally {
    for (const key of Object.keys(previous)) {
      if (key === 'abortTimeout') AbortSignal.timeout = previous[key]
      else if (previous[key] === undefined) delete globalThis[key]
      else globalThis[key] = previous[key]
    }
  }
})

test('NativeSurface treats a missing DSH descriptor as startup and retries before failing', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  let timerId = 0
  const timers = new Map()
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  globalThis.clearTimeout = (id) => timers.delete(id)
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.window = { location: { origin: 'https://controller.example', protocol: 'https:' } }
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 404, json: async () => ({ detail: { code: 'descriptor_missing' } }) }
    return { ok: true, status: 200, json: async () => ({ available: true, url: 'http://127.0.0.1:43123/?token=fresh', pid: 9 }) }
  }
  const host = { kind: 'dsh', apiBase: () => '', surfaceBase: () => 'https://controller.example',
    apiHeaders: () => undefined, hubConfig: () => null }
  const renderer = createHookRenderer({ deviceId: 'device-a', online: true, visible: true, localDeviceId: '' })
  const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
  renderer.setComponent(surface)
  try {
    renderer.render()
    await tick()
    assert.equal(walk(renderer.output(), (node) => node.type === 'iframe'), null, 'startup descriptor absence does not mount or fail a frame')
    assert.ok([...timers.values()].some((value) => value.delay === 4000), 'startup waits before retrying')
    const retry = [...timers.entries()].find(([, value]) => value.delay === 4000)
    timers.delete(retry[0]); retry[1].callback()
    renderer.render()
    await tick()
    await tick()
    renderer.render()
    assert.ok(calls > 1, 'the descriptor is fetched again after the startup delay')
    assert.ok(walk(renderer.output(), (node) => node.type === 'iframe'), 'a late descriptor opens the iframe: ' + JSON.stringify(renderer.output()))
  } finally {
    renderer.dispose()
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete globalThis[key]
      else globalThis[key] = previous[key]
    }
  }
})

test('NativeSurface offers running Linux DSH Web after native descriptor failure without changing Windows actions', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.window = { location: { origin: 'https://controller.example', protocol: 'https:' },
    localStorage: { getItem: () => null, setItem() {} } }
  let resolveWebStatus
  const requests = []
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    requests.push(path)
    if (path.endsWith('/dsh/surface')) {
      return { ok: false, status: 400, json: async () => ({ detail: { code: 'node_update_required' } }) }
    }
    if (path.endsWith('/fs/dsh_web_status')) {
      return new Promise((resolve) => { resolveWebStatus = () => resolve({ ok: true, status: 200,
        json: async () => ({ supported: true, running: true, url: 'http://127.0.0.1:43123/?token=qa-web' }) }) })
    }
    if (path.endsWith('/fs/dsh_status')) {
      return { ok: true, status: 200, json: async () => ({ installed: true, running: false, surface: false }) }
    }
    throw new Error('unexpected QA request: ' + path)
  }
  const host = { kind: 'app', apiBase: () => 'https://controller.example', surfaceBase: () => 'https://controller.example',
    apiHeaders: () => undefined, hubConfig: () => null }
  const renderers = []
  const makeRenderer = (os) => {
    const renderer = createHookRenderer({ deviceId: 'device-a', online: true, visible: true, localDeviceId: '',
      deviceInfo: { os, capabilities: { dsh_web_supported: os === 'Linux' } } })
    const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
    renderer.setComponent(surface)
    renderers.push(renderer)
    return renderer
  }
  const findButton = (tree, label) => walk(tree, (node) => node.type === 'button' && node.children[0] === label)
  const flush = async () => { await tick(); await tick(); await tick(); await tick() }
  try {
    const linux = makeRenderer('Linux')
    linux.render()
    await flush()
    linux.render()
    assert.equal(findButton(linux.output(), '打开工作区'), null, 'the open action waits for delayed DSH Web status')
    assert.equal(requests.filter((path) => /dsh_(?:restart|install|install_plugin|web_start)$/.test(path)).length, 0)

    resolveWebStatus()
    await flush()
    linux.render()
    const open = findButton(linux.output(), '打开工作区')
    assert.ok(open, 'a running DSH Web URL remains available when native reports node_update_required')
    open.props.onClick()
    linux.render()
    const webview = walk(linux.output(), (node) => node.type === 'webview')
    assert.ok(webview, 'the existing open action mounts the DSH Web view')
    assert.equal(webview.props.src, 'http://127.0.0.1:43123/?token=qa-web')
    assert.equal(requests.filter((path) => /dsh_(?:restart|install|install_plugin|web_start)$/.test(path)).length, 0,
      'native descriptor failure does not auto-repair or restart either surface')
    linux.dispose()

    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/dsh/surface')) return { ok: false, status: 400,
        json: async () => ({ detail: { code: 'node_update_required' } }) }
      if (path.endsWith('/fs/dsh_web_status')) return { ok: true, status: 200,
        json: async () => ({ supported: false, running: false, url: '' }) }
      if (path.endsWith('/fs/dsh_status')) return { ok: true, status: 200,
        json: async () => ({ installed: true, running: true, surface: false }) }
      throw new Error('unexpected QA request: ' + path)
    }
    const windows = makeRenderer('Windows')
    windows.render()
    await flush()
    windows.render()
    assert.equal(findButton(windows.output(), '打开工作区'), null, 'Windows keeps using its native DSH surface')
    assert.equal(walk(windows.output(), (node) => node.type === 'webview'), null,
      'Windows does not switch to the Linux DSH Web view')
    windows.dispose()
  } finally {
    for (const renderer of renderers) renderer.dispose()
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete globalThis[key]
      else globalThis[key] = previous[key]
    }
  }
})

test('DSH Web guest shows loading, retryable timeout, late recovery, reload, and close safely', async () => {
  const previous = {
    fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout
  }
  const timeouts = new Map()
  let timerId = 0
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 20000) return previous.setTimeout(callback, delay, ...args)
    const id = ++timerId
    timeouts.set(id, callback)
    return id
  }
  globalThis.clearTimeout = (id) => { timeouts.delete(id); return previous.clearTimeout(id) }
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.window = { location: { origin: 'https://controller.example', protocol: 'https:' },
    localStorage: { getItem: (key) => key === 'tether.hub'
      ? JSON.stringify({ url: 'https://hub.example', token: 'guest-test-token' }) : null,
    setItem() {} } }
  const approvedUrl = 'http://127.0.0.1:43123/?token=qa-web'
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    if (path.endsWith('/dsh/surface')) return { ok: false, status: 400,
      json: async () => ({ detail: { code: 'node_update_required' } }) }
    if (path.endsWith('/fs/dsh_web_status')) return { ok: true, status: 200,
      json: async () => ({ supported: true, running: true, url: approvedUrl }) }
    if (path.endsWith('/fs/dsh_status')) return { ok: true, status: 200,
      json: async () => ({ installed: true, running: false, surface: false }) }
    throw new Error('unexpected QA request: ' + path)
  }
  const host = { kind: 'app', apiBase: () => 'https://controller.example', surfaceBase: () => 'https://controller.example',
    apiHeaders: () => undefined, hubConfig: () => null }
  const renderer = createHookRenderer({ deviceId: 'device-a', online: true, visible: true, localDeviceId: '',
    deviceInfo: { os: 'Linux', capabilities: { dsh_web_supported: true } } })
  const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
  renderer.setComponent(surface)
  const walkButtons = (tree) => {
    const items = []
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'button') items.push(node)
      for (const child of node.children || []) visit(child)
    }
    visit(tree)
    return items
  }
  const findButton = (tree, label) => walkButtons(tree).find((node) => node.children[0] === label)
  const flush = async () => { await tick(); await tick(); await tick(); await tick() }
  const guestListeners = new Map()
  const guest = {
    executeJavaScript: async () => {}, getURL: () => approvedUrl,
    addEventListener(name, listener) { guestListeners.set(name, listener) },
    removeEventListener(name, listener) { if (guestListeners.get(name) === listener) guestListeners.delete(name) },
    reload() { this.reloads = (this.reloads || 0) + 1 }
  }
  try {
    renderer.render()
    await flush()
    renderer.render()
    findButton(renderer.output(), '打开工作区').props.onClick()
    renderer.render()
    let webview = walk(renderer.output(), (node) => node.type === 'webview')
    assert.ok(webview)
    webview.props.ref(guest)
    renderer.render()
    const fire = (name, event = {}) => {
      const listener = guestListeners.get(name)
      assert.equal(typeof listener, 'function', 'Electron guest listener attached: ' + name)
      listener(event)
    }
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH Web…') !== null, true)
    fire('did-start-navigation', { isMainFrame: true, url: approvedUrl })
    renderer.render()
    fire('did-fail-load', { isMainFrame: true, errorCode: -3 })
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH Web…'),
      'transient aborts from redirects keep the guest in loading state')

    const timeout = [...timeouts.values()].at(-1)
    assert.equal(typeof timeout, 'function')
    timeout()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'alert'
      && node.children[0] === 'DSH Web 连接超时，请检查服务后重试。'))
    assert.ok(findButton(renderer.output(), '重试'))

    fire('did-finish-load')
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'alert'), null,
      'a late successful finish recovers from the timeout')

    const previousWebviewKey = webview.props.key
    const staleFinish = guestListeners.get('did-finish-load')
    findButton(renderer.output(), '重新加载').props.onClick()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH Web…'))
    webview = walk(renderer.output(), (node) => node.type === 'webview')
    assert.notEqual(webview.props.key, previousWebviewKey, 'reload creates a fresh Electron guest for a new attempt')
    webview.props.ref(guest)
    renderer.render()
    assert.equal(typeof staleFinish, 'function')
    staleFinish()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH Web…'),
      'an old guest finish cannot complete a newer reload attempt')
    findButton(renderer.output(), '关闭').props.onClick()
    renderer.render()
    webview.props.ref(null)
    staleFinish()
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.type === 'webview'), null)
  } finally {
    renderer.dispose()
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value
  }
})

test('Hub credentials are seeded only into the guest exact approved origin', () => {
  const approved = 'http://192.168.1.20:3080/?token=web-token'
  assert.equal(dshWebGuestSameOrigin(approved, 'http://192.168.1.20:3080/workspaces'), true)
  assert.equal(dshWebGuestSameOrigin(approved, 'http://192.168.1.21:3080/'), false)
  assert.equal(dshWebGuestSameOrigin(approved, 'https://192.168.1.20:3080/'), false)
  assert.equal(dshWebGuestSameOrigin(approved, 'about:blank'), false)
})
