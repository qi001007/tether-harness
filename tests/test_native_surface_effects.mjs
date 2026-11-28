import assert from 'node:assert/strict'
import { clearTimeout, setTimeout } from 'node:timers'
import test from 'node:test'
import { createTetherPanel, dshWebGuestSameOrigin, MinimalUpdateButton, markUpdateJobStarted } from '../packages/tether-ui/src/app.js'
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
    },
    useLayoutEffect(effect, dependencies) {
      const index = cursor++
      const prior = hooks[index]
      const changed = !prior || !dependencies || dependencies.some((value, i) => !Object.is(value, prior.dependencies?.[i]))
      if (changed) pendingEffects.push({ index, effect, dependencies })
    },
    useMemo(factory, dependencies) {
      const index = cursor++
      const prior = hooks[index]
      const changed = !prior || !dependencies || dependencies.some((value, i) => !Object.is(value, prior.dependencies?.[i]))
      if (changed) hooks[index] = { value: factory(), dependencies }
      return hooks[index].value
    },
    useCallback(callback, dependencies) {
      const index = cursor++
      const prior = hooks[index]
      const changed = !prior || !dependencies || dependencies.some((value, i) => !Object.is(value, prior.dependencies?.[i]))
      if (changed) hooks[index] = { value: callback, dependencies }
      return hooks[index].value
    },
    useId() {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value: ':test-' + index + ':' }
      return hooks[index].value
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

test('a remote-started job stays silent on the target machine page', async () => {
  const previous = { window: globalThis.window, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  globalThis.window = { location: { reload() {} } }
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  const api = async (path) => {
    if (path.endsWith('/update/job')) {
      return { job_id: 'remote-job', status: 'downloading', progress: { percent: 0, step: '下载更新' } }
    }
    if (path.includes('/update?')) return { update_available: true, target_version: '0.5.15' }
    throw new Error('unexpected update request: ' + path)
  }
  const props = {
    React: null,
    h: null,
    api,
    deviceId: 'LAPTOP-01',
    localDeviceId: 'LAPTOP-01',
    host: { kind: 'app', hubConfig: () => ({ url: 'https://hub.example' }) },
    C: { ink: '#111', blue: '#08f', sub: '#666', red: '#d00' }
  }
  const renderer = createHookRenderer(props)
  const withReact = (rendererProps) => ({ ...rendererProps, React: renderer.React, h: renderer.React.createElement })
  renderer.setComponent((rendererProps) => MinimalUpdateButton(withReact(rendererProps)))
  try {
    renderer.render()
    await tick()
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态'), null,
      'a job this page did not start never renders a progress control')
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'dialog'), null,
      'no full-screen dialog takes over the target machine')
    markUpdateJobStarted('https://hub.example', 'LAPTOP-01', 'remote-job')
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态'),
      'the initiator keeps progress for the job it started')
  } finally {
    renderer.dispose()
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value
  }
})

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

test('remote update can move to background, restore details, and close errors without duplicating jobs', async () => {
  const previous = {
    window: globalThis.window,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  }
  let timerId = 0
  const intervals = new Map()
  let applyCalls = 0
  let retryCalls = 0
  let applied = false
  let jobStatus = 'running'
  globalThis.window = { location: { reload() {} } }
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; return id }
  globalThis.clearTimeout = () => {}
  globalThis.setInterval = (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id }
  globalThis.clearInterval = (id) => intervals.delete(id)

  const api = async (path, options) => {
    if (path.endsWith('/update/apply')) {
      applyCalls += 1
      applied = true
      return { job_id: 'job-048', status: 'running' }
    }
    if (path.endsWith('/update/retry')) {
      retryCalls += 1
      jobStatus = 'running'
      return { job_id: 'job-048', status: 'running' }
    }
    if (path.endsWith('/update/job')) {
      return applied
        ? { job_id: 'job-048', status: jobStatus, progress: { percent: 42, step: '下载更新' } }
        : { job_id: '', status: 'done' }
    }
    if (path.includes('/update?')) return { update_available: true, target_version: '0.4.9' }
    throw new Error('unexpected update request: ' + path + ' ' + JSON.stringify(options))
  }
  const initialProps = {
    React: null,
    h: null,
    api,
    post: async () => { throw new Error('unexpected POST') },
    deviceId: 'LAPTOP-01',
    localDeviceId: 'DESKTOP-LOCAL',
    host: { kind: 'app', hubConfig: () => ({ url: 'https://hub.example' }) },
    C: { ink: '#111', blue: '#08f', sub: '#666', red: '#d00' }
  }
  const renderer = createHookRenderer(initialProps)
  const props = rendererProps => ({ ...rendererProps, React: renderer.React, h: renderer.React.createElement })
  renderer.setComponent((rendererProps) => MinimalUpdateButton(props(rendererProps)))

  try {
    renderer.render()
    await tick()
    renderer.render()
    const updateButton = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '更新到最新版本')
    await updateButton.props.onClick()
    renderer.render()
    const openDetails = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态')
    assert.ok(openDetails, 'a started job stays reachable from the topbar')
    await openDetails.props.onClick()
    renderer.render()

    const backgroundButton = walk(renderer.output(), (node) => node.type === 'button' && node.children.includes('后台更新'))
    assert.ok(backgroundButton)
    await backgroundButton.props.onClick()
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'dialog'), null)
    const poll = [...intervals.values()].find((timer) => timer.delay === 1000)
    assert.ok(poll, 'backgrounding keeps the existing job poll active')
    await poll.callback()
    await tick()
    renderer.render()
    const restore = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态')
    assert.ok(restore)
    await restore.props.onClick()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'dialog'))
    assert.equal(applyCalls, 1, 'restoring details does not start another update job')
    const updateArrow = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态')
    await updateArrow.props.onClick()
    assert.equal(applyCalls, 1, 'the update arrow restores an active job instead of posting apply again')

    jobStatus = 'error'
    await poll.callback()
    await tick()
    renderer.render()
    const close = walk(renderer.output(), (node) => node.type === 'button' && node.children.includes('关闭'))
    assert.ok(close)
    await close.props.onClick()
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'dialog'), null)
    assert.ok(walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态'))

    const restoreError = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态')
    await restoreError.props.onClick()
    renderer.render()
    const retry = walk(renderer.output(), (node) => node.type === 'button' && node.children.includes('重试'))
    assert.ok(retry, 'closing the error details preserves the existing retry action')
    await retry.props.onClick()
    assert.equal(retryCalls, 1, 'retry reuses the failed job')
    assert.equal(applyCalls, 1, 'retry never starts a duplicate update job')
  } finally {
    renderer.dispose()
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value
  }
})

test('late update start response from an old device scope is ignored', async () => {
  const previous = { window: globalThis.window, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  let timerId = 0
  globalThis.window = { location: { reload() {} } }
  globalThis.setInterval = () => ++timerId
  globalThis.clearInterval = () => {}
  let resolveStart
  let applied = false
  const api = async (path, options) => {
    if (path.endsWith('/update/apply')) {
      applied = true
      return new Promise((resolve) => { resolveStart = resolve })
    }
    if (path.endsWith('/update/job')) {
      return applied && path.includes('/LAPTOP-01/')
        ? { job_id: 'new-device-job', status: 'running' } : { job_id: '', status: 'done' }
    }
    if (path.includes('/update?')) return { update_available: true, target_version: '0.4.9' }
    throw new Error('unexpected update request: ' + path + ' ' + JSON.stringify(options))
  }
  const initialProps = {
    React: null,
    h: null,
    api,
    deviceId: 'LAPTOP-01',
    localDeviceId: 'DESKTOP-LOCAL',
    host: { kind: 'app', hubConfig: () => ({ url: 'https://hub.example' }) },
    C: { ink: '#111', blue: '#08f', sub: '#666', red: '#d00' }
  }
  const renderer = createHookRenderer(initialProps)
  const props = rendererProps => ({ ...rendererProps, React: renderer.React, h: renderer.React.createElement })
  renderer.setComponent((rendererProps) => MinimalUpdateButton(props(rendererProps)))

  try {
    renderer.render()
    await tick()
    renderer.render()
    const updateButton = walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '更新到最新版本')
    const pendingStart = updateButton.props.onClick()
    await tick()
    renderer.update({ ...initialProps, deviceId: 'OTHER-DEVICE' })
    await tick()
    renderer.render()
    resolveStart({ job_id: 'old-device-job', status: 'running' })
    await pendingStart
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'dialog'), null)
    assert.equal(walk(renderer.output(), (node) => node.type === 'button' && node.props['aria-label'] === '查看更新状态'), null)
  } finally {
    renderer.dispose()
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

test('Electron OAuth NativeSurface fetches remote descriptors through hubRequest and preserves status/body', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  const timers = new Map()
  let timerId = 0
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  globalThis.clearTimeout = (id) => timers.delete(id)
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.window = { location: { origin: 'https://controller.example', protocol: 'https:' },
    localStorage: { getItem: () => null, setItem() {} } }
  const fetchPaths = []
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    fetchPaths.push(path)
    if (path.endsWith('/dsh/surface')) throw new Error('OAuth descriptor must not use renderer fetch')
    return { ok: false, status: 404, json: async () => ({}) }
  }
  const requests = []
  const host = { kind: 'app', apiBase: () => 'https://controller.example', surfaceBase: () => 'https://controller.example',
    hubRequest: async (request) => {
      requests.push(request)
      return { status: 404, body: { detail: { code: 'descriptor_missing' } } }
    } }
  const renderer = createHookRenderer({ deviceId: 'device-a', online: true, visible: true, localDeviceId: '' })
  const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
  renderer.setComponent(surface)
  try {
    renderer.render()
    await tick(); await tick(); await tick()
    assert.deepEqual(requests[0], { method: 'GET', path: '/api/devices/device-a/dsh/surface' })
    assert.equal(fetchPaths.some((path) => path.endsWith('/dsh/surface')), false)
    assert.ok([...timers.values()].some((timer) => timer.delay === 4000),
      'the existing descriptor_missing state uses the preserved 404 status and body')
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
  // DSH Web 状态现在来自主进程 workbench 服务目录（不再是 /fs/dsh_web_status）。
  const approvedUrl = 'http://127.0.0.1:43123/?token=qa-web'
  let catalogState = 'stopped'
  let deferCatalog = true
  const pendingCatalogs = []
  const releaseCatalog = () => { for (const resolve of pendingCatalogs.splice(0)) resolve() }
  const workbenchOpens = []
  const workbench = {
    catalog: () => {
      const value = { services: [{ id: 'dsh', state: catalogState,
        reason: catalogState === 'stopped' ? 'service_stopped' : '' }] }
      if (!deferCatalog) return Promise.resolve(value)
      return new Promise((resolve) => { pendingCatalogs.push(() => resolve(value)) })
    },
    open: async (targetId, serviceId) => {
      workbenchOpens.push([targetId, serviceId])
      return { targetId, serviceId, endpoint: approvedUrl, partition: 'persist:tether-dsh-qa', grantId: 'grant-qa' }
    },
    close: async (targetId, serviceId) => ({ targetId, serviceId, state: 'closed' }),
    view: async () => {}
  }
  const requests = []
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    requests.push(path)
    if (path.endsWith('/dsh/surface')) {
      return { ok: false, status: 400, json: async () => ({ detail: { code: 'node_update_required' } }) }
    }
    if (path.endsWith('/fs/dsh_status')) {
      return { ok: true, status: 200, json: async () => ({ installed: true, running: false, surface: false }) }
    }
    throw new Error('unexpected QA request: ' + path)
  }
  const host = { kind: 'app', apiBase: () => 'https://controller.example', surfaceBase: () => 'https://controller.example',
    apiHeaders: () => undefined, hubConfig: () => null, workbench }
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
  const flush = async () => { for (let index = 0; index < 12; index += 1) await tick() }
  try {
    const linux = makeRenderer('Linux')
    linux.render()
    await flush()
    linux.render()
    assert.equal(findButton(linux.output(), '启动 DSH'), null, 'the unified DSH start waits for the delayed service catalog')
    assert.equal(requests.filter((path) => /dsh_(?:restart|install|install_plugin|web_start)$/.test(path)).length, 0)

    releaseCatalog()
    await flush()
    linux.render()
    await flush()
    linux.render()
    const open = findButton(linux.output(), '启动 DSH')
    assert.ok(open, 'a stopped DSH service is offered through the unified 启动 DSH button')
    await open.props.onClick()
    await flush()
    linux.render()
    const webview = walk(linux.output(), (node) => node.type === 'webview')
    assert.ok(webview, 'the unified DSH action mounts the workbench-granted view')
    assert.equal(webview.props.src, approvedUrl)
    assert.deepEqual(workbenchOpens, [['device-a', 'dsh']], 'the view comes from a single workbench grant')
    assert.equal(requests.filter((path) => /dsh_(?:restart|install|install_plugin|web_start)$/.test(path)).length, 0,
      'native descriptor failure does not auto-repair or restart either surface')
    linux.dispose()

    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/dsh/surface')) return { ok: false, status: 400,
        json: async () => ({ detail: { code: 'node_update_required' } }) }
      if (path.endsWith('/fs/dsh_status')) return { ok: true, status: 200,
        json: async () => ({ installed: true, running: true, surface: false }) }
      throw new Error('unexpected QA request: ' + path)
    }
    deferCatalog = false
    catalogState = 'missing'
    const windows = makeRenderer('Windows')
    windows.render()
    await flush()
    windows.render()
    assert.equal(findButton(windows.output(), '启动 DSH Web'), null, 'Windows never offers a split DSH Web label')
    assert.equal(findButton(windows.output(), '打开工作区'), null, 'Windows never advertises a split DSH Web workspace')
    assert.equal(walk(windows.output(), (node) => node.type === 'webview'), null,
      'Windows does not switch to the Linux DSH Web view')
    assert.equal(workbenchOpens.length, 1, 'Windows never requests a workbench grant')
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
    if (path.endsWith('/fs/dsh_status')) return { ok: true, status: 200,
      json: async () => ({ installed: true, running: false, surface: false }) }
    throw new Error('unexpected QA request: ' + path)
  }
  // DSH Web 由主进程 workbench 服务目录/授权驱动（旧的 /fs/dsh_web_status 已移除）。
  const workbench = {
    catalog: async () => ({ services: [{ id: 'dsh', state: 'stopped', reason: 'service_stopped' }] }),
    open: async (targetId, serviceId) => ({ targetId, serviceId, endpoint: approvedUrl,
      partition: 'persist:tether-dsh-qa', grantId: 'grant-qa' }),
    close: async (targetId, serviceId) => ({ targetId, serviceId, state: 'closed' }),
    view: async () => {}
  }
  const host = { kind: 'app', apiBase: () => 'https://controller.example', surfaceBase: () => 'https://controller.example',
    apiHeaders: () => undefined, hubConfig: () => null, workbench }
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
  const flush = async () => { for (let index = 0; index < 12; index += 1) await tick() }
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
    await flush()
    renderer.render()
    const startWeb = findButton(renderer.output(), '启动 DSH')
    assert.ok(startWeb, 'the Linux fallback offers the unified 启动 DSH button')
    await startWeb.props.onClick()
    await flush()
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
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH…') !== null, true)
    fire('did-start-navigation', { isMainFrame: true, url: approvedUrl })
    renderer.render()
    fire('did-fail-load', { isMainFrame: true, errorCode: -3 })
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH…'),
      'transient aborts from redirects keep the guest in loading state')

    const timeout = [...timeouts.values()].at(-1)
    assert.equal(typeof timeout, 'function')
    timeout()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'alert'
      && /DSH 连接超时/.test(JSON.stringify(node.children))))
    assert.ok(findButton(renderer.output(), '重试'))

    fire('did-finish-load')
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.props && node.props.role === 'alert'), null,
      'a late successful finish recovers from the timeout')

    const previousWebviewKey = webview.props.key
    const staleFinish = guestListeners.get('did-finish-load')
    findButton(renderer.output(), '重新加载').props.onClick()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH…'))
    webview = walk(renderer.output(), (node) => node.type === 'webview')
    assert.notEqual(webview.props.key, previousWebviewKey, 'reload creates a fresh Electron guest for a new attempt')
    webview.props.ref(guest)
    renderer.render()
    assert.equal(typeof staleFinish, 'function')
    staleFinish()
    renderer.render()
    assert.ok(walk(renderer.output(), (node) => node.props && node.props.role === 'status' && node.children[0] === '正在连接 DSH…'),
      'an old guest finish cannot complete a newer reload attempt')
    await findButton(renderer.output(), '关闭').props.onClick()
    await flush()
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

test('invalid state snapshots keep the last device context while valid empty and recovered snapshots still apply', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  }
  let timerId = 0
  const intervals = new Map()
  const validDevice = { device_id: 'keep-device', name: 'Keep Context', online: true, capabilities: {} }
  const stateResponses = [
    { devices: [validDevice], edges: [], sessions: [], runs: [] },
    {},
    { detail: { code: 'device_offline' } },
    { status: 409, body: { detail: { code: 'device_offline', error: 'device offline' } } },
    { devices: [], edges: [], sessions: [], runs: [] },
    { devices: [validDevice], edges: [], sessions: [], runs: [] }
  ]
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { origin: 'https://hub.example', protocol: 'https:', href: 'https://hub.example/' },
    localStorage: { getItem: (key) => key === 'tether.hub' ? JSON.stringify({ url: 'https://hub.example', token: 'test-token' }) : null, setItem() {}, removeItem() {} },
    addEventListener() {},
    removeEventListener() {}
  }
  globalThis.document = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {}
  }
  globalThis.setTimeout = (callback, delay) => ++timerId
  globalThis.clearTimeout = () => {}
  globalThis.setInterval = (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id }
  globalThis.clearInterval = (id) => intervals.delete(id)
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    if (path === '/api/state') {
      const response = stateResponses.shift()
      if (response && response.status) return { ok: false, status: response.status, json: async () => response.body }
      return { ok: true, status: 200, json: async () => response }
    }
    if (path === '/api/events' || path === '/app-context') return { ok: false, status: 503, json: async () => ({}) }
    if (path.endsWith('/workspaces')) return { ok: true, status: 200, json: async () => ({ root: '', workspaces: [] }) }
    if (path.endsWith('/drives')) return { ok: true, status: 200, json: async () => ({ drives: [] }) }
    if (path.endsWith('/dsh/sessions')) return { ok: true, status: 200, json: async () => ({ sessions: [] }) }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const renderer = createHookRenderer({})
  const panel = createTetherPanel({
    React: renderer.React,
    Native: createWebNative(renderer.React),
    host: {
      kind: 'web',
      apiBase: () => 'https://hub.example',
      apiBases: () => ['https://hub.example'],
      apiHeaders: () => ({}),
      hubConfig: () => ({ url: 'https://hub.example' }),
      surfaceBase: () => ''
    }
  })
  renderer.setComponent(() => panel.App())
  const selectedDevice = () => walk(renderer.output(), (node) => typeof node.type === 'function' && node.type.name === 'DeviceSwitcher')?.props.value
  const runStatePoll = async () => {
    const poll = [...intervals.values()].find((timer) => timer.delay === 2500)
    assert.ok(poll, 'the normal app state poll is mounted')
    await poll.callback()
    await tick()
    renderer.render()
  }

  try {
    renderer.render()
    await tick()
    renderer.render()
    assert.equal(selectedDevice(), 'keep-device', 'the first complete snapshot selects its online device')

    await runStatePoll()
    assert.equal(selectedDevice(), 'keep-device', 'an empty 2xx object cannot replace the last valid snapshot')
    assert.match(JSON.stringify(renderer.output()), /设备状态响应格式无效/)

    await runStatePoll()
    assert.equal(selectedDevice(), 'keep-device', 'a 2xx error-shaped object cannot replace the last valid snapshot')

    await runStatePoll()
    assert.equal(selectedDevice(), 'keep-device', 'an HTTP 409 leaves the current device context intact')

    await runStatePoll()
    assert.equal(selectedDevice(), undefined, 'a valid empty devices array follows the existing no-device path')
    assert.match(JSON.stringify(renderer.output()), /no device|暂无设备/)

    await runStatePoll()
    assert.equal(selectedDevice(), 'keep-device', 'a later valid snapshot restores the device context')
  } finally {
    renderer.dispose()
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value
  }
})

const DSH_MESH_PARTITION = 'persist:tether-wb-' + 'a1b2c3d4e5'.repeat(4)
const DSH_MESH_GRANT = 'ab'.repeat(20)

function createMeshSurfaceFixture(options) {
  const timers = new Map()
  let timerId = 0
  const calls = { meshOpen: 0, hubSurface: 0, hubRequest: 0, view: 0, close: [] }
  const logs = []
  const originalInfo = console.info
  console.info = (...args) => { logs.push(args) }
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  globalThis.clearTimeout = (id) => timers.delete(id)
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.window = { location: { origin: 'file://', protocol: 'file:' } , localStorage: { getItem: () => null, setItem() {} } }
  globalThis.fetch = async (url) => { throw new Error('mesh path must not use renderer fetch: ' + String(url)) }
  const host = {
    kind: 'app',
    apiBase: () => 'https://controller.example',
    surfaceBase: () => 'https://controller.example',
    apiHeaders: () => undefined,
    hubConfig: () => null,
    hubRequest: async () => { calls.hubRequest += 1; return { status: 500, body: {} } },
    workbench: {
      catalog: async () => ({ protocol: 1, target_id: 'target-a', services: [{ id: 'dsh', state: options.catalogState || 'ready' }] }),
      open: async () => {
        calls.meshOpen += 1
        if (options.meshError) throw options.meshError
        return { targetId: 'target-a', serviceId: 'dsh', grantId: DSH_MESH_GRANT,
          endpoint: 'https://target-a.mesh.example:44300/', partition: DSH_MESH_PARTITION }
      },
      openDshSurface: async () => {
        calls.hubSurface += 1
        return { targetId: 'target-a', serviceId: 'dsh-native', grantId: 'cd'.repeat(20),
          endpoint: 'https://g46285.controller.example/?tether_native=1', partition: DSH_MESH_PARTITION }
      },
      close: async (_targetId, _serviceId, grantId) => { calls.close.push(grantId) },
      view: async () => { calls.view += 1 }
    }
  }
  const renderer = createHookRenderer({ deviceId: 'target-a', online: true, visible: true, localDeviceId: 'local-a' })
  const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
  renderer.setComponent(surface)
  return {
    renderer,
    calls,
    logs,
    timers,
    dispose() {
      renderer.dispose()
      console.info = originalInfo
      delete globalThis.setTimeout
      delete globalThis.clearTimeout
      delete globalThis.document
      delete globalThis.window
      delete globalThis.fetch
    }
  }
}

test('NativeSurface opens a remote DSH workspace over mesh before any Hub gateway request', async () => {
  const fixture = createMeshSurfaceFixture({})
  try {
    fixture.renderer.render()
    await tick(); await tick(); await tick()
    fixture.renderer.render()
    const webview = walk(fixture.renderer.output(), (node) => node.type === 'webview')
    assert.ok(webview, 'the mesh session mounts the isolated webview: ' + JSON.stringify(fixture.renderer.output()))
    assert.equal(webview.props.src, 'https://target-a.mesh.example:44300/')
    assert.equal(webview.props.partition, DSH_MESH_PARTITION)
    assert.equal(fixture.calls.meshOpen, 1, 'the mesh workbench session is opened once')
    assert.equal(fixture.calls.hubSurface, 0, 'the Hub gateway descriptor is not requested when mesh succeeds')
    assert.equal(fixture.calls.hubRequest, 0, 'the OAuth Hub descriptor is not requested when mesh succeeds')
  } finally { fixture.dispose() }
})

test('NativeSurface degrades to the Hub gateway when the mesh dial is unreachable', async () => {
  const error = new Error('本机没有就绪的目标网络 SOCKS 路由。')
  error.code = 'mesh_dial_unreachable'
  const fixture = createMeshSurfaceFixture({ meshError: error })
  try {
    fixture.renderer.render()
    await tick(); await tick(); await tick()
    fixture.renderer.render()
    const webview = walk(fixture.renderer.output(), (node) => node.type === 'webview')
    assert.ok(webview, 'the Hub gateway session still mounts after a mesh failure')
    assert.equal(webview.props.src, 'https://g46285.controller.example/?tether_native=1')
    assert.equal(fixture.calls.meshOpen, 1)
    assert.equal(fixture.calls.hubSurface, 1, 'exactly one Hub gateway descriptor request')
    const degraded = fixture.logs.find((entry) => String(entry[0]).includes('降级'))
    assert.ok(degraded, 'the degradation reason is logged: ' + JSON.stringify(fixture.logs))
    assert.equal(degraded[1].reason, 'open_failed')
    assert.match(String(degraded[1].message), /SOCKS/)
  } finally { fixture.dispose() }
})

test('NativeSurface skips the mesh attempt when the service catalog is not ready', async () => {
  const fixture = createMeshSurfaceFixture({ catalogState: 'starting' })
  try {
    fixture.renderer.render()
    await tick(); await tick(); await tick()
    fixture.renderer.render()
    assert.equal(fixture.calls.meshOpen, 0, 'a starting service is not opened through mesh')
    assert.equal(fixture.calls.hubSurface, 1, 'the Hub gateway keeps the readable per-code errors')
    const degraded = fixture.logs.find((entry) => String(entry[0]).includes('降级'))
    assert.equal(degraded[1].reason, 'catalog_not_ready')
  } finally { fixture.dispose() }
})

test('local Electron NativeSurface uses the main-process local DSH bootstrap', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  globalThis.setTimeout = setTimeout
  globalThis.clearTimeout = clearTimeout
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.window = { location: { origin: 'http://127.0.0.1:18892', protocol: 'http:' },
    localStorage: { getItem: () => null, setItem() {} } }
  let localBootstrapCalls = 0
  const gatewayCalls = []
  globalThis.fetch = async () => { throw new Error('local DSH bootstrap must not fetch the Hub descriptor') }
  const host = {
    kind: 'app', apiBase: () => 'http://127.0.0.1:18892', surfaceBase: () => 'http://127.0.0.1:18892',
    apiHeaders: () => undefined, hubConfig: () => null, hubRequest: async (request) => {
      gatewayCalls.push(request)
      return { status: 200, body: { available: true, url: 'https://hub.example/g25660/?token=hub' } }
    },
    workbench: { catalog: async () => ({ services: [] }), openDshSurface: async () => {
      localBootstrapCalls += 1
      return { targetId: 'device-a', serviceId: 'dsh-native', grantId: 'local-grant',
        partition: 'persist:tether-wb-' + 'a'.repeat(40),
        endpoint: 'http://127.0.0.1:50669/?token=' + 'f'.repeat(43),
        nativeEndpoint: 'http://127.0.0.1:50669/?tether_native=1', localDirect: true }
    } }
  }
  const renderer = createHookRenderer({ deviceId: 'device-a', online: true, visible: true, localDeviceId: 'device-a' })
  const surface = createTetherPanel({ React: renderer.React, Native: createWebNative(renderer.React), host }).NativeSurface
  renderer.setComponent(surface)
  try {
    renderer.render()
    await tick(); await tick(); await tick(); renderer.render(); await tick()
    assert.equal(localBootstrapCalls, 1, 'the local target asks the main-process local bootstrap')
    assert.equal(gatewayCalls.filter((item) => item === 'openDshSurface'
      || (item && item.path && item.path.endsWith('/dsh/surface'))).length, 0,
      'the local fast path must not mount the Hub gateway')
    const webview = walk(renderer.output(), (node) => node.type === 'webview')
    assert.ok(webview, 'the local bootstrap mounts the loopback DSH page')
    assert.equal(webview.props.src, 'http://127.0.0.1:50669/?token=' + 'f'.repeat(43))
    assert.match(webview.props.partition, /^persist:tether-wb-[a-f0-9]{40}$/)
  } finally {
    renderer.dispose()
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete globalThis[key]
      else globalThis[key] = previous[key]
    }
  }
})
