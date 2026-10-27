import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalPluginUpdateHandler, selectedProfile } from '../packages/tether-dsh-surface/lib/local-updates.js'

const normalized = (value) => String(value).replaceAll('\\', '/')
const ownerPeer = { principal: { kind: 'owner' } }

test('local plugin updater accepts only the four fixed authenticated logical endpoints', async () => {
  for (const action of ['status', 'check', 'prepare', 'apply']) {
    const handler = createLocalPluginUpdateHandler({
      env: {}, homeDir: 'C:/fixture', packageRoot: 'C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface', platform: 'win32',
      existsSync: () => true,
      execFileImpl: async () => ({ stdout: JSON.stringify({ ok: true, component: 'plugin' }) })
    })
    assert.equal((await handler(action, action === 'apply' ? { prepared_id: 'a'.repeat(32) } : {}, undefined, ownerPeer)).ok, true)
  }
  const handler = createLocalPluginUpdateHandler({ env: {}, existsSync: () => true, execFileImpl: async () => ({ stdout: '{}' }) })
  for (const endpoint of ['/status', 'apply/extra', 'apply?url=x', 'other']) {
    const result = await handler(endpoint, {}, undefined, ownerPeer)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'not_found')
  }
})

test('local plugin updater invokes a bundled Python module with fixed plugin paths and no renderer-controlled arguments', async () => {
  const calls = []
  const handler = createLocalPluginUpdateHandler({
    env: { DSH_HOME: 'C:/fixture/.dsh', PATH: 'safe-path', DEEPSEEK_API_KEY: 'never-forward', TETHER_NODE_TOKEN: 'never-forward' },
    homeDir: 'C:/fixture', packageRoot: 'C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface', platform: 'win32',
    existsSync: () => true,
    execFileImpl: async (file, args, options) => {
      calls.push({ file, args, options })
      const action = args[2]
      return { stdout: JSON.stringify(action === 'activity'
        ? { ok: true, busy: false }
        : { ok: true, component: 'plugin', prepared: [] }) }
    }
  })
  const response = await handler('status', {}, undefined, ownerPeer)
  assert.deepEqual(response, { ok: true, value: { ok: true, component: 'plugin', prepared: [] } })
  assert.equal(calls[0].file, 'python')
  assert.deepEqual(calls[0].args.slice(0, 3), ['-m', 'tether.updates_cli', 'status'])
  assert.ok(calls[0].args.includes('--component') && calls[0].args.includes('plugin'))
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--profile'), calls[0].args.indexOf('--profile') + 2), ['--profile', 'desktop'])
  assert.ok(calls[0].args.includes('--root') && calls[0].args.map(normalized).includes('C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface/updater'))
  assert.ok(calls[0].args.includes('--state-dir') && calls[0].args.map(normalized).includes('C:/fixture/.dsh/storages/tether/updates'))
  assert.equal(normalized(calls[0].options.cwd), 'C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface/updater')
  assert.equal(calls[0].options.env.DEEPSEEK_API_KEY, undefined)
  assert.equal(calls[0].options.env.TETHER_NODE_TOKEN, undefined)
  assert.deepEqual(await handler('prepare', { url: 'https://attacker.invalid' }, undefined, ownerPeer), {
    ok: false, error: { code: 'invalid_request', message: 'prepare does not accept parameters', details: {} }
  })
  assert.equal(calls.length, 1)
})

test('local plugin updater derives profile from its installed DSH package path and refuses unknown paths', async () => {
  assert.equal(selectedProfile('C:/fixture/.dsh/profiles/alt/node_modules/tether-dsh-surface', 'C:/fixture/.dsh'), 'alt')
  assert.equal(selectedProfile('C:/fixture/.dsh/profiles/desktop/node_modules/other-plugin', 'C:/fixture/.dsh'), undefined)
  assert.equal(selectedProfile('C:/elsewhere/profiles/desktop/node_modules/tether-dsh-surface', 'C:/fixture/.dsh'), undefined)
  let spawned = false
  const handler = createLocalPluginUpdateHandler({
    env: {}, homeDir: 'C:/fixture', packageRoot: 'C:/installed/tether-dsh-surface',
    existsSync: () => true,
    execFileImpl: async () => { spawned = true; return { stdout: '{"ok":true}' } }
  })
  const response = await handler('apply', { prepared_id: 'a'.repeat(32) }, undefined, ownerPeer)
  assert.equal(response.value.error_code, 'plugin_profile_unknown')
  assert.equal(spawned, false)
})

test('local plugin apply checks native DSH activity and refuses while a turn is active', async () => {
  const actions = []
  const handler = createLocalPluginUpdateHandler({
    env: {}, homeDir: 'C:/fixture', packageRoot: 'C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface', platform: 'win32',
    existsSync: () => true,
    execFileImpl: async (_file, args) => {
      const action = args[2]
      actions.push(action)
      return { stdout: JSON.stringify({ ok: true, busy: action === 'activity', reason: 'fixture active turn' }) }
    }
  })
  const response = await handler('apply', { prepared_id: 'a'.repeat(32) }, undefined, ownerPeer)
  assert.equal(response.ok, true)
  assert.equal(response.value.ok, false)
  assert.equal(response.value.error_code, 'update_busy')
  assert.deepEqual(actions, ['activity'])
})

test('local plugin update channel rejects non-owner peers before spawning the updater', async () => {
  let spawned = false
  const handler = createLocalPluginUpdateHandler({
    env: {}, existsSync: () => true,
    execFileImpl: async () => { spawned = true; return { stdout: '{"ok":true}' } }
  })
  const response = await handler('status', {}, undefined, { principal: { kind: 'delegate' } })
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'forbidden')
  assert.equal(spawned, false)
})

test('missing bundled updater fails safely without confusing it with a missing Python runtime', async () => {
  let spawned = false
  const handler = createLocalPluginUpdateHandler({
    env: {}, homeDir: 'C:/fixture', packageRoot: 'C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface', existsSync: () => false,
    execFileImpl: async () => { spawned = true; return { stdout: '{"ok":true}' } }
  })
  const response = await handler('status', {}, undefined, ownerPeer)
  assert.equal(response.ok, true)
  assert.equal(response.value.error_code, 'updater_missing')
  assert.equal(spawned, false)
})
