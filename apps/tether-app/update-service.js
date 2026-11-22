const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const UPDATER_RUNTIME_FILES = ['updates.py', 'updates_cli.py', 'release.py', 'ed25519.py']

function projectedRealPath(directory) {
  try { return fs.realpathSync.native(directory) } catch (error) {
    const parent = path.dirname(directory)
    if (error.code !== 'ENOENT' || parent === directory) throw error
    return path.join(projectedRealPath(parent), path.basename(directory))
  }
}

function containsWindowsPath(parent, child) {
  const relative = path.relative(parent.toLowerCase(), child.toLowerCase())
  return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'))
}

function onInstallVolume(directory, { installDir, volumeRoot }) {
  return path.parse(directory).root.toLowerCase() === volumeRoot.toLowerCase()
    && !containsWindowsPath(installDir, directory) && !containsWindowsPath(directory, installDir)
}

function ensureWindowsUpdateDirectory(directory, location) {
  const projected = projectedRealPath(directory)
  if (!onInstallVolume(projected, location)) throw new Error('路径不在 APP 安装卷的独立目录中')
  fs.mkdirSync(projected, { recursive: true })
  const resolved = fs.realpathSync.native(projected)
  if (resolved.toLowerCase() !== projected.toLowerCase()) throw new Error('APP 更新目录已改变')
  const probe = fs.mkdtempSync(path.join(resolved, 'write-probe-'))
  fs.rmdirSync(probe)
  return resolved
}

async function protectWindowsCache(directory, exec) {
  // An installer launched from a cache outside the user's profile can later
  // elevate. Keep it writable only by this user, SYSTEM and administrators.
  const escapedDir = directory.replace(/'/g, "''")
  const script = [
    "$ErrorActionPreference='Stop'",
    "$dir='" + escapedDir + "'",
    '$item=Get-Item -LiteralPath $dir -Force',
    'if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw "unsafe_cache_path"}',
    '$identity=[Security.Principal.WindowsIdentity]::GetCurrent()',
    '$owner=[IO.Directory]::GetAccessControl($dir).GetOwner([Security.Principal.SecurityIdentifier]).Value',
    '$isAdministrator=[Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    'if ($owner -ne $identity.User.Value -and !($isAdministrator -and $owner -eq "S-1-5-32-544")) {throw "cache_owner_mismatch"}',
    '$acl=[Security.AccessControl.DirectorySecurity]::new()',
    '$acl.SetAccessRuleProtection($true,$false)',
    'foreach($sid in @($identity.User.Value,"S-1-5-18","S-1-5-32-544")) {',
    '  $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),"FullControl","ContainerInherit,ObjectInherit","None","Allow")',
    '  $acl.AddAccessRule($rule)',
    '}',
    '[IO.Directory]::SetAccessControl($dir,$acl)'
  ].join('\n')
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 })
}

async function prepareWindowsUpdateLocation(updater, executable, exec) {
  const actualExe = fs.realpathSync.native(executable)
  const location = { installDir: path.dirname(actualExe), volumeRoot: path.parse(actualExe).root }
  if (!/^[A-Za-z]:\\$/.test(location.volumeRoot)) {
    throw Object.assign(new Error('无法确定 APP 的本地安装卷'), { code: 'app_update_cache_location_unavailable' })
  }
  const config = await updater.configOnDisk.value
  const cacheName = config.updaterCacheDirName || updater.app.name
  if (typeof cacheName !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(cacheName)) {
    throw Object.assign(new Error('APP 更新缓存名称无效'), { code: 'app_update_cache_location_unavailable' })
  }
  const baseCachePath = updater.app.baseCachePath
  const legacyCacheDir = path.join(baseCachePath, cacheName)
  const suffix = crypto.createHash('sha256').update(
    location.installDir.toLowerCase() + '\0' + legacyCacheDir.toLowerCase()).digest('hex').slice(0, 12)
  const folder = 'tether-cache-' + suffix
  const cachePaths = new Set([
    legacyCacheDir,
    path.join(path.dirname(location.installDir), folder),
    path.join(location.volumeRoot, folder)
  ])
  let profileBase
  try { profileBase = projectedRealPath(baseCachePath) } catch (_) { /* use a private same-volume cache */ }
  for (const candidate of cachePaths) {
    try {
      const cacheDir = ensureWindowsUpdateDirectory(candidate, location)
      const outsideProfile = !profileBase || !containsWindowsPath(profileBase, cacheDir)
      if (outsideProfile) await protectWindowsCache(cacheDir, exec)
      const pending = path.join(cacheDir, 'pending')
      if (projectedRealPath(pending).toLowerCase() !== pending.toLowerCase()) {
        throw new Error('APP 更新待安装目录指向其他位置')
      }
      ensureWindowsUpdateDirectory(pending, location)
      if (outsideProfile) await protectWindowsCache(pending, exec)
      return { ...location, cacheDir, legacyCacheDir }
    } catch (_) { /* try the next writable directory on the installation volume */ }
  }
  throw Object.assign(new Error('无法在 APP 安装卷 ' + location.volumeRoot + ' 建立安全的可写更新缓存。'),
    { code: 'app_update_cache_location_unavailable' })
}

function prepareWindowsInstallerTemp(location) {
  try {
    const directory = path.join(location.cacheDir, 'install-temp')
    if (projectedRealPath(directory).toLowerCase() !== directory.toLowerCase()) {
      throw new Error('APP 更新临时目录指向其他位置')
    }
    return ensureWindowsUpdateDirectory(directory, location)
  } catch (_) {
    throw Object.assign(new Error('无法在 APP 安装卷创建可写的安装临时目录。'), { code: 'app_update_temp_dir_failed' })
  }
}

const WINDOWS_UPDATE_CACHE_RESERVE_BYTES = 512n * 1024n * 1024n
const MAX_DELTA_HEADER_BYTES = 1024 * 1024

function validDeltaSize(value) {
  return Number.isSafeInteger(value) && value > 0
}

function validSha512(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value)
}

function trustedDeltaUrl(asset, installer, provider) {
  if (asset.username || asset.password || installer.username || installer.password) return false
  if (asset.origin !== installer.origin) return false
  if (['127.0.0.1', '[::1]'].includes(asset.hostname)) {
    const { GenericProvider } = require('electron-updater/out/providers/GenericProvider')
    return provider instanceof GenericProvider && ['http:', 'https:'].includes(asset.protocol)
      && provider.baseUrl.origin === asset.origin
      && path.posix.dirname(asset.pathname) === path.posix.dirname(installer.pathname)
  }
  if (asset.origin === 'https://github.com') {
    return asset.pathname.startsWith('/qi001007/tether-harness/releases/download/')
      && path.posix.dirname(asset.pathname) === path.posix.dirname(installer.pathname)
  }
  if (asset.origin === 'https://api.github.com') {
    const releaseAsset = /^\/repos\/qi001007\/tether-harness\/releases\/assets\/\d+$/
    return releaseAsset.test(asset.pathname) && releaseAsset.test(installer.pathname)
  }
  return false
}

async function readDeltaBytes(file, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, position + offset)
    if (bytesRead === 0) throw new Error('Truncated Windows installer delta or source')
    offset += bytesRead
  }
}

async function applyWindowsDelta(source, patch, destination, entry, target, checkCancelled) {
  const delta = await fs.promises.open(patch, 'r')
  try {
    if ((await delta.stat()).size !== entry.size) throw new Error('Windows installer delta size differs from metadata')
    const sizeBytes = Buffer.alloc(4)
    await readDeltaBytes(delta, sizeBytes, 0)
    const headerSize = sizeBytes.readUInt32BE(0)
    if (headerSize === 0 || headerSize > MAX_DELTA_HEADER_BYTES || 4 + headerSize > entry.size) {
      throw new Error('Invalid Windows installer delta header size')
    }
    const header = Buffer.alloc(headerSize)
    await readDeltaBytes(delta, header, 4)
    const { format, operations } = JSON.parse(header.toString('utf8'))
    if (format !== 1 || !Array.isArray(operations)) throw new Error('Unsupported Windows installer delta format')
    let outputSize = 0
    let literalEnd = 4 + headerSize
    for (const operation of operations) {
      if (!Array.isArray(operation) || operation.length !== 2) throw new Error('Invalid Windows installer delta operation')
      const [offset, length] = operation
      if (!Number.isSafeInteger(offset) || !validDeltaSize(length) || length > target.size - outputSize) {
        throw new Error('Invalid Windows installer delta range')
      }
      if (offset === -1) {
        if (length > entry.size - literalEnd) throw new Error('Truncated Windows installer delta literal')
        literalEnd += length
      } else if (offset < 0 || length > entry.sourceSize - offset) {
        throw new Error('Windows installer delta range exceeds source')
      }
      outputSize += length
    }
    if (outputSize !== target.size || literalEnd !== entry.size) throw new Error('Windows installer delta has incomplete or extra data')

    const output = await fs.promises.open(destination, 'wx')
    try {
      const digest = crypto.createHash('sha512')
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      let literalOffset = 4 + headerSize
      let outputOffset = 0
      for (const [sourceOffset, length] of operations) {
        const literal = sourceOffset === -1
        const input = literal ? delta : source
        const inputOffset = literal ? literalOffset : sourceOffset
        for (let copied = 0; copied < length;) {
          checkCancelled()
          const chunk = buffer.subarray(0, Math.min(buffer.length, length - copied))
          await readDeltaBytes(input, chunk, inputOffset + copied)
          digest.update(chunk)
          for (let written = 0; written < chunk.length;) {
            const { bytesWritten } = await output.write(chunk, written, chunk.length - written, outputOffset + written)
            if (bytesWritten === 0) throw new Error('Unable to write Windows installer from delta')
            written += bytesWritten
          }
          outputOffset += chunk.length
          copied += chunk.length
        }
        if (literal) literalOffset += length
      }
      checkCancelled()
      if (digest.digest('base64') !== target.sha512) throw new Error('Reconstructed Windows installer SHA512 differs from Electron update metadata')
    } finally {
      await output.close()
    }
  } finally {
    await delta.close()
  }
}

async function openWindowsDeltaSource(paths, entry, checkCancelled) {
  let lastError
  for (const candidate of paths) {
    let source
    try {
      source = await fs.promises.open(candidate, 'r')
      const stat = await source.stat()
      if (!stat.isFile() || stat.size !== entry.sourceSize) throw new Error('Cached Windows installer size differs from delta source')
      const digest = crypto.createHash('sha512')
      for await (const chunk of source.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 })) {
        checkCancelled()
        digest.update(chunk)
      }
      checkCancelled()
      if (digest.digest('base64') !== entry.sourceSha512) throw new Error('Cached Windows installer SHA512 differs from delta source')
      return source
    } catch (error) {
      if (source) await source.close()
      checkCancelled()
      lastError = error
    }
  }
  throw lastError
}

function configureWindowsDelta(updater, currentVersion, legacyCache = () => null, observe = () => {}) {
  if (typeof updater.differentialDownloadInstaller !== 'function') return
  // NsisUpdater 6.8.12 calls this hook before its signature check. Returning true
  // goes directly to its complete GET. Returning false verifies and stages our installer.
  updater.differentialDownloadInstaller = async (fileInfo, options, destination, provider, oldInstallerName) => {
    const { info } = options.updateInfoAndProvider
    observe('full')
    const target = fileInfo.info
    const entries = Array.isArray(info.tetherDelta) ? info.tetherDelta.filter((entry) =>
      entry?.fromVersion === currentVersion && entry.toVersion === info.version) : []
    const entry = entries[0]
    if (entries.length !== 1 || !validDeltaSize(target.size) || !validSha512(target.sha512)
        || !validDeltaSize(entry.sourceSize) || !validSha512(entry.sourceSha512)
        || !validDeltaSize(entry.size) || entry.size >= target.size || !validSha512(entry.sha512)
        || typeof entry.path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.delta$/.test(entry.path)) return true

    const { CancellationError } = require('builder-util-runtime')
    const { cancellationToken } = options
    const checkCancelled = () => {
      if (cancellationToken.cancelled) throw new CancellationError()
    }
    const patch = `${destination}.delta`
    try {
      const [{ url }] = provider.resolveFiles({ ...info, files: [{ url: entry.path, sha512: entry.sha512 }] })
      if (!trustedDeltaUrl(url, fileInfo.url, provider)) return true
      checkCancelled()
      const candidates = new Set([path.join(updater.downloadedUpdateHelper.cacheDir, oldInstallerName)])
      const legacy = legacyCache()
      if (legacy) candidates.add(path.join(legacy, oldInstallerName))
      const source = await openWindowsDeltaSource(candidates, entry, checkCancelled)
      try {
        observe('delta')
        const headers = Object.fromEntries(Object.entries(options.requestHeaders || {}).filter(([name]) => name.toLowerCase() !== 'range'))
        await updater.httpExecutor.download(url, patch, {
          headers, cancellationToken, sha512: entry.sha512,
          onProgress: updater.listenerCount('download-progress') > 0
            ? (progress) => updater.emit('download-progress', progress) : undefined
        })
        await applyWindowsDelta(source, patch, destination, entry, target, checkCancelled)
        observe('delta', entry.size)
        updater.logger.info(`Windows installer delta verified (${currentVersion} → ${info.version}, ${entry.size} bytes)`)
        return false
      } finally {
        await source.close()
      }
    } catch (error) {
      await fs.promises.rm(destination, { force: true })
      checkCancelled()
      if (error instanceof CancellationError) throw error
      observe('full_after_delta_fallback')
      updater.logger.warn(`Windows installer delta unavailable, downloading full installer: ${error.message}`)
      return true
    } finally {
      await fs.promises.rm(patch, { force: true }).catch((error) => {
        updater.logger.warn(`Could not remove temporary Windows installer delta: ${error.message}`)
      })
    }
  }
}

function ensureWindowsUpdateCacheSpace(updateInfo, copyCount, location) {
  const files = updateInfo && updateInfo.files
  if (!Array.isArray(files) || files.length === 0
      || files.some((file) => !Number.isSafeInteger(file && file.size) || file.size <= 0)) {
    throw Object.assign(new Error('无法确认 APP 更新包大小，已停止操作。'), {
      code: 'update_size_unavailable'
    })
  }

  const assetBytes = files.reduce((total, file) => total + BigInt(file.size), 0n)
  const requiredBytes = assetBytes * BigInt(copyCount) + WINDOWS_UPDATE_CACHE_RESERVE_BYTES
  let availableBytes
  try {
    const cacheDir = fs.realpathSync.native(location.cacheDir)
    const pending = path.join(cacheDir, 'pending')
    if (!onInstallVolume(cacheDir, location)
        || fs.realpathSync.native(pending).toLowerCase() !== pending.toLowerCase()) {
      throw new Error('APP 更新缓存卷已改变')
    }
    const stats = fs.statfsSync(cacheDir, { bigint: true })
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
    this.windowsCachePromise = null
    this.windowsReceipt = null
    this.legacyWindowsCacheDir = null
    this.bridgeApplyAccepted = new Set()
    this.appUpdateBridgeRegistrationKey = ''
    this.appUpdateDeviceObservation = null
    if (this.packaged) {
      const { autoUpdater } = require('electron-updater')
      this.electronUpdater = autoUpdater
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      if (process.platform === 'win32' && process.arch === 'x64') {
        configureWindowsDelta(autoUpdater, app.getVersion(), () => this.legacyWindowsCacheDir,
          (method, bytes) => this.observeWindowsDownload(method, bytes))
      }
      if (process.platform === 'win32') {
        autoUpdater.on('download-progress', ({ transferred, total }) => {
          if (!validDeltaSize(transferred)) return
          const method = this.windowsReceipt?.download_method || 'network'
          if (method === 'delta') return // Only count a hash-verified patch.
          this.observeWindowsDownload(method, transferred === total ? transferred : undefined)
        })
        autoUpdater.on('error', (error) => {
          if (this.windowsReceipt?.status === 'installing') {
            this.recordElectronApplyFailure(error, this.windowsReceipt.target_version)
          }
        })
      }
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
  windowsUpdateLocation() {
    if (!this.windowsCachePromise) {
      const updater = this.electronUpdater
      this.windowsCachePromise = prepareWindowsUpdateLocation(updater, this.app.getPath('exe'), this.exec)
        .then((location) => {
          // electron-updater 6.8.12 uses this helper for both download and
          // quitAndInstall. Keep its normal metadata and signature validation.
          const { DownloadedUpdateHelper } = require('electron-updater/out/DownloadedUpdateHelper')
          const helper = new DownloadedUpdateHelper(location.cacheDir)
          const validateDownloadedPath = helper.validateDownloadedPath.bind(helper)
          helper.validateDownloadedPath = async (...args) => {
            const file = await validateDownloadedPath(...args)
            if (file) this.observeWindowsDownload('cache', 0)
            return file
          }
          updater.downloadedUpdateHelper = helper
          this.legacyWindowsCacheDir = location.legacyCacheDir
          return location
        }).catch((error) => {
          this.windowsCachePromise = null
          throw error
        })
    }
    return this.windowsCachePromise
  }
  startWindowsReceipt() {
    const targetVersion = this.electronUpdateInfo.version
    if (this.windowsReceipt?.target_version === targetVersion
        && ['downloading', 'prepared'].includes(this.windowsReceipt.status)) return
    this.windowsReceipt = {
      started_at: new Date().toISOString(), from_version: this.app.getVersion(), target_version: targetVersion,
      status: 'downloading'
    }
  }

  observeWindowsDownload(method, bytes) {
    if (this.windowsReceipt?.status !== 'downloading') return
    this.windowsReceipt.download_method = method
    if (bytes == null) delete this.windowsReceipt.payload_bytes
    else this.windowsReceipt.payload_bytes = bytes
  }

  saveWindowsReceipt(receipt, status, errorCode) {
    const directory = path.join(this.dataDir, 'updates')
    const file = path.join(directory, 'windows-app-receipt.json')
    const temporary = file + '.tmp'
    const next = {
      started_at: receipt.started_at, updated_at: new Date().toISOString(),
      from_version: receipt.from_version, target_version: receipt.target_version, status,
      download_method: receipt.download_method, payload_bytes: receipt.payload_bytes, error_code: errorCode
    }
    try {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify(next) + '\n', { mode: 0o600 })
      fs.renameSync(temporary, file)
    } catch (_) { /* receipt persistence cannot prevent an update */ }
    return next
  }

  finishWindowsReceipt() {
    if (process.platform !== 'win32') return
    try {
      const file = path.join(this.dataDir, 'updates', 'windows-app-receipt.json')
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (receipt.status !== 'installing' || receipt.target_version !== this.app.getVersion()
          || receipt.from_version === receipt.target_version) return
      this.saveWindowsReceipt(receipt, 'completed')
    } catch (_) { /* no update initiated by a receipt-capable version */ }
  }

  async prepare() {
    if (this.electronUpdater) {
      this.clearElectronApplyFailure()
      if (!this.electronUpdateInfo) await this.check()
      if (!this.electronUpdateInfo || this.electronUpdateInfo.version === this.app.getVersion()) {
        throw Object.assign(new Error('没有可用的 APP 更新'), { code: 'update_not_available' })
      }
      const windows = process.platform === 'win32'
      if (windows) this.startWindowsReceipt()
      try {
        if (windows) {
          const location = await this.windowsUpdateLocation()
          if (!this.electronDownloaded) ensureWindowsUpdateCacheSpace(this.electronUpdateInfo, 2, location)
        }
        this.electronDownloaded = false
        await this.electronUpdater.downloadUpdate()
      } catch (error) {
        if (windows) this.windowsReceipt = this.saveWindowsReceipt(this.windowsReceipt, 'failed', this.electronErrorCode(error))
        throw error
      }
      if (windows && this.windowsReceipt.status === 'downloading') {
        this.windowsReceipt = this.saveWindowsReceipt(this.windowsReceipt, 'prepared')
      }
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
    if (this.electronUpdater) {
      let installing = null
      try {
        await this.activity()
        this.assertElectronPrepared(preparedId)
        const windowsLocation = process.platform === 'win32' ? await this.windowsUpdateLocation() : null
        installing = { ok: true, component: 'app', status: 'installing', restart_required: true,
          current_version: this.app.getVersion(), latest_version: this.electronUpdateInfo.version,
          source: 'electron-updater' }
        this.clearElectronApplyFailure()
        if (windowsLocation) ensureWindowsUpdateCacheSpace(this.electronUpdateInfo, 1, windowsLocation)
        const nsisTempDir = windowsLocation ? prepareWindowsInstallerTemp(windowsLocation) : null
        const helper = this.electronUpdater.downloadedUpdateHelper
        const installerPath = helper && helper.file
        if (process.platform === 'win32'
            && (typeof installerPath !== 'string' || !helper.downloadedFileInfo || !fs.existsSync(installerPath))) {
          throw Object.assign(new Error('更新安装包尚未准备完成，请重新检查更新后再试。'),
            { code: 'update_installer_missing' })
        }
        if (beforeInstall) await beforeInstall(installing)
        await this.stopManagedNode()
        // Keep the prepared id until the installer is actually launched so a
        // failed start can be retried from the downloaded package.
        this.preparedIds.delete(preparedId)
        let installError = null
        const captureInstallError = (error) => { installError = error }
        this.electronUpdater.once('error', captureInstallError)
        try {
          if (nsisTempDir) {
            if (this.windowsReceipt) this.windowsReceipt = this.saveWindowsReceipt(this.windowsReceipt, 'installing')
            const names = ['TEMP', 'TMP', 'TETHER_UPDATER_TEMP']
            const previous = names.map((name) => process.env[name])
            // NsisUpdater calls spawn synchronously inside quitAndInstall.
            try {
              for (const name of names) process.env[name] = nsisTempDir
              this.electronUpdater.quitAndInstall(true, true)
            } finally {
              names.forEach((name, index) => {
                if (previous[index] === undefined) delete process.env[name]
                else process.env[name] = previous[index]
              })
            }
          } else {
            this.electronUpdater.quitAndInstall(false, true)
          }
        } finally {
          this.electronUpdater.removeListener('error', captureInstallError)
        }
        if (installError) throw installError
        return installing
      } catch (error) {
        this.recordElectronApplyFailure(error, (installing && installing.latest_version)
          || (this.electronUpdateInfo && this.electronUpdateInfo.version))
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

  electronErrorCode(error) {
    return /^[a-z0-9_]{1,64}$/.test(String(error && error.code || ''))
      ? String(error.code) : 'app_update_failed'
  }

  recordElectronApplyFailure(error, targetVersion) {
    const code = this.electronErrorCode(error)
    if (this.windowsReceipt?.target_version === targetVersion) {
      this.windowsReceipt = this.saveWindowsReceipt(this.windowsReceipt, 'failed', code)
    }
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
    this.finishWindowsReceipt()
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

module.exports = { UpdateService, stageUpdaterRuntime, configureWindowsDelta }
