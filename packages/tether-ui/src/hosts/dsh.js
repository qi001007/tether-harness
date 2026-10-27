export const DSH_API_BASE = 'http://127.0.0.1:18890'

export function createDshHost({ apiBase = DSH_API_BASE } = {}) {
  return {
    kind: 'dsh',
    apiBase: () => apiBase
  }
}