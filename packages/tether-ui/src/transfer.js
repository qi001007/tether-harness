export const TRANSFER_CHUNK = 4 * 1024 * 1024
const NATIVE_JOB_POLL_MS = 1000
const NATIVE_JOB_RECONNECT_MS = 30_000
const NATIVE_JOB_NO_PROGRESS_MS = 20_000
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

function isNativeJobConnectionError(error, target) {
  if (error?.code === 'device_offline' || error?.code === 'node_timeout') return true
  if (error?.code) return false
  if (error?.status === 409) return error.message === 'device offline: ' + target
  if (error?.status) return [502, 503, 504].includes(error.status)
  return /(?:failed to fetch|fetch failed|network error|net::ERR_[A-Z_]+)$/i.test(error?.message || '')
}

function nativeJobUnconfirmed(operationId, message) {
  return Object.assign(failure(message + '（任务号 ' + operationId + '）', 'native_job_unconfirmed'), { operationId })
}

export async function transferNativeJob({
  post, source, destination, items, signal, operationId,
  allowRelay = false, onProgress = () => {}, onReconnecting = () => {}
}) {
  let started = Boolean(operationId)
  let relayEligible = allowRelay && !started && items.length === 1
  let zeroSince = null
  let stopRequestedAt = null
  operationId = operationId || newTransferId()
  const target = destination.device_id
  const jobRequest = { operation_id: operationId }
  let reconnectSince = null
  try {
    signal?.throwIfAborted()
    if (!started) {
      started = true
      await post(target, 'transfer_job_start', {
        ...jobRequest,
        source: { device_id: source.device_id, path: source.path },
        destination: { device_id: target, path: destination.path },
        items: items.map((path) => ({ kind: 'file', path })),
        mode: 'copy',
        conflict_policy: 'fail'
      }, signal)
    }
    while (true) {
      signal?.throwIfAborted()
      let job
      try {
        job = await post(target, 'transfer_job_status', jobRequest, signal)
      } catch (error) {
        if (isAbort(error, signal) || !isNativeJobConnectionError(error, target)) throw error
        zeroSince = null
        const now = Date.now()
        if (reconnectSince === null) {
          reconnectSince = now
          onReconnecting(true)
        }
        if (now - (stopRequestedAt ?? reconnectSince) >= NATIVE_JOB_RECONNECT_MS) {
          throw nativeJobUnconfirmed(operationId, '暂时无法确认传输状态')
        }
        await new Promise((resolve) => setTimeout(resolve, NATIVE_JOB_POLL_MS))
        continue
      }
      signal?.throwIfAborted()
      if (reconnectSince !== null) {
        reconnectSince = null
        onReconnecting(false)
      }
      const bytesDone = Number(job && job.bytes_done) || 0
      const bytesTotal = Number(job && job.bytes_total) || 0
      const filesDone = Number(job && job.files_done) || 0
      const percent = bytesTotal ? Math.min(100, bytesDone / bytesTotal * 100) : 0
      const confirmedZero = job?.bytes_done === 0 && job?.files_done === 0
      if (bytesDone > 0 || filesDone > 0 || job?.state === 'verifying') relayEligible = false
      if (job && job.state === 'completed') {
        onProgress({ transferred: bytesDone, total: bytesTotal, percent: 100, filesDone })
        return { operationId, bytes: bytesDone }
      }
      if (stopRequestedAt !== null && relayEligible && job?.state === 'cancelled' && confirmedZero) {
        return { operationId, useRelay: true }
      }
      if (relayEligible && confirmedZero && job?.state === 'failed' &&
          ['network_not_connected', 'source_connection_failed'].includes(job.error?.code)) {
        return { operationId, useRelay: true }
      }
      if (job && ['failed', 'cancelled', 'interrupted', 'revocation_pending'].includes(job.state)) {
        throw failure(job.error && (job.error.message || job.error.code)
          || ('原生传输任务' + job.state), job.state)
      }
      const now = Date.now()
      if (stopRequestedAt !== null) {
        if (now - stopRequestedAt >= NATIVE_JOB_RECONNECT_MS) {
          throw nativeJobUnconfirmed(operationId, '取消未确认')
        }
      } else if (relayEligible && confirmedZero && job?.state === 'running' && bytesTotal > 0) {
        zeroSince ??= now
        if (now - zeroSince >= NATIVE_JOB_NO_PROGRESS_MS) {
          stopRequestedAt = now
          try {
            await post(target, 'transfer_job_cancel', jobRequest, signal)
          } catch (error) {
            if (isAbort(error, signal) || !isNativeJobConnectionError(error, target)) throw error
            throw nativeJobUnconfirmed(operationId, '取消未确认')
          }
        }
      } else {
        zeroSince = null
      }
      onProgress({ transferred: bytesDone, total: bytesTotal, percent, filesDone })
      await new Promise((resolve) => setTimeout(resolve, NATIVE_JOB_POLL_MS))
    }
  } catch (error) {
    if (isAbort(error, signal)) {
      if (started) {
        try {
          await post(target, 'transfer_job_cancel', jobRequest)
        } catch (cancelError) {
          if (cancelError?.code !== 'not_found') throw nativeJobUnconfirmed(operationId, '取消未确认')
        }
      }
      throw failure('传输已取消', 'aborted')
    }
    throw error
  }
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

const CROC_RECONNECT_MS = 30_000
const CROC_POLL_MS = 350

export async function transferFileCroc(options) {
  const result = await runCrocAttempt(options, true)
  if (!result?.retry) return result
  return runCrocAttempt({
    ...options, transferId: undefined, allowChunkFallback: false, expectedSourceSha256: result.sha256
  }, false)
}

async function runCrocAttempt({
  send, receive, status, finish, cancel, cancelSend,
  source, destination, name, transferId, overwrite = false, onProgress = () => {}, signal,
  targetDevice, cancelByTransferId = false, allowChunkFallback = false, retryFailed = false,
  verifySha256 = false, expectedSourceSha256, onReconnecting = () => {}
}, mayRetry) {
  const id = transferId || newTransferId()
  const code = newTransferCode()
  let sendStarted = false
  let receiveStarted = false
  let sendTransferId = ''
  let timedOut = false
  let handshakeFailed = false
  let retryableFailure = false
  let finishing = false
  let sourceSha256
  const verification = verifySha256 ? { verify_sha256: true } : {}
  try {
    signal?.throwIfAborted()
    const sender = await send({ path: source, code, transfers: 8, ...verification })
    sendTransferId = String(sender && sender.transfer_id || '')
    sendStarted = true
    if (cancelByTransferId && !sendTransferId) throw failure('发送端未返回任务标识', 'croc_protocol_error')
    if (verifySha256) {
      const sha256 = sender?.sha256
      if (typeof sha256 !== 'string' || sha256.length !== 64 || !/^[a-f\d]+$/i.test(sha256)) {
        throw failure('发送端未返回有效的 SHA-256 校验值', 'croc_protocol_error')
      }
      sourceSha256 = sha256.toLowerCase()
      if (expectedSourceSha256 && sourceSha256 !== expectedSourceSha256) {
        throw failure('源文件在 Croc 重传前已发生变化', 'source_changed')
      }
    }
    signal?.throwIfAborted()
    const receiver = await receive({ path: destination, code, transfer_id: id, ...verification })
    receiveStarted = true
    if (cancelByTransferId && (allowChunkFallback || receiver) && receiver?.transfer_id !== id) {
      throw failure('接收端传输标识不匹配', 'croc_protocol_error')
    }
    let startedAt = Date.now()
    let lastProgressAt = startedAt
    let lastPercent = 0
    let lastProgressSeq = null
    let legacyActivityAmbiguous = false
    let hasFreshActivity = false
    let reconnectUntil = null
    while (true) {
      signal?.throwIfAborted()
      let state
      let statusTimer
      try {
        state = await Promise.race([
          status({ transfer_id: id }),
          new Promise((_, reject) => {
            const timeout = reconnectUntil === null ? CROC_STALL_TIMEOUT : Math.max(0, reconnectUntil - Date.now())
            statusTimer = setTimeout(() => reject(failure('Croc 状态查询超时', 'croc_timeout')), timeout)
          })
        ])
      } catch (error) {
        if (!isAbort(error, signal) && cancelByTransferId &&
            (error?.code === 'croc_timeout' || isNativeJobConnectionError(error, targetDevice))) {
          const now = Date.now()
          if (reconnectUntil === null) {
            reconnectUntil = now + CROC_RECONNECT_MS
            onReconnecting(true)
          }
          if (now >= reconnectUntil) {
            throw failure('暂时无法确认 Croc 传输状态（任务号 ' + id + '）', 'croc_status_unconfirmed')
          }
          await new Promise((resolve) => setTimeout(resolve, CROC_POLL_MS))
          continue
        }
        if (error && error.code === 'croc_timeout') timedOut = true
        handshakeFailed = timedOut && !hasFreshActivity && !legacyActivityAmbiguous
        throw error
      } finally {
        clearTimeout(statusTimer)
      }
      signal?.throwIfAborted()
      if ((allowChunkFallback || retryFailed || reconnectUntil !== null) &&
          (state?.transfer_id !== id || state.direction !== 'receive')) {
        throw failure('接收端返回了其他 Croc 任务的状态', 'croc_protocol_error')
      }
      if (reconnectUntil !== null) {
        reconnectUntil = null
        startedAt = lastProgressAt = Date.now()
        onReconnecting(false)
      }
      const percent = Math.max(0, Math.min(100, Number(state && state.percent) || 0))
      onProgress({ transferred: 0, total: 0, percent, speed: Number(state && state.speed) || 0 })
      if (state && state.state === 'completed') break
      if (state && (state.state === 'failed' || state.state === 'cancelled')) {
        handshakeFailed = state.state === 'failed' && !hasFreshActivity && !legacyActivityAmbiguous
          && percent === 0 && state.progress_seq === 0 && !Number(state.speed)
          && /comm\.NewConnection failed:\s*dial tcp\b.*\bi\/o timeout\b/i.test(state.error || '')
        retryableFailure = mayRetry && retryFailed && cancelByTransferId && !overwrite && state.state === 'failed'
          && (hasFreshActivity || percent > 0 || state.progress_seq > 0)
          && !/permission denied|access (?:is )?denied|operation not permitted|read.only file system|(?:already )?exists/i.test(state.error || '')
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
        handshakeFailed = !hasFreshActivity
        throw failure(hasFreshActivity ? 'Croc 传输停滞，已超时' : 'Croc 连接未取得进展，已超时', 'croc_timeout')
      }
      await new Promise((resolve) => setTimeout(resolve, CROC_POLL_MS))
    }
    signal?.throwIfAborted()
    finishing = true
    const result = await finish({
      transfer_id: id, overwrite: !!overwrite, name,
      ...(verifySha256 ? { expected_sha256: sourceSha256 } : {})
    })
    return { path: result.path, transferId: id, bytes: Number(result.bytes) || 0 }
  } catch (error) {
    if (error?.code === 'croc_status_unconfirmed') throw error
    const cleanups = []
    if (timedOut && !cancelByTransferId) {
      // Older nodes ignore transfer IDs and cancel whichever job is current.
    } else {
      if (receiveStarted) cleanups.push(cancel({ transfer_id: id }))
      if (sendStarted && (!cancelByTransferId || sendTransferId)) cleanups.push(cancelSend(cancelByTransferId ? { transfer_id: sendTransferId } : {}))
    }
    const results = await Promise.allSettled(cleanups)
    if (isAbort(error, signal)) throw failure('传输已取消', 'aborted')
    const integrityMismatch = finishing && verifySha256 && error?.code === 'croc_integrity_mismatch'
    const retryIntegrity = mayRetry && retryFailed && cancelByTransferId && !overwrite && integrityMismatch
    if (results.length === 2 && (retryIntegrity || retryableFailure || (allowChunkFallback && handshakeFailed))) {
      const stopped = results.every(({ status, value }, index) => status === 'fulfilled' &&
        value?.engine === 'croc' && value.direction === (index === 0 ? 'receive' : 'send') &&
        ['failed', 'cancelled', 'completed'].includes(value.state) && value.cancelled !== false)
      if (stopped && (retryIntegrity || (retryableFailure && results[0].value.state !== 'completed'))) {
        return { retry: true, sha256: sourceSha256 }
      }
      if (stopped && allowChunkFallback && handshakeFailed && results.every(({ value }) => value.state !== 'completed' &&
          value.percent === 0 && value.progress_seq === 0)) return null
    }
    throw error
  }
}

export async function transferCrocViaHub({
  post, sourceDevice, targetDevice, source, destination, name, signal, onProgress, onStart, onReconnecting
}) {
  const info = (device) => post(device, 'transfer_info', {}, signal).catch((error) => {
    if (error?.code === 'bad_op' || [404, 405].includes(error?.status)) return null
    throw error
  })
  const [sender, receiver] = await Promise.all([info(sourceDevice), info(targetDevice)])
  if (![sender, receiver].every((peer) => peer?.available === true && peer.relay === true &&
      peer.cancel_by_transfer_id === true && peer.verify_sha256_before_finish === true) ||
      receiver.finish_by_transfer_id !== true) return null
  signal?.throwIfAborted()
  onStart()
  return transferFileCroc({
    source, destination, name, signal, targetDevice, onProgress, onReconnecting,
    cancelByTransferId: true, allowChunkFallback: true, retryFailed: true, verifySha256: true,
    send: (args) => post(sourceDevice, 'transfer_send', args),
    receive: (args) => post(targetDevice, 'transfer_receive', args),
    status: (args) => post(targetDevice, 'transfer_status', args),
    finish: (args) => post(targetDevice, 'transfer_finish', args),
    cancel: (args) => post(targetDevice, 'transfer_cancel', args),
    cancelSend: (args) => post(sourceDevice, 'transfer_cancel', args)
  })
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
