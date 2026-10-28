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

export function createDshHost({ apiBase = DSH_API_BASE, pluginVersion = null, localPluginUpdates, localDeviceIdentity } = {}) {
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
