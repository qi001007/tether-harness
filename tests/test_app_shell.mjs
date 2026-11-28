import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

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

test('APP binding keeps its startup version while enrollment adds a Node credential', () => {
  assert.match(main, /let appStartedVersion = ''[\s\S]*?version\.json/)
  assert.match(main, /registerAppInstallation\(\{ env, dataDir, appRoot: repoRoot, startedAt: appStartedAt, startedVersion: appStartedVersion \}\)/)
  assert.match(main, /fs\.watch\(dataDir,[\s\S]*?String\(filename \|\| ''\) !== 'device-token\.json'/)
  assert.match(main, /appBindingWatcher\.close\(\)/)
})

function shortcutHost({ execPath, entries, extraFiles = [], realpath = {}, packaged = true }) {
  const desktop = 'C:/Desktop'
  const programs = 'C:/Programs'
  const link = (zone, name) => path.win32.join(zone === 'desktop' ? desktop : programs, name)
  const links = new Map()
  const files = new Set(extraFiles)
  for (const [zone, name, value] of entries) {
    const full = link(zone, name)
    links.set(full, value)
    files.add(full)
  }
  const removed = []
  const written = []
  const context = {
    app: { getPath: zone => ({ desktop, programs })[zone] },
    env: {},
    fs: {
      existsSync: value => files.has(value),
      rmSync: value => { removed.push(value); files.delete(value) },
      realpathSync: value => realpath[value] || value
    },
    path: path.win32,
    process: { platform: 'win32', execPath },
    packaged,
    APP_USER_MODEL_ID: 'com.tether.app',
    log: () => {},
    safeRendererPath: value => String(value),
    safeRendererMessage: value => String(value),
    shell: {
      readShortcutLink: full => {
        if (!links.has(full)) throw new Error('no such link')
        return links.get(full)
      },
      writeShortcutLink: (full, mode, options) => { written.push([full, mode, options]); return true }
    }
  }
  const fn = main.match(/^function ensureAppShortcuts\(\) \{[\s\S]*?^\}/m)[0]
  vm.runInNewContext(fn + '\nensureAppShortcuts()', context)
  return { link, removed, written, files }
}

test('startup keeps exactly one desktop entry that matches the installer identity', () => {
  assert.match(main, /const canonicalName = 'Tether\.lnk'/)
  assert.match(main, /if \(!packaged \|\| process\.platform !== 'win32'/)
  assert.match(main, /const target = resolveReal\(process\.execPath\)/)
  assert.match(main, /cwd: installDir,/)
  assert.match(main, /appUserModelId: APP_USER_MODEL_ID/)
  assert.doesNotMatch(main, /args: '"' \+ appPath/)
  assert.doesNotMatch(main, /icon: fs\.existsSync\(iconPath\) \? iconPath : process\.execPath/)
})

test('one product name is used by the window, the shell entry and the tray', () => {
  assert.match(main, /title: 'Tether',/)
  assert.match(main, /mainWindow\.on\('page-title-updated', \(event\) => \{ event\.preventDefault\(\) \}\)/,
    '网页标题不得顶掉桌面壳名，否则任务栏与入口不同名')
  assert.match(main, /description: 'Tether',/)
  assert.match(main, /tray\.setToolTip\('Tether'\)/)
  assert.match(fs.readFileSync(path.join(root, 'desktop/packaging/electron-builder.yml'), 'utf8'),
    /^productName: Tether$/m)
})

test('startup heals a machine that carries both entry names', () => {
  const w = (...parts) => path.win32.join(...parts)
  const realRoot = w('E:', 'Tether')
  const realExe = w(realRoot, 'Tether.exe')
  const realIcon = w(realRoot, 'resources', 'tether-runtime', 'assets', 'tether-app-s.ico')
  const junctionRoot = w('D:', 'Apps', 'Tether')
  const junctionExe = w(junctionRoot, 'Tether.exe')
  const junctionAsar = w(junctionRoot, 'resources', 'app.asar')
  const legacy = { target: junctionExe, cwd: junctionAsar }
  const host = shortcutHost({
    execPath: junctionExe,
    realpath: { [junctionExe]: realExe },
    extraFiles: [realExe, realIcon, junctionExe, junctionAsar],
    entries: [
      ['desktop', 'Tether APP.lnk', legacy],
      ['programs', 'Tether APP.lnk', legacy],
      ['desktop', 'Tether.lnk', { target: realExe, cwd: realRoot, icon: realIcon }],
      // 开始菜单那条由 NSIS 写成 exe 自带图标，需要被修回品牌图标源。
      ['programs', 'Tether.lnk', { target: realExe, cwd: realRoot, icon: realExe }]
    ]
  })

  assert.deepEqual(host.removed.sort(), [
    host.link('desktop', 'Tether APP.lnk'),
    host.link('programs', 'Tether APP.lnk')
  ], '两个 legacy 名都要消失，否则用户看到的还是两个入口')
  assert.deepEqual(host.written.map(([full]) => full), [host.link('programs', 'Tether.lnk')],
    '字段已经正确的桌面入口不该被重写')
  const [, mode, options] = host.written[0]
  assert.equal(mode, 'replace')
  assert.equal(options.target, realExe, '经 D: 联接启动也不能把联接路径写进用户入口')
  assert.equal(options.cwd, realRoot)
  assert.equal(options.icon, realIcon)
  assert.equal(options.appUserModelId, 'com.tether.app')
  assert.equal(options.args, undefined, 'NSIS 的 Tether.exe 自己会定位 asar，不该再传参数')
  assert.deepEqual([...host.files].filter(full => full.toLowerCase().endsWith('.lnk')).sort(), [
    host.link('desktop', 'Tether.lnk'),
    host.link('programs', 'Tether.lnk')
  ].sort(), '每个区最后只剩一个 Tether 入口名')
})

test('startup leaves a legacy entry that launches another live install', () => {
  const w = (...parts) => path.win32.join(...parts)
  const realRoot = w('E:', 'Tether')
  const realExe = w(realRoot, 'Tether.exe')
  const realIcon = w(realRoot, 'resources', 'tether-runtime', 'assets', 'tether-app-s.ico')
  const otherRoot = w('C:', 'Portable', 'Tether')
  const otherExe = w(otherRoot, 'Tether.exe')
  const host = shortcutHost({
    execPath: realExe,
    extraFiles: [realExe, realIcon, otherExe],
    entries: [
      ['desktop', 'Tether APP.lnk', { target: otherExe, cwd: otherRoot }],
      ['desktop', 'Tether.lnk', { target: realExe, cwd: realRoot, icon: realIcon }],
      ['programs', 'Tether.lnk', { target: realExe, cwd: realRoot, icon: realIcon }]
    ]
  })

  assert.deepEqual(host.removed, [], '另一份安装的真实入口不能被本机自愈删掉')
  assert.deepEqual(host.written, [])
})

test('a source-tree run never writes user shell entries', () => {
  const w = (...parts) => path.win32.join(...parts)
  const realExe = w('E:', 'Tether', 'Tether.exe')
  const host = shortcutHost({
    execPath: realExe,
    packaged: false,
    extraFiles: [realExe, w('E:', 'Tether', 'resources', 'tether-runtime', 'assets', 'tether-app-s.ico')],
    entries: [['desktop', 'Tether APP.lnk', { target: realExe, cwd: w('E:', 'Tether') }]]
  })

  assert.deepEqual(host.removed, [], '开发态不改用户桌面')
  assert.deepEqual(host.written, [])
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
  assert.match(main, /app\.on\('second-instance', \(_event, commandLine\) => \{/)
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
  assert.match(shared, /dshSurfaceMissing/)
  assert.match(shared, /runDsh\('dsh_restart'\)/)
  assert.match(shared, /'重启'/)
  assert.match(shared, /dshRestartPidRef/)
})

test('a missing DSH plugin is repaired automatically without user file work', () => {
  assert.match(shared, /dsh_install_plugin/)
  assert.match(shared, /dshAutoRepairRef/)
  assert.match(shared, /'修复'/)
  assert.match(shared, /正在修复工作区…/)
  assert.match(shared, /onSurfaceStyleBroken/)
  assert.match(shared, /DSH 样式异常/)
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
