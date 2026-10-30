import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  addDshTargetAttachment,
  createDshTargetAttachments,
  createDshTargetFilesBridge,
  DSH_TARGET_ATTACHMENT_CHUNK,
  DSH_TARGET_ATTACHMENT_LIMIT
} from '../packages/tether-ui/src/hosts/dsh.js'

function fixture({ deviceIds = ['LAPTOP-01'], payload = new Uint8Array(), fileName = 'file.txt', listFailure = false, readFailure = false, versions = [] } = {}) {
  let identityIndex = 0
  const lists = []
  const reads = []
  const getRpc = () => ({ call: async (route, action) => {
    assert.equal(route, '/tether-identity')
    assert.equal(action, 'get')
    const device_id = deviceIds[Math.min(identityIndex++, deviceIds.length - 1)]
    return { ok: true, value: { device_id } }
  } })
  const getRemote = () => ({ workspaceFiles: {
    list: async (sessionId, path) => {
      lists.push({ sessionId, path })
      if (listFailure) return { ok: false, error: new Error('workspace denied') }
      if (path === '.') return { ok: true, value: { entries: [
        { name: 'src', type: 'directory' },
        { name: fileName, type: 'file', size: payload.length }
      ] } }
      if (path === 'src') return { ok: true, value: { entries: [
        { name: 'nested.txt', type: 'file', size: payload.length }
      ] } }
      return { ok: false, error: new Error('outside workspace') }
    },
    readBytes: async (sessionId, path, options) => {
      reads.push({ sessionId, path, options })
      if (readFailure) return { ok: false, error: new Error('read denied') }
      const { offset, length } = options.range
      const data = payload.slice(offset, offset + length)
      return { ok: true, value: { absolutePath: '/workspace/file', version: versions[reads.length - 1] || 'v1', offset, bytes: payload.length, data } }
    }
  } })
  const bridge = createDshTargetFilesBridge({
    getRpc,
    getRemote,
    makeFile: (chunks, name, options) => ({ chunks, name, options, size: chunks.reduce((n, part) => n + part.length, 0) })
  })
  return { bridge, lists, reads }
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

test('listing and file reads use the native owner identity and active session workspace API', async () => {
  const { bridge, lists } = fixture()
  const root = await bridge.getRoots('SESSION-1')
  const entries = await bridge.listDirectory('SESSION-1', 'src')
  assert.equal(root.root.path, '.')
  assert.equal(root.entries[0].path, 'src')
  assert.equal(entries[0].path, 'src/nested.txt')
  assert.deepEqual(lists, [
    { sessionId: 'SESSION-1', path: '.' },
    { sessionId: 'SESSION-1', path: 'src' }
  ])
})

test('only a file returned by a scoped workspace listing can be read', async () => {
  const { bridge, reads } = fixture({ payload: new Uint8Array([0xff]) })
  await assert.rejects(bridge.readFile('SESSION-1', { name: 'private.txt', path: 'private.txt', size: 1 }), /刚列出的文件/)
  assert.equal(reads.length, 0)
  await assert.rejects(bridge.listDirectory('SESSION-1', 'C:/'), /已列出的目录/)
  const root = await bridge.getRoots('SESSION-1')
  await assert.rejects(bridge.readFile('SESSION-2', root.entries[1]), /刚列出的文件/)
  assert.equal(reads.length, 0)
})

test('selected target file is delivered through onAddFiles without text decoding', async () => {
  const payload = new Uint8Array(DSH_TARGET_ATTACHMENT_CHUNK + 7)
  payload.fill(0x41)
  payload[DSH_TARGET_ATTACHMENT_CHUNK - 1] = 0xe2
  payload[DSH_TARGET_ATTACHMENT_CHUNK] = 0x82
  payload[DSH_TARGET_ATTACHMENT_CHUNK + 1] = 0xac
  payload[DSH_TARGET_ATTACHMENT_CHUNK + 2] = 0xff
  const { bridge, reads } = fixture({ payload })
  const root = await bridge.getRoots('SESSION-1')
  const files = []
  const file = await addDshTargetAttachment({ onAddFiles: batch => files.push(...batch) }, bridge,
    'SESSION-1', root.entries[1])
  const restored = Buffer.concat(file.chunks.map(part => Buffer.from(part)))
  assert.deepEqual(restored, Buffer.from(payload))
  assert.equal(file.name, 'file.txt')
  assert.deepEqual(files, [file])
  assert.deepEqual(reads.map(item => item.options.range.offset), [0, DSH_TARGET_ATTACHMENT_CHUNK])
  assert.ok(reads.every(item => item.sessionId === 'SESSION-1' && item.path === 'file.txt'))
})

test('changed file versions across byte chunks are rejected and image MIME types are preserved', async () => {
  const payload = new Uint8Array(DSH_TARGET_ATTACHMENT_CHUNK + 1).fill(0x89)
  const changed = fixture({ payload, versions: ['v1', 'v2'] })
  const changedRoot = await changed.bridge.getRoots('SESSION-1')
  let attached = false
  await assert.rejects(addDshTargetAttachment({ onAddFiles: () => { attached = true } }, changed.bridge,
    'SESSION-1', changedRoot.entries[1]), /字节不完整/)
  assert.equal(attached, false)

  const image = fixture({ payload: new Uint8Array([0x89]), fileName: 'picture.PNG' })
  const root = await image.bridge.getRoots('SESSION-1')
  const file = await image.bridge.readFile('SESSION-1', root.entries[1])
  assert.equal(file.options.type, 'image/png')
})

test('target picker uses the remote workspace API and retains the native attachment/drop contract', () => {
  const buildSource = fs.readFileSync(new URL('../packages/tether-ui/scripts/build.mjs', import.meta.url), 'utf8')
  assert.match(buildSource, /typeof ctx\.connection\.rpc\.call === 'function'[\s\S]*ctx\.remote\.workspaceFiles/)
  assert.match(buildSource, /priority: -1000, locale: 'conversation'/)
  assert.match(buildSource, /inject: \(sessionId\) => \(\{ sessionId \}\)/)
  assert.match(buildSource, /'uiWorkspace', 'sessions'/)
  assert.doesNotMatch(buildSource, /ctx\.fileDrag/)

  const nativeUiPackage = JSON.parse(fs.readFileSync(new URL('../packages/tether-dsh-native-ui/package.json', import.meta.url), 'utf8'))
  assert.equal(nativeUiPackage.dependencies['@deepseek-ai/dsh-client-ui-attachment'], undefined)

  const readFileDrag = () => new File([], 'drop.txt')
  const translate = key => key
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}],
    useRef: current => ({ current }),
    useEffect: () => {}
  }
  const Native = { ComposerAttachments: props => ({ type: 'native-attachments', props }) }
  const Wrapper = createDshTargetAttachments(React, Native, {})
  const tree = Wrapper({ readFileDrag, t: translate, sessionId: undefined, canAcceptDrop: false })
  assert.equal(tree.children[0].type, Native.ComposerAttachments)
  assert.equal(tree.children[0].props.readFileDrag, readFileDrag)
  assert.equal(tree.children[0].props.t, translate)
})

test('Composer plus opens the scoped remote picker and its local-file button still opens the native picker', async () => {
  const previousDocument = globalThis.document
  const listeners = []
  let nativeDialogOpens = 0
  const composerParent = { parentElement: null, querySelectorAll(selector) {
    assert.equal(selector, 'input[type="file"][hidden]')
    return [input]
  } }
  const document = {
    addEventListener(type, listener, capture) { if (type === 'click' && capture) listeners.push(listener) },
    removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
  }
  const input = {
    tagName: 'INPUT', type: 'file', hidden: true,
    click() {
      const event = {
        target: input, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
        preventDefault() { this.defaultPrevented = true },
        stopPropagation() { this.propagationStopped = true },
        stopImmediatePropagation() { this.immediateStopped = true }
      }
      for (const listener of [...listeners]) listener(event)
      if (!event.defaultPrevented) nativeDialogOpens += 1
      this.lastClick = event
    }
  }
  globalThis.document = document
  const payload = new Uint8Array([0x00, 0xff, 0x41, 0x80])
  const { bridge, lists } = fixture({ payload })
  const added = []
  const React = {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: props || {}, children } }
  }
  const Native = { ComposerAttachments: props => ({ type: 'native-attachments', props }) }
  const Component = createDshTargetAttachments(React, Native, bridge)
  const props = { sessionId: 'SESSION-1', canAcceptDrop: true, attachments: [], onAddFiles: files => added.push(...files) }
  const harness = componentHarness(Component, props, React)
  try {
    harness.render()
    const container = findElement(harness.output(), node => node.type === 'div' && node.props.ref)
    assert.ok(container)
    container.props.ref.current = { parentElement: composerParent }
    input.click() // the same hidden input the native Composer plus button clicks
    input.click() // repeated clicks while listing is busy must not duplicate the request
    assert.equal(input.lastClick.defaultPrevented, true)
    assert.equal(input.lastClick.immediateStopped, true)
    const otherInput = { tagName: 'INPUT', type: 'file', hidden: true }
    const unrelatedClick = { target: otherInput, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    for (const listener of [...listeners]) listener(unrelatedClick)
    assert.equal(unrelatedClick.defaultPrevented, false, 'other hidden file inputs keep their native behavior')
    nativeDialogOpens += 1
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    let tree = harness.render()
    assert.equal(lists.length, 1, 'repeated plus clicks while busy do not duplicate remote requests')
    assert.equal(lists[0].path, '.', 'plus opens the remote session workspace')
    const fileButton = findElement(tree, node => node.type === 'button' && String(node.children?.[0]).startsWith('📄 file.txt'))
    assert.ok(fileButton, 'the real remote picker renders the listed target file: ' + JSON.stringify(tree))
    fileButton.props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(added.length, 1, 'the selected target file reaches Composer onAddFiles')
    assert.deepEqual(Buffer.concat(added[0].chunks.map(part => Buffer.from(part))), Buffer.from(payload),
      'the remote picker preserves original bytes without text decoding')

    tree = harness.render()
    const localButton = findElement(tree, node => node.type === 'button' && node.children?.[0] === '本机文件…')
    assert.ok(localButton, 'local upload remains as an explicit secondary action')
    const nativeOpensBeforeLocal = nativeDialogOpens
    localButton.props.onClick()
    assert.equal(nativeDialogOpens, nativeOpensBeforeLocal + 1, 'the explicit local action bypasses the remote default')
    assert.equal(listeners.length, 1, 'the hidden input listener is installed once')
  } finally {
    harness.dispose()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('multiple Composer attachment slots stay session-bound and no-session plus clicks never fall back to native picker', async () => {
  const previousDocument = globalThis.document
  const listeners = []
  globalThis.document = {
    addEventListener(type, listener, capture) { if (type === 'click' && capture) listeners.push(listener) },
    removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
  }
  const makeInput = () => ({ tagName: 'INPUT', type: 'file', hidden: true, click() {
    const event = { target: this, prevented: false, preventDefault() { this.prevented = true }, stopPropagation() {}, stopImmediatePropagation() {} }
    for (const listener of [...listeners]) listener(event)
    return event
  } })
  const React = { Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children } } }
  const Native = { ComposerAttachments: props => ({ type: 'native-attachments', props }) }
  const inputs = [makeInput(), makeInput(), makeInput()]
  const fixtures = [fixture(), fixture(), fixture()]
  const harnesses = fixtures.map(({ bridge }, index) => {
    const Component = createDshTargetAttachments(React, Native, bridge)
    const harness = componentHarness(Component, { sessionId: index < 2 ? `SESSION-${index}` : undefined, canAcceptDrop: true, attachments: [], onAddFiles() {} }, React)
    harness.render()
    const container = findElement(harness.output(), node => node.type === 'div' && node.props.ref)
    container.props.ref.current = { parentElement: {
      parentElement: null,
      querySelectorAll() { return [inputs[index]] }
    } }
    return harness
  })
  try {
    const clickA = inputs[0].click()
    assert.equal(clickA.prevented, true, 'the first mounted Composer routes its own input')
    assert.equal(fixtures[0].lists.length, 0, 'workspace listing starts asynchronously')
    assert.equal(fixtures[1].lists.length, 0, 'the other session receives no request')
    const clickB = inputs[1].click()
    assert.equal(clickB.prevented, true, 'the second mounted Composer routes its own input')
    const clickWithoutSession = inputs[2].click()
    assert.equal(clickWithoutSession.prevented, true, 'a composer without a session does not silently open the local picker')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(fixtures[0].lists.map(item => item.sessionId), ['SESSION-0'])
    assert.deepEqual(fixtures[1].lists.map(item => item.sessionId), ['SESSION-1'])
    assert.deepEqual(fixtures[2].lists, [], 'an unselected composer never reads either session workspace')
    assert.match(JSON.stringify(harnesses[2].render()), /先在目标设备选择或创建工作区/)
  } finally {
    for (const harness of harnesses) harness.dispose()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('new-draft plus click creates one official blank session, then resumes the target picker with current intake callback', async () => {
  const previousDocument = globalThis.document
  const listeners = []
  let nativeDialogOpens = 0
  const input = {
    tagName: 'INPUT', type: 'file', hidden: true,
    click() {
      const event = { target: input, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, stopImmediatePropagation() {} }
      for (const listener of [...listeners]) listener(event)
      if (!event.defaultPrevented) nativeDialogOpens += 1
      return event
    }
  }
  const composerParent = { parentElement: null, querySelectorAll: () => [input] }
  globalThis.document = {
    addEventListener(type, listener, capture) { if (type === 'click' && capture) listeners.push(listener) },
    removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
  }
  const payload = new Uint8Array([0, 255, 65])
  const { bridge, lists } = fixture({ payload })
  const React = { Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children } } }
  const Native = { ComposerAttachments: props => ({ type: 'native-attachments', props }) }
  let startCalls = 0
  const uiWorkspace = { startSession() { startCalls += 1 } }
  const sessions = { list: { getSnapshot: () => ({ ids: ['OLD-SESSION'] }) } }
  const pickerCommand = { pendingSessionStart: null }
  const Component = createDshTargetAttachments(React, Native, bridge, pickerCommand, uiWorkspace, sessions)
  const oldFiles = []
  const newFiles = []
  const harness = componentHarness(Component, { canAcceptDrop: true, attachments: [], onAddFiles: files => oldFiles.push(...files) }, React)
  try {
    let tree = harness.render()
    findElement(tree, node => node.type === 'div' && node.props.ref).props.ref.current = { parentElement: composerParent }
    const firstClick = input.click()
    assert.equal(firstClick.defaultPrevented, true)
    assert.equal(nativeDialogOpens, 0, 'the default plus path never opens the local file dialog')
    assert.equal(startCalls, 1, 'a new-draft click asks the official DSH workspace service for one blank session')
    assert.ok(pickerCommand.pendingSessionStart)
    input.click()
    assert.equal(startCalls, 1, 'repeated clicks while preparing do not create duplicate sessions')
    assert.match(JSON.stringify(harness.render()), /正在准备目标 DSH 会话/)

    harness.update({ sessionId: 'NEW-SESSION', canAcceptDrop: true, attachments: [], onAddFiles: files => newFiles.push(...files) })
    tree = harness.render()
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(pickerCommand.pendingSessionStart, null, 'the pending open intent is consumed by the new session')
    assert.deepEqual(lists, [{ sessionId: 'NEW-SESSION', path: '.' }], 'the new session opens its authorized workspace once')
    tree = harness.render()
    const fileButton = findElement(tree, node => node.type === 'button' && String(node.children?.[0]).startsWith('📄 file.txt'))
    assert.ok(fileButton)
    fileButton.props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(oldFiles.length, 0, 'the old draft callback is not retained across session creation')
    assert.equal(newFiles.length, 1, 'the new session receives the attachment')
    assert.deepEqual(Buffer.concat(newFiles[0].chunks.map(part => Buffer.from(part))), Buffer.from(payload))
    assert.equal(nativeDialogOpens, 0)
  } finally {
    harness.dispose()
    clearTimeout(pickerCommand.pendingSessionStart?.timeoutId)
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('draft picker start failures and a switch to an existing session clear the pending open without local fallback', () => {
  const previousDocument = globalThis.document
  const listeners = []
  let nativeDialogOpens = 0
  const input = { tagName: 'INPUT', type: 'file', hidden: true, click() {
    const event = { target: input, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, stopImmediatePropagation() {} }
    for (const listener of [...listeners]) listener(event)
    if (!event.defaultPrevented) nativeDialogOpens += 1
    return event
  } }
  globalThis.document = {
    addEventListener(type, listener, capture) { if (type === 'click' && capture) listeners.push(listener) },
    removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
  }
  const React = { Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children } } }
  const Native = { ComposerAttachments: props => ({ type: 'native-attachments', props }) }
  const { bridge, lists } = fixture()
  const sessions = { list: { getSnapshot: () => ({ ids: ['EXISTING'] }) } }
  const pickerCommand = { pendingSessionStart: null }
  const Component = createDshTargetAttachments(React, Native, bridge, pickerCommand, { startSession() {} }, sessions)
  const harness = componentHarness(Component, { canAcceptDrop: true, attachments: [], onAddFiles() {} }, React)
  try {
    let tree = harness.render()
    findElement(tree, node => node.type === 'div' && node.props.ref).props.ref.current = { parentElement: { parentElement: null, querySelectorAll: () => [input] } }
    assert.equal(input.click().defaultPrevented, true)
    assert.ok(pickerCommand.pendingSessionStart)
    harness.update({ sessionId: 'EXISTING', canAcceptDrop: true, attachments: [], onAddFiles() {} })
    harness.render()
    assert.equal(pickerCommand.pendingSessionStart, null, 'switching to an unrelated pre-existing session cancels the pending draft picker')
    assert.deepEqual(lists, [], 'the switched session does not receive a stale workspace request')
    assert.equal(nativeDialogOpens, 0)

    const failedCommand = { pendingSessionStart: null }
    const failed = createDshTargetAttachments(React, Native, bridge, failedCommand, { startSession() { throw new Error('workspace unavailable') } }, sessions)
    const failedHarness = componentHarness(failed, { canAcceptDrop: true, attachments: [], onAddFiles() {} }, React)
    try {
      tree = failedHarness.render()
      findElement(tree, node => node.type === 'div' && node.props.ref).props.ref.current = { parentElement: { parentElement: null, querySelectorAll: () => [input] } }
      assert.equal(input.click().defaultPrevented, true)
      assert.equal(failedCommand.pendingSessionStart, null)
      assert.match(JSON.stringify(failedHarness.render()), /workspace unavailable/)
      assert.equal(nativeDialogOpens, 0, 'a failed remote start never falls back to a local file dialog')
    } finally { failedHarness.dispose() }
  } finally {
    harness.dispose()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('oversized files and DSH permission refusals never reach the composer', async () => {
  let attached = false
  const tooLarge = fixture({ payload: new Uint8Array(DSH_TARGET_ATTACHMENT_LIMIT + 1) })
  const root = await tooLarge.bridge.getRoots('SESSION-1')
  await assert.rejects(
    addDshTargetAttachment({ onAddFiles: () => { attached = true } }, tooLarge.bridge, 'SESSION-1', root.entries[1]),
    /10 MiB/
  )
  assert.equal(tooLarge.reads.length, 0)

  const denied = fixture({ payload: new Uint8Array([0xff]), readFailure: true })
  const deniedRoot = await denied.bridge.getRoots('SESSION-1')
  await assert.rejects(
    addDshTargetAttachment({ onAddFiles: () => { attached = true } }, denied.bridge, 'SESSION-1', deniedRoot.entries[1]),
    /read denied/
  )
  assert.equal(attached, false)

  const deniedList = fixture({ listFailure: true })
  await assert.rejects(deniedList.bridge.getRoots('SESSION-1'), /workspace denied/)
})

test('device, session, and missing-session scopes reject stale attachments', async () => {
  const switchedDevice = fixture({
    deviceIds: ['LAPTOP-01', 'LAPTOP-01', 'LAPTOP-01', 'DESKTOP-LOCAL'],
    payload: new Uint8Array([0xff])
  })
  const root = await switchedDevice.bridge.getRoots('SESSION-1')
  let attached = false
  await assert.rejects(
    addDshTargetAttachment({ onAddFiles: () => { attached = true } }, switchedDevice.bridge, 'SESSION-1', root.entries[1]),
    /设备已切换/
  )
  assert.equal(attached, false)

  const sameDevice = fixture({ payload: new Uint8Array([0xff]) })
  const sameRoot = await sameDevice.bridge.getRoots('SESSION-1')
  await assert.rejects(
    addDshTargetAttachment({ onAddFiles: () => { attached = true } }, sameDevice.bridge, 'SESSION-1', sameRoot.entries[1], () => false),
    /会话已切换/
  )
  await assert.rejects(sameDevice.bridge.getRoots(undefined), /选择一个 DSH 会话/)
  assert.equal(attached, false)
})
