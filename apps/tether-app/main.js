const { app, BrowserWindow, ipcMain, shell, session, webFrameMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { Supervisor } = require('./supervisor.js')
const { waitForSupervisorStart, waitForLocalNodeApi } = require('./startup-readiness.js')
const { UpdateService } = require('./update-service.js')
const { rendererDiagnostic, isSurfaceBootFailure, rendererFrameState, rendererRequestScope, rendererSettledFrameState, safeRendererMessage, safeRendererPath } = require('./renderer-diagnostics.js')

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
    if (cfg.url) {
      env.TETHER_CONTROLLER_URL = cfg.url
      if (!env.TETHER_UPDATE_MANIFEST_URL) env.TETHER_UPDATE_MANIFEST_URL = String(cfg.url).replace(/\/+$/, '') + '/releases/manifest'
    }
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
const shotPanelDelay = Number(process.env.TETHER_APP_SHOT_PANEL_DELAY || 1500)

fs.mkdirSync(dataDir, { recursive: true })
app.setPath('userData', path.join(dataDir, 'electron'))
const supervisor = new Supervisor({ repoRoot, dataDir, env })
const updates = new UpdateService({ repoRoot, dataDir, python: supervisor.python, env, app })
let uiOrigin = ''

function log(line) {
  fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n')
}

let mainWindow = null
let webServer = null
let rendererConsoleErrors = 0
let surfaceBootFailureSentAt = 0

function logRendererNetworkFailure(event, details) {
  const scope = rendererRequestScope(details.url, controller)
  if (!scope) return
  const method = /^[A-Z]{1,12}$/.test(details.method || '') ? details.method : 'OTHER'
  const resource = /^[a-z-]{1,32}$/.test(details.resourceType || '') ? details.resourceType : 'other'
  const path = safeRendererPath(details.url)
  if (event === 'error') {
    log('renderer request failed scope=' + scope + ' method=' + method + ' resource=' + resource
      + ' path=' + path + ' error=' + safeRendererMessage(details.error))
  } else if (Number(details.statusCode) >= 400) {
    log('renderer request http-error scope=' + scope + ' method=' + method + ' resource=' + resource
      + ' status=' + Number(details.statusCode) + ' path=' + path)
  }
}

async function createWindow() {
  const startupResult = await waitForSupervisorStart(supervisor.start())
  if (!startupResult.completed) log('services startup wait timed out; loading UI')
  else if (startupResult.error) log('services failed ' + (startupResult.error.stack || startupResult.error))
  else if (startupResult.state) log('services ' + startupResult.state.mode + ' controller=' + startupResult.state.controller.state + ' node=' + startupResult.state.node.state)
  if (startupResult.completed && startupResult.state && startupResult.state.mode === 'hub' && startupResult.state.node.state === 'running') {
    const ready = await waitForLocalNodeApi({
      port: supervisor.consolePort,
      device: supervisor.device,
      token: supervisor.localApiToken
    }, { timeoutMs: 3000 })
    if (!ready) log('local node API readiness timed out; loading UI')
  }

  const { createWebServer } = await import(pathToFileURL(path.join(webRoot, 'server.mjs')).href)
  webServer = createWebServer({
    root: webRoot,
    controller,
    port: Number(env.TETHER_APP_PORT || 18892),
    device: supervisor.device,
    hub: !!supervisor.remoteUrl,
    connectionInfo: () => {
      const state = supervisor.snapshot()
      return { serverUrl: state.remoteUrl || state.endpoints.api, lastProbe: state.lastProbe }
    },
    probeConnection: async () => {
      const state = await supervisor.probe()
      return { serverUrl: state.remoteUrl || state.endpoints.api, lastProbe: state.lastProbe }
    },
    accessToken: env.TETHER_ACCESS_TOKEN || '',
    insecureTls: ['1', 'true', 'yes'].includes(String(env.TETHER_INSECURE_TLS || '').toLowerCase()),
    localApi: supervisor.remoteUrl
      ? { device: supervisor.device, port: supervisor.consolePort, token: supervisor.localApiToken }
      : null
  })
  const url = await webServer.listen()
  uiOrigin = new URL(url).origin
  log('app start ' + app.getVersion() + ' ui ' + url + ' controller ' + controller)
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => logRendererNetworkFailure('error', details))
  session.defaultSession.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => logRendererNetworkFailure('complete', details))
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Tether',
    icon: path.join(repoRoot, 'assets', 'tether.ico'),
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
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    let allowed = false
    try {
      const parsed = new URL(String(navigationUrl))
      allowed = parsed.origin === uiOrigin || parsed.href === 'about:blank'
    } catch (_) { allowed = false }
    if (!allowed) {
      event.preventDefault()
      log('blocked main-frame navigation path=' + safeRendererPath(navigationUrl))
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(String(url))
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString()).catch(() => {})
      }
    } catch (_) { /* deny malformed and non-http(s) URLs */ }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3) rendererConsoleErrors += 1
    if (level >= 3) log(rendererDiagnostic(message, sourceId, line))
    if (level >= 3 && isSurfaceBootFailure(message) && Date.now() - surfaceBootFailureSentAt > 3000) {
      surfaceBootFailureSentAt = Date.now()
      let source = ''
      try { source = new URL(sourceId).href } catch (_) { /* relative console source */ }
      mainWindow.webContents.send('tether:surface-boot-failed', { source })
    }
  })
  mainWindow.webContents.on('did-start-navigation', (_event, navigationUrl, isInPlace, isMainFrame) => {
    if (!isInPlace) log('renderer navigation started main=' + !!isMainFrame + ' path=' + safeRendererPath(navigationUrl))
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    log('renderer load failed main=' + !!isMainFrame + ' code=' + code + ' path=' + safeRendererPath(validatedURL)
      + ' message=' + safeRendererMessage(description))
  })
  mainWindow.webContents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    try {
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (!frame) return
      const frameUrl = frame.url
      const framePath = safeRendererPath(frameUrl)
      const logFrameState = (label, state) => {
        log('renderer frame ' + label + ' main=' + !!isMainFrame + ' path=' + framePath
          + ' readyState=' + state.readyState + ' childElements=' + Number(state.childElements || 0)
          + ' hasComposer=' + !!state.hasComposer)
      }
      rendererFrameState(frame).then((state) => logFrameState('ready', state))
        .catch(() => log('renderer frame ready unavailable main=' + !!isMainFrame + ' path=' + framePath))
      const settledTimer = setTimeout(() => {
        rendererSettledFrameState((pid, routingId) => webFrameMain.fromId(pid, routingId), frameProcessId, frameRoutingId, frameUrl)
          .then((state) => state ? logFrameState('settled', state)
            : log('renderer frame settled unavailable main=' + !!isMainFrame + ' path=' + framePath))
      }, 3000)
      if (typeof settledTimer.unref === 'function') settledTimer.unref()
    } catch (_) { /* frame may have navigated away */ }
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('renderer process gone reason=' + String(details.reason || 'unknown').slice(0, 40) + ' exitCode=' + Number(details.exitCode || 0))
  })
  await mainWindow.loadURL(url)

  if (shotPath) {
    await new Promise((resolve) => setTimeout(resolve, shotDelay))
    if (panel) {
      await mainWindow.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(panel)} || x.title === ${JSON.stringify(panel)} || x.innerText.includes(${JSON.stringify(panel)})); if (b) b.click(); return !!b })()`)
      await new Promise((resolve) => setTimeout(resolve, shotPanelDelay))
    }
    if (row) {
      await mainWindow.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(row)}); if (b) b.click(); return !!b })()`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const renderState = await mainWindow.webContents.executeJavaScript(`({ readyState: document.readyState, rootContent: !!document.querySelector('#root')?.childElementCount, hasUpdateCenter: (document.querySelector('#root')?.innerText || '').includes('更新中心'), hasWorkspaceError: (document.querySelector('#root')?.innerText || '').includes('工作区接口返回的数据格式无效'), appBridge: !!window.tetherApp, qaRendererErrorCount: window.__qaRendererErrorCount || 0 })`)
    renderState.rendererConsoleErrors = rendererConsoleErrors
    log('renderer state ' + JSON.stringify(renderState))
    if (!renderState.rootContent || renderState.rendererConsoleErrors || renderState.qaRendererErrorCount) {
      throw new Error('Renderer did not produce a clean UI: ' + JSON.stringify(renderState))
    }
    if (panel.includes('更新') && !renderState.hasUpdateCenter) {
      throw new Error('Renderer did not show the update center: ' + JSON.stringify(renderState))
    }
    const image = await mainWindow.webContents.capturePage()
    fs.mkdirSync(path.dirname(shotPath), { recursive: true })
    fs.writeFileSync(shotPath, image.toPNG())
    log('shot ' + shotPath)
    app.quit()
  }
}

function trustedIpc(event) {
  try {
    return !!(uiOrigin && event.senderFrame && event.senderFrame === event.sender.mainFrame
      && new URL(event.senderFrame.url).origin === uiOrigin)
  } catch (_) { return false }
}
function handleTrusted(channel, handler, fallback = () => ({ ok: false, error: 'Untrusted IPC caller' })) {
  ipcMain.handle(channel, (event, ...args) => trustedIpc(event) ? handler(event, ...args) : fallback())
}
handleTrusted('tether:app-info', () => ({
  version: app.getVersion(),
  controller,
  dataDir,
  logFile,
  services: supervisor.snapshot()
}), () => ({}))
handleTrusted('tether:reset-surface-auth', async (_event, origin) => {
  let parsed
  try { parsed = new URL(String(origin)) } catch (_) { return { ok: false } }
  const loopback = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
  if (!loopback) return { ok: false }
  try {
    await session.defaultSession.clearStorageData({ origin: parsed.origin, storages: ['cookies', 'localstorage', 'cachestorage'] })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) }
  }
})
function readHubConfig() {
  try { return JSON.parse(fs.readFileSync(hubConfigFile, 'utf8')) || {} } catch (_) { return {} }
}
handleTrusted('tether:enroll-device', async (_event, userToken) => {
  if (typeof userToken !== 'string' || !userToken || userToken.length > 4096) {
    return { ok: false, error: 'invalid session token' }
  }
  const config = readHubConfig()
  const hubUrl = String(config.url || env.TETHER_CONTROLLER_URL || '').replace(/\/+$/, '')
  const deviceId = String(config.device || env.TETHER_DEVICE || '')
  if (!hubUrl || !deviceId) return { ok: false, error: 'Hub or device is not configured' }
  let response
  try {
    response = await fetch(hubUrl + '/api/devices/' + encodeURIComponent(deviceId) + '/enroll', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + userToken, 'Content-Type': 'application/json' },
      body: '{}'
    })
  } catch (_) {
    return { ok: false, error: 'Hub unreachable' }
  }
  let data = {}
  try { data = await response.json() } catch (_) { /* error bodies may be empty */ }
  if (!response.ok || !data.token) {
    const detail = data && data.detail
    return {
      ok: false,
      error: (detail && (detail.error || detail.message)) || (data && data.error) || ('HTTP ' + response.status),
      code: (detail && detail.code) || (data && data.code) || ''
    }
  }
  const next = { ...config, nodeToken: data.token }
  try {
    if (fs.existsSync(hubConfigFile)) fs.copyFileSync(hubConfigFile, hubConfigFile + '.bak-' + Date.now())
    fs.writeFileSync(hubConfigFile + '.tmp', JSON.stringify(next, null, 2) + '\n')
    fs.renameSync(hubConfigFile + '.tmp', hubConfigFile)
  } catch (_) {
    return { ok: false, error: 'could not save the device token' }
  }
  env.TETHER_NODE_TOKEN = data.token
  supervisor.nodeToken = data.token
  try {
    await supervisor.restart()
  } catch (_) {
    return { ok: false, error: 'device token saved but node restart failed' }
  }
  return { ok: true, device_id: data.device_id }
}, () => ({ ok: false, error: 'Untrusted IPC caller' }))
handleTrusted('tether:updates-status', () => updates.status())
handleTrusted('tether:updates-check', () => updates.check())
handleTrusted('tether:updates-prepare', () => updates.prepare())
handleTrusted('tether:updates-apply', async (_event, preparedId) => {
  const result = await updates.apply(preparedId)
  setTimeout(() => app.quit(), 150)
  return result
})
handleTrusted('tether:services', () => supervisor.snapshot())
handleTrusted('tether:probe-services', () => supervisor.probe())
handleTrusted('tether:start-services', () => supervisor.start())
handleTrusted('tether:stop-services', () => supervisor.stop())
handleTrusted('tether:restart-services', () => supervisor.restart())
handleTrusted('tether:open-logs', () => shell.openPath(supervisor.logsDir))
handleTrusted('tether:open-data', () => shell.openPath(dataDir))
handleTrusted('tether:open-external', (_event, url) => {
  try {
    const parsed = new URL(String(url))
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return shell.openExternal(parsed.toString())
  } catch (_) { /* reject malformed URLs */ }
  return false
}, () => false)

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
