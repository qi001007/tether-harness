import assert from 'node:assert/strict'
import test from 'node:test'

import { TRANSFER_CHUNK, newTransferId, transferFile, transferFileCroc } from '../packages/tether-ui/src/transfer.js'

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
