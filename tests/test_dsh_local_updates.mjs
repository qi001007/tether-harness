import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLocalPluginUpdateHandler, loadedPluginVersion, selectedProfile } from '../packages/tether-dsh-surface/lib/local-updates.js'

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
    ok: false, error: { code: 'invalid_request', message: 'prepare does not accept url', details: {} }
  })
  assert.deepEqual(await handler('prepare', { manifest_url: 'http://plain.invalid/tether-update.json' }, undefined, ownerPeer), {
    ok: false, error: { code: 'invalid_request', message: 'manifest_url must be a trusted HTTPS URL', details: {} }
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

test('local plugin status reports loaded code separately from disk so a restart is not shown as latest', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-loaded-plugin-'))
  try {
    const profileDir = path.join(home, '.dsh', 'profiles', 'desktop')
    const surface = path.join(profileDir, 'node_modules', 'tether-dsh-surface')
    const client = path.join(profileDir, 'node_modules', 'tether-dsh-client')
    fs.mkdirSync(path.join(surface, 'updater'), { recursive: true })
    fs.mkdirSync(path.join(client, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(client, 'package.json'), JSON.stringify({ name: 'tether-dsh-client', version: '0.2.5' }))
    fs.writeFileSync(path.join(client, 'lib', 'client.js'), "const PLUGIN_VERSION = '0.2.5'")
    assert.equal(loadedPluginVersion(surface, path.join(home, '.dsh'), 'desktop'), '0.2.5')
    const handler = createLocalPluginUpdateHandler({
      env: { DSH_HOME: path.join(home, '.dsh') }, homeDir: home, packageRoot: surface,
      existsSync: () => true,
      execFileImpl: async () => ({ stdout: JSON.stringify({
        ok: true, component: 'plugin', current_version: '0.2.10', latest_version: '0.2.10', restart_required: false,
      }) })
    })
    const response = await handler('status', {}, undefined, ownerPeer)
    assert.equal(response.value.runtime_version, '0.2.5')
    assert.equal(response.value.current_version, '0.2.10')
    assert.equal(response.value.restart_required, true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
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

test('selectedProfile falls back to the live DSH host profile argument', () => {
  const root = 'C:/fixture/.dsh'
  assert.equal(selectedProfile('C:/installed/tether-dsh-surface', root, ['node', 'C:/fixture/.dsh/profiles/desktop']), 'desktop')
  assert.equal(selectedProfile('C:/installed/tether-dsh-surface', root, ['node', 'C:/fixture/.dsh/profiles/desktop/node_modules']), undefined)
  assert.equal(selectedProfile('C:/installed/tether-dsh-surface', root, ['node', 'C:/other/profiles/desktop']), undefined)
  assert.equal(selectedProfile('C:/installed/tether-dsh-surface', root, ['node', 'relative/profiles/desktop']), undefined)
})

test('a source checkout and the installed profile reporting different versions is flagged as drift', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-plugin-drift-'))
  try {
    const repo = path.join(home, 'repo')
    const surface = path.join(repo, 'packages', 'tether-dsh-surface')
    const source = path.join(repo, 'packages', 'dsh-plugin-tether-client')
    const installed = path.join(home, '.dsh', 'profiles', 'desktop', 'node_modules', 'tether-dsh-client')
    for (const directory of [path.join(surface, 'updater'), path.join(source, 'lib'), path.join(installed, 'lib')]) fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'dsh-plugin-tether-client', version: '0.2.14' }))
    fs.writeFileSync(path.join(source, 'lib', 'client.js'), "const PLUGIN_VERSION = '0.2.14'")
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: 'tether-dsh-client', version: '0.2.13' }))
    fs.writeFileSync(path.join(installed, 'lib', 'client.js'), "const PLUGIN_VERSION = '0.2.13'")
    const handler = createLocalPluginUpdateHandler({
      env: { DSH_HOME: path.join(home, '.dsh') }, homeDir: home, packageRoot: surface, existsSync: () => true,
      execFileImpl: async () => ({ stdout: JSON.stringify({ ok: true, component: 'plugin', current_version: '0.2.14' }) })
    })
    const response = await handler('status', {}, undefined, ownerPeer)
    assert.equal(response.value.runtime_version, '0.2.14')
    assert.equal(response.value.installed_version, '0.2.13')
    assert.equal(response.value.source_version, '0.2.14')
    assert.equal(response.value.version_drift, true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('overlapping status calls are refused instead of spawning a second updater', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let started = 0
  const handler = createLocalPluginUpdateHandler({
    env: {}, homeDir: 'C:/fixture', packageRoot: 'C:/fixture/.dsh/profiles/desktop/node_modules/tether-dsh-surface', existsSync: () => true,
    execFileImpl: async () => { started += 1; await gate; return { stdout: JSON.stringify({ ok: true, component: 'plugin' }) } }
  })
  const first = handler('status', {}, undefined, ownerPeer)
  const second = await handler('status', {}, undefined, ownerPeer)
  assert.equal(second.value.error_code, 'update_busy')
  release()
  assert.equal((await first).ok, true)
  assert.equal(started, 1)
})
