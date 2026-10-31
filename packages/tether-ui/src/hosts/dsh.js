import { TargetFileExplorer } from '../target-file-explorer.js'

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

export const DSH_TARGET_ATTACHMENT_LIMIT = 10 * 1024 * 1024
export const DSH_TARGET_ATTACHMENT_CHUNK = 256 * 1024
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
export function tetherNativeSurfaceOrigin() {
  if (typeof window === 'undefined' || !window.location) return ''
  const location = window.location
  const href = typeof location.href === 'string' ? location.href : ''
  if (href) {
    try {
      const parsed = new URL(href)
      if (parsed.searchParams.has('tether_native') || !loopbackHostname(parsed.hostname)) return parsed.origin
      return ''
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

function targetParentPath(value) {
  const clean = String(value || '').replace(/[\\/]+$/, '')
  if (!clean) return ''
  if (/^[A-Za-z]:$/.test(clean)) return clean + '\\'
  const slash = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  if (slash < 0) return ''
  const parent = clean.slice(0, slash)
  if (!parent) return '/'
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent
}

function targetBreadcrumbs(path, root) {
  const value = String(path || '').replace(/[\\/]+$/, '')
  if (!value) return []
  const base = String(root || '').replace(/[\\/]+$/, '')
  if (!base || !value.toLowerCase().startsWith(base.toLowerCase())) {
    return [{ label: targetPathBase(value) || value, path: value }]
  }
  const separator = value.includes('\\') ? '\\' : '/'
  const crumbs = [{ label: targetPathBase(base) || base, path: base }]
  const relative = value.slice(base.length).replace(/^[\\/]+/, '')
  let current = base
  for (const part of relative.split(/[\\/]+/).filter(Boolean)) {
    current = current.replace(/[\\/]+$/, '') + separator + part
    crumbs.push({ label: part, path: current })
  }
  return crumbs
}

function targetSortEntries(entries, sort) {
  const key = sort && ['name', 'mtime', 'size'].includes(sort.key) ? sort.key : 'name'
  const direction = sort && sort.dir === 'desc' ? -1 : 1
  return [...(entries || [])].sort((left, right) => {
    if (left.dir !== right.dir) return left.dir ? -1 : 1
    let a
    let b
    if (key === 'size') { a = Number(left.size || 0); b = Number(right.size || 0) }
    else if (key === 'mtime') { a = Number(left.mtime || 0); b = Number(right.mtime || 0) }
    else { a = String(left.name || '').toLowerCase(); b = String(right.name || '').toLowerCase() }
    if (a < b) return -direction
    if (a > b) return direction
    return 0
  })
}

function decodeTargetBase64(value) {
  if (typeof value !== 'string') throw new Error('目标电脑返回的文件字节不完整')
  let binary
  if (typeof atob === 'function') binary = atob(value)
  else binary = globalThis.Buffer.from(value, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function formatTargetSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) return ''
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatTargetTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  try { return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) } catch (_) { return '' }
}

// Browses one target computer through the same /api/devices/{id}/... file API the
// Tether resource manager uses. Identity comes from the surface owner RPC, so the
// picker can never silently browse a different computer or the operator's local disk.
export function createDshTargetExplorerBridge({ getRpc, getHost, fetcher = (...args) => fetch(...args), makeFile = (...args) => new File(...args) } = {}) {
  let scope = null
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
      const data = await request(deviceId, '/list', { path }, signal)
      if (!Array.isArray(data.entries)) throw new Error('目标电脑目录返回格式无效')
      await assertDevice(deviceId)
      const separator = path.includes('\\') ? '\\' : '/'
      const prefix = path.replace(/[\\/]+$/, '') + separator
      for (const child of [...current.directories]) {
        if (child !== path && child.startsWith(prefix)) current.directories.delete(child)
      }
      for (const child of [...current.files.keys()]) {
        if (child.startsWith(prefix)) current.files.delete(child)
      }
      const entries = []
      for (const entry of data.entries) {
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
    },
    async readFile(entry, signal) {
      if (!entry || entry.dir || typeof entry.path !== 'string' || !entry.path) throw new Error('请选择一个文件')
      const current = scope
      if (!current) throw new Error('请先打开目标电脑的文件列表')
      const listed = current.files.get(entry.path)
      if (!listed || listed.name !== entry.name) throw new Error('只能读取目标电脑刚列出的文件')
      const size = listed.size
      if (!Number.isSafeInteger(size) || size < 0 || size > DSH_TARGET_ATTACHMENT_LIMIT) {
        throw new Error('单个附件不能超过 10 MiB')
      }
      const deviceId = current.deviceId
      const chunks = []
      for (let offset = 0; offset < size; offset += DSH_TARGET_ATTACHMENT_CHUNK) {
        const limit = Math.min(DSH_TARGET_ATTACHMENT_CHUNK, size - offset)
        const data = await request(deviceId, '/read', { path: entry.path, offset, limit, encoding: 'base64' }, signal)
        if (data.path !== entry.path || data.size !== size || data.offset !== offset
            || data.truncated !== (offset + limit < size)) {
          throw new Error('目标电脑上的文件已变化，请重新选择')
        }
        if (data.binary !== true || typeof data.base64 !== 'string') {
          const error = new Error('目标电脑没有返回附件的原始字节，请更新目标电脑的 Tether Node 后重试')
          error.code = 'node_update_required'
          throw error
        }
        const bytes = decodeTargetBase64(data.base64)
        if (bytes.length !== limit) throw new Error('目标电脑返回的文件字节不完整')
        chunks.push(bytes)
        await assertDevice(deviceId)
      }
      if (!chunks.length) await assertDevice(deviceId)
      return makeFile(chunks, listed.name || targetPathBase(entry.path) || 'attachment', {
        type: targetFileType(listed.name || entry.path), lastModified: Date.now()
      })
    }
  }
}

export async function addDshTargetAttachment(owner, bridge, entry, isCurrent = () => true) {
  const onAddFiles = owner && owner.onAddFiles
  if (typeof onAddFiles !== 'function') throw new Error('当前会话不接受附件')
  const file = await bridge.readFile(entry)
  if (!isCurrent()) throw new Error('目标电脑或会话已切换，请重新选择文件')
  onAddFiles([file])
  return file
}

export function createDshTargetAttachments(React, Native, bridge, pickerCommand, uiWorkspace, sessions) {
  const h = React.createElement
  return function DshTargetAttachments(props) {
    const [open, setOpen] = React.useState(false)
    const [device, setDevice] = React.useState('')
    const [workspaces, setWorkspaces] = React.useState([])
    const [drives, setDrives] = React.useState([])
    const [root, setRoot] = React.useState('')
    const [directory, setDirectory] = React.useState('')
    const [entries, setEntries] = React.useState(null)
    const [sort, setSort] = React.useState({ key: 'name', dir: 'asc' })
    const [search, setSearch] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [status, setStatus] = React.useState('')
    const [error, setError] = React.useState('')
    const mounted = React.useRef(true)
    const busyRef = React.useRef(false)
    const operation = React.useRef(0)
    const containerRef = React.useRef(null)
    const openPickerRef = React.useRef(null)
    const currentProps = React.useRef(props)
    currentProps.current = props
    React.useEffect(() => {
      mounted.current = true
      return () => { mounted.current = false }
    }, [])
    React.useEffect(() => {
      operation.current += 1
      busyRef.current = false
      setOpen(false); setBusy(false); setStatus(''); setError('')
      setDevice(''); setWorkspaces([]); setDrives([]); setRoot(''); setDirectory(''); setEntries(null)
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
    const live = (token, sessionId) => mounted.current && token === operation.current
      && currentProps.current.sessionId === sessionId
    const resetExplorer = () => {
      setDevice(''); setWorkspaces([]); setDrives([])
      setRoot(''); setDirectory(''); setEntries(null); setStatus(''); setError('')
    }
    const openPicker = async () => {
      if (busyRef.current || pickerCommand?.pendingSessionStart) return
      busyRef.current = true
      const token = ++operation.current
      const sessionId = props.sessionId
      setOpen(true); setBusy(false); resetExplorer()
      if (!sessionId) {
        const snapshot = sessions?.list?.getSnapshot?.()
        const startSession = uiWorkspace && uiWorkspace.startSession
        if (typeof startSession !== 'function' || !snapshot || !Array.isArray(snapshot.ids)) {
          setError('当前没有目标 DSH 会话。请先在目标电脑选择或创建工作区，再浏览其文件。')
          busyRef.current = false
          return
        }
        const pending = { baselineIds: new Set(snapshot.ids), timeoutId: null }
        pending.timeoutId = setTimeout(() => {
          if (pickerCommand?.pendingSessionStart === pending) {
            pickerCommand.pendingSessionStart = null
            if (mounted.current) {
              setStatus('')
              setError('目标会话准备超时，请先在目标电脑选择工作区后重试。')
            }
          }
        }, 30_000)
        if (pickerCommand) pickerCommand.pendingSessionStart = pending
        setStatus('正在准备目标 DSH 会话…工作区就绪后会自动打开目标电脑的文件选择器。')
        try { startSession.call(uiWorkspace) }
        catch (cause) {
          clearTimeout(pending.timeoutId)
          if (pickerCommand?.pendingSessionStart === pending) pickerCommand.pendingSessionStart = null
          setStatus('')
          setError(cause.message || '目标 DSH 会话创建失败，请先在目标电脑选择工作区。')
        }
        busyRef.current = false
        return
      }
      if (!props.canAcceptDrop) {
        setError('当前 DSH 会话暂不接受附件。')
        busyRef.current = false
        return
      }
      setBusy(true); setStatus('正在读取目标电脑…')
      try {
        const roots = await bridge.getRoots()
        if (!live(token, sessionId)) return
        setDevice(roots.deviceId || '')
        setWorkspaces(roots.workspaces || [])
        setDrives(roots.drives || [])
        setStatus('')
        if (roots.warning) setError(roots.warning)
      } catch (cause) {
        if (live(token, sessionId)) {
          setStatus('')
          setError(cause.message || '读取目标电脑失败')
        }
      } finally {
        busyRef.current = false
        if (mounted.current) setBusy(false)
      }
    }
    openPickerRef.current = openPicker
    const close = () => {
      operation.current += 1
      busyRef.current = false
      setOpen(false); setBusy(false); setStatus(''); setError('')
      setRoot(''); setDirectory(''); setEntries(null)
      const pending = pickerCommand && pickerCommand.pendingSessionStart
      if (pending) {
        clearTimeout(pending.timeoutId)
        pickerCommand.pendingSessionStart = null
      }
    }
    const enter = async (item, isRoot) => {
      if (!item || typeof item.path !== 'string' || !item.path || busyRef.current) return
      const token = ++operation.current
      const sessionId = props.sessionId
      busyRef.current = true
      if (isRoot) setRoot(item.path)
      setDirectory(item.path); setEntries(null); setSearch('')
      setBusy(true); setStatus('正在读取目录…'); setError('')
      try {
        const listing = await bridge.listDirectory(item.path)
        if (!live(token, sessionId)) return
        setEntries(listing); setStatus('')
      } catch (cause) {
        if (live(token, sessionId)) {
          setStatus('')
          setError(cause.message || '读取目标电脑目录失败')
        }
      } finally {
        busyRef.current = false
        if (mounted.current) setBusy(false)
      }
    }
    const choose = async (item) => {
      if (!item || item.dir || busyRef.current) return
      if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > DSH_TARGET_ATTACHMENT_LIMIT) {
        setError('单个附件不能超过 10 MiB')
        return
      }
      const token = ++operation.current
      const sessionId = props.sessionId
      busyRef.current = true
      setBusy(true); setStatus('正在读取文件…'); setError('')
      try {
        await addDshTargetAttachment(currentProps.current, bridge, item,
          () => mounted.current && token === operation.current && currentProps.current.sessionId === sessionId)
        if (!mounted.current) return
        setOpen(false); setBusy(false); setStatus('')
        setRoot(''); setDirectory(''); setEntries(null)
      } catch (cause) {
        if (live(token, sessionId)) {
          setStatus('')
          setError(cause.message || '读取目标电脑文件失败')
        }
      } finally {
        busyRef.current = false
        if (mounted.current) setBusy(false)
      }
    }
    const nativeComposerInput = () => {
      let parent = containerRef.current && containerRef.current.parentElement
      while (parent) {
        if (typeof parent.querySelectorAll === 'function') {
          const inputs = [...parent.querySelectorAll('input[type="file"][hidden]')]
          if (inputs.length) return inputs.length === 1 ? inputs[0] : null
        }
        parent = parent.parentElement
      }
      return null
    }
    React.useEffect(() => {
      if (typeof document === 'undefined') return undefined
      const interceptNativeFilePicker = (event) => {
        const input = event.target
        if (!input || input !== nativeComposerInput()) return
        event.preventDefault()
        event.stopPropagation()
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
        if (openPickerRef.current) void openPickerRef.current()
      }
      document.addEventListener('click', interceptNativeFilePicker, true)
      return () => document.removeEventListener('click', interceptNativeFilePicker, true)
    }, [])
    React.useEffect(() => {
      if (!pickerCommand) return undefined
      const openCommand = () => {
        if (!busy && props.canAcceptDrop && props.sessionId) void openPickerRef.current?.()
      }
      pickerCommand.open = openCommand
      return () => { if (pickerCommand.open === openCommand) pickerCommand.open = null }
    }, [busy, props.canAcceptDrop, props.sessionId])

    const bg = 'var(--dsw-alias-bg-layer-1, #ffffff)'
    const soft = 'var(--dsw-alias-bg-layer-2, #f9fafb)'
    const ink = 'var(--dsw-alias-label-primary, #101828)'
    const sub = 'var(--dsw-alias-label-secondary, #475467)'
    const mute = 'var(--dsw-alias-label-tertiary, #667085)'
    const line = 'var(--dsw-alias-border-l1, #eaecf0)'
    const hover = 'var(--dsw-alias-bg-layer-3, #eef2f6)'
    const danger = 'var(--dsw-alias-state-error-primary, #b42318)'
    const fileIcon = (item) => {
      if (Native && typeof Native.FileTypeIcon === 'function') {
        return h(Native.FileTypeIcon, item.dir ? { kind: 'folder', size: 15 } : { path: item.path, size: 15 })
      }
      return h('span', {
        'aria-hidden': true,
        style: { width: 15, height: 15, display: 'grid', placeItems: 'center', color: mute, fontSize: 11 }
      }, item.dir ? '▸' : '•')
    }
    const mutedButton = {
      border: '1px solid ' + line, borderRadius: 6, background: bg, color: sub,
      padding: '4px 10px', font: 'inherit', fontSize: 12, cursor: 'pointer'
    }
    const rootButton = (item, group) => h('button', {
      key: group + ':' + item.path, type: 'button', disabled: busy,
      title: item.path, onClick: () => { void enter(item, true) },
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2,
        width: '100%', padding: '6px 8px', border: 0, borderRadius: 6,
        background: root === item.path ? hover : 'transparent', color: ink,
        font: 'inherit', textAlign: 'left', cursor: busy ? 'default' : 'pointer'
      }
    },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, fontSize: 13 } },
        fileIcon(item),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name)),
      h('span', {
        style: { paddingLeft: 22, color: mute, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
      }, item.path))
    const rootGroup = (label, items, empty) => h('div', { key: label, style: { marginBottom: 10 } },
      h('div', { style: { padding: '8px 8px 4px', color: mute, fontSize: 11, fontWeight: 600, letterSpacing: 0.2 } }, label),
      items.length
        ? items.map((item) => rootButton(item, label))
        : h('div', { style: { padding: '2px 8px 6px', color: mute, fontSize: 11.5 } }, empty))
    const row = (item) => {
      const oversized = !item.dir && item.size > DSH_TARGET_ATTACHMENT_LIMIT
      return h('button', {
        key: item.path, type: 'button', title: item.path,
        disabled: busy || oversized,
        onClick: () => { if (item.dir) void enter(item, false); else void choose(item) },
        style: {
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px 76px 78px', gap: 8,
          alignItems: 'center', width: '100%', height: 32, padding: '0 14px',
          border: 0, borderRadius: 6, background: 'transparent', color: ink,
          font: 'inherit', fontSize: 13, textAlign: 'left',
          cursor: busy || oversized ? 'default' : 'pointer', opacity: oversized ? 0.55 : 1
        }
      },
        h('span', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
          h('span', { style: { width: 16, height: 16, display: 'grid', placeItems: 'center', flex: '0 0 auto' } }, fileIcon(item)),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            item.name + (oversized ? ' · 超过 10 MiB' : ''))),
        h('span', { style: { color: mute, fontSize: 11, whiteSpace: 'nowrap' } }, formatTargetTime(item.mtime)),
        h('span', { style: { color: mute, fontSize: 11, whiteSpace: 'nowrap' } }, item.dir ? '文件夹' : '文件'),
        h('span', { style: { color: mute, fontSize: 11, textAlign: 'right' } }, item.dir ? '' : formatTargetSize(item.size))
      )
    }
    const upTarget = targetParentPath(directory)
    const canGoUp = !!directory && directory !== root && !!upTarget && upTarget !== directory
    const crumbs = targetBreadcrumbs(directory, root)
    const toolbar = h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 14px',
        borderBottom: '1px solid ' + line, flex: '0 0 auto', minWidth: 0
      }
    },
      h('button', {
        type: 'button', disabled: busy || !canGoUp, title: '上一级',
        onClick: () => { if (canGoUp) void enter({ path: upTarget }, false) },
        style: { ...mutedButton, opacity: busy || !canGoUp ? 0.45 : 1, cursor: busy || !canGoUp ? 'default' : 'pointer' }
      }, '上一级'),
      h('div', {
        className: 'tether-breadcrumbs',
        title: directory || '尚未选择位置',
        style: {
          display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto',
          minWidth: 0, overflow: 'hidden', height: 28
        }
      },
        crumbs.length
          ? crumbs.map((segment, index) => h(React.Fragment, { key: segment.path },
            index ? h('span', { style: { color: mute, fontSize: 10, flex: '0 0 auto' } }, '›') : null,
            h('button', {
              type: 'button', title: segment.path, disabled: busy,
              onClick: () => { if (!busy) void enter({ path: segment.path }, false) },
              className: 'tether-hover',
              style: {
                border: 0, background: 'transparent', borderRadius: 5, padding: '3px 5px',
                fontSize: 12, lineHeight: '18px',
                color: index === crumbs.length - 1 ? ink : sub,
                cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190
              }
            }, segment.label)))
          : h('span', { style: { color: sub, fontSize: 12 } }, '从左侧选择工作区或磁盘')),
      directory && entries !== null ? h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 5, flex: '0 1 200px',
          minWidth: 120, height: 28, boxSizing: 'border-box',
          padding: '0 4px 0 8px', borderRadius: 7, background: soft, color: mute
        }
      },
        h('span', { 'aria-hidden': true, style: { fontSize: 12 } }, '⌕'),
        h('input', {
          value: search, placeholder: '搜索当前目录', 'aria-label': '搜索当前目录', spellCheck: false,
          onChange: (event) => setSearch(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') { setSearch(''); event.currentTarget.blur() }
          },
          style: {
            flex: '1 1 auto', minWidth: 0, height: 22, padding: 0, border: 0,
            background: 'transparent', color: ink, fontSize: 12, outline: 'none'
          }
        }),
        search ? h('button', {
          type: 'button', title: '清除搜索', 'aria-label': '清除搜索',
          onClick: () => setSearch(''), className: 'tether-hover',
          style: {
            width: 18, height: 18, flex: '0 0 auto', display: 'grid', placeItems: 'center',
            border: 0, borderRadius: 4, background: 'transparent', color: mute,
            fontSize: 13, lineHeight: '14px', padding: 0, cursor: 'pointer'
          }
        }, '×') : null) : null,
      h('button', {
        type: 'button', disabled: busy || !directory, title: '刷新',
        onClick: () => { if (directory) void enter({ path: directory }, false) },
        style: { ...mutedButton, opacity: busy || !directory ? 0.45 : 1, cursor: busy || !directory ? 'default' : 'pointer' }
      }, '刷新'))
    const sortedEntries = targetSortEntries(entries, sort)
    const term = search.trim().toLowerCase()
    const visibleEntries = term
      ? sortedEntries.filter((item) => String(item.name || '').toLowerCase().includes(term))
      : sortedEntries
    const sortHeader = (key, label, align) => h('button', {
      type: 'button', title: '按' + label + '排序', 'aria-label': '按' + label + '排序',
      'data-sort': sort.key === key ? sort.dir : undefined,
      onClick: () => setSort((current) => current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }),
      className: 'tether-hover',
      style: {
        display: 'flex', alignItems: 'center', gap: 3,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        minWidth: 0, height: 22, padding: '0 4px', margin: '0 -4px', border: 0,
        borderRadius: 4, background: 'transparent',
        color: sort.key === key ? ink : mute, fontSize: 11, cursor: 'pointer'
      }
    }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
      sort.key === key ? h('span', { 'aria-hidden': true, style: { fontSize: 9 } }, sort.dir === 'asc' ? '▲' : '▼') : null)
    const listHeader = h('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px 76px 78px', gap: 8,
        alignItems: 'center', height: 28, padding: '0 14px', color: mute, fontSize: 11, flex: '0 0 auto'
      }
    }, sortHeader('name', '名称'), sortHeader('mtime', '修改日期'),
      h('span', null, '类型'), sortHeader('size', '大小', 'right'))
    let body = null
    if (!directory) {
      body = h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: mute, fontSize: 12, padding: 24, textAlign: 'center' } },
        error ? h('span', { role: 'alert', style: { color: danger } }, error) : '从左侧选择工作区或磁盘')
    } else if (entries === null) {
      body = h('div', {
        style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: mute, fontSize: 12, padding: 24, textAlign: 'center' }
      }, error
        ? h('span', { role: 'alert', style: { color: danger } }, error)
        : busy ? '正在读取目录…' : '目录暂不可用')
    } else if (!visibleEntries.length) {
      body = h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 8, color: mute, fontSize: 12, padding: 24, textAlign: 'center' } },
        h('span', null, term ? '未找到匹配 “' + search.trim() + '” 的项目' : '空文件夹'),
        term ? h('button', {
          type: 'button', onClick: () => setSearch(''), className: 'tether-hover',
          style: { ...mutedButton, padding: '4px 10px' }
        }, '清除搜索') : null)
    } else {
      body = h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 8px 18px' } },
        listHeader,
        visibleEntries.map((item) => row(item)))
    }
    const notice = error && directory && entries !== null
      ? h('div', { role: 'alert', style: { padding: '6px 14px', color: danger, fontSize: 12, borderBottom: '1px solid ' + line } }, error)
      : null
    const busyLine = status
      ? h('div', { role: 'status', style: { padding: '4px 14px', color: sub, fontSize: 11.5, borderBottom: '1px solid ' + line } }, status)
      : null
    const dialog = open ? h('div', {
      style: {
        position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'rgba(16, 24, 40, 0.45)'
      },
      onClick: (event) => { if (event && event.target === event.currentTarget) close() }
    },
      h('div', {
        role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tether-target-file-title',
        onClick: (event) => { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
        style: {
          width: 'min(880px, 100%)', height: 'min(600px, 100%)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', background: bg, color: ink, border: '1px solid ' + line, borderRadius: 12,
          boxShadow: 'var(--dsw-elevation-panel, 0 24px 64px rgba(16, 24, 40, 0.28))', font: 'inherit'
        }
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
            borderBottom: '1px solid ' + line, flex: '0 0 auto'
          }
        },
          h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
            h('div', { id: 'tether-target-file-title', style: { fontSize: 15, fontWeight: 600, color: ink } }, '从目标电脑选择文件'),
            h('div', {
              style: {
                marginTop: 2, color: mute, fontSize: 11.5, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }
            }, device ? '目标电脑 · ' + device : '正在确认目标电脑…')),
          h('button', {
            type: 'button', 'aria-label': '关闭', title: '关闭', onClick: close,
            style: {
              width: 28, height: 28, flex: '0 0 auto', border: 0, borderRadius: 6,
              background: 'transparent', color: sub, fontSize: 18, lineHeight: '22px',
              cursor: 'pointer'
            }
          }, '×')),
        h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
          busyLine,
          TargetFileExplorer({
            React,
            sort,
            onSort: setSort,
            search,
            onSearch: setSearch,
            colors: { bg, soft, ink, sub, mute, line, hover, red: danger },
            roots: [
              ...workspaces.map((item) => ({ name: item.name, path: item.path, kind: 'workspace' })),
              ...drives.map((item) => ({ name: item.name, path: item.path, kind: 'drive' }))
            ],
            rootPath: root,
            path: directory,
            entries,
            loading: busy,
            error,
            disabled: busy,
            singleClickOpens: true,
            editablePath: false,
            onRoot: (next) => { void enter({ path: next }, true) },
            onPath: (next) => { void enter({ path: next }, false) },
            onSelect: () => {},
            onOpen: (item) => { if (item.dir) void enter(item, false); else void choose(item) },
            onRefresh: (next) => { void enter({ path: next }, false) },
            fileIcon,
            formatTime: formatTargetTime,
            formatSize: formatTargetSize,
            limit: DSH_TARGET_ATTACHMENT_LIMIT
          })),
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
            borderTop: '1px solid ' + line, flex: '0 0 auto'
          }
        },
          h('span', { style: { flex: '1 1 auto', color: mute, fontSize: 11.5 } }, '文件从目标电脑读取，单个附件上限 10 MiB。'),
          h('button', { type: 'button', onClick: close, style: mutedButton }, '取消')))
      ) : null
    return h('div', { ref: containerRef, style: { display: 'contents' } },
      h(Native.ComposerAttachments, { ...props, readFileDrag: props.readFileDrag }),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
        h('button', {
          type: 'button', title: '从当前目标电脑选择文件',
          onClick: () => { void openPicker() }, disabled: busy,
          style: { ...mutedButton, cursor: busy ? 'default' : 'pointer' }
        }, '目标电脑文件…')),
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
