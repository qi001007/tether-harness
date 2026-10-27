const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

class UpdateService {
  constructor({ repoRoot, dataDir, python, env, app, exec = execFileAsync, spawnChild = spawn }) {
    this.repoRoot = repoRoot
    this.dataDir = dataDir
    this.python = python
    this.env = env
    this.app = app
    this.exec = exec
    this.spawnChild = spawnChild
    this.dshHome = env.TETHER_NATIVE_DSH_HOME || path.join(os.homedir(), '.dsh')
    this.helperSource = path.join(__dirname, 'update-helper.js')
    this.preparedIds = new Set()
  }

  async run(command, preparedId) {
    const stateDir = path.join(this.dataDir, 'updates')
    const args = ['-m', 'tether.updates_cli', command, '--component', 'app', '--root', this.repoRoot, '--state-dir', stateDir, '--dsh-home', this.dshHome]
    if (preparedId) args.push('--prepared-id', preparedId)
    const env = { ...this.env, PYTHONPATH: this.repoRoot, PYTHONIOENCODING: 'utf-8' }
    try {
      const { stdout } = await this.exec(this.python, args, {
        cwd: this.repoRoot,
        env,
        windowsHide: true,
        timeout: command === 'check' ? 45000 : 120000,
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
  check() { return this.run('check') }
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
    const lastResultPath = path.join(this.app.getPath('userData'), 'update-result.json')
    try { fs.unlinkSync(lastResultPath) } catch (_) { /* no previous result */ }
    const result = await this.run('prepare')
    if (typeof result.prepared_id === 'string') this.preparedIds.add(result.prepared_id)
    return result
  }

  async apply(preparedId) {
    await this.activity()
    if (typeof preparedId !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(preparedId) || !this.preparedIds.has(preparedId)) {
      throw Object.assign(new Error('更新包标识无效'), { code: 'invalid_prepared_id' })
    }
    const userData = this.app.getPath('userData')
    const helperPath = path.join(userData, 'tether-update-helper.js')
    const configPath = path.join(userData, 'tether-update-helper.json')
    const stagingDir = path.join(userData, 'update-helper-runtime')
    const stagingPackage = path.join(stagingDir, 'tether')
    const stagingNodePackage = path.join(stagingPackage, 'node')
    const runtimeFiles = [
      [path.join(this.repoRoot, 'tether', 'updates.py'), path.join(stagingPackage, 'updates.py')],
      [path.join(this.repoRoot, 'tether', 'updates_cli.py'), path.join(stagingPackage, 'updates_cli.py')],
      [path.join(this.repoRoot, 'tether', '__init__.py'), path.join(stagingPackage, '__init__.py')],
      [path.join(this.repoRoot, 'tether', 'node', '__init__.py'), path.join(stagingNodePackage, '__init__.py')],
      [path.join(this.repoRoot, 'tether', 'node', 'dsh_sessions.py'), path.join(stagingNodePackage, 'dsh_sessions.py')]
    ]
    if (runtimeFiles.some(([source]) => !fs.existsSync(source))) throw new Error('更新助手文件缺失，请先安装包含更新器的 Tether 发行版')
    fs.mkdirSync(userData, { recursive: true })
    fs.mkdirSync(stagingNodePackage, { recursive: true })
    for (const [source, destination] of runtimeFiles) fs.copyFileSync(source, destination)
    fs.copyFileSync(this.helperSource, helperPath)
    const config = {
      pid: process.pid,
      python: this.python,
      root: this.repoRoot,
      stateDir: path.join(this.dataDir, 'updates'),
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
}

module.exports = { UpdateService }
