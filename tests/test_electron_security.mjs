import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import dshWebNavigation from '../apps/tether-app/dsh-web-navigation.js'

const main = fs.readFileSync(new URL('../apps/tether-app/main.js', import.meta.url), 'utf8')
const shared = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')

test('the main window blocks navigation away from the local UI origin', () => {
  assert.match(main, /webContents\.on\('will-navigate'/)
  assert.match(main, /parsed\.origin === uiOrigin/)
  assert.match(main, /event\.preventDefault\(\)/)
})

test('window.open is never given an Electron window and only opens web URLs externally', () => {
  assert.match(main, /setWindowOpenHandler/)
  assert.match(main, /return \{ action: 'deny' \}/)
  assert.match(main, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:'/)
})

test('a DSH guest attached at about:blank may establish one allowed LAN origin', () => {
  assert.match(main, /createDshWebNavigationGuard\(contents\.getURL\(\)\)/)
  assert.match(main, /contents\.on\('did-start-navigation'/)
  assert.match(main, /contents\.on\('will-redirect'/)
  assert.match(main, /navigation\.navigate\(target\)/)
  assert.match(main, /navigation\.redirect\(target, isMainFrame\)/)
})

test('dsh-native guest policy is installed before handlers and uses its exact endpoint guard', () => {
  const attached = main.slice(main.indexOf("mainWindow.webContents.on('did-attach-webview'"), main.indexOf("mainWindow.on('closed'"))
  assert.ok(attached.indexOf('nativeWorkbench.guestPolicy(contents)') < attached.indexOf("contents.on('will-navigate'"))
  assert.match(attached, /workbenchPolicy\.serviceId === 'dsh-native'[\s\S]*?createExactEndpointNavigationGuard\(workbenchPolicy\.endpoint, contents\.getURL\(\)\)/)
})

test('dsh-native exact guard permits only its authorized top-level endpoint', () => {
  const endpoint = 'https://g25800.hub.example.com/?tether_native=1'
  const rejected = [
    'https://g25800.hub.example.com/',
    endpoint + '&extra=1',
    endpoint + '#fragment',
    'https://attacker.example/?tether_native=1'
  ]
  for (const initial of ['', 'about:blank']) {
    const guard = dshWebNavigation.createExactEndpointNavigationGuard(endpoint, initial)
    assert.equal(guard.navigate(initial), true)
    for (const target of rejected) {
      assert.equal(dshWebNavigation.createExactEndpointNavigationGuard(endpoint, initial).navigate(target), false)
      assert.equal(dshWebNavigation.createExactEndpointNavigationGuard(endpoint, initial).didStart(target, true), false)
      assert.equal(dshWebNavigation.createExactEndpointNavigationGuard(endpoint, initial).redirect(target, true), false)
    }
    assert.equal(guard.didStart(endpoint, true), true)
    assert.equal(guard.redirect(endpoint, true), true)
    assert.equal(guard.didStart('https://attacker.example/frame', false), true)
    assert.equal(guard.redirect('https://attacker.example/frame', false), true)
  }
})

test('DSH guest binds the first approved main origin and allows same-origin 303 redirects only', () => {
  const guard = dshWebNavigation.createDshWebNavigationGuard('about:blank')
  const approved = 'http://192.168.1.50:3080/?token=guest-token'
  assert.equal(guard.navigate(approved), true)
  assert.equal(guard.origin, 'http://192.168.1.50:3080')
  assert.equal(guard.redirect('http://192.168.1.50:3080/login', true), true)
  assert.equal(guard.navigate('http://192.168.1.50:3080/workspaces', true), true)
  assert.equal(guard.redirect('http://attacker.example/login', true), false)
  assert.equal(guard.navigate('http://attacker.example/login'), false)
})

test('a DSH subframe cannot claim the first guest origin', () => {
  const guard = dshWebNavigation.createDshWebNavigationGuard('about:blank')
  assert.equal(guard.didStart('http://10.0.0.8:3080/iframe', false), true)
  assert.equal(guard.origin, '')
  assert.equal(guard.didStart('http://10.0.0.8:3080/', true), true)
  assert.equal(guard.origin, 'http://10.0.0.8:3080')
})

test('every tether IPC verifies the main frame and its local origin', () => {
  assert.match(main, /event\.senderFrame === event\.sender\.mainFrame/)
  assert.match(main, /new URL\(event\.senderFrame\.url\)\.origin === uiOrigin/)
  assert.doesNotMatch(main, /ipcMain\.handle\('tether:/)
  assert.match(main, /handleTrusted\('tether:services'/)
  assert.match(main, /handleTrusted\('tether:open-external'/)
})

test('the native surface iframe is sandboxed without top navigation', () => {
  assert.match(shared, /sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals'/)
  assert.doesNotMatch(shared, /sandbox: '[^']*allow-top-navigation/)
})
