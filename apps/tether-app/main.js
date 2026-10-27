const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { Supervisor } = require('./supervisor.js')

const repoRoot = path.resolve(__dirname, '..', '..')
const webRoot = path.join(repoRoot, 'packages', 'tether-ui', 'web')
const dataDir = path.join(__dirname, 'data')
const logFile = path.join(dataDir, 'app.log')

function loadEnv() {
  const env = { ...process.env }
  const file = path.join(repoRoot, '.env')
  if (!fs.existsSync(file)) return env
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) env[key] = value
  }
  return env
}

const env = loadEnv()
const hubConfigFile = path.join(dataDir, 'hub.json')
if (fs.existsSync(hubConfigFile)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(hubConfigFile, 'utf8'))
    if (cfg.url) env.TETHER_CONTROLLER_URL = cfg.url
    if (cfg.accessToken) env.TETHER_ACCESS_TOKEN = cfg.accessToken
    if (cfg.nodeToken) env.TETHER_NODE_TOKEN = cfg.nodeToken
    if (cfg.device) env.TETHER_DEVICE = cfg.device
  } catch (_) { /* invalid local config is ignored */ }
}
const controller = env.TETHER_CONTROLLER_URL || ('http://127.0.0.1:' + (env.TETHER_PORT || 18890))
const shotIndex = process.argv.indexOf('--shot')
const shotPath = shotIndex >= 0 ? path.join(repoRoot, '.runtime', 'tether-app-shot.png') : ''
const panelArg = process.argv.find((value) => value.startsWith('--panel='))
const panel = panelArg ? panelArg.slice('--panel='.length) : ''
const rowArg = process.argv.find((value) => value.startsWith('--row='))
const row = rowArg ? rowArg.slice('--row='.length) : ''
const shotDelay = Number(process.env.TETHER_APP_SHOT_DELAY || 2500)

fs.mkdirSync(dataDir, { recursive: true })
app.setPath('userData', path.join(dataDir, 'electron'))
const supervisor = new Supervisor({ repoRoot, dataDir, env })

function log(line) {
  fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n')
}

let mainWindow = null
let webServer = null

async function createWindow() {
  const { createWebServer } = await import(pathToFileURL(path.join(webRoot, 'server.mjs')).href)
  webServer = createWebServer({
    root: webRoot,
    controller,
    port: Number(env.TETHER_APP_PORT || 18892),
    accessToken: env.TETHER_ACCESS_TOKEN || '',
    insecureTls: ['1', 'true', 'yes'].includes(String(env.TETHER_INSECURE_TLS || '').toLowerCase())
  })
  const url = await webServer.listen()
  log('app start ' + app.getVersion() + ' ui ' + url + ' controller ' + controller)
  supervisor.start().then((state) => log('services ' + state.mode + ' controller=' + state.controller.state + ' node=' + state.node.state)).catch((error) => log('services failed ' + (error.stack || error)))

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Tether',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  await mainWindow.loadURL(url)

  if (shotPath) {
    await new Promise((resolve) => setTimeout(resolve, shotDelay))
    if (panel) {
      await mainWindow.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(panel)} || x.title === ${JSON.stringify(panel)}); if (b) b.click(); return !!b })()`)
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    if (row) {
      await mainWindow.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(row)}); if (b) b.click(); return !!b })()`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const image = await mainWindow.webContents.capturePage()
    fs.mkdirSync(path.dirname(shotPath), { recursive: true })
    fs.writeFileSync(shotPath, image.toPNG())
    log('shot ' + shotPath)
    app.quit()
  }
}

ipcMain.handle('tether:app-info', () => ({
  version: app.getVersion(),
  controller,
  dataDir,
  logFile,
  services: supervisor.snapshot()
}))
ipcMain.handle('tether:services', () => supervisor.snapshot())
ipcMain.handle('tether:start-services', () => supervisor.start())
ipcMain.handle('tether:stop-services', () => supervisor.stop())
ipcMain.handle('tether:restart-services', () => supervisor.restart())
ipcMain.handle('tether:open-logs', () => shell.openPath(supervisor.logsDir))
ipcMain.handle('tether:open-data', () => shell.openPath(dataDir))
ipcMain.handle('tether:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url)
  return false
})

const locked = app.requestSingleInstanceLock()
if (!locked) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })
  app.whenReady().then(createWindow).catch((error) => {
    log('start failed ' + (error.stack || error))
    app.quit()
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  supervisor.stopSync()
  if (webServer) webServer.close()
})