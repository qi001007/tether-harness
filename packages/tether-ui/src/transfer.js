export const TRANSFER_CHUNK = 256 * 1024

function base64Bytes(value) {
  if (!value) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

function failure(message, code) {
  const error = new Error(message)
  error.code = code
  return error
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

export async function transferFile({
  read, write, status, cancel, source, destination,
  transferId, overwrite = false, resume = true, onProgress = () => {}, signal
}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new Error('transfer requires read and write functions')
  }
  if (!source || !destination) throw new Error('source and destination are required')
  const id = transferId || newTransferId()
  let offset = 0
  let partial = false
  try {
    const state = await status({ path: destination, transferId: id })
    if (state && state.exists && !overwrite) throw failure('目标设备上已存在同名文件', 'exists')
    if (resume && state && Number.isSafeInteger(state.offset) && state.offset > 0) {
      offset = state.offset
      partial = Boolean(state.partial)
    }
  } catch (error) {
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
  while (true) {
    if (signal && signal.aborted) {
      if (typeof cancel === 'function') await cancel({ path: destination, transferId: id }).catch(() => {})
      throw failure('传输已取消', 'aborted')
    }
    const chunk = total !== null && offset >= total
      ? { size: total, offset, base64: '' }
      : await read({ path: source, offset, limit: TRANSFER_CHUNK })
    if (!chunk || typeof chunk.base64 !== 'string') throw failure('读取源文件失败', 'read_failed')
    const size = Number(chunk.size)
    if (!Number.isSafeInteger(size) || size < 0) throw failure('源文件大小无效', 'read_failed')
    if (total === null) total = size
    else if (size !== total) throw failure('源文件在传输过程中发生变化', 'source_changed')
    if (chunk.offset !== undefined && Number(chunk.offset) !== offset) {
      throw failure('源文件读取偏移不一致', 'source_changed')
    }
    const bytes = base64Bytes(chunk.base64)
    if (offset + bytes > total) throw failure('源文件返回的数据超出声明大小', 'source_changed')
    const final = offset + bytes >= total
    const result = await write({
      path: destination, transferId: id, offset, total, base64: chunk.base64,
      final, overwrite, resume: offset > 0
    })
    if (!result || !Number.isSafeInteger(result.offset) || result.offset < offset) {
      throw failure('目标设备没有确认写入进度', 'write_failed')
    }
    offset = result.offset
    report(offset)
    if (result.complete === true || offset >= total) break
  }
  if (total === 0) report(0)
  return { path: destination, transferId: id, bytes: offset }
}
