const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { promisify } = require('node:util')
const { createInterface } = require('node:readline')

const exec = promisify(execFile)

function ownerDevice(state, id) {
  const device = state.devices?.find((entry) => entry.device_id === id)
  return device?.online && state.user?.user_id && device.owner_id === state.user.user_id ? device : null
}

function idleForMigration(state, sessions, transfers, copy, device) {
  const jobs = Array.isArray(transfers) ? transfers : transfers.jobs ?? transfers.items
  return Array.isArray(state.runs) && Array.isArray(sessions.sessions) && Array.isArray(jobs)
    && !state.runs.some((item) => item.device_id === device && ['queued', 'dispatching', 'running', 'cancelling'].includes(item.state))
    && !sessions.sessions.some((item) => item.status === 'running')
    && jobs.every((item) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.state))
    && ['idle', 'completed', 'failed', 'cancelled'].includes(copy.state)
}

async function finishStandaloneUpgrade({ app, dataDir, resources, device, nodeMode, updated, read, log }) {
  const stateFile = path.join(dataDir, 'private', 'standalone-node-migration.json')
  const adopting = updated && nodeMode === 'external'
  if (!adopting && (nodeMode !== 'managed' || !fs.existsSync(stateFile))) return
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = path.join(resources, 'tools', 'migrate-standalone-node.ps1')
  const args = (action) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Action', action, '-AppExe', app.getPath('exe'), '-AppDataDir', dataDir]
  const options = { windowsHide: true, timeout: 60000, maxBuffer: 256 * 1024 }
  if (!adopting) {
    const installed = ownerDevice(await read('/api/state'), device)
    const caps = installed?.capabilities
    if (caps?.node_update_owner === 'app_installer' && caps.node_version === app.getVersion()
        && caps.app_version === app.getVersion()) {
      await exec(powershell, [...args('Confirm'), '-HubOnlineVerified'], options)
    }
    return
  }
  const { stdout } = await exec(powershell, args('Plan'), options)
  const plan = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
  if (plan.status !== 'plan' || plan.switch_ready !== true) return
  const state = await read('/api/state')
  if (!ownerDevice(state, device)) return
  const prefix = '/api/devices/' + encodeURIComponent(device)
  const [sessions, transfers, copy] = await Promise.all([
    read(prefix + '/dsh/sessions'), read(prefix + '/fs/transfer_job_list', {}),
    read(prefix + '/fs/transfer_status', {})
  ])
  if (!idleForMigration(state, sessions, transfers, copy, device)) return
  const helper = spawn(powershell, [...args('Switch'), '-OwnerActivityVerified', '-WaitForAppExit', String(process.pid)],
    { windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  helper.on('error', () => log('Standalone Node migration helper could not start'))
  const output = createInterface({ input: helper.stdout })
  output.on('line', (line) => {
    if (line === 'TETHER_MIGRATION_READY') {
      output.close()
      helper.unref()
      app.quit()
    }
  })
}

module.exports = { finishStandaloneUpgrade, idleForMigration, ownerDevice }
