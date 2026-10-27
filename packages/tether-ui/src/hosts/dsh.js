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

export function createDshHost({ apiBase = DSH_API_BASE } = {}) {
  return {
    kind: 'dsh',
    apiBase: () => apiBase,
    apiBases: () => {
      const hub = storedHub()
      return hub ? [hub.url.replace(/\/+$/, ''), DSH_APP_BASE, apiBase] : [DSH_APP_BASE, apiBase]
    },
    apiHeaders: () => {
      const hub = storedHub()
      return hub ? { Authorization: 'Bearer ' + hub.token } : {}
    }
  }
}
