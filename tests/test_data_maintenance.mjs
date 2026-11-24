import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  selectStalePartitions, partitionBudgetReport, partitionDirectoryName,
  partitionHasCredentialEvidence, PARTITION_MAX_AGE_MS
} = require('../apps/tether-app/data-maintenance.js')

const now = 1_800_000_000_000

test('removes tether-wb partitions older than the age budget', () => {
  const selected = selectStalePartitions([
    { name: 'tether-wb-old', mtimeMs: now - PARTITION_MAX_AGE_MS - 1 },
    { name: 'tether-wb-fresh', mtimeMs: now - 1000 }
  ], { now })
  assert.deepEqual(selected, ['tether-wb-old'])
})

test('ignores non workbench partitions', () => {
  const selected = selectStalePartitions([
    { name: 'tether-browser', mtimeMs: now - 10 * PARTITION_MAX_AGE_MS },
    { name: 'tether-hub-login', mtimeMs: now - 10 * PARTITION_MAX_AGE_MS }
  ], { now })
  assert.deepEqual(selected, [])
})

test('caps fresh partitions by deleting the oldest beyond the count budget', () => {
  const entries = [1, 2, 3, 4, 5].map((index) => ({
    name: 'tether-wb-' + index,
    mtimeMs: now - index * 1000
  }))
  const selected = selectStalePartitions(entries, { now, maxCount: 3 })
  assert.deepEqual(selected.sort(), ['tether-wb-4', 'tether-wb-5'])
})

test('keeps fresh partitions when within both budgets', () => {
  const selected = selectStalePartitions([
    { name: 'tether-wb-a', mtimeMs: now - 1000 },
    { name: 'tether-wb-b', mtimeMs: now - 2000 }
  ], { now, maxCount: 3 })
  assert.deepEqual(selected, [])
})

test('does not age out a partition with a recorded DSH login', () => {
  const selected = selectStalePartitions([
    { name: 'tether-wb-logged-in', mtimeMs: now - PARTITION_MAX_AGE_MS - 1 },
    { name: 'tether-wb-anonymous', mtimeMs: now - PARTITION_MAX_AGE_MS - 1 }
  ], { now, loginEntries: { 'tether-wb-logged-in': { updatedAt: now - 1000 } } })
  assert.deepEqual(selected, ['tether-wb-anonymous'])
})

test('does not let the count budget evict a logged-in partition', () => {
  const entries = [1, 2, 3, 4].map((index) => ({
    name: 'tether-wb-' + index,
    mtimeMs: now - index * 1000
  }))
  const selected = selectStalePartitions(entries, {
    now,
    maxCount: 1,
    loginEntries: { 'tether-wb-1': { updatedAt: now - 1000 } }
  })
  assert.equal(selected.includes('tether-wb-1'), false)
  assert.deepEqual(selected.sort(), ['tether-wb-3', 'tether-wb-4'])
})

test('real 19/3 shape evicts none by age and cache-trims the three oldest logged-in partitions', () => {
  // 2026-11-25 实测：19 个 tether-wb-*，年龄 0.77h-9.38h；三个最旧分区有有效登录 cookie。
  const entries = []
  for (let index = 0; index < 19; index++) {
    const ageMs = index < 3 ? hours(9.38 - index * 0.05) : hours(0.77 + (index - 3) * 0.48)
    entries.push({ name: 'tether-wb-' + String(index).padStart(2, '0'), mtimeMs: now - ageMs,
      hasLoginState: index < 3 })
  }
  const report = partitionBudgetReport(entries, { now })
  assert.deepEqual(report.removable, [], 'age 不触发，overflow 也不得删除带凭据的分区')
  assert.deepEqual(report.cacheTrim.sort(), ['tether-wb-00', 'tether-wb-01', 'tether-wb-02'])
})

// DSH-6：Chromium 把 cookie 放在分区内 `Network/Cookies`（实测本机 19/19 命中，
// 顶层 `Cookies` 为 0），所以登录态信号必须由调用方按这个约定算好后传进来。
const hours = (value) => value * 60 * 60 * 1000

test('the age budget keeps a partition that still holds login state', () => {
  const selected = selectStalePartitions([
    { name: 'tether-wb-logged', mtimeMs: now - hours(13), hasLoginState: true },
    { name: 'tether-wb-anon', mtimeMs: now - hours(13), hasLoginState: false }
  ], { now })
  assert.deepEqual(selected, ['tether-wb-anon'])
})

test('the count budget keeps every logged-in partition on the real 17/3 shape', () => {
  // 真机读数：19 个分区全带 Network/Cookies，年龄 0.88~10.36h（age 不触发），
  // maxCount=16 时最旧 3 个被 count 命中。这里按同构缩小到 17 个 / maxCount 14。
  const entries = []
  for (let index = 0; index < 17; index++) {
    entries.push({
      name: 'tether-wb-' + String(index).padStart(2, '0'),
      mtimeMs: now - hours(0.5 + index * 0.1),
      hasLoginState: index >= 14
    })
  }
  const report = partitionBudgetReport(entries, { now, maxCount: 14 })
  assert.deepEqual(report.removable, [], '超额的最旧三个都带登录态，一个都不许整目录删')
  assert.equal(report.cacheTrim.length, 3)
  assert.deepEqual(report.cacheTrim.sort(), ['tether-wb-14', 'tether-wb-15', 'tether-wb-16'])
})

test('age and count pressure together stay explainable and ordered', () => {
  const entries = [
    { name: 'tether-wb-age-out', mtimeMs: now - hours(13), hasLoginState: false },
    { name: 'tether-wb-logged', mtimeMs: now - hours(1), hasLoginState: true },
    { name: 'tether-wb-mid', mtimeMs: now - hours(0.9), hasLoginState: false },
    { name: 'tether-wb-new', mtimeMs: now - hours(0.8), hasLoginState: false }
  ]
  const report = partitionBudgetReport(entries, { now, maxCount: 2 })
  // 锁行为不锁标签：到期匿名分区整目录删；登录分区永不整目录删，只在超额时进缓存清理。
  assert.deepEqual(report.removable, ['tether-wb-age-out'])
  assert.equal(report.removable.includes('tether-wb-logged'), false)
  assert.equal(report.removable.includes('tether-wb-mid'), false, 'count 压力先走登录分区的缓存清理，不挤掉匿名新鲜分区')
  assert.deepEqual(report.cacheTrim, ['tether-wb-logged'])
  assert.equal(report.reasons['tether-wb-age-out'], 'age')
  for (const name of [...report.removable, ...report.cacheTrim]) {
    assert.ok(['age', 'count'].includes(report.reasons[name]), name + ' 必须有可解释的命中原因')
  }
  assert.deepEqual(report.protected, [])
})

test('in-use partitions are neither deleted nor cache-trimmed', () => {
  const entries = [
    { name: 'tether-wb-active', mtimeMs: now - hours(13), hasLoginState: true },
    { name: 'tether-wb-anon', mtimeMs: now - hours(13), hasLoginState: false }
  ]
  const report = partitionBudgetReport(entries, {
    now, maxCount: 1, protectedPartitions: ['tether-wb-active']
  })
  assert.deepEqual(report.removable, ['tether-wb-anon'])
  assert.deepEqual(report.cacheTrim, [])
  assert.deepEqual(report.protected, ['tether-wb-active'])
})

test('cache trim never reaches the login-state files', () => {
  // 动作约定由 main.js 执行，这里锁住"可清子目录"白名单本身。
  const { PARTITION_CACHE_SUBDIRS } = require('../apps/tether-app/data-maintenance.js')
  for (const keep of ['Cookies', 'Local Storage', 'Session Storage', 'Network']) {
    assert.equal(PARTITION_CACHE_SUBDIRS.includes(keep), false, keep + ' 不得进缓存清理名单')
  }
  assert.ok(PARTITION_CACHE_SUBDIRS.includes('Cache'))
  assert.ok(PARTITION_CACHE_SUBDIRS.includes('Code Cache'))
})

test('first-boot Chromium Network/Cookies fallback protects partitions before any login state exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-partition-first-boot-'))
  try {
    const entries = []
    for (let index = 0; index < 19; index++) {
      const name = 'tether-wb-' + String(index).padStart(2, '0')
      const directory = path.join(root, name)
      const ageMs = index < 3 ? hours(9.38 - index * 0.05) : hours(0.77 + (index - 3) * 0.48)
      fs.mkdirSync(directory)
      if (index < 3) {
        fs.mkdirSync(path.join(directory, 'Network'))
        fs.writeFileSync(path.join(directory, 'Network', 'Cookies'), 'encrypted-cookie-store')
      }
      const mtime = new Date(now - ageMs)
      fs.utimesSync(directory, mtime, mtime)
      if (index < 3) {
        const cookiePath = path.join(directory, 'Network', 'Cookies')
        fs.utimesSync(path.join(directory, 'Network'), mtime, mtime)
        fs.utimesSync(cookiePath, mtime, mtime)
      }
      entries.push({
        name,
        mtimeMs: fs.statSync(directory).mtimeMs,
        hasCredentialEvidence: partitionHasCredentialEvidence(directory, { now })
      })
    }
    assert.equal(entries[0].hasCredentialEvidence, true)
    assert.equal(entries[18].hasCredentialEvidence, false)
    const report = partitionBudgetReport(entries, { now })
    assert.deepEqual(report.removable, [], '状态文件尚未建立时，Network/Cookies 本身就是首启保命证据')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('production prefixed keys are normalized so the oldest protected partition survives', () => {
  const a = 'tether-wb-a'
  const b = 'tether-wb-b'
  const entries = [
    { name: a, mtimeMs: now - hours(9) },
    { name: b, mtimeMs: now - hours(1) }
  ]
  const activePartitions = ['persist:' + a]
  const protectedPartitions = ['persist:tether-dsh-local', ...activePartitions]
  const loginEntries = { ['persist:' + a]: { updatedAt: now } }

  assert.equal(partitionDirectoryName('persist:' + a), a)
  assert.deepEqual(selectStalePartitions(entries, { now, maxCount: 1 }), [a],
    '没有豁免的基线必须删最旧的 A')
  assert.deepEqual(selectStalePartitions(entries, {
    now,
    maxCount: 1,
    protectedPartitions,
    loginEntries
  }), [], 'readWorkbenchLoginState 与 activeServicePartitions 的真实 persist: 键必须生效')

  const legacyProtectedSet = new Set(protectedPartitions)
  const legacyAnonymous = entries
    .filter((entry) => !legacyProtectedSet.has(entry.name) && !loginEntries[entry.name])
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
  assert.equal(legacyAnonymous[0].name, a,
    '此反例证明旧键名接线会静默落空；拿掉目录名归一化后 A 仍会被删')
})