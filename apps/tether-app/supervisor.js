const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try { process.kill(-pid, 'SIGTERM') } catch (_) { try { process.kill(pid, 'SIGTERM') } catch (_) { /* gone */ } }
  }
}

class Supervisor {
  constructor({ repoRoot, dataDir, env }) {
    this.repoRoot = repoRoot
    this.dataDir = dataDir
    this.logsDir = path.join(dataDir, 'logs')
    this.baseEnv = env
    this.port = Number(env.TETHER_PORT || 18890)
    this.device = env.TETHER_DEVICE || 'TETHER-APP'
    this.python = env.TETHER_PYTHON || path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    if (!fs.existsSync(this.python)) this.python = process.platform === 'win32' ? 'python' : 'python3'
    this.mode = null
    this.controller = { state: 'stopped', pid: 0, port: this.port, managed: false }
    this.node = { state: 'stopped', pid: 0, deviceOnline: false }
    this.lastError = ''
    this.procs = { controller: null, node: null }
    this.timer = null
    fs.mkdirSync(this.logsDir, { recursive: true })
  }

  async healthy() {
    try {
      const res = await fetch('http://127.0.0.1:' + this.port + '/api/state', { signal: AbortSignal.timeout(1500) })
      if (!res.ok) return null
      return await res.json()
    } catch (_) {
      return null
    }
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
    const child = spawn(this.python, args, {
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
      if (code !== 0) this.lastError = name + ' exited with code ' + code + '; see ' + path.join(this.logsDir, name + '.log')
    })
    return child
  }

  async start() {
    if (this.controller.state === 'online' || this.controller.state === 'starting') return this.snapshot()
    fs.mkdirSync(this.logsDir, { recursive: true })
    const state = await this.healthy()
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
    const controller = this.spawnProcess('controller', [
      '-m', 'uvicorn', 'tether.controller.app:app',
      '--host', this.baseEnv.TETHER_HOST || '0.0.0.0', '--port', String(this.port), '--log-level', 'info'
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
    const devices = (state && state.devices) || []
    return devices.some((item) => item.device_id === this.device && item.online)
  }

  startPolling() {
    if (this.timer) return
    this.timer = setInterval(async () => {
      const state = await this.healthy()
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
    return {
      mode: this.mode,
      controller: { ...this.controller },
      node: { ...this.node },
      python: this.python,
      logsDir: this.logsDir,
      device: this.device,
      error: this.lastError,
      endpoints: { api: 'http://127.0.0.1:' + this.port, plugin: 'http://127.0.0.1:18890' }
    }
  }
}

module.exports = { Supervisor }