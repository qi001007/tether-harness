import assert from 'node:assert/strict'
import test from 'node:test'

import { createDshLocalPluginSurfaceReloadBridge, createDshPluginHotReloadWatch } from '../packages/tether-ui/src/hosts/dsh.js'

test('surface reload applies only the unique enabled surface entry', async () => {
  const calls = []
  const reload = createDshLocalPluginSurfaceReloadBridge(() => ({ pluginManager: {
    listPlugins: async () => ({ ok: true, value: [
      { moduleName: 'other-plugin', entryId: 'entry-other', enabled: true },
      { moduleName: 'tether-dsh-surface', entryId: 'entry-surface', enabled: true }
    ] }),
    setPluginEnabled: async (...args) => { calls.push(args); return { ok: true, value: { application: 'applied' } } }
  } }))
  assert.deepEqual(await reload(), { application: 'applied' })
  assert.deepEqual(calls, [['entry-surface', false], ['entry-surface', true]])
})

test('ambiguous surface entries fail closed without applying any entry', async () => {
  let applied = false
  const reload = createDshLocalPluginSurfaceReloadBridge(() => ({ pluginManager: {
    listPlugins: async () => ({ ok: true, value: [
      { moduleName: 'tether-dsh-surface', entryId: 'entry-one', enabled: true },
      { moduleName: 'tether-dsh-surface', entryId: 'entry-two', enabled: true }
    ] }),
    setPluginEnabled: async () => { applied = true; return { ok: true, value: { application: 'applied' } } }
  } }))
  await assert.rejects(reload(), /不唯一/)
  assert.equal(applied, false)
})

test('restart-required is returned as a non-applied result for the caller to handle', async () => {
  const reload = createDshLocalPluginSurfaceReloadBridge(() => ({ pluginManager: {
    listPlugins: async () => ({ ok: true, value: [
      { moduleName: 'tether-dsh-surface', entryId: 'entry-surface', enabled: true }
    ] }),
    setPluginEnabled: async () => ({ ok: true, value: { application: 'restart-required' } })
  } }))
  assert.deepEqual(await reload(), { application: 'restart-required' })
})

test('reload still enables the surface when the stop call fails', async () => {
  const calls = []
  const reload = createDshLocalPluginSurfaceReloadBridge(() => ({ pluginManager: {
    listPlugins: async () => ({ ok: true, value: [
      { moduleName: 'tether-dsh-surface', entryId: 'entry-surface', enabled: true }
    ] }),
    setPluginEnabled: async (id, enabled) => {
      calls.push([id, enabled])
      if (!enabled) return { ok: false, error: { message: 'busy' } }
      return { ok: true, value: { application: 'applied' } }
    }
  } }))
  assert.deepEqual(await reload(), { application: 'applied' })
  assert.deepEqual(calls, [['entry-surface', false], ['entry-surface', true]])
})

test('reload retries the enable once instead of leaving the surface disabled', async () => {
  let enables = 0
  const reload = createDshLocalPluginSurfaceReloadBridge(() => ({ pluginManager: {
    listPlugins: async () => ({ ok: true, value: [
      { moduleName: 'tether-dsh-surface', entryId: 'entry-surface', enabled: true }
    ] }),
    setPluginEnabled: async (_id, enabled) => {
      if (!enabled) return { ok: true, value: { application: 'applied' } }
      enables += 1
      if (enables === 1) throw new Error('transient')
      return { ok: true, value: { application: 'applied' } }
    }
  } }))
  assert.deepEqual(await reload(), { application: 'applied' })
  assert.equal(enables, 2)
})

test('hot reload watch applies a pending on-disk plugin version once', async () => {
  let reloads = 0
  const store = new Map()
  const stop = createDshPluginHotReloadWatch({
    getRpc: () => ({ call: async () => ({ ok: true, value: {
      ok: true, restart_required: true, disk_version: '0.2.91', runtime_version: '0.2.90'
    } }) }),
    reloadSurface: async () => { reloads += 1 },
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    intervalMs: 1000
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  stop()
  assert.equal(reloads, 1)
})

test('hot reload watch ignores a surface that is already current', async () => {
  let reloads = 0
  const stop = createDshPluginHotReloadWatch({
    getRpc: () => ({ call: async () => ({ ok: true, value: {
      ok: true, restart_required: false, disk_version: '0.2.90', runtime_version: '0.2.90'
    } }) }),
    reloadSurface: async () => { reloads += 1 },
    intervalMs: 1000
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  stop()
  assert.equal(reloads, 0)
})

test('hot reload watch survives a reload error and can be stopped', async () => {
  let attempts = 0
  const stop = createDshPluginHotReloadWatch({
    getRpc: () => ({ call: async () => ({ ok: true, value: {
      ok: true, restart_required: true, disk_version: '0.2.91', runtime_version: '0.2.90'
    } }) }),
    reloadSurface: async () => { attempts += 1; throw new Error('busy') },
    intervalMs: 1000
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  stop()
  assert.equal(attempts, 1)
})
