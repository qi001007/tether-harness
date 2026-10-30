import assert from 'node:assert/strict'
import test from 'node:test'
import { createTetherPanel } from '../packages/tether-ui/src/app.js'
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

test('NativeSurface cancels obsolete device requests, pauses hidden polling, and waits for iframe load', async () => {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
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
  let surfaceBase = 'https://controller.example'
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1
    if (calls === 1) {
      firstSignal = options.signal
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    if (calls === 5) {
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
    renderer.render()
    const refreshedFrame = walk(renderer.output(), (node) => node.type === 'iframe')
    assert.ok(refreshedFrame, 'a source change obtains a new descriptor and mounts the new document')
    const watchdogCount = [...timers.values()].filter((value) => value.delay === 30000).length
    iframe.props.onLoad()
    assert.equal([...timers.values()].filter((value) => value.delay === 30000).length, watchdogCount,
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
    retryFrame.props.onError()
    renderer.render()
    assert.equal(walk(renderer.output(), (node) => node.type === 'iframe'), null, 'a second load failure stops and shows an error state')
    assert.equal(calls, 4, 'failed frames do not trigger an infinite ticket loop')

    const pollTimer = [...timers.entries()].find(([, value]) => value.delay === 8000)
    assert.ok(pollTimer, 'visible surfaces schedule descriptor polling')
    timers.delete(pollTimer[0])
    pollTimer[1].callback()
    await tick()
    assert.equal(calls, 5, 'only one poll request is in flight')
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
    globalThis.document.visibilityState = 'visible'
    for (const listener of listeners) listener()
    await tick()
    assert.equal(calls, 7, 'returning visible triggers an immediate fresh descriptor poll')
    assert.ok([...timers.values()].some((value) => value.delay === 8000), 'visible polling resumes after a hidden mount')
    renderer.dispose()
    assert.equal(timers.size, 0, 'visibility return timers are cleaned up on unmount')
    assert.equal(timers.size, 0, 'unmount clears load and polling timers')
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete globalThis[key]
      else globalThis[key] = previous[key]
    }
  }
})
