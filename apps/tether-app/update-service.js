const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const UPDATER_RUNTIME_FILES = ['updates.py', 'updates_cli.py', 'release.py', 'ed25519.py']

function ensureWindowsUpdaterTempDir(executablePath) {
  const volumeRoot = path.parse(executablePath).root
  let tempDir = ''
  try {
    if (!volumeRoot) throw new Error('无法确定 APP 安装卷')
    tempDir = path.join(volumeRoot, 'tether-up')
    fs.mkdirSync(tempDir, { recursive: true })
    // Confirm this volume-root directory is writable before the app starts shutting down.
    const writeProbe = fs.mkdtempSync(path.join(tempDir, 'write-probe-'))
    fs.rmdirSync(writeProbe)
    return tempDir
  } catch (error) {
    const detail = String(error && error.message || error).replace(/[\r\n]/g, ' ').slice(0, 160)
    throw Object.assign(new Error(`无法创建 APP 更新临时目录${tempDir ? ` ${tempDir}` : ''}：${detail}`), {
      code: 'app_update_temp_dir_failed'
    })
  }
}

const WINDOWS_UPDATE_CACHE_RESERVE_BYTES = 512n * 1024n * 1024n

function ensureWindowsUpdateCacheSpace(updateInfo, copyCount) {
  const files = updateInfo && updateInfo.files
  if (!Array.isArray(files) || files.length === 0
      || files.some((file) => !Number.isSafeInteger(file && file.size) || file.size <= 0)) {
    throw Object.assign(new Error('无法确认 APP 更新包大小，已停止操作。'), {
      code: 'update_size_unavailable'
    })
  }

  const assetBytes = files.reduce((total, file) => total + BigInt(file.size), 0n)
  const requiredBytes = assetBytes * BigInt(copyCount) + WINDOWS_UPDATE_CACHE_RESERVE_BYTES
  const cacheRoot = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  let availableBytes
  try {
    const stats = fs.statfsSync(cacheRoot, { bigint: true })
    if (typeof stats.bavail !== 'bigint' || typeof stats.bsize !== 'bigint' || stats.bsize <= 0n) {
      throw new Error('statfs result unavailable')
    }
    availableBytes = stats.bavail * stats.bsize
  } catch (_) {
    throw Object.assign(new Error('无法读取 APP 更新缓存磁盘空间，已停止操作。'), {
      code: 'update_cache_space_unavailable'
    })
  }
  if (availableBytes < requiredBytes) {
    const requiredGb = (Math.ceil(Number(requiredBytes) / 100000000) / 10).toFixed(1)
    const availableGb = (Math.floor(Number(availableBytes) / 100000000) / 10).toFixed(1)
    throw Object.assign(new Error(`APP 更新缓存空间不足：至少需要 ${requiredGb} GB 可用空间，当前可用 ${availableGb} GB。`), {
      code: 'insufficient_update_cache_space'
    })
  }
}

// The helper runs after the APP process is gone, so it must carry a self-contained
// copy of every module tether.updates_cli imports. Walk the package instead of
// listing files: a new import (release.py, ed25519.py) previously broke self-update.
function stageUpdaterRuntime(repoRoot, stagingPackage) {
  const sourcePackage = path.join(repoRoot, 'tether')
  const runtimeFiles = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name.startsWith('.')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && entry.name.endsWith('.py')) runtimeFiles.push([absolute, path.join(stagingPackage, path.relative(sourcePackage, absolute))])
    }
  }
  if (fs.existsSync(sourcePackage)) walk(sourcePackage)
  const staged = new Set(runtimeFiles.map(([source]) => path.relative(sourcePackage, source)))
  if (UPDATER_RUNTIME_FILES.some((name) => !staged.has(name))) throw new Error('更新助手文件缺失，请先安装包含更新器的 Tether 发行版')
  for (const [, destination] of runtimeFiles) fs.mkdirSync(path.dirname(destination), { recursive: true })
  for (const [source, destination] of runtimeFiles) fs.copyFileSync(source, destination)
  return runtimeFiles.length
}

class UpdateService {
  constructor({ repoRoot, dataDir, python, env, app, deviceId = '', stopManagedNode = async () => {}, exec = execFileAsync, spawnChild = spawn }) {
    this.repoRoot = repoRoot
    this.dataDir = dataDir
    this.python = python
    this.env = env
    this.app = app
    this.deviceId = String(deviceId || '')
    this.stopManagedNode = stopManagedNode
    this.exec = exec
    this.spawnChild = spawnChild
    this.packaged = !!app.isPackaged
    this.dshHome = env.TETHER_NATIVE_DSH_HOME || path.join(os.homedir(), '.dsh')
    this.helperSource = path.join(__dirname, 'update-helper.js')
    this.preparedIds = new Set()
    this.electronUpdater = null
    this.electronUpdateInfo = null
    this.electronDownloaded = false
    this.electronLastResult = null
    this.appUpdateBridge = null
    this.bridgeApplyAccepted = new Set()
    this.appUpdateBridgeRegistrationKey = ''
    this.appUpdateDeviceObservation = null
    if (this.packaged) {
      const { autoUpdater } = require('electron-updater')
      this.electronUpdater = autoUpdater
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      const updateChannel = String(env.TETHER_UPDATE_CHANNEL || '').trim().toLowerCase()
      if (updateChannel) {
        autoUpdater.allowPrerelease = updateChannel === 'preview'
        autoUpdater.channel = autoUpdater.allowPrerelease ? 'preview' : 'latest'
      } else {
        let packagedChannel = ''
        try {
          const config = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
          const match = config.match(/^channel:\s*([a-z0-9_-]{1,32})\s*$/mi)
          if (match) packagedChannel = match[1].toLowerCase()
        } catch (_) { /* electron-updater reports missing packaged configuration on check */ }
        autoUpdater.allowPrerelease = packagedChannel === 'preview'
      }
      autoUpdater.on('update-available', (info) => { this.electronUpdateInfo = info })
      autoUpdater.on('update-not-available', (info) => { this.electronUpdateInfo = info })
      autoUpdater.on('update-downloaded', (info) => { this.electronUpdateInfo = info; this.electronDownloaded = true })
    }
  }

  async run(command, preparedId, force = false) {
    // Shared with the node's APP update manager so a prepared APP update is
    // visible to both and node can defer its own restart until the APP applies.
    const stateDir = path.join(this.dataDir, 'updates', 'app')
    const args = ['-m', 'tether.updates_cli', command, '--component', 'app', '--root', this.repoRoot, '--state-dir', stateDir, '--dsh-home', this.dshHome]
    if (this.env.TETHER_DEVICE) args.push('--device', String(this.env.TETHER_DEVICE))
    if (preparedId) args.push('--prepared-id', preparedId)
    if (force) args.push('--force')
    try {
      const hub = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'hub.json'), 'utf8'))
      if (hub && typeof hub.url === 'string' && /^https?:\/\//.test(hub.url)) {
        args.push('--manifest-url', hub.url.replace(/\/+$/, '') + '/releases/manifest')
      }
    } catch (_) { /* fall back to the default manifest */ }
    const env = { ...this.env, PYTHONPATH: this.repoRoot, PYTHONIOENCODING: 'utf-8' }
    try {
      const { stdout } = await this.exec(this.python, args, {
        cwd: this.repoRoot,
        env,
        windowsHide: true,
        timeout: command === 'check' ? 90000 : 120000,
        maxBuffer: 1024 * 1024
      })
      const result = JSON.parse(stdout.trim())
      if (!result || result.ok === false) throw Object.assign(new Error(result && (result.error || result.message) || '更新操作失败'), { code: result && result.error_code })
      return result
    } catch (error) {
      const output = String(error.stdout || '').trim()
      if (output) {
        try {
          const result = JSON.parse(output)
          if (result && result.ok) return result
          throw Object.assign(new Error(result && (result.error || result.message) || error.message), { code: result && result.error_code })
        } catch (parseError) {
          if (parseError.code) throw parseError
        }
      }
      if (error.code === 'ENOENT') throw error
      throw new Error(String(error.stderr || error.message || '更新操作失败').trim())
    }
  }

  async status() {
    if (this.electronUpdater) {
      const current = this.app.getVersion()
      let controllerOrigin = ''
      try {
        const parsed = new URL(String(this.env.TETHER_CONTROLLER_URL || ''))
        const protocol = parsed.protocol === 'ws:' ? 'http:' : parsed.protocol === 'wss:' ? 'https:' : parsed.protocol
        if ((protocol === 'http:' || protocol === 'https:') && !parsed.username && !parsed.password
            && !parsed.search && !parsed.hash) {
          parsed.protocol = protocol
          parsed.hostname = parsed.hostname.toLowerCase()
          if ((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443')) parsed.port = ''
          controllerOrigin = parsed.origin
        }
      } catch (_) { /* identity is unavailable until the controller is configured */ }
      const result = {
        ok: true, component: 'app', current_version: current,
        device_id: this.deviceId || String(this.env.TETHER_DEVICE || ''), controller_origin: controllerOrigin,
        latest_version: this.electronUpdateInfo && this.electronUpdateInfo.version || current,
        update_available: !!(this.electronUpdateInfo && this.electronUpdateInfo.version && this.electronUpdateInfo.version !== current),
        prepared: this.electronDownloaded ? [{ prepared_id: [...this.preparedIds][0] || '' }] : [],
        restart_required: false, source: 'electron-updater'
      }
      let lastResult = this.electronLastResult
      try {
        const stored = JSON.parse(fs.readFileSync(path.join(this.app.getPath('userData'), 'update-result.json'), 'utf8'))
        if (stored && stored.source === 'electron-updater') lastResult = stored
      } catch (_) { /* no stored Electron apply failure */ }
      if (lastResult && lastResult.ok === false && lastResult.target_version !== current) result.last_result = lastResult
      return result
    }
    const result = await this.run('status')
    const lastResultPath = path.join(this.app.getPath('userData'), 'update-result.json')
    if (fs.existsSync(lastResultPath)) {
      try { result.last_result = JSON.parse(fs.readFileSync(lastResultPath, 'utf8')) } catch (_) { /* ignore incomplete helper result */ }
    }
    for (const item of result.prepared || []) {
      if (item && typeof item.prepared_id === 'string') this.preparedIds.add(item.prepared_id)
    }
    return result
  }
  async check() {
    if (!this.electronUpdater) return this.run('check', undefined, true)
    const current = this.app.getVersion()
    const checked = await this.electronUpdater.checkForUpdates()
    const info = checked && checked.updateInfo || this.electronUpdateInfo
    this.electronUpdateInfo = info || null
    const latest = info && info.version || current
    return { ok: true, component: 'app', current_version: current, latest_version: latest,
      update_available: !!(info && latest !== current), source: 'electron-updater',
      checked_at: new Date().toISOString(), prepared: [] }
  }
  async activity() {
    const result = await this.run('activity')
    if (result.busy) {
      const reason = result.reason || 'activity_unknown'
      const message = reason === 'native_session_active' ? 'DeepSeek Harness 当前有运行中的原生会话，请等待完成后重试。'
        : reason === 'node_run_active' ? 'Tether Node 当前有运行中的任务，请等待完成后重试。'
          : '无法确认本机任务状态，为避免中断任务，更新已暂缓。'
      throw Object.assign(new Error(message), { code: 'update_busy' })
    }
    return result
  }
  async prepare() {
    if (this.electronUpdater) {
      await this.activity()
      this.clearElectronApplyFailure()
      if (!this.electronUpdateInfo) await this.check()
      if (!this.electronUpdateInfo || this.electronUpdateInfo.version === this.app.getVersion()) {
        throw Object.assign(new Error('没有可用的 APP 更新'), { code: 'update_not_available' })
      }
      if (process.platform === 'win32' && !this.electronDownloaded) {
        ensureWindowsUpdateCacheSpace(this.electronUpdateInfo, 2)
      }
      this.electronDownloaded = false
      await this.electronUpdater.downloadUpdate()
      const preparedId = crypto.randomBytes(16).toString('hex')
      this.preparedIds.add(preparedId)
      this.electronDownloaded = true
      return { ok: true, component: 'app', prepared_id: preparedId, prepared: [{ prepared_id: preparedId }],
        current_version: this.app.getVersion(), latest_version: this.electronUpdateInfo.version,
        update_available: true, downloaded: true, source: 'electron-updater' }
    }
    const lastResultPath = path.join(this.app.getPath('userData'), 'update-result.json')
    try { fs.unlinkSync(lastResultPath) } catch (_) { /* no previous result */ }
    const result = await this.run('prepare')
    if (typeof result.prepared_id === 'string') this.preparedIds.add(result.prepared_id)
    return result
  }

  async validateElectronPrepared(preparedId) {
    await this.activity()
    this.assertElectronPrepared(preparedId)
    return { ok: true, component: 'app', status: 'waiting_for_restart', restart_required: true,
      current_version: this.app.getVersion(), latest_version: this.electronUpdateInfo.version,
      source: 'electron-updater' }
  }

  assertElectronPrepared(preparedId) {
    if (!this.electronUpdater || typeof preparedId !== 'string' || !/^[a-f0-9]{32}$/.test(preparedId)
        || !this.preparedIds.has(preparedId)) {
      throw Object.assign(new Error('更新包标识无效'), { code: 'invalid_prepared_id' })
    }
    if (!this.electronDownloaded || !this.electronUpdateInfo
        || this.electronUpdateInfo.version === this.app.getVersion()) {
      throw Object.assign(new Error('更新包尚未下载完成'), { code: 'update_not_prepared' })
    }
  }

  async apply(preparedId, { beforeInstall } = {}) {
    await this.activity()
    if (this.electronUpdater) {
      this.assertElectronPrepared(preparedId)
      if (process.platform === 'win32') ensureWindowsUpdateCacheSpace(this.electronUpdateInfo, 1)
      const installing = { ok: true, component: 'app', status: 'installing', restart_required: true,
        current_version: this.app.getVersion(), latest_version: this.electronUpdateInfo.version,
        source: 'electron-updater' }
      this.clearElectronApplyFailure()
      try {
        const nsisTempDir = process.platform === 'win32'
          ? ensureWindowsUpdaterTempDir(this.app.getPath('exe')) : null
        if (beforeInstall) await beforeInstall(installing)
        this.preparedIds.delete(preparedId)
        await this.stopManagedNode()
        if (nsisTempDir) {
          const previousTemp = process.env.TEMP
          const previousTmp = process.env.TMP
          // NsisUpdater calls spawn synchronously inside quitAndInstall.
          try {
            process.env.TEMP = nsisTempDir
            process.env.TMP = nsisTempDir
            this.electronUpdater.quitAndInstall(true, true)
          } finally {
            if (previousTemp === undefined) delete process.env.TEMP
            else process.env.TEMP = previousTemp
            if (previousTmp === undefined) delete process.env.TMP
            else process.env.TMP = previousTmp
          }
        } else {
          this.electronUpdater.quitAndInstall(false, true)
        }
        return installing
      } catch (error) {
        this.recordElectronApplyFailure(error, installing.latest_version)
        throw error
      }
    }
    if (typeof preparedId !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(preparedId)
        || !this.preparedIds.has(preparedId)) {
      throw Object.assign(new Error('更新包标识无效'), { code: 'invalid_prepared_id' })
    }
    const userData = this.app.getPath('userData')
    const helperPath = path.join(userData, 'tether-update-helper.js')
    const configPath = path.join(userData, 'tether-update-helper.json')
    const stagingDir = path.join(userData, 'update-helper-runtime')
    const stagingPackage = path.join(stagingDir, 'tether')
    fs.mkdirSync(userData, { recursive: true })
    stageUpdaterRuntime(this.repoRoot, stagingPackage)
    fs.copyFileSync(this.helperSource, helperPath)
    const config = {
      pid: process.pid,
      python: this.python,
      root: this.repoRoot,
      stateDir: path.join(this.dataDir, 'updates', 'app'),
      dshHome: this.dshHome,
      component: 'app',
      preparedId,
      userData,
      stagingDir,
      resultPath: path.join(userData, 'update-result.json'),
      executable: process.execPath,
      launchArgs: this.app.isPackaged ? [] : [path.join(this.repoRoot, 'apps', 'tether-app')],
      env: { PYTHONPATH: stagingDir, PYTHONIOENCODING: 'utf-8' }
    }
    fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 })
    const child = this.spawnChild(process.execPath, [helperPath, configPath], {
      detached: true,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('更新助手启动超时'))
      }, 10000)
      child.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('更新助手启动失败')) })
      child.once('message', (message) => {
        clearTimeout(timeout)
        if (message && message.ready === true) resolve()
        else reject(new Error(message && message.error || '更新助手启动失败'))
      })
    }).catch((error) => { try { child.kill() } catch (_) { /* already gone */ }; throw error })
    child.disconnect()
    child.unref()
    this.preparedIds.delete(preparedId)
    return { ok: true, component: 'app', status: 'installing', restart_required: true }
  }

  clearElectronApplyFailure() {
    this.electronLastResult = null
    try { fs.unlinkSync(path.join(this.app.getPath('userData'), 'update-result.json')) } catch (_) { /* no prior failure */ }
  }

  recordElectronApplyFailure(error, targetVersion) {
    const code = /^[a-z0-9_]{1,64}$/.test(String(error && error.code || ''))
      ? String(error.code) : 'app_update_failed'
    const result = { ok: false, component: 'app', status: 'failed', source: 'electron-updater',
      target_version: targetVersion, error_code: code,
      error: String(error && error.message || 'APP update failed').slice(0, 240), retryable: true,
      failed_at: new Date().toISOString() }
    this.electronLastResult = result
    try {
      fs.writeFileSync(path.join(this.app.getPath('userData'), 'update-result.json'), JSON.stringify(result), { mode: 0o600 })
    } catch (_) { /* keep the in-memory status result if persistence is unavailable */ }
  }

  async startAppUpdateBridge() {
    if (!this.electronUpdater) return null
    if (this.appUpdateBridge) return this.appUpdateBridge
    const token = crypto.randomBytes(32).toString('hex')
    const server = http.createServer(async (request, response) => {
      const send = (status, body) => {
        if (response.writableEnded) return
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(body))
      }
      if (request.method !== 'POST' || request.url !== '/v1/update') return send(404, { ok: false, error_code: 'not_found' })
      const authorization = String(request.headers.authorization || '')
      const supplied = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
      const expected = Buffer.from(token)
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return send(401, { ok: false, error_code: 'unauthorized', error: 'APP update service authorization failed' })
      }
      let raw = ''
      try {
        for await (const chunk of request) {
          raw += chunk.toString('utf8')
          if (raw.length > 4096) return send(413, { ok: false, error_code: 'request_too_large' })
        }
        const body = JSON.parse(raw)
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || !['status', 'check', 'prepare', 'apply'].includes(body.action)) {
          return send(400, { ok: false, error_code: 'invalid_update_request' })
        }
        if (body.action === 'apply') {
          if (Object.keys(body).some((key) => !['action', 'prepared_id', 'phase'].includes(key))
              || !['accept', 'commit'].includes(body.phase)) {
            return send(400, { ok: false, error_code: 'invalid_update_request' })
          }
          if (body.phase === 'accept') {
            const accepted = await this.validateElectronPrepared(body.prepared_id)
            this.bridgeApplyAccepted.add(body.prepared_id)
            return send(200, accepted)
          }
          if (Object.keys(body).length !== 3 || !this.bridgeApplyAccepted.has(body.prepared_id)) {
            return send(409, { ok: false, error_code: 'apply_not_accepted' })
          }
          try {
            await this.apply(body.prepared_id, {
              beforeInstall: async (accepted) => {
                if (response.writableEnded) throw Object.assign(new Error('APP update acknowledgement unavailable'), { code: 'ack_unavailable' })
                const flushed = new Promise((resolve, reject) => {
                  response.once('finish', resolve)
                  response.once('error', reject)
                })
                response.writeHead(202, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
                response.end(JSON.stringify(accepted))
                await flushed
              }
            })
            this.bridgeApplyAccepted.delete(body.prepared_id)
          } catch (error) {
            this.bridgeApplyAccepted.delete(body.prepared_id)
            if (!response.writableEnded) send(409, {
              ok: false,
              error_code: /^[a-z0-9_]{1,64}$/.test(String(error && error.code || '')) ? error.code : 'app_update_failed',
              error: String(error && error.message || 'APP update failed').slice(0, 240)
            })
          }
          return
        }
        if (Object.keys(body).length !== 1) return send(400, { ok: false, error_code: 'invalid_update_request' })
        const result = body.action === 'status' ? await this.status()
          : body.action === 'check' ? await this.check() : await this.prepare()
        return send(200, result)
      } catch (error) {
        if (response.writableEnded) return
        send(409, {
          ok: false,
          error_code: /^[a-z0-9_]{1,64}$/.test(String(error && error.code || '')) ? error.code : 'app_update_failed',
          error: String(error && error.message || 'APP update failed').slice(0, 240)
        })
      }
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('APP update loopback endpoint failed to bind')
    }
    this.appUpdateBridge = { server, url: `http://127.0.0.1:${address.port}/v1/update`, token }
    return { url: this.appUpdateBridge.url, token: this.appUpdateBridge.token }
  }

  shouldRefreshAppUpdateBridgeRegistration(identity, force = false) {
    if (!identity || !identity.actorId || !identity.controllerOrigin || !identity.deviceId || !identity.endpoint) return false
    const key = [identity.actorId, identity.controllerOrigin, identity.deviceId, identity.endpoint].join('\0')
    return !!force || key !== this.appUpdateBridgeRegistrationKey
  }

  rememberAppUpdateBridgeRegistration(identity) {
    this.appUpdateBridgeRegistrationKey = [identity.actorId, identity.controllerOrigin,
      identity.deviceId, identity.endpoint].join('\0')
  }

  isAppUpdateBridgeReconnect(device) {
    if (!device || device.device_id !== this.deviceId
        || device.capabilities?.app_update_bridge_registration !== 1) return false
    const current = { online: device.online === true, lastSeen: String(device.last_seen || '') }
    const previous = this.appUpdateDeviceObservation
    this.appUpdateDeviceObservation = current
    if (!current.online || device.capabilities?.app_update_bridge_available !== false) return false
    return !previous || !previous.online || (!!current.lastSeen && current.lastSeen !== previous.lastSeen)
  }

  closeAppUpdateBridge() {
    const server = this.appUpdateBridge && this.appUpdateBridge.server
    this.appUpdateBridge = null
    if (server) server.close()
  }
}

module.exports = { UpdateService, stageUpdaterRuntime }
