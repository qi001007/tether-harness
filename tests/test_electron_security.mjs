import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

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
