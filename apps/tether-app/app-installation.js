const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
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

function processStartedAt(pid) {
  if (process.platform === 'win32') {
    const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($null -eq $p) { exit 2 }; $p.CreationDate.ToUniversalTime().ToString('o')`
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    })
    if (result.status !== 0) return null
    const value = Date.parse(String(result.stdout || '').trim())
    return Number.isFinite(value) ? value : null
  }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
  })
  if (result.status !== 0) return null
  const value = Date.parse(String(result.stdout || '').trim())
  return Number.isFinite(value) ? value : null
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error && error.code === 'EPERM' }
}

function lstatIfPresent(target) {
  try { return fs.lstatSync(target) } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

function processName(pid) {
  const script = process.platform === 'win32'
    ? `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($null -eq $p) { exit 2 }; [IO.Path]::GetFileNameWithoutExtension($p.Name)`
    : null
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    })
    : spawnSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    })
  if (result.status !== 0) return null
  return path.basename(String(result.stdout || '').trim()).replace(/\.exe$/i, '').toLowerCase() || null
}

function assertCodegRuntimeStopped(dataDir) {
  const runtimePath = path.join(dataDir, 'agents-runtime', 'runtime.json')
  const info = lstatIfPresent(runtimePath)
  if (!info) return
  if (!info.isFile() || info.isSymbolicLink()) {
    throw Object.assign(new Error('Legacy Codeg runtime state is not a plain file; refusing data migration.'), { code: 'app_migration_codeg_state_invalid' })
  }
  let state
  try { state = JSON.parse(fs.readFileSync(runtimePath, 'utf8')) } catch (_) {
    throw Object.assign(new Error('Legacy Codeg runtime state cannot be read; refusing data migration.'), { code: 'app_migration_codeg_state_invalid' })
  }
  const pid = Number(state.pid || 0)
  if (!Number.isSafeInteger(pid) || pid <= 0 || !pidAlive(pid)) return
  const name = processName(pid)
  if (name === null) {
    throw Object.assign(new Error('Cannot verify the legacy Codeg process; close it before migration.'), { code: 'app_migration_codeg_process_unverified' })
  }
  if (name === 'codeg-server') {
    throw Object.assign(new Error('The legacy Codeg service is still running; close it before migration.'), { code: 'app_migration_waiting_for_codeg' })
  }
}

function copyPersistentAgentsTree(source, target, isRoot = true) {
  const info = fs.lstatSync(source)
  if (info.isSymbolicLink()) {
    throw Object.assign(new Error('Legacy Codeg data contains a symbolic link or reparse point; refusing data migration.'), { code: 'app_migration_codeg_source_invalid' })
  }
  if (info.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 })
    for (const name of fs.readdirSync(source)) {
      if (isRoot && (name === 'runtime.json' || name === 'server.log')) continue
      copyPersistentAgentsTree(path.join(source, name), path.join(target, name), false)
    }
    return
  }
  if (!info.isFile()) {
    throw Object.assign(new Error('Legacy Codeg data contains an unexpected file type; refusing data migration.'), { code: 'app_migration_codeg_source_invalid' })
  }
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
}

function securePrivateTree(directory) {
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name)
    const info = fs.lstatSync(target)
    if (info.isSymbolicLink()) throw Object.assign(new Error('Copied Codeg data contains a symbolic link or reparse point.'), { code: 'app_migration_codeg_source_invalid' })
    if (info.isDirectory()) {
      fs.chmodSync(target, 0o700)
      securePrivateTree(target)
    } else if (info.isFile()) fs.chmodSync(target, 0o600)
  }
}

function dataCredential(dataDir, origin, device) {
  let config
  try { config = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub.json'), 'utf8')) } catch (_) { return null }
  const configuredOrigin = hubOrigin(config.url)
  const configuredDevice = String(config.device || '').trim()
  if ((configuredOrigin && configuredOrigin !== origin) || (configuredDevice && configuredDevice !== device)) return null
  let credential = String(config.nodeToken || '')
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'device-token.json'), 'utf8'))
    if (saved.device_id !== device || typeof saved.token !== 'string' || !saved.token) return null
    credential = saved.token
  } catch (_) { if (!credential || configuredDevice !== device) return null }
  return { config, fingerprint: credentialFingerprint(origin, device, credential) }
}

function hasExistingIdentity(dataDir) {
  let config
  try { config = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub.json'), 'utf8')) } catch (_) { return false }
  const device = String(config.device || '').trim()
  let credential = String(config.nodeToken || '')
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'device-token.json'), 'utf8'))
    if (saved.device_id !== device || typeof saved.token !== 'string' || !saved.token) return false
    credential = saved.token
  } catch (_) { /* older installations may keep the token only in hub.json */ }
  return !!(hubOrigin(config.url) && device && credential)
}

function findLegacyDataDirectory() {
  const directory = path.join(os.homedir(), '.tether', 'app-installations')
  let names
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith('.json')) } catch (_) { return null }
  const matches = []
  for (const name of names) {
    try {
      const info = fs.lstatSync(path.join(directory, name))
      if (!info.isFile() || info.isSymbolicLink()) continue
    } catch (_) { continue }
    let record
    try { record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) } catch (_) { continue }
    const origin = String(record.controller_origin || '').toLowerCase()
    const device = String(record.device_id || '').trim()
    const root = String(record.root || '')
    const pid = Number(record.pid)
    const startedAt = Number(record.process_started_at) * 1000
    if (record.schema !== 1 || !origin || !device || !path.isAbsolute(root) || !localRoot(root)
        || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(startedAt)) continue
    const dataDir = path.join(path.resolve(root), 'apps', 'tether-app', 'data')
    try {
      const expectedFile = installationId(origin, device) + '.json'
      if (name !== expectedFile) continue
      let markerPath = null
      const candidateMarker = path.join(directory, installationId(origin, device) + '.migration-source')
      if (fs.existsSync(candidateMarker)) {
        const markerInfo = fs.lstatSync(candidateMarker)
        if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) continue
        let marker
        try { marker = JSON.parse(fs.readFileSync(candidateMarker, 'utf8')) } catch (_) { continue }
        const snapshotData = String(marker.legacy_data_dir || '')
        if (marker.schema !== 1 || !path.isAbsolute(snapshotData) || !localRoot(snapshotData)) continue
        const resolvedSnapshot = path.resolve(snapshotData)
        const snapshotParent = path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Tether', 'migration-snapshots')
        const relativeSnapshot = path.relative(snapshotParent, resolvedSnapshot)
        if (relativeSnapshot === '' || relativeSnapshot.startsWith('..' + path.sep) || relativeSnapshot === '..'
            || path.isAbsolute(relativeSnapshot)) continue
        const expectedSnapshotData = path.join(snapshotParent, installationId(origin, device), 'apps', 'tether-app', 'data')
        if (process.platform === 'win32'
            ? resolvedSnapshot.toLowerCase() !== path.resolve(expectedSnapshotData).toLowerCase()
            : resolvedSnapshot !== path.resolve(expectedSnapshotData)) continue
        const markerParent = fs.lstatSync(directory)
        if (markerParent.isSymbolicLink() || !markerParent.isDirectory()) continue
        const snapshotRoot = path.join(snapshotParent, installationId(origin, device))
        const snapshotComponents = [snapshotParent, snapshotRoot, path.join(snapshotRoot, 'apps'),
          path.join(snapshotRoot, 'apps', 'tether-app'), resolvedSnapshot]
        if (snapshotComponents.some((component) => {
          const info = fs.lstatSync(component)
          return info.isSymbolicLink() || !info.isDirectory()
        })) continue
        const credential = dataCredential(resolvedSnapshot, origin, device)
        if (!credential || credential.fingerprint !== record.credential_fingerprint) continue
        markerPath = candidateMarker
        matches.push({ record, dataDir: resolvedSnapshot, config: credential.config, pid, startedAt, markerPath })
        continue
      }
      if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(dataDir).isSymbolicLink() || !fs.statSync(dataDir).isDirectory()) continue
      const credential = dataCredential(dataDir, origin, device)
      if (!credential || credential.fingerprint !== record.credential_fingerprint) continue
      matches.push({ record, dataDir, config: credential.config, pid, startedAt, markerPath })
    } catch (_) { /* an old installation can already have been removed */ }
  }
  if (matches.length > 1) throw Object.assign(new Error('More than one registered APP installation matches this device; refusing automatic data migration.'), { code: 'app_migration_ambiguous' })
  return matches[0] || null
}

function assertLegacyProcessesStopped(match) {
  if (pidAlive(match.pid)) {
    const actual = processStartedAt(match.pid)
    if (actual === null) throw Object.assign(new Error('Cannot verify the registered APP process; close the old APP before migration.'), { code: 'app_migration_process_unverified' })
    if (Math.abs(actual - match.startedAt) <= 5000) {
      throw Object.assign(new Error('The registered old APP is still running; close it before migration.'), { code: 'app_migration_waiting_for_app' })
    }
  }
  const nodeStatePath = path.join(match.dataDir, 'private', 'managed-node-process.json')
  if (!fs.existsSync(nodeStatePath)) return
  let state
  try { state = JSON.parse(fs.readFileSync(nodeStatePath, 'utf8')) } catch (_) {
    throw Object.assign(new Error('The old managed Node ownership record cannot be read; refusing data migration.'), { code: 'app_migration_node_identity_invalid' })
  }
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || typeof state.token !== 'string' || state.token.length < 32
      || path.resolve(String(state.dataDir || '')) !== path.resolve(match.dataDir)
      || String(state.device || '') !== match.record.device_id
      || hubOrigin(state.controllerUrl) !== match.record.controller_origin) {
    throw Object.assign(new Error('The old managed Node ownership record is invalid or mismatched; refusing data migration.'), { code: 'app_migration_node_identity_invalid' })
  }
  if (pidAlive(state.pid)) {
    throw Object.assign(new Error('The old managed Node is still running; close it from the old APP before migration.'), { code: 'app_migration_waiting_for_node' })
  }
}

function migrateLegacyData({ dataDir, candidateMode, dataDirOverride }) {
  if (candidateMode || dataDirOverride) {
    fs.mkdirSync(dataDir, { recursive: true })
    return null
  }
  fs.mkdirSync(path.dirname(dataDir), { recursive: true })
  if (fs.existsSync(dataDir)) {
    const targetInfo = fs.lstatSync(dataDir)
    if (targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) {
      throw Object.assign(new Error('The new APP data path is not a real directory; refusing migration.'), { code: 'app_migration_target_invalid' })
    }
    if (fs.readdirSync(dataDir).length) {
      if (hasExistingIdentity(dataDir)) return null
      throw Object.assign(new Error('The new APP data directory is not empty; refusing to merge identities.'), { code: 'app_migration_target_not_empty' })
    }
  }
  const match = findLegacyDataDirectory()
  if (!match) {
    fs.mkdirSync(dataDir, { recursive: true })
    return null
  }
  assertLegacyProcessesStopped(match)
  assertCodegRuntimeStopped(match.dataDir)
  const whitelist = ['hub.json', 'device-token.json', 'policy.json', 'node-hub.db', 'node-hub.db-wal', 'node-local.db', 'node-local.db-wal', 'apps.json']
  const agentsSource = path.join(match.dataDir, 'agents-runtime')
  let copyAgents = false
  {
    const info = lstatIfPresent(agentsSource)
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error('Legacy Codeg data path is not a plain directory; refusing data migration.'), { code: 'app_migration_codeg_source_invalid' })
      copyAgents = true
    }
  }
  const credential = dataCredential(match.dataDir, match.record.controller_origin, match.record.device_id)
  if (!credential || credential.fingerprint !== match.record.credential_fingerprint) {
    throw Object.assign(new Error('Legacy device identity did not match the registered APP; refusing migration.'), { code: 'app_migration_identity_mismatch' })
  }
  for (const filename of whitelist) {
    const source = path.join(match.dataDir, filename)
    const info = lstatIfPresent(source)
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink()) throw Object.assign(new Error('Legacy APP data contains an unexpected file type; refusing migration.'), { code: 'app_migration_source_invalid' })
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const parent = path.dirname(dataDir)
  const backup = path.join(parent, path.basename(dataDir) + '.migration-backup-' + stamp)
  const stage = path.join(parent, path.basename(dataDir) + '.migration-stage-' + process.pid)
  fs.mkdirSync(backup, { mode: 0o700 })
  fs.mkdirSync(stage, { mode: 0o700 })
  try {
    for (const filename of whitelist) {
      const source = path.join(match.dataDir, filename)
      if (!lstatIfPresent(source)) continue
      if (filename === 'hub.json') {
        const normalized = { ...credential.config, url: match.record.controller_origin, device: match.record.device_id }
        fs.writeFileSync(path.join(backup, filename), JSON.stringify(normalized, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      } else {
        fs.copyFileSync(source, path.join(backup, filename), fs.constants.COPYFILE_EXCL)
      }
      fs.copyFileSync(path.join(backup, filename), path.join(stage, filename), fs.constants.COPYFILE_EXCL)
    }
    if (copyAgents) {
      copyPersistentAgentsTree(agentsSource, path.join(backup, 'agents-runtime'))
      copyPersistentAgentsTree(agentsSource, path.join(stage, 'agents-runtime'))
    }
    if (process.platform !== 'win32') {
      for (const directoryPath of [backup, stage]) fs.chmodSync(directoryPath, 0o700)
      for (const directoryPath of [backup, stage]) {
        for (const filename of whitelist) {
          const target = path.join(directoryPath, filename)
          if (fs.existsSync(target)) fs.chmodSync(target, 0o600)
        }
        const agentsTarget = path.join(directoryPath, 'agents-runtime')
        if (fs.existsSync(agentsTarget)) securePrivateTree(agentsTarget)
      }
    }
    const copied = dataCredential(stage, match.record.controller_origin, match.record.device_id)
    if (!copied || copied.fingerprint !== match.record.credential_fingerprint) {
      throw Object.assign(new Error('Legacy device identity did not verify after backup; refusing migration.'), { code: 'app_migration_identity_verification_failed' })
    }
    if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length === 0) fs.rmdirSync(dataDir)
    fs.renameSync(stage, dataDir)
    if (process.platform !== 'win32') {
      for (const filename of ['hub.json', 'device-token.json']) {
        const target = path.join(dataDir, filename)
        if (fs.existsSync(target)) fs.chmodSync(target, 0o600)
      }
    }
    if (match.markerPath) fs.unlinkSync(match.markerPath)
    return { source: match.dataDir, backup }
  } catch (error) {
    throw error
  }
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

module.exports = { hubOrigin, installationId, credentialFingerprint, migrateLegacyData, registerAppInstallation }
