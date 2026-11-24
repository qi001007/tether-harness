'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PARTITION_PREFIX = 'tether-wb-'
// Workbench partitions now carry a persistent HTTP cache (DSH core+plugin
// bundles measured ~18 MB on 2026-11-24). Retention is bounded on purpose:
// keep a warm cache for the same working day, then reclaim the disk.
const PARTITION_MAX_AGE_MS = 12 * 60 * 60 * 1000
const PARTITION_MAX_COUNT = 16
const LOGIN_PARTITION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// Login-bearing Chromium storage lives in these paths. Cache reclamation may
// only delete reproducible assets; deleting the whole directory would also
// remove the authenticated DSH cookie jar and local session state.
const PARTITION_CACHE_SUBDIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Media Cache',
  'Service Worker/CacheStorage',
  'Service Worker/ScriptCache'
]

const PARTITION_CREDENTIAL_CANDIDATES = [
  ['Network', 'Cookies'],
  ['Cookies']
]

function partitionHasCredentialEvidence(partitionDirectory, { fsImpl = fs, now = Date.now() } = {}) {
  let stats
  try {
    stats = PARTITION_CREDENTIAL_CANDIDATES
      .map((parts) => path.join(partitionDirectory, ...parts))
      .map((candidate) => {
        try { return { path: candidate, stat: fsImpl.statSync(candidate) } }
        catch (_) { return null }
      })
      .filter(Boolean)
  } catch (_) { return false }
  return stats.some(({ stat }) => {
    return stat.isFile && stat.isFile() && stat.size > 0
      && (!stat.mtimeMs || now - Number(stat.mtimeMs) < LOGIN_PARTITION_MAX_AGE_MS)
  })
}

function partitionDirectoryName(name) {
  return String(name || '').replace(/^persist:/, '')
}

function normalizeLoginEntries(loginEntries) {
  if (!loginEntries || typeof loginEntries !== 'object' || Array.isArray(loginEntries)) return {}
  const normalized = {}
  for (const [key, value] of Object.entries(loginEntries)) {
    const name = partitionDirectoryName(key)
    if (name.startsWith(PARTITION_PREFIX)) normalized[name] = value
  }
  return normalized
}

function normalizeEntries(entries, options = {}) {
  const now = Number(options.now) || Date.now()
  const loginMaxAgeMs = Number(options.loginMaxAgeMs) || LOGIN_PARTITION_MAX_AGE_MS
  const loginEntries = normalizeLoginEntries(options.loginEntries)
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry.name === 'string'
      && partitionDirectoryName(entry.name).startsWith(PARTITION_PREFIX))
    .map((entry) => {
      const name = partitionDirectoryName(entry.name)
      const loginAt = Number(loginEntries[name] && loginEntries[name].updatedAt) || 0
      const hasLoginState = entry.hasLoginState === true
        || entry.hasCredentialEvidence === true
        || (loginAt > 0 && now - loginAt < loginMaxAgeMs)
      return {
        name,
        mtimeMs: Number(entry.mtimeMs) || 0,
        hasLoginState
      }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
}

function partitionBudgetReport(entries, {
  now = Date.now(),
  maxAgeMs = PARTITION_MAX_AGE_MS,
  maxCount = PARTITION_MAX_COUNT,
  loginMaxAgeMs = LOGIN_PARTITION_MAX_AGE_MS,
  activePartitions = [],
  protectedPartitions = [],
  loginEntries = {}
} = {}) {
  const protectedNames = new Set([...(Array.isArray(activePartitions) ? activePartitions : []),
    ...(Array.isArray(protectedPartitions) ? protectedPartitions : [])]
    .map(partitionDirectoryName))
  const partitions = normalizeEntries(entries, { now, loginMaxAgeMs, loginEntries })
  const removable = []
  const reasons = {}
  const protectedPresent = partitions.filter((entry) => protectedNames.has(entry.name))
  const protectedSet = new Set(protectedPresent.map((entry) => entry.name))
  const eligible = partitions.filter((entry) => !protectedSet.has(entry.name))
  const anonymous = eligible.filter((entry) => !entry.hasLoginState)
  const anonymousStale = anonymous.filter((entry) => now - entry.mtimeMs >= maxAgeMs)
  const anonymousFresh = anonymous.filter((entry) => now - entry.mtimeMs < maxAgeMs)
  removable.push(...anonymousStale)
  anonymousStale.forEach((entry) => { reasons[entry.name] = 'age' })
  const freshOverflow = Math.max(0, anonymousFresh.length - Math.max(0, maxCount))
  removable.push(...anonymousFresh.slice(0, freshOverflow))
  anonymousFresh.slice(0, freshOverflow).forEach((entry) => { reasons[entry.name] = 'count' })

  const removableSet = new Set(removable.map((entry) => entry.name))
  const retained = partitions.length - removable.length
  const countPressure = Math.max(0, retained - Math.max(0, maxCount))
  const loginCandidates = eligible.filter((entry) => entry.hasLoginState && !removableSet.has(entry.name))
  const staleLoginCandidates = loginCandidates.filter((entry) => now - entry.mtimeMs >= maxAgeMs)
  const cacheTrimCandidates = loginCandidates.filter((entry) => staleLoginCandidates.includes(entry)
    || loginCandidates.indexOf(entry) < countPressure)
  const cacheTrim = cacheTrimCandidates.map((entry) => entry.name)
  cacheTrim.forEach((name) => { reasons[name] = 'age' })
  return {
    removable: removable.map((entry) => entry.name),
    cacheTrim,
    protected: protectedPresent.map((entry) => entry.name),
    reasons,
    total: partitions.length
  }
}

function selectStalePartitions(entries, options = {}) {
  return partitionBudgetReport(entries, options).removable
}

module.exports = {
  PARTITION_PREFIX,
  PARTITION_MAX_AGE_MS,
  PARTITION_MAX_COUNT,
  LOGIN_PARTITION_MAX_AGE_MS,
  PARTITION_CACHE_SUBDIRS,
  PARTITION_CREDENTIAL_CANDIDATES,
  partitionDirectoryName,
  partitionHasCredentialEvidence,
  selectStalePartitions,
  partitionBudgetReport
}
