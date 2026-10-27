export const DSH_API_BASE = 'http://127.0.0.1:18890'
export const DSH_APP_BASE = 'http://127.0.0.1:18892'

export function createDshHost({ apiBase = DSH_API_BASE } = {}) {
  return {
    kind: 'dsh',
    apiBase: () => apiBase,
    apiBases: () => [DSH_APP_BASE, apiBase]
  }
}
