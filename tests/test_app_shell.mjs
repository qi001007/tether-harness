import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(root, 'apps/tether-app/main.js'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'apps/tether-app/preload.js'), 'utf8')
const host = fs.readFileSync(path.join(root, 'packages/tether-ui/src/hosts/electron.js'), 'utf8')
const supervisor = fs.readFileSync(path.join(root, 'apps/tether-app/supervisor.js'), 'utf8')
const shared = fs.readFileSync(path.join(root, 'packages/tether-ui/src/app.js'), 'utf8')

test('the APP runs as a frameless DSH-like shell with custom window controls', () => {
  assert.match(main, /frame: false/)
  assert.match(main, /thickFrame: true/)
  assert.match(main, /handleTrusted\('tether:window-control'/)
  assert.match(preload, /windowControl: \(action\) => ipcRenderer\.invoke\('tether:window-control'/)
  assert.match(preload, /onWindowState:/)
  assert.match(host, /windowControls: \{/)
  assert.match(shared, /WebkitAppRegion: 'drag'/)
  assert.match(shared, /tether-window-control/)
  assert.match(shared, /windowControl\('minimize'/)
  assert.match(shared, /windowControl\('toggle-maximize'/)
  assert.match(shared, /windowControl\('close'/)
})

test('process cleanup never allocates a visible console', () => {
  assert.match(supervisor, /spawnSync\('taskkill',[\s\S]*?windowsHide: true/)
})

test('startup repairs desktop and start-menu shortcuts to launch Electron directly', () => {
  assert.match(main, /ensureAppShortcuts\(\)/)
  assert.match(main, /shell\.writeShortcutLink\(link, 'update', options\)/)
  assert.match(main, /target: process\.execPath/)
  assert.match(main, /getPath\('desktop'\)/)
  assert.match(main, /getPath\('programs'\)/)
  assert.match(main, /Tether APP\.lnk/)
})

test('closing the window hides it to the tray until an explicit quit', () => {
  assert.match(main, /new Tray\(icon\)/)
  assert.match(main, /tray\.setContextMenu/)
  assert.match(main, /label: '打开 Tether'/)
  assert.match(main, /label: '退出 Tether'/)
  assert.match(main, /mainWindow\.on\('close', \(event\) => \{/)
  assert.match(main, /event\.preventDefault\(\)/)
  assert.match(main, /mainWindow\.hide\(\)/)
  assert.match(main, /if \(isQuitting \|\| !tray\) app\.quit\(\)/)
  assert.match(main, /app\.on\('second-instance', \(\) => \{/)
})

test('one icon source ships for the window, shortcut and tray', () => {
  const ico = fs.statSync(path.join(root, 'assets/tether-app-s.ico'))
  const png = fs.statSync(path.join(root, 'assets/tether-app-s.png'))
  assert.ok(ico.size > 1000, 'multi-size ico exists')
  assert.ok(png.size > 1000, 'png source exists')
  assert.match(main, /assets', 'tether-app-s\.ico'/)
  assert.match(fs.readFileSync(path.join(root, 'desktop/install-app.ps1'), 'utf8'), /assets\\tether-app-s\.ico/)
  assert.match(shared, /const TetherMark =/)
})

test('a missing DSH surface offers an explicit restart instead of a blank frame', () => {
  assert.match(shared, /Tether 插件未加载或 surface 描述符缺失/)
  assert.match(shared, /runDsh\('dsh_restart'\)/)
  assert.match(shared, /'重启 DSH'/)
  assert.match(shared, /dshRestartPidRef/)
})

test('a missing DSH plugin is repaired automatically without user file work', () => {
  assert.match(shared, /dsh_install_plugin/)
  assert.match(shared, /dshAutoRepairRef/)
  assert.match(shared, /安装\/修复[^\n']*插件/)
  assert.match(shared, /正在安装\/修复 Tether 插件/)
  assert.match(shared, /onSurfaceStyleBroken/)
  assert.match(shared, /DSH 界面样式与 Tether 版本不匹配/)
})

test('Linux DSH web is embedded in the APP, never opened in an external window', () => {
  assert.match(main, /webviewTag: true/)
  assert.match(main, /will-attach-webview/)
  assert.match(main, /dshViewUrlAllowed/)
  assert.match(main, /did-attach-webview/)
  assert.match(shared, /h\('webview'/)
  assert.match(shared, /打开工作区/)
  assert.doesNotMatch(shared, /window\.open\(url, '_blank'/)
})
