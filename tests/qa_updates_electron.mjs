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
  for (const name of ['main.js', 'preload.js', 'supervisor.js', 'update-service.js', 'update-helper.js', 'package.json']) {
    process.stderr.write('[qa-updates] copy app/' + name + '\n')
    copy(path.join(projectRoot, 'apps', 'tether-app', name), path.join(appDir, name))
  }
  process.stderr.write('[qa-updates] copy shared WebUI\n')
  copy(path.join(projectRoot, 'packages', 'tether-ui', 'web'), path.join(tempRoot, 'packages', 'tether-ui', 'web'))
  const webIndex = path.join(tempRoot, 'packages', 'tether-ui', 'web', 'index.html')
  const diagnosticScript = '<script>window.__qaRendererErrorCount = 0; window.addEventListener("error", () => { window.__qaRendererErrorCount += 1 }); window.addEventListener("unhandledrejection", () => { window.__qaRendererErrorCount += 1 });</script>\n'
  fs.writeFileSync(webIndex, fs.readFileSync(webIndex, 'utf8').replace('<script type="module"', diagnosticScript + '<script type="module"'))
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

  controller = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    let body = { devices: [{ device_id: 'qa-device-no-node', name: 'QA device', online: true, capabilities: { app_protocol: 1, surface_protocol: 1, fs: true } }], sessions: [], runs: [] }
    if (/\/workspaces(?:\?|$)/.test(req.url)) body = workspaceMode === 'invalid-workspaces' ? { error: 'missing workspace list' } : { workspaces: [] }
    else if (/\/sessions(?:\?|$)/.test(req.url)) body = { sessions: [] }
    else if (/\/runs(?:\?|$)/.test(req.url)) body = { runs: [] }
    else if (/\/drives(?:\?|$)/.test(req.url)) body = { drives: [] }
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
    TETHER_ACCESS_TOKEN: '',
    TETHER_NODE_TOKEN: '',
    TETHER_DEVICE: 'qa-device-no-node',
    TETHER_NATIVE_DSH_HOME: path.join(tempRoot, 'dsh-home'),
    TETHER_APP_PORT: '0',
    TETHER_APP_SHOT_DELAY: '2000',
    TETHER_APP_SHOT_PANEL_DELAY: '5000',
    TETHER_UPDATE_MANIFEST_URL: 'https://127.0.0.1:1/tether-update.json'
  }
  delete env.ELECTRON_RUN_AS_NODE
  electronProc = spawn(electron, [appDir, '--shot', '--panel=更新'], {
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
      reject(new Error('Isolated Electron QA timed out.'))
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
