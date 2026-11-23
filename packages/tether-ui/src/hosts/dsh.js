import { TargetFileExplorer } from '../target-file-explorer.js'
import { TetherFolderPickDialog } from '../tether-folder-pick-dialog.js'
import { loadDirectory, peekDirectory } from '../file-cache.js'

export const DSH_API_BASE = 'http://127.0.0.1:18890'
export const DSH_APP_BASE = 'http://127.0.0.1:18892'

function storedHub() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const data = JSON.parse(window.localStorage.getItem('tether.hub') || 'null')
    if (data && typeof data.url === 'string' && typeof data.token === 'string' && data.url && data.token) return data
  } catch (_) { /* ignore malformed local config */ }
  return null
}

export function createDshLocalPluginUpdateBridge(getRpc) {
  return async (action, payload = {}) => {
    if (!['status', 'check', 'prepare', 'apply'].includes(action)) throw new Error('不支持的本机插件更新操作')
    const rpc = typeof getRpc === 'function' ? getRpc() : null
    if (!rpc || typeof rpc.call !== 'function') throw new Error('当前 DSH 插件没有本机更新通道，请先安装新版插件。')
    const hub = storedHub()
    let manifestUrl = hub ? hub.url.replace(/\/+$/, '') + '/releases/manifest' : ''
    if (!manifestUrl) {
      try {
        const response = await fetch(DSH_APP_BASE + '/app-context', { signal: AbortSignal.timeout(1500) })
        if (response.ok) {
          const context = await response.json()
          if (context && typeof context.serverUrl === 'string' && /^https?:\/\//.test(context.serverUrl)) {
            manifestUrl = context.serverUrl.replace(/\/+$/, '') + '/releases/manifest'
          }
        }
      } catch (_) { /* standalone plugin: fall back to the default manifest */ }
    }
    const body = action === 'apply' ? { prepared_id: payload.prepared_id } : {}
    let reply = await rpc.call('/tether-updates', action, manifestUrl ? { ...body, manifest_url: manifestUrl } : body)
    if (manifestUrl && reply && reply.ok === false && reply.error && reply.error.code === 'invalid_request') {
      reply = await rpc.call('/tether-updates', action, body)
    }
    if (reply && reply.ok === false) {
      const detail = reply.error && typeof reply.error === 'object' ? reply.error : {}
      const error = new Error(detail.message || reply.error || reply.message || '本机插件更新失败')
      error.code = detail.code || reply.error_code || reply.code
      throw error
    }
    const value = reply && (reply.value || reply.result)
    if (value && value.ok === false) {
      const error = new Error(value.error || value.message || '本机插件更新失败')
      error.code = value.error_code || value.code
      throw error
    }
    return value && typeof value === 'object' ? value : reply
  }
}

export function createDshLocalIdentityBridge(getRpc) {
  return async () => {
    const rpc = typeof getRpc === 'function' ? getRpc() : null
    if (!rpc || typeof rpc.call !== 'function') return null
    try {
      const reply = await rpc.call('/tether-identity', 'get', {})
      const value = reply && (reply.value || reply.result || reply)
      return value && typeof value.device_id === 'string' ? value.device_id : null
    } catch (_) { return null }
  }
}

export function createDshLocalPluginSurfaceReloadBridge(getRemote) {
  return async () => {
    const manager = (typeof getRemote === 'function' ? getRemote() : null)?.pluginManager
    if (!manager || typeof manager.listPlugins !== 'function' || typeof manager.setPluginEnabled !== 'function') {
      throw new Error('当前 DSH 没有本机插件重载通道')
    }
    let listed
    try { listed = await manager.listPlugins() } catch (_) { throw new Error('读取当前 DSH 插件清单失败') }
    if (!listed || listed.ok !== true || !Array.isArray(listed.value)) {
      throw new Error(listed?.error?.message || listed?.error || '读取当前 DSH 插件清单失败')
    }
    const matches = listed.value.filter(item => item && item.moduleName === 'tether-dsh-surface')
    if (matches.length !== 1) throw new Error('当前 DSH 中 tether-dsh-surface 插件不唯一，无法安全重载')
    const target = matches[0]
    if (target.enabled !== true || typeof target.entryId !== 'string' || !target.entryId) {
      throw new Error('当前 DSH 的 tether-dsh-surface 插件未启用，无法安全重载')
    }
    let changed
    try { changed = await manager.setPluginEnabled(target.entryId, true) }
    catch (_) { throw new Error('应用本机 DSH 插件重载失败') }
    if (!changed || changed.ok !== true || !changed.value || typeof changed.value.application !== 'string') {
      throw new Error(changed?.error?.message || changed?.error || 'DSH 插件重载没有返回有效状态')
    }
    return { application: changed.value.application }
  }
}

export function createDshPluginHotReloadWatch({
  getRpc, reloadSurface, storage = null, intervalMs = 2000, cooldownMs = 20000
} = {}) {
  let disposed = false
  let running = false
  let lastAttempt = 0
  const tick = async () => {
    if (disposed || running) return
    const rpc = typeof getRpc === 'function' ? getRpc() : null
    if (!rpc || typeof rpc.call !== 'function' || typeof reloadSurface !== 'function') return
    running = true
    try {
      const reply = await rpc.call('/tether-updates', 'status', {})
      const value = reply && (reply.value || reply.result)
      if (!value || value.ok === false || value.restart_required !== true) return
      const disk = value.disk_version
      const runtime = value.runtime_version
      if (typeof disk !== 'string' || typeof runtime !== 'string' || !disk || disk === runtime) return
      const now = Date.now()
      if (storage) {
        try {
          const key = 'tether-plugin-reload:' + disk
          const last = Number(storage.getItem(key) || 0)
          if (Number.isFinite(last) && now - last < cooldownMs) return
          storage.setItem(key, String(now))
        } catch (_) { /* private mode: attempt without a cross-page lock */ }
      }
      if (now - lastAttempt < 1000) return
      lastAttempt = now
      try { await reloadSurface() } catch (_) { /* the surface may be mid-reload; retry on the next tick */ }
    } catch (_) {
      /* DSH may be replacing the surface; the next tick retries */
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, Math.max(1000, intervalMs))
  void tick()
  return () => { disposed = true; clearInterval(timer) }
}

// Attachments have no size ceiling. The target node serves /read in slices of
// at most 4 MiB (tether/node/fs_service.py MAX_READ) and imposes no total cap,
// so 4 MiB is the whole slice size and slices are fetched six at a time,
// decoded straight into one preallocated buffer, and handed to the Composer as
// a single File with a single Blob copy.
export const DSH_TARGET_ATTACHMENT_CHUNK = 4 * 1024 * 1024
export const DSH_TARGET_ATTACHMENT_CONCURRENCY = 6
const DSH_TARGET_READ_ATTEMPTS = 3
const DSH_TARGET_READ_RETRY_DELAY = 250
// Local drops are written to the target through JSON /write_chunk bodies at
// the target node write ceiling (tether/node/fs_service.py MAX_WRITE_CHUNK); the
// browser streams one 4 MiB slice at a time, so a file of any size is saved
// without ever materialising it whole in memory.
const DSH_TARGET_WRITE_CHUNK = 4 * 1024 * 1024
// Each folder file becomes one Composer attachment and its own read series; the
// count cap only keeps a runaway folder from flooding the Composer. It is not a
// size policy - files of any size are accepted.
export const DSH_TARGET_FOLDER_LIMIT_FILES = 500
export const DSH_TARGET_DEVICE_TIMEOUT = 15_000
export const DSH_TARGET_SURFACE_PREFIX = '/tether-device-fs'

const TARGET_DEVICE_ERROR_MESSAGES = {
  device_offline: '目标电脑不可达或已离线，请稍后重试',
  device_not_found: '目标电脑不存在或已离线，请稍后重试',
  host_unreachable: '目标电脑不可达，请确认目标电脑在线后重试',
  local_unreachable: '目标电脑不可达，请确认目标电脑在线后重试',
  surface_timeout: '目标电脑响应超时，请稍后重试',
  node_update_required: '目标电脑的 Tether Node 版本过旧，无法浏览文件'
}

function loopbackHostname(value) {
  return value === '127.0.0.1' || value === 'localhost' || value === '[::1]' || value === '::1'
}

// The public surface page is served by the gateway at a non-loopback origin, and
// every request there must stay on that origin so the surface cookie applies.
// A loopback page is the local DSH direct fast path (the page itself is the DSH
// server), so its device files must go through the local node channel and never
// through the /tether-device-fs prefix only the gateway serves.
export function tetherNativeSurfaceOrigin() {
  if (typeof window === 'undefined' || !window.location) return ''
  const location = window.location
  const href = typeof location.href === 'string' ? location.href : ''
  if (href) {
    try {
      const parsed = new URL(href)
      if (loopbackHostname(parsed.hostname)) return ''
      return parsed.searchParams.has('tether_native') ? parsed.origin : ''
    } catch (_) { /* fall back to location.origin */ }
  }
  try {
    const origin = String(location.origin || '')
    if (!origin) return ''
    const parsed = new URL(origin)
    return loopbackHostname(parsed.hostname) ? '' : parsed.origin
  } catch (_) { return '' }
}

function targetFileType(name) {
  const extension = String(name || '').split('.').pop().toLowerCase()
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf'
  })[extension] || 'application/octet-stream'
}

function targetPathBase(value) {
  const clean = String(value || '').replace(/[\\/]+$/, '')
  const index = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  return index >= 0 ? (clean.slice(index + 1) || clean) : clean
}

function targetSafeFileName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+$/, 'file').slice(0, 180) || 'file'
}

function targetUniqueName(name, index) {
  if (index <= 1) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) + ' (' + index + ')' + name.slice(dot) : name + ' (' + index + ')'
}

function targetTransferId() {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch (_) {
    return (Date.now().toString(16) + Math.random().toString(16).slice(2) + '000000000000').slice(0, 24)
  }
}

function targetBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

// Decodes one base64 /read slice straight into the shared attachment buffer so
// a 4 MiB slice never materialises a second full-size Uint8Array.
function decodeTargetBase64Into(value, target, offset, length) {
  if (typeof value !== 'string') throw new Error('目标电脑返回的文件字节不完整')
  let binary
  if (typeof atob === 'function') binary = atob(value)
  else binary = globalThis.Buffer.from(value, 'base64').toString('binary')
  if (binary.length !== length) throw new Error('目标电脑返回的文件字节不完整')
  for (let index = 0; index < length; index += 1) target[offset + index] = binary.charCodeAt(index)
}

// Browses one target computer through the same /api/devices/{id}/... file API the
// Tether resource manager uses. Identity comes from the surface owner RPC, so the
// picker can never silently browse a different computer or the operator's local disk.
export function createDshTargetExplorerBridge({ getRpc, getHost, fetcher = (...args) => fetch(...args), makeFile = (...args) => new File(...args) } = {}) {
  let scope = null
  let dropFolder = ''
  const host = () => (typeof getHost === 'function' ? getHost() : null)
  const identity = async () => {
    const rpc = typeof getRpc === 'function' ? getRpc() : null
    if (!rpc || typeof rpc.call !== 'function') throw new Error('当前 DSH 没有目标电脑身份通道，无法浏览目标电脑文件')
    let reply
    try { reply = await rpc.call('/tether-identity', 'get', {}) }
    catch (_) { throw new Error('无法确认目标电脑身份，请确认目标电脑在线后重试') }
    const value = reply && (reply.value || reply.result || reply)
    if (!value || typeof value.device_id !== 'string' || !value.device_id) {
      throw new Error('无法确认目标电脑身份，请先在目标电脑启动 Tether Node')
    }
    return value.device_id
  }
  const surfaceOrigin = () => tetherNativeSurfaceOrigin()
  const baseList = () => {
    const value = host()
    const bases = []
    try {
      if (value && typeof value.activeApiBase === 'function') {
        const active = value.activeApiBase()
        if (typeof active === 'string' && active) bases.push(active)
      }
    } catch (_) { /* active authority is optional */ }
    try { if (value && typeof value.apiBases === 'function') bases.push(...(value.apiBases() || [])) } catch (_) { /* candidate list is optional */ }
    bases.push(DSH_APP_BASE, DSH_API_BASE)
    const seen = new Set()
    return bases
      .map((base) => String(base || '').replace(/\/+$/, ''))
      .filter((base) => {
        if (!base || seen.has(base)) return false
        seen.add(base)
        return true
      })
  }
  const headersFor = (base) => {
    const value = host()
    try { return value && typeof value.apiHeaders === 'function' ? { ...(value.apiHeaders(base) || {}) } : {} }
    catch (_) { return {} }
  }
  const deviceRoute = (deviceId, suffix) => '/api/devices/' + encodeURIComponent(deviceId) + suffix
  const apiSuffix = (suffix) => {
    if (suffix === '/list') return '/fs/list'
    if (suffix === '/read') return '/fs/read'
    if (suffix === '/write_chunk') return '/fs/write_chunk'
    return suffix
  }
  const request = async (deviceId, suffix, body, signal) => {
    const origin = surfaceOrigin()
    const init = { method: body === undefined ? 'GET' : 'POST' }
    if (body !== undefined) {
      init.body = JSON.stringify(origin ? { ...body, device_id: deviceId } : body)
      init.headers = { 'Content-Type': 'application/json' }
    }
    if (origin) init.credentials = 'include'
    init.signal = signal || AbortSignal.timeout(DSH_TARGET_DEVICE_TIMEOUT)
    const attempts = origin
      ? [{ base: origin, url: origin + DSH_TARGET_SURFACE_PREFIX + suffix
        + (body === undefined ? '?device_id=' + encodeURIComponent(deviceId) : '') }]
      : baseList().map((base) => ({ base, url: base + deviceRoute(deviceId, apiSuffix(suffix)) }))
    let lastError = null
    for (const attempt of attempts) {
      let response
      try {
        response = await fetcher(attempt.url, {
          ...init,
          headers: { ...(origin ? {} : headersFor(attempt.base)), ...(init.headers || {}) }
        })
      } catch (cause) {
        if (signal && signal.aborted) throw cause
        lastError = cause
        continue
      }
      let data = {}
      try { data = await response.json() } catch (_) { /* an error body may be empty */ }
      if (!response.ok) {
        const detail = data && data.detail
        let code = (detail && typeof detail === 'object' && detail.code) || (data && data.code)
        if (!code && origin && response.status === 404) code = 'node_update_required'
        const message = (detail && typeof detail === 'object' ? detail.error || detail.message : detail)
          || (data && data.error && data.error.message) || (data && typeof data.error === 'string' && data.error)
          || ('HTTP ' + response.status)
        const error = new Error(TARGET_DEVICE_ERROR_MESSAGES[code] || message || '目标电脑请求失败')
        error.status = response.status
        error.code = code
        throw error
      }
      if (!data || typeof data !== 'object') throw new Error('目标电脑返回的数据格式无效')
      if (data.device_id != null && data.device_id !== deviceId) throw new Error('目标电脑身份校验失败，请重新选择文件')
      return data
    }
    const error = new Error('目标电脑不可达，请确认目标电脑在线后重试')
    error.cause = lastError
    throw error
  }
  const assertDevice = async (deviceId) => {
    if (await identity() !== deviceId) {
      scope = null
      throw new Error('目标电脑已切换，请重新选择文件')
    }
  }
  const readDrives = async (deviceId, signal) => {
    const data = await request(deviceId, '/drives', undefined, signal)
    if (!Array.isArray(data.drives)) throw new Error('目标电脑磁盘列表格式无效')
    return data.drives
      .filter((item) => item && typeof item.path === 'string' && item.path)
      .map((item) => ({
        name: typeof item.name === 'string' && item.name ? item.name : targetPathBase(item.path),
        path: item.path
      }))
  }
  const readWorkspaces = async (deviceId, signal) => {
    const data = await request(deviceId, '/workspaces', undefined, signal)
    if (!Array.isArray(data.workspaces)) throw new Error('目标电脑工作区列表格式无效')
    return data.workspaces
      .filter((item) => item && typeof item.path === 'string' && item.path)
      .map((item) => ({
        name: typeof item.name === 'string' && item.name ? item.name : targetPathBase(item.path),
        path: item.path,
        kind: typeof item.kind === 'string' ? item.kind : ''
      }))
  }
  return {
    async getRoots(signal) {
      const deviceId = await identity()
      const [drives, workspaces] = await Promise.allSettled([
        readDrives(deviceId, signal),
        readWorkspaces(deviceId, signal)
      ])
      if (drives.status === 'rejected' && workspaces.status === 'rejected') throw drives.reason
      await assertDevice(deviceId)
      const driveRoots = drives.status === 'fulfilled' ? drives.value : []
      const workspaceRoots = workspaces.status === 'fulfilled' ? workspaces.value : []
      scope = {
        deviceId,
        directories: new Set([...workspaceRoots, ...driveRoots].map((item) => item.path)),
        files: new Map()
      }
      const failure = drives.status === 'rejected' ? drives.reason
        : workspaces.status === 'rejected' ? workspaces.reason : null
      return {
        deviceId,
        workspaces: workspaceRoots,
        drives: driveRoots,
        warning: failure ? (failure.message || '部分目标电脑目录读取失败') : ''
      }
    },
    async listDirectory(path, signal) {
      if (typeof path !== 'string' || !path) throw new Error('请选择目标电脑上的目录')
      const current = scope
      if (!current || !current.directories.has(path)) throw new Error('只能打开目标电脑中已列出的目录')
      const deviceId = await identity()
      if (deviceId !== current.deviceId) {
        scope = null
        throw new Error('目标电脑已切换，请重新选择文件')
      }
      const applyListing = (raw) => {
        const separator = path.includes('\\') ? '\\' : '/'
        const prefix = path.replace(/[\\/]+$/, '') + separator
        for (const child of [...current.directories]) {
          if (child !== path && child.startsWith(prefix)) current.directories.delete(child)
        }
        for (const child of [...current.files.keys()]) {
          if (child.startsWith(prefix)) current.files.delete(child)
        }
        const entries = []
        for (const entry of raw) {
          if (!entry || typeof entry.name !== 'string' || typeof entry.path !== 'string' || !entry.path) continue
          const dir = entry.dir === true
          const size = Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : null
          if (!dir && size === null) continue
          if (dir) current.directories.add(entry.path)
          else current.files.set(entry.path, { name: entry.name, size })
          entries.push({
            name: entry.name, path: entry.path, dir,
            size: dir ? null : size,
            mtime: typeof entry.mtime === 'number' ? entry.mtime : null
          })
        }
        return entries
      }
      const cached = peekDirectory(deviceId, path)
      if (cached) {
        await assertDevice(deviceId)
        return applyListing(cached)
      }
      const entries = await loadDirectory({
        deviceId, path,
        load: async () => {
          const data = await request(deviceId, '/list', { path }, signal)
          if (!Array.isArray(data.entries)) throw new Error('目标电脑目录返回格式无效')
          await assertDevice(deviceId)
          return data.entries
        }
      })
      return applyListing(entries)
    },
    async readFile(entry, signal, onProgress) {
      if (!entry || entry.dir || typeof entry.path !== 'string' || !entry.path) throw new Error('请选择一个文件')
      const current = scope
      if (!current) throw new Error('请先打开目标电脑的文件列表')
      const listed = current.files.get(entry.path)
      if (!listed || listed.name !== entry.name) throw new Error('只能读取目标电脑刚列出的文件')
      const size = listed.size
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('目标电脑没有给出有效的文件大小，请重新选择')
      const deviceId = current.deviceId
      await assertDevice(deviceId)
      const buffer = size ? new Uint8Array(size) : new Uint8Array(0)
      let received = 0
      const readSlice = async (offset) => {
        const limit = Math.min(DSH_TARGET_ATTACHMENT_CHUNK, size - offset)
        let attempt = 0
        for (;;) {
          try {
            const data = await request(deviceId, '/read', { path: entry.path, offset, limit, encoding: 'base64' }, signal)
            if (data.path !== entry.path || data.size !== size || data.offset !== offset
                || data.truncated !== (offset + limit < size)) {
              const error = new Error('目标电脑上的文件已变化，请重新选择')
              error.code = 'stale_listing'
              throw error
            }
            if (data.binary !== true || typeof data.base64 !== 'string') {
              const error = new Error('目标电脑没有返回附件的原始字节，请更新目标电脑的 Tether Node 后重试')
              error.code = 'node_update_required'
              throw error
            }
            decodeTargetBase64Into(data.base64, buffer, offset, limit)
            received += limit
            if (typeof onProgress === 'function') {
              try { onProgress(received, size) } catch (_) { /* progress is advisory */ }
            }
            return
          } catch (error) {
            const aborted = (signal && signal.aborted) || (error && error.name === 'AbortError')
            const finalCode = error && (error.code === 'stale_listing' || error.code === 'node_update_required')
            const retryable = !aborted && !finalCode
              && !(Number(error && error.status) >= 400 && Number(error && error.status) < 500)
            attempt += 1
            if (!retryable || attempt >= DSH_TARGET_READ_ATTEMPTS) throw error
            await new Promise((resolve) => setTimeout(resolve, DSH_TARGET_READ_RETRY_DELAY * attempt))
          }
        }
      }
      const offsets = []
      for (let offset = 0; offset < size; offset += DSH_TARGET_ATTACHMENT_CHUNK) offsets.push(offset)
      let cursor = 0
      let failure = null
      const worker = async () => {
        while (!failure && cursor < offsets.length) {
          const offset = offsets[cursor]
          cursor += 1
          try { await readSlice(offset) } catch (error) { if (!failure) failure = error }
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(DSH_TARGET_ATTACHMENT_CONCURRENCY, offsets.length) },
        worker
      ))
      if (failure) throw failure
      if (signal && signal.aborted) throw new DOMException('读取已取消', 'AbortError')
      await assertDevice(deviceId)
      return makeFile(size ? [buffer] : [], listed.name || targetPathBase(entry.path) || 'attachment', {
        type: targetFileType(listed.name || entry.path), lastModified: Date.now()
      })
    },
    async readFolder(entry, signal, onProgress) {
      if (!entry || !entry.dir || typeof entry.path !== 'string' || !entry.path) throw new Error('请选择一个文件夹')
      const files = []
      let total = 0
      let sent = 0
      const visit = async (path, prefix, depth) => {
        if (depth > 12) throw new Error('文件夹层级过深')
        const listing = await this.listDirectory(path, signal)
        for (const item of listing) {
          if (!item || !item.name || item.name === '.tether-trash') continue
          if (item.dir) {
            await visit(item.path, prefix + item.name + '/', depth + 1)
            continue
          }
          if (files.length >= DSH_TARGET_FOLDER_LIMIT_FILES) {
            throw new Error('文件夹内文件超过 ' + DSH_TARGET_FOLDER_LIMIT_FILES + ' 个')
          }
          total += Number.isSafeInteger(item.size) && item.size > 0 ? item.size : 0
          const file = await this.readFile(item, signal, (done, size) => {
            if (typeof onProgress === 'function') {
              try { onProgress(sent + done, total) } catch (_) { /* progress is advisory */ }
            }
          })
          sent += Number(file.size) || 0
          try {
            Object.defineProperty(file, 'webkitRelativePath', { value: prefix + item.name, configurable: true })
          } catch (_) { /* the composer can still upload the file by name */ }
          files.push(file)
        }
      }
      await visit(entry.path, targetPathBase(entry.path) + '/', 0)
      if (!files.length) throw new Error('文件夹内没有可上传的文件')
      return files
    },
    async saveDroppedFile(file, signal) {
      if (!file || typeof file.name !== 'string' || !file.name) throw new Error('无效的文件')
      const size = Number(file.size)
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('无效的文件大小')
      const deviceId = await identity()
      const bases = []
      if (dropFolder) bases.push(dropFolder)
      else {
        bases.push('D:\\TetherDrop', 'D:\\TetherWorkspaces\\TetherDrop')
      }
      const name = targetSafeFileName(file.name)
      const write = async (path) => {
        const transferId = targetTransferId()
        const chunkSize = DSH_TARGET_WRITE_CHUNK
        if (!size) {
          await request(deviceId, '/write_chunk', {
            path, transfer_id: transferId, offset: 0, total: 0, base64: '', final: true, overwrite: false
          }, signal)
          return
        }
        for (let offset = 0; offset < size; offset += chunkSize) {
          const end = Math.min(offset + chunkSize, size)
          // Stream one 4 MiB window at a time so a huge drop never keeps more
          // than one slice of the file in memory.
          const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
          if (bytes.length !== end - offset) throw new Error('文件读取不完整')
          await request(deviceId, '/write_chunk', {
            path, transfer_id: transferId, offset, total: size,
            base64: targetBase64(bytes), final: end === size, overwrite: false
          }, signal)
        }
      }
      let lastError = null
      for (const folder of [...new Set(bases)]) {
        for (let attempt = 1; attempt <= 20; attempt++) {
          const path = folder.replace(/[\\/]+$/, '') + '\\' + targetUniqueName(name, attempt)
          try {
            await write(path)
            dropFolder = folder.replace(/[\\/]+$/, '')
            return { deviceId, path, size }
          } catch (error) {
            lastError = error
            if (error && error.code === 'exists') continue
            break
          }
        }
      }
      throw lastError || new Error('保存文件失败')
    }
  }
}

export async function addDshTargetAttachment(owner, bridge, entry, isCurrent = () => true, onProgress) {
  const onAddFiles = owner && owner.onAddFiles
  if (typeof onAddFiles !== 'function') throw new Error('当前会话不接受附件')
  const file = await bridge.readFile(entry, undefined, onProgress)
  if (!isCurrent()) throw new Error('目标电脑或会话已切换，请重新选择文件')
  onAddFiles([file])
  return file
}

export async function addDshTargetFolder(owner, bridge, entry, isCurrent = () => true, onProgress) {
  const onAddFiles = owner && owner.onAddFiles
  if (typeof onAddFiles !== 'function') throw new Error('当前会话不接受附件')
  const files = await bridge.readFolder(entry, undefined, onProgress)
  if (!isCurrent()) throw new Error('目标电脑或会话已切换，请重新选择文件夹')
  onAddFiles(files)
  return files
}

export function createDshTargetAttachments(React, Native, bridge, pickerCommand, uiWorkspace, sessions) {
  const h = React.createElement
  // The same palette tokens as the Tether shell so the shared pick dialog keeps
  // the shell's colors inside DSH instead of drawing a second, host-styled one.
  const C = {
    ink: 'var(--dsw-alias-label-primary, #101828)',
    sub: 'var(--dsw-alias-label-secondary, #475467)',
    mute: 'var(--dsw-alias-label-tertiary, #667085)',
    line: 'var(--dsw-alias-border-l1, #eaecf0)',
    soft: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
    hover: 'var(--dsw-alias-interactive-bg-hover-solid, #f2f4f7)',
    bg: 'var(--dsw-alias-bg-base, #ffffff)',
    blue: 'var(--dsw-alias-state-business-primary, #1570ef)',
    red: 'var(--dsw-alias-state-error-primary, #b42318)',
    primary: 'var(--dsw-alias-button-primary-fill, #101828)',
    onPrimary: 'var(--dsw-alias-label-primary-inverted, #ffffff)'
  }
  return function DshTargetAttachments(props) {
    const [open, setOpen] = React.useState(false)
    const [dropNotice, setDropNotice] = React.useState('')
    const dropNoticeTimer = React.useRef(null)
    const mounted = React.useRef(true)
    const busyRef = React.useRef(false)
    const operation = React.useRef(0)
    const openPickerRef = React.useRef(null)
    const currentProps = React.useRef(props)
    currentProps.current = props
    React.useEffect(() => {
      mounted.current = true
      return () => { mounted.current = false }
    }, [])
    // A long read can keep the status toast armed; always release its timer on
    // unmount so a session switch cannot leave the surface waiting on it.
    React.useEffect(() => () => {
      if (dropNoticeTimer.current) clearTimeout(dropNoticeTimer.current)
      dropNoticeTimer.current = null
    }, [])
    const notify = (text, timeout = 4500) => {
      if (!mounted.current) return
      if (dropNoticeTimer.current) clearTimeout(dropNoticeTimer.current)
      setDropNotice(text)
      dropNoticeTimer.current = setTimeout(() => { if (mounted.current) setDropNotice('') }, timeout)
    }
    React.useEffect(() => {
      operation.current += 1
      busyRef.current = false
      setOpen(false)
    }, [props.sessionId])
    React.useEffect(() => {
      const pending = pickerCommand && pickerCommand.pendingSessionStart
      if (!pending || !props.sessionId) return
      if (pending.baselineIds.has(props.sessionId)) {
        clearTimeout(pending.timeoutId)
        pickerCommand.pendingSessionStart = null
        return
      }
      clearTimeout(pending.timeoutId)
      pickerCommand.pendingSessionStart = null
      void openPickerRef.current?.()
    }, [props.sessionId])
    const openPicker = async () => {
      if (busyRef.current || pickerCommand?.pendingSessionStart) return
      busyRef.current = true
      const sessionId = props.sessionId
      if (!sessionId) {
        const snapshot = sessions?.list?.getSnapshot?.()
        const startSession = uiWorkspace && uiWorkspace.startSession
        if (typeof startSession !== 'function' || !snapshot || !Array.isArray(snapshot.ids)) {
          notify('当前没有目标 DSH 会话。请先在目标电脑选择或创建工作区，再浏览其文件。')
          busyRef.current = false
          return
        }
        const pending = { baselineIds: new Set(snapshot.ids), timeoutId: null }
        pending.timeoutId = setTimeout(() => {
          if (pickerCommand?.pendingSessionStart === pending) {
            pickerCommand.pendingSessionStart = null
            if (mounted.current) notify('目标会话准备超时，请先在目标电脑选择工作区后重试。')
          }
        }, 30_000)
        if (pickerCommand) pickerCommand.pendingSessionStart = pending
        try { startSession.call(uiWorkspace) }
        catch (cause) {
          clearTimeout(pending.timeoutId)
          if (pickerCommand?.pendingSessionStart === pending) pickerCommand.pendingSessionStart = null
          notify(cause.message || '目标 DSH 会话创建失败，请先在目标电脑选择工作区。')
        }
        busyRef.current = false
        return
      }
      if (!props.canAcceptDrop) {
        notify('当前 DSH 会话暂不接受附件。')
        busyRef.current = false
        return
      }
      busyRef.current = false
      setOpen(true)
    }
    openPickerRef.current = openPicker
    const close = () => {
      operation.current += 1
      busyRef.current = false
      setOpen(false)
      const pending = pickerCommand && pickerCommand.pendingSessionStart
      if (pending) {
        clearTimeout(pending.timeoutId)
        pickerCommand.pendingSessionStart = null
      }
    }
    // Reads the picked target files through the same identity/session guards as
    // the old in-dialog reader; progress and failures surface in the toast.
    const confirmPicked = async (picked) => {
      const entries = (Array.isArray(picked) ? picked : []).filter((entry) => entry && !entry.dir)
      if (!entries.length) return
      const token = ++operation.current
      const sessionId = props.sessionId
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const label = (entry.name || '目标文件') + (entries.length > 1 ? '（' + (index + 1) + '/' + entries.length + '）' : '')
        notify('正在读取 ' + label + '…', 600000)
        try {
          await addDshTargetAttachment(currentProps.current, bridge, entry,
            () => mounted.current && token === operation.current && currentProps.current.sessionId === sessionId,
            (done, total) => {
              if (!mounted.current || token !== operation.current || !(total > 0)) return
              notify('正在读取 ' + label + ' ' + Math.min(100, Math.floor((done / total) * 100)) + '%…', 600000)
            })
        } catch (cause) {
          if (mounted.current && token === operation.current) {
            notify('读取目标电脑文件失败：' + ((cause && cause.message) || cause))
          }
          return
        }
      }
      if (mounted.current && token === operation.current) {
        notify(entries.length === 1
          ? '已添加附件 ' + (entries[0].name || '')
          : '已添加 ' + entries.length + ' 个附件')
      }
    }
    React.useEffect(() => {
      if (typeof document === 'undefined') return undefined
      const onDrop = (event) => {
        const transfer = event.dataTransfer
        if (!transfer || !transfer.files || !transfer.files.length) return
        const target = event.target
        if (!target || typeof target.closest !== 'function'
            || !target.closest('[contenteditable="true"], [class*="uV2eYG"], [class*="composer"]')) return
        const files = [...transfer.files].filter((file) => file && typeof file.arrayBuffer === 'function')
        if (!files.length) return
        event.preventDefault()
        event.stopPropagation()
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
        const owner = currentProps.current
        if (owner && typeof owner.onAddFiles === 'function') {
          try { owner.onAddFiles(files) } catch (_) { /* the save still proceeds */ }
        }
        Promise.all(files.map((file) => bridge.saveDroppedFile(file)
          .then((saved) => ({ saved }))
          .catch((cause) => ({ cause }))))
          .then((results) => {
            if (!mounted.current) return
            const saved = results.filter((result) => result.saved).map((result) => result.saved)
            const failed = results.find((result) => result.cause)
            if (saved.length) {
              const folder = saved[0].path.slice(0, Math.max(saved[0].path.lastIndexOf('\\'), saved[0].path.lastIndexOf('/')))
              notify(saved.length === 1 ? '已保存到 ' + saved[0].path : '已保存 ' + saved.length + ' 个文件到 ' + folder)
            } else if (failed) {
              notify('保存失败：' + (failed.cause && failed.cause.message || failed.cause))
            }
          })
      }
      document.addEventListener('drop', onDrop, true)
      return () => {
        document.removeEventListener('drop', onDrop, true)
        if (dropNoticeTimer.current) clearTimeout(dropNoticeTimer.current)
      }
    }, [bridge])
    React.useEffect(() => {
      if (!pickerCommand) return undefined
      const openCommand = (sessionId) => {
        if (busyRef.current || pickerCommand.pendingSessionStart) return 'busy'
        const currentSession = currentProps.current.sessionId || null
        if ((sessionId || null) !== currentSession || !openPickerRef.current) return 'not-ready'
        if (currentSession && !currentProps.current.canAcceptDrop) return 'not-accepting'
        void openPickerRef.current()
        return 'opened'
      }
      pickerCommand.open = openCommand
      return () => { if (pickerCommand.open === openCommand) pickerCommand.open = null }
    }, [pickerCommand])

    const dialog = open ? h(TetherFolderPickDialog, {
      React, C, kind: 'file', multiple: true,
      loadRoots: () => bridge.getRoots(),
      listDirectory: (path) => bridge.listDirectory(path),
      onDone: (chosen, picked) => {
        close()
        if (Array.isArray(chosen) && chosen.length) void confirmPicked(picked)
      }
    }) : null
    return h('div', { style: { display: 'contents' } },
      h(Native.ComposerAttachments, { ...props, readFileDrag: props.readFileDrag }),
      dropNotice ? h('div', {
        role: 'status',
        style: {
          position: 'fixed', right: 16, bottom: 16, zIndex: 2147483000, maxWidth: 440,
          padding: '8px 10px', borderRadius: 8, background: 'rgba(16,24,40,.88)', color: '#fff',
          fontSize: 12, lineHeight: '18px', boxShadow: '0 4px 16px rgba(16,24,40,.22)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }
      }, dropNotice) : null,
      dialog)
  }
}

export function createDshHost({ apiBase = DSH_API_BASE, pluginVersion = null, localPluginUpdates, localDeviceIdentity, localPluginSurfaceReload } = {}) {
  const normalize = (value) => String(value || '').replace(/\/+$/, '')
  const appContext = async () => {
    const response = await fetch(DSH_APP_BASE + '/app-context', { signal: AbortSignal.timeout(1500) })
    if (!response.ok) throw new Error('APP 服务不可用')
    return response.json()
  }
  const probeHub = async () => {
    const hub = storedHub()
    if (!hub) return null
    const url = normalize(hub.url)
    const started = Date.now()
    const response = await fetch(url + '/api/state', {
      headers: { Authorization: 'Bearer ' + hub.token },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) { const error = new Error('Hub 请求失败'); error.status = response.status; throw error }
    const state = await response.json()
    return { state, address: url, status: 'online', checkedAt: new Date().toISOString(), durationMs: Date.now() - started }
  }
  return {
    kind: 'dsh',
    pluginVersion,
    apiBase: () => apiBase,
    localDeviceId: async () => {
      try {
        const response = await fetch(DSH_APP_BASE + '/app-context', { signal: AbortSignal.timeout(1500) })
        if (response.ok) {
          const context = await response.json()
          if (context && typeof context.device === 'string' && context.device) return context.device
        }
      } catch (_) { /* APP identity is optional for a standalone plugin */ }
      if (typeof localDeviceIdentity !== 'function') return null
      const deviceId = await localDeviceIdentity()
      return typeof deviceId === 'string' && deviceId ? deviceId : null
    },
    hubConfig: () => {
      const hub = storedHub()
      return hub ? { url: hub.url.replace(/\/+$/, '') } : null
    },
    connectionInfo: async (activeBase) => {
      const hub = storedHub()
      if (hub && normalize(activeBase) === normalize(hub.url)) return { address: normalize(hub.url), status: 'unknown', checkedAt: null, durationMs: null }
      if (normalize(activeBase) === normalize(DSH_APP_BASE)) {
        try {
          const context = await appContext()
          const probe = context.lastProbe || {}
          return { address: context.serverUrl || DSH_APP_BASE, status: probe.status || 'unknown', errorKind: probe.errorKind, checkedAt: probe.checkedAt, durationMs: probe.durationMs }
        } catch (_) { return { address: DSH_APP_BASE, status: 'unknown', checkedAt: null, durationMs: null } }
      }
      return { address: normalize(activeBase) || apiBase, status: 'unknown', checkedAt: null, durationMs: null }
    },
    probeConnection: async (activeBase) => {
      const hub = storedHub()
      const base = normalize(activeBase)
      if (hub && base === normalize(hub.url)) return probeHub()
      if (base === normalize(DSH_APP_BASE)) {
        const response = await fetch(DSH_APP_BASE + '/connection-probe', { signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error('APP 服务不可用')
        const value = await response.json()
        return { address: value.serverUrl || DSH_APP_BASE, ...(value.lastProbe || {}) }
      }
      const started = Date.now()
      const response = await fetch(base + '/api/state', { signal: AbortSignal.timeout(5000) })
      if (!response.ok) { const error = new Error('服务器请求失败'); error.status = response.status; throw error }
      await response.json()
      return { address: base, status: 'online', checkedAt: new Date().toISOString(), durationMs: Date.now() - started }
    },
    probeHub: async () => {
      return probeHub()
    },
    localPluginUpdates: async (action, payload = {}) => {
      if (typeof localPluginUpdates !== 'function') throw new Error('当前 DSH 插件没有本机更新通道，请先安装新版插件。')
      if (!['status', 'check', 'prepare', 'apply'].includes(action)) throw new Error('不支持的本机插件更新操作')
      const body = action === 'apply' ? { prepared_id: payload.prepared_id } : {}
      if (action === 'apply' && (typeof body.prepared_id !== 'string' || !body.prepared_id)) throw new Error('本机插件更新包标识无效')
      return localPluginUpdates(action, body)
    },
    reloadLocalPluginSurface: async () => {
      if (typeof localPluginSurfaceReload !== 'function') throw new Error('当前 DSH 没有本机插件重载通道')
      return localPluginSurfaceReload()
    },
    apiBases: () => {
      const hub = storedHub()
      return hub ? [hub.url.replace(/\/+$/, ''), DSH_APP_BASE, apiBase] : [DSH_APP_BASE, apiBase]
    },
    surfaceBase: () => DSH_APP_BASE,
    apiHeaders: (base) => {
      const hub = storedHub()
      const normalize = (value) => String(value || '').replace(/\/+$/, '')
      return hub && normalize(base) === normalize(hub.url)
        ? { Authorization: 'Bearer ' + hub.token }
        : {}
    }
  }
}
