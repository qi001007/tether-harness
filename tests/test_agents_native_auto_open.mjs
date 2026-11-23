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
      openDshSurface: async () => { calls.dsh += 1 },
      view: async () => ({ ok: true })
    } }
  }
}

test('native Agents keeps the shell default DSH surface: mount and visibility never auto-open Codeg', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const success = { targetId: 'target-a', serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg', bootstrapRevision: 1 }
    const calls = { catalog: 0, open: 0, dsh: 0 }
    const renderer = hookRenderer()
    const props = pageProps(renderer.React, async (targetId, serviceId) => {
      assert.equal(targetId, 'target-a')
      assert.equal(serviceId, 'codeg', 'the manual entry is the only Codeg opener')
      return success
    }, calls)
    let tree = await renderer.render({ ...props, isActive: false })
    assert.equal(calls.open, 0, 'a hidden Agents page does not open Codeg in the background')
    assert.equal(calls.dsh, 0, 'the Agents page never opens a DSH surface itself')
    tree = await renderer.render(props)
    assert.equal(calls.catalog, 1, 'the native catalog is still read once to arm the manual entry')
    assert.equal(calls.open, 0, 'a ready native catalog no longer opens Codeg automatically')
    assert.equal(calls.dsh, 0, 'the default mapped DSH surface stays owned by the shell openDshSurface entry')
    assert.ok(findElement(tree, 'webview') === null && findElement(tree, 'iframe') === null,
      'no surface pane is mounted, so the shell default DSH surface is not replaced')
    assert.ok(findButton(tree, '打开 Codeg'), 'the manual Codeg entry remains available')
    await renderer.render({ ...props, isActive: false, devices: [...props.devices] })
    tree = await renderer.render(props)
    assert.equal(calls.open, 0, 'returning to a visible Agents page still does not auto-open Codeg')
    findButton(tree, '打开 Codeg').props.onClick()
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'the manual entry opens Codeg exactly once')
    assert.equal(calls.dsh, 0, 'opening Codeg manually does not touch the DSH surface either')
    assert.equal(findElement(tree, 'webview').props.src, 'https://codeg.example.test/workspace?tether_home=1')
    assert.ok(findButton(tree, '打开 Codeg') === null, 'the native guest replaces the placeholder instead of leaving a second launch CTA')
    const guestKey = findElement(tree, 'webview').props.key
    await renderer.render({ ...props, isActive: false, devices: [...props.devices] })
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 're-entry keeps the retained guest without the removed automatic refresh')
    assert.equal(findElement(tree, 'webview').props.key, guestKey,
      'the manually opened guest instance survives leave-and-return unchanged')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('native Agents does not steal an active Herdr pane and returning to Codeg does not reopen it', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const success = { targetId: 'target-a', serviceId: 'codeg', endpoint: 'https://codeg.example.test', partition: 'persist:codeg', bootstrapRevision: 1 }
    const calls = { catalog: 0, open: 0, dsh: 0 }
    const renderer = hookRenderer()
    const props = pageProps(renderer.React, async () => success, calls)
    let tree = await renderer.render(props)
    findButton(tree, '打开 Codeg').props.onClick()
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'Codeg starts only from the manual entry')
    const initialGuestKey = findElement(tree, 'webview').props.key
    renderer.navigateWebview(initialGuestKey,
      'https://codeg.example.test/workspace#tether_action=open_herdr&request_id=12345678-1234-1234-1234-123456789abc&agent_type=codex&cwd=C%3A%5Cproject')
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'opening Herdr does not reopen Codeg')
    assert.ok(findButton(tree, '返回 Codeg'), 'Herdr exposes the existing return-to-Codeg control')

    await renderer.render({ ...props, isActive: false, devices: [...props.devices] })
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'returning to Agents while Herdr is active does not open or select Codeg')
    assert.ok(findButton(tree, '返回 Codeg'), 'the existing Herdr pane remains active after returning to Agents')

    findButton(tree, '返回 Codeg').props.onClick()
    tree = await renderer.render(props)
    assert.equal(calls.open, 1, 'returning to the visible Codeg pane no longer triggers an automatic refresh')
    assert.equal(findElement(tree, 'webview').props.key, initialGuestKey,
      'the retained guest is shown again without a remount')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('native Agents opens legacy Codeg only through the manual entry after its runtime readiness guard', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} }
  try {
    const sequence = []
    const calls = { catalog: 0, open: 0, dsh: 0, legacy: 0, runtime: 0 }
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
    let tree = await renderer.render(props)
    assert.deepEqual(sequence, [], 'mounting a ready legacy catalog neither probes runtime nor opens Codeg')
    assert.equal(calls.runtime, 0)
    assert.equal(calls.legacy, 0, 'ready legacy Codeg no longer opens automatically')
    assert.equal(calls.open, 0)
    const manualOpen = findButton(tree, '打开 Codeg')
    assert.ok(manualOpen, 'legacy Codeg keeps the same manual entry')
    manualOpen.props.onClick()
    tree = await renderer.render(props)
    assert.deepEqual(sequence, ['runtime-ready', 'legacy-open'], 'the manual legacy open still follows the existing runtime readiness check')
    assert.equal(calls.runtime, 1)
    assert.equal(calls.legacy, 1)
    assert.equal(calls.open, 0, 'legacy uses its dedicated existing opener')

    const blockedCalls = { catalog: 0, open: 0, dsh: 0, legacy: 0, runtime: 0 }
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
    tree = await blockedRenderer.render(blockedProps)
    assert.equal(blockedCalls.legacy, 0, 'legacy mode mismatch stays blocked')
    assert.equal(blockedCalls.runtime, 0, 'blocked legacy Codeg does not start or probe runtime')
    assert.equal(blockedCalls.open, 0, 'blocked legacy Codeg never falls through to the modern opener')
    const blockedButton = findButton(tree, 'Codeg 状态异常')
    assert.ok(blockedButton && blockedButton.props.disabled === true, 'the blocked legacy entry is disabled instead of opening')
    blockedButton.props.onClick()
    await blockedRenderer.render(blockedProps)
    assert.equal(blockedCalls.legacy + blockedCalls.open + blockedCalls.runtime, 0,
      'even a forced click cannot bypass the legacy guard')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})