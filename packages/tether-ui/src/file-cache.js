const DEFAULT_TTL = 20_000
const MAX_DIRS = 240

const directories = new Map()
const pending = new Map()

export function normalizeDirectoryPath(value) {
  let text = String(value || '')
  if (/^[A-Za-z]:$/.test(text)) return text + '\\'
  text = text.replace(/[\\/]+$/, '') || text
  if (/^[A-Za-z]:[\\/]/.test(text)) text = text.replace(/\//g, '\\')
  return text
}

function directoryKey(deviceId, path) {
  return String(deviceId || '') + '|' + normalizeDirectoryPath(path).toLowerCase()
}

export function peekDirectory(deviceId, path, ttl = DEFAULT_TTL) {
  if (!deviceId || !path) return null
  const key = directoryKey(deviceId, path)
  const hit = directories.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttl) {
    directories.delete(key)
    return null
  }
  directories.delete(key)
  directories.set(key, hit)
  return hit.entries
}

export function rememberDirectory(deviceId, path, entries) {
  if (!deviceId || !path || !Array.isArray(entries)) return entries
  const key = directoryKey(deviceId, path)
  directories.delete(key)
  directories.set(key, { entries, at: Date.now() })
  while (directories.size > MAX_DIRS) directories.delete(directories.keys().next().value)
  return entries
}

export function clearDirectoryCache() {
  directories.clear()
  pending.clear()
}

export function invalidateDirectory(deviceId, path) {
  if (!deviceId) {
    clearDirectoryCache()
    return
  }
  if (!path) {
    const prefix = String(deviceId) + '|'
    for (const key of [...directories.keys()]) if (key.startsWith(prefix)) directories.delete(key)
    for (const key of [...pending.keys()]) if (key.startsWith(prefix)) pending.delete(key)
    return
  }
  const key = directoryKey(deviceId, path)
  directories.delete(key)
  pending.delete(key)
  const childPrefixes = [key + '\\', key + '/']
  for (const candidate of [...directories.keys()]) {
    if (candidate.startsWith(key) && childPrefixes.some((prefix) => candidate.startsWith(prefix))) {
      directories.delete(candidate)
    }
  }
}

export async function loadDirectory({ deviceId, path, load, fresh = false, ttl = DEFAULT_TTL }) {
  const key = directoryKey(deviceId, path)
  if (!fresh) {
    const cached = peekDirectory(deviceId, path, ttl)
    if (cached) return cached
    const running = pending.get(key)
    if (running) return running
  }
  const task = Promise.resolve()
    .then(load)
    .then((entries) => {
      rememberDirectory(deviceId, path, entries)
      return entries
    })
    .finally(() => {
      if (pending.get(key) === task) pending.delete(key)
    })
  pending.set(key, task)
  return task
}

export function directoryCacheStats() {
  return { entries: directories.size, pending: pending.size }
}