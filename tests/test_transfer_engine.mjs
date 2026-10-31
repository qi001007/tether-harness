import assert from 'node:assert/strict'
import test from 'node:test'

import { TRANSFER_CHUNK, newTransferId, transferFile } from '../packages/tether-ui/src/transfer.js'

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
