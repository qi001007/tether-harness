import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-updates-electron-'))
const appDir = path.join(tempRoot, 'apps', 'tether-app')
const python = path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
const electron = path.join(projectRoot, 'apps', 'tether-app', 'node_modules', 'electron', 'dist', 'electron.exe')
const outputPath = path.resolve(process.argv[2] || path.join(projectRoot, '.runtime', 'qa-update-center.png'))
const workspaceMode = process.argv[3] || 'valid'
const qaAccessToken = 'qa-only-access-token'
let electronProc
let controller
let electronStdout = ''
let electronStderr = ''

function copy(source, destination) {
  const info = fs.statSync(source)
  if (!info.isDirectory()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
    return
  }
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source)) copy(path.join(source, entry), path.join(destination, entry))
}

async function main() {
  process.stderr.write('[qa-updates] starting isolated Electron render at ' + tempRoot + '\n')
  if (!fs.existsSync(python) || !fs.existsSync(electron)) throw new Error('Expected the project Python and Electron runtimes to be installed.')
  process.stderr.write('[qa-updates] copying isolated app sources\n')
  fs.mkdirSync(appDir, { recursive: true })
  for (const name of ['main.js', 'dsh-web-navigation.js', 'preload.js', 'supervisor.js', 'startup-readiness.js', 'renderer-diagnostics.js', 'enrollment.js', 'update-service.js', 'update-helper.js', 'package.json']) {
    process.stderr.write('[qa-updates] copy app/' + name + '\n')
    const destination = path.join(appDir, name)
    copy(path.join(projectRoot, 'apps', 'tether-app', name), destination)
    if (name === 'main.js') {
      let source = fs.readFileSync(destination, 'utf8')
      const localApi = /localApi: supervisor\.remoteUrl\s*\?\s*\{ device: supervisor\.device, port: supervisor\.consolePort, token: supervisor\.localApiToken \}\s*:\s*null/
      if (!localApi.test(source)) throw new Error('QA expected the Electron local-node route to be isolated')
      source = source.replace(localApi, 'localApi: null')
      const settingsFlow = `if (panel) {
      const labels = panel.split('>').map((value) => value.trim()).filter(Boolean)
      for (const label of labels) {
        await mainWindow.webContents.executeJavaScript(\`(() => { const buttons = [...document.querySelectorAll('button')]; const b = buttons.find((x) => x.getAttribute('aria-label') === \${JSON.stringify(label)} || x.title === \${JSON.stringify(label)} || x.innerText.trim() === \${JSON.stringify(label)}) || buttons.find((x) => x.innerText.includes(\${JSON.stringify(label)})); if (b) b.click(); return !!b })()\`)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      await new Promise((resolve) => setTimeout(resolve, shotPanelDelay))
    }`
      const panelStart = source.indexOf('    if (panel) {', source.indexOf('if (shotPath)'))
      const panelEnd = source.indexOf('    if (row) {', panelStart)
      if (panelStart < 0 || panelEnd < panelStart) throw new Error('QA expected the existing panel-selection flow')
      source = source.slice(0, panelStart) + '    ' + settingsFlow + '\n' + source.slice(panelEnd)
      const updateCheck = `hasUpdateCenter: (document.querySelector('#root')?.innerText || '').includes('更新中心')`
      const settingsCheck = `hasUpdateCenter: (() => { const dialog = document.querySelector('[role="dialog"][aria-label="设置"]'); return !!dialog && [...dialog.querySelectorAll('[aria-current="page"]')].some((item) => item.innerText.trim() === '更新') })(), hasAppUpdateRow: (() => { const dialog = document.querySelector('[role="dialog"][aria-label="设置"]'); return !!dialog && dialog.innerText.includes('APP') })(), hasNodeUpdateRow: (() => { const dialog = document.querySelector('[role="dialog"][aria-label="设置"]'); return !!dialog && dialog.innerText.includes('Node') })(), hasDshPluginUpdateRow: (() => { const dialog = document.querySelector('[role="dialog"][aria-label="设置"]'); return !!dialog && dialog.innerText.includes('插件') })()`
      if (!source.includes(updateCheck)) throw new Error('QA expected the current update-center DOM check')
      source = source.replace(updateCheck, settingsCheck)
      fs.writeFileSync(destination, source)
    }
  }
  process.stderr.write('[qa-updates] copy shared WebUI\n')
  copy(path.join(projectRoot, 'packages', 'tether-ui', 'web'), path.join(tempRoot, 'packages', 'tether-ui', 'web'))
  const webIndex = path.join(tempRoot, 'packages', 'tether-ui', 'web', 'index.html')
  copy(path.join(projectRoot, 'assets'), path.join(tempRoot, 'assets'))
  copy(path.join(projectRoot, 'version.json'), path.join(tempRoot, 'version.json'))
  for (const name of ['__init__.py', 'updates.py', 'updates_cli.py']) {
    copy(path.join(projectRoot, 'tether', name), path.join(tempRoot, 'tether', name))
  }
  for (const name of ['__init__.py', 'dsh_sessions.py']) {
    copy(path.join(projectRoot, 'tether', 'node', name), path.join(tempRoot, 'tether', 'node', name))
  }
  process.stderr.write('[qa-updates] starting isolated stub Controller\n')
  const portProbe = http.createServer()
  await new Promise((resolve, reject) => portProbe.listen(0, '127.0.0.1', resolve).once('error', reject))
  const controllerPort = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const diagnosticScript = '<script>window.__qaRendererErrorCount = 0; window.localStorage.setItem("tether.hub", ' + JSON.stringify(JSON.stringify({ url: 'http://127.0.0.1:' + controllerPort, token: qaAccessToken, email: 'qa@example.test', role: 'owner' })) + '); window.addEventListener("error", () => { window.__qaRendererErrorCount += 1 }); window.addEventListener("unhandledrejection", () => { window.__qaRendererErrorCount += 1 });</script>\n'
  fs.writeFileSync(webIndex, fs.readFileSync(webIndex, 'utf8').replace('<script type="module"', diagnosticScript + '<script type="module"'))

  const consolePortProbe = http.createServer()
  await new Promise((resolve, reject) => consolePortProbe.listen(0, '127.0.0.1', resolve).once('error', reject))
  const consolePort = consolePortProbe.address().port
  await new Promise((resolve) => consolePortProbe.close(resolve))

  controller = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    if (req.headers.authorization !== 'Bearer ' + qaAccessToken) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ detail: { error: 'QA mock token required' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    const localCapabilities = { app_protocol: 1, surface_protocol: 1, fs: true, app_version: '0.4.2', node_version: '0.4.2', plugin_version: '0.4.2' }
    const remoteCapabilities = { ...localCapabilities, app_version: '0.4.0', node_version: '0.4.0', plugin_version: '9.9.9' }
    const devices = [
      { device_id: 'qa-local-node', name: 'QA local node', online: true, capabilities: localCapabilities },
      { device_id: 'qa-device-no-node', name: 'QA remote device', online: true, capabilities: remoteCapabilities }
    ]
    const route = new URL(req.url, 'http://qa-controller').pathname
    const component = new URL(req.url, 'http://qa-controller').searchParams.get('component') || 'node'
    const targetId = route.match(/\/api\/devices\/([^/]+)/)?.[1] || ''
    const version = targetId === 'qa-local-node' ? '0.4.2' : '0.4.0'
    let body = { devices, edges: [{ from: 'qa-local-node', to: 'qa-device-no-node' }], sessions: [], runs: [] }
    if (route === '/api/state') body = { devices, edges: [{ from: 'qa-local-node', to: 'qa-device-no-node' }], sessions: [], runs: [] }
    else if (/\/workspaces$/.test(route)) body = workspaceMode === 'invalid-workspaces' ? { error: 'missing workspace list' } : { workspaces: [] }
    else if (/\/policy$/.test(route)) body = { mode: 'restricted', allowed_roots: [], updated_by: 'qa', updated_at: 0 }
    else if (/\/audit$/.test(route)) body = { entries: [], count: 0, retained: 100000 }
    else if (/\/drives$/.test(route)) body = { drives: [{ name: 'QA volume', path: 'C:\\' }] }
    else if (/\/dsh\/sessions$/.test(route)) body = { sessions: [] }
    else if (/\/dsh_status$/.test(route)) body = { installed: false, running: false, surface: false, version: '', installing: false }
    else if (/\/updates(?:\/status)?$/.test(route)) body = {
      current_version: version,
      latest_version: version,
      update_available: false,
      check_error: '',
      from_cache: false,
      restart_required: false
    }
    res.end(JSON.stringify(body))
  })
  await new Promise((resolve, reject) => controller.listen(controllerPort, '127.0.0.1', resolve).once('error', reject))

  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_PATH: path.join(projectRoot, 'apps', 'tether-app', 'node_modules'),
    TETHER_PYTHON: python,
    TETHER_CONTROLLER_URL: 'http://127.0.0.1:' + controllerPort,
    TETHER_ACCESS_TOKEN: qaAccessToken,
    TETHER_NODE_TOKEN: '',
    TETHER_CONSOLE_PORT: String(consolePort),
    TETHER_DEVICE: 'qa-local-node',
    TETHER_NATIVE_DSH_HOME: path.join(tempRoot, 'dsh-home'),
    TETHER_NO_SHORTCUTS: '1',
    TETHER_APP_PORT: '0',
    TETHER_APP_SHOT_DELAY: workspaceMode === 'invalid-workspaces' ? '100' : '2000',
    TETHER_APP_SHOT_PANEL_DELAY: workspaceMode === 'invalid-workspaces' ? '500' : '5000',
    TETHER_UPDATE_MANIFEST_URL: 'https://127.0.0.1:1/tether-update.json'
  }
  delete env.ELECTRON_RUN_AS_NODE
  const panelPath = workspaceMode === 'invalid-workspaces'
    ? '设置>更新>原生工作区>设置>更新'
    : '设置>更新'
  electronProc = spawn(electron, [appDir, '--user-data-dir=' + path.join(tempRoot, '.electron-user-data'), '--shot', '--panel=' + panelPath], {
    cwd: tempRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  electronProc.stdout.setEncoding('utf8').on('data', (chunk) => { electronStdout += chunk })
  electronProc.stderr.setEncoding('utf8').on('data', (chunk) => { electronStderr += chunk })
  const code = await new Promise((resolve, reject) => {
    electronProc.once('error', reject)
    const timeout = setTimeout(() => {
      try { electronProc.kill() } catch (_) { /* already gone */ }
      reject(new Error('Isolated Electron QA timed out.\nstdout:\n' + electronStdout + '\nstderr:\n' + electronStderr))
    }, 45000)
    electronProc.once('exit', (value) => { clearTimeout(timeout); resolve(value) })
  })
  const screenshot = path.join(tempRoot, '.runtime', 'tether-app-shot.png')
  const logPath = path.join(appDir, 'data', 'app.log')
  const logs = [electronStdout, electronStderr, fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''].filter(Boolean).join('\n')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath + '.log', logs)
  if (code !== 0 || !fs.existsSync(screenshot)) {
    throw new Error('Electron QA failed with exit code ' + code + (logs ? '\n' + logs : '\n(no Electron output or app.log was produced)'))
  }
  fs.copyFileSync(screenshot, outputPath)
  if (!logs.includes('"rendererConsoleErrors":0') || !logs.includes('"qaRendererErrorCount":0')) throw new Error('Renderer reported an error or unhandled rejection; see ' + outputPath + '.log')
  if (!logs.includes('"hasUpdateCenter":true')) throw new Error('Expected the update center in the rendered DOM; see ' + outputPath + '.log')
  if (!logs.includes('"hasAppUpdateRow":true') || !logs.includes('"hasNodeUpdateRow":true') || !logs.includes('"hasDshPluginUpdateRow":false')) {
    throw new Error('Expected APP and Node rows without a DSH plugin row in desktop settings; see ' + outputPath + '.log')
  }
  if (workspaceMode === 'invalid-workspaces' && !logs.includes('"hasWorkspaceError":true')) throw new Error('Invalid workspace response was not shown in the UI; see ' + outputPath + '.log')
  if (!logs.includes('services hub controller=online')) throw new Error('Expected the isolated Controller service to be online; see ' + outputPath + '.log')
  process.stdout.write(JSON.stringify({ ok: true, screenshot: outputPath, log: outputPath + '.log' }) + '\n')
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\n')
  process.exitCode = 1
}).finally(async () => {
  if (electronProc && electronProc.exitCode === null) { try { electronProc.kill() } catch (_) { /* already gone */ } }
  if (controller) await new Promise((resolve) => controller.close(resolve))
  fs.rmSync(tempRoot, { recursive: true, force: true })
})
