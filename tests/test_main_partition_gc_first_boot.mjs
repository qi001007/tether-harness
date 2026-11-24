import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainSource = fs.readFileSync(path.join(root, 'apps/tether-app/main.js'), 'utf8')
const {
  PARTITION_CACHE_SUBDIRS,
  PARTITION_MAX_AGE_MS,
  PARTITION_PREFIX,
  partitionBudgetReport,
  partitionDirectoryName,
  partitionHasCredentialEvidence
} = require('../apps/tether-app/data-maintenance.js')

const HOURS = 60 * 60 * 1000
const DAYS = 24 * HOURS

function extractFunction(name) {
  const marker = `function ${name}(`
  let start = mainSource.indexOf(marker)
  assert.notEqual(start, -1, `main.js 缺少 ${name}`)
  const asyncPrefix = /\basync\s+$/.exec(mainSource.slice(Math.max(0, start - 12), start))
  if (asyncPrefix) start -= asyncPrefix[0].length
  let index = mainSource.indexOf('(', start)
  let depth = 0
  while (index < mainSource.length) {
    if (mainSource[index] === '(') depth++
    else if (mainSource[index] === ')') {
      depth--
      if (depth === 0) break
    }
    index++
  }
  const bodyStart = mainSource.indexOf('{', index)
  depth = 0
  for (let cursor = bodyStart; cursor < mainSource.length; cursor++) {
    if (mainSource[cursor] === '{') depth++
    else if (mainSource[cursor] === '}') {
      depth--
      if (depth === 0) return mainSource.slice(start, cursor + 1)
    }
  }
  assert.fail(`无法解析 ${name}`)
}

function instanceName(seed) {
  return 'tether-wb-' + crypto.createHash('sha1').update(seed).digest('hex')
}

function makeGcHarness({
  loginEntries = null,
  activePartitions = [],
  cookiesAvailable = false,
  failPartitions = []
} = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-main-gc-'))
  const partitionsRoot = path.join(userData, 'Partitions')
  fs.mkdirSync(partitionsRoot)
  const stateFile = path.join(userData, 'workbench-login-state.json')
  const writtenStates = []
  const usesRealRead = loginEntries !== null
  if (usesRealRead) {
    fs.writeFileSync(stateFile, JSON.stringify({ entries: loginEntries }, null, 2) + '\n')
  }
  const source = [
    ...(usesRealRead ? [extractFunction('readWorkbenchLoginState')] : []),
    extractFunction('inspectDshAuthCookiePartition'),
    extractFunction('clearWorkbenchCacheOnly'),
    extractFunction('gcWorkbenchPartitions')
  ].join('\n')
  const context = {
    app: { getPath: (name) => name === 'userData' ? userData : '' },
    fs,
    path,
    session: {
      fromPartition: (partition) => ({
        cookies: {
          get: async () => {
            if (failPartitions.includes(partition)) throw new Error('partition session unavailable')
            return cookiesAvailable ? [{ name: 'dsh-auth', value: 'secret' }] : []
          }
        }
      })
    },
    DSH_AUTH_COOKIE_PREFIX: 'dsh-auth',
    PARTITION_CACHE_SUBDIRS,
    PARTITION_PREFIX,
    partitionBudgetReport,
    partitionDirectoryName,
    partitionHasCredentialEvidence,
    workbenchLoginStateFile: stateFile,
    isTrustedWorkbenchPartition: (value) =>
      /^persist:tether-(?:wb-[a-f0-9]{40}|dsh-local)$/.test(String(value || '')),
    nativeWorkbench: { activeServicePartitions: () => activePartitions },
    ...(!usesRealRead ? { readWorkbenchLoginState: () => ({ entries: {} }) } : {}),
    writeWorkbenchLoginState: (state) => {
      writtenStates.push(JSON.parse(JSON.stringify(state)))
      return true
    },
    log: () => {}
  }
  vm.runInNewContext(source + '\nthis.runGc = gcWorkbenchPartitions', context)
  return {
    partitionsRoot,
    writtenStates,
    run: async () => context.runGc(),
    cleanup: () => fs.rmSync(userData, { recursive: true, force: true })
  }
}

function createPartition(harness, name, { ageMs, networkCookie = false, rootCookie = false }) {
  const directory = path.join(harness.partitionsRoot, name)
  fs.mkdirSync(path.join(directory, 'Network'), { recursive: true })
  if (networkCookie) fs.writeFileSync(path.join(directory, 'Network', 'Cookies'), 'encrypted-cookie-store')
  if (rootCookie) fs.writeFileSync(path.join(directory, 'Cookies'), 'encrypted-cookie-store')
  const marker = path.join(directory, 'Local Storage')
  fs.mkdirSync(marker)
  fs.writeFileSync(path.join(directory, 'Preferences'), '{}')
  const mtime = new Date(Date.now() - ageMs)
  fs.utimesSync(directory, mtime, mtime)
  fs.utimesSync(path.join(directory, 'Network'), mtime, mtime)
  if (networkCookie) fs.utimesSync(path.join(directory, 'Network', 'Cookies'), mtime, mtime)
  if (rootCookie) fs.utimesSync(path.join(directory, 'Cookies'), mtime, mtime)
  return directory
}

test('main gc protects Network/Cookies evidence before workbench-login-state.json exists', async () => {
  const harness = makeGcHarness()
  try {
    const names = []
    for (let index = 0; index < 19; index++) {
      const name = instanceName('first-boot-' + index)
      names.push(name)
      createPartition(harness, name, {
        ageMs: index < 3 ? Math.round((9.38 - index * 0.05) * HOURS)
          : Math.round((0.77 + (index - 3) * 0.48) * HOURS),
        networkCookie: index < 3
      })
    }
    const oldest = names.slice(0, 3)
    assert.ok(oldest.every((name) => fs.statSync(
      path.join(harness.partitionsRoot, name, 'Network', 'Cookies')).size > 0))
    assert.ok(oldest.every((name) => !fs.existsSync(path.join(harness.partitionsRoot, name, 'Cookies'))))

    await harness.run()

    assert.deepEqual(oldest.filter((name) => !fs.existsSync(path.join(harness.partitionsRoot, name))), [],
      '状态文件尚未建立时，仅靠 Network/Cookies 也必须保住登录分区')
    assert.equal(harness.writtenStates.length, 0, '首启兜底不得伪造登录记录写盘')
  } finally {
    harness.cleanup()
  }
})

test('main gc can reclaim a recorded login partition after the 30-day state budget', async () => {
  const name = instanceName('expired-login-1')
  const partition = 'persist:' + name
  const harness = makeGcHarness({
    loginEntries: { [partition]: { updatedAt: Date.now() - 31 * DAYS } }
  })
  try {
    createPartition(harness, name, { ageMs: 13 * HOURS })
    await harness.run()
    assert.equal(fs.existsSync(path.join(harness.partitionsRoot, name)), false)
    assert.equal(harness.writtenStates.at(-1)?.entries[partition], undefined)
  } finally {
    harness.cleanup()
  }
})

test('main gc does not age-delete a partition that has Chromium cookie evidence', async () => {
  const cookieName = instanceName('stale-cookie-1')
  const anonymousName = instanceName('stale-anonymous-1')
  const harness = makeGcHarness()
  try {
    createPartition(harness, cookieName, { ageMs: 13 * HOURS, networkCookie: true })
    createPartition(harness, anonymousName, { ageMs: 13 * HOURS })
    assert.ok(PARTITION_MAX_AGE_MS < 13 * HOURS)
    await harness.run()
    assert.ok(fs.existsSync(path.join(harness.partitionsRoot, cookieName)))
    assert.equal(fs.existsSync(path.join(harness.partitionsRoot, anonymousName)), false)
  } finally {
    harness.cleanup()
  }
})

test('main gc recognizes a nonempty root Cookies file as the same first-boot evidence', async () => {
  const name = instanceName('root-cookie-1')
  const harness = makeGcHarness()
  try {
    createPartition(harness, name, { ageMs: 13 * HOURS, rootCookie: true })
    await harness.run()
    assert.ok(fs.existsSync(path.join(harness.partitionsRoot, name)))
  } finally {
    harness.cleanup()
  }
})

test('production prefixed state and active keys cannot delete the oldest protected partition', async () => {
  const protectedName = instanceName('prefixed-protected')
  const protectedKey = 'persist:' + protectedName
  const allNames = []
  const harness = makeGcHarness({
    loginEntries: { [protectedKey]: { updatedAt: Date.now() } },
    activePartitions: [protectedKey]
  })
  try {
    const protectedDirectory = path.join(harness.partitionsRoot, protectedName)
    createPartition(harness, protectedName, { ageMs: 59 * 60 * 1000 })
    for (let index = 0; index < 17; index++) {
      const name = instanceName('prefixed-' + index)
      allNames.push(name)
      createPartition(harness, name, { ageMs: 60 * 60 * 1000 + index })
    }
    assert.equal(fs.readFileSync(path.join(harness.partitionsRoot, '..', 'workbench-login-state.json'), 'utf8')
      .includes(protectedKey), true, 'fixture 必须走真实状态文件读取，不能手写无 prefix 键')

    await harness.run()

    assert.ok(fs.existsSync(protectedDirectory),
      'readWorkbenchLoginState() 与 activeServicePartitions() 的 persist: 键必须归一为目录名')
    const removed = allNames.filter((name) =>
      !fs.existsSync(path.join(harness.partitionsRoot, name)))
    assert.equal(removed.length, 1, '18 个分区、1 个受保护时，只应溢出删除 1 个匿名分区')
    assert.notEqual(removed[0], protectedName)
  } finally {
    harness.cleanup()
  }
})

test('unknown-account protection still works when active partitions keep the persist prefix', async () => {
  const inUse = [instanceName('unknown-account-a'), instanceName('unknown-account-b')]
  const activePartitions = inUse.map((name) => 'persist:' + name)
  const anonymousNames = []
  const harness = makeGcHarness({ activePartitions, failPartitions: activePartitions })
  try {
    inUse.forEach((name, index) => createPartition(harness, name, { ageMs: 59 * 60 * 1000 + index }))
    for (let index = 0; index < 17; index++) {
      const name = instanceName('unknown-account-anonymous-' + index)
      anonymousNames.push(name)
      createPartition(harness, name, { ageMs: 60 * 60 * 1000 + index })
    }

    await harness.run()

    assert.ok(inUse.every((name) => fs.existsSync(path.join(harness.partitionsRoot, name))),
      '会话查询失败且无登录记录时，activeServicePartitions 的带前缀键仍须保住在用分区')
    const removed = anonymousNames.filter((name) =>
      !fs.existsSync(path.join(harness.partitionsRoot, name)))
    assert.equal(removed.length, 1, '19 个分区中保护 2 个，只应因 maxCount 删除 1 个匿名分区')
  } finally {
    harness.cleanup()
  }
})
