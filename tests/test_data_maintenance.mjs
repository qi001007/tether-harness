import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { selectStalePartitions, PARTITION_MAX_AGE_MS } = require('../apps/tether-app/data-maintenance.js')

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