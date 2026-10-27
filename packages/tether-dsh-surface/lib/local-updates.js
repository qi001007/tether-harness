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
const UPDATER_FILES = ['tether/__init__.py', 'tether/updates.py', 'tether/updates_cli.py', 'tether/node/__init__.py', 'tether/node/dsh_sessions.py']

const execFile = promisify(nodeExecFile)

function selectedDshHome(env, homeDir) {
  return path.resolve(env.DSH_HOME || path.join(homeDir, '.dsh'))
}

function profileFromArgv(dshHome, argv) {
  const profilesRoot = path.resolve(dshHome, 'profiles')
  for (const arg of argv || []) {
    if (typeof arg !== 'string' || !arg || !path.isAbsolute(arg)) continue
    const relative = path.relative(profilesRoot, path.resolve(arg))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue
    const parts = relative.split(path.sep)
    if (parts.length === 1 && /^[A-Za-z0-9_-]{1,80}$/.test(parts[0])) return parts[0]
  }
  return undefined
}

function selectedProfile(packageRoot, dshHome, argv = process.argv) {
  const fromArgv = profileFromArgv(dshHome, argv)
  if (fromArgv) return fromArgv
  const absolute = path.resolve(packageRoot)
  const profilesRoot = path.join(path.resolve(dshHome), 'profiles')
  const relative = path.relative(profilesRoot, absolute).split(path.sep)
  if (relative.length !== 3 || !relative[0] || relative[1] !== 'node_modules' || relative[2] !== 'tether-dsh-surface'
      || relative[0] === '.' || relative[0] === '..') return undefined
  return relative[0]
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
  const keys = Object.keys(payload)
  if (action === 'apply') {
    if (keys.length !== 1 || keys[0] !== 'prepared_id' || typeof payload.prepared_id !== 'string' || !PREPARED_ID.test(payload.prepared_id)) {
      return 'apply requires only a valid prepared_id'
    }
  } else if (keys.length !== 0) {
    return `${action} does not accept parameters`
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
  const dshHome = selectedDshHome(env, homeDir)
  const profile = selectedProfile(packageRoot, dshHome)
  const updaterRoot = path.join(packageRoot, 'updater')
  const stateDir = path.join(dshHome, 'storages', 'tether', 'updates')
  const childEnv = safeEnvironment(env, dshHome)

  async function invoke(action, extraArgs = []) {
    const args = ['-m', 'tether.updates_cli', action, '--component', 'plugin', '--root', updaterRoot,
      '--dsh-home', dshHome, '--state-dir', stateDir, '--profile', profile, ...extraArgs]
    const candidates = resolvePythonCandidates(env, platform)
    let lastError
    for (const candidate of candidates) {
      try {
        const result = await execFileImpl(candidate.file, [...candidate.prefix, ...args], {
          cwd: updaterRoot,
          env: childEnv,
          timeout: action === 'prepare' || action === 'apply' ? timeoutMs : Math.min(timeoutMs, 30_000),
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
    try {
      if (action === 'apply') {
        const activity = await invoke('activity')
        if (!activity.ok) return { ok: true, value: activity }
        if (activity.busy) {
          return { ok: true, value: { ok: false, component: 'plugin', error_code: 'update_busy', error: activity.reason || 'DSH 当前有活动会话，请结束后再更新。' } }
        }
      }
      const result = await invoke(action, action === 'apply' ? ['--prepared-id', payload.prepared_id] : [])
      return { ok: true, value: result }
    } catch (_) {
      return { ok: true, value: { ok: false, component: 'plugin', error_code: 'invalid_updater_output', error: '本机插件更新器返回了无效结果。' } }
    }
  }
}

export { parsePayload, resolvePythonCandidates, selectedDshHome, selectedProfile }
