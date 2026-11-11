import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { safeDshNativeEndpoint } from '../packages/tether-ui/src/app.js'

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const { createNativeWorkbench } = require('../apps/tether-app/native-workbench.js')
const main = read('../apps/tether-app/main.js')
const preload = read('../apps/tether-app/preload.js')
const electronHost = read('../packages/tether-ui/src/hosts/electron.js')
const shared = read('../packages/tether-ui/src/app.js')
const agentsPage = read('../packages/tether-ui/src/agents-page.js')

function dshBootstrapHarness({
  descriptorUrl = 'https://g25800.hub.example.com/tether-connect?ticket=one-time-secret',
  landingUrl = 'https://g25800.hub.example.com/?tether_native=1',
  cookies = [{ name: '__Host-tether_session', httpOnly: true, secure: true, path: '/', domain: 'g25800.hub.example.com' }]
} = {}) {
  const calls = { load: [], destroy: 0, stop: 0, clearStorage: 0, clearCache: 0, bootstrap: 0, logs: [], cookieFilters: [] }
  const serviceSession = {
    cookies: { get: async (filter) => { calls.cookieFilters.push(filter); return cookies } },
    closeAllConnections: async () => {},
    setProxy: async () => {},
    clearStorageData: async () => { calls.clearStorage += 1 },
    clearCache: async () => { calls.clearCache += 1 }
  }
  const contents = new EventEmitter()
  let currentUrl = 'about:blank'
  let stopped = false
  contents.session = serviceSession
  contents.stop = () => { stopped = true; calls.stop += 1 }
  contents.getURL = () => currentUrl
  contents.loadURL = async (url) => {
    calls.load.push(url)
    const redirectEvent = { preventDefault: () => { redirectEvent.prevented = true } }
    contents.emit('will-redirect', redirectEvent, landingUrl, false, true)
    if (redirectEvent.prevented || stopped) throw new Error('navigation stopped')
    contents.emit('did-start-navigation', {}, landingUrl, false, true)
    if (stopped) throw new Error('navigation stopped')
    currentUrl = landingUrl
  }
  const workbench = createNativeWorkbench({
    controllerUrl: 'https://hub.example.com',
    loginSession: {
      fetch: async () => new Response(JSON.stringify({ available: true, url: descriptorUrl }), {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    },
    getServiceSession: () => serviceSession,
    createBootstrapContents: () => {
      calls.bootstrap += 1
      return { contents, destroy: () => { calls.destroy += 1 } }
    },
    getActorId: async () => 'actor-a',
    getLocalDeviceId: async () => 'source-a',
    getSourceRoute: async () => ({}),
    logSafe: (event, detail) => { calls.logs.push({ event, detail }) }
  })
  return { workbench, serviceSession, calls }
}

test('workbench auth status is bridged through trusted main IPC, preload, and Electron host', () => {
  assert.match(main, /handleTrusted\('tether:workbench-auth-status',\s*refreshWorkbenchAuthStatus/)
  assert.match(preload, /workbenchAuthStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('tether:workbench-auth-status'\)/)
  assert.match(electronHost, /authStatus:\s*\(\)\s*=>\s*window\.tetherApp\.workbenchAuthStatus\(\)/)
})

test('legacy Codeg bridge accepts only targetId and keeps the token URL in main-process guest preparation', () => {
  assert.match(main, /handleTrusted\('tether:workbench-open-legacy-codeg',\s*async \(_event, targetId\) => nativeWorkbench\.openLegacyCodeg\(targetId\)/)
  assert.match(preload, /workbenchOpenLegacyCodeg:\s*\(targetId\)\s*=>\s*ipcRenderer\.invoke\('tether:workbench-open-legacy-codeg', targetId\)/)
  assert.match(electronHost, /openLegacyCodeg:\s*\(targetId\)\s*=>\s*window\.tetherApp\.workbenchOpenLegacyCodeg\(targetId\)/)
  assert.match(main, /nativeWorkbench\.prepareGuest\(contents\)/)
  const attachedGuest = main.slice(main.indexOf("mainWindow.webContents.on('did-attach-webview'"), main.indexOf("mainWindow.on('closed'"))
  assert.ok(attachedGuest.indexOf("contents.on('will-navigate'") < attachedGuest.indexOf('nativeWorkbench.prepareGuest(contents)'),
    'the token URL is loaded only after navigation guards are installed')
  assert.match(agentsPage, /await host\.workbench\.openLegacyCodeg\(device\)/)
  assert.doesNotMatch(preload, /tokenUrl|legacyTokenUrl|token\.html/)
  assert.doesNotMatch(electronHost, /tokenUrl|legacyTokenUrl|token\.html/)
  assert.doesNotMatch(agentsPage, /legacyTokenUrl|token\.html\?token=/)
})

test('remote DSH surface uses a targetId-only native ticket exchange and blocks renderer hub route', () => {
  const nativeWorkbenchSource = read('../apps/tether-app/native-workbench.js')
  assert.match(main, /tether:workbench-open-dsh-surface'[^\n]*nativeWorkbench\.openDshSurface\(targetId\)/)
  assert.match(preload, /workbenchOpenDshSurface:\s*\(targetId\)\s*=>\s*ipcRenderer\.invoke\('tether:workbench-open-dsh-surface', targetId\)/)
  assert.match(electronHost, /openDshSurface:\s*\(targetId\)\s*=>\s*window\.tetherApp\.workbenchOpenDshSurface\(targetId\)/)
  assert.match(nativeWorkbenchSource, /contents\.loadURL\(ticketUrl\.toString\(\)\)/)
  assert.doesNotMatch(nativeWorkbenchSource, /serviceSession\.fetch\(ticketUrl/)
  assert.match(nativeWorkbenchSource, /cookie\.name\.startsWith\('__Host-tether_'\)/)
  assert.match(main, /decodeURIComponent\(decodedPath\)[\s\S]*?DSH surface route requires a separate trusted flow/)
  assert.match(shared, /data\.nativeService/)
  assert.match(shared, /native-document-error/)
  assert.match(shared, /document\.body\.children\.length > 0/)
  assert.match(shared, /safeDshNativeEndpoint\(guest\.getURL\(\)\)/)
  const attachedGuest = main.slice(main.indexOf("mainWindow.webContents.on('did-attach-webview'"), main.indexOf("mainWindow.on('closed'"))
  assert.ok(attachedGuest.indexOf('nativeWorkbench.guestPolicy(contents)') < attachedGuest.indexOf("contents.on('will-navigate'"))
  assert.match(attachedGuest, /createExactEndpointNavigationGuard\(workbenchPolicy\.endpoint, contents\.getURL\(\)\)/)
})

test('renderer accepts only the exact token-free native DSH endpoint', () => {
  assert.equal(safeDshNativeEndpoint('https://g25800.hub.example.com/?tether_native=1'),
    'https://g25800.hub.example.com/?tether_native=1')
  assert.equal(safeDshNativeEndpoint('https://g25800.hub.example.com:8443/?tether_native=1'), '')
  assert.equal(safeDshNativeEndpoint('https://g25800.hub.example.com/?tether_native=1&extra=1'), '')
  assert.equal(safeDshNativeEndpoint('https://g25800.hub.example.com/wrong?tether_native=1'), '')
  assert.equal(safeDshNativeEndpoint('https://g25800.hub.example.com/?tether_native=1#fragment'), '')
})

test('hidden bootstrap navigation receives the ticket but public result and managed guest never do', async () => {
  const { workbench, serviceSession, calls } = dshBootstrapHarness()
  const opened = await workbench.openDshSurface('target-a')
  assert.deepEqual(calls.load, ['https://g25800.hub.example.com/tether-connect?ticket=one-time-secret'])
  assert.equal(opened.endpoint, 'https://g25800.hub.example.com/?tether_native=1')
  assert.equal(JSON.stringify(opened).includes('ticket'), false)
  assert.equal(JSON.stringify(opened).includes('one-time-secret'), false)
  assert.equal(calls.destroy, 1)
  assert.deepEqual(calls.logs, [])
  assert.deepEqual(calls.cookieFilters, [{}])
  assert.equal(workbench.allowGuest(opened.partition, opened.endpoint), true)
  assert.equal(workbench.allowGuest(opened.partition, 'https://g25800.hub.example.com/'), false)
  let loadCalls = 0
  const attachedGuest = {
    session: serviceSession,
    getURL: () => '',
    loadURL: async () => { loadCalls += 1 }
  }
  const policy = workbench.guestPolicy(attachedGuest)
  assert.deepEqual(policy, { managed: true, serviceId: 'dsh-native', endpoint: opened.endpoint })
  assert.equal(JSON.stringify(policy).includes('ticket'), false)
  assert.equal(JSON.stringify(policy).includes('one-time-secret'), false)
  assert.deepEqual(workbench.guestPolicy({ session: {}, getURL: () => '' }), { managed: false })
  const result = await workbench.prepareGuest(attachedGuest)
  assert.deepEqual(result, { managed: true, prepared: false })
  assert.equal(loadCalls, 0)
  await workbench.close('target-a', 'dsh-native', opened.grantId)
  assert.throws(() => workbench.guestPolicy(attachedGuest), /guest 与活动授权不匹配/)
})

test('hidden DSH bootstrap destroys and clears its partition on unsafe landing or missing cookie', async () => {
  const scenarios = [
    { name: 'cross origin', options: { landingUrl: 'https://attacker.example/?tether_native=1' }, stopped: true, stage: 'navigate-bootstrap' },
    { name: 'wrong landing', options: { landingUrl: 'https://g25800.hub.example.com/wrong?tether_native=1' }, stage: 'validate-endpoint' },
    { name: 'missing cookie', options: { cookies: [] }, stage: 'validate-cookie' },
    { name: 'cookie for another domain', options: { cookies: [{ name: '__Host-tether_session', httpOnly: true, secure: true, path: '/', domain: 'other.example.com' }] }, stage: 'validate-cookie' }
  ]
  for (const scenario of scenarios) {
    const { workbench, calls } = dshBootstrapHarness(scenario.options)
    await assert.rejects(workbench.openDshSurface('target-a'), (error) => {
      assert.equal(error.message, 'DSH gateway 票据兑换失败。', scenario.name)
      assert.equal(error.message.includes('ticket'), false, scenario.name)
      return true
    })
    assert.equal(calls.destroy, 1, scenario.name)
    assert.equal(calls.clearStorage, 1, scenario.name)
    assert.equal(calls.clearCache, 1, scenario.name)
    assert.deepEqual(calls.logs, [{
      event: 'dsh-bootstrap-failed-' + scenario.stage,
      detail: { targetId: 'target-a', serviceId: 'dsh-native' }
    }], scenario.name)
    assert.doesNotMatch(JSON.stringify(calls.logs), /one-time-secret|g25800|attacker/i, scenario.name)
    if (scenario.stopped) assert.ok(calls.stop >= 1, scenario.name)
  }
})

test('main owns the hidden bootstrap window with locked-down web preferences', () => {
  const bootstrapFactory = main.slice(main.indexOf('createBootstrapContents: (partition)'), main.indexOf('getLocalDeviceId:', main.indexOf('createBootstrapContents: (partition)')))
  assert.match(bootstrapFactory, /new BrowserWindow\(\{\s*show: false,/)
  assert.match(bootstrapFactory, /webPreferences:\s*\{\s*partition,\s*nodeIntegration: false,\s*contextIsolation: true,\s*sandbox: true,\s*webSecurity: true/)
  assert.match(bootstrapFactory, /webContents\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
})

test('dsh-native rejects a gateway URL on a non-default public HTTPS port', async () => {
  let bootstrapCalls = 0
  const workbench = createNativeWorkbench({
    controllerUrl: 'https://hub.example.com',
    loginSession: {
      fetch: async () => new Response(JSON.stringify({
        available: true,
        url: 'https://g25800.hub.example.com:8443/tether-connect?ticket=one-time-secret'
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    getServiceSession: () => ({ cookies: { get: async () => [] } }),
    createBootstrapContents: () => { bootstrapCalls += 1; throw new Error('must not create bootstrap') },
    getActorId: async () => 'actor-a',
    getLocalDeviceId: async () => 'source-a',
    getSourceRoute: async () => ({})
  })
  await assert.rejects(workbench.openDshSurface('target-a'), /Hub 返回了无效的 DSH gateway。/)
  assert.equal(bootstrapCalls, 0)
})

test('desktop login opens Casdoor authorization externally using fixed public-client PKCE settings', () => {
  assert.match(main, /redirectUri:\s*'http:\/\/127\.0\.0\.1:18893\/oauth\/callback'/)
  assert.match(main, /clientId:\s*'tether-desktop'/)
  assert.match(main, /openExternal:\s*candidateMode\s*&&\s*String\(env\.TETHER_OIDC_BOOTSTRAP_CREDENTIALS_FILE/)
  assert.match(main, /:\s*\(url\)\s*=>\s*shell\.openExternal\(url\)/)
  assert.match(main, /const login = await oidcAuth\.beginLogin\(\)/)
  assert.doesNotMatch(main, /\/oauth2\/start|workbenchLoginWindow|title:\s*'Tether 登录'/)
})

test('login failures preserve the useful main-process error in IPC and renderer state', () => {
  assert.match(main, /catch \(error\) \{\s*return \{ ok: false, error: String\(error && error\.message \|\| error \|\| '桌面登录未完成'\) \}/)
  assert.match(main, /\{ state: 'closed', error: safeLoginError\(error\) \}/)
  assert.match(shared, /if \(result\.error\) setStateRefreshError\(result\.error\)/)
})

test('explicit OIDC logout persists disabling legacy bearer and cookie fallback', () => {
  assert.match(main, /function setDesktopAuthMode\(mode\) \{\s*const config = readHubConfig\(\)\s*if \(config\.desktopAuthMode === mode\) return\s*writeHubConfig\(\{ \.\.\.config, desktopAuthMode: mode \}\)/)
  assert.match(main, /setDesktopAuthMode\('oidc'\)\s*let actorId = workbenchActorId/)
  assert.match(main, /const allowLegacyFallback = readHubConfig\(\)\.desktopAuthMode !== 'oidc'/)
  assert.match(main, /if \(allowLegacyFallback && legacyUserToken\)/)
  assert.match(main, /if \(allowLegacyFallback && workbenchLoginSession\)/)
  assert.match(main, /login\.completion\.then\(async \(\) => \{\s*setDesktopAuthMode\('oidc'\)/)
})

test('Controller cookie fallback is rejected after explicit OIDC logout', () => {
  const controllerFetch = main.slice(main.indexOf('async function controllerFetch'), main.indexOf('async function validateControllerSession'))
  assert.match(controllerFetch, /if \(readHubConfig\(\)\.desktopAuthMode === 'oidc'\) throw new Error\('Controller login required'\)/)
  assert.ok(controllerFetch.indexOf("desktopAuthMode === 'oidc'") < controllerFetch.indexOf("controllerAuthMode === 'legacy-bearer'"))
  assert.ok(controllerFetch.indexOf("desktopAuthMode === 'oidc'") < controllerFetch.indexOf('workbenchLoginSession.fetch('))
})

test('OIDC Controller fetch delegates Bearer injection to oidcAuth while legacy bearer stays unchanged', () => {
  const controllerFetch = main.slice(main.indexOf('async function controllerFetch'), main.indexOf('async function validateControllerSession'))
  const oidcBranch = controllerFetch.slice(controllerFetch.indexOf("if (controllerAuthMode === 'oidc'"), controllerFetch.indexOf('if (readHubConfig()'))
  const legacyBranch = controllerFetch.slice(controllerFetch.indexOf("if (controllerAuthMode === 'legacy-bearer'"), controllerFetch.indexOf('if (!workbenchLoginSession)'))
  assert.doesNotMatch(oidcBranch, /headers\.set\(['"]Authorization['"]/i)
  assert.match(oidcBranch, /oidcAuth\.fetch\(target\.toString\(\), \{ \.\.\.init, headers: Object\.fromEntries\(headers\.entries\(\)\), redirect: 'error' \}\)/)
  assert.doesNotMatch(oidcBranch, /credentials:\s*'omit'/)
  assert.match(legacyBranch, /fetch\(target\.toString\(\), \{ \.\.\.init, headers, credentials: 'omit', redirect: 'error' \}\)/)
  const oidcAuthSource = read('../apps/tether-app/oidc-auth.js')
  assert.match(oidcAuthSource, /function fetchWithAuth[\s\S]*?Authorization: `Bearer \$\{session\.id_token\}`/)
  const nativeWorkbench = main.slice(main.indexOf('nativeWorkbench = createNativeWorkbench'), main.indexOf('const { createWebServer }'))
  const hubRequest = main.slice(main.indexOf("handleTrusted('tether:hub-request'"), main.indexOf("handleTrusted('tether:app-info'"))
  assert.match(nativeWorkbench, /getActorId:\s*async \(\) => \{\s*const response = await controllerFetch\(new URL\('\/api\/auth\/me', controller\)\.toString\(\), \{ redirect: 'error' \}\)/)
  assert.doesNotMatch(nativeWorkbench, /getActorId:[\s\S]*?workbenchLoginSession\.fetch/)
  assert.match(hubRequest, /const response = await controllerFetch\(target\.toString\(\), \{\s*method,\s*headers:/)
  assert.doesNotMatch(hubRequest, /workbenchLoginSession\.fetch/)
})

test('legacy cookie auth probe treats redirects as unauthenticated without exposing fetch errors', () => {
  const legacyCookieProbe = main.slice(main.indexOf('if (allowLegacyFallback && workbenchLoginSession)'), main.indexOf("controllerAuthMode = ''", main.indexOf('if (allowLegacyFallback && workbenchLoginSession)')))
  const legacyBinding = main.slice(main.indexOf("handleTrusted('tether:workbench-bind-legacy'"), main.indexOf("handleTrusted('tether:workbench-register-account'"))
  const validateControllerSession = main.slice(main.indexOf('async function validateControllerSession'), main.indexOf('async function refreshWorkbenchAuthStatus'))
  assert.match(legacyCookieProbe, /credentials: 'include', redirect: 'manual'/)
  assert.match(legacyBinding, /workbenchLoginSession\.fetch\(new URL\('\/api\/auth\/login'/)
  assert.match(legacyBinding, /workbenchLoginSession\.fetch\(new URL\('\/api\/auth\/identity\/bind'/)
  assert.match(validateControllerSession, /if \(!response\.ok\) \{[\s\S]*?return \{ authenticated: false, identityUnbound:/)
  assert.doesNotMatch(validateControllerSession, /throw new Error|Attempted to redirect/i)
  assert.match(shared, /请使用 Casdoor 登录以读取 Hub 设备/)
})

test('legacy cookie probe rejection returns unauthenticated without an error payload', () => {
  const start = main.indexOf('if (allowLegacyFallback && workbenchLoginSession)')
  const legacyCookieProbe = main.slice(start, main.indexOf("\n  controllerAuthMode = ''", start))
  assert.match(legacyCookieProbe, /try \{[\s\S]*?workbenchLoginSession\.fetch[\s\S]*?\} catch \(_\) \{\s*controllerAuthMode = ''\s*workbenchBindingPending = false\s*return \{ authenticated: false, identityUnbound: false \}/)
  const rejection = legacyCookieProbe.slice(legacyCookieProbe.indexOf('} catch (_)'))
  assert.doesNotMatch(rejection, /error\s*:/)
})

test('OIDC tokens remain in the main process and auth status only returns identity state', () => {
  assert.doesNotMatch(preload, /authorizationHeader|accessToken|oidcAuth|oidc-session/i)
  assert.doesNotMatch(electronHost, /authorizationHeader|accessToken|oidcAuth/i)
  assert.match(main, /return \{ \.\.\.result, authenticated: result\.authenticated, source: 'oidc' \}/)
  assert.doesNotMatch(main, /webContents\.send\([^\n]*token|webContents\.send\([^\n]*accessToken/i)
})

test('renderer confirms desktop auth before loading Hub state or creating native surfaces', () => {
  const loadState = shared.slice(shared.indexOf('const loadState = React.useCallback'), shared.indexOf("React.useEffect(() => {\n        if (!desktopAuthRequired", shared.indexOf('const loadState = React.useCallback')))
  assert.match(loadState, /!workbenchAuthReadyRef\.current\) return/)
  assert.match(loadState, /api\('\/api\/state'\)/)
  assert.match(shared, /host\.workbench\.authStatus\(\)\.then/)
  assert.match(shared, /if \(!authReady\).*?fetchSurfaceDescriptor/s)
  assert.match(shared, /if \(!authReady \|\| !deviceId \|\| !online \|\| !visible/)
  assert.match(shared, /if \(authReady && deviceId && !ids\.includes\(deviceId\)\)/)
  assert.match(shared, /if \(authReady && keep\)/)
  assert.match(shared, /visible: view === 'chat', authReady: workbenchAuthReady/)
})
