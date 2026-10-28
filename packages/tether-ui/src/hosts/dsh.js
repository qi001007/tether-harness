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
    const body = action === 'apply' ? { prepared_id: payload.prepared_id } : {}
    const reply = await rpc.call('/tether-updates', action, body)
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

export function createDshTargetFilesBridge({ getRpc, getRemote, makeFile = (...args) => new File(...args) } = {}) {
  const capabilities = new Map()
  const identity = async () => {
    const rpc = typeof getRpc === 'function' ? getRpc() : null
    if (!rpc || typeof rpc.call !== 'function') throw new Error('当前 DSH 没有目标设备文件通道')
    const reply = await rpc.call('/tether-identity', 'get', {})
    const value = reply && (reply.value || reply.result || reply)
    if (!value || typeof value.device_id !== 'string' || !value.device_id) {
      throw new Error('当前 DSH 无法确认目标设备身份')
    }
    return value.device_id
  }
  const scopeFor = (sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('请先选择一个 DSH 会话')
    let scope = capabilities.get(sessionId)
    if (!scope) {
      scope = { directories: new Set(['.']), files: new Map(), deviceId: null }
      capabilities.set(sessionId, scope)
    }
    return scope
  }
  const remote = () => {
    const value = typeof getRemote === 'function' ? getRemote() : null
    if (!value?.workspaceFiles) throw new Error('当前 DSH 不提供会话工作区文件权限')
    return value.workspaceFiles
  }
  const assertScope = async (expectedDevice) => {
    if (await identity() !== expectedDevice) throw new Error('目标设备已切换，请重新选择文件')
  }
  const unwrap = (result) => {
    if (!result || result.ok !== true) throw new Error(result?.error?.message || result?.error || 'DSH 拒绝读取此会话文件')
    return result.value
  }
  const signal = () => AbortSignal.timeout(15_000)
  const pathOf = (parent, name) => parent === '.' ? name : `${parent.replace(/\/$/, '')}/${name}`
  const run = async (sessionId, operation) => {
    const scope = scopeFor(sessionId)
    const deviceId = await identity()
    if (scope.deviceId !== null && scope.deviceId !== deviceId) {
      scope.directories = new Set()
      scope.files.clear()
      scope.deviceId = null
      throw new Error('目标设备已切换，请重新选择文件')
    }
    scope.deviceId = deviceId
    const result = await operation(deviceId)
    await assertScope(deviceId)
    return result
  }

  return {
    async getRoots(sessionId) {
      return run(sessionId, async (deviceId) => {
        const listing = unwrap(await remote().list(sessionId, '.', signal()))
        if (!Array.isArray(listing.entries)) throw new Error('DSH 工作区目录格式无效')
        const scope = scopeFor(sessionId)
        scope.directories = new Set(['.'])
        scope.files.clear()
        const entries = listing.entries.map(entry => {
          const path = pathOf('.', entry.name)
          if (entry.type === 'directory') scope.directories.add(path)
          else if (entry.type === 'file' && Number.isSafeInteger(entry.size) && entry.size >= 0) {
            scope.files.set(path, { name: entry.name, size: entry.size })
          }
          return { name: entry.name, path, size: entry.size, dir: entry.type === 'directory' }
        }).filter(entry => entry.dir || scope.files.has(entry.path))
        return { deviceId, root: { name: '当前会话工作区', path: '.', dir: true, group: '工作区' }, entries }
      })
    },
    async listDirectory(sessionId, path) {
      const scope = scopeFor(sessionId)
      if (!scope.directories.has(path)) throw new Error('只能打开当前会话工作区中已列出的目录')
      return run(sessionId, async () => {
        const listing = unwrap(await remote().list(sessionId, path, signal()))
        if (!Array.isArray(listing.entries)) throw new Error('DSH 目录返回格式无效')
        const prefix = path === '.' ? '' : `${path.replace(/\/$/, '')}/`
        for (const child of [...scope.directories]) {
          if (child !== path && child.startsWith(prefix)) scope.directories.delete(child)
        }
        for (const child of scope.files.keys()) {
          if (child.startsWith(prefix)) scope.files.delete(child)
        }
        const entries = listing.entries.map(entry => {
          const childPath = pathOf(path, entry.name)
          if (entry.type === 'directory') scope.directories.add(childPath)
          else if (entry.type === 'file' && Number.isSafeInteger(entry.size) && entry.size >= 0) {
            scope.files.set(childPath, { name: entry.name, size: entry.size })
          }
          return { name: entry.name, path: childPath, size: entry.size, dir: entry.type === 'directory' }
        }).filter(entry => entry.dir || scope.files.has(entry.path))
        return entries
      })
    },
    async readFile(sessionId, entry) {
      if (!entry || entry.dir || typeof entry.path !== 'string' || !entry.path) throw new Error('请选择一个文件')
      const scope = scopeFor(sessionId)
      const listed = scope.files.get(entry.path)
      if (!listed || listed.name !== entry.name || listed.size !== entry.size) throw new Error('只能读取当前工作区刚列出的文件')
      const size = listed.size
      if (!Number.isSafeInteger(size) || size < 0 || size > DSH_TARGET_ATTACHMENT_LIMIT) {
        throw new Error('单个附件不能超过 10 MiB')
      }
      return run(sessionId, async () => {
        const chunks = []
        let version
        let absolutePath
        for (let offset = 0; offset < size; offset += DSH_TARGET_ATTACHMENT_CHUNK) {
          const limit = Math.min(DSH_TARGET_ATTACHMENT_CHUNK, size - offset)
          const data = unwrap(await remote().readBytes(sessionId, entry.path, { range: { offset, length: limit } }, signal()))
          if (data.offset !== offset || (data.bytes !== undefined && data.bytes !== size)
            || typeof data.version !== 'string' || typeof data.absolutePath !== 'string'
            || (version !== undefined && (data.version !== version || data.absolutePath !== absolutePath))
            || !(data.data instanceof Uint8Array) || data.data.length !== limit) {
            throw new Error('DSH 返回的文件字节不完整')
          }
          version = data.version
          absolutePath = data.absolutePath
          chunks.push(data.data)
        }
        const extension = (entry.name || entry.path).split('.').pop().toLowerCase()
        const type = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })[extension]
        return makeFile(chunks, entry.name || entry.path.split(/[\\/]/).pop() || 'attachment', {
          type: type || 'application/octet-stream', lastModified: Date.now()
        })
      })
    }
  }
}

export async function addDshTargetAttachment(owner, bridge, sessionId, entry, isCurrent = () => true) {
  const onAddFiles = owner && owner.onAddFiles
  if (typeof onAddFiles !== 'function') throw new Error('当前会话不接受附件')
  const file = await bridge.readFile(sessionId, entry)
  if (!isCurrent()) throw new Error('当前会话已切换，请重新选择文件')
  onAddFiles([file])
  return file
}

export function createDshTargetAttachments(React, Native, bridge) {
  const h = React.createElement
  return function DshTargetAttachments(props) {
    const [open, setOpen] = React.useState(false)
    const [roots, setRoots] = React.useState([])
    const [entries, setEntries] = React.useState(null)
    const [directory, setDirectory] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const mounted = React.useRef(true)
    const scope = React.useRef({})
    const activeSession = React.useRef(props.sessionId)
    if (activeSession.current !== props.sessionId) {
      activeSession.current = props.sessionId
      scope.current = {}
    }
    React.useEffect(() => {
      mounted.current = true
      return () => { mounted.current = false; scope.current = {} }
    }, [])
    React.useEffect(() => {
      setOpen(false); setRoots([]); setEntries(null); setDirectory(null); setError('')
    }, [props.sessionId])
    const openPicker = async () => {
      setOpen(true); setBusy(true); setError(''); setDirectory(null); setEntries(null)
      try {
        const result = await bridge.getRoots(props.sessionId)
        if (mounted.current && activeSession.current === props.sessionId) {
          setRoots([result.root]); setDirectory(result.root); setEntries(result.entries)
        }
      }
      catch (cause) { if (mounted.current) setError(cause.message || '读取目标设备目录失败') }
      finally { if (mounted.current) setBusy(false) }
    }
    const enterDirectory = async (item) => {
      setBusy(true); setError('')
      try {
        const result = await bridge.listDirectory(props.sessionId, item.path)
        if (mounted.current && activeSession.current === props.sessionId) { setDirectory(item); setEntries(result) }
      }
      catch (cause) { if (mounted.current) setError(cause.message || '读取目标目录失败') }
      finally { if (mounted.current) setBusy(false) }
    }
    const pick = async (item) => {
      const currentScope = scope.current
      setBusy(true); setError('')
      try {
        await addDshTargetAttachment(props, bridge, props.sessionId, item,
          () => mounted.current && activeSession.current === props.sessionId && scope.current === currentScope)
      }
      catch (cause) { if (mounted.current) setError(cause.message || '读取目标文件失败') }
      finally { if (mounted.current) setBusy(false) }
    }
    const buttonStyle = { border: '1px solid var(--dsw-alias-border-l1, #d0d5dd)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-secondary, #475467)', padding: '4px 8px', cursor: 'pointer', font: 'inherit' }
    const picker = open ? h('div', { role: 'dialog', 'aria-label': '选择目标设备文件', style: { position: 'relative', margin: '6px 0', padding: 10, border: '1px solid var(--dsw-alias-border-l1, #d0d5dd)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #101828)', maxHeight: 260, overflow: 'auto' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
        h('strong', null, directory ? directory.name : '目标设备文件'),
        h('button', { type: 'button', onClick: () => { setOpen(false); scope.current = {} }, 'aria-label': '关闭文件选择器' }, '×')),
      directory ? h('button', { type: 'button', style: buttonStyle, onClick: () => { setDirectory(null); setEntries(null) }, disabled: busy }, '返回会话工作区') : null,
      busy ? h('div', { role: 'status', style: { padding: '8px 2px' } }, '读取中…') : null,
      error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #b42318)', padding: '6px 2px' } }, error) : null,
      !directory ? roots.map((item, index) => h('button', { key: `${item.group}:${item.path}:${index}`, type: 'button', onClick: () => { void enterDirectory(item) }, disabled: busy, style: { ...buttonStyle, display: 'block', width: '100%', textAlign: 'left', marginTop: 5 } }, `${item.group} · ${item.name}`)) : null,
      entries ? entries.map((item) => h('button', { key: item.path, type: 'button', onClick: () => { if (item.dir) void enterDirectory(item); else void pick(item) }, disabled: busy || (item.size > DSH_TARGET_ATTACHMENT_LIMIT), style: { ...buttonStyle, display: 'block', width: '100%', textAlign: 'left', marginTop: 5, opacity: item.size > DSH_TARGET_ATTACHMENT_LIMIT ? 0.55 : 1 } }, `${item.dir ? '📁' : '📄'} ${item.name}${!item.dir && item.size > DSH_TARGET_ATTACHMENT_LIMIT ? ' · 超过 10 MiB' : ''}`)) : null,
      h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #667085)' } }, '文件从当前 DSH 会话工作区读取，单个附件上限 10 MiB。')) : null
    return h(React.Fragment, null,
      h(Native.ComposerAttachments, { ...props, readFileDrag: props.readFileDrag }),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
        h('button', { type: 'button', onClick: () => { void openPicker() }, disabled: busy || !props.canAcceptDrop || !props.sessionId, style: buttonStyle }, '目标设备文件…')),
      picker)
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
    apiHeaders: (base) => {
      const hub = storedHub()
      const normalize = (value) => String(value || '').replace(/\/+$/, '')
      return hub && normalize(base) === normalize(hub.url)
        ? { Authorization: 'Bearer ' + hub.token }
        : {}
    }
  }
}
