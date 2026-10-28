import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { waitForLocalNodeApi, waitForSupervisorStart } from '../apps/tether-app/startup-readiness.js'

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
