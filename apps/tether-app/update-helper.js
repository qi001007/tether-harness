const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const configPath = process.argv[2]
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const logPath = path.join(config.userData, 'update-helper.log')
if (config.component !== 'app' || !/^[A-Za-z0-9_-]{8,160}$/.test(config.preparedId) || !Array.isArray(config.launchArgs)) throw new Error('Invalid APP update helper configuration')
if (typeof process.send === 'function') process.send({ ready: true })

function log(value) {
  fs.appendFileSync(logPath, new Date().toISOString() + ' ' + value + '\n')
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

async function main() {
  const deadline = Date.now() + 120000
  while (alive(config.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250))
  if (alive(config.pid)) throw new Error('APP did not exit before update timeout')

  const commandArgs = (action) => ['-m', 'tether.updates_cli', action, '--component', 'app', '--root', config.root, '--state-dir', config.stateDir, '--dsh-home', config.dshHome]
  const activity = spawnSync(config.python, commandArgs('activity'), {
    cwd: config.stagingDir,
    env: { ...process.env, ...config.env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024
  })
  let activityData = {}
  try { activityData = JSON.parse(String(activity.stdout || '').trim()) } catch (_) { /* fail closed below */ }
  if (activity.error || activity.status !== 0 || !activityData.ok || activityData.busy) {
    const detail = activity.error && activity.error.message || activityData.error || activityData.message || activityData.reason || String(activity.stderr || activity.stdout || 'activity could not be verified').trim()
    log('activity check failed status=' + activity.status + ' detail=' + String(detail).slice(0, 500))
    throw new Error('APP update stopped: ' + detail)
  }

  const args = [...commandArgs('apply'), '--prepared-id', config.preparedId]
  const result = spawnSync(config.python, args, {
    cwd: config.stagingDir,
    env: { ...process.env, ...config.env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 1024 * 1024
  })
  if (result.error) throw result.error
  let data = {}
  try { data = JSON.parse(String(result.stdout || '').trim()) } catch (_) { /* report command output below */ }
  if (result.status !== 0 || data.ok === false) throw new Error(data.error || data.message || String(result.stderr || result.stdout || 'Update failed').trim())
  fs.writeFileSync(config.resultPath, JSON.stringify({ ok: true, version: data.version || '', completed_at: new Date().toISOString() }))
  log('apply complete version=' + (data.version || 'unknown'))

  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(config.executable, config.launchArgs, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: childEnv
  })
  child.unref()
}

main().catch((error) => {
  try { fs.writeFileSync(config.resultPath, JSON.stringify({ ok: false, message: String(error.message || error).slice(0, 500), completed_at: new Date().toISOString() })) } catch (_) { /* result file is best effort */ }
  log('apply failed: ' + (error.stack || error))
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(config.executable, config.launchArgs, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: childEnv
  })
  child.unref()
})
