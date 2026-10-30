import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  addDshTargetAttachment,
  createDshTargetAttachments,
  createDshTargetExplorerBridge,
  DSH_TARGET_ATTACHMENT_CHUNK,
  DSH_TARGET_ATTACHMENT_LIMIT
} from '../packages/tether-ui/src/hosts/dsh.js'

const APP_BASE = 'http://127.0.0.1:18892'
const NODE_BASE = 'http://127.0.0.1:18890'

function jsonResponse(data) {
  return { ok: true, status: 200, async json() { return data } }
}

function errorResponse(status, data) {
  return { ok: false, status, async json() { return data } }
}

function world(options = {}) {
  const deviceId = options.deviceId || 'LAPTOP-01'
  const payload = options.payload || Buffer.from('hello from the target computer')
  const fileName = options.fileName || 'notes.txt'
  const fileSize = Number.isSafeInteger(options.fileSize) ? options.fileSize : payload.length
  const drives = options.drives || [
    { name: '系统盘 (C:)', path: 'C:\\' },
    { name: '数据盘 (D:)', path: 'D:\\' }
  ]
  const workspaces = options.workspaces || [
    { id: 'default', name: 'session-workspace', path: 'C:\\work\\session-workspace', kind: 'session' },
    { id: 'other', name: 'other-workspace', path: 'C:\\work\\other-workspace', kind: 'manual' }
  ]
  const listings = options.listings || {
    'C:\\': [{ name: 'work', path: 'C:\\work', dir: true, mtime: 1725000000 }],
    'C:\\work': [{ name: 'session-workspace', path: 'C:\\work\\session-workspace', dir: true, mtime: 1725000000 }],
    'C:\\work\\session-workspace': [
      { name: 'src', path: 'C:\\work\\session-workspace\\src', dir: true, mtime: 1725000000 },
      {
        name: fileName, path: 'C:\\work\\session-workspace\\' + fileName,
        dir: false, size: fileSize, mtime: 1725000000
      }
    ],
    'C:\\work\\other-workspace': [{ name: 'data', path: 'C:\\work\\other-workspace\\data', dir: true, mtime: 1725000000 }],
    'D:\\': []
  }
  const requests = []
  const identityCalls = []
  let identityIndex = 0
  const getRpc = options.getRpc || (() => ({
    call: async (route, action) => {
      assert.equal(route, '/tether-identity')
      assert.equal(action, 'get')
      const index = identityIndex++
      identityCalls.push(index)
      let value = deviceId
      if (typeof options.identity === 'function') value = options.identity(index)
      if (value instanceof Error) throw value
      return { ok: true, value: value === null ? {} : { device_id: value } }
    }
  }))
  const host = options.host || {
    activeApiBase: () => APP_BASE,
    apiBases: () => [APP_BASE, NODE_BASE],
    apiHeaders: () => ({})
  }
  const fetcher = options.fetcher || (async (url, init = {}) => {
    const parsed = new URL(url)
    const path = parsed.pathname
    const body = init.body ? JSON.parse(init.body) : null
    requests.push({
      base: parsed.origin, method: init.method || 'GET', path, body,
      url: String(url), credentials: init.credentials, headers: init.headers || {}
    })
    if (options.offline) throw new TypeError('fetch failed')
    if (path === '/api/devices/' + deviceId + '/drives' || path === '/tether-device-fs/drives') {
      return jsonResponse({ drives, device_id: options.echoDeviceId || deviceId })
    }
    if (path === '/api/devices/' + deviceId + '/workspaces' || path === '/tether-device-fs/workspaces') {
      return jsonResponse({ root: workspaces[0]?.path || '', workspaces, device_id: options.echoDeviceId || deviceId })
    }
    if (path === '/api/devices/' + deviceId + '/fs/list' || path === '/tether-device-fs/list') {
      if (options.listFailure) return errorResponse(503, { detail: { code: 'device_offline', error: 'device offline' } })
      const entries = listings[body.path]
      if (!entries) return errorResponse(404, { detail: { code: 'not_found', error: 'directory not found' } })
      return jsonResponse({ path: body.path, entries, writable: true, device_id: options.echoDeviceId || deviceId })
    }
    if (path === '/api/devices/' + deviceId + '/fs/read' || path === '/tether-device-fs/read') {
      if (options.readFailure) return errorResponse(500, { detail: { code: 'denied', error: 'read denied' } })
      if (options.beforeRead) await options.beforeRead(body)
      const bytes = payload.subarray(body.offset, body.offset + body.limit)
      const base = {
        path: body.path, size: fileSize, offset: body.offset,
        truncated: body.offset + bytes.length < fileSize,
        mtime: 1725000000, device_id: options.echoDeviceId || deviceId
      }
      if (options.textMode) return jsonResponse({ ...base, binary: false, text: Buffer.from(bytes).toString('utf8') })
      return jsonResponse({ ...base, binary: true, base64: Buffer.from(bytes).toString('base64') })
    }
    return errorResponse(404, { detail: { code: 'not_found', error: 'no route' } })
  })
  const files = []
  const bridge = createDshTargetExplorerBridge({
    getRpc,
    getHost: () => host,
    fetcher,
    makeFile: (chunks, name, fileOptions) => {
      const file = { chunks, name, options: fileOptions, size: chunks.reduce((total, part) => total + part.length, 0) }
      files.push(file)
      return file
    }
  })
  return { bridge, requests, identityCalls, host, payload, files, deviceId }
}

function componentHarness(component, props, React) {
  const hooks = []
  let cursor = 0
  let pendingEffects = []
  let output
  let currentProps = props
  const render = () => {
    cursor = 0
    pendingEffects = []
    output = component(currentProps)
    for (const { index, effect, dependencies } of pendingEffects) {
      hooks[index]?.cleanup?.()
      hooks[index] = { dependencies, cleanup: effect() }
    }
    return output
  }
  React.useState = (initial) => {
    const index = cursor++
    if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
    return [hooks[index].value, (value) => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value }]
  }
  React.useRef = (initial) => {
    const index = cursor++
    if (!hooks[index]) hooks[index] = { current: initial }
    return hooks[index]
  }
  React.useEffect = (effect, dependencies) => {
    const index = cursor++
    const prior = hooks[index]
    if (!prior || !dependencies || dependencies.some((value, i) => !Object.is(value, prior.dependencies?.[i]))) {
      pendingEffects.push({ index, effect, dependencies })
    }
  }
  return {
    render,
    update: nextProps => { currentProps = nextProps },
    dispose: () => hooks.forEach((hook) => hook?.cleanup?.()),
    output: () => output
  }
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return null
}

function findPath(node, predicate, path = []) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findPath(child, predicate, path)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const next = [...path, node]
  if (predicate(node)) return next
  for (const child of node.children || []) {
    const match = findPath(child, predicate, next)
    if (match) return match
  }
  return null
}

function nodeText(node) {
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node === null || node === undefined) return ''
  if (typeof node !== 'object') return String(node)
  return (node.children || []).map(nodeText).join('')
}

function buttonByText(tree, label) {
  return findElement(tree, (node) => node.type === 'button' && nodeText(node).includes(label))
}

function buttonByTitle(tree, title) {
  return findElement(tree, (node) => node.type === 'button' && node.props?.title === title)
}

function createReact() {
  return {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: props || {}, children } }
  }
}

function createNative() {
  return {
    ComposerAttachments: (props) => ({ type: 'native-attachments', props }),
    FileTypeIcon: (props) => ({ type: 'file-type-icon', props })
  }
}

function mount(w, options = {}) {
  const React = createReact()
  const Native = createNative()
  const added = []
  const Component = createDshTargetAttachments(
    React, Native, w.bridge, options.pickerCommand, options.uiWorkspace, options.sessions
  )
  const props = {
    sessionId: 'SESSION-1', canAcceptDrop: true, attachments: [],
    onAddFiles: (files) => added.push(...files),
    readFileDrag: () => null,
    ...options.props
  }
  const harness = componentHarness(Component, props, React)
  harness.render()
  return { harness, added, React, Native, props }
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

function installFakeDocument() {
  const listeners = []
  const document = {
    addEventListener(type, listener, capture) { if (type === 'click' && capture) listeners.push(listener) },
    removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
  }
  return { document, listeners }
}

function makeHiddenInput(listeners) {
  const input = {
    tagName: 'INPUT', type: 'file', hidden: true, opens: 0,
    click() {
      const event = {
        target: input, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true },
        stopPropagation() {},
        stopImmediatePropagation() {}
      }
      for (const listener of [...listeners]) listener(event)
      if (!event.defaultPrevented) input.opens += 1
      return event
    }
  }
  return input
}

test('target explorer lists every drive and workspace, then their real directories and files', async () => {
  const w = world()
  const roots = await w.bridge.getRoots()
  assert.equal(roots.deviceId, 'LAPTOP-01')
  assert.deepEqual(roots.drives.map((drive) => drive.name), ['系统盘 (C:)', '数据盘 (D:)'])
  assert.deepEqual(roots.workspaces.map((workspace) => workspace.path), [
    'C:\\work\\session-workspace', 'C:\\work\\other-workspace'
  ])
  const other = await w.bridge.listDirectory('C:\\work\\other-workspace')
  assert.deepEqual(other.map((entry) => [entry.name, entry.dir]), [['data', true]])
  const drive = await w.bridge.listDirectory('C:\\')
  assert.deepEqual(drive.map((entry) => entry.name), ['work'])
  await assert.rejects(w.bridge.listDirectory('C:\\Windows'), /已列出的目录/)
  await assert.rejects(w.bridge.listDirectory('C:\\work\\session-workspace\\src'), /已列出的目录/)
  assert.deepEqual(w.requests.map((request) => request.path), [
    '/api/devices/LAPTOP-01/drives',
    '/api/devices/LAPTOP-01/workspaces',
    '/api/devices/LAPTOP-01/fs/list',
    '/api/devices/LAPTOP-01/fs/list'
  ])
  assert.ok(w.requests.every((request) => request.base === APP_BASE), 'the APP device proxy is used, not a local file dialog')
  assert.deepEqual(w.requests[2].body, { path: 'C:\\work\\other-workspace' })
})

test('both composer entry points open one modal dialog showing workspaces and drives of the owning computer', async () => {
  const previousDocument = globalThis.document
  const { document, listeners } = installFakeDocument()
  globalThis.document = document
  const input = makeHiddenInput(listeners)
  const w = world()
  const pickerCommand = { open: null, pendingSessionStart: null }
  const { harness } = mount(w, { pickerCommand })
  try {
    harness.output()
    const container = findElement(harness.output(), (node) => node.type === 'div' && node.props.ref)
    container.props.ref.current = { parentElement: { parentElement: null, querySelectorAll: () => [input] } }
    assert.equal(typeof pickerCommand.open, 'function', 'the Composer plus-menu action is registered')
    assert.equal(findElement(harness.output(), (node) => node.props?.role === 'dialog'), null)

    const click = input.click()
    assert.equal(click.defaultPrevented, true, 'the plus-menu file action is routed to the target explorer')
    assert.equal(input.opens, 0, 'the operator local file dialog never opens')
    await flush()
    let tree = harness.render()
    const path = findPath(tree, (node) => node.props?.role === 'dialog')
    assert.ok(path, 'the plus-menu action opens the modal dialog')
    const dialog = path[path.length - 1]
    const overlay = path[path.length - 2]
    assert.equal(dialog.props['aria-modal'], 'true')
    assert.equal(dialog.props['aria-labelledby'], 'tether-target-file-title')
    assert.equal(overlay.props.style.position, 'fixed', 'the explorer is a fixed overlay, not an inline block')
    assert.equal(overlay.props.style.inset, 0)
    assert.equal(dialog.props.style.position, undefined)
    assert.match(nodeText(dialog), /从目标电脑选择文件/)
    assert.match(nodeText(dialog), /目标电脑 · LAPTOP-01/)
    assert.ok(findElement(dialog, (node) => node.props?.['aria-label'] === '关闭'), 'the dialog has a close control')
    assert.match(nodeText(dialog), /工作区/)
    assert.match(nodeText(dialog), /此电脑/)
    assert.match(nodeText(dialog), /session-workspace/, 'the session workspace is listed')
    assert.match(nodeText(dialog), /other-workspace/, 'every workspace on the computer is listed')
    assert.match(nodeText(dialog), /系统盘 \(C:\)/)
    assert.match(nodeText(dialog), /数据盘 \(D:\)/)
    assert.match(nodeText(dialog), /单个附件上限 10 MiB/)
    assert.doesNotMatch(nodeText(tree), /本机文件/)

    const otherRoot = buttonByTitle(tree, 'C:\\work\\other-workspace')
    assert.ok(otherRoot, 'the popup offers the workspace that is not the session default')
    otherRoot.props.onClick()
    await flush()
    tree = harness.render()
    assert.deepEqual(w.requests.at(-1).body, { path: 'C:\\work\\other-workspace' })
    assert.ok(buttonByTitle(tree, 'C:\\work\\other-workspace\\data'), 'the popup lists directories of another workspace')

    findElement(tree, (node) => node.props?.['aria-label'] === '关闭').props.onClick()
    tree = harness.render()
    assert.equal(findElement(tree, (node) => node.props?.role === 'dialog'), null, 'the close control dismisses the dialog')

    const extra = buttonByText(tree, '目标电脑文件…')
    assert.ok(extra, 'the extra composer button is labelled as the target computer, not the operator')
    assert.equal(extra.props.title, '从当前目标电脑选择文件')
    extra.props.onClick()
    await flush()
    tree = harness.render()
    assert.ok(findElement(tree, (node) => node.props?.role === 'dialog'), 'the extra button opens the same modal explorer')
    assert.equal((JSON.stringify(tree).match(/"role":"dialog"/g) || []).length, 1, 'both entry points share one dialog')
    assert.equal(input.opens, 0)
    assert.equal(listeners.length, 1, 'the hidden input listener is installed once')
  } finally {
    harness.dispose()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('choosing a file reads its bytes from the target device fs API and passes them to onAddFiles', async () => {
  const payload = Buffer.alloc(DSH_TARGET_ATTACHMENT_CHUNK + 7)
  for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 31) & 0xff
  const w = world({ payload, fileName: 'photo.PNG' })
  const { harness, added } = mount(w)
  try {
    const button = buttonByText(harness.output(), '目标电脑文件…')
    button.props.onClick()
    await flush()
    let tree = harness.render()
    buttonByTitle(tree, 'C:\\work\\session-workspace').props.onClick()
    await flush()
    tree = harness.render()
    const fileRow = buttonByTitle(tree, 'C:\\work\\session-workspace\\photo.PNG')
    assert.ok(fileRow, 'the selected directory lists its files: ' + nodeText(tree))
    fileRow.props.onClick()
    await flush()
    assert.equal(added.length, 1)
    const file = added[0]
    assert.equal(file.name, 'photo.PNG')
    assert.equal(file.options.type, 'image/png')
    assert.equal(file.size, payload.length)
    assert.deepEqual(Buffer.concat(file.chunks.map((part) => Buffer.from(part))), payload,
      'the explorer keeps original bytes instead of text decoding')
    const reads = w.requests.filter((request) => request.path.endsWith('/fs/read'))
    assert.deepEqual(reads.map((request) => request.body.offset), [0, DSH_TARGET_ATTACHMENT_CHUNK])
    assert.ok(reads.every((request) => request.body.path === 'C:\\work\\session-workspace\\photo.PNG'))
    assert.ok(reads.every((request) => request.body.limit <= DSH_TARGET_ATTACHMENT_CHUNK))
    assert.equal(findElement(harness.render(), (node) => node.props?.role === 'dialog'), null, 'a picked file closes the dialog')
  } finally {
    harness.dispose()
  }
})

test('a non-UTF-8 attachment is read as base64 and comes back byte-identical', async () => {
  const payload = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb8, 0xbd, 0xbc, 0xfe, 0x0a])
  assert.equal(payload.includes(0), false, 'the fixture has no NUL byte and would be decoded as text by the old node')
  const w = world({ payload, fileName: 'legacy.txt' })
  const { harness, added } = mount(w)
  try {
    buttonByText(harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace\\legacy.txt').props.onClick()
    await flush()
    assert.equal(added.length, 1)
    assert.deepEqual(Buffer.concat(added[0].chunks.map((part) => Buffer.from(part))), payload,
      'GBK bytes survive the read unchanged')
    const reads = w.requests.filter((request) => request.path.endsWith('/fs/read'))
    assert.ok(reads.length > 0)
    assert.ok(reads.every((request) => request.body.encoding === 'base64'),
      'the attachment read asks for exact base64 bytes')
  } finally {
    harness.dispose()
  }
})

test('a text-only read response is refused instead of attaching a re-encoded string', async () => {
  const w = world({ payload: Buffer.from('plain text attachment\n'), fileName: 'notes.txt', textMode: true })
  const { harness, added } = mount(w)
  try {
    buttonByText(harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace\\notes.txt').props.onClick()
    await flush()
    assert.equal(added.length, 0, 'no re-encoded string is attached')
    assert.match(nodeText(harness.render()), /原始字节/)
  } finally {
    harness.dispose()
  }
})

test('the native surface page calls only its own origin with credentials', async () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    location: {
      href: 'https://g1.example/?tether_native=1',
      origin: 'https://g1.example',
      search: '?tether_native=1'
    },
    localStorage: { getItem: () => JSON.stringify({ url: 'https://hub.example', token: 'hub-secret' }) }
  }
  try {
    const payload = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a])
    const w = world({
      payload,
      fileName: 'legacy.txt',
      host: {
        activeApiBase: () => { throw new Error('the surface page must not use the Hub') },
        apiBases: () => { throw new Error('the surface page must not use the Hub') },
        apiHeaders: () => { throw new Error('the surface page must not use the Hub token') }
      }
    })
    const roots = await w.bridge.getRoots()
    assert.equal(roots.deviceId, 'LAPTOP-01')
    const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
    const file = await w.bridge.readFile(entries.find((entry) => !entry.dir))
    assert.deepEqual(Buffer.concat(file.chunks.map((part) => Buffer.from(part))), payload)
    assert.ok(w.requests.length >= 4)
    for (const request of w.requests) {
      assert.equal(request.base, 'https://g1.example')
      assert.ok(request.url.startsWith('https://g1.example/tether-device-fs/'), request.url)
      assert.equal(request.credentials, 'include', 'the surface cookie is sent')
      assert.equal(request.headers.Authorization, undefined, 'the Hub token is never attached')
      assert.doesNotMatch(request.url, /127\.0\.0\.1|hub\.example/)
    }
    assert.deepEqual([...new Set(w.requests.map((request) => request.path))].sort(), [
      '/tether-device-fs/drives', '/tether-device-fs/list',
      '/tether-device-fs/read', '/tether-device-fs/workspaces'
    ])
    const reads = w.requests.filter((request) => request.path.endsWith('/read'))
    assert.ok(reads.every((request) => request.body.encoding === 'base64'))
    assert.ok(reads.every((request) => request.body.device_id === 'LAPTOP-01'))
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('a device switch during a read discards the late bytes and shows the error in the popup', async () => {
  const payload = Buffer.alloc(DSH_TARGET_ATTACHMENT_CHUNK + 4, 0x41)
  const w = world({
    payload,
    fileName: 'large.bin',
    identity: (index) => (index >= 4 ? 'DESKTOP-LOCAL' : 'LAPTOP-01')
  })
  const { harness, added } = mount(w)
  try {
    buttonByText(harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace\\large.bin').props.onClick()
    await flush()
    const tree = harness.render()
    assert.equal(added.length, 0, 'a read from the previous computer never reaches the Composer')
    assert.equal(w.requests.filter((request) => request.path.endsWith('/fs/read')).length, 1,
      'the chunk loop stops after the identity changes')
    assert.match(nodeText(tree), /目标电脑已切换/)
    assert.ok(findElement(tree, (node) => node.children?.some?.((child) => child?.props?.role === 'alert')
      || node.props?.role === 'alert'), 'the popup shows the device switch error')
  } finally {
    harness.dispose()
  }
})

test('a session switch discards an in-flight read instead of attaching it to the new session', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const w = world({ payload: Buffer.from('late bytes'), beforeRead: () => gate })
  const { harness, added, props } = mount(w)
  try {
    buttonByText(harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace\\notes.txt').props.onClick()
    await flush(2)
    assert.equal(w.requests.filter((request) => request.path.endsWith('/fs/read')).length, 1, 'the read is in flight')

    harness.update({ ...props, sessionId: 'SESSION-2' })
    harness.render()
    const tree = harness.render()
    assert.equal(findElement(tree, (node) => node.props?.role === 'dialog'), null, 'switching sessions closes the explorer')

    release()
    await flush()
    assert.equal(added.length, 0, 'the late result is discarded')
  } finally {
    harness.dispose()
  }
})

test('missing identity and unreachable devices surface errors in the popup and never open a local file input', async () => {
  const missing = world({ identity: () => null })
  const missingMount = mount(missing)
  try {
    buttonByText(missingMount.harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    const tree = missingMount.harness.render()
    assert.match(nodeText(tree), /无法确认目标电脑身份/)
    assert.equal(findElement(tree, (node) => node.type === 'input'), null, 'no local file input is rendered')
    assert.equal(missing.requests.length, 0, 'no device request is made without an identity')
  } finally {
    missingMount.harness.dispose()
  }

  const offline = world({ offline: true })
  const offlineMount = mount(offline)
  try {
    buttonByText(offlineMount.harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    const tree = offlineMount.harness.render()
    assert.match(nodeText(tree), /目标电脑不可达/)
    assert.ok(findElement(tree, (node) => node.props?.role === 'dialog'), 'the popup stays open with the error')
    assert.equal(findElement(tree, (node) => node.type === 'input'), null)
    assert.deepEqual([...new Set(offline.requests.map((request) => request.base))], [APP_BASE, NODE_BASE],
      'both configured authorities are tried before reporting the device unreachable')
    assert.equal(offlineMount.added.length, 0)
  } finally {
    offlineMount.harness.dispose()
  }

  const denied = world({ listFailure: true })
  const deniedMount = mount(denied)
  try {
    buttonByText(deniedMount.harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    buttonByTitle(deniedMount.harness.render(), 'C:\\work\\session-workspace').props.onClick()
    await flush()
    const tree = deniedMount.harness.render()
    assert.match(nodeText(tree), /目标电脑不可达或已离线/)
    assert.equal(findElement(tree, (node) => node.type === 'input'), null)
  } finally {
    deniedMount.harness.dispose()
  }
})

test('oversized files are refused before any bytes are read', async () => {
  const w = world({ payload: Buffer.from([1]), fileSize: DSH_TARGET_ATTACHMENT_LIMIT + 1 })
  const roots = await w.bridge.getRoots()
  assert.equal(roots.deviceId, 'LAPTOP-01')
  const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
  const oversized = entries.find((entry) => !entry.dir)
  await assert.rejects(w.bridge.readFile(oversized), /10 MiB/)
  assert.equal(w.requests.filter((request) => request.path.endsWith('/fs/read')).length, 0)

  const { harness, added } = mount(w)
  try {
    buttonByText(harness.output(), '目标电脑文件…').props.onClick()
    await flush()
    buttonByTitle(harness.render(), 'C:\\work\\session-workspace').props.onClick()
    await flush()
    const tree = harness.render()
    assert.match(nodeText(tree), /超过 10 MiB/)
    const row = buttonByTitle(tree, 'C:\\work\\session-workspace\\notes.txt')
    assert.equal(row.props.disabled, true)
    assert.equal(added.length, 0)
  } finally {
    harness.dispose()
  }
})

test('the picker preserves the native attachment/drop contract', () => {
  const nativeUiPackage = JSON.parse(fs.readFileSync(new URL('../packages/tether-dsh-native-ui/package.json', import.meta.url), 'utf8'))
  assert.equal(nativeUiPackage.dependencies['@deepseek-ai/dsh-client-ui-attachment'], undefined)
  const readFileDrag = () => null
  const translate = (key) => key
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => [initial, () => {}],
    useRef: (current) => ({ current }),
    useEffect: () => {}
  }
  const Native = { ComposerAttachments: (props) => ({ type: 'native-attachments', props }) }
  const Wrapper = createDshTargetAttachments(React, Native, {})
  const tree = Wrapper({ readFileDrag, t: translate, sessionId: undefined, canAcceptDrop: false })
  assert.equal(tree.children[0].type, Native.ComposerAttachments)
  assert.equal(tree.children[0].props.readFileDrag, readFileDrag)
  assert.equal(tree.children[0].props.t, translate)
  assert.equal(buttonByText(tree, '目标电脑文件…').props.title, '从当前目标电脑选择文件')
})

test('DSH registration wires the device explorer and ships the modal bundle', () => {
  const build = fs.readFileSync(new URL('../packages/tether-ui/scripts/build.mjs', import.meta.url), 'utf8')
  assert.match(build, /createDshTargetExplorerBridge\(\{ getRpc: \(\) => localPluginRpc, getHost: \(\) => host \}\)/)
  assert.match(build, /createDshTargetAttachments\(React, Native, targetFiles, targetFilePicker, ctx\.uiWorkspace, ctx\.sessions\)/)
  assert.doesNotMatch(build, /remote\.workspaceFiles/)
  assert.doesNotMatch(build, /ctx\.remote\.workspaceFiles/)
  assert.match(build, /priority: -1000, locale: 'conversation'/)
  assert.match(build, /inject: \(sessionId\) => \(\{ sessionId \}\)/)
  assert.match(build, /'uiWorkspace', 'sessions'/)
  assert.doesNotMatch(build, /ctx\.fileDrag/)

  const dsh = fs.readFileSync(new URL('../packages/tether-ui/src/hosts/dsh.js', import.meta.url), 'utf8')
  assert.match(dsh, /createDshTargetExplorerBridge/)
  assert.match(dsh, /'\/drives'/)
  assert.match(dsh, /'\/workspaces'/)
  assert.match(dsh, /'\/fs\/list'/)
  assert.match(dsh, /'\/fs\/read'/)
  assert.match(dsh, /role: 'dialog', 'aria-modal': 'true'/)
  assert.match(dsh, /目标电脑文件…/)
  assert.doesNotMatch(dsh, /本机文件…/)
  assert.doesNotMatch(dsh, /createDshTargetFilesBridge/)

  const bundle = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /createDshTargetExplorerBridge\(\{ getRpc: \(\) => localPluginRpc, getHost: \(\) => host \}\)/)
  assert.match(bundle, /从目标电脑选择文件/)
  assert.match(bundle, /'\/fs\/read'/)
  assert.doesNotMatch(bundle, /本机文件…/)
})
