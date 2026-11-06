const AGENT_CACHE_KEY = 'tether-agent-cache-v1'
const catalogs = new Map()
const harnesses = new Map()

function load() {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(AGENT_CACHE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return
    for (const [device, value] of Object.entries(data.catalogs || {})) catalogs.set(device, value)
    for (const [device, value] of Object.entries(data.harnesses || {})) {
      if (Array.isArray(value)) harnesses.set(device, value)
    }
  } catch (_) { /* private mode or corrupt cache */ }
}

function persist() {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(AGENT_CACHE_KEY, JSON.stringify({
      catalogs: Object.fromEntries(catalogs),
      harnesses: Object.fromEntries(harnesses)
    }))
  } catch (_) { /* storage quota or private mode */ }
}

load()

export function readCatalog(device) {
  return device ? (catalogs.get(device) || null) : null
}

export function writeCatalog(device, data) {
  if (!device || !data) return
  catalogs.set(device, data)
  persist()
}

export function readHarnesses(device) {
  return device ? (harnesses.get(device) || null) : null
}

export function writeHarnesses(device, data) {
  if (!device || !Array.isArray(data)) return
  harnesses.set(device, data)
  persist()
}
