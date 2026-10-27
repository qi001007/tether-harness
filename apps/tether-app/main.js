const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const repoRoot = path.resolve(__dirname, '..', '..')
const webRoot = path.join(repoRoot, 'packages', 'tether-ui', 'web')
const dataDir = path.join(__dirname, 'data')
const logFile = path.join(dataDir, 'app.log')
const controller = process.env.TETHER_CONTROLLER || 'http://127.0.0.1:18890'
const shotIndex = process.argv.indexOf('--shot')
const shotPath = shotIndex >= 0 ? path.join(repoRoot, '.runtime', 'tether-app-shot.png') : ''
const panelArg = process.argv.find((value) => value.startsWith('--panel='))
const panel = panelArg ? panelArg.slice('--panel='.length) : ''
const rowArg = process.argv.find((value) => value.startsWith('--row='))
const row = rowArg ? rowArg.slice('--row='.length) : ''

fs.mkdirSync(dataDir, { recursive: true })
app.setPath('userData', path.join(dataDir, 'electron'))

function log(line) {
  fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n')
}

let mainWindow = null
let webServer = null
let healthTimer = null
const status = { controller: 'unknown', url: '', pid: process.pid }

async function probe() {
  let next = 'offline'
  let detail = ''
  try {
    const res = await fetch(controller + '/api/state', { signal: AbortSignal.timeout(2500) })
    next = res.ok ? 'online' : 'error'
    detail = res.ok ? '' : 'HTTP ' + res.status
  } catch (error) {
    detail = error.message
  }
  if (next !== status.controller) {
    status.controller = next
    log('controller ' + next + (detail ? ' (' + detail + ')' : ''))
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tether:status', { ...status })
  }
}

async function createWindow() {
  const { createWebServer } = await import(pathToFileURL(path.join(webRoot, 'server.mjs')).href)
  webServer = createWebServer({ root: webRoot, controller, port: 0 })
  const url = await webServer.listen()
  status.url = url
  log('app start ' + app.getVersion() + ' ui ' + url + ' controller ' + controller)

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

  healthTimer = setInterval(probe, 4000)
  probe()

  if (shotPath) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
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
  status: { ...status }
}))
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
  if (healthTimer) clearInterval(healthTimer)
  if (webServer) webServer.close()
})