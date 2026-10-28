import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile as nodeExecFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const DEFAULT_TIMEOUT_MS = 120_000
const PREPARED_ID = /^[a-f0-9]{32}$/
const ACTIONS = new Set(['status', 'check', 'prepare', 'apply'])
const SAFE_ENV_KEYS = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'DSH_HOME']
const UPDATER_FILES = ['tether/__init__.py', 'tether/updates.py', 'tether/updates_cli.py', 'tether/release.py', 'tether/ed25519.py', 'tether/node/__init__.py', 'tether/node/dsh_sessions.py']

const execFile = promisify(nodeExecFile)

function selectedDshHome(env, homeDir, packageRoot) {
  const candidates = []
  if (env.DSH_HOME) candidates.push(env.DSH_HOME)
  if (packageRoot) {
    let cursor = path.resolve(packageRoot)
    while (true) {
      if (path.basename(cursor) === 'profiles') {
        candidates.push(path.dirname(cursor))
        break
      }
      const parent = path.dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  }
  if (process.execPath) candidates.push(path.join(path.dirname(process.execPath), '.dsh'))
  candidates.push(path.join(homeDir, '.dsh'))
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    try {
      if (fs.statSync(path.join(resolved, 'profiles')).isDirectory()) return resolved
    } catch (_) { /* try the next candidate */ }
  }
  return path.resolve(env.DSH_HOME || path.join(homeDir, '.dsh'))
}

function profileFromArgv(dshHome, argv) {
  const profilesRoot = path.resolve(dshHome, 'profiles')
  for (const arg of argv || []) {
    if (typeof arg !== 'string' || !arg) continue
    const match = /^--profile(?:=|\s+)([A-Za-z0-9_-]{1,80})$/.exec(arg)
    if (match) return match[1]
    if (!path.isAbsolute(arg)) continue
    const relative = path.relative(profilesRoot, path.resolve(arg))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue
    const parts = relative.split(path.sep)
    if (parts.length === 1 && /^[A-Za-z0-9_-]{1,80}$/.test(parts[0])) return parts[0]
  }
  return undefined
}

function profileFromPackageRoot(packageRoot, dshHome) {
  const absolute = path.resolve(packageRoot)
  const profilesRoot = path.join(path.resolve(dshHome), 'profiles')
  const relative = path.relative(profilesRoot, absolute).split(path.sep)
  if (relative.length !== 3 || !relative[0] || relative[1] !== 'node_modules' || relative[2] !== 'tether-dsh-surface'
      || relative[0] === '.' || relative[0] === '..') return undefined
  return relative[0]
}

function profileFromInstalledPackages(dshHome) {
  const profilesRoot = path.join(path.resolve(dshHome), 'profiles')
  let names
  try { names = fs.readdirSync(profilesRoot) } catch (_) { return undefined }
  const matches = []
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) continue
    const client = path.join(profilesRoot, name, 'node_modules', 'tether-dsh-client', 'package.json')
    try {
      if (fs.statSync(client).isFile()) matches.push({ name, mtime: fs.statSync(client).mtimeMs })
    } catch (_) { /* not a Tether profile */ }
  }
  if (!matches.length) return undefined
  const desktop = matches.find((item) => item.name === 'desktop')
  if (desktop) return desktop.name
  return matches.sort((left, right) => right.mtime - left.mtime)[0].name
}

function selectedProfile(packageRoot, dshHome, argv = process.argv, env = process.env) {
  const fromArgv = profileFromArgv(dshHome, argv)
  if (fromArgv) return fromArgv
  const fromPackageRoot = profileFromPackageRoot(packageRoot, dshHome)
  if (fromPackageRoot) return fromPackageRoot
  if (env.DSH_PROFILE && /^[A-Za-z0-9_-]{1,80}$/.test(env.DSH_PROFILE)) return env.DSH_PROFILE
  return profileFromInstalledPackages(dshHome)
}

function safeManifestUrl(value) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    if (url.username || url.password || url.hash) return undefined
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined
    return url.href
  } catch (_) { return undefined }
}

function readPluginVersion(directory) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    const source = fs.readFileSync(path.join(directory, 'lib', 'client.js'), 'utf8')
    const match = /\bPLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(source)
    const version = (match && match[1]) || manifest.version || null
    return version ? { version, directory } : null
  } catch (_) { return null }
}

function resolvePluginVersions(packageRoot, dshHome, profile) {
  const packageDirectory = path.resolve(packageRoot, '..')
  const siblingName = path.basename(packageDirectory) === 'packages' ? 'dsh-plugin-tether-client' : 'tether-dsh-client'
  const loaded = readPluginVersion(path.join(packageDirectory, siblingName))
  const installed = readPluginVersion(path.join(dshHome, 'profiles', profile || '', 'node_modules', 'tether-dsh-client'))
  const runtime = loaded || installed
  const drift = Boolean(loaded && installed && loaded.directory !== installed.directory && loaded.version !== installed.version)
  return {
    runtime: runtime ? runtime.version : null,
    installed: installed ? installed.version : null,
    source: drift && loaded ? loaded.version : null,
    drift
  }
}

function loadedPluginVersion(packageRoot, dshHome, profile) {
  return resolvePluginVersions(packageRoot, dshHome, profile).runtime
}

function safeEnvironment(env, dshHome) {
  const result = {}
  for (const key of SAFE_ENV_KEYS) {
    if (typeof env[key] === 'string') result[key] = env[key]
  }
  result.DSH_HOME = dshHome
  return result
}

function parsePayload(action, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload must be an object'
  const allowed = new Set(['prepared_id', 'manifest_url'])
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) return `${action} does not accept ${key}`
  }
  if ('manifest_url' in payload && !safeManifestUrl(payload.manifest_url)) return 'manifest_url must be a trusted HTTPS URL'
  if (action === 'apply') {
    if (typeof payload.prepared_id !== 'string' || !PREPARED_ID.test(payload.prepared_id)) {
      return 'apply requires a valid prepared_id'
    }
  } else if ('prepared_id' in payload) {
    return `${action} does not accept prepared_id`
  }
  return undefined
}

function parseResult(stdout) {
  const result = JSON.parse(String(stdout || '').trim())
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.ok !== 'boolean') {
    throw new Error('Updater returned an invalid result')
  }
  return result
}

function resolvePythonCandidates(env, platform) {
  if (env.TETHER_PYTHON) return [{ file: env.TETHER_PYTHON, prefix: [] }]
  return platform === 'win32'
    ? [{ file: 'python', prefix: [] }, { file: 'py', prefix: ['-3'] }]
    : [{ file: 'python3', prefix: [] }, { file: 'python', prefix: [] }]
}

export function createLocalPluginUpdateHandler({
  env = process.env,
  homeDir = os.homedir(),
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  execFileImpl = execFile,
  existsSync = fs.existsSync,
  platform = process.platform,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const dshHome = selectedDshHome(env, homeDir, packageRoot)
  const profile = selectedProfile(packageRoot, dshHome)
  const versions = resolvePluginVersions(packageRoot, dshHome, profile)
  const runtimeVersion = versions.runtime
  const updaterRoot = path.join(packageRoot, 'updater')
  const stateDir = path.join(dshHome, 'storages', 'tether', 'updates')
  const childEnv = safeEnvironment(env, dshHome)
  const inFlight = new Map()

  async function invoke(action, extraArgs = [], manifestUrl) {
    const args = ['-m', 'tether.updates_cli', action, '--component', 'plugin', '--root', updaterRoot,
      '--dsh-home', dshHome, '--state-dir', stateDir, '--profile', profile,
      ...(env.TETHER_DEVICE ? ['--device', env.TETHER_DEVICE] : []),
      ...(manifestUrl ? ['--manifest-url', manifestUrl] : []),
      ...extraArgs]
    const candidates = resolvePythonCandidates(env, platform)
    // Status/check must never outlive the UI's own wait, or the renderer reports
    // a failure while an orphan updater keeps downloading in the background.
    const actionTimeout = action === 'prepare' || action === 'apply' ? timeoutMs : Math.min(timeoutMs, 20_000)
    let lastError
    for (const candidate of candidates) {
      try {
        const result = await execFileImpl(candidate.file, [...candidate.prefix, ...args], {
          cwd: updaterRoot,
          env: childEnv,
          timeout: actionTimeout,
          maxBuffer: 1024 * 1024,
          windowsHide: true
        })
        return parseResult(result.stdout)
      } catch (error) {
        lastError = error
        if (error.code === 'ENOENT' && candidate !== candidates.at(-1)) continue
        if (error.stdout) {
          try { return parseResult(error.stdout) } catch (_) { /* report sanitized process failure below */ }
        }
        break
      }
    }
    if (lastError?.code === 'ENOENT') {
      return { ok: false, component: 'plugin', error_code: 'python_runtime_missing', error: '未找到 Python 运行时；请安装 Python 3 或设置 TETHER_PYTHON。' }
    }
    if (lastError?.code === 'ERR_INVALID_ARG_VALUE' || lastError?.code === 'ENOENT' && !env.TETHER_PYTHON) {
      return { ok: false, component: 'plugin', error_code: 'updater_missing', error: '本机插件更新器资源缺失；请重新安装包含更新器的插件包。' }
    }
    if (lastError?.killed || lastError?.code === 'ETIMEDOUT') {
      return { ok: false, component: 'plugin', error_code: 'update_timeout', error: '插件更新操作超时，请稍后重试。' }
    }
    return { ok: false, component: 'plugin', error_code: 'update_process_failed', error: '本机插件更新器执行失败。' }
  }

  return async (endpoint, payload, _signal, peer) => {
    if (peer?.principal?.kind !== 'owner') {
      return { ok: false, error: { code: 'forbidden', message: 'Only the Host owner may update the local Tether plugin.', details: {} } }
    }
    const action = endpoint
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      return { ok: false, error: { code: 'not_found', message: 'Unknown Tether update action.', details: {} } }
    }
    const invalid = parsePayload(action, payload)
    if (invalid) return { ok: false, error: { code: 'invalid_request', message: invalid, details: {} } }
    if (!profile) {
      return { ok: true, value: { ok: false, component: 'plugin', error_code: 'plugin_profile_unknown', error: '无法确认当前 DSH 插件所属 profile，已拒绝更新。' } }
    }
    if (!UPDATER_FILES.every((file) => existsSync(path.join(updaterRoot, file)))) {
      return { ok: true, value: { ok: false, component: 'plugin', error_code: 'updater_missing', error: '本机插件更新器资源缺失；请重新安装包含更新器的插件包。' } }
    }
    const manifestUrl = safeManifestUrl(payload.manifest_url)
    const flightKey = action === 'apply' ? 'apply:' + payload.prepared_id : action
    if (inFlight.has(flightKey)) {
      return { ok: true, value: { ok: false, component: 'plugin', error_code: 'update_busy', error: '同一个更新请求仍在执行，请稍候。' } }
    }
    const task = (async () => {
      if (action === 'apply') {
        const activity = await invoke('activity')
        if (!activity.ok) return { ok: true, value: activity }
        if (activity.busy) {
          return { ok: true, value: { ok: false, component: 'plugin', error_code: 'update_busy', error: activity.reason || 'DSH 当前有活动会话，请结束后再更新。' } }
        }
      }
      const result = await invoke(action, action === 'apply' ? ['--prepared-id', payload.prepared_id] : [], manifestUrl)
      if (!runtimeVersion || !result || typeof result !== 'object') return { ok: true, value: result }
      return {
        ok: true,
        value: {
          ...result,
          runtime_version: runtimeVersion,
          ...(versions.installed ? { installed_version: versions.installed } : {}),
          ...(versions.source ? { source_version: versions.source } : {}),
          ...(versions.drift ? { version_drift: true } : {}),
          ...(result.current_version ? { restart_required: result.current_version !== runtimeVersion } : {})
        }
      }
    })().catch(() => ({ ok: true, value: { ok: false, component: 'plugin', error_code: 'invalid_updater_output', error: '本机插件更新器返回了无效结果。' } }))
      .finally(() => { inFlight.delete(flightKey) })
    inFlight.set(flightKey, task)
    return task
  }
}

export { loadedPluginVersion, parsePayload, resolvePluginVersions, resolvePythonCandidates, selectedDshHome, selectedProfile }
