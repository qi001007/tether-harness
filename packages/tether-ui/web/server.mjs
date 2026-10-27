import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const CORS = { 'access-control-allow-origin': 'dsh-app://app', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization, X-Tether-Token', vary: 'Origin' }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

export function createWebServer({ root = import.meta.dirname, controller = 'http://127.0.0.1:18890', port = 18891, host = '127.0.0.1', accessToken = '', insecureTls = false } = {}) {
  const target = new URL(controller)
  const here = root

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
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    if (req.url === '/api' || req.url.startsWith('/api/')) proxy(req, res)
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