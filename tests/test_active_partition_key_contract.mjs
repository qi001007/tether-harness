import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const maintenancePath = path.join(root, 'apps/tether-app/data-maintenance.js')
const { createNativeWorkbench } = require('../apps/tether-app/native-workbench.js')
const { partitionBudgetReport } = require('../apps/tether-app/data-maintenance.js')

function activeWorkbenchHarness() {
  const cookies = [{
    name: '__Host-tether_session',
    httpOnly: true,
    secure: true,
    path: '/',
    domain: 'g25800.hub.example.com'
  }]
  const serviceSession = {
    cookies: { get: async () => cookies },
    closeAllConnections: async () => {},
    setProxy: async () => {},
    clearStorageData: async () => {},
    clearCache: async () => {}
  }
  const contents = new EventEmitter()
  let currentUrl = 'about:blank'
  contents.session = serviceSession
  contents.stop = () => {}
  contents.getURL = () => currentUrl
  contents.loadURL = async () => {
    currentUrl = 'https://g25800.hub.example.com/?tether_native=1'
  }
  const workbench = createNativeWorkbench({
    controllerUrl: 'https://hub.example.com',
    loginSession: {
      fetch: async () => new Response(JSON.stringify({
        available: true,
        url: 'https://g25800.hub.example.com/tether-connect?ticket=one-time-secret'
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    getServiceSession: () => serviceSession,
    createBootstrapContents: () => ({ contents, destroy: () => {} }),
    getActorId: async () => 'actor-a',
    getLocalDeviceId: async () => 'source-a',
    getSourceRoute: async () => ({}),
    logSafe: () => {}
  })
  return workbench
}

function loadBrokenMaintenance() {
  const source = fs.readFileSync(maintenancePath, 'utf8')
  const normalizedMarker = /]\s*\.map\(\s*partitionDirectoryName\s*\)/
  assert.ok(normalizedMarker.test(source), '找不到目录名归一化接线，反例 fixture 已失效')
  const broken = source.replace(normalizedMarker, ']')
  const exports = {}
  const module = { exports }
  const sandbox = vm.createContext({
    console,
    Buffer,
    require,
    module,
    exports
  })
  vm.runInContext(broken, sandbox)
  assert.notEqual(module.exports.partitionBudgetReport, undefined)
  return module.exports
}

test('activeServicePartitions raw persist output protects the mounted partition', async () => {
  const workbench = activeWorkbenchHarness()
  const opened = await workbench.openDshSurface('target-a')
  const rawActivePartitions = workbench.activeServicePartitions()
  assert.match(rawActivePartitions[0], /^persist:tether-wb-[a-f0-9]{40}$/)

  const mountedDirectory = opened.partition.replace(/^persist:/, '')
  const otherDirectory = 'tether-wb-' + 'b'.repeat(40)
  const now = Date.now()
  const entries = [
    { name: mountedDirectory, mtimeMs: now - 2000, hasLoginState: false },
    { name: otherDirectory, mtimeMs: now - 1000, hasLoginState: false }
  ]

  const report = partitionBudgetReport(entries, {
    now,
    maxCount: 1,
    protectedPartitions: rawActivePartitions,
    loginEntries: {}
  })
  assert.deepEqual(report.protected, [mountedDirectory],
    '活跃分区必须由 native-workbench 的真实 persist: 返回值命中')
  assert.deepEqual(report.removable, [],
    '已挂载且尚无 Cookie 的分区不得因 maxCount 被删除')
})

test('the raw active fixture is red when directory-name normalization is removed', async () => {
  const workbench = activeWorkbenchHarness()
  const opened = await workbench.openDshSurface('target-a')
  const rawActivePartitions = workbench.activeServicePartitions()
  const mountedDirectory = opened.partition.replace(/^persist:/, '')
  const otherDirectory = 'tether-wb-' + 'c'.repeat(40)
  const now = Date.now()
  const entries = [
    { name: mountedDirectory, mtimeMs: now - 2000, hasLoginState: false },
    { name: otherDirectory, mtimeMs: now - 1000, hasLoginState: false }
  ]
  const broken = loadBrokenMaintenance()
  const report = broken.partitionBudgetReport(entries, {
    now,
    maxCount: 1,
    protectedPartitions: rawActivePartitions,
    loginEntries: {}
  })
  assert.deepEqual(report.protected, [])
  assert.equal(report.removable.includes(mountedDirectory), true,
    '拿掉归一化后，真实 persist: 活跃键必须让最旧分区重新进入 removable')
})

test('prefixed unknown-account keys stay protected and fail when normalization is removed', () => {
  const now = Date.now()
  const inUse = ['tether-wb-INUSE_A', 'tether-wb-INUSE_B']
  const entries = inUse.map((name, index) => ({
    name,
    mtimeMs: now - (9 - index) * 1000,
    hasLoginState: false
  })).concat(Array.from({ length: 7 }, (_, index) => ({
    name: `tether-wb-anonymous-${index}`,
    mtimeMs: now + index,
    hasLoginState: false
  })))
  const productionProtectedPartitions = inUse.map((name) => 'persist:' + name)

  const report = partitionBudgetReport(entries, {
    now,
    maxCount: 7,
    protectedPartitions: productionProtectedPartitions,
    loginEntries: {}
  })
  assert.deepEqual([...report.protected].sort(), inUse,
    'unknownAccountSource 与 activeServicePartitions 共用同一生产保护集形状')
  assert.deepEqual(report.removable.filter((name) => inUse.includes(name)), [],
    '用户刚点开、尚未写入 Cookie 的在用分区不得被回收')

  const broken = loadBrokenMaintenance()
  const brokenReport = broken.partitionBudgetReport(entries, {
    now,
    maxCount: 7,
    protectedPartitions: productionProtectedPartitions,
    loginEntries: {}
  })
  assert.deepEqual(brokenReport.protected, [])
  assert.equal(brokenReport.removable.includes('tether-wb-INUSE_A'), true,
    '拿掉 persist: 归一化后，这条生产形状 fixture 必须变红')
})
