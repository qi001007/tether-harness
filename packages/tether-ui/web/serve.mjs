import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const port = Number(process.env.TETHER_WEB_PORT || 18891)
const target = new URL(process.env.TETHER_CONTROLLER || 'http://127.0.0.1:18890')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

function proxy(req, res) {
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: target.host }
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ detail: { error: 'Tether controller unreachable: ' + error.message } }))
  })
  req.pipe(upstream)
}

function serveStatic(req, res) {
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

http.createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) proxy(req, res)
  else serveStatic(req, res)
}).listen(port, '127.0.0.1', () => {
  console.log('Tether WebUI http://127.0.0.1:' + port + '  api -> ' + target.origin)
})