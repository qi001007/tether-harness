import assert from 'node:assert/strict'
import test from 'node:test'
import { apiCandidatesForAuthority, assertCurrentAuthorityGeneration, fetchApiJson, fetchApiJsonForAuthority, nativeSurfaceAuthorityKey } from '../packages/tether-ui/src/app.js'
import { createDshHost } from '../packages/tether-ui/src/hosts/dsh.js'
import { createElectronHost } from '../packages/tether-ui/src/hosts/electron.js'

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

test('Electron login authority sends each selected account token only to its Hub', async () => {
  let saved = { url: 'https://hub.example', token: 'account-a-secret' }
  globalThis.window = { localStorage: { getItem: () => JSON.stringify(saved) } }
  const host = createElectronHost({ apiBase: 'http://127.0.0.1:18890' })
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization })
    return { ok: true, json: async () => ({ ok: true }) }
  }
  const request = () => fetchApiJson('/api/state', {}, {
    activeBase: host.apiBases()[0],
    apiBaseList: host.apiBases(),
    headersForBase: (base) => host.apiHeaders(base),
    fetcher
  })

  await request()
  saved = { url: 'https://hub.example', token: 'account-b-secret' }
  await request()
  saved = { url: 'https://other.example', token: 'account-b-secret' }
  await request()

  assert.deepEqual(calls, [
    { url: 'https://hub.example/api/state', authorization: 'Bearer account-a-secret' },
    { url: 'https://hub.example/api/state', authorization: 'Bearer account-b-secret' },
    { url: 'https://other.example/api/state', authorization: 'Bearer account-b-secret' }
  ])
  assert.deepEqual(host.apiBases(), ['https://other.example'])
  delete globalThis.window
})

test('Electron Hub probe verifies the newly selected account and keeps authorization failures terminal', async (t) => {
  const previousFetch = globalThis.fetch
  let saved = { url: 'https://hub-b.example', token: 'account-b-secret' }
  globalThis.window = { localStorage: { getItem: () => JSON.stringify(saved) } }
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization })
    return { ok: false, status: 401 }
  }
  t.after(() => { globalThis.fetch = previousFetch; delete globalThis.window })
  const host = createElectronHost({ apiBase: 'http://127.0.0.1:18890' })

  await assert.rejects(host.probeConnection('https://hub-b.example', 'account-b-secret'), (error) => error.status === 401)
  assert.deepEqual(calls, [{ url: 'https://hub-b.example/api/state', authorization: 'Bearer account-b-secret' }])
})

test('same-Hub account switch changes NativeSurface authority without exposing credentials', () => {
  const first = nativeSurfaceAuthorityKey('https://hub.example', 'https://hub.example', 'https://hub.example', 4)
  const second = nativeSurfaceAuthorityKey('https://hub.example', 'https://hub.example', 'https://hub.example', 5)
  assert.notEqual(first, second)
  assert.equal(first.includes('secret'), false)
})

test('ordinary network fallback retains other configured candidates while explicit login locks to the selected Hub', () => {
  const candidates = ['https://hub.example', 'http://127.0.0.1:18892', 'http://127.0.0.1:18890']
  assert.deepEqual(apiCandidatesForAuthority('http://127.0.0.1:18890', candidates), [
    'http://127.0.0.1:18890', 'https://hub.example', 'http://127.0.0.1:18892'
  ])
  assert.deepEqual(apiCandidatesForAuthority('https://hub.example', candidates, 'https://hub.example'), ['https://hub.example'])
})

test('network fallback does not lock later requests to the last successful local proxy', async () => {
  const bases = ['https://hub.example', 'http://127.0.0.1:18892', 'http://127.0.0.1:18890']
  let activeBase = bases[0]
  const calls = []
  const fetcher = async (url) => {
    calls.push(url)
    if (url.startsWith('https://hub.example') || url.startsWith('http://127.0.0.1:18892')) throw new TypeError('unavailable')
    return { ok: true, json: async () => ({ ok: true }) }
  }
  const first = await fetchApiJson('/api/state', {}, {
    activeBase, apiBaseList: apiCandidatesForAuthority(activeBase, bases), fetcher
  })
  activeBase = first.base
  assert.equal(activeBase, 'http://127.0.0.1:18890')
  calls.length = 0
  const second = await fetchApiJson('/api/state', {}, {
    activeBase, apiBaseList: apiCandidatesForAuthority(activeBase, bases),
    fetcher: async (url) => {
      calls.push(url)
      if (url.startsWith('http://127.0.0.1:18890')) throw new TypeError('unavailable')
      return { ok: true, json: async () => ({ ok: true }) }
    }
  })
  assert.equal(second.base, 'https://hub.example')
  assert.deepEqual(calls, ['http://127.0.0.1:18890/api/state', 'https://hub.example/api/state'])
})

test('late API results from an earlier authority generation are rejected before state consumers receive them', async () => {
  let generation = 7
  let resolveFetch
  const request = fetchApiJsonForAuthority('/api/state', {}, {
    activeBase: 'https://hub-a.example',
    apiBaseList: ['https://hub-a.example'],
    fetcher: () => new Promise((resolve) => { resolveFetch = resolve })
  }, generation, () => generation)
  generation = 8
  resolveFetch({ ok: true, json: async () => ({ devices: [{ device_id: 'old-account-device' }] }) })
  await assert.rejects(request, (error) => error.code === 'authority_changed')
  assert.throws(() => assertCurrentAuthorityGeneration(7, 8), (error) => error.code === 'authority_changed')
  assert.doesNotThrow(() => assertCurrentAuthorityGeneration(8, 8))
})
