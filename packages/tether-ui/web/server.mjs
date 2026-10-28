import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const CORS = { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization, X-Tether-Token', vary: 'Origin' }
const ORIGIN_OK = (origin) => origin === 'dsh-app://app' || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin || '')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

export function createWebServer({ root = import.meta.dirname, controller = 'http://127.0.0.1:18890', port = 18891, host = '127.0.0.1', accessToken = '', insecureTls = false, device = '', hub = false, localApi = null, connectionInfo, probeConnection } = {}) {
  const target = new URL(controller)
  const here = root
  const localDevice = localApi && localApi.device ? String(localApi.device) : ''
  const localPort = localApi && Number(localApi.port) ? Number(localApi.port) : 0
  const localToken = (localApi && localApi.token) || ''
  const LOCAL_ROUTES = ['/fs/', '/workspaces', '/drives', '/policy', '/audit', '/dsh/sessions', '/dsh/workspaces/register']
  const isLocalDeviceApi = (url) => {
    if (!localDevice || !localPort) return false
    const pathname = url.split('?')[0]
    const prefix = '/api/devices/' + encodeURIComponent(localDevice)
    if (!pathname.startsWith(prefix + '/')) return false
    const rest = pathname.slice(prefix.length)
    return LOCAL_ROUTES.some((route) => route.endsWith('/') ? rest.startsWith(route) : (rest === route || rest.startsWith(route + '/')))
  }

  const proxy = (req, res) => {
    const headers = { ...req.headers, host: target.host }
    if (accessToken) headers.authorization = 'Bearer ' + accessToken
    const client = target.protocol === 'https:' ? https : http
    const upstream = client.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: req.url,
      method: req.method,
      headers,
      rejectUnauthorized: target.protocol === 'https:' ? !insecureTls : undefined
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    })
    upstream.on('error', (error) => {
      if (res.headersSent) { res.end(); return }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ detail: { error: 'Tether controller unreachable: ' + error.message } }))
    })
    req.pipe(upstream)
  }

  const proxyLocal = (req, res) => {
    const upstream = http.request({
      hostname: '127.0.0.1', port: 18890,
      path: req.url.replace(/^\/local-api/, '') || '/',
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:18890' }
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    })
    upstream.on('error', (error) => {
      if (res.headersSent) { res.end(); return }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ detail: { error: 'local controller unreachable: ' + error.message } }))
    })
    req.pipe(upstream)
  }

  const proxyLocalNode = (req, res) => {
    const headers = { ...req.headers, host: '127.0.0.1:' + localPort }
    if (localToken) headers.authorization = 'Bearer ' + localToken
    const upstream = http.request({
      hostname: '127.0.0.1', port: localPort,
      path: req.url,
      method: req.method,
      headers
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, { ...upstreamRes.headers, 'x-tether-local': '1' })
      upstreamRes.pipe(res)
    })
    upstream.on('error', (error) => {
      if (res.headersSent) { res.end(); return }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'x-tether-local': '1' })
      res.end(JSON.stringify({ detail: { error: 'local node unreachable: ' + error.message, code: 'local_unreachable' } }))
    })
    req.pipe(upstream)
  }

  const serveStatic = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const file = path.join(here, path.normalize(relative).replace(/^([/\\])+/, ''))
    if (!file.startsWith(here + path.sep) && file !== path.join(here, 'index.html')) {
      res.writeHead(403).end('forbidden')
      return
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found: ' + relative); return }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(data)
    })
  }

  const server = http.createServer((req, res) => {
    for (const [key, value] of Object.entries(CORS)) res.setHeader(key, value)
    const origin = req.headers.origin
    if (ORIGIN_OK(origin)) res.setHeader('access-control-allow-origin', origin)
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    if (req.url === '/app-context') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ device, hub, ...(connectionInfo ? connectionInfo() : {}) }))
      return
    }
    if (req.url === '/connection-probe' && req.method === 'GET' && probeConnection) {
      Promise.resolve(probeConnection()).then((value) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(value))
      }).catch(() => {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'connection probe failed' }))
      })
      return
    }
    if (req.url.startsWith('/local-api/')) proxyLocal(req, res)
    else if (isLocalDeviceApi(req.url)) proxyLocalNode(req, res)
    else if (req.url === '/api' || req.url.startsWith('/api/')) proxy(req, res)
    else serveStatic(req, res)
  })

  return {
    server,
    port,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        const actual = server.address().port
        resolve('http://' + host + ':' + actual)
      })
    }),
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
