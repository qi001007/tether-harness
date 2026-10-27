const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try { process.kill(-pid, 'SIGTERM') } catch (_) { try { process.kill(pid, 'SIGTERM') } catch (_) { /* gone */ } }
  }
}

class Supervisor {
  constructor({ repoRoot, dataDir, env, spawnChild = spawn }) {
    this.repoRoot = repoRoot
    this.dataDir = dataDir
    this.logsDir = path.join(dataDir, 'logs')
    this.baseEnv = env
    this.spawnChild = spawnChild
    this.port = Number(env.TETHER_PORT || 18890)
    this.remoteUrl = (env.TETHER_CONTROLLER_URL || '').replace(/\/+$/, '')
    this.accessToken = env.TETHER_ACCESS_TOKEN || ''
    this.insecureTls = ['1', 'true', 'yes'].includes(String(env.TETHER_INSECURE_TLS || '').toLowerCase())
    this.device = env.TETHER_DEVICE || os.hostname()
    this.nodeToken = env.TETHER_NODE_TOKEN || ''
    this.hubWss = env.TETHER_HUB_WSS || (this.remoteUrl ? this.remoteUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws/node' : '')
    this.consolePort = Number(env.TETHER_CONSOLE_PORT || 18894)
    this.python = env.TETHER_PYTHON || path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    if (!fs.existsSync(this.python)) this.python = process.platform === 'win32' ? 'python' : 'python3'
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
      TETHER_NODE_TOKEN: this.baseEnv.TETHER_NODE_TOKEN || 'dev-token'
    }
    if (name === 'node') env.TETHER_NODE_MANAGED = '1'
    this.procArgs[name] = args.slice()
    const child = this.spawnChild(this.python, args, {
      cwd: this.repoRoot,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', log, log]
    })
    child.on('exit', (code) => {
      if (this.procs[name] !== child) return
      this.procs[name] = null
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
          this.node = { state: 'running', pid: replacement.pid, deviceOnline: online }
        }, 250)
        return
      }
      if (code !== 0) this.lastError = name + ' exited with code ' + code + '; see ' + path.join(this.logsDir, name + '.log')
    })
    return child
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
      if (this.nodeToken && this.hubWss) {
        this.baseEnv.TETHER_NODE_TOKEN = this.nodeToken
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
    const serverCheck = spawnSync(this.python, ['-c', 'import importlib.util; raise SystemExit(0 if importlib.util.find_spec("tether_server.controller.app") else 1)'], {
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
      if (child) killTree(child.pid)
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
