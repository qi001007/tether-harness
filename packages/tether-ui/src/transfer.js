export const TRANSFER_CHUNK = 4 * 1024 * 1024
const CROC_HANDSHAKE_TIMEOUT = 25_000
const CROC_STALL_TIMEOUT = 45_000

function base64Bytes(value) {
  if (!value) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function failure(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function isAbort(error, signal) {
  return Boolean(signal && signal.aborted) || !!(error && (error.code === 'aborted' || error.name === 'AbortError'))
}

export function newTransferId() {
  const bytes = new Uint8Array(8)
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function newTransferCode() {
  return 'tether-' + newTransferId()
}

export async function transferFileCroc({
  send, receive, status, finish, cancel, cancelSend,
  source, destination, name, transferId, overwrite = false, onProgress = () => {}, signal,
  cancelByTransferId = false
}) {
  const id = transferId || newTransferId()
  const code = newTransferCode()
  let sendStarted = false
  let receiveStarted = false
  let sendTransferId = ''
  let timedOut = false
  try {
    const sender = await send({ path: source, code, transfers: 8 })
    sendTransferId = String(sender && sender.transfer_id || '')
    sendStarted = true
    if (cancelByTransferId && !sendTransferId) throw failure('发送端未返回任务标识', 'croc_protocol_error')
    const receiver = await receive({ path: destination, code, transfer_id: id })
    receiveStarted = true
    if (cancelByTransferId && receiver && receiver.transfer_id !== id) {
      throw failure('接收端传输标识不匹配', 'croc_protocol_error')
    }
    const startedAt = Date.now()
    let lastProgressAt = startedAt
    let lastPercent = 0
    let lastProgressSeq = null
    let legacyActivityAmbiguous = false
    let hasFreshActivity = false
    while (true) {
      if (signal && signal.aborted) throw failure('传输已取消', 'aborted')
      let state
      let statusTimer
      try {
        state = await Promise.race([
          status({ transfer_id: id }),
          new Promise((_, reject) => {
            statusTimer = setTimeout(() => reject(failure('Croc 状态查询超时', 'croc_timeout')), CROC_STALL_TIMEOUT)
          })
        ])
      } catch (error) {
        if (error && error.code === 'croc_timeout') timedOut = true
        throw error
      } finally {
        clearTimeout(statusTimer)
      }
      const percent = Math.max(0, Math.min(100, Number(state && state.percent) || 0))
      onProgress({ transferred: 0, total: 0, percent, speed: Number(state && state.speed) || 0 })
      if (state && state.state === 'completed') break
      if (state && (state.state === 'failed' || state.state === 'cancelled')) {
        throw failure((state && state.error) || '传输失败', 'croc_failed')
      }
      const now = Date.now()
      const progressSeq = Number(state && state.progress_seq)
      const hasProgressSeq = Number.isSafeInteger(progressSeq) && progressSeq >= 0
      if (hasProgressSeq) {
        if (lastProgressSeq === null ? progressSeq > 0 : progressSeq > lastProgressSeq) {
          lastProgressAt = now
          hasFreshActivity = true
        }
        lastProgressSeq = Math.max(lastProgressSeq === null ? 0 : lastProgressSeq, progressSeq)
      } else if (Number(state && state.speed) > 0) {
        // A legacy node exposes only a cached speed value; treat it as ambiguous
        // activity and preserve its previous unbounded behavior rather than fail a moving large transfer.
        legacyActivityAmbiguous = true
      }
      if (percent > lastPercent) {
        lastPercent = percent
        lastProgressAt = now
        hasFreshActivity = true
      }
      if (!legacyActivityAmbiguous && now - (hasFreshActivity ? lastProgressAt : startedAt)
          >= (hasFreshActivity ? CROC_STALL_TIMEOUT : CROC_HANDSHAKE_TIMEOUT)) {
        timedOut = true
        throw failure(hasFreshActivity ? 'Croc 传输停滞，已超时' : 'Croc 连接未取得进展，已超时', 'croc_timeout')
      }
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    const result = await finish({ transfer_id: id, overwrite: !!overwrite, name })
    return { path: result.path, transferId: id, bytes: Number(result.bytes) || 0 }
  } catch (error) {
    const cleanups = []
    if (timedOut && !cancelByTransferId) {
      // Older nodes ignore transfer IDs and cancel whichever job is current.
    } else {
      if (receiveStarted) cleanups.push(cancel({ transfer_id: id }))
      if (sendStarted && (!cancelByTransferId || sendTransferId)) cleanups.push(cancelSend(cancelByTransferId ? { transfer_id: sendTransferId } : {}))
    }
    await Promise.allSettled(cleanups)
    throw error
  }
}

export async function transferFile({
  read, write, readBytes, writeBytes, status, cancel, source, destination,
  transferId, overwrite = false, resume = true, onProgress = () => {}, signal
}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new Error('transfer requires read and write functions')
  }
  if (!source || !destination) throw new Error('source and destination are required')
  const id = transferId || newTransferId()
  let offset = 0
  let partial = false
  let pending = null
  try {
    if (isAbort(null, signal)) throw failure('传输已取消', 'aborted')
    try {
      const state = await status({ path: destination, transferId: id, signal })
      if (state && state.exists && !overwrite) throw failure('目标设备上已存在同名文件', 'exists')
      if (resume && state && Number.isSafeInteger(state.offset) && state.offset > 0) {
        offset = state.offset
        partial = Boolean(state.partial)
      }
    } catch (error) {
      if (isAbort(error, signal)) throw failure('传输已取消', 'aborted')
      if (error && error.code === 'exists') throw error
    }
    let total = null
    const report = (value) => {
      const transferred = Math.max(0, Number(value) || 0)
      onProgress({
        transferred,
        total: total || 0,
        percent: total ? Math.min(100, Math.round(transferred / total * 100)) : (total === 0 ? 100 : 0)
      })
    }
    if (partial && offset > 0) report(offset)
    const readChunk = async (at) => {
      let chunk = null
      let binary = false
      const limit = total === null ? TRANSFER_CHUNK : Math.min(TRANSFER_CHUNK, Math.max(0, total - at))
      if (limit === 0) return { chunk: { size: total, offset: at, base64: '' }, binary: false }
      if (typeof readBytes === 'function') {
        chunk = await readBytes({ path: source, offset: at, limit, signal })
        binary = !!chunk && chunk.bytes instanceof Uint8Array
      }
      if (!binary) chunk = await read({ path: source, offset: at, limit, signal })
      return { chunk, binary }
    }
    pending = readChunk(offset)
    while (true) {
      if (isAbort(null, signal)) throw failure('传输已取消', 'aborted')
      const current = await pending
      pending = null
      const chunk = current.chunk
      const binary = current.binary
      if (!chunk) throw failure('读取源文件失败', 'read_failed')
      const size = Number(chunk.size)
      if (!Number.isSafeInteger(size) || size < 0) throw failure('源文件大小无效', 'read_failed')
      if (total === null) total = size
      else if (size !== total) throw failure('源文件在传输过程中发生变化', 'source_changed')
      if (chunk.offset !== undefined && Number(chunk.offset) !== offset) {
        throw failure('源文件读取偏移不一致', 'source_changed')
      }
      const bytes = binary ? chunk.bytes.length : base64Bytes(chunk.base64)
      if (!bytes && offset < total) throw failure('源文件读取到空数据', 'read_failed')
      if (offset + bytes > total) throw failure('源文件返回的数据超出声明大小', 'source_changed')
      const final = offset + bytes >= total
      const expected = offset + bytes
      if (!final) { pending = readChunk(expected); pending.catch(() => {}) }
      let result = null
      if (binary && typeof writeBytes === 'function') {
        result = await writeBytes({
          path: destination, transferId: id, offset, total, bytes: chunk.bytes,
          final, overwrite, resume: offset > 0, signal
        })
      }
      if (!result) {
        const encoded = binary ? bytesToBase64(chunk.bytes) : chunk.base64
        result = await write({
          path: destination, transferId: id, offset, total, base64: encoded,
          final, overwrite, resume: offset > 0, signal
        })
      }
      if (!result || !Number.isSafeInteger(result.offset) || result.offset < offset) {
        if (pending) pending.catch(() => {})
        throw failure('目标设备没有确认写入进度', 'write_failed')
      }
      offset = result.offset
      report(offset)
      if (result.complete === true || offset >= total) break
      if (pending && offset !== expected) {
        pending.catch(() => {})
        pending = readChunk(offset)
      } else if (!pending) {
        pending = readChunk(offset)
      }
    }
    if (total === 0) report(0)
    return { path: destination, transferId: id, bytes: offset }
  } catch (error) {
    if (pending) pending.catch(() => {})
    if (!isAbort(error, signal)) throw error
    if (typeof cancel === 'function') await Promise.resolve(cancel({ path: destination, transferId: id })).catch(() => {})
    throw failure('传输已取消', 'aborted')
  }
}
