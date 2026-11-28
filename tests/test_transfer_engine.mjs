import assert from 'node:assert/strict'
import test from 'node:test'

import { TRANSFER_CHUNK, newTransferId, transferCrocViaHub, transferFile, transferFileCroc, transferNativeJob } from '../packages/tether-ui/src/transfer.js'
import { hasDirectLanRoute, hasNativeTransferEdge, isCrocUploadCandidate, selectNativeCopyBatch } from '../packages/tether-ui/src/transfer-page.js'

test('large Croc upload hint follows live device capabilities and the transfer direction', () => {
  const croc = { available: true, relay: true }
  const workstation = { device_id: 'new-workstation', online: true, capabilities: {
    os: 'Windows', app_installed: true, croc
  } }
  const receiver = { device_id: 'generic-headless-node', online: true, capabilities: {
    os: 'Linux', app_installed: false, croc
  } }
  const size = 32 * 1024 * 1024
  assert.equal(isCrocUploadCandidate(workstation, receiver, size), true)
  assert.equal(isCrocUploadCandidate(receiver, workstation, size), false)
  assert.equal(isCrocUploadCandidate(workstation, workstation, size), false)
  assert.equal(isCrocUploadCandidate(workstation, receiver, size - 1), false)
  assert.equal(isCrocUploadCandidate(workstation, { ...receiver, online: false }, size), false)
  assert.equal(isCrocUploadCandidate(workstation, { ...receiver, capabilities: { os: 'Linux', croc } }, size), false)
  assert.equal(isCrocUploadCandidate(workstation, {
    ...receiver, capabilities: { ...receiver.capabilities, croc: { available: true, relay: false } }
  }, size), false)
})

test('a direct LAN route suppresses the Seoul Croc upload detour', () => {
  const croc = { available: true, relay: true }
  const workstation = { device_id: 'new-workstation', online: true, capabilities: {
    os: 'Windows', app_installed: true, croc
  } }
  const receiver = { device_id: 'generic-headless-node', online: true, capabilities: {
    os: 'Linux', app_installed: false, croc
  } }
  const size = 32 * 1024 * 1024
  assert.equal(hasDirectLanRoute(workstation, receiver), false)
  assert.equal(hasDirectLanRoute(
    { ...workstation, capabilities: { ...workstation.capabilities, direct: { available: true } } }, receiver), true)
  assert.equal(hasDirectLanRoute(
    workstation, { ...receiver, capabilities: { ...receiver.capabilities, mesh: { p2p: true } } }), true)
  assert.equal(isCrocUploadCandidate(
    { ...workstation, capabilities: { ...workstation.capabilities, lan: true } }, receiver, size), false)
})

function world(payload, options = {}) {
  let written = Buffer.from(payload.subarray(0, options.partial || 0))
  const reads = []
  const writes = []
  const context = { cancelled: false, exists: Boolean(options.exists) }
  return {
    reads, writes, context,
    get written() { return written },
    async read({ offset, limit }) {
      reads.push({ offset, limit })
      if (options.onRead) options.onRead(reads.length)
      const slice = payload.subarray(offset, offset + limit)
      return { size: options.size ?? payload.length, offset, base64: Buffer.from(slice).toString('base64') }
    },
    async status() {
      return { path: 'D:\\dest.bin', transferId: 'test', offset: written.length,
        partial: written.length > 0, exists: context.exists }
    },
    async write(request) {
      assert.equal(request.offset, written.length, 'chunks arrive in order')
      const data = Buffer.from(request.base64, 'base64')
      if (options.onWrite) options.onWrite(writes.length + 1)
      written = Buffer.concat([written, data])
      writes.push({ offset: request.offset, bytes: data.length, final: request.final, resume: request.resume })
      return { offset: written.length, total: request.total, complete: request.final === true }
    },
    async cancel() { context.cancelled = true }
  }
}

test('a file is read and written in ordered chunks with progress', async () => {
  const payload = Buffer.alloc(TRANSFER_CHUNK * 2 + 123)
  for (let index = 0; index < payload.length; index += 1) payload[index] = index & 0xff
  const w = world(payload)
  const progress = []
  const result = await transferFile({
    read: w.read, write: w.write, status: w.status, cancel: w.cancel,
    source: 'C:\\source.bin', destination: 'D:\\dest.bin', overwrite: true,
    onProgress: (value) => progress.push(value)
  })
  assert.equal(result.bytes, payload.length)
  assert.deepEqual(w.written, payload)
  assert.deepEqual(w.reads.map((read) => read.offset), [0, TRANSFER_CHUNK, TRANSFER_CHUNK * 2])
  assert.equal(w.writes.at(-1).final, true)
  assert.equal(progress.at(-1).percent, 100)
})

test('a partial transfer resumes from the recorded offset', async () => {
  const payload = Buffer.alloc(TRANSFER_CHUNK + 512, 0x42)
  const w = world(payload, { partial: 70000 })
  await transferFile({
    read: w.read, write: w.write, status: w.status, cancel: w.cancel,
    source: 'C:\\source.bin', destination: 'D:\\dest.bin', overwrite: true
  })
  assert.equal(w.reads[0].offset, 70000, 'reading starts at the partial offset')
  assert.equal(w.writes[0].resume, true)
  assert.deepEqual(w.written, payload)
})

test('an existing destination is refused unless overwrite is set', async () => {
  const payload = Buffer.from('new')
  const w = world(payload, { exists: true })
  await assert.rejects(
    transferFile({ read: w.read, write: w.write, status: w.status, source: 'C:\\a', destination: 'D:\\a' }),
    (error) => error.code === 'exists'
  )
  assert.equal(w.reads.length, 0)
})

test('cancellation removes the partial transfer', async () => {
  const payload = Buffer.alloc(TRANSFER_CHUNK * 3, 0x31)
  const controller = new AbortController()
  const w = world(payload, { onWrite: () => controller.abort() })
  await assert.rejects(
    transferFile({
      read: w.read, write: w.write, status: w.status, cancel: w.cancel,
      source: 'C:\\a', destination: 'D:\\a', overwrite: true, signal: controller.signal
    }),
    (error) => error.code === 'aborted'
  )
  assert.equal(w.context.cancelled, true)
  assert.ok(w.writes.length >= 1)
})

test('cancel aborts a stalled direct read and cleans only its transfer id', async () => {
  const controller = new AbortController()
  let startRead
  const readStarted = new Promise((resolve) => { startRead = resolve })
  const cancelIds = []
  let hubReads = 0
  let writes = 0
  const transfer = transferFile({
    status: async () => ({ exists: false, offset: 0 }),
    readBytes: ({ signal }) => new Promise((_, reject) => {
      startRead()
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
    read: async () => { hubReads += 1; return { size: 0, offset: 0, base64: '' } },
    write: async () => { writes += 1; return { offset: 0, complete: true } },
    cancel: async (args) => cancelIds.push(args.transferId),
    source: 'source', destination: 'destination', transferId: 'read-job', signal: controller.signal
  })
  await readStarted
  controller.abort()
  await assert.rejects(transfer, (error) => error.code === 'aborted')
  assert.equal(hubReads, 0)
  assert.equal(writes, 0)
  assert.deepEqual(cancelIds, ['read-job'])
})

test('cancel aborts a stalled direct write without retrying through Hub', async () => {
  const controller = new AbortController()
  let startWrite
  const writeStarted = new Promise((resolve) => { startWrite = resolve })
  const cancelIds = []
  let hubWrites = 0
  const bytes = new Uint8Array([1, 2, 3])
  const transfer = transferFile({
    status: async () => ({ exists: false, offset: 0 }),
    readBytes: async () => ({ size: bytes.length, offset: 0, bytes }),
    read: async () => ({ size: bytes.length, offset: 0, base64: '' }),
    writeBytes: ({ signal }) => new Promise((_, reject) => {
      startWrite()
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
    write: async () => { hubWrites += 1; return { offset: bytes.length, complete: true } },
    cancel: async (args) => cancelIds.push(args.transferId),
    source: 'source', destination: 'destination', transferId: 'write-job', signal: controller.signal
  })
  await writeStarted
  controller.abort()
  await assert.rejects(transfer, (error) => error.code === 'aborted')
  assert.equal(hubWrites, 0)
  assert.deepEqual(cancelIds, ['write-job'])
})

test('a confirmed final write stays successful if cancellation races its response', async () => {
  const controller = new AbortController()
  const bytes = new Uint8Array([1, 2, 3])
  let cancelCalls = 0
  const result = await transferFile({
    status: async () => ({ exists: false, offset: 0 }),
    readBytes: async () => ({ size: bytes.length, offset: 0, bytes }),
    read: async () => ({ size: bytes.length, offset: 0, base64: '' }),
    write: async () => ({ offset: bytes.length, complete: true }),
    writeBytes: async () => {
      controller.abort()
      return { offset: bytes.length, complete: true }
    },
    cancel: async () => { cancelCalls += 1 },
    source: 'source', destination: 'destination', transferId: 'completed-job', signal: controller.signal
  })
  assert.equal(result.bytes, bytes.length)
  assert.equal(cancelCalls, 0)
})

test('a changing source aborts instead of writing mixed bytes', async () => {
  const payload = Buffer.alloc(TRANSFER_CHUNK * 2, 0x51)
  const w = world(payload, { size: payload.length, onRead: (count) => { if (count === 2) w.readSize = 1 } })
  const read = w.read
  w.read = async (request) => {
    const value = await read(request)
    return w.readSize ? { ...value, size: payload.length + 1 } : value
  }
  await assert.rejects(
    transferFile({ read: w.read, write: w.write, status: w.status, source: 'C:\\a', destination: 'D:\\a', overwrite: true }),
    (error) => error.code === 'source_changed'
  )
})

test('next chunk is read while the current chunk is still writing', async () => {
  const payload = Buffer.alloc(TRANSFER_CHUNK * 2, 0x5a)
  let releaseWrite
  let writeStartedResolve
  const writeGate = new Promise((resolve) => { releaseWrite = resolve })
  const writeStarted = new Promise((resolve) => { writeStartedResolve = resolve })
  const w = world(payload)
  const write = w.write
  w.write = async (request) => {
    writeStartedResolve()
    await writeGate
    return write(request)
  }
  const transfer = transferFile({
    read: w.read, write: w.write, status: w.status, cancel: w.cancel,
    source: 'C:\\source.bin', destination: 'D:\\dest.bin', overwrite: true
  })
  await writeStarted
  assert.equal(w.reads.length, 2, 'the next read starts before the first write resolves')
  releaseWrite()
  await transfer
  assert.deepEqual(w.written, payload)
})

test('direct read application errors do not retry the same read over the Hub', async () => {
  let hubReads = 0
  await assert.rejects(transferFile({
    readBytes: async () => { throw Object.assign(new Error('permission denied'), { code: 'permission_denied' }) },
    read: async () => { hubReads += 1; return { size: 0, offset: 0, base64: '' } },
    write: async () => ({ offset: 0, complete: true }),
    source: 'C:\\private.bin', destination: 'D:\\private.bin'
  }), (error) => error.code === 'permission_denied')
  assert.equal(hubReads, 0, 'an application error is not retried through the slower route')
})

test('direct write application errors do not retry file bytes over the Hub', async () => {
  const payload = new Uint8Array([1, 2, 3])
  let hubWrites = 0
  await assert.rejects(transferFile({
    read: async () => ({ size: payload.length, offset: 0, base64: Buffer.from(payload).toString('base64') }),
    readBytes: async () => ({ size: payload.length, offset: 0, bytes: payload }),
    writeBytes: async () => { throw Object.assign(new Error('quota exceeded'), { code: 'quota_exceeded' }) },
    write: async () => { hubWrites += 1; return { offset: payload.length, complete: true } },
    source: 'C:\\source.bin', destination: 'D:\\target.bin'
  }), (error) => error.code === 'quota_exceeded')
  assert.equal(hubWrites, 0, 'an application error cannot silently use the base64 route')
})

test('unavailable direct transports still fall back to Hub chunk transfer', async () => {
  const payload = Buffer.from('fallback bytes')
  const w = world(payload)
  const result = await transferFile({
    readBytes: async () => null,
    read: w.read,
    writeBytes: async () => null,
    write: w.write,
    status: w.status,
    source: 'C:\\source.bin', destination: 'D:\\target.bin', overwrite: true
  })
  assert.equal(result.bytes, payload.length)
  assert.deepEqual(w.written, payload)
})

test('croc transfer sends a one-time code, polls, then finishes by name', async () => {
  const calls = []
  const result = await transferFileCroc({
    source: 'C:\\source.bin', destination: 'D:\\target', name: 'renamed.bin',
    send: async (args) => { calls.push(['send', args]) },
    receive: async (args) => { calls.push(['receive', args]) },
    status: async () => ({ state: 'completed', percent: 100, speed: 1024 }),
    finish: async (args) => { calls.push(['finish', args]); return { path: 'D:\\target\\renamed.bin', bytes: 9 } },
    cancel: async () => {}, cancelSend: async () => {}, onProgress: () => {}
  })
  assert.equal(result.bytes, 9)
  assert.equal(calls[0][0], 'send')
  assert.match(calls[0][1].code, /^tether-/)
  assert.equal(calls[1][0], 'receive')
  assert.equal(calls[1][1].transfer_id, result.transferId)
  assert.equal(calls[2][0], 'finish')
  assert.equal(calls[2][1].name, 'renamed.bin')
})

test('OAuth Croc relay checks capability, publishes only its receive ID, and confirms cleanup before chunk fallback', async () => {
  for (const outcome of ['completed', 'unsupported', 'dial', 'cancel-unconfirmed', 'wrong-id', 'permission', 'finish-uncertain']) {
    const calls = []
    const progress = []
    let receiveId
    let starts = 0
    let polls = 0
    const sourceId = 'c04c000000000001'
    const options = {
      post: async (device, op, args) => {
        calls.push({ device, op, args })
        if (op === 'transfer_info') {
          if (outcome === 'permission' && device === 'target') {
            throw Object.assign(new Error('需要设备所有者权限'), { code: 'device_owner_required' })
          }
          return { available: true, relay: true, cancel_by_transfer_id: true, verify_sha256_before_finish: true,
            finish_by_transfer_id: outcome !== 'unsupported' }
        }
        if (op === 'transfer_send') return { engine: 'croc', direction: 'send', transfer_id: sourceId, sha256: 'f'.repeat(64) }
        if (op === 'transfer_receive') {
          receiveId = args.transfer_id
          assert.equal(args.code, calls.find((call) => call.op === 'transfer_send').args.code)
          return { engine: 'croc', direction: 'receive', transfer_id: receiveId }
        }
        if (op === 'transfer_status') {
          const state = { direction: 'receive', transfer_id: receiveId, percent: 0, progress_seq: 0, speed: 0 }
          if (outcome === 'wrong-id') return { ...state, transfer_id: 'different-id', state: 'completed' }
          if (outcome === 'dial' || outcome === 'cancel-unconfirmed') return { ...state, state: 'failed',
            error: 'comm.NewConnection failed: dial tcp relay:9009: i/o timeout' }
          return ++polls === 1 && outcome === 'completed'
            ? { ...state, state: 'running', percent: 37, progress_seq: 1, speed: 672 }
            : { ...state, state: 'completed', percent: 100 }
        }
        if (op === 'transfer_finish') {
          assert.deepEqual(args, { transfer_id: receiveId, name: 'file.bin', overwrite: false, expected_sha256: 'f'.repeat(64) })
          if (outcome === 'finish-uncertain') {
            throw Object.assign(new Error('the network did not confirm publication'), { code: 'node_timeout' })
          }
          return { path: '/target/file.bin', bytes: 128, engine: 'croc' }
        }
        assert.equal(op, 'transfer_cancel')
        const direction = device === 'target' ? 'receive' : 'send'
        assert.equal(args.transfer_id, direction === 'receive' ? receiveId : sourceId)
        if (outcome === 'cancel-unconfirmed' && direction === 'receive') {
          return { engine: 'croc', state: 'unchanged', cancelled: false }
        }
        return { engine: 'croc', state: 'cancelled', direction, percent: 0, progress_seq: 0 }
      },
      sourceDevice: 'source', targetDevice: 'target', source: 'C:/source/file.bin',
      destination: '/target', name: 'file.bin',
      onStart: () => { starts += 1 }, onProgress: (value) => progress.push(value)
    }
    if (outcome === 'completed') {
      const result = await transferCrocViaHub(options)
      assert.deepEqual(result, { path: '/target/file.bin', transferId: receiveId, bytes: 128 })
      assert.deepEqual(progress.map(({ percent, speed }) => [percent, speed]), [[37, 672], [100, 0]])
    } else if (outcome === 'unsupported' || outcome === 'dial') {
      assert.equal(await transferCrocViaHub(options), null)
    } else {
      const code = { 'cancel-unconfirmed': 'croc_failed', 'wrong-id': 'croc_protocol_error',
        permission: 'device_owner_required', 'finish-uncertain': 'node_timeout' }[outcome]
      await assert.rejects(transferCrocViaHub(options), { code })
    }
    assert.equal(starts, ['unsupported', 'permission'].includes(outcome) ? 0 : 1)
    assert.equal(calls.filter(({ op }) => op === 'transfer_finish').length,
      ['completed', 'finish-uncertain'].includes(outcome) ? 1 : 0)
    assert.equal(calls.filter(({ op }) => op === 'transfer_cancel').length,
      ['dial', 'cancel-unconfirmed', 'wrong-id', 'finish-uncertain'].includes(outcome) ? 2 : 0)
  }
})

test('croc timeout is bounded and skips unsafe legacy cancellation', async () => {
  const realNow = Date.now
  let now = 0
  Date.now = () => { now += 30_000; return now }
  let receiveCancels = 0
  let sendCancels = 0
  try {
    await assert.rejects(transferFileCroc({
      source: 'source', destination: 'destination',
      send: async () => ({ transfer_id: 'send-owned' }),
      receive: async () => ({ transfer_id: 'receive-owned' }),
      status: async () => ({ state: 'running', percent: 0 }),
      finish: async () => ({}),
      cancel: async () => { receiveCancels += 1 },
      cancelSend: async () => { sendCancels += 1 }
    }), (error) => error.code === 'croc_timeout')
  } finally {
    Date.now = realNow
  }
  assert.equal(receiveCancels, 0)
  assert.equal(sendCancels, 0)
})

test('croc timeout cancels only owned send and receive ids when supported', async () => {
  const realNow = Date.now
  let now = 0
  Date.now = () => { now += 30_000; return now }
  const cancelled = []
  try {
    await assert.rejects(transferFileCroc({
      source: 'source', destination: 'destination', transferId: 'receive-owned', cancelByTransferId: true,
      send: async () => ({ transfer_id: 'send-owned' }),
      receive: async () => ({ transfer_id: 'receive-owned' }),
      status: async () => ({ state: 'running', percent: 0 }),
      finish: async () => ({}),
      cancel: async (args) => { cancelled.push(['receive', args.transfer_id]) },
      cancelSend: async (args) => { cancelled.push(['send', args.transfer_id]) }
    }), (error) => error.code === 'croc_timeout')
  } finally {
    Date.now = realNow
  }
  assert.deepEqual(cancelled.sort(), [['receive', 'receive-owned'], ['send', 'send-owned']])
})

test('croc activity sequence prevents timeout during large transfers below one percent', async () => {
  const realNow = Date.now
  let now = 0
  let polls = 0
  Date.now = () => { now += 30_000; return now }
  try {
    const result = await transferFileCroc({
      source: 'source', destination: 'destination',
      send: async () => ({ transfer_id: 'send-owned' }),
      receive: async () => ({ transfer_id: 'receive-owned' }),
      status: async () => {
        polls += 1
        return { state: polls >= 3 ? 'completed' : 'running', percent: 0, progress_seq: polls }
      },
      finish: async () => ({ path: 'destination', bytes: 64 * 1024 ** 3 }),
      cancel: async () => {}, cancelSend: async () => {}
    })
    assert.equal(result.bytes, 64 * 1024 ** 3)
    assert.equal(polls, 3)
  } finally {
    Date.now = realNow
  }
})

test('an empty file creates a finished empty destination', async () => {
  const w = world(Buffer.alloc(0))
  const result = await transferFile({
    read: w.read, write: w.write, status: w.status, source: 'C:\\empty', destination: 'D:\\empty', overwrite: true
  })
  assert.equal(result.bytes, 0)
  assert.equal(w.writes.length, 1)
  assert.equal(w.writes[0].final, true)
  assert.equal(newTransferId().length, 16)
})

test('native transfer job starts once, polls the target, and reports byte progress', async () => {
  const calls = []
  const progress = []
  const result = await transferNativeJob({
    post: async (device, operation, body) => {
      calls.push({ device, operation, body })
      if (operation === 'transfer_job_status') return calls.filter((call) => call.operation === operation).length === 1
        ? { state: 'running', bytes_done: 25, bytes_total: 100 }
        : { state: 'completed', bytes_done: 100, bytes_total: 100 }
      return { state: 'queued' }
    },
    source: { device_id: 'source', path: 'C:\\source\\' },
    destination: { device_id: 'target', path: 'D:\\target\\' },
    items: ['file.bin'],
    onProgress: (value) => progress.push(value)
  })
  assert.equal(calls[0].operation, 'transfer_job_start')
  assert.deepEqual(calls[0].body.items, [{ kind: 'file', path: 'file.bin' }])
  assert.ok(calls.every((call) => call.device === 'target'))
  assert.ok(calls.every((call) => call.body.operation_id === result.operationId))
  assert.equal(progress[0].percent, 25)
  assert.equal(result.bytes, 100)
})

test('native copies can use Hub relay only after the zero-byte job is confirmed cancelled', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'setTimeout', (resolve) => resolve())
  const running = { state: 'running', bytes_done: 0, bytes_total: 8, files_done: 0 }
  const cancelled = { ...running, state: 'cancelled' }
  const networkFailure = { ...running, state: 'failed', error: { code: 'source_connection_failed' } }
  const scenarios = [
    { statuses: [running, running, { ...running, state: 'cancelling' }, cancelled], useRelay: true, cancel: true },
    { statuses: [running, running, { ...cancelled, files_done: 1 }], error: 'cancelled', cancel: true },
    { statuses: [running, running, { ...running, state: 'cancelling' }], error: 'native_job_unconfirmed',
      cancel: true, cancelDelay: 30_000 },
    { statuses: [running, { ...running, bytes_done: 1 }, running, cancelled], error: 'cancelled' },
    { statuses: [running, { ...running, state: 'verifying' }, running, cancelled], error: 'cancelled' },
    { statuses: [running, { ...running, state: 'failed', error: { code: 'conflict', message: '目标已存在' } }],
      error: 'failed', message: '目标已存在' },
    { statuses: [running, { ...running, state: 'failed', error: { code: 'permission_denied', message: '写入权限已撤销' } }],
      error: 'failed', message: '写入权限已撤销' },
    { statuses: [networkFailure], useRelay: true, failedWithoutCancel: true },
    { statuses: [{ ...networkFailure, error: { code: 'network_not_connected' } }], useRelay: true, failedWithoutCancel: true },
    { statuses: [{ ...networkFailure, error: { code: 'rclone_stat_wait_timeout' } }], error: 'failed' },
    { statuses: [{ ...running, bytes_done: 1 }, networkFailure], error: 'failed' },
    { statuses: [running, running, { ...running, state: 'completed', bytes_done: 8, files_done: 1 }],
      cancel: true, bytes: 8 },
    { statuses: [running, running, { ...running, state: 'cancelling' }, cancelled], items: ['file.bin', 'other.bin'],
      useRelay: true, cancel: true }
  ]
  for (const { statuses, useRelay, failedWithoutCancel, cancel, error, message, items, bytes, cancelDelay = 1_000 } of scenarios) {
    const calls = []
    let stopping = false
    const post = async (_device, operation, body) => {
      calls.push([operation, body.operation_id])
      if (operation === 'transfer_job_status') {
        assert.ok(statuses.length, 'unexpected extra native status request')
        now += stopping ? cancelDelay : 20_000
        return statuses.shift()
      }
      stopping = operation === 'transfer_job_cancel'
      return { state: stopping ? 'cancelling' : 'queued' }
    }
    const copy = transferNativeJob({
      post, source: { device_id: 'source', path: 'C:/source' },
      destination: { device_id: 'target', path: '/target' }, items: items || ['file.bin'],
      allowRelay: true
    })
    if (useRelay) {
      assert.deepEqual(await copy, { operationId: calls[0][1], useRelay: true })
      assert.deepEqual(calls.map(([operation]) => operation), failedWithoutCancel ? [
        'transfer_job_start', 'transfer_job_status'
      ] : [
        'transfer_job_start', 'transfer_job_status', 'transfer_job_status', 'transfer_job_cancel',
        'transfer_job_status', 'transfer_job_status'
      ])
    } else if (error) {
      await assert.rejects(copy, { code: error, ...(message ? { message } : {}) })
    } else {
      assert.deepEqual(await copy, { operationId: calls[0][1], bytes })
    }
    assert.equal(calls.filter(([operation]) => operation === 'transfer_job_cancel').length, cancel ? 1 : 0)
    assert.ok(calls.every(([, operationId]) => operationId === calls[0][1]))
  }
})

test('first native single-file copy allows 20 seconds for actual byte progress', async (t) => {
  let now = 1
  let polls = 0
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'setTimeout', (resolve) => resolve())
  const result = await transferNativeJob({
    source: { device_id: 'source', path: 'C:/source' },
    destination: { device_id: 'target', path: '/target' },
    items: ['sample.bin'], allowRelay: true,
    post: async (_target, operation) => {
      if (operation === 'transfer_job_start') return { state: 'queued' }
      assert.equal(operation, 'transfer_job_status')
      polls += 1
      now = [1, 20_000, 20_001][polls - 1]
      return { state: polls === 3 ? 'completed' : 'running', bytes_total: 8,
        bytes_done: polls === 3 ? 8 : 0, files_done: polls === 3 ? 1 : 0 }
    }
  })
  assert.equal(result.bytes, 8)
  assert.equal(polls, 3)
})

test('native copy routing matches Hub edge responses in both directions', () => {
  const edge = { from: 'fixture-source', to: 'fixture-target', mode: 'native' }
  assert.equal(hasNativeTransferEdge({ edges: [edge] }, edge.from, edge.to), true)
  assert.equal(hasNativeTransferEdge({ edges: [edge] }, edge.to, edge.from), true)
  assert.equal(hasNativeTransferEdge({ edges: [{ ...edge, mode: 'relay' }] }, edge.from, edge.to), false)
  assert.equal(hasNativeTransferEdge({ edges: [edge] }, edge.from, 'other-device'), false)
})

test('native copy sends same-directory multiselection in one job and preserves conflict and move routing', async () => {
  const selected = [
    { name: 'one.bin', path: '/source/one.bin' },
    { name: '二.bin', path: '/source/二.bin' }
  ]
  const target = { device: 'target', path: 'D:\\target', entries: [] }
  const batch = selectNativeCopyBatch({ items: selected, target })
  assert.deepEqual(batch, { path: '/source/', names: ['one.bin', '二.bin'] })
  assert.equal(selectNativeCopyBatch({ items: selected, target, cut: true }), null)
  assert.equal(selectNativeCopyBatch({ items: [
    selected[0], { ...selected[1], dir: true }
  ], target }), null)
  assert.equal(selectNativeCopyBatch({ items: [
    selected[0], { ...selected[1], path: '/another/二.bin' }
  ], target }), null)
  assert.equal(selectNativeCopyBatch({ items: selected, target: {
    ...target, entries: [{ name: 'ONE.BIN' }]
  } }), null)

  const calls = []
  const progress = []
  const result = await transferNativeJob({
    post: async (device, operation, body) => {
      calls.push({ device, operation, body })
      return operation === 'transfer_job_start'
        ? { state: 'queued' } : { state: 'completed', bytes_done: 100, bytes_total: 100, files_done: 2 }
    },
    source: { device_id: 'source', path: batch.path },
    destination: { device_id: target.device, path: target.path },
    items: batch.names,
    onProgress: (value) => progress.push(value)
  })
  assert.deepEqual(calls, [
    { device: 'target', operation: 'transfer_job_start', body: {
      operation_id: result.operationId,
      source: { device_id: 'source', path: '/source/' },
      destination: { device_id: 'target', path: 'D:\\target' },
      items: [{ kind: 'file', path: 'one.bin' }, { kind: 'file', path: '二.bin' }],
      mode: 'copy', conflict_policy: 'fail'
    } },
    { device: 'target', operation: 'transfer_job_status', body: { operation_id: result.operationId } }
  ])
  assert.equal(result.bytes, 100)
  assert.deepEqual(progress, [{ transferred: 100, total: 100, percent: 100, filesDone: 2 }])
})

test('native transfer cancellation during start cancels only its operation id', async () => {
  const controller = new AbortController()
  const calls = []
  const transfer = transferNativeJob({
    post: async (device, operation, body) => {
      calls.push({ device, operation, body })
      if (operation === 'transfer_job_start') {
        controller.abort()
        throw Object.assign(new Error('request aborted'), { name: 'AbortError' })
      }
      return { state: 'cancelled' }
    },
    source: { device_id: 'source', path: 'C:\\source\\' },
    destination: { device_id: 'target', path: 'D:\\target\\' },
    items: ['file.bin'],
    signal: controller.signal
  })
  await assert.rejects(transfer, { code: 'aborted' })
  assert.equal(calls[1].operation, 'transfer_job_cancel')
  assert.equal(calls[1].body.operation_id, calls[0].body.operation_id)
  assert.equal(calls.length, 2)
})

test('native status survives offline and Electron fetch failures using the original job', async () => {
  const calls = []
  const connection = []
  const statuses = [
    { state: 'running', bytes_done: 25, bytes_total: 100 },
    Object.assign(new Error('device offline: target'), { status: 409 }),
    new Error("Error invoking remote method 'tether:hub-request': TypeError: fetch failed"),
    { state: 'completed', bytes_done: 100, bytes_total: 100 }
  ]
  const result = await transferNativeJob({
    post: async (device, operation, body) => {
      calls.push({ device, operation, operationId: body.operation_id })
      if (operation === 'transfer_job_start') return { state: 'queued' }
      const value = statuses.shift()
      if (value instanceof Error) throw value
      return value
    },
    source: { device_id: 'source', path: 'C:/source' },
    destination: { device_id: 'target', path: 'D:/target' },
    items: ['file.bin'],
    onReconnecting: (value) => connection.push(value)
  })
  assert.equal(result.bytes, 100)
  assert.deepEqual(connection, [true, false])
  assert.deepEqual(calls.map((call) => call.operation), [
    'transfer_job_start', 'transfer_job_status', 'transfer_job_status', 'transfer_job_status', 'transfer_job_status'
  ])
  assert.ok(calls.every((call) => call.device === 'target' && call.operationId === result.operationId))
})

test('native status can resume after reconnect expires and stops on a terminal job state', async (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const calls = []
  let offline = true
  const parameters = {
    post: async (_device, operation, body) => {
      calls.push([operation, body.operation_id])
      if (operation === 'transfer_job_start') return { state: 'queued' }
      now += 30_000
      if (offline) throw Object.assign(new Error('device offline'), { status: 409, code: 'device_offline' })
      return { state: 'failed', error: { message: '目标已存在同名文件' } }
    },
    source: { device_id: 'source', path: 'C:/source' },
    destination: { device_id: 'target', path: 'D:/target' },
    items: ['file.bin']
  }
  const transfer = transferNativeJob(parameters)
  await assert.rejects(transfer, {
    code: 'native_job_unconfirmed', operationId: calls[0][1]
  })
  offline = false
  await assert.rejects(transferNativeJob({ ...parameters, operationId: calls[0][1] }), {
    code: 'failed', message: '目标已存在同名文件'
  })
  assert.deepEqual(calls.map(([operation]) => operation), [
    'transfer_job_start', 'transfer_job_status', 'transfer_job_status', 'transfer_job_status'
  ])
  assert.ok(calls.every(([, operationId]) => operationId === calls[0][1]))
})

test('native edges accept the current and legacy Hub field names', () => {
  assert.equal(hasNativeTransferEdge({ edges: [{ mode: 'native', from_device: 'a', to_device: 'b' }] }, 'b', 'a'), true)
  assert.equal(hasNativeTransferEdge({ edges: [{ mode: 'relay', from: 'a', to: 'b' }] }, 'a', 'b'), false)
})

test('an older Hub without the Croc capability endpoint falls back before starting a job', async () => {
  const calls = []
  const result = await transferCrocViaHub({
    sourceDevice: 'a', targetDevice: 'b',
    post: async (device, op) => {
      calls.push([device, op])
      throw Object.assign(new Error('not available'), { status: 404 })
    }
  })
  assert.equal(result, null)
  assert.deepEqual(calls, [['a', 'transfer_info'], ['b', 'transfer_info']])
})

async function nativeOutcome(job, { items = ['one.bin', 'two.bin'], startError } = {}) {
  const calls = []
  let operationId = null
  try {
    const result = await transferNativeJob({
      post: async (_device, operation, body) => {
        calls.push(operation)
        operationId = body.operation_id
        if (operation === 'transfer_job_start') {
          if (startError) throw startError
          return { state: 'queued' }
        }
        return typeof job === 'function' ? job() : job
      },
      source: { device_id: 'source', path: '/source' },
      destination: { device_id: 'target', path: '/target' },
      items,
      allowRelay: true
    })
    return { result, calls, operationId }
  } catch (error) {
    return { error, calls, operationId }
  }
}

test('multi-file native jobs fall back on route failures only with a safe no-write proof', async () => {
  for (const code of ['network_not_connected', 'source_connection_failed']) {
    const safe = await nativeOutcome({ state: 'failed', bytes_done: 0, files_done: 0, fallback_safe: true, error: { code } })
    assert.equal(safe.result?.useRelay, true, code + ' should relay when the node proves no write')
    assert.equal(safe.result?.operationId, safe.operationId)

    const legacy = await nativeOutcome({ state: 'failed', bytes_done: 0, files_done: 0, error: { code } })
    assert.equal(legacy.result?.useRelay, true, code + ' should relay for a legacy node that confirmed zero')

    const unsafe = await nativeOutcome({ state: 'failed', bytes_done: 0, files_done: 0, fallback_safe: false, error: { code } })
    assert.equal(unsafe.error?.code, 'failed', code + ' must not relay without cleanup proof')

    const wrote = await nativeOutcome({ state: 'failed', bytes_done: 0, files_done: 0, write_started: true,
      fallback_safe: true, error: { code } })
    assert.equal(wrote.error?.code, 'failed', code + ' must not relay after a write started')

    const progressed = await nativeOutcome({ state: 'failed', bytes_done: 1, files_done: 0, fallback_safe: true, error: { code } })
    assert.equal(progressed.error?.code, 'failed', code + ' must not relay once bytes were transferred')
  }
})

test('a 0-byte native job falls back only when the node proves nothing was written', async () => {
  const failed = (extra) => ({ state: 'failed', bytes_done: 0, files_done: 0, ...extra,
    error: { code: 'source_connection_failed' } })
  const safe = await nativeOutcome(failed({ fallback_safe: true }), { items: ['empty.bin'] })
  assert.equal(safe.result?.useRelay, true)
  const legacy = await nativeOutcome(failed({}), { items: ['empty.bin'] })
  assert.equal(legacy.result?.useRelay, true)
  const noProof = await nativeOutcome(failed({ fallback_safe: false }), { items: ['empty.bin'] })
  assert.equal(noProof.error?.code, 'failed')
  const wrote = await nativeOutcome(failed({ fallback_safe: true, write_started: true }), { items: ['empty.bin'] })
  assert.equal(wrote.error?.code, 'failed')
  const wroteLegacy = await nativeOutcome(failed({ write_started: true }), { items: ['empty.bin'] })
  assert.equal(wroteLegacy.error?.code, 'failed')
})

test('an unaccepted transfer_job_start falls back to relay without cancelling the job', async () => {
  const cases = [
    [{ code: 'bad_op' }, true],
    [{ status: 405 }, true],
    [{ status: 501 }, true],
    [{ status: 404, code: 'bad_op' }, true],
    [{ status: 404, code: 'unsupported_operation' }, true],
    [{ status: 404, code: 'unknown_operation' }, true],
    [{ status: 404, message: 'unknown op: transfer_job_start' }, true],
    [{ status: 404, code: 'not_found', message: 'source file not found' }, false],
    [{ status: 404, code: 'device_not_found' }, false],
    [{ code: 'denied' }, false],
    [{ code: 'exists' }, false],
    [{ code: 'conflict' }, false],
    [{ code: 'node_timeout' }, false],
    [{ status: 502 }, false],
    [{ status: 503 }, false],
    [{ status: 504 }, false],
    [{}, false]
  ]
  for (const [fields, unaccepted] of cases) {
    const error = Object.assign(new Error(fields.message || 'start rejected'), fields)
    const outcome = await nativeOutcome(null, { startError: error })
    if (unaccepted) {
      assert.equal(outcome.result?.useRelay, true, JSON.stringify(fields) + ' should be treated as unaccepted')
      assert.equal(outcome.result?.unaccepted, true)
    } else {
      assert.equal(outcome.error, error, JSON.stringify(fields) + ' must rethrow unchanged')
    }
    assert.equal(outcome.calls.filter((op) => op === 'transfer_job_cancel').length, 0)
  }
})
