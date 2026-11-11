import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { getLocalMeshRoute, waitForLocalNodeApi, waitForSupervisorStart } from '../apps/tether-app/startup-readiness.js'

test('APP waits for supervisor startup with a bound', async () => {
  const started = await waitForSupervisorStart(Promise.resolve({ mode: 'hub' }), 100)
  assert.deepEqual(started, { completed: true, state: { mode: 'hub' } })

  const timedOut = await waitForSupervisorStart(new Promise(() => {}), 10)
  assert.deepEqual(timedOut, { completed: false, state: null })

  const rejected = await waitForSupervisorStart(Promise.reject(new Error('startup failed')), 100)
  assert.equal(rejected.completed, true)
  assert.equal(rejected.state, null)
  assert.match(rejected.error.message, /startup failed/)
})

test('APP waits for the configured local node read route and token before loading', async (t) => {
  let ready = false
  let observed = null
  const server = http.createServer((req, res) => {
    observed = { method: req.method, path: req.url, authorization: req.headers.authorization }
    res.writeHead(ready && req.headers.authorization === 'Bearer one-run-token' ? 200 : 401)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  setTimeout(() => { ready = true }, 25)
  const result = await waitForLocalNodeApi({
    port: server.address().port,
    device: 'DESKTOP LOCAL',
    token: 'one-run-token'
  }, { timeoutMs: 500, retryMs: 5 })

  assert.equal(result, true)
  assert.deepEqual(observed, {
    method: 'GET',
    path: '/api/devices/DESKTOP%20LOCAL/policy',
    authorization: 'Bearer one-run-token'
  })
})

test('APP readiness timeout is bounded and does not report unavailable API as ready', async () => {
  const started = Date.now()
  const result = await waitForLocalNodeApi({ port: 1, device: 'DESKTOP-LOCAL', token: 'one-run-token' }, {
    timeoutMs: 40,
    retryMs: 5
  })
  assert.equal(result, false)
  assert.ok(Date.now() - started < 500)
})

test('external local mesh bridge authenticates the configured device before returning its route', async (t) => {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, authorization: req.headers.authorization })
    const ok = req.headers.authorization === 'Bearer ' + 'x'.repeat(40)
      && req.url.startsWith('/api/devices/DEVICE-A/')
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' })
    if (req.url.endsWith('/policy')) res.end('{}')
    else res.end(JSON.stringify({ device_id: 'DEVICE-A', network_id: '12345678-1234-1234-1234-123456789abc',
      state: 'ready', socks_proxy: { host: '127.0.0.1', port: 32123 } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const port = server.address().port
  const route = await getLocalMeshRoute({ port, device: 'DEVICE-A', token: 'x'.repeat(40),
    networkId: '12345678-1234-1234-1234-123456789abc' })
  assert.equal(route.socks_proxy.port, 32123)
  assert.deepEqual(requests.map(({ path }) => path), [
    '/api/devices/DEVICE-A/policy',
    '/api/devices/DEVICE-A/mesh/12345678-1234-1234-1234-123456789abc/route'
  ])
  await assert.rejects(getLocalMeshRoute({ port, device: 'DEVICE-B', token: 'x'.repeat(40),
    networkId: '12345678-1234-1234-1234-123456789abc' }), /local mesh route unavailable/)
  await assert.rejects(getLocalMeshRoute({ port, device: 'DEVICE-A', token: 'wrong-token',
    networkId: '12345678-1234-1234-1234-123456789abc' }), /local mesh route unavailable/)
})

test('mesh route response for a different device fails closed', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(req.url.endsWith('/policy') ? '{}' : JSON.stringify({ device_id: 'OTHER',
      network_id: '12345678123412341234123456789abc', state: 'ready',
      socks_proxy: { host: '127.0.0.1', port: 32123 } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  await assert.rejects(getLocalMeshRoute({ port: server.address().port, device: 'DEVICE-A',
    token: 'x'.repeat(40), networkId: '12345678-1234-1234-1234-123456789abc' }), /local mesh route unavailable/)
})
