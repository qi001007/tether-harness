import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createWebServer } from '../packages/tether-ui/web/server.mjs'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

test('APP web server routes the local device API, including the surface descriptor, to the local node', async () => {
  const seen = []
  const node = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ local: true, entries: [] }))
    })
  })
  const nodePort = await listen(node)
  const app = createWebServer({
    controller: 'http://127.0.0.1:9',
    port: 0,
    accessToken: 'hub-token',
    localApi: { device: 'DESKTOP-LOCAL', port: nodePort, token: 'local-token' }
  })
  const base = await app.listen()
  try {
    const local = await fetch(base + '/api/devices/DESKTOP-LOCAL/fs/list', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"D:\\\\"}'
    })
    assert.equal(local.status, 200)
    assert.equal(local.headers.get('x-tether-local'), '1')
    assert.deepEqual(await local.json(), { local: true, entries: [] })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].authorization, 'Bearer local-token')
    assert.equal(seen[0].url, '/api/devices/DESKTOP-LOCAL/fs/list')
    assert.equal(seen[0].body, '{"path":"D:\\\\"}')

    const workspaces = await fetch(base + '/api/devices/DESKTOP-LOCAL/workspaces')
    assert.equal(workspaces.status, 200)
    assert.equal(workspaces.headers.get('x-tether-local'), '1')

    const remote = await fetch(base + '/api/devices/OTHER/fs/list', { method: 'POST', body: '{}' })
    assert.equal(remote.status, 502)
    assert.equal(remote.headers.get('x-tether-local'), null)

    const surface = await fetch(base + '/api/devices/DESKTOP-LOCAL/dsh/surface')
    assert.equal(surface.status, 200)
    assert.equal(surface.headers.get('x-tether-local'), '1')
    assert.equal(seen.at(-1).url, '/api/devices/DESKTOP-LOCAL/dsh/surface')
    assert.equal(seen.length, 3)

    const foreignSurface = await fetch(base + '/api/devices/OTHER/dsh/surface')
    assert.equal(foreignSurface.status, 502)
    assert.equal(foreignSurface.headers.get('x-tether-local'), null)
  } finally {
    await app.close()
    await new Promise((resolve) => node.close(resolve))
  }
})

test('APP web server leaves all routes on the Hub when local API is not configured', async () => {
  const app = createWebServer({ controller: 'http://127.0.0.1:9', port: 0 })
  const base = await app.listen()
  try {
    const response = await fetch(base + '/api/devices/DESKTOP-LOCAL/fs/list', { method: 'POST', body: '{}' })
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('x-tether-local'), null)
  } finally {
    await app.close()
  }
})
