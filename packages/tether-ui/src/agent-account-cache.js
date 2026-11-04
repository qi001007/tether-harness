const KEY = 'tether-account-cache-v1'
const memory = new Map()

function load() {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return
    for (const [key, value] of Object.entries(data)) memory.set(key, value)
  } catch (_) { /* private mode or corrupt cache */ }
}

function persist() {
  try {
    if (typeof localStorage === 'undefined') return
    const data = {}
    for (const [key, value] of memory) data[key] = value
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch (_) { /* storage quota or private mode */ }
}

load()

const cacheKey = (device, agent) => String(device || '') + '|' + String(agent || '')

export function readAccount(device, agent) {
  if (!device || !agent) return null
  return memory.get(cacheKey(device, agent)) || null
}

export function writeAccount(device, agent, data) {
  if (!device || !agent || !data) return
  memory.set(cacheKey(device, agent), data)
  persist()
}
