import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, internals } from '../packages/tether-dsh-surface/lib/index.js'

test('surface publishes its descriptor with the current connection API and resolves the host profile', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-surface-'))
  const profile = path.join(home, 'profiles', 'desktop')
  fs.mkdirSync(profile, { recursive: true })
  const previousHome = process.env.DSH_HOME
  const previousArgv = process.argv
  const registered = []
  process.env.DSH_HOME = home
  process.argv = [...previousArgv, profile]
  let cleanup
  try {
    const ctx = {
      connection: {
        authenticatedUrl: (origin) => origin + '/?token=fixture',
        register(_owner, channel, handler) { registered.push(channel); assert.equal(typeof handler, 'function'); return () => {} }
      },
      webServer: { getOrigin: () => 'http://127.0.0.1:34567' },
      effect: (fn) => { cleanup = fn() },
      get: () => undefined,
    }
    apply(ctx)
    assert.deepEqual(registered, ['/tether-updates', '/tether-identity'])
    const descriptor = JSON.parse(fs.readFileSync(internals.descriptorPath(), 'utf8'))
    assert.equal(descriptor.version, 1)
    assert.equal(descriptor.profile, 'desktop')
    assert.equal(descriptor.origin, 'http://127.0.0.1:34567')
    assert.equal(descriptor.authenticated_url, 'http://127.0.0.1:34567/?token=fixture')
    cleanup()
    assert.equal(fs.existsSync(internals.descriptorPath()), false)
  } finally {
    process.argv = previousArgv
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
