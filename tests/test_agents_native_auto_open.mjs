import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentsPage } from '../packages/tether-ui/src/agents-page.js'

function hookRenderer() {
  const instances = new Map()
  const webviews = new Map()
  const pending = []
  let current = null
  const React = {
    createElement(type, props, ...children) {
      if (type === 'webview' && props && props.ref && typeof props.ref === 'object') {
        let guest = webviews.get(props.key)
        if (!guest) {
          const listeners = new Map()
          guest = {
            url: props.src,
            getURL() { return this.url },
            isLoadingMainFrame() { return false },
            addEventListener(name, listener) { listeners.set(name, listener) },
            removeEventListener(name) { listeners.delete(name) },
            executeJavaScript() { return Promise.resolve() },
            navigate(url) {
              this.url = url
              const listener = listeners.get('did-navigate-in-page')
              if (listener) listener({ isMainFrame: true, url })
            }
          }
          webviews.set(props.key, guest)
        } else {
          guest.url = props.src
        }
        props.ref.current = guest
      }
      return { type, props: props || {}, children }
    },
    useState(initial) {
      const slot = current.cursor++
      if (!(slot in current.hooks)) current.hooks[slot] = typeof initial === 'function' ? initial() : initial
      const instance = current
      return [instance.hooks[slot], (value) => {
        const next = typeof value === 'function' ? value(instance.hooks[slot]) : value
        if (!Object.is(next, instance.hooks[slot])) instance.hooks[slot] = next
      }]
    },
    useRef(initial) {
      const slot = current.cursor++
      if (!(slot in current.hooks)) current.hooks[slot] = { current: initial }
      return current.hooks[slot]
    },
    useEffect(effect, dependencies) {
      const slot = current.cursor++
      const previous = current.hooks[slot]
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
        pending.push({ instance: current, slot, effect, dependencies })
      }
    }
  }
  const invoke = (component, props, path) => {
    let instance = instances.get(path)
    if (!instance) { instance = { hooks: [], cursor: 0 }; instances.set(path, instance) }
    const previous = current
    instance.cursor = 0
    current = instance
    const output = component(props)
    current = previous
    return expand(output, path)
  }
  const expand = (node, path) => {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, path + '/' + index))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function' && node.type.name === 'AgentTargetPage') {
      return invoke(node.type, node.props, path)
    }
    return { ...node, children: expand(node.children || [], path) }
  }
  return {
    React,
    navigateWebview(key, url) { const guest = webviews.get(key); if (guest) guest.navigate(url) },
    async render(props) {
      let tree
      for (let round = 0; round < 12; round += 1) {
        pending.length = 0
        tree = invoke(createAgentsPage, props, 'root')
        for (const entry of pending.splice(0)) {
          const previous = entry.instance.hooks[entry.slot]
          if (previous && previous.cleanup) previous.cleanup()
          current = entry.instance
          const cleanup = entry.effect()
          current = null
          entry.instance.hooks[entry.slot] = { dependencies: entry.dependencies, cleanup }
        }
        await new Promise((resolve) => setImmediate(resolve))
      }
      return tree
    }
  }
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (!node || typeof node !== 'object') return String(node || '')
  return textContent(node.children || [])
}

function findButton(node, label) {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findButton(child, label); if (found) return found }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button' && textContent(node).includes(label)) return node
  return findButton(node.children || [], label)
}

function findElement(node, type) {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findElement(child, type); if (found) return found }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (node.type === type) return node
  return findElement(node.children || [], type)
}

function pageProps(React, open, calls, options = {}) {
  return {
    React,
    Glyph: () => null,
    C: new Proxy({}, { get: () => '#777' }),
    post: options.post || (async (url) => url.endsWith('/terminal_shells')
      ? { shells: [{ id: 'herdr', available: true }] }
      : { harnesses: [] }),
    devices: [{ device_id: 'target-a', online: true, name: 'Target A' }],
    localDevice: 'target-a',
    activeDevice: 'target-a',
    isActive: options.isActive === undefined ? true : options.isActive,
    host: { kind: 'app', workbench: {
      catalog: async () => {
        calls.catalog += 1
        return options.catalog || { protocol: 1, services: [{ id: 'codeg', state: 'ready' }] }
      },
      open: async (targetId, serviceId) => {
        calls.open += 1
        return open(targetId, serviceId)
      },
      openLegacyCodeg: options.openLegacyCodeg,
      view: async () => ({ ok: true })
    } }
  }
}

test('native Agents refreshes a retained Codeg pane on re-entry and manual retry remains available after failure', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const success = { targetId: 'target-a', serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg', bootstrapRevision: 1 }
    const refreshed = { ...success, endpoint: 'https://codeg-next.example.test', bootstrapRevision: 2 }
    const calls = { catalog: 0, open: 0 }
    const renderer = hookRenderer()
    const props = pageProps(renderer.React, async () => calls.open === 1 ? success : refreshed, calls)
    let tree = await renderer.render({ ...props, isActive: false })
    assert.equal(calls.open, 0, 'a hidden Agents page does not open Codeg in the background')
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'a ready native catalog opens Codeg automatically once')
    assert.ok(findButton(tree, '打开 Codeg') === null, 'the native guest replaces the placeholder instead of leaving a second launch CTA')
    const initialGuestKey = findElement(tree, 'webview').props.key
    await renderer.render({ ...props, isActive: false, devices: [...props.devices] })
    tree = await renderer.render(props)
    assert.equal(calls.open, 2, 'returning to Agents refreshes the retained Codeg authorization once')
    assert.notEqual(findElement(tree, 'webview').props.key, initialGuestKey, 'a changed runtime endpoint remounts the existing guest')
    await renderer.render(props)
    assert.equal(calls.open, 2, 'same-page renders do not repeat the activation refresh')

    const retryCalls = { catalog: 0, open: 0 }
    const retryRenderer = hookRenderer()
    let shouldFail = true
    const retryProps = pageProps(retryRenderer.React, async () => {
      if (shouldFail) throw new Error('open failed')
      return success
    }, retryCalls)
    tree = await retryRenderer.render(retryProps)
    assert.equal(retryCalls.open, 1, 'a failed automatic attempt is not repeated on rerenders')
    const retryCatalog = findButton(tree, '重试服务目录')
    assert.ok(retryCatalog, 'the existing catalog retry remains available')
    retryCatalog.props.onClick()
    tree = await retryRenderer.render(retryProps)
    assert.equal(retryCalls.open, 1, 'refreshing the catalog does not retry automatically')
    const manualOpen = findButton(tree, '打开 Codeg')
    assert.ok(manualOpen, 'the existing manual Codeg control remains available')
    shouldFail = false
    manualOpen.props.onClick()
    await retryRenderer.render(retryProps)
    assert.equal(retryCalls.open, 2, 'manual retry can open Codeg after the failed automatic attempt')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('native Agents retains the existing Codeg guest when endpoint and bootstrap are unchanged', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const success = { targetId: 'target-a', serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg', bootstrapRevision: 1 }
    const calls = { catalog: 0, open: 0 }
    const renderer = hookRenderer()
    const props = pageProps(renderer.React, async () => success, calls)
    const firstTree = await renderer.render(props)
    const firstGuestKey = findElement(firstTree, 'webview').props.key
    await renderer.render({ ...props, isActive: false, devices: [...props.devices] })
    const returnedTree = await renderer.render(props)
    assert.equal(calls.open, 2, 're-entry still performs a fresh main-process status read')
    assert.equal(findElement(returnedTree, 'webview').props.key, firstGuestKey,
      'an unchanged endpoint and bootstrap revision preserve the guest instance, tabs, and draft')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('native Agents does not steal an active Herdr pane, then refreshes when returning to Codeg', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const first = { targetId: 'target-a', serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg', bootstrapRevision: 1 }
    const refreshed = { ...first, endpoint: 'https://codeg-next.example.test', bootstrapRevision: 2 }
    const calls = { catalog: 0, open: 0 }
    const renderer = hookRenderer()
    const props = pageProps(renderer.React, async () => calls.open === 1 ? first : refreshed, calls)
    let tree = await renderer.render(props)
    const guest = findElement(tree, 'webview')
    const initialGuestKey = guest.props.key
    renderer.navigateWebview(initialGuestKey,
      'https://codeg.example.test/workspace#tether_action=open_herdr&request_id=12345678-1234-1234-1234-123456789abc&agent_type=codex&cwd=C%3A%5Cproject')
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'opening Herdr does not refresh Codeg')
    assert.ok(findButton(tree, '返回 Codeg'), 'Herdr exposes the existing return-to-Codeg control')

    await renderer.render({ ...props, isActive: false, devices: [...props.devices] })
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'returning to Agents while Herdr is active does not open or select Codeg')
    assert.ok(findButton(tree, '返回 Codeg'), 'the existing Herdr pane remains active after returning to Agents')

    findButton(tree, '返回 Codeg').props.onClick()
    tree = await renderer.render(props)
    assert.equal(calls.open, 2, 'returning to the visible Codeg pane refreshes its runtime authorization')
    assert.notEqual(findElement(tree, 'webview').props.key, initialGuestKey,
      'the guest remounts when the refreshed endpoint/bootstrap changes')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('native Agents opens ready legacy Codeg only after runtime readiness passes its existing guard', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const sequence = []
    const calls = { catalog: 0, open: 0, legacy: 0, runtime: 0 }
    const renderer = hookRenderer()
    const props = pageProps(renderer.React, async () => {
      calls.open += 1
      throw new Error('modern opener must not be used for legacy Codeg')
    }, calls, {
      catalog: { protocol: 1, legacy: true, services: [
        { id: 'codeg', state: 'ready', open_mode: 'legacy-codeg' }
      ] },
      post: async (url) => {
        if (url.endsWith('/agents_runtime_status')) {
          calls.runtime += 1
          sequence.push('runtime-ready')
          return { running: true, url: 'https://runtime.example.test' }
        }
        return url.endsWith('/terminal_shells') ? { shells: [] } : { harnesses: [] }
      },
      openLegacyCodeg: async (targetId) => {
        calls.legacy += 1
        sequence.push('legacy-open')
        return { targetId, serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg' }
      }
    })
    await renderer.render(props)
    assert.deepEqual(sequence, ['runtime-ready', 'legacy-open'], 'legacy open follows the existing runtime readiness check')
    assert.equal(calls.runtime, 1)
    assert.equal(calls.legacy, 1, 'ready legacy Codeg opens automatically once')
    assert.equal(calls.open, 0, 'legacy uses its dedicated existing opener')

    const blockedCalls = { catalog: 0, open: 0, legacy: 0, runtime: 0 }
    const blockedRenderer = hookRenderer()
    const blockedProps = pageProps(blockedRenderer.React, async () => {
      blockedCalls.open += 1
      return { targetId: 'target-a', serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg' }
    }, blockedCalls, {
      catalog: { protocol: 1, legacy: true, services: [
        { id: 'codeg', state: 'ready', open_mode: 'native' }
      ] },
      post: async (url) => {
        if (url.endsWith('/agents_runtime_status')) blockedCalls.runtime += 1
        return url.endsWith('/terminal_shells') ? { shells: [] } : { harnesses: [] }
      },
      openLegacyCodeg: async () => { blockedCalls.legacy += 1 }
    })
    await blockedRenderer.render(blockedProps)
    assert.equal(blockedCalls.legacy, 0, 'legacy mode mismatch stays blocked')
    assert.equal(blockedCalls.runtime, 0, 'blocked legacy Codeg does not start or probe runtime')
    assert.equal(blockedCalls.open, 0, 'blocked legacy Codeg never falls through to the modern opener')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
