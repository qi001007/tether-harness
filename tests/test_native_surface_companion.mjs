import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply, internals } from '../packages/tether-dsh-surface/lib/index.js'

function context(origin) {
  let dispose
  return {
    webServer: { getOrigin: () => origin },
    connection: { authenticatedUrl: (value) => `${value}/?auth=private-value` },
    get: () => undefined,
    effect(register) { dispose = register() },
    cleanup() { dispose?.() }
  }
}

test('companion publishes a private descriptor, protects another live host, replaces stale hosts, and cleans its own entry', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-dsh-surface-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const descriptor = internals.descriptorPath()
  try {
    assert.equal(internals.isLoopbackOrigin('http://127.0.0.1:3080'), true)
    assert.equal(internals.isLoopbackOrigin('http://[::1]:3080'), true)
    assert.equal(internals.isLoopbackOrigin('http://localhost:3080'), false)
    assert.equal(internals.isLoopbackOrigin('http://0.0.0.0:3080'), false)
    assert.equal(internals.isLoopbackOrigin('https://127.0.0.1:3080'), false)

    const ctx = context('http://127.0.0.1:3080')
    apply(ctx)
    const published = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    assert.equal(published.version, 1)
    assert.equal(published.pid, process.pid)
    assert.equal(published.origin, 'http://127.0.0.1:3080')
    assert.match(published.authenticated_url, /auth=private-value/)
    if (process.platform !== 'win32') assert.equal(fs.statSync(descriptor).mode & 0o777, 0o600)

    fs.writeFileSync(descriptor, JSON.stringify({ version: 1, pid: process.pid, origin: 'http://127.0.0.1:9999' }))
    assert.throws(() => apply(context('http://127.0.0.1:3080')), /another live DSH host/)
    assert.equal(JSON.parse(fs.readFileSync(descriptor, 'utf8')).origin, 'http://127.0.0.1:9999')

    fs.writeFileSync(descriptor, JSON.stringify({ version: 1, pid: 2147483647, origin: 'http://127.0.0.1:9999' }))
    const restarted = context('http://127.0.0.1:3080')
    apply(restarted)
    assert.equal(JSON.parse(fs.readFileSync(descriptor, 'utf8')).pid, process.pid)
    restarted.cleanup()
    assert.equal(fs.existsSync(descriptor), false)
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
