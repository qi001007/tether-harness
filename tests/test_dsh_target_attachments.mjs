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

test('native attachment wrapper follows the repository fileDrag injection contract', () => {
  const buildSource = fs.readFileSync(new URL('../packages/tether-ui/scripts/build.mjs', import.meta.url), 'utf8')
  assert.match(buildSource, /priority: -1000, locale: 'conversation',[\s\S]*inject: \(\) => \(\{ readFileDrag: ctx\.fileDrag\.read \}\)/)
  // DSH hosts without the fileDrag service must still boot, so fileDrag is an
  // optional capability probe rather than a required injection.
  assert.doesNotMatch(buildSource, /inject: \[[^\]]*'fileDrag'/)
  assert.match(buildSource, /ctx\.fileDrag && typeof ctx\.fileDrag\.read === 'function'/)

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
