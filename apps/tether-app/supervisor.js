const { spawn, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else {
    try { process.kill(-pid, 'SIGTERM') } catch (_) { try { process.kill(pid, 'SIGTERM') } catch (_) { /* gone */ } }
  }
}

class Supervisor {
  constructor({ repoRoot, dataDir, env, spawnChild = spawn, preserveManagedNodeOnExit = false }) {
    this.repoRoot = repoRoot
    this.dataDir = dataDir
    this.logsDir = path.join(dataDir, 'logs')
    this.baseEnv = env
    this.spawnChild = spawnChild
    this.preserveManagedNodeOnExit = preserveManagedNodeOnExit
    this.port = Number(env.TETHER_PORT || 18890)
    this.remoteUrl = (env.TETHER_CONTROLLER_URL || '').replace(/\/+$/, '')
    this.accessToken = env.TETHER_ACCESS_TOKEN || ''
    this.insecureTls = ['1', 'true', 'yes'].includes(String(env.TETHER_INSECURE_TLS || '').toLowerCase())
    this.device = env.TETHER_DEVICE || os.hostname()
    this.nodeToken = env.TETHER_NODE_TOKEN || ''
    this.userToken = env.TETHER_USER_TOKEN || ''
    this.nodeMode = env.TETHER_NODE_MODE === 'external' ? 'external' : 'managed'
    this.hubWss = env.TETHER_HUB_WSS || (this.remoteUrl ? this.remoteUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws/node' : '')
    this.consolePort = Number(env.TETHER_CONSOLE_PORT || 18894)
    this.managedNodeStateDir = path.join(dataDir, 'private')
    this.managedNodeStatePath = path.join(this.managedNodeStateDir, 'managed-node-process.json')
    this.managedNodeState = this.readManagedNodeState()
    this.localApiToken = this.managedNodeState && this.managedNodeState.token || crypto.randomBytes(24).toString('hex')
    this.python = env.TETHER_PYTHON || path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    this.appUpdateBridge = null
    if (!fs.existsSync(this.python)) this.python = process.platform === 'win32' ? 'python' : 'python3'
    this.childPython = this.python
    if (process.platform === 'win32') {
      const windowless = String(this.python).replace(/python\.exe$/i, 'pythonw.exe')
      if (windowless !== this.python && fs.existsSync(windowless)) this.childPython = windowless
    }
    this.mode = null
    this.controller = { state: 'stopped', pid: 0, port: this.port, managed: false }
    this.node = { state: 'stopped', pid: 0, deviceOnline: false }
    this.onlineDeviceCount = null
    this.lastError = ''
    this.lastProbe = { status: 'unknown', durationMs: null, checkedAt: null }
    this.procs = { controller: null, node: null }
    this.procArgs = { controller: null, node: null }
    this.timer = null
    fs.mkdirSync(this.logsDir, { recursive: true })
  }

  baseUrl() {
    return this.remoteUrl || 'http://127.0.0.1:' + this.port
  }

  safeServiceUrl(value) {
    try { const url = new URL(value); return url.origin + url.pathname.replace(/\/$/, '') } catch (_) { return '本机 Controller' }
  }

  requestState(timeout = 2500, onFailure) {
    const url = new URL(this.baseUrl() + '/api/state')
    const client = url.protocol === 'https:' ? https : http
    const headers = {}
    if (this.accessToken) headers.authorization = 'Bearer ' + this.accessToken
    return new Promise((resolve) => {
      const req = client.get({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        rejectUnauthorized: url.protocol === 'https:' ? !this.insecureTls : undefined
      }, (res) => {
        if (res.statusCode !== 200) { if (onFailure) onFailure(res.statusCode === 401 || res.statusCode === 403 ? 'auth' : 'unreachable'); res.resume(); resolve(null); return }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => { try { resolve(JSON.parse(body)) } catch (_) { if (onFailure) onFailure('unreachable'); resolve(null) } })
      })
      req.setTimeout(timeout, () => { if (onFailure) onFailure('unreachable'); req.destroy(); resolve(null) })
      req.on('error', () => { if (onFailure) onFailure('unreachable'); resolve(null) })
    })
  }

  async healthy() {
    return await this.requestState()
  }

  async probe() {
    const started = Date.now()
    let errorKind = 'unreachable'
    const state = await this.requestState(2500, (kind) => { errorKind = kind })
    const durationMs = Date.now() - started
    this.lastProbe = { status: state ? 'online' : 'offline', errorKind: state ? null : errorKind, durationMs, checkedAt: new Date().toISOString() }
    this.controller.state = state ? 'online' : 'offline'
    if (this.mode === 'hub' || this.mode === 'external') this.node.deviceOnline = state ? this.deviceOnline(state) : null
    if (!state) this.lastError = errorKind === 'auth' ? '认证失败' : '服务不可达或响应超时'
    else this.lastError = ''
    return { ...this.snapshot(), lastProbe: { ...this.lastProbe } }
  }

  spawnProcess(name, args) {
    const log = fs.openSync(path.join(this.logsDir, name + '.log'), 'a')
    const env = {
      ...this.baseEnv,
      PYTHONPATH: this.repoRoot,
      PYTHONIOENCODING: 'utf-8',
      TETHER_PORT: String(this.port),
      TETHER_HOST: this.baseEnv.TETHER_HOST || '0.0.0.0',
      TETHER_NODE_TOKEN: this.baseEnv.TETHER_NODE_TOKEN || ''
    }
    if (name === 'node') {
      env.TETHER_NODE_MANAGED = '1'
      env.TETHER_LOCAL_API_TOKEN = this.localApiToken
      if (this.appUpdateBridge) {
        env.TETHER_APP_UPDATE_BRIDGE_URL = this.appUpdateBridge.url
        env.TETHER_APP_UPDATE_BRIDGE_TOKEN = this.appUpdateBridge.token
      }
    }
    this.procArgs[name] = args.slice()
    const child = this.spawnChild(this.childPython, args, {
      cwd: this.repoRoot,
      env,
      windowsHide: true,
      detached: (process.platform !== 'win32') || (name === 'node' && this.preserveManagedNodeOnExit && this.mode === 'hub'),
      stdio: ['ignore', log, log]
    })
    child.on('exit', (code) => {
      if (this.procs[name] !== child) return
      this.procs[name] = null
      if (name === 'node') this.clearManagedNodeState(child.pid)
      const target = name === 'controller' ? this.controller : this.node
      target.state = code === 0 ? 'stopped' : 'error'
      target.pid = 0
      if (name === 'node' && code === 75 && this.mode && this.procArgs.node) {
        const online = this.node.deviceOnline
        target.state = 'restarting'
        setTimeout(() => {
          if (this.mode === null || this.procs.node) return
          const replacement = this.spawnProcess('node', this.procArgs.node || [])
          this.procs.node = replacement
          this.saveManagedNodeState(replacement.pid)
          if (this.preserveManagedNodeOnExit && this.mode === 'hub') replacement.unref()
          this.node = { state: 'running', pid: replacement.pid, deviceOnline: online }
        }, 250)
        return
      }
      if (code !== 0) this.lastError = name + ' exited with code ' + code + '; see ' + path.join(this.logsDir, name + '.log')
    })
    return child
  }

  setAppUpdateBridge(bridge) {
    const url = String(bridge && bridge.url || '')
    const token = String(bridge && bridge.token || '')
    if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/v1\/update$/.test(url)
        || !/^[a-f0-9]{64}$/.test(token)) {
      throw Object.assign(new Error('Invalid APP update bridge'), { code: 'app_update_bridge_invalid' })
    }
    this.appUpdateBridge = { url, token }
  }

  readManagedNodeState() {
    if (!fs.existsSync(this.managedNodeStatePath)) return null
    try {
      const state = JSON.parse(fs.readFileSync(this.managedNodeStatePath, 'utf8'))
      if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || typeof state.token !== 'string'
          || state.token.length < 32 || typeof state.device !== 'string' || typeof state.dataDir !== 'string') return { invalid: true }
      return state
    } catch (_) { return { invalid: true } }
  }

  secureManagedNodeStatePath(target, directory = false) {
    if (process.platform !== 'win32') {
      try { fs.chmodSync(target, directory ? 0o700 : 0o600) } catch (error) { throw new Error('Cannot protect the managed Node identity file: ' + error.message) }
      return
    }
    const user = process.env.USERNAME
    if (!user) throw new Error('Cannot determine the Windows account for managed Node file permissions')
    const account = (process.env.USERDOMAIN || '.') + '\\' + user
    const rule = account + (directory ? ':(OI)(CI)F' : ':F')
    const result = spawnSync('icacls.exe', [target, '/inheritance:r', '/grant:r', rule], { windowsHide: true, stdio: 'ignore' })
    if (result.status !== 0) throw new Error('Windows denied private permissions for the managed Node identity file')
  }

  saveManagedNodeState(pid) {
    const state = { pid, token: this.localApiToken, device: this.device,
      dataDir: path.resolve(this.dataDir), controllerUrl: this.remoteUrl,
      port: this.consolePort, startedAt: new Date().toISOString() }
    fs.mkdirSync(this.managedNodeStateDir, { recursive: true, mode: 0o700 })
    this.secureManagedNodeStatePath(this.managedNodeStateDir, true)
    const temporary = this.managedNodeStatePath + '.tmp'
    try { fs.unlinkSync(temporary) } catch (_) { /* no incomplete write */ }
    const fd = fs.openSync(temporary, 'wx', 0o600)
    fs.closeSync(fd)
    this.secureManagedNodeStatePath(temporary)
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 })
    fs.renameSync(temporary, this.managedNodeStatePath)
    this.managedNodeState = state
  }

  clearManagedNodeState(pid) {
    const state = this.readManagedNodeState()
    if (state && state.pid === pid) {
      try { fs.unlinkSync(this.managedNodeStatePath) } catch (_) { /* already cleared */ }
      this.managedNodeState = null
    }
  }

  processAlive(pid) {
    try { process.kill(pid, 0); return true } catch (error) { return error && error.code === 'EPERM' }
  }

  processIdentity(pid) {
    if (process.platform === 'win32') {
      const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($null -eq $p) { exit 2 }; ConvertTo-Json -Compress @{created=$p.CreationDate.ToUniversalTime().ToString('o');path=$p.ExecutablePath}`
      const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
      })
      if (result.status !== 0) return null
      try {
        const value = JSON.parse(String(result.stdout || '').trim())
        return value.created && value.path ? { created: value.created, path: path.resolve(value.path) } : null
      } catch (_) { return null }
    }
    if (process.platform === 'linux') {
      try {
        const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8')
        const end = stat.lastIndexOf(')')
        const startTicks = stat.slice(end + 2).trim().split(/\s+/)[19]
        const executable = fs.realpathSync('/proc/' + pid + '/exe')
        return startTicks && executable ? { created: startTicks, path: executable } : null
      } catch (_) { return null }
    }
    if (process.platform === 'darwin') {
      const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      const created = String(result.stdout || '').trim()
      return result.status === 0 && created ? { created, path: path.resolve(this.python) } : null
    }
    return null
  }

  sameManagedNodeProcess(state) {
    const identity = this.processIdentity(state.pid)
    if (!identity || !state.processCreatedAt || !state.processPath) return false
    const normalize = (value) => path.resolve(value).toLowerCase()
    return identity.created === state.processCreatedAt && normalize(identity.path) === normalize(state.processPath)
  }

  async attachManagedNode() {
    const state = this.managedNodeState
    if (!state) return false
    if (state.invalid) throw Object.assign(new Error('受管 Node 身份文件无效；为避免启动重复设备，已停止自动启动。'), { code: 'managed_node_state_invalid' })
    const matches = state.device === this.device && state.dataDir === path.resolve(this.dataDir)
      && state.controllerUrl === this.remoteUrl && state.port === this.consolePort
    if (!matches) {
      if (this.processAlive(state.pid)) throw Object.assign(new Error('已有受管 Node 身份与当前 Hub 配置不一致，请先从原 APP 停止该 Node。'), { code: 'managed_node_identity_mismatch' })
      this.clearManagedNodeState(state.pid)
      return false
    }
    if (this.processAlive(state.pid) && !this.sameManagedNodeProcess(state)) {
      throw Object.assign(new Error('保存的 Node PID、创建时间或可执行路径不匹配；为避免误接管或重复设备，已停止自动启动。'), { code: 'managed_node_process_mismatch' })
    }
    const ready = await waitForLocalNodeApi({ port: state.port, device: state.device, token: state.token }, { timeoutMs: 2500 })
    if (ready) {
      this.localApiToken = state.token
      this.node = { state: 'running', pid: state.pid, deviceOnline: null }
      this.lastError = ''
      return true
    }
    if (this.processAlive(state.pid)) {
      throw Object.assign(new Error('已有受管 Node 进程未通过本地身份探测；为避免启动重复设备，已停止自动启动。'), { code: 'managed_node_unverified' })
    }
    this.clearManagedNodeState(state.pid)
    return false
  }

  async stopManagedNode() {
    const child = this.procs.node
    const state = this.managedNodeState
    if (!child && !state) return { stopped: false }
    if (!child && state && state.invalid) throw Object.assign(new Error('受管 Node 身份文件无效，不能安全停止进程。'), { code: 'managed_node_state_invalid' })
    const pid = child && child.pid || state && state.pid
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Object.assign(new Error('受管 Node PID 无效，不能安全停止进程。'), { code: 'managed_node_process_mismatch' })
    if (!this.processAlive(pid)) {
      this.clearManagedNodeState(pid)
      if (child) this.procs.node = null
      return { stopped: false }
    }
    if (state && (state.pid !== pid || !this.sameManagedNodeProcess(state))) {
      throw Object.assign(new Error('受管 Node 创建时间或可执行路径不匹配，拒绝停止该PID。'), { code: 'managed_node_process_mismatch' })
    }
    const token = state && state.token || this.localApiToken
    const ready = await waitForLocalNodeApi({ port: this.consolePort, device: this.device, token }, { timeoutMs: 1500 })
    if (!ready) throw Object.assign(new Error('受管 Node 身份探测失败，拒绝停止未确认进程。'), { code: 'managed_node_unverified' })
    if (child) this.procs.node = null
    killTree(pid)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && await waitForLocalNodeApi({ port: this.consolePort, device: this.device, token }, { timeoutMs: 250 })) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (await waitForLocalNodeApi({ port: this.consolePort, device: this.device, token }, { timeoutMs: 250 })) {
      throw Object.assign(new Error('受管 Node 在停止请求后仍通过原身份探测。'), { code: 'managed_node_stop_pending' })
    }
    this.clearManagedNodeState(pid)
    this.node = { state: 'stopped', pid: 0, deviceOnline: false }
    return { stopped: true }
  }

  async start() {
    if (this.controller.state === 'online' || this.controller.state === 'starting') return this.snapshot()
    if (this.remoteUrl) {
      this.mode = 'hub'
      const probe = await this.healthy()
      this.onlineDeviceCount = this.onlineDevices(probe)
      const parsed = new URL(this.remoteUrl)
      this.controller = {
        state: probe ? 'online' : 'offline',
        pid: 0,
        managed: false,
        url: this.remoteUrl,
        port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
      }
      this.node = { state: 'external', pid: 0, deviceOnline: this.deviceOnline(probe) }
      this.lastError = probe ? '' : '远端 Hub 不可达或请求超时'
      if (this.nodeMode !== 'external' && (this.nodeToken || this.userToken) && this.hubWss) {
        if (this.nodeToken) this.baseEnv.TETHER_NODE_TOKEN = this.nodeToken
        if (this.userToken) this.baseEnv.TETHER_USER_TOKEN = this.userToken
        let attached = false
        if (this.preserveManagedNodeOnExit) {
          try { attached = await this.attachManagedNode() }
          catch (error) {
            this.node = { state: 'error', pid: this.managedNodeState && this.managedNodeState.pid || 0, deviceOnline: false }
            this.lastError = error.message
            this.startPolling()
            return this.snapshot()
          }
        }
        if (attached) {
          this.startPolling()
          return this.snapshot()
        }
        const node = this.spawnProcess('node', [
          '-m', 'tether.node.agent',
          '--workspace', path.join(this.repoRoot, 'work-local'),
          '--agent', this.baseEnv.TETHER_AGENT || 'dsh',
          '--device', this.device,
          '--controller', this.hubWss,
          '--console-port', String(this.consolePort),
          '--db', path.join(this.dataDir, 'node-hub.db')
        ])
        this.procs.node = node
        if (this.preserveManagedNodeOnExit) {
          try { this.saveManagedNodeState(node.pid) }
          catch (error) { this.procs.node = null; killTree(node.pid); throw error }
          node.unref()
        }
        this.node = { state: 'running', pid: node.pid, deviceOnline: this.deviceOnline(probe) }
      }
      this.startPolling()
      return this.snapshot()
    }
    fs.mkdirSync(this.logsDir, { recursive: true })
    const state = await this.healthy()
    this.onlineDeviceCount = this.onlineDevices(state)
    if (state) {
      this.mode = 'external'
      this.controller = { state: 'online', pid: 0, port: this.port, managed: false }
      this.node = { state: 'external', pid: 0, deviceOnline: this.deviceOnline(state) }
      this.startPolling()
      return this.snapshot()
    }

    this.mode = 'standalone'
    this.controller = { state: 'starting', pid: 0, port: this.port, managed: true }
    this.node = { state: 'starting', pid: 0, deviceOnline: false }
    this.lastError = ''
    const serverCheck = spawnSync(this.childPython, ['-c', 'import importlib.util; raise SystemExit(0 if importlib.util.find_spec("tether_server.controller.app") else 1)'], {
      cwd: this.repoRoot, env: this.baseEnv, encoding: 'utf8', windowsHide: true
    })
    if (serverCheck.status !== 0) {
      this.mode = 'missing-server'
      this.controller = { state: 'error', pid: 0, port: this.port, managed: false }
      this.node = { state: 'stopped', pid: 0, deviceOnline: false }
      this.lastError = '未检测到本地私有服务组件。请配置 Hub，或在 APP 使用的 Python 环境中安装私有 tether-harness-server 组件。'
      return this.snapshot()
    }

    const controller = this.spawnProcess('controller', [
      '-m', 'uvicorn', 'tether_server.controller.app:app',
      '--host', this.baseEnv.TETHER_HOST || '127.0.0.1', '--port', String(this.port), '--log-level', 'info'
    ])
    this.procs.controller = controller
    this.controller.pid = controller.pid

    const deadline = Date.now() + 60000
    let ready = false
    while (Date.now() < deadline) {
      if (!this.procs.controller) break
      const probe = await this.healthy()
      if (probe) { ready = true; break }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    if (!ready) {
      this.controller.state = 'error'
      this.lastError = 'controller did not become healthy within 60s; see ' + path.join(this.logsDir, 'controller.log')
      this.stop()
      return this.snapshot()
    }

    this.controller.state = 'online'
    const node = this.spawnProcess('node', [
      '-m', 'tether.node.agent',
      '--workspace', path.join(this.repoRoot, 'work-local'),
      '--agent', this.baseEnv.TETHER_AGENT || 'dsh',
      '--device', this.device,
      '--controller', 'ws://127.0.0.1:' + this.port + '/ws/node',
      '--console-port', String(this.port + 3),
      '--db', path.join(this.dataDir, 'node-local.db')
    ])
    this.procs.node = node
    this.node = { state: 'running', pid: node.pid, deviceOnline: false }
    this.startPolling()
    return this.snapshot()
  }

  deviceOnline(state) {
    const devices = state && state.devices
    if (!Array.isArray(devices)) return null
    return devices.some((item) => item && item.device_id === this.device && item.online)
  }

  onlineDevices(state) {
    const devices = state && state.devices
    return Array.isArray(devices) ? devices.filter((item) => item && item.online).length : null
  }

  startPolling() {
    if (this.timer) return
    this.timer = setInterval(async () => {
      const state = await this.healthy()
      this.onlineDeviceCount = this.onlineDevices(state)
      if (this.mode === 'hub') {
        this.controller.state = state ? 'online' : 'offline'
        this.node.deviceOnline = this.deviceOnline(state)
        this.lastError = state ? '' : '远端 Hub 不可达或请求超时'
        return
      }
      if (state) {
        if (this.controller.state !== 'online') this.controller.state = 'online'
        if (this.mode === 'standalone' && this.node.state === 'running') this.node.deviceOnline = this.deviceOnline(state)
        if (this.mode === 'external') this.node.deviceOnline = this.deviceOnline(state)
      } else if (this.mode === 'external') {
        this.controller.state = 'offline'
      }
    }, 4000)
  }

  async stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    for (const name of ['node', 'controller']) {
      const child = this.procs[name]
      if (!child) continue
      this.procs[name] = null
      killTree(child.pid)
      if (name === 'node') this.clearManagedNodeState(child.pid)
    }
    if (!this.procs.node && this.managedNodeState && !this.managedNodeState.invalid && this.preserveManagedNodeOnExit) {
      const state = this.managedNodeState
      const matches = state.device === this.device && state.dataDir === path.resolve(this.dataDir)
        && state.controllerUrl === this.remoteUrl && state.port === this.consolePort
      if (matches && this.processAlive(state.pid) && this.sameManagedNodeProcess(state)
          && await waitForLocalNodeApi({ port: state.port, device: state.device, token: state.token }, { timeoutMs: 1200 })) {
        killTree(state.pid)
        this.clearManagedNodeState(state.pid)
      }
    }
    this.controller = { state: 'stopped', pid: 0, port: this.port, managed: false }
    this.node = { state: 'stopped', pid: 0, deviceOnline: false }
    this.onlineDeviceCount = null
    this.mode = null
    return this.snapshot()
  }

  stopSync() {
    for (const name of ['node', 'controller']) {
      const child = this.procs[name]
      if (child && name === 'node' && this.preserveManagedNodeOnExit && this.mode === 'hub') {
        try {
          if (!this.managedNodeState || this.managedNodeState.pid !== child.pid) this.saveManagedNodeState(child.pid)
          child.unref()
        } catch (_) { killTree(child.pid) }
      } else if (child) killTree(child.pid)
      this.procs[name] = null
    }
    if (this.timer) clearInterval(this.timer)
  }

  async restart() {
    await this.stop()
    return this.start()
  }

  snapshot() {
    const controller = { ...this.controller }
    if (controller.url) controller.url = this.safeServiceUrl(controller.url)
    return {
      mode: this.mode,
      remoteUrl: this.remoteUrl ? this.safeServiceUrl(this.remoteUrl) : '',
      controller,
      node: { ...this.node },
      onlineDeviceCount: this.onlineDeviceCount,
      python: this.python,
      logsDir: this.logsDir,
      device: this.device,
      error: this.lastError,
      lastProbe: { ...this.lastProbe },
      endpoints: { api: this.safeServiceUrl(this.baseUrl()), plugin: 'http://127.0.0.1:18890' }
    }
  }
}

module.exports = { Supervisor }
