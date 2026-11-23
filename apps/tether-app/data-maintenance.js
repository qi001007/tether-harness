'use strict'

const PARTITION_PREFIX = 'tether-wb-'
// Workbench partitions now carry a persistent HTTP cache (DSH core+plugin
// bundles measured ~18 MB on 2026-11-24). Retention is bounded on purpose:
// keep a warm cache for the same working day, then reclaim the disk.
const PARTITION_MAX_AGE_MS = 12 * 60 * 60 * 1000
const PARTITION_MAX_COUNT = 16

function selectStalePartitions(entries, {
  now = Date.now(),
  maxAgeMs = PARTITION_MAX_AGE_MS,
  maxCount = PARTITION_MAX_COUNT
} = {}) {
  const partitions = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.startsWith(PARTITION_PREFIX))
    .map((entry) => ({ name: entry.name, mtimeMs: Number(entry.mtimeMs) || 0 }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
  const stale = partitions.filter((entry) => now - entry.mtimeMs >= maxAgeMs)
  const fresh = partitions.filter((entry) => now - entry.mtimeMs < maxAgeMs)
  const overflow = Math.max(0, fresh.length - Math.max(0, maxCount))
  return [...stale, ...fresh.slice(0, overflow)].map((entry) => entry.name)
}

module.exports = {
  PARTITION_PREFIX,
  PARTITION_MAX_AGE_MS,
  PARTITION_MAX_COUNT,
  selectStalePartitions
}