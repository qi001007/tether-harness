import assert from 'node:assert/strict'
import test from 'node:test'

import { createDshLocalPluginSurfaceReloadBridge } from '../packages/tether-ui/src/hosts/dsh.js'

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
  assert.deepEqual(calls, [['entry-surface', true]])
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
