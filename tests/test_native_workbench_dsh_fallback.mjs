import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { SocksClient } = require('../apps/tether-app/node_modules/socks')
const { createNativeWorkbench } = require('../apps/tether-app/native-workbench.js')

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function fixture({ serviceId = 'dsh', dialError = new Error('connect ECONNREFUSED 10.224.0.2:52000'),
  openStatus = 200, badCa = false } = {}) {
  const requests = []
  const sessions = []
  const ca = 'test CA'
  const fingerprint = crypto.createHash('sha256').update(ca).digest('hex')
  const descriptor = {
    protocol: 1, target_id: 'target-1', id: serviceId, state: 'ready', transport: 'caddy-easytier',
    endpoint: 'https://10.224.0.2:52000/', network_id: 'network-1', grant_id: 'grant-1',
    lease_expires_at: Date.now() / 1000 + 120,
    bootstrap: { method: 'POST', url: 'https://10.224.0.2:52000/__tether/bootstrap',
      ticket: 'one-time', expires_at: Date.now() / 1000 + 60 },
    tls: { root_ca_pem: ca, root_ca_sha256: badCa ? '0'.repeat(64) : fingerprint,
      epoch: fingerprint.slice(0, 16) }
  }
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname
    requests.push({ path, method: options.method })
    if (path.endsWith('/fs/service_catalog')) return response(200, {
      protocol: 1, target_id: 'target-1', services: [{ id: serviceId, state: 'ready' }]
    })
    if (path.endsWith('/fs/service_open')) return response(openStatus, openStatus === 200
      ? descriptor : { detail: { code: 'forbidden' } })
    if (path.endsWith('/fs/service_revoke')) return response(204, null)
    if (path.endsWith('/dsh/surface')) return response(200, {
      available: true, url: 'https://g24001.controller.test/tether-connect?ticket=surface-one'
    })
    throw new Error('unexpected request: ' + path)
  }
  const getServiceSession = () => {
    const session = {
      setProxy: async () => {}, closeAllConnections: async () => {},
      clearStorageData: async () => {}, clearCache: async () => {},
      fetch: async () => { throw new Error('private bootstrap must not run after failed dial') },
      cookies: { get: async () => [{ name: '__Host-tether_test', httpOnly: true, secure: true,
        path: '/', domain: 'g24001.controller.test' }] }
    }
    sessions.push(session)
    return session
  }
  const workbench = createNativeWorkbench({
    controllerUrl: 'https://controller.test', loginSession: { fetch: fetcher }, getServiceSession,
    createBootstrapContents: () => {
      let url = ''
      return { contents: { session: sessions.at(-1), loadURL: async () => {
        url = 'https://g24001.controller.test/?tether_native=1'
      }, getURL: () => url, on: () => {}, stop: () => {} }, destroy: () => {} }
    },
    getActorId: async () => 'owner-1', getLocalDeviceId: async () => 'local-1',
    getSourceRoute: async () => ({ protocol: 1, state: 'ready', device_id: 'local-1',
      network_id: 'network-1', socks_proxy: { host: '127.0.0.1', port: 41000 } })
  })
  return { workbench, requests, sessions, dialError }
}

test('DSH uses a new authorized Surface session only after an unreachable private dial', async () => {
  const original = SocksClient.createConnection
  const state = fixture()
  SocksClient.createConnection = async () => { throw state.dialError }
  try {
    const opened = await state.workbench.open('target-1', 'dsh')
    assert.equal(opened.serviceId, 'dsh')
    assert.equal(opened.endpoint, 'https://g24001.controller.test/?tether_native=1')
    assert.equal(state.requests.filter((item) => item.path.endsWith('/dsh/surface')).length, 1)
    assert.equal(state.requests.filter((item) => item.path.endsWith('/fs/service_revoke')).length, 1)
    assert.equal(state.sessions.length, 2, 'the Surface uses a fresh isolated session')
    const guest = { session: state.sessions[1], getURL: () => opened.endpoint }
    assert.equal(state.workbench.guestPolicy(guest).serviceId, 'dsh-native')
    assert.equal(state.workbench.allowGuest(opened.partition, opened.endpoint), true)
    await state.workbench.close('target-1', 'dsh', opened.grantId)
  } finally {
    SocksClient.createConnection = original
  }
})

test('DSH authorization and certificate metadata failures do not request Surface', async () => {
  for (const options of [{ openStatus: 403 }, { badCa: true }]) {
    const state = fixture(options)
    await assert.rejects(state.workbench.open('target-1', 'dsh'))
    assert.equal(state.requests.some((item) => item.path.endsWith('/dsh/surface')), false)
  }
})

test('another service never uses DSH Surface when its private dial fails', async () => {
  const original = SocksClient.createConnection
  const state = fixture({ serviceId: 'herdr' })
  SocksClient.createConnection = async () => { throw state.dialError }
  try {
    await assert.rejects(state.workbench.open('target-1', 'herdr'))
    assert.equal(state.requests.some((item) => item.path.endsWith('/dsh/surface')), false)
  } finally {
    SocksClient.createConnection = original
  }
})

test('SOCKS authentication failure does not downgrade a DSH session', async () => {
  const original = SocksClient.createConnection
  const state = fixture({ dialError: new Error('Socks5 Authentication failed') })
  SocksClient.createConnection = async () => { throw state.dialError }
  try {
    await assert.rejects(state.workbench.open('target-1', 'dsh'))
    assert.equal(state.requests.some((item) => item.path.endsWith('/dsh/surface')), false)
  } finally {
    SocksClient.createConnection = original
  }
})

test('a SOCKS5 unreachable response is an eligible private dial failure', async () => {
  const original = SocksClient.createConnection
  const state = fixture({ dialError: new Error('Socks5 proxy rejected connection - HostUnreachable') })
  SocksClient.createConnection = async () => { throw state.dialError }
  try {
    const opened = await state.workbench.open('target-1', 'dsh')
    assert.equal(opened.serviceId, 'dsh')
    assert.equal(state.requests.some((item) => item.path.endsWith('/dsh/surface')), true)
    await state.workbench.close('target-1', 'dsh', opened.grantId)
  } finally {
    SocksClient.createConnection = original
  }
})

function modernFixture() {
  const requests = []
  const session = {
    setProxy: async () => {}, closeAllConnections: async () => {},
    clearStorageData: async () => {}, clearCache: async () => {},
    setCertificateVerifyProc: () => {},
    webRequest: { onBeforeRequest: () => {} },
    cookies: { get: async () => [] },
    fetch: async (url) => {
      const path = new URL(url).pathname
      requests.push({ path, method: 'POST' })
      return { ok: true, status: 204, json: async () => ({}) }
    }
  }
  const ca = 'test CA'
  const fingerprint = crypto.createHash('sha256').update(ca).digest('hex')
  const descriptor = {
    protocol: 1, target_id: 'target-1', id: 'dsh', state: 'ready', transport: 'caddy-easytier',
    endpoint: 'https://10.224.0.2:52000/', network_id: 'network-1', grant_id: 'grant-1',
    lease_expires_at: Date.now() / 1000 + 6 * 60,
    bootstrap: { method: 'POST', url: 'https://10.224.0.2:52000/__tether/bootstrap',
      ticket: 'one-time', expires_at: Date.now() / 1000 + 60 },
    tls: { root_ca_pem: ca, root_ca_sha256: fingerprint, epoch: fingerprint.slice(0, 16) }
  }
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname
    requests.push({ path, method: options.method, body: options.body })
    if (path.endsWith('/fs/service_catalog')) return response(200, {
      protocol: 1, target_id: 'target-1', services: [{ id: 'dsh', state: 'ready' }]
    })
    if (path.endsWith('/fs/service_open')) return response(200, descriptor)
    if (path.endsWith('/fs/service_renew')) return response(200, {
      grant_id: 'grant-1', state: 'ready', lease_expires_at: Date.now() / 1000 + 3600
    })
    if (path.endsWith('/fs/service_revoke') || path.endsWith('/fs/service_close')) return response(204, null)
    throw new Error('unexpected request: ' + path)
  }
  const workbench = createNativeWorkbench({
    controllerUrl: 'https://controller.test', loginSession: { fetch: fetcher },
    getServiceSession: () => session,
    createBootstrapContents: () => { throw new Error('unexpected DSH bootstrap') },
    getActorId: async () => 'owner-1', getLocalDeviceId: async () => 'local-1',
    getSourceRoute: async () => ({ protocol: 1, state: 'ready', device_id: 'local-1',
      network_id: 'network-1', socks_proxy: { host: '127.0.0.1', port: 41000 } })
  })
  return { workbench, requests, session }
}

function withFakePrivateTls(callback) {
  const original = SocksClient.createConnection
  const tls = require('node:tls')
  const originalConnect = tls.connect
  SocksClient.createConnection = async () => ({ socket: { destroy() {}, end() {}, on() {} } })
  tls.connect = () => {
    const listeners = {}
    return {
      setTimeout() {}, end() {}, destroy() {},
      once(event, listener) {
        if (event === 'secureConnect') setImmediate(() => listener())
        else listeners[event] = listener
        return this
      },
      getPeerCertificate() { return { raw: Buffer.from('leaf-cert') } }
    }
  }
  return Promise.resolve().then(callback).finally(() => {
    SocksClient.createConnection = original
    tls.connect = originalConnect
  })
}

test('a freshly attached webview on about:blank stays bound to its native mesh grant', async () => {
  await withFakePrivateTls(async () => {
    const state = modernFixture()
    const opened = await state.workbench.open('target-1', 'dsh')
    assert.equal(opened.serviceId, 'dsh')
    for (const guestUrl of ['', 'about:blank']) {
      const guest = { session: state.session, getURL: () => guestUrl }
      assert.equal(state.workbench.guestPolicy(guest).managed, true, 'pre-navigation guest must attach')
    }
    const navigated = { session: state.session, getURL: () => 'https://10.224.0.2:52000/chat' }
    assert.equal(state.workbench.guestPolicy(navigated).serviceId, 'dsh')
    const foreign = { session: state.session, getURL: () => 'https://evil.example/' }
    assert.throws(() => state.workbench.guestPolicy(foreign), /guest 与活动授权不匹配/)
    await state.workbench.close('target-1', 'dsh', opened.grantId)
  })
})

test('a hidden surface keeps its view heartbeat and renews the lease before expiry', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  await withFakePrivateTls(async () => {
    const state = modernFixture()
    const opened = await state.workbench.open('target-1', 'dsh')
    await state.workbench.view('target-1', 'dsh', false)
    const before = state.requests.filter((item) => item.path === '/__tether/view').length
    t.mock.timers.tick(60000)
    await new Promise((resolve) => setImmediate(resolve))
    const after = state.requests.filter((item) => item.path === '/__tether/view').length
    assert.ok(after > before, 'hidden view must still ping /__tether/view')
    assert.ok(state.requests.some((item) => item.path.endsWith('/fs/service_renew')),
      'lease inside the renewal window must be extended')
    await state.workbench.close('target-1', 'dsh', opened.grantId)
  })
})

test('the Hub DSH surface reuses one stable partition per actor, target, and generation', async () => {
  const original = SocksClient.createConnection
  SocksClient.createConnection = async () => { throw new Error('connect ECONNREFUSED 10.224.0.2:52000') }
  try {
    const state = fixture()
    const first = await state.workbench.open('target-1', 'dsh')
    assert.match(first.partition, /^persist:tether-wb-[a-f0-9]{40}$/)
    await state.workbench.close('target-1', 'dsh', first.grantId)
    const second = await state.workbench.open('target-1', 'dsh')
    assert.equal(second.partition, first.partition, 'reopen must not mint a random partition')
    await state.workbench.close('target-1', 'dsh', second.grantId)
  } finally {
    SocksClient.createConnection = original
  }
})
