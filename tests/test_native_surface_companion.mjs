import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply, internals } from '../packages/tether-dsh-surface/lib/index.js'
import { createDshLocalIdentityBridge } from '../packages/tether-ui/src/hosts/dsh.js'

function context(origin) {
  let dispose
  const handlers = new Map()
  return {
    webServer: { getOrigin: () => origin },
    connection: {
      authenticatedUrl: (value) => `${value}/?auth=private-value`,
      rpc: { handle(channel, handler) {
        assert.equal(typeof handler, 'function')
        handlers.set(channel, handler)
        return () => Promise.resolve()
      } }
    },
    get: () => undefined,
    effect(register) { dispose = register() },
    handlers,
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
    assert.equal(published.profile, null)
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

test('local identity RPC is owner-only and resolves only one fresh live Node identity', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-dsh-owner-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const directory = path.join(home, 'storages', 'tether')
  fs.mkdirSync(directory, { recursive: true })
  const now = Date.now()
  const write = (pid, device_id, updated_at = now) => fs.writeFileSync(path.join(directory, `node-identity-${pid}.json`), JSON.stringify({ version: 1, pid, device_id, updated_at }))
  try {
    write(101, 'LAPTOP-01')
    assert.equal(internals.readLocalDeviceId({ directory, now, isPidAlive: () => true }), 'LAPTOP-01')
    write(202, 'DESKTOP-LOCAL')
    assert.equal(internals.readLocalDeviceId({ directory, now, isPidAlive: () => true }), null)
    fs.unlinkSync(path.join(directory, 'node-identity-202.json'))
    write(101, 'LAPTOP-01', now - 12001)
    assert.equal(internals.readLocalDeviceId({ directory, now, isPidAlive: () => true }), null)
    write(101, 'LAPTOP-01')
    const dead = internals.readLocalDeviceId({ directory, now, isPidAlive: () => false })
    assert.equal(dead, null)
    fs.rmSync(path.join(directory, 'node-identity-101.json'), { force: true })
    write(process.pid, 'LAPTOP-01')

    const ctx = context('http://127.0.0.1:3080')
    apply(ctx)
    const identity = ctx.handlers.get('/tether-identity')
    assert.equal(typeof identity, 'function')
    const denied = identity('get', {}, null, { principal: { kind: 'guest' } })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'forbidden')
    const allowed = identity('get', {}, null, { principal: { kind: 'owner' } })
    assert.deepEqual(allowed, { ok: true, value: { device_id: 'LAPTOP-01' } })
    assert.equal(JSON.stringify(allowed).includes('token'), false)
    const bridge = createDshLocalIdentityBridge(() => ({
      call: async (channel, action) => {
        assert.equal(channel, '/tether-identity')
        return identity(action, {}, null, { principal: { kind: 'owner' } })
      }
    }))
    assert.equal(await bridge(), 'LAPTOP-01')
    const deniedBridge = createDshLocalIdentityBridge(() => ({
      call: async (channel, action) => identity(action, {}, null, { principal: { kind: 'guest' } })
    }))
    assert.equal(await deniedBridge(), null)
    ctx.cleanup()
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
