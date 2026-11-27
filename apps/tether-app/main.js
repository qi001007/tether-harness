const { app, BrowserWindow, ipcMain, shell, session, safeStorage, webFrameMain, Tray, Menu, nativeImage, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { PARTITION_PREFIX, PARTITION_CACHE_SUBDIRS, partitionBudgetReport,
  partitionDirectoryName, partitionHasCredentialEvidence } = require('./data-maintenance')
const { pathToFileURL } = require('node:url')
const { Supervisor } = require('./supervisor.js')
const { waitForSupervisorStart, waitForLocalNodeApi, getLocalMeshRoute } = require('./startup-readiness.js')
const { createSftpRelayManager, requiresLocalRelayConsent } = require('./sftp-relay.js')
const { UpdateService } = require('./update-service.js')
const { finishStandaloneUpgrade } = require('./standalone-node-migration.js')
const { EventSource } = require('eventsource')
const iconv = require('iconv-lite')
const { migrateLegacyData, registerAppInstallation } = require('./app-installation.js')
const { createNativeWorkbench } = require('./native-workbench.js')
const { createOidcAuth, createCandidateOidcOpenExternal } = require('./oidc-auth')
const { rendererDiagnostic, isSurfaceBootFailure, isSurfaceErrorPage, isSurfaceUnstyled, rendererFrameState, rendererFrameStyleState, rendererFrameText, rendererRequestScope, rendererSettledFrameState, safeRendererMessage, safeRendererPath } = require('./renderer-diagnostics.js')

app.setName('Tether')
// One identity string for the shell: the NSIS appId, the window's task-bar group
// and every desktop entry must agree, or Windows splits them into two groups.
const APP_USER_MODEL_ID = 'com.tether.app'
const packaged = app.isPackaged
const resourcesRoot = packaged ? process.resourcesPath : ''
const repoRoot = packaged ? path.join(resourcesRoot, 'tether-source') : path.resolve(__dirname, '..', '..')
const runtimeRoot = packaged ? path.join(resourcesRoot, 'tether-runtime') : path.join(repoRoot, '.runtime', 'desktop-candidate')
const webRoot = packaged ? path.join(resourcesRoot, 'tether-ui', 'web') : path.join(repoRoot, 'packages', 'tether-ui', 'web')
const candidateMode = ['1', 'true', 'yes'].includes(String(process.env.TETHER_APP_CANDIDATE || '').toLowerCase())
const dataDirOverride = String(process.env.TETHER_APP_DATA_DIR || '').trim()
const dataDir = dataDirOverride ? path.resolve(dataDirOverride) : path.join(app.getPath('userData'), 'data')
const logFile = path.join(dataDir, 'app.log')
const processCreationTime = typeof process.getCreationTime === 'function' ? process.getCreationTime() : null
const appStartedAt = Number.isFinite(processCreationTime) ? processCreationTime : Date.now() - process.uptime() * 1000
let appStartedVersion = ''
try { appStartedVersion = String(JSON.parse(fs.readFileSync(path.join(repoRoot, 'version.json'), 'utf8')).components.app || '') } catch (_) { /* unknown runtime version */ }
const hubConfigFile = path.join(dataDir, 'hub.json')
const workbenchLoginStateFile = path.join(dataDir, 'workbench-login-state.json')
const DSH_AUTH_COOKIE_PREFIX = 'dsh-auth'
migrateLegacyData({ dataDir, candidateMode, dataDirOverride })

function loadEnv() {
  const env = { ...process.env }
  if (candidateMode || packaged) return env
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
let managedNode
function packagedExecutable(component, executable) {
  const componentRoot = path.join(runtimeRoot, 'components', component)
  const matches = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) matches.push(target)
    }
  }
  if (fs.existsSync(componentRoot)) walk(componentRoot)
  if (matches.length !== 1) throw new Error('Packaged runtime executable is missing or ambiguous: ' + component + '/' + executable)
  return matches[0]
}
if (packaged) {
  const exe = process.platform === 'win32' ? '.exe' : ''
  env.TETHER_PYTHON = path.join(runtimeRoot, 'tether-python' + exe)
  if (!fs.existsSync(env.TETHER_PYTHON)) throw new Error('Packaged Python runtime is missing')
  env.TETHER_APP_UPDATE_OWNER = 'app_installer'
  env.TETHER_NODE_UPDATE_OWNER = 'app_installer'
  env.TETHER_RUNTIME_ROOT = runtimeRoot
  env.TETHER_AGENTS_RUNTIME_DIR = path.join(repoRoot, 'tether', 'node', 'bin', 'agents-runtime')
  env.TETHER_HERDR_RUNTIME_DIR = path.join(repoRoot, 'tether', 'node', 'bin')
  env.TETHER_DSH_RUNTIME_DIR = path.join(runtimeRoot, 'components', 'dsh')
  env.TETHER_SFTPGO_COMPONENT_DIR = path.join(runtimeRoot, 'components', 'sftpgo')
  env.TETHER_CADDY = packagedExecutable('caddy', 'caddy' + exe)
  env.TETHER_RCLONE = packagedExecutable('rclone', 'rclone' + exe)
  if (candidateMode && !env.TETHER_UPDATE_CHANNEL) env.TETHER_UPDATE_CHANNEL = 'preview'
  env.TETHER_EASYTIER_CORE = packagedExecutable('easytier', 'easytier-core' + exe)
  env.TETHER_EASYTIER_CLI = packagedExecutable('easytier', 'easytier-cli' + exe)
  env.TETHER_NODEJS_EXE = process.platform === 'win32'
    ? path.join(runtimeRoot, 'components', 'nodejs', 'node.exe')
    : path.join(runtimeRoot, 'components', 'nodejs', 'bin', 'node')
  env.TETHER_MESHCENTRAL_ROOT = path.join(runtimeRoot, 'components', 'meshcentral')
  if (process.platform === 'win32') env.TETHER_SOFFICE_EXE = path.join(runtimeRoot, 'components', 'libreoffice', 'program', 'soffice.com')
  else if (process.platform === 'linux') env.TETHER_SOFFICE_EXE = path.join(runtimeRoot, 'components', 'libreoffice', 'opt', 'libreoffice26.8', 'program', 'soffice')
  else if (process.platform === 'darwin') env.TETHER_SOFFICE_EXE = path.join(runtimeRoot, 'components', 'libreoffice', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
  let meshAgent
  if (process.platform === 'win32' && process.arch === 'x64') meshAgent = path.join('windows-x64', 'MeshService64.exe')
  else if (process.platform === 'darwin' && process.arch === 'arm64') meshAgent = path.join('macos-arm64', 'meshagent_osx-arm-64')
  else if (process.platform === 'darwin' && process.arch === 'x64') meshAgent = path.join('macos-x64', 'meshagent_osx-x86-64')
  else if (process.platform === 'linux' && process.arch === 'x64') meshAgent = path.join('linux-x64', 'meshagent_x86-64')
  else throw new Error('Packaged MeshAgent architecture is not supported')
  env.TETHER_MESHAGENT_EXE = path.join(runtimeRoot, 'components', 'meshagent', meshAgent)
}
if (candidateMode) {
  env.TETHER_NO_SHORTCUTS = '1'
  env.TETHER_APP_BINDING = '0'
  env.TETHER_NODE_MODE = 'external'
}
if (!candidateMode && fs.existsSync(hubConfigFile)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(hubConfigFile, 'utf8'))
    if (cfg.url) {
      env.TETHER_CONTROLLER_URL = cfg.url
      if (!env.TETHER_UPDATE_MANIFEST_URL) env.TETHER_UPDATE_MANIFEST_URL = String(cfg.url).replace(/\/+$/, '') + '/releases/manifest'
    }
    if (cfg.accessToken) env.TETHER_ACCESS_TOKEN = cfg.accessToken
    if (cfg.nodeToken) env.TETHER_NODE_TOKEN = cfg.nodeToken
    if (cfg.userToken) env.TETHER_USER_TOKEN = cfg.userToken
    if (cfg.device) env.TETHER_DEVICE = cfg.device
    if (cfg.nodeMode === 'external') env.TETHER_NODE_MODE = cfg.nodeMode
    if (packaged && cfg.nodeMode === 'managed' && cfg.managedNode) {
      managedNode = cfg.managedNode
      env.TETHER_NODE_MODE = 'managed'
    }
  } catch (_) { /* invalid local config is ignored */ }
}
const DEFAULT_CONTROLLER_URL = 'https://8-220-198-26.sslip.io'
const DEFAULT_OIDC_ISSUER = 'https://auth.8-220-198-26.sslip.io'
if (packaged) env.TETHER_CONTROLLER_URL = env.TETHER_CONTROLLER_URL || DEFAULT_CONTROLLER_URL
if (!env.TETHER_UPDATE_MANIFEST_URL) env.TETHER_UPDATE_MANIFEST_URL = String(env.TETHER_CONTROLLER_URL).replace(/\/+$/, '') + '/releases/manifest'
const controller = env.TETHER_CONTROLLER_URL || ('http://127.0.0.1:' + (env.TETHER_PORT || 18890))
if (packaged && !env.TETHER_OIDC_ISSUER) {
  try {
    if (new URL(controller).origin === new URL(DEFAULT_CONTROLLER_URL).origin) {
      env.TETHER_OIDC_ISSUER = DEFAULT_OIDC_ISSUER
    }
  } catch (_) { /* invalid controller URLs are rejected by the trusted controller checks */ }
}
const shotIndex = process.argv.indexOf('--shot')
const shotPath = shotIndex >= 0 ? path.join(candidateMode ? dataDir : path.join(repoRoot, '.runtime'), 'tether-app-shot.png') : ''
const panelArg = process.argv.find((value) => value.startsWith('--panel='))
const panel = panelArg ? panelArg.slice('--panel='.length) : ''
const rowArg = process.argv.find((value) => value.startsWith('--row='))
const row = rowArg ? rowArg.slice('--row='.length) : ''
const shotDelay = Number(process.env.TETHER_APP_SHOT_DELAY || 2500)
const shotPanelDelay = Number(process.env.TETHER_APP_SHOT_PANEL_DELAY || 1500)
function withShotTimeout(promise, stage, timeoutMs) {
  if (!shotPath) return promise
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot stage timed out: ' + stage)), timeoutMs))
  ])
}

const { createDshWebNavigationGuard, createExactEndpointNavigationGuard, dshViewUrlAllowed } = require('./dsh-web-navigation.js')

const BROWSER_WEBVIEW_PARTITION = 'persist:tether-browser'

function webviewAttachAllowed(params) {
  const partition = String(params.partition || '')
  if (partition.startsWith('persist:tether-wb-')) {
    return !!(nativeWorkbench && nativeWorkbench.allowGuest(partition, params.src))
  }
  if (params.partition !== BROWSER_WEBVIEW_PARTITION) return dshViewUrlAllowed(params.src)
  const src = String(params.src || '')
  if (src === 'about:blank') return true
  try {
    const parsed = new URL(src)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (_) { return false }
}

try {
  if (candidateMode || packaged) throw new Error('candidate or packaged mode disables source-tree installation binding')
  registerAppInstallation({ env, dataDir, appRoot: repoRoot, startedAt: appStartedAt, startedVersion: appStartedVersion })
} catch (_) { /* update binding is auxiliary */ }
let appBindingWatcher = null
try {
  if (candidateMode || packaged) throw new Error('candidate or packaged mode disables source-tree installation binding')
  appBindingWatcher = fs.watch(dataDir, (_event, filename) => {
    if (String(filename || '') !== 'device-token.json') return
    try { registerAppInstallation({ env, dataDir, appRoot: repoRoot, startedAt: appStartedAt, startedVersion: appStartedVersion }) } catch (_) { /* update binding is auxiliary */ }
  })
} catch (_) { /* optional device credential changes are also handled on enrollment */ }
app.setPath('userData', path.join(dataDir, 'electron'))
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
// Hub and mesh endpoints must be reached directly; a system proxy can silently
// break them while leaving ordinary browsing intact.
if (env.TETHER_USE_SYSTEM_PROXY !== '1') app.commandLine.appendSwitch('no-proxy-server')

async function configureUpdaterNetwork() {
  // electron-updater uses its own session. Keep Hub and mesh direct, but let
  // update checks and downloads follow the user's system proxy: direct access
  // to GitHub is intermittent on many networks and surfaced as a dead retry
  // button with net::ERR_TIMED_OUT / ERR_CONNECTION_RESET.
  if (String(env.TETHER_UPDATER_PROXY || '').trim().toLowerCase() === 'direct') return
  try {
    const updaterSession = session.fromPartition('electron-updater', { cache: false })
    await updaterSession.setProxy({ mode: 'system' })
  } catch (_) { /* the direct default remains */ }
}
const { enrollmentDecision, newLocalDeviceId, canEnrollManagedNode, requestLocalPairing } = require('./enrollment.js')
const supervisor = new Supervisor({ repoRoot, dataDir, env, managedNode, preserveManagedNodeOnExit: packaged })
const updates = new UpdateService({ repoRoot, dataDir, python: supervisor.childPython, env, app,
  deviceId: supervisor.device,
  stopManagedNode: () => packaged ? supervisor.stopManagedNode() : Promise.resolve({ stopped: false }) })
const oidcAuth = createOidcAuth({
  issuer: env.TETHER_OIDC_ISSUER || DEFAULT_OIDC_ISSUER,
  clientId: 'tether-desktop',
  redirectUri: 'http://127.0.0.1:18893/oauth/callback',
  storageFile: path.join(dataDir, 'oidc-session.json'),
  safeStorage,
  log: (event) => log('authentication event=' + event),
  openExternal: candidateMode && String(env.TETHER_OIDC_BOOTSTRAP_CREDENTIALS_FILE || '').trim()
    ? createCandidateOidcOpenExternal({
      issuer: env.TETHER_OIDC_ISSUER || DEFAULT_OIDC_ISSUER,
      credentialsFile: String(env.TETHER_OIDC_BOOTSTRAP_CREDENTIALS_FILE).trim()
    })
    : (url) => shell.openExternal(url)
})
const legacyControllerSession = { fetch: (...args) => controllerFetch(...args) }
let controllerAuthMode = ''
let legacyUserToken = env.TETHER_USER_TOKEN || ''
let appUpdateBridgeStarted = false
let appUpdateBridgeRegistrationPromise = null
let uiOrigin = ''

function log(line) {
  fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n')
}

function readWorkbenchLoginState() {
  try {
    const state = JSON.parse(fs.readFileSync(workbenchLoginStateFile, 'utf8'))
    const entries = state && typeof state.entries === 'object' && !Array.isArray(state.entries)
      ? state.entries : {}
    const safeEntries = {}
    for (const [name, value] of Object.entries(entries)) {
      const updatedAt = Number(value && value.updatedAt)
      if (isTrustedWorkbenchPartition(name) && Number.isFinite(updatedAt) && updatedAt > 0) {
        safeEntries[name] = { updatedAt }
      }
    }
    return { entries: safeEntries }
  } catch (_) { return { entries: {} } }
}

function writeWorkbenchLoginState(state) {
  try {
    fs.mkdirSync(path.dirname(workbenchLoginStateFile), { recursive: true })
    const temp = workbenchLoginStateFile + '.tmp'
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n')
    fs.renameSync(temp, workbenchLoginStateFile)
    return true
  } catch (_) { return false }
}

function isTrustedWorkbenchPartition(partition) {
  return /^persist:tether-(?:wb-[a-f0-9]{40}|dsh-local)$/.test(String(partition || ''))
}

function isTrustedDshOrigin(origin) {
  try {
    const parsed = new URL(String(origin))
    return (parsed.protocol === 'https:' && parsed.port !== '80')
      || (parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') && Number(parsed.port) > 0)
  } catch (_) { return false }
}

function workbenchInstanceKey(partition) {
  return String(partition || '').replace(/^persist:/, '')
}

async function inspectDshLoginState({ partition, origin }) {
  if (!isTrustedWorkbenchPartition(partition) || !isTrustedDshOrigin(origin)) {
    return { ok: false, state: 'unknown', reason: 'invalid_surface' }
  }
  let cookies
  try {
    cookies = await session.fromPartition(partition).cookies.get({ url: new URL(origin).origin })
  } catch (error) {
    return { ok: false, state: 'unknown', reason: 'partition_unavailable',
      message: String(error && error.message || error).slice(0, 180) }
  }
  const state = cookies.some((cookie) => cookie && typeof cookie.name === 'string'
    && cookie.name.startsWith(DSH_AUTH_COOKIE_PREFIX) && String(cookie.value || '').length > 0) ? 'logged_in' : 'logged_out'
  const checkedAt = Date.now()
  const loginState = readWorkbenchLoginState()
  const evidence = partitionHasCredentialEvidence(
    path.join(app.getPath('userData'), 'Partitions', workbenchInstanceKey(partition)))
  if (state === 'logged_in' || evidence) {
    loginState.entries[partition] = { updatedAt: checkedAt }
    writeWorkbenchLoginState(loginState)
  }
  return { ok: true, state, reason: 'partition_cookie', partitionKey: workbenchInstanceKey(partition),
    checkedAt }
}

// The shell entry is owned by the installer. At startup the APP only brings the
// canonical entry back to the shipped shape and removes the names that older
// install paths wrote, because a second name on the desktop is a user-visible
// defect no matter which path produced it.
function ensureAppShortcuts() {
  if (!packaged || process.platform !== 'win32' || env.TETHER_NO_SHORTCUTS === '1') return
  const canonicalName = 'Tether.lnk'
  const legacyNames = ['Tether APP.lnk', 'Tether-App.cmd', 'Tether APP.cmd']

  // Desktop entries copied from process.execPath kept whatever path launched the
  // APP. A machine that starts it through the D:\Apps\Tether compatibility
  // junction would then teach the desktop to point at the junction forever.
  const resolveReal = (value) => { try { return fs.realpathSync(value) } catch (_) { return value } }
  const samePath = (left, right) => !!left && !!right &&
    path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()

  const target = resolveReal(process.execPath)
  const installDir = path.dirname(target)
  const iconPath = path.join(installDir, 'resources', 'tether-runtime', 'assets', 'tether-app-s.ico')
  if (!fs.existsSync(iconPath)) {
    log('shortcut repair skipped, packaged icon missing at ' + safeRendererPath(iconPath))
    return
  }
  const options = {
    target,
    cwd: installDir,
    icon: iconPath,
    iconIndex: 0,
    description: 'Tether',
    appUserModelId: APP_USER_MODEL_ID
  }

  const folders = []
  try { folders.push(app.getPath('desktop')) } catch (_) { /* no desktop folder */ }
  try { folders.push(app.getPath('programs')) } catch (_) { /* no start menu folder */ }

  for (const folder of folders) {
    for (const name of legacyNames) {
      const link = path.join(folder, name)
      try {
        if (!fs.existsSync(link)) continue
        let ownedElsewhere = false
        if (/\.lnk$/i.test(name)) {
          const existing = shell.readShortcutLink(link)
          ownedElsewhere = !!(existing && existing.target && fs.existsSync(existing.target) &&
            !samePath(resolveReal(existing.target), target))
        }
        if (ownedElsewhere) {
          log('legacy entry kept, it launches another install: ' + safeRendererPath(link))
          continue
        }
        fs.rmSync(link, { force: true })
        log('legacy entry removed: ' + safeRendererPath(link))
      } catch (error) {
        log('legacy entry cleanup failed path=' + safeRendererPath(link) +
          ' message=' + safeRendererMessage(error && error.message))
      }
    }
    const link = path.join(folder, canonicalName)
    try {
      let existing = null
      try { existing = shell.readShortcutLink(link) } catch (_) { /* missing or unreadable */ }
      if (existing && samePath(existing.target, target) && samePath(existing.cwd, installDir) &&
          samePath(existing.icon, iconPath)) continue
      if (!shell.writeShortcutLink(link, 'replace', options)) throw new Error('writeShortcutLink failed')
      log('entry repaired: ' + safeRendererPath(link))
    } catch (error) {
      log('entry repair failed path=' + safeRendererPath(link) +
        ' message=' + safeRendererMessage(error && error.message))
    }
  }
}

let mainWindow = null
let webServer = null
let tray = null
let isQuitting = false
let rendererConsoleErrors = 0
let surfaceBootFailureSentAt = 0
let surfaceStyleFailureSentAt = 0
let workbenchLoginSession = null
let nativeWorkbench = null
let workbenchActorId = ''
let hubEventSource = null
let hubEventsSubscribed = false
let workbenchBindingPending = false

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send('tether:window-state', {
      maximized: mainWindow.isMaximized(),
      visible: mainWindow.isVisible()
    })
  } catch (_) { /* renderer is between documents */ }
}

function createTray() {
  if (tray) return tray
  const iconPath = path.join(packaged ? runtimeRoot : repoRoot, 'assets', 'tether-app-s.ico')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) log('tray icon failed to load ' + iconPath)
  tray = new Tray(icon)
  tray.setToolTip('Tether')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Tether', click: showMainWindow },
    { type: 'separator' },
    { label: '退出 Tether', click: () => { isQuitting = true; app.quit() } }
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  log('tray created icon=' + iconPath)
  return tray
}

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
  ensureAppShortcuts()
  if (packaged && !appUpdateBridgeStarted) {
    try {
      const bridge = await updates.startAppUpdateBridge()
      if (bridge) {
        supervisor.setAppUpdateBridge(bridge)
        appUpdateBridgeStarted = true
      }
    } catch (error) {
      log('APP update bridge unavailable code=' + String(error && error.code || 'bridge_start_failed').slice(0, 64))
    }
  }
  const startupResult = await waitForSupervisorStart(supervisor.start())
  let localApiReady = false
  if (!startupResult.completed) log('services startup wait timed out; loading UI')
  else if (startupResult.error) log('services failed ' + (startupResult.error.stack || startupResult.error))
  else if (startupResult.state) log('services ' + startupResult.state.mode + ' controller=' + startupResult.state.controller.state + ' node=' + startupResult.state.node.state)
  if (startupResult.completed && startupResult.state && startupResult.state.mode === 'hub'
      && (startupResult.state.node.state === 'running' || supervisor.nodeMode === 'external' && supervisor.externalLocalApiConfigured)) {
    localApiReady = await waitForLocalNodeApi({
      port: supervisor.consolePort,
      device: supervisor.device,
      token: supervisor.localApiToken
    }, { timeoutMs: 3000 })
    if (!localApiReady) log('local node API readiness timed out; loading UI')
  }

  workbenchLoginSession = session.fromPartition('persist:tether-hub-login')
  await oidcAuth.initialize()
  try { await refreshWorkbenchAuthStatus() } catch (error) {
    controllerAuthMode = ''
    log('Controller authentication status unavailable code=' + String(error && error.code || 'status_failed').slice(0, 64))
  }
  void refreshAppUpdateBridgeRegistration()
  const localCodegRuntimePath = managedNode && managedNode.database
    ? path.join(path.dirname(managedNode.database), 'agents-runtime', 'runtime.json') : ''
  nativeWorkbench = createNativeWorkbench({
    controllerUrl: controller,
    loginSession: legacyControllerSession,
    getServiceSession: (partition) => {
      if (!/^persist:tether-wb-[a-f0-9]{40}$/.test(String(partition || ''))) throw new Error('invalid service session partition')
      // Stable partition + persistent HTTP cache: the DSH/Codeg bundles are
      // ~18 MB and every open used to re-download them through the mesh.
      // Partitions are still per actor/target/service and bounded by
      // gcWorkbenchPartitions (data-maintenance.js).
      return session.fromPartition(partition, { cache: true })
    },
    createBootstrapContents: (partition) => {
      if (!/^persist:tether-wb-[a-f0-9]{40}$/.test(String(partition || ''))) throw new Error('invalid bootstrap partition')
      const bootstrapWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true
        }
      })
      bootstrapWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      return {
        contents: bootstrapWindow.webContents,
        destroy: () => { if (!bootstrapWindow.isDestroyed()) bootstrapWindow.destroy() }
      }
    },
    getLocalDeviceId: () => supervisor.device,
    getLocalNodeApiBase: () => supervisor.hasLocalNodeApi()
      ? 'http://127.0.0.1:' + supervisor.consolePort : '',
    localApiSession: {
      fetch: (url, init = {}) => fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: 'Bearer ' + supervisor.localApiToken },
        credentials: 'omit',
        redirect: 'error'
      })
    },
    // The packaged Node is a frozen PyInstaller executable, so it cannot be
    // patched in place. Its local runtime state is the one source the APP can
    // read for its own Codeg without requiring a mesh route.
    getLocalCodegRuntime: () => {
      if (!localCodegRuntimePath) return null
      try {
        const state = JSON.parse(fs.readFileSync(localCodegRuntimePath, 'utf8'))
        const port = Number(state.port)
        const token = typeof state.token === 'string' ? state.token : ''
        return port > 0 && token ? { port, token } : null
      } catch (_) { return null }
    },
    getSourceRoute: async (networkId, sourceDeviceId) => {
      if (!supervisor.remoteUrl || !supervisor.hasLocalNodeApi() || sourceDeviceId !== supervisor.device) {
        throw new Error('local mesh route unavailable')
      }
      if (typeof networkId !== 'string' || !/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(networkId)) {
        throw new Error('invalid mesh network id')
      }
      return getLocalMeshRoute({ port: supervisor.consolePort, device: supervisor.device,
        token: supervisor.localApiToken, networkId })
    },
    getActorId: async (targetId) => {
      if (supervisor.device && targetId === supervisor.device) return workbenchActorId || 'local:' + supervisor.device
      const response = await controllerFetch(new URL('/api/auth/me', controller).toString(), { redirect: 'error' })
      if (!response.ok) throw new Error(response.status === 401 ? 'Controller login required' : 'Controller identity unavailable')
      const user = await response.json()
      if (!user || typeof user.user_id !== 'string' || !user.user_id) throw new Error('Controller returned no authenticated actor')
      return user.user_id
    },
    logSafe: (event, detail) => {
      const target = detail && /^[A-Za-z0-9._:-]{1,128}$/.test(String(detail.targetId || '')) ? detail.targetId : 'unknown'
      const service = detail && /^[a-z]{1,16}$/.test(String(detail.serviceId || '')) ? detail.serviceId : 'unknown'
      log('workbench event=' + String(event).slice(0, 48) + ' target=' + target + ' service=' + service)
    }
  })

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
    localApi: supervisor.remoteUrl && localApiReady && supervisor.hasLocalNodeApi()
      ? { device: supervisor.device, port: supervisor.consolePort, token: supervisor.localApiToken }
      : null
  })
  const url = await webServer.listen()
  uiOrigin = new URL(url).origin
  log('app start ' + app.getVersion() + ' ui ' + url + ' controller ' + controller)
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => logRendererNetworkFailure('error', details))
  session.defaultSession.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => logRendererNetworkFailure('complete', details))
  mainWindow = new BrowserWindow({
    show: shotIndex < 0,
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Tether',
    icon: path.join(packaged ? runtimeRoot : repoRoot, 'assets', 'tether-app-s.ico'),
    backgroundColor: '#ffffff',
    frame: false,
    thickFrame: true,
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: shotIndex >= 0,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: shotIndex < 0
    }
  })
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
    createTray()
  })
  // The shared web document is titled "Tether WebUI". Letting it rename the window
  // would make the taskbar and Alt-Tab disagree with the name the installer puts
  // on the desktop entry, so the shell keeps its own title.
  mainWindow.on('page-title-updated', (event) => { event.preventDefault() })
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    if (!webviewAttachAllowed(params)) {
      event.preventDefault()
      log('blocked webview attach')
    }
  })
  mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
    const browserView = contents.session === session.fromPartition(BROWSER_WEBVIEW_PARTITION)
    let workbenchPolicy = { managed: false }
    if (!browserView && nativeWorkbench) {
      try {
        workbenchPolicy = nativeWorkbench.guestPolicy(contents)
      } catch (_) {
        try { contents.stop() } catch (_) { /* guest may already be gone */ }
        try { contents.destroy() } catch (_) { /* fail closed */ }
        log('blocked unmatched workbench guest')
        return
      }
    }
    const navigation = workbenchPolicy.managed && workbenchPolicy.serviceId === 'dsh-native'
      && !workbenchPolicy.localSurface
      ? createExactEndpointNavigationGuard(workbenchPolicy.endpoint, contents.getURL())
      : createDshWebNavigationGuard(contents.getURL())
    contents.setWindowOpenHandler(({ url }) => {
      if (browserView) {
        try {
          const target = new URL(String(url))
          if (target.protocol === 'http:' || target.protocol === 'https:') void contents.loadURL(target.toString())
        } catch (_) { /* deny malformed and non-http(s) URLs */ }
      }
      return { action: 'deny' }
    })
    if (browserView) return
    contents.on('will-navigate', (event, target) => {
      if (navigation.navigate(target)) return
      event.preventDefault()
      let host = ''
      try { host = new URL(String(target)).host } catch (_) { /* malformed navigation */ }
      log('blocked webview navigation host=' + host)
    })
    contents.on('did-start-navigation', (_event, target, _isInPlace, isMainFrame) => {
      if (navigation.didStart(target, isMainFrame)) return
      contents.stop()
      let host = ''
      try { host = new URL(String(target)).host } catch (_) { /* malformed navigation */ }
      log('stopped webview navigation host=' + host)
    })
    contents.on('will-redirect', (event, target, _isInPlace, isMainFrame) => {
      if (navigation.redirect(target, isMainFrame)) return
      event.preventDefault()
      let host = ''
      try { host = new URL(String(target)).host } catch (_) { /* malformed redirect */ }
      log('blocked webview redirect host=' + host)
    })
    if (nativeWorkbench) {
      void nativeWorkbench.prepareGuest(contents).catch(() => {
        try { contents.stop() } catch (_) { /* guest may already be gone */ }
        try { contents.destroy() } catch (_) { /* fail closed */ }
        log('blocked unmatched workbench guest')
      })
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)
  mainWindow.on('show', sendWindowState)
  mainWindow.webContents.on('did-finish-load', sendWindowState)
  createTray()
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
      if (!isMainFrame) {
        rendererFrameText(frame).then((text) => {
          if (!isSurfaceErrorPage(text) || Date.now() - surfaceBootFailureSentAt <= 3000) return
          surfaceBootFailureSentAt = Date.now()
          log('renderer surface error page path=' + framePath)
          mainWindow.webContents.send('tether:surface-boot-failed', { source: frameUrl })
        }).catch(() => { /* frame may have navigated away */ })
        const styleTimer = setTimeout(() => {
          rendererFrameStyleState(frame).then((state) => {
            if (!isSurfaceUnstyled(state) || Date.now() - surfaceStyleFailureSentAt <= 5000) return
            surfaceStyleFailureSentAt = Date.now()
            log('renderer surface style broken path=' + framePath)
            mainWindow.webContents.send('tether:surface-style-broken', { source: frameUrl })
          }).catch(() => { /* frame may have navigated away */ })
        }, 1500)
        if (typeof styleTimer.unref === 'function') styleTimer.unref()
      }
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
  if (shotPath) log('shot stage loadURL started')
  await withShotTimeout(mainWindow.loadURL(url), 'loadURL', 30000)
  if (shotPath) log('shot stage loadURL complete')

  if (shotPath) {
    log('shot stage wait started')
    await new Promise((resolve) => setTimeout(resolve, shotDelay))
    log('shot stage wait complete')
    if (panel) {
      await mainWindow.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(panel)} || x.title === ${JSON.stringify(panel)} || x.innerText.includes(${JSON.stringify(panel)})); if (b) b.click(); return !!b })()`)
      await new Promise((resolve) => setTimeout(resolve, shotPanelDelay))
    }
    if (row) {
      await mainWindow.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(row)}); if (b) b.click(); return !!b })()`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    log('shot stage renderState started')
    const renderState = await withShotTimeout(mainWindow.webContents.executeJavaScript(`({ readyState: document.readyState, rootContent: !!document.querySelector('#root')?.childElementCount, hasUpdateCenter: (document.querySelector('#root')?.innerText || '').includes('更新中心'), hasWorkspaceError: (document.querySelector('#root')?.innerText || '').includes('工作区接口返回的数据格式无效'), appBridge: !!window.tetherApp, qaRendererErrorCount: window.__qaRendererErrorCount || 0 })`), 'renderState', 10000)
    log('shot stage renderState complete')
    renderState.rendererConsoleErrors = rendererConsoleErrors
    log('renderer state ' + JSON.stringify(renderState))
    if (!renderState.rootContent || renderState.rendererConsoleErrors || renderState.qaRendererErrorCount) {
      throw new Error('Renderer did not produce a clean UI: ' + JSON.stringify(renderState))
    }
    if (panel.includes('更新') && !renderState.hasUpdateCenter) {
      throw new Error('Renderer did not show the update center: ' + JSON.stringify(renderState))
    }
    log('shot stage capturePage started')
    const image = await withShotTimeout(mainWindow.webContents.capturePage(), 'capturePage', 15000)
    log('shot stage capturePage complete')
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
function encodeFilesRequest(request) {
  if (request.operation !== 'content_put' || typeof request.text !== 'string') return request
  if (request.bytes != null || !['utf-8', 'utf-8-bom', 'utf-16-le', 'utf-16-be', 'gb18030'].includes(request.encoding)
      || !['lf', 'crlf', 'cr'].includes(request.newline)) {
    throw new TypeError('Invalid text encoding or newline mode')
  }
  const separator = request.newline === 'crlf' ? '\r\n' : request.newline === 'cr' ? '\r' : '\n'
  const text = request.text.replace(/\r\n|\r|\n/g, separator)
  let bytes
  if (request.encoding === 'utf-8-bom') {
    bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  } else if (request.encoding === 'utf-16-le' || request.encoding === 'utf-16-be') {
    bytes = Buffer.from(text, 'utf16le')
    if (request.encoding === 'utf-16-be') {
      for (let index = 0; index < bytes.length; index += 2) {
        const first = bytes[index]
        bytes[index] = bytes[index + 1]
        bytes[index + 1] = first
      }
    }
  } else if (request.encoding === 'gb18030') {
    bytes = iconv.encode(text, 'gb18030')
    if (iconv.decode(bytes, 'gb18030') !== text) throw new TypeError('Text cannot be represented in GB18030')
  } else {
    bytes = Buffer.from(text, 'utf8')
  }
  return { ...request, text: undefined, bytes }
}
function handleTrusted(channel, handler, fallback = () => ({ ok: false, error: 'Untrusted IPC caller' })) {
  ipcMain.handle(channel, (event, ...args) => trustedIpc(event) ? handler(event, ...args) : fallback())
}
function autoStartFile() {
  return path.join(app.getPath('appData'), 'autostart', 'com.tether.app.desktop')
}
function getAutoStartAtLogin() {
  if (process.platform === 'linux') return fs.existsSync(autoStartFile())
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return !!app.getLoginItemSettings().openAtLogin
  }
  return false
}
function setAutoStartAtLogin(enabled) {
  if (!packaged || candidateMode) throw Object.assign(new Error('登录启动只适用于已安装的正式 APP'), { code: 'autostart_unavailable' })
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean')
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [] })
  } else if (process.platform === 'linux') {
    const target = autoStartFile()
    if (enabled) {
      const directory = path.dirname(target)
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      const quoteExec = (value) => '"' + String(value).replace(/([\\"`$])/g, '\\$1') + '"'
      const contents = '[Desktop Entry]\nType=Application\nName=Tether\nExec=' + quoteExec(process.execPath) +
        '\nTerminal=false\nX-GNOME-Autostart-enabled=true\n'
      const temporary = target + '.tmp'
      fs.writeFileSync(temporary, contents, { mode: 0o600 })
      fs.renameSync(temporary, target)
    } else {
      try { fs.unlinkSync(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  } else {
    throw Object.assign(new Error('当前平台不支持登录启动设置'), { code: 'autostart_unsupported' })
  }
  const actual = getAutoStartAtLogin()
  if (actual !== enabled) throw Object.assign(new Error('操作系统未确认登录启动设置'), { code: 'autostart_unconfirmed' })
  return { ok: true, enabled: actual }
}
async function currentWorkbenchActorId() {
  const origin = trustedControllerOrigin()
  const response = await controllerFetch(new URL('/api/auth/me', origin).toString())
  if (!response.ok) throw new Error(response.status === 401 ? 'Controller login required' : 'Controller identity unavailable')
  const user = await response.json()
  if (!user || typeof user.user_id !== 'string' || !user.user_id) throw new Error('Controller returned no authenticated actor')
  return user.user_id
}
function trustedControllerOrigin() {
  const parsed = new URL(controller)
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Controller API requires a trusted HTTPS or loopback origin')
  }
  return parsed.origin
}
function oidcAuthorizationHeader() {
  return oidcAuth.authorizationHeader()
}
async function controllerFetch(input, init = {}) {
  const target = new URL(input && input.url ? input.url : String(input), trustedControllerOrigin())
  if (target.origin !== trustedControllerOrigin()) throw new Error('Controller API origin is not allowed')
  const headers = new Headers(init.headers || {})
  if (controllerAuthMode === 'oidc') {
    return oidcAuth.fetch(target.toString(), { ...init, headers: Object.fromEntries(headers.entries()), redirect: 'error' })
  }
  if (readHubConfig().desktopAuthMode === 'oidc') throw new Error('Controller login required')
  if (controllerAuthMode === 'legacy-bearer' && legacyUserToken) {
    headers.set('Authorization', 'Bearer ' + legacyUserToken)
    return fetch(target.toString(), { ...init, headers, credentials: 'omit', redirect: 'error' })
  }
  if (!workbenchLoginSession) throw new Error('Controller session is unavailable')
  return workbenchLoginSession.fetch(target.toString(), { ...init, headers, credentials: 'include', redirect: 'error' })
}
async function validateControllerSession(fetcher) {
  const response = await fetcher(new URL('/api/auth/me', trustedControllerOrigin()).toString(), { cache: 'no-store' })
  if (!response.ok) {
    let code = ''
    try { const body = await response.json(); code = String(body?.detail?.code || '') } catch (_) { /* retain auth state only */ }
    return { authenticated: false, identityUnbound: code === 'oidc_identity_unbound', retryable: response.status === 429 || response.status >= 500 }
  }
  const user = await response.json()
  if (!user || typeof user.user_id !== 'string' || !user.user_id) return { authenticated: false, identityUnbound: false }
  return { authenticated: true, identityUnbound: false, user: { user_id: user.user_id, email: user.email || '' } }
}
async function refreshWorkbenchAuthStatus() {
  const oidcStatus = await oidcAuth.ensureSession()
  if (oidcStatus && oidcStatus.state === 'retryable') {
    controllerAuthMode = ''
    return { authenticated: false, identityUnbound: false, retryable: true, source: 'oidc' }
  }
  if (!oidcStatus || oidcStatus.state !== 'authenticated') controllerAuthMode = ''
  const allowLegacyFallback = readHubConfig().desktopAuthMode !== 'oidc'
  if (oidcStatus && oidcStatus.state === 'authenticated' && oidcAuthorizationHeader()) {
    let result
    try { result = await validateControllerSession((url, init) => oidcAuth.fetch(url, init)) } catch (error) {
      if (error && error.code === 'OIDC_REFRESH_UNAVAILABLE') {
        controllerAuthMode = ''
        return { authenticated: false, identityUnbound: false, retryable: true, source: 'oidc' }
      }
      if (error instanceof TypeError && error.message === 'fetch failed') {
        controllerAuthMode = ''
        return { authenticated: false, identityUnbound: false, retryable: true, source: 'oidc' }
      }
      throw error
    }
    if (result.retryable) {
      controllerAuthMode = ''
      return { ...result, source: 'oidc' }
    }
    if (result.authenticated || result.identityUnbound) {
      controllerAuthMode = 'oidc'
      setDesktopAuthMode('oidc')
      workbenchBindingPending = result.identityUnbound
      if (result.authenticated) await setWorkbenchActor(result.user.user_id)
      return { ...result, authenticated: result.authenticated, source: 'oidc',
        localEnrollmentAvailable: result.authenticated && canEnrollLocalDevice() }
    }
  }
  if (allowLegacyFallback && legacyUserToken) {
    const result = await validateControllerSession((url, init = {}) => fetch(url, {
      ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + legacyUserToken }, credentials: 'omit', redirect: 'error'
    }))
    if (result.authenticated) {
      controllerAuthMode = 'legacy-bearer'
      workbenchBindingPending = false
      await setWorkbenchActor(result.user.user_id)
      return { ...result, source: 'legacy-bearer' }
    }
  }
  if (allowLegacyFallback && workbenchLoginSession) {
    let result
    try {
      result = await validateControllerSession((url, init) => workbenchLoginSession.fetch(url, { ...init, credentials: 'include', redirect: 'manual' }))
    } catch (_) {
      controllerAuthMode = ''
      workbenchBindingPending = false
      return { authenticated: false, identityUnbound: false }
    }
    if (result.authenticated) {
      controllerAuthMode = 'legacy-cookie'
      workbenchBindingPending = false
      await setWorkbenchActor(result.user.user_id)
      return { ...result, source: 'legacy-cookie' }
    }
    controllerAuthMode = ''
    workbenchBindingPending = result.identityUnbound
    return result
  }
  controllerAuthMode = ''
  return { authenticated: false, identityUnbound: false }
}
async function setWorkbenchActor(actorId) {
  if (workbenchActorId && workbenchActorId !== actorId) {
    closeHubEvents()
    const result = await nativeWorkbench.clearActor(workbenchActorId)
    if (!result || result.ok !== true) throw new Error('Previous Controller account sessions could not be fully cleared')
  }
  workbenchActorId = actorId
  if (hubEventsSubscribed && actorId) startHubEvents()
  void refreshAppUpdateBridgeRegistration()
}

async function refreshAppUpdateBridgeRegistration(force = false) {
  if (!packaged || !appUpdateBridgeStarted || controllerAuthMode !== 'oidc' || !workbenchActorId) return false
  const deviceId = String(supervisor.device || '')
  const bridge = updates.appUpdateBridge
  if (!deviceId || !bridge || !bridge.url || !bridge.token) return false
  let controllerOrigin
  try { controllerOrigin = trustedControllerOrigin() } catch (_) { return false }
  const identity = { actorId: workbenchActorId, controllerOrigin,
    deviceId, endpoint: bridge.url }
  if (appUpdateBridgeRegistrationPromise) {
    await appUpdateBridgeRegistrationPromise.catch(() => false)
  }
  if (!updates.shouldRefreshAppUpdateBridgeRegistration(identity, force)) return false
  appUpdateBridgeRegistrationPromise = (async () => {
    const stateResponse = await controllerFetch(new URL('/api/state', identity.controllerOrigin).toString(), {
      cache: 'no-store', signal: AbortSignal.timeout(5000)
    })
    if (!stateResponse.ok) return false
    const state = await stateResponse.json()
    const device = Array.isArray(state.devices)
      ? state.devices.find((item) => item && item.device_id === deviceId) : null
    if (!device || !device.online || device.capabilities?.app_update_bridge_registration !== 1) return false
    const response = await controllerFetch(new URL(
      '/api/devices/' + encodeURIComponent(deviceId) + '/updates/app-bridge', identity.controllerOrigin
    ).toString(), {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bridge_url: bridge.url, bridge_token: bridge.token }),
      // The Hub forwards this registration to the Node and allows 15 s; a 5 s
      // client cutoff made every registration time out and retry (DOMException 23).
      signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) return false
    const result = await response.json()
    if (result && result.ok === true && workbenchActorId === identity.actorId
        && supervisor.device === identity.deviceId && trustedControllerOrigin() === identity.controllerOrigin
        && updates.appUpdateBridge?.url === identity.endpoint) {
      updates.rememberAppUpdateBridgeRegistration(identity)
      return true
    }
    return false
  })().catch((error) => {
    log('APP update bridge registration unavailable code=' + String(error && error.code || 'registration_failed').slice(0, 64))
    return false
  }).finally(() => { appUpdateBridgeRegistrationPromise = null })
  return appUpdateBridgeRegistrationPromise
}
function closeHubEvents() {
  if (hubEventSource) hubEventSource.close()
  hubEventSource = null
}
function safeLoginError(error) {
  return String(error && error.message || error || '桌面登录未完成').replace(/[\r\n]+/g, ' ').slice(0, 256)
}
function setDesktopAuthMode(mode) {
  const config = readHubConfig()
  if (config.desktopAuthMode === mode) return
  writeHubConfig({ ...config, desktopAuthMode: mode })
}
function startHubEvents() {
  if (!hubEventsSubscribed || !workbenchActorId || !workbenchLoginSession) return
  if (hubEventSource && hubEventSource.readyState !== EventSource.CLOSED) return
  closeHubEvents()
  let trustedOrigin
  try { trustedOrigin = trustedControllerOrigin() } catch (_) { return }
  const eventsUrl = new URL('/api/events', trustedOrigin)
  if (eventsUrl.origin !== trustedOrigin) return
  hubEventSource = new EventSource(eventsUrl.toString(), {
    fetch: (input, init) => {
      const requested = new URL(input && input.url ? input.url : String(input))
      if (requested.origin !== eventsUrl.origin || requested.pathname !== '/api/events') {
        return Promise.reject(new Error('Controller event URL is not allowed'))
      }
      return controllerFetch(requested.toString(), init)
    }
  })
  hubEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data && data.kind === 'device' && data.device?.device_id === supervisor.device) {
        if (updates.isAppUpdateBridgeReconnect(data.device)) {
          void refreshAppUpdateBridgeRegistration(true)
        }
      }
      if (data && (data.kind === 'device' || data.kind === 'session')
          && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tether:hub-event', data)
    } catch (_) { /* ignore keepalive and malformed messages */ }
  }
}
async function completeWorkbenchLogin(actorId) {
  await setWorkbenchActor(actorId)
  workbenchBindingPending = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tether:workbench-login-result', {
      state: 'authenticated', localEnrollmentAvailable: canEnrollLocalDevice()
    })
  }
}
async function openWorkbenchLogin() {
  if (!oidcAuth) return { ok: false, error: '桌面身份认证不可用' }
  workbenchBindingPending = false
  try {
    const login = await oidcAuth.beginLogin()
    void login.completion.then(async () => {
      setDesktopAuthMode('oidc')
      const result = await refreshWorkbenchAuthStatus()
      if (result.authenticated) await completeWorkbenchLogin(result.user.user_id)
      else if (result.identityUnbound && mainWindow && !mainWindow.isDestroyed()) {
        workbenchBindingPending = true
        mainWindow.webContents.send('tether:workbench-login-result', { state: 'identity_unbound' })
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tether:workbench-login-result', { state: 'closed', error: 'Casdoor 登录已完成，但 Hub 未确认登录状态。' })
      }
    }).catch((error) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tether:workbench-login-result', { state: 'closed', error: safeLoginError(error) })
    })
    return { ok: true, state: 'login_started' }
  } catch (error) {
    return { ok: false, error: String(error && error.message || error || '桌面登录未完成') }
  }
}
async function openWorkbenchDeviceLogin({ writeResultToStdout = false } = {}) {
  if (!oidcAuth) return { ok: false, error: '桌面身份认证不可用' }
  workbenchBindingPending = false
  try {
    const login = await oidcAuth.beginDeviceLogin(({ userCode, verificationUri, expiresIn }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tether:workbench-login-result', { state: 'device_code', userCode, verificationUri })
      }
      if (writeResultToStdout) {
        try { process.stdout.write(JSON.stringify({ verification_uri: verificationUri, user_code: userCode, expires_in: expiresIn }) + '\n') } catch (_) { /* output is optional in GUI launches */ }
      }
    })
    void login.completion.then(async () => {
      setDesktopAuthMode('oidc')
      const result = await refreshWorkbenchAuthStatus()
      if (result.authenticated) await completeWorkbenchLogin(result.user.user_id)
      else if (result.identityUnbound && mainWindow && !mainWindow.isDestroyed()) {
        workbenchBindingPending = true
        mainWindow.webContents.send('tether:workbench-login-result', { state: 'identity_unbound' })
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tether:workbench-login-result', { state: 'closed', error: 'Casdoor 登录已完成，但 Hub 未确认登录状态。' })
      }
    }).catch((error) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tether:workbench-login-result', { state: 'closed', error: safeLoginError(error) })
    })
    return { ok: true, state: 'device_login_started' }
  } catch (error) {
    return { ok: false, error: String(error && error.message || error || '设备码登录未能启动') }
  }
}
handleTrusted('tether:workbench-login', openWorkbenchLogin)
handleTrusted('tether:workbench-auth-status', refreshWorkbenchAuthStatus, () => ({ authenticated: false }))
handleTrusted('tether:workbench-bind-legacy', async (_event, credentials) => {
  if (!workbenchBindingPending || !workbenchLoginSession) {
    throw new Error('Explicit Tether account binding is not pending')
  }
  if (!credentials || typeof credentials !== 'object') throw new Error('Legacy account credentials are required')
  const email = String(credentials.email || '').trim()
  const password = String(credentials.password || '')
  const totp = String(credentials.totp || '').trim()
  if (!email || email.length > 320 || !password || password.length > 4096 || totp.length > 16) {
    throw new Error('Legacy account credentials are invalid')
  }
  const origin = trustedControllerOrigin()
  const login = await workbenchLoginSession.fetch(new URL('/api/auth/login', origin).toString(), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ email, password, totp }), redirect: 'error'
  })
  if (!login.ok) throw new Error('Legacy account sign-in failed; check the account details and try again')
  const oidcStatus = await oidcAuth.ensureSession()
  if (oidcStatus.state === 'retryable') throw new Error('Casdoor 登录状态暂时无法刷新，请稍后再试。')
  const authorization = oidcAuthorizationHeader()
  if (!authorization) throw new Error('Casdoor 登录状态已失效，请重新登录后再绑定。')
  const binding = await workbenchLoginSession.fetch(new URL('/api/auth/identity/bind', origin).toString(), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Authorization: authorization },
    body: '{}', redirect: 'error'
  })
  if (!binding.ok) throw new Error(binding.status === 409
    ? 'This Casdoor identity is already linked to another Tether account'
    : 'Tether account binding failed; the identity was not linked')
  const actorId = await currentWorkbenchActorId()
  await completeWorkbenchLogin(actorId)
  return { state: 'authenticated' }
}, () => ({ state: 'error' }))
handleTrusted('tether:workbench-register-account', async () => {
  if (!workbenchBindingPending) {
    throw new Error('Explicit Tether account creation is not pending')
  }
  const origin = trustedControllerOrigin()
  const response = await oidcAuth.fetch(new URL('/api/auth/identity/register', origin).toString(), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: '{}', redirect: 'error'
  })
  if (!response.ok) {
    let code = ''
    try { const body = await response.json(); code = String(body?.detail?.code || '') } catch (_) { /* keep generic */ }
    const messages = {
      oidc_email_required: '身份提供方没有提供有效邮箱，请先完善账号资料。',
      oidc_email_unverified: '请先在身份提供方验证邮箱，再创建 Tether 账号。',
      oidc_account_conflict: '此邮箱已用于另一个 Tether 账号；请改用绑定现有账号流程。',
      identity_already_bound: '此登录身份已关联其他 Tether 账号。'
    }
    throw new Error(messages[code] || 'Tether 账号创建失败；未关联或覆盖任何现有账号。')
  }
  const actorId = await currentWorkbenchActorId()
  await completeWorkbenchLogin(actorId)
  return { state: 'authenticated' }
}, () => ({ state: 'error' }))
handleTrusted('tether:hub-events-subscribe', async () => {
  hubEventsSubscribed = true
  await setWorkbenchActor(await currentWorkbenchActorId())
  return { ok: true }
}, () => ({ ok: false }))
handleTrusted('tether:hub-events-unsubscribe', () => {
  hubEventsSubscribed = false
  closeHubEvents()
  return { ok: true }
}, () => ({ ok: false }))
handleTrusted('tether:workbench-logout', async () => {
  setDesktopAuthMode('oidc')
  let actorId = workbenchActorId
  if (!actorId) { try { actorId = await currentWorkbenchActorId() } catch (_) { /* already signed out */ } }
  let cleanupOk = true
  if (actorId && nativeWorkbench) {
    try { cleanupOk = (await nativeWorkbench.clearActor(actorId)).ok === true } catch (_) { cleanupOk = false }
  }
  hubEventsSubscribed = false
  workbenchBindingPending = false
  closeHubEvents()
  workbenchActorId = ''
  controllerAuthMode = ''
  legacyUserToken = ''
  await oidcAuth.logout()
  if (workbenchLoginSession) await workbenchLoginSession.clearStorageData()
  return { state: cleanupOk ? 'logged_out' : 'revocation_pending' }
}, () => ({ state: 'error' }))
handleTrusted('tether:workbench-catalog', async (_event, targetId) => nativeWorkbench.catalog(targetId), () => ({ ok: false }))
handleTrusted('tether:workbench-open', async (_event, targetId, serviceId) => nativeWorkbench.open(targetId, serviceId), () => ({ ok: false }))
handleTrusted('tether:workbench-account-status', async (_event, targetId) => nativeWorkbench.accountStatus(targetId), () => ({ ok: false, state: 'unknown', reason: 'workbench_unavailable' }))
handleTrusted('tether:workbench-open-legacy-codeg', async (_event, targetId) => nativeWorkbench.openLegacyCodeg(targetId, {
  allowModernLocal: String(targetId || '') === String(supervisor.device || '')
}), () => ({ ok: false }))
handleTrusted('tether:workbench-open-dsh-surface', async (_event, targetId) => nativeWorkbench.openDshSurface(targetId), () => ({ ok: false }))
handleTrusted('tether:workbench-close', async (_event, targetId, serviceId, grantId) => nativeWorkbench.close(targetId, serviceId, grantId), () => ({ ok: false }))
handleTrusted('tether:workbench-view', async (_event, targetId, serviceId, visible) => nativeWorkbench.view(targetId, serviceId, visible), () => ({ ok: false }))
handleTrusted('tether:files-request', async (_event, request) => {
  if (!nativeWorkbench || !request || typeof request !== 'object') throw new Error('Files service is unavailable')
  return nativeWorkbench.requestFiles(encodeFilesRequest(request))
}, () => ({ ok: false }))
const manageSftpRelay = createSftpRelayManager({ fetchHub: (...args) => controllerFetch(...args) })
// External Nodes can hand their console credentials to the first owner-approved launch.
// Persist only a successful pairing, using the OS keychain and the private App directory.
const externalRelayFile = path.join(dataDir, 'private', 'external-sftp-relay.enc')
function canStoreRelayBinding() {
  return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' ||
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text')
}
function relayConsole() {
  const device = supervisor.device
  const controller = trustedControllerOrigin()
  if (supervisor.hasLocalNodeApi()) {
    return { device, controller, port: supervisor.consolePort, token: supervisor.localApiToken }
  }
  if (supervisor.nodeMode === 'external' && canStoreRelayBinding() && fs.existsSync(externalRelayFile)) {
    const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(externalRelayFile)))
    if (saved.device === device && saved.controller === controller && Number.isInteger(saved.port) &&
        saved.port > 0 && saved.port <= 65535 && /^[A-Za-z0-9._~-]{32,}$/.test(saved.token || '')) return saved
  }
  throw new Error('请先在本机绑定外置 Node 的控制服务')
}
function rememberExternalRelay(binding) {
  if (!supervisor.externalLocalApiConfigured || !canStoreRelayBinding()) return
  const directory = path.dirname(externalRelayFile)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  supervisor.secureManagedNodeStatePath(directory, true)
  const temp = externalRelayFile + '.' + process.pid + '.tmp'
  try {
    fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(binding)), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, externalRelayFile)
  } finally { fs.rmSync(temp, { force: true }) }
}
handleTrusted('tether:sftp-relay', async (_event, request) => {
  if (!supervisor.remoteUrl) throw new Error('本机 Node 控制服务不可用')
  const actorId = await currentWorkbenchActorId()
  if (!actorId) throw new Error('请先登录 Hub')
  const binding = relayConsole()
  const result = await manageSftpRelay(request, binding)
  if ((request.action === 'enable' && result.enabled) || (request.action === 'setPolicy' && result.persistent)) {
    try { rememberExternalRelay(binding) } catch (_) { log('External Node relay pairing could not be saved') }
  }
  return result
})
handleTrusted('tether:hub-request', async (_event, request) => {
  if (!workbenchLoginSession || !nativeWorkbench || !request || typeof request !== 'object') {
    throw new Error('Controller session is unavailable')
  }
  const actorId = await currentWorkbenchActorId()
  await setWorkbenchActor(actorId)
  const method = String(request.method || 'GET').toUpperCase()
  const path = String(request.path || '')
  const teamDelete = method === 'DELETE' && /^\/api\/teams(?:\/[^/]+){1,3}\/?$/.test(path)
  if ((!['GET', 'POST'].includes(method) && !teamDelete) || !path.startsWith('/api/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Controller API route is not allowed')
  }
  if (/^\/api\/(?:auth\/(?:login|accept-invite|identity\/bind)|devices\/[^/]+\/token|releases\/manifest)(?:\/|$)/i.test(path)) {
    throw new Error('Controller API route requires a separate trusted flow')
  }
  const target = new URL(path, trustedControllerOrigin())
  let decodedPath = target.pathname
  try { decodedPath = decodeURIComponent(decodedPath) } catch (_) { throw new Error('Controller API route is not allowed') }
  if (requiresLocalRelayConsent(decodedPath)) throw new Error('中转设置需要本机授权')
  if (/^\/api\/pairing\/(?:codes|exchange)(?:\/|$)/i.test(decodedPath)) {
    throw new Error('Pairing credentials require a separate trusted flow')
  }
  if (/^\/api\/devices\/[^/]+\/dsh\/surface\/?$/i.test(decodedPath)) {
    throw new Error('DSH surface route requires a separate trusted flow')
  }
  if (target.origin !== trustedControllerOrigin() || !target.pathname.startsWith('/api/')) {
    throw new Error('Controller API origin is not allowed')
  }
  const hasBody = method === 'POST' || method === 'DELETE'
  const response = await controllerFetch(target.toString(), {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' },
    body: hasBody ? JSON.stringify(request.body == null ? {} : request.body) : undefined,
    redirect: 'error'
  })
  const text = await response.text()
  let body = null
  if (text) { try { body = JSON.parse(text) } catch (_) { body = { error: 'invalid_json_response' } } }
  return { status: response.status, body }
}, () => ({ status: 401, body: { error: 'untrusted_ipc_caller' } }))
handleTrusted('tether:app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
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
handleTrusted('tether:inspect-surface-login', (_event, request) => inspectDshLoginState(request || {}))
function readHubConfig() {
  try { return JSON.parse(fs.readFileSync(hubConfigFile, 'utf8')) || {} } catch (_) { return {} }
}
const deviceTokenFile = path.join(dataDir, 'device-token.json')
let localEnrollmentPending = false

function canEnrollLocalDevice() {
  return !candidateMode && controllerAuthMode === 'oidc' && !localEnrollmentPending
    && canEnrollManagedNode({ supervisor, config: readHubConfig(), hasDeviceTokenFile: fs.existsSync(deviceTokenFile) })
}
function writeHubConfig(next) {
  const current = readHubConfig()
  const config = current.nodeMode === 'external' && next.nodeMode == null
    ? { ...next, nodeMode: 'external' }
    : next
  if (fs.existsSync(hubConfigFile)) fs.copyFileSync(hubConfigFile, hubConfigFile + '.bak-' + Date.now())
  fs.writeFileSync(hubConfigFile + '.tmp', JSON.stringify(config, null, 2) + '\n')
  fs.renameSync(hubConfigFile + '.tmp', hubConfigFile)
}
function removeDeviceToken() {
  try { fs.rmSync(deviceTokenFile, { force: true }) } catch (_) { /* missing token is fine */ }
}
async function applyEnrollment(config, deviceToken, userToken) {
  try {
    writeHubConfig({ ...config, nodeToken: deviceToken || '', userToken: userToken || '' })
  } catch (_) {
    return { ok: false, error: 'could not save the device credential' }
  }
  removeDeviceToken()
  if (config.device && config.device !== supervisor.device) {
    env.TETHER_DEVICE = config.device
    supervisor.device = config.device
    updates.deviceId = config.device
  }
  env.TETHER_NODE_TOKEN = deviceToken || ''
  env.TETHER_USER_TOKEN = userToken || ''
  if (!packaged) try { registerAppInstallation({ env, dataDir, appRoot: repoRoot, startedAt: appStartedAt, startedVersion: appStartedVersion }) } catch (_) { /* update binding is auxiliary */ }
  supervisor.nodeToken = deviceToken || ''
  supervisor.userToken = userToken || ''
  try {
    await supervisor.restart()
  } catch (_) {
    return { ok: false, code: 'node_restart_failed', error: 'credential saved but node restart failed' }
  }
  return { ok: true, device_id: String(config.device || env.TETHER_DEVICE || '') }
}
handleTrusted('tether:workbench-enroll-local-device', async () => {
  if (!canEnrollLocalDevice()) return { ok: false, unavailable: true, error: '本机已有设备身份或由独立 Node 管理。' }
  localEnrollmentPending = true
  try {
    const actorId = await currentWorkbenchActorId()
    const origin = trustedControllerOrigin()
    const deviceId = newLocalDeviceId(supervisor.device)
    const canContinue = () => controllerAuthMode === 'oidc' && workbenchActorId === actorId
      && canEnrollManagedNode({ supervisor, config: readHubConfig(), hasDeviceTokenFile: fs.existsSync(deviceTokenFile) })
    if (!canContinue()) return { ok: false, error: '登录状态或本机身份已变化，请重新确认。' }
    const deviceToken = await requestLocalPairing({
      origin, actorId, deviceId, platform: process.platform,
      issue: controllerFetch, exchange: fetch, canContinue
    })
    if (!canContinue()) return { ok: false, error: '登录状态或本机身份已变化，请重新确认。' }
    const receipt = await applyEnrollment({ ...readHubConfig(), device: deviceId }, deviceToken, '')
    if (!receipt.ok && receipt.code !== 'node_restart_failed') {
      return { ok: false, error: '无法保存本机设备凭据，请重试。' }
    }
    if (!receipt.ok) return { ok: false, unavailable: true, error: '已保存本机凭据，请重启 Tether 连接本机。' }
    const localApi = { port: supervisor.consolePort, device: deviceId, token: supervisor.localApiToken }
    const ready = await waitForLocalNodeApi(localApi)
    webServer.setLocalIdentity(deviceId, ready ? localApi : null)
    if (!ready) return { ok: false, unavailable: true, error: '已保存本机凭据。若本机未连上，请重启 Tether。' }
    return { ok: true, device_id: deviceId }
  } catch (_) {
    return { ok: false, error: '本机接入未完成，请检查 Hub 连接后重试。' }
  } finally {
    localEnrollmentPending = false
  }
})

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
  const decision = enrollmentDecision(response.ok, data)
  if (decision.mode === 'device') {
    return applyEnrollment(config, decision.token, '')
  }
  if (decision.mode === 'refuse') {
    return { ok: false, code: decision.code, error: decision.error }
  }
  if (decision.mode === 'account') {
    const result = await applyEnrollment(config, '', userToken)
    if (result.ok) result.mode = 'account'
    return result
  }
  return { ok: false, error: decision.error || ('HTTP ' + response.status), code: decision.code }
}, () => ({ ok: false, error: 'Untrusted IPC caller' }))
handleTrusted('tether:updates-status', () => updates.status())
handleTrusted('tether:updates-check', () => updates.check())
handleTrusted('tether:updates-prepare', () => updates.prepare())
handleTrusted('tether:autostart-get', () => ({ ok: true, enabled: getAutoStartAtLogin(), available: packaged && !candidateMode }))
handleTrusted('tether:autostart-set', (_event, enabled) => setAutoStartAtLogin(enabled))
handleTrusted('tether:updates-apply', async (_event, preparedId) => {
  const result = await updates.apply(preparedId)
  if (!packaged) setTimeout(() => app.quit(), 150)
  return result
})
handleTrusted('tether:window-control', (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false }
  if (action === 'minimize') {
    mainWindow.minimize()
    return { ok: true, maximized: mainWindow.isMaximized(), visible: mainWindow.isVisible() }
  }
  if (action === 'toggle-maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return { ok: true, maximized: mainWindow.isMaximized(), visible: mainWindow.isVisible() }
  }
  if (action === 'close') {
    mainWindow.close()
    return { ok: true, visible: mainWindow.isVisible() }
  }
  if (action === 'state') {
    return { ok: true, maximized: mainWindow.isMaximized(), visible: mainWindow.isVisible() }
  }
  return { ok: false }
}, () => ({ ok: false }))
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
handleTrusted('tether:open-installed-apps', async () => {
  if (process.platform !== 'win32') return { ok: false, error: '当前系统不提供这个卸载入口' }
  await shell.openExternal('ms-settings:appsfeatures')
  return { ok: true }
}, () => ({ ok: false, error: 'Untrusted IPC caller' }))

const locked = app.requestSingleInstanceLock()
if (!locked) {
  app.quit()
} else {
  let pendingInstalledSignIn = packaged && !candidateMode && process.platform === 'win32'
    ? process.argv.includes('--device-sign-in') ? { mode: 'device', writeResultToStdout: true }
      : process.argv.includes('--sign-in') ? { mode: 'browser', writeResultToStdout: false } : null
    : ''
  let startupComplete = false
  let installedSignInRunning = false
  async function runInstalledSignIn() {
    if (!pendingInstalledSignIn || !startupComplete || installedSignInRunning) return
    const signInIntent = pendingInstalledSignIn
    pendingInstalledSignIn = null
    installedSignInRunning = true
    try {
      showMainWindow()
      const result = signInIntent.mode === 'device'
        ? await openWorkbenchDeviceLogin({ writeResultToStdout: signInIntent.writeResultToStdout })
        : await openWorkbenchLogin()
      if (!result.ok) {
        log('installed sign-in could not start')
        dialog.showErrorBox('Tether 登录未能启动', '登录流程无法启动。请检查登录状态并重试。')
      }
    } finally {
      installedSignInRunning = false
      if (pendingInstalledSignIn) void runInstalledSignIn()
    }
  }
  app.on('second-instance', (_event, commandLine) => {
    showMainWindow()
    if (packaged && !candidateMode && process.platform === 'win32' && Array.isArray(commandLine)) {
      if (commandLine.some((argument) => argument === '--device-sign-in')) pendingInstalledSignIn = { mode: 'device', writeResultToStdout: false }
      else if (commandLine.some((argument) => argument === '--sign-in')) pendingInstalledSignIn = { mode: 'browser', writeResultToStdout: false }
      void runInstalledSignIn()
    }
  })
  async function inspectDshAuthCookiePartition(partitionDirectory, name) {
    try {
      const partition = 'persist:' + name
      if (!isTrustedWorkbenchPartition(partition)) return { checked: false, logged: false, evidence: false }
      const evidence = partitionHasCredentialEvidence(partitionDirectory)
      let checked = false
      try {
        const cookies = await session.fromPartition(partition).cookies.get({})
        checked = true
        return { checked, evidence,
          logged: cookies.some((cookie) => cookie && typeof cookie.name === 'string'
            && cookie.name.startsWith(DSH_AUTH_COOKIE_PREFIX) && String(cookie.value || '').length > 0) }
      } catch (_) { return { checked: false, evidence, logged: evidence } }
    } catch (_) { return { checked: false, logged: false, evidence: false } }
  }

  function clearWorkbenchCacheOnly(dir, name) {
    let cleared = 0
    for (const relative of PARTITION_CACHE_SUBDIRS) {
      try {
        const target = path.join(dir, name, ...relative.split('/'))
        if (!fs.existsSync(target)) continue
        fs.rmSync(target, { recursive: true, force: true })
        cleared += 1
      } catch (_) { /* Chromium may still hold an open cache handle */ }
    }
    return cleared
  }

  async function gcWorkbenchPartitions() {
    try {
      const dir = path.join(app.getPath('userData'), 'Partitions')
      const raw = fs.readdirSync(dir).filter((name) => name.startsWith(PARTITION_PREFIX))
      const entries = []
      const unknownAccountSource = []
      const loginState = readWorkbenchLoginState()
      const cookieEvidencePartitions = []
      for (const name of raw) {
        const partitionKey = 'persist:' + name
        if (loginState.entries[partitionKey] || !isTrustedWorkbenchPartition(partitionKey)) continue
        if (partitionHasCredentialEvidence(path.join(dir, name))) {
          cookieEvidencePartitions.push(name)
        }
      }
      for (const name of raw) {
        try {
          const partitionDirectory = path.join(dir, name)
          const state = await inspectDshAuthCookiePartition(partitionDirectory, name)
          const evidence = state.evidence
          if (!state.checked && !evidence) unknownAccountSource.push(name)
          entries.push({
            name,
            mtimeMs: fs.statSync(partitionDirectory).mtimeMs,
            hasLoginState: state.logged || evidence
          })
        } catch (_) {
          unknownAccountSource.push(name)
        }
      }
      const protectedPartitions = [
        'tether-dsh-local',
        ...unknownAccountSource,
        ...cookieEvidencePartitions,
        ...(nativeWorkbench && typeof nativeWorkbench.activeServicePartitions === 'function'
          ? nativeWorkbench.activeServicePartitions().map(partitionDirectoryName) : [])
      ]
      const report = partitionBudgetReport(entries, { protectedPartitions, loginEntries: loginState.entries })
      for (const name of report.removable) {
        try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }) } catch (_) { /* busy */ }
      }
      const trimmed = report.cacheTrim.filter((name) => clearWorkbenchCacheOnly(dir, name) > 0)
      if (report.removable.length || trimmed.length) {
        log('gc partitions removed=' + report.removable.length + ' cache_only=' + trimmed.length)
        for (const name of report.removable) delete loginState.entries['persist:' + name]
        writeWorkbenchLoginState(loginState)
      }
    } catch (_) { /* fresh install has no partitions directory */ }
  }

  app.whenReady().then(async () => {
    await configureUpdaterNetwork()
    void gcWorkbenchPartitions().catch((error) => log('partition gc failed ' + safeRendererMessage(error && error.message)))
    setInterval(() => void gcWorkbenchPartitions().catch(() => {}), 24 * 60 * 60 * 1000).unref?.()
    await createWindow()
    startupComplete = true
    await runInstalledSignIn()
    if (packaged && !candidateMode && process.platform === 'win32') {
      void finishStandaloneUpgrade({ app, dataDir, resources: process.resourcesPath,
        device: supervisor.device, nodeMode: supervisor.nodeMode, updated: process.argv.includes('--updated'), log,
        restoreLoginStart: () => setAutoStartAtLogin(true),
        read: async (route, body) => {
          const options = { cache: 'no-store', signal: AbortSignal.timeout(15000) }
          if (body) Object.assign(options, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body) })
          const response = await controllerFetch(new URL(route, trustedControllerOrigin()).toString(), options)
          if (!response.ok) throw new Error('Node adoption status unavailable')
          const payload = await response.json()
          if (payload.ok === false) throw new Error('Node adoption check failed')
          return payload.value ?? payload
        } }).catch(() => log('Standalone Node migration could not be verified'))
    }
  }).catch((error) => {
    log('start failed ' + (error.stack || error))
    app.quit()
  })
}

app.on('activate', () => { showMainWindow() })
app.on('window-all-closed', () => {
  if (isQuitting || !tray) app.quit()
})
app.on('before-quit', () => {
  isQuitting = true
  if (appBindingWatcher) { appBindingWatcher.close(); appBindingWatcher = null }
  updates.closeAppUpdateBridge()
  void oidcAuth.close()
  supervisor.stopSync()
  if (webServer) webServer.close()
  if (tray) { tray.destroy(); tray = null }
})
