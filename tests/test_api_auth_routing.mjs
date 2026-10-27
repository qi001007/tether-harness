import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchApiJson } from '../packages/tether-ui/src/app.js'
import { createDshHost } from '../packages/tether-ui/src/hosts/dsh.js'

function makeApi(host, fetch) {
  const apiBaseList = host.apiBases()
  const activeBase = apiBaseList[0]
  const api = async (path, options) => {
    const { data } = await fetchApiJson(path, options, {
      activeBase,
      apiBaseList,
      headersForBase: (base) => ({ 'Content-Type': 'application/json', ...host.apiHeaders(base) }),
      fetcher: fetch
    })
    return data
  }
  return { api }
}

function setHubConfig(value) {
  globalThis.window = { localStorage: { getItem: () => JSON.stringify(value) } }
}

test('without a Hub, local APP and Controller candidates receive no Authorization header', async () => {
  delete globalThis.window
  const host = createDshHost()
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.startsWith('http://127.0.0.1:18892')) throw new TypeError('APP unavailable')
    return { ok: true, json: async () => ({ ok: true }) }
  }
  const { api } = makeApi(host, fetch)

  assert.deepEqual(JSON.parse(JSON.stringify(await api('/api/state'))), { ok: true })
  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:18892/api/state',
    'http://127.0.0.1:18890/api/state'
  ])
  assert.ok(calls.every(({ init }) => !('Authorization' in init.headers)))
})

test('Hub token is sent only to the configured Hub, including after network fallback', async () => {
  setHubConfig({ url: 'https://hub.example/tether/', token: 'hub-secret' })
  const host = createDshHost()
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.startsWith('https://hub.example/tether')) throw new TypeError('Hub unavailable')
    return { ok: true, json: async () => ({ ok: true }) }
  }
  const { api } = makeApi(host, fetch)

  assert.deepEqual(JSON.parse(JSON.stringify(await api('/api/state'))), { ok: true })
  assert.equal(calls[0].init.headers.Authorization, 'Bearer hub-secret')
  assert.ok(calls.slice(1).every(({ init }) => !('Authorization' in init.headers)))
})

test('Hub status probe is pinned to the configured Hub and never falls back', async (t) => {
  setHubConfig({ url: 'https://hub.example/root/', token: 'probe-secret' })
  const previousFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ devices: [{ device_id: 'node-a', online: true }] }) }
  }
  t.after(() => { globalThis.fetch = previousFetch; delete globalThis.window })

  const host = createDshHost()
  assert.deepEqual(host.hubConfig(), { url: 'https://hub.example/root' })
  const result = await host.probeHub()
  assert.deepEqual(result.state, { devices: [{ device_id: 'node-a', online: true }] })
  assert.equal(Number.isFinite(result.durationMs), true)
  assert.ok(result.durationMs >= 0 && result.durationMs < 5000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://hub.example/root/api/state')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer probe-secret')
})

test('Hub status probe reports auth failure without contacting fallback bases', async (t) => {
  setHubConfig({ url: 'https://hub.example', token: 'probe-secret' })
  const previousFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: false, status: 401 }
  }
  t.after(() => { globalThis.fetch = previousFetch; delete globalThis.window })

  await assert.rejects(createDshHost().probeHub(), (error) => error.status === 401 && !error.message.includes('probe-secret'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://hub.example/api/state')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer probe-secret')
})

test('local identity prefers same-machine APP context, then owner Node identity, and never guesses', async (t) => {
  const previousFetch = globalThis.fetch
  const calls = []
  let context = { device: 'LAPTOP-01' }
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    if (context === null) throw new TypeError('APP unavailable')
    return { ok: true, json: async () => context }
  }
  t.after(() => { globalThis.fetch = previousFetch; delete globalThis.window })
  setHubConfig({ url: 'https://hub.example', token: 'hub-secret' })
  let ownerCalls = 0
  const host = createDshHost({ localDeviceIdentity: async () => { ownerCalls += 1; return 'DESKTOP-LOCAL' } })

  assert.equal(await host.localDeviceId(), 'LAPTOP-01')
  assert.equal(ownerCalls, 0)
  assert.equal(calls[0].url, 'http://127.0.0.1:18892/app-context')
  assert.equal('headers' in calls[0].init, false)

  context = null
  assert.equal(await host.localDeviceId(), 'DESKTOP-LOCAL')
  assert.equal(ownerCalls, 1)
  const unknown = createDshHost({ localDeviceIdentity: async () => null })
  assert.equal(await unknown.localDeviceId(), null)
})

test('Hub 401 and 403 responses remain terminal and do not trigger local fallback', async (t) => {
  setHubConfig({ url: 'https://hub.example', token: 'hub-secret' })
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      const host = createDshHost()
      const calls = []
      const fetch = async (url, init) => {
        calls.push({ url, init })
        return { ok: false, status, json: async () => ({ detail: 'auth failed' }) }
      }
      const { api } = makeApi(host, fetch)

      await assert.rejects(api('/api/state'), /auth failed/)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].init.headers.Authorization, 'Bearer hub-secret')
    })
  }
})
