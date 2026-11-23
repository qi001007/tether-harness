import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  addDshTargetAttachment,
  createDshTargetAttachments,
  createDshTargetExplorerBridge,
  DSH_TARGET_ATTACHMENT_CHUNK,
  DSH_TARGET_ATTACHMENT_CONCURRENCY
} from '../packages/tether-ui/src/hosts/dsh.js'
import { clearDirectoryCache } from '../packages/tether-ui/src/file-cache.js'

const APP_BASE = 'http://127.0.0.1:18892'
const NODE_BASE = 'http://127.0.0.1:18890'

function jsonResponse(data) {
  return { ok: true, status: 200, async json() { return data } }
}

function errorResponse(status, data) {
  return { ok: false, status, async json() { return data } }
}

function world(options = {}) {
  clearDirectoryCache()
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
  const readStats = { active: 0, maxActive: 0, calls: 0 }
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
      if (options.readFault && options.readFault(body)) {
        return errorResponse(503, { detail: { code: 'device_busy', error: 'target busy' } })
      }
      if (options.beforeRead) await options.beforeRead(body)
      readStats.calls += 1
      readStats.active += 1
      readStats.maxActive = Math.max(readStats.maxActive, readStats.active)
      try {
        if (options.readDelay) await new Promise((resolve) => setTimeout(resolve, options.readDelay))
        const bytes = payload.subarray(body.offset, body.offset + body.limit)
        const base = {
          path: body.path, size: fileSize, offset: body.offset,
          truncated: body.offset + bytes.length < fileSize,
          mtime: 1725000000, device_id: options.echoDeviceId || deviceId
        }
        if (options.textMode) return jsonResponse({ ...base, binary: false, text: Buffer.from(bytes).toString('utf8') })
        return jsonResponse({ ...base, binary: true, base64: Buffer.from(bytes).toString('base64') })
      } finally {
        readStats.active -= 1
      }
    }
    if (path === '/api/devices/' + deviceId + '/fs/write_chunk' || path === '/tether-device-fs/write_chunk') {
      const bytes = Buffer.from(body.base64 || '', 'base64')
      return jsonResponse({
        path: body.path, transfer_id: body.transfer_id, offset: body.offset + bytes.length,
        total: body.total, complete: body.final === true, size: body.total,
        device_id: options.echoDeviceId || deviceId
      })
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
  return { bridge, requests, identityCalls, host, payload, files, deviceId, readStats }
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

let liveReact = null

// Renders child function components (TargetFileExplorer, Native.ComposerAttachments)
// inline so traversal sees the dialog tree the browser would paint. Their hooks are
// swapped for stateless shims so they never touch the harness hook state.
function expandTree(node) {
  if (Array.isArray(node)) return node.map(expandTree)
  if (!node || typeof node !== 'object') return node
  const children = (node.children || []).map(expandTree)
  if (typeof node.type !== 'function' || !liveReact) return { ...node, children }
  const saved = {
    useState: liveReact.useState, useRef: liveReact.useRef,
    useEffect: liveReact.useEffect, useMemo: liveReact.useMemo, useCallback: liveReact.useCallback
  }
  liveReact.useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
  liveReact.useRef = (initial) => ({ current: initial })
  liveReact.useEffect = () => undefined
  liveReact.useMemo = (factory) => factory()
  liveReact.useCallback = (fn) => fn
  try {
    return expandTree(node.type({ ...node.props, children }))
  } finally {
    Object.assign(liveReact, saved)
  }
}

function scanElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = scanElement(child, predicate)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const match = scanElement(child, predicate)
    if (match) return match
  }
  return null
}

function findElement(node, predicate) {
  return scanElement(expandTree(node), predicate)
}

function scanPath(node, predicate, path = []) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = scanPath(child, predicate, path)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const next = [...path, node]
  if (predicate(node)) return next
  for (const child of node.children || []) {
    const match = scanPath(child, predicate, next)
    if (match) return match
  }
  return null
}

function findPath(node, predicate, path = []) {
  return scanPath(expandTree(node), predicate, path)
}

function scanText(node) {
  if (Array.isArray(node)) return node.map(scanText).join('')
  if (node === null || node === undefined) return ''
  if (typeof node !== 'object') return String(node)
  return (node.children || []).map(scanText).join('')
}

function nodeText(node) {
  return scanText(expandTree(node))
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
  liveReact = React
  const Native = createNative()
  const added = []
  const pickerCommand = options.pickerCommand || { open: null, pendingSessionStart: null }
  const Component = createDshTargetAttachments(
    React, Native, w.bridge, pickerCommand, options.uiWorkspace, options.sessions
  )
  const props = {
    sessionId: 'SESSION-1', canAcceptDrop: true, attachments: [],
    onAddFiles: (files) => added.push(...files),
    readFileDrag: () => null,
    ...options.props
  }
  const harness = componentHarness(Component, props, React)
  harness.pickerCommand = pickerCommand
  harness.sessionId = props.sessionId
  harness.render()
  return { harness, added, React, Native, props, pickerCommand }
}

async function openPicker(harness) {
  harness.render()
  assert.equal(typeof harness.pickerCommand.open, 'function', 'the Composer plus action is registered')
  assert.equal(harness.pickerCommand.open(harness.sessionId), 'opened',
    'the plus action opens the picker for the current session')
  await flush()
  return harness.render()
}

// The attachment picker is the shared Tether shell dialog; the harness gives
// real hooks only to the top component, so tests drive the dialog through its
// props (the DSH wiring) instead of replaying the shell's own explorer DOM.
function rawScan(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = rawScan(child, predicate)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const match = rawScan(child, predicate)
    if (match) return match
  }
  return null
}

function pickDialog(harness) {
  return rawScan(harness.output(), (node) => typeof node.type === 'function'
    && node.type.name === 'TetherFolderPickDialog')
}

function rawCount(node, predicate) {
  if (Array.isArray(node)) return node.reduce((total, child) => total + rawCount(child, predicate), 0)
  if (!node || typeof node !== 'object') return 0
  let total = predicate(node) ? 1 : 0
  for (const child of node.children || []) total += rawCount(child, predicate)
  return total
}

async function openSharedPicker(harness) {
  await openPicker(harness)
  const dialog = pickDialog(harness)
  assert.ok(dialog, 'the plus opens the shared Tether shell dialog')
  assert.equal(dialog.props.kind, 'file', 'the attachment picker is the file mode of the shared dialog')
  assert.equal(dialog.props.multiple, true, 'the attachment picker is multi-select')
  return dialog
}

async function pickTargetFile(w, harness, name) {
  const dialog = await openSharedPicker(harness)
  const roots = await w.bridge.getRoots()
  assert.equal(roots.deviceId, 'LAPTOP-01')
  const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
  const entry = entries.find((item) => item.name === name)
  assert.ok(entry, 'the target workspace lists ' + name)
  dialog.props.onDone([entry.path], [entry])
  await flush()
  return { dialog, entry }
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

function installFakeDocument() {
  const listeners = []
  const document = {
    addEventListener(type, listener, capture) { if (type === 'drop' && capture) listeners.push(listener) },
    removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
  }
  return { document, listeners }
}

function makeDropEvent(files) {
  const target = { closest: (selector) => (String(selector).includes('contenteditable') ? { nodeType: 1 } : null) }
  return {
    target, dataTransfer: { files }, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() {},
    stopImmediatePropagation() {}
  }
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

test('the native plus opens the one modal explorer and a composer drop is saved to the target inbox', async () => {
  const previousDocument = globalThis.document
  const { document, listeners } = installFakeDocument()
  globalThis.document = document
  const w = world()
  const pickerCommand = { open: null, pendingSessionStart: null }
  const { harness, added } = mount(w, { pickerCommand })
  try {
    harness.output()
    assert.equal(listeners.length, 1, 'the composer drop listener is installed once')
    assert.equal(typeof pickerCommand.open, 'function', 'the Composer plus-menu action is registered')
    assert.equal(findElement(harness.output(), (node) => node.props?.role === 'dialog'), null)

    assert.equal(pickerCommand.open('SESSION-2'), 'not-ready', 'the plus refuses to open for another session')
    assert.equal(findElement(harness.render(), (node) => node.props?.role === 'dialog'), null)
    assert.equal(findElement(harness.render(), (node) => node.type === 'input'), null,
      'the operator local file dialog never opens')

    let tree = await openPicker(harness)
    const path = findPath(tree, (node) => node.props?.role === 'dialog')
    assert.ok(path, 'the plus-menu action opens the modal dialog')
    const dialog = path[path.length - 1]
    const overlay = path[path.length - 2]
    assert.equal(dialog.props['aria-modal'], 'true')
    assert.equal(dialog.props['aria-label'], '选择文件', 'the picker carries the Tether shell file-picker title')
    assert.equal(overlay.props.style.position, 'fixed', 'the explorer is a fixed overlay, not an inline block')
    assert.equal(overlay.props.style.inset, 0)
    assert.equal(dialog.props.style.position, undefined)
    assert.match(nodeText(tree), /可按住 Ctrl 多选文件/)
    assert.doesNotMatch(nodeText(dialog), /从目标电脑选择文件/)
    assert.doesNotMatch(nodeText(tree), /本机文件/)
    assert.ok(findElement(tree, (node) => node.props?.['aria-label'] === '关闭'), 'the dialog has a close control')
    const shared = pickDialog(harness)
    assert.ok(shared, 'the attachment picker is the shared Tether shell dialog')
    assert.equal(shared.props.kind, 'file')
    assert.equal(shared.props.multiple, true)

    findElement(tree, (node) => node.props?.['aria-label'] === '关闭').props.onClick()
    tree = harness.render()
    assert.equal(findElement(tree, (node) => node.props?.role === 'dialog'), null, 'the close control dismisses the dialog')

    tree = await openPicker(harness)
    assert.ok(findElement(tree, (node) => node.props?.role === 'dialog'), 'the native plus reopens the same modal explorer')
    assert.equal(rawCount(tree, (node) => typeof node.type === 'function'
      && node.type.name === 'TetherFolderPickDialog'), 1, 'both entry points share one dialog')
    assert.equal(findElement(tree, (node) => node.type === 'button' && /目标电脑文件/.test(nodeText(node))), null,
      'no separate text button competes with the native plus')

    const bytes = Buffer.from('dropped bytes')
    const dropped = {
      name: 'dropped.txt',
      size: bytes.length,
      async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
      slice(start = 0, end = bytes.length) {
        const part = bytes.subarray(start, end)
        return { size: part.length, async arrayBuffer() { return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) } }
      }
    }
    const drop = makeDropEvent([dropped])
    listeners[0](drop)
    assert.equal(drop.defaultPrevented, true, 'the composer drop is routed to the target inbox')
    await flush()
    assert.ok(added.includes(dropped), 'the dropped file still reaches the Composer locally')
    const write = w.requests.find((request) => request.path.endsWith('/fs/write_chunk'))
    assert.ok(write, 'the dropped file is written to the target node')
    assert.match(write.body.path, /^D:\\TetherDrop\\dropped\.txt$/)
    assert.match(nodeText(harness.render()), /已保存到 D:\\TetherDrop\\dropped\.txt/)
    assert.equal(listeners.length, 1, 'the drop listener stays installed once')
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
    await pickTargetFile(w, harness, 'photo.PNG')
    assert.equal(added.length, 1)
    const file = added[0]
    assert.equal(file.name, 'photo.PNG')
    assert.equal(file.options.type, 'image/png')
    assert.equal(file.size, payload.length)
    assert.deepEqual(Buffer.concat(file.chunks.map((part) => Buffer.from(part))), payload,
      'the explorer keeps original bytes instead of text decoding')
    const reads = w.requests.filter((request) => request.path.endsWith('/fs/read'))
    assert.deepEqual(reads.map((request) => request.body.offset).sort((a, b) => a - b),
      [0, DSH_TARGET_ATTACHMENT_CHUNK])
    assert.ok(reads.every((request) => request.body.path === 'C:\\work\\session-workspace\\photo.PNG'))
    assert.ok(reads.every((request) => request.body.limit <= DSH_TARGET_ATTACHMENT_CHUNK))
    assert.equal(file.chunks.length, 1, 'the slices are decoded into one attachment buffer')
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
    await pickTargetFile(w, harness, 'legacy.txt')
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
    await pickTargetFile(w, harness, 'notes.txt')
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

test('the loopback direct surface page uses the local node channel, never its own origin', async () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    location: {
      href: 'http://127.0.0.1:59999/?tether_native=1',
      origin: 'http://127.0.0.1:59999',
      search: '?tether_native=1'
    },
    localStorage: { getItem: () => null }
  }
  try {
    const payload = Buffer.from('loopback bytes')
    const w = world({ payload, fileName: 'local.txt' })
    const roots = await w.bridge.getRoots()
    assert.equal(roots.deviceId, 'LAPTOP-01')
    const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
    const file = await w.bridge.readFile(entries.find((entry) => !entry.dir))
    assert.deepEqual(Buffer.concat(file.chunks.map((part) => Buffer.from(part))), payload)
    assert.ok(w.requests.length >= 4)
    for (const request of w.requests) {
      assert.equal(request.base, APP_BASE, 'a loopback page never treats itself as the gateway')
      assert.ok(request.url.startsWith(APP_BASE + '/api/devices/LAPTOP-01/'), request.url)
      assert.doesNotMatch(request.url, /59999|tether-device-fs/)
      assert.equal(request.credentials, undefined, 'the node channel needs no surface cookie')
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('the injected directory-flow snippet relays loopback device-file requests through the host bridge', () => {
  const flow = fs.readFileSync(new URL('../tether/node/tether_dsh_directory_flow.js', import.meta.url), 'utf8')
  assert.match(flow, /__tetherDeviceFsChannel/, 'the snippet installs the loopback device-file channel')
  assert.match(flow, /\/tether-device-fs\//, 'only the surface prefix is recognized')
  assert.match(flow, /host === '127\.0\.0\.1' \|\| host === 'localhost'/, 'the channel is limited to loopback pages')
  assert.match(flow, /tether_action: 'fs'/, 'requests travel through the host bridge as tether_action=fs')
  assert.match(flow, /type: 'tether:fs-request'/, 'iframes post the request to the host')
  assert.match(flow, /tether:fs-result/, 'the host reply settles the page request')
  assert.doesNotMatch(flow, /tetherFetch\('http:\/\/127\.0\.0\.1:18892/,
    'the guest never calls the APP origin directly; the host performs the same-origin fetch')
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
    await pickTargetFile(w, harness, 'large.bin')
    const tree = harness.render()
    assert.equal(added.length, 0, 'a read from the previous computer never reaches the Composer')
    assert.ok(w.requests.filter((request) => request.path.endsWith('/fs/read')).length <= 2,
      'every slice of the old computer is discarded')
    assert.match(nodeText(tree), /目标电脑已切换/)
    assert.ok(findElement(tree, (node) => node.props?.role === 'status'),
      'the picker surfaces the device switch error in the composer status rail')
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
    await pickTargetFile(w, harness, 'notes.txt')
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
    const dialog = await openSharedPicker(missingMount.harness)
    await assert.rejects(() => dialog.props.loadRoots(), /无法确认目标电脑身份/)
    assert.equal(findElement(missingMount.harness.render(), (node) => node.type === 'input'), null,
      'no local file input is rendered')
    assert.equal(missing.requests.length, 0, 'no device request is made without an identity')
  } finally {
    missingMount.harness.dispose()
  }

  const offline = world({ offline: true })
  const offlineMount = mount(offline)
  try {
    const dialog = await openSharedPicker(offlineMount.harness)
    await assert.rejects(() => dialog.props.loadRoots(), /目标电脑不可达/)
    assert.equal(findElement(offlineMount.harness.render(), (node) => node.type === 'input'), null)
    assert.deepEqual([...new Set(offline.requests.map((request) => request.base))], [APP_BASE, NODE_BASE],
      'both configured authorities are tried before reporting the device unreachable')
    assert.equal(offlineMount.added.length, 0)
  } finally {
    offlineMount.harness.dispose()
  }

  const denied = world({ listFailure: true })
  const deniedMount = mount(denied)
  try {
    const dialog = await openSharedPicker(deniedMount.harness)
    await dialog.props.loadRoots()
    await assert.rejects(() => dialog.props.listDirectory('C:\\work\\session-workspace'), /目标电脑不可达或已离线/)
    assert.equal(findElement(deniedMount.harness.render(), (node) => node.type === 'input'), null)
  } finally {
    deniedMount.harness.dispose()
  }
})

test('no file is refused by size: a 100 MiB attachment is read in parallel slices, byte-identical', async () => {
  const size = 100 * 1024 * 1024
  const payload = Buffer.alloc(size, 0x2a)
  const megabyte = 1024 * 1024
  for (let offset = 0; offset < size; offset += megabyte) payload[offset] = (offset / megabyte) & 0xff
  payload[size - 1] = 0xff
  const w = world({ payload, fileName: 'archive.bin', readDelay: 1 })
  const roots = await w.bridge.getRoots()
  assert.equal(roots.deviceId, 'LAPTOP-01')
  const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
  const entry = entries.find((item) => !item.dir)
  assert.ok(entry)
  const file = await w.bridge.readFile(entry)
  assert.equal(file.name, 'archive.bin')
  assert.equal(file.size, size, 'the whole 100 MiB file is attached')
  const reads = w.requests.filter((request) => request.path.endsWith('/fs/read'))
  assert.equal(reads.length, Math.ceil(size / DSH_TARGET_ATTACHMENT_CHUNK))
  assert.ok(reads.every((request) => request.body.limit <= DSH_TARGET_ATTACHMENT_CHUNK))
  const offsets = reads.map((request) => request.body.offset).sort((a, b) => a - b)
  assert.equal(offsets[0], 0)
  assert.equal(offsets.at(-1), size - (size % DSH_TARGET_ATTACHMENT_CHUNK || DSH_TARGET_ATTACHMENT_CHUNK))
  assert.equal(new Set(offsets).size, offsets.length, 'every slice is requested exactly once')
  assert.ok(w.readStats.maxActive > 1 && w.readStats.maxActive <= DSH_TARGET_ATTACHMENT_CONCURRENCY,
    'slices are fetched in parallel, never more than ' + DSH_TARGET_ATTACHMENT_CONCURRENCY + ' at a time')
  const assembled = Buffer.concat(file.chunks.map((part) => Buffer.from(part)))
  assert.equal(assembled.length, size)
  assert.ok(assembled.equals(payload), 'the reassembled bytes match the source file')
})

test('a transient read failure is retried until the slice arrives', async () => {
  const payload = Buffer.alloc(DSH_TARGET_ATTACHMENT_CHUNK * 2, 0x37)
  payload[DSH_TARGET_ATTACHMENT_CHUNK] = 0x99
  let failed = 0
  const w = world({
    payload,
    fileName: 'retry.bin',
    readFault: (body) => {
      if (body.offset === DSH_TARGET_ATTACHMENT_CHUNK && failed < 1) { failed += 1; return true }
      return false
    }
  })
  const roots = await w.bridge.getRoots()
  assert.equal(roots.deviceId, 'LAPTOP-01')
  const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
  const entry = entries.find((item) => !item.dir)
  const file = await w.bridge.readFile(entry)
  assert.equal(failed, 1)
  const reads = w.requests.filter((request) => request.path.endsWith('/fs/read'))
  assert.equal(reads.length, 3, 'the failed slice is fetched again')
  const assembled = Buffer.concat(file.chunks.map((part) => Buffer.from(part)))
  assert.ok(assembled.equals(payload))
})

test('a 20 MiB attachment is read slice by slice and reassembled byte-identical', async () => {
  const size = 20 * 1024 * 1024
  const payload = Buffer.alloc(size)
  for (let index = 0; index < size; index += 4093) payload[index] = (index >> 3) & 0xff
  const w = world({ payload, fileName: 'video.mp4' })
  const roots = await w.bridge.getRoots()
  assert.equal(roots.deviceId, 'LAPTOP-01')
  const entries = await w.bridge.listDirectory('C:\\work\\session-workspace')
  const entry = entries.find((item) => !item.dir)
  assert.ok(entry)
  assert.ok(size > 10 * 1024 * 1024, 'the fixture is larger than the old 10 MiB ceiling')
  const file = await w.bridge.readFile(entry)
  assert.equal(file.size, size)
  assert.equal(file.name, 'video.mp4')
  const reads = w.requests.filter((request) => request.path.endsWith('/fs/read'))
  assert.equal(reads.length, Math.ceil(size / DSH_TARGET_ATTACHMENT_CHUNK))
  assert.ok(reads.every((request) => request.body.limit <= DSH_TARGET_ATTACHMENT_CHUNK))
  const assembled = Buffer.concat(file.chunks.map((part) => Buffer.from(part)))
  assert.equal(assembled.length, size)
  assert.ok(assembled.equals(payload), 'the reassembled bytes match the source file')
})

// Environment limitation: this worktree is a sparse checkout without
// packages/tether-dsh-native-ui, so reading its package.json throws ENOENT.
// The assertions below are left untouched; this case only runs on a full checkout.
const nativeUiPackageFile = new URL('../packages/tether-dsh-native-ui/package.json', import.meta.url)
test('the picker preserves the native attachment/drop contract',
  { skip: fs.existsSync(nativeUiPackageFile) ? false : 'sparse worktree lacks packages/tether-dsh-native-ui (ENOENT)' },
  () => {
  const nativeUiPackage = JSON.parse(fs.readFileSync(nativeUiPackageFile, 'utf8'))
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
  assert.equal(tree.children.filter(Boolean).length, 1, 'the native plus is the only Composer file entry')
  assert.equal(buttonByText(tree, '目标电脑文件…'), null)
})

test('the shared picker owns the explorer chrome instead of a DSH-local toolbar', async () => {
  const picker = fs.readFileSync(new URL('../packages/tether-ui/src/tether-folder-pick-dialog.js', import.meta.url), 'utf8')
  assert.match(picker, /h\(TargetFileExplorer, \{/)
  assert.match(picker, /onSort: setSort/)
  assert.match(picker, /onSearch: setSearch/)
  assert.match(picker, /formatTime: formatPickTime/)
  assert.match(picker, /formatSize: formatPickSize/)
  const dsh = fs.readFileSync(new URL('../packages/tether-ui/src/hosts/dsh.js', import.meta.url), 'utf8')
  assert.doesNotMatch(dsh, /tether-breadcrumbs/, 'DSH keeps no second explorer toolbar')
  assert.doesNotMatch(dsh, /搜索当前目录/, 'DSH keeps no second explorer search')
  const w = world()
  const { harness } = mount(w)
  try {
    const dialog = await openSharedPicker(harness)
    assert.equal(typeof dialog.props.loadRoots, 'function', 'the roots still come from the DSH target bridge')
    assert.equal(typeof dialog.props.listDirectory, 'function', 'the listings still come from the DSH target bridge')
  } finally {
    harness.dispose()
  }
})

test('the attachment picker is file-only so folder uploads stay out of the composer', async () => {
  const w = world()
  const { harness, added } = mount(w)
  try {
    const dialog = await openSharedPicker(harness)
    assert.equal(dialog.props.kind, 'file', 'only files can be attached')
    assert.equal(dialog.props.multiple, true, 'several files can be attached at once')
    const dsh = fs.readFileSync(new URL('../packages/tether-ui/src/hosts/dsh.js', import.meta.url), 'utf8')
    assert.doesNotMatch(dsh, /chooseFolder/, 'the DSH host no longer renders a folder-upload confirm')
    assert.equal(added.length, 0)
  } finally {
    harness.dispose()
  }
})

test('a locally dropped file is saved to the target D: inbox', async () => {
  const w = world()
  const bytes = Buffer.from('dropped bytes')
  const file = {
    name: 'my report.txt',
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    slice(start = 0, end = bytes.length) {
      const part = bytes.subarray(start, end)
      return { size: part.length, async arrayBuffer() { return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) } }
    }
  }
  const saved = await w.bridge.saveDroppedFile(file)
  assert.match(saved.path, /^D:\\TetherDrop\\my report\.txt$/)
  assert.equal(saved.size, bytes.length)
  const write = w.requests.find((request) => request.path.endsWith('/fs/write_chunk'))
  assert.ok(write, 'the drop is written through the target Node API')
  assert.equal(write.body.final, true)
  assert.equal(write.body.overwrite, false)
  assert.equal(Buffer.from(write.body.base64, 'base64').toString('utf8'), 'dropped bytes')
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
  // The attachment picker reuses the unified shell dialog; DSH keeps its own
  // target-device roots/listing reader and drops the host file-type icon.
  assert.match(dsh, /TetherFolderPickDialog/)
  assert.match(dsh, /loadRoots: \(\) => bridge\.getRoots\(\)/)
  assert.match(dsh, /listDirectory: \(path\) => bridge\.listDirectory\(path\)/)
  assert.doesNotMatch(dsh, /Native\.FileTypeIcon/)
  assert.match(dsh, /document\.addEventListener\('drop', onDrop, true\)/)
  assert.match(dsh, /bridge\.saveDroppedFile\(file\)/)
  assert.doesNotMatch(dsh, /目标电脑文件…/)
  assert.doesNotMatch(dsh, /从目标电脑选择文件/)
  assert.doesNotMatch(dsh, /本机文件…/)
  assert.doesNotMatch(dsh, /文件从目标电脑读取/)
  assert.doesNotMatch(dsh, /height: 22, flex: '0 0 auto'/)
  assert.match(dsh, /const DSH_TARGET_WRITE_CHUNK = 4 \* 1024 \* 1024/)
  assert.doesNotMatch(dsh, /256 \* 1024 \* 1024/)
  assert.doesNotMatch(dsh, /createDshTargetFilesBridge/)
  assert.doesNotMatch(build, /name: 'tether-target-file'/)

  const explorer = fs.readFileSync(new URL('../packages/tether-ui/src/target-file-explorer.js', import.meta.url), 'utf8')
  assert.match(explorer, /className: 'tether-dir-loading'/)
  assert.match(explorer, /position: 'absolute', inset: 0, zIndex: 4/)
  assert.match(explorer, /animateTransform/)
  assert.match(explorer, /'aria-label': '正在加载目录'/)
  assert.match(explorer, /errorToast/)
  assert.match(explorer, /position: 'relative', display: 'flex', flexDirection: 'column'/)

  const bundle = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /createDshTargetExplorerBridge\(\{ getRpc: \(\) => localPluginRpc, getHost: \(\) => host \}\)/)
  assert.match(bundle, /资源管理器/)
  assert.doesNotMatch(bundle, /从目标电脑选择文件/)
  assert.match(bundle, /'\/fs\/read'/)
  assert.doesNotMatch(bundle, /本机文件…/)
})
