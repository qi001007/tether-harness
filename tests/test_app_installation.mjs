import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { hubOrigin, installationId, migrateLegacyData, registerAppInstallation } = require('../apps/tether-app/app-installation.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-app-binding-'))
const home = path.join(root, 'home')
const install = path.join(root, 'install')
const data = path.join(install, 'apps', 'tether-app', 'data')
const originalHome = os.homedir

try {
  fs.mkdirSync(data, { recursive: true })
  fs.mkdirSync(path.join(install, 'apps', 'tether-app'), { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(install, 'apps', 'tether-app', 'main.js'), '')
  fs.writeFileSync(path.join(install, 'version.json'), JSON.stringify({ components: { app: '0.4.5' } }))
  fs.writeFileSync(path.join(data, 'hub.json'), JSON.stringify({
    url: 'https://hub.example/path', device: 'LAPTOP-01', nodeToken: 'credential-secret'
  }))
  os.homedir = () => home
  assert.equal(hubOrigin('wss://hub.example/ws/node'), 'https://hub.example')
  const env = { TETHER_APP_BINDING: '1', TETHER_NO_SHORTCUTS: '1' }
  const first = registerAppInstallation({ env, dataDir: data, appRoot: install, startedAt: 1_794_000_000_000, startedVersion: '0.4.5' })
  assert.ok(first, 'explicit binding enables registration when shortcuts are disabled')
  const record = JSON.parse(fs.readFileSync(first, 'utf8'))
  assert.equal(path.basename(first), installationId('https://hub.example', 'LAPTOP-01') + '.json')
  assert.equal(record.started_version, '0.4.5')
  assert.equal(record.process_started_at, 1_794_000_000)
  assert.equal(record.credential_fingerprint.length, 64)
  assert.ok(!fs.readFileSync(first, 'utf8').includes('credential-secret'))

  for (const [name, extra] of [
    ['oidc-logged-in', { desktopAuthMode: 'oidc', nodeMode: 'external' }],
    ['oidc-logged-out', { desktopAuthMode: 'oidc', nodeMode: 'external' }]
  ]) {
    const profile = path.join(root, name)
    fs.mkdirSync(profile)
    const profileData = path.join(profile, 'hub.json')
    const profileConfig = { url: 'https://hub.example/path', device: 'DESKTOP-LOCAL', ...extra }
    fs.writeFileSync(profileData, JSON.stringify(profileConfig))
    if (name === 'oidc-logged-in') fs.writeFileSync(path.join(profile, 'oidc-session.json'), '{}')
    assert.equal(migrateLegacyData({ dataDir: profile, candidateMode: false, dataDirOverride: false }), null,
      `${name} external OIDC profile is already initialized`)
    assert.equal(fs.readFileSync(profileData, 'utf8'), JSON.stringify(profileConfig),
      `${name} profile is kept unchanged`)
  }

  const nodeProfile = path.join(root, 'node-identity')
  fs.mkdirSync(nodeProfile)
  const nodeProfileData = path.join(nodeProfile, 'hub.json')
  const nodeProfileConfig = { url: 'https://hub.example/path', device: 'LAPTOP-01', nodeToken: 'node-credential' }
  fs.writeFileSync(nodeProfileData, JSON.stringify(nodeProfileConfig))
  assert.equal(migrateLegacyData({ dataDir: nodeProfile, candidateMode: false, dataDirOverride: false }), null,
    'existing Node credential profile remains initialized')
  assert.equal(fs.readFileSync(nodeProfileData, 'utf8'), JSON.stringify(nodeProfileConfig))

  for (const [index, profileConfig] of [
    { nodeMode: 'external', url: 'https://hub.example/path', device: 'DESKTOP-LOCAL' },
    { desktopAuthMode: 'oidc', url: 'https://hub.example/path', device: 'DESKTOP-LOCAL' },
    { desktopAuthMode: 'oidc', nodeMode: 'external', url: 'invalid:', device: 'DESKTOP-LOCAL' },
    { desktopAuthMode: 'oidc', nodeMode: 'external', url: 'https://hub.example/path', device: ' ' }
  ].entries()) {
    const profile = path.join(root, `invalid-profile-${index}`)
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'hub.json'), JSON.stringify(profileConfig))
    assert.throws(() => migrateLegacyData({ dataDir: profile, candidateMode: false, dataDirOverride: false }),
      (error) => error.code === 'app_migration_target_not_empty',
      'incomplete or invalid profile remains protected from identity merge')
  }

  fs.writeFileSync(path.join(install, 'version.json'), JSON.stringify({ components: { app: '0.4.6' } }))
  registerAppInstallation({ env, dataDir: data, appRoot: install, startedAt: 1_794_000_000_000, startedVersion: '0.4.5' })
  assert.equal(JSON.parse(fs.readFileSync(first, 'utf8')).started_version, '0.4.5',
    'a later config refresh retains the version captured by this process')
  assert.equal(registerAppInstallation({ env: { ...env, TETHER_APP_BINDING: '0' }, dataDir: data, appRoot: install }), null)
} finally {
  os.homedir = originalHome
  fs.rmSync(root, { recursive: true, force: true })
}

process.stdout.write('APP installation binding checks passed\n')
