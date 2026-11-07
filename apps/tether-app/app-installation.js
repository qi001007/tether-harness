const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function hubOrigin(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.origin.toLowerCase()
  } catch (_) { return '' }
}

function installationId(origin, device) {
  return crypto.createHash('sha256').update(origin + '\n' + device).digest('hex')
}

function credentialFingerprint(origin, device, credential) {
  if (!credential) return ''
  return crypto.createHash('sha256').update(origin + '\n' + device + '\n' + credential).digest('hex')
}

function localRoot(root) {
  const resolved = path.resolve(root)
  return path.isAbsolute(resolved) && !resolved.startsWith('\\\\') && !resolved.startsWith('//')
}

function registerAppInstallation({ env, dataDir, appRoot, startedAt = Date.now() - process.uptime() * 1000, startedVersion }) {
  if (env.TETHER_APP_BINDING === '0'
      || (env.TETHER_APP_BINDING !== '1' && env.TETHER_NO_SHORTCUTS === '1')) return null
  const configPath = path.join(dataDir, 'hub.json')
  let config
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (_) { return null }
  const origin = hubOrigin(config.url || env.TETHER_CONTROLLER_URL)
  const device = String(config.device || env.TETHER_DEVICE || '').trim()
  let credential = String(config.nodeToken || env.TETHER_NODE_TOKEN || '')
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'device-token.json'), 'utf8'))
    if (saved.device_id === device && typeof saved.token === 'string' && saved.token) credential = saved.token
  } catch (_) { /* use the configured node credential */ }
  const fingerprint = credentialFingerprint(origin, device, credential)
  const root = path.resolve(appRoot)
  if (!origin || !device || !fingerprint || !localRoot(root)) return null
  let version = ''
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'))
    version = String(startedVersion === undefined ? metadata.components && metadata.components.app || '' : startedVersion)
  } catch (_) { return null }
  const record = {
    schema: 1,
    controller_origin: origin,
    device_id: device,
    root,
    pid: process.pid,
    process_started_at: Number(startedAt) / 1000,
    started_version: version,
    credential_fingerprint: fingerprint
  }
  const directory = path.join(os.homedir(), '.tether', 'app-installations')
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, installationId(origin, device) + '.json')
  const temporary = target + '.' + process.pid + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temporary, target)
  return target
}

module.exports = { hubOrigin, installationId, credentialFingerprint, registerAppInstallation }
