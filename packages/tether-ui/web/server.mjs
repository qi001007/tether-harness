import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const CORS = { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization, X-Tether-Token', vary: 'Origin' }
const ORIGIN_OK = (origin) => origin === 'dsh-app://app' || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin || '')
const PROXY_COOKIE = 'tether_proxy'
const API_PREFIXES = ['/api/state', '/api/sessions', '/api/runs', '/api/events', '/api/devices', '/api/releases']

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

export function createWebServer({ root = import.meta.dirname, controller = 'http://127.0.0.1:18890', port = 18891, host = '127.0.0.1', accessToken = '', insecureTls = false, device = '', hub = false, localApi = null, connectionInfo, probeConnection } = {}) {
  const target = new URL(controller)
  const here = root
  const localDevice = localApi && localApi.device ? String(localApi.device) : ''
  const localPort = localApi && Number(localApi.port) ? Number(localApi.port) : 0
  const localToken = (localApi && localApi.token) || ''
  const proxyToken = crypto.randomBytes(32).toString('hex')
  const realRoot = fs.realpathSync(here)
  const cookieToken = (req) => {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [name, ...rest] = part.trim().split('=')
      if (name === PROXY_COOKIE) return rest.join('=')
    }
    return ''
  }
  const proxyAuthorized = (req) => {
    const token = cookieToken(req)
    return !!token && token.length === proxyToken.length
      && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(proxyToken))
  }
  const sameOrigin = (req, origin) => {
    try {
      const parsed = new URL(String(origin))
      return parsed.protocol === 'http:' && parsed.host === String(req.headers.host || '')
    } catch (_) { return false }
  }
  const setProxyCookie = (res) => {
    res.setHeader('set-cookie', PROXY_COOKIE + '=' + proxyToken
      + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800')
  }
  const reject = (res, status, code, message) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ detail: { error: message, code } }))
  }
  const apiPathAllowed = (url) => {
    const pathname = String(url || '').split('?')[0]
    return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))
  }
  const LOCAL_ROUTES = ['/fs/', '/workspaces', '/drives', '/policy', '/audit', '/dsh/sessions', '/dsh/surface', '/dsh/workspaces/register']
  const isLocalDeviceApi = (url) => {
    if (!localDevice || !localPort) return false
    let parsed
    try { parsed = new URL(url, 'http://localhost') } catch (_) { return false }
    if (parsed.searchParams.get('via') === 'hub') return false
    const pathname = url.split('?')[0]
    const prefix = '/api/devices/' + encodeURIComponent(localDevice)
    if (!pathname.startsWith(prefix + '/')) return false
    const rest = pathname.slice(prefix.length)
    return LOCAL_ROUTES.some((route) => route.endsWith('/') ? rest.startsWith(route) : (rest === route || rest.startsWith(route + '/')))
  }

  const proxy = (req, res) => {
    const headers = { ...req.headers, host: target.host }
    delete headers.cookie
    delete headers['x-tether-proxy-token']
    if (accessToken && !headers.authorization) headers.authorization = 'Bearer ' + accessToken
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
    const headers = { ...req.headers, host: '127.0.0.1:18890' }
    delete headers.cookie
    delete headers['x-tether-proxy-token']
    const upstream = http.request({
      hostname: '127.0.0.1', port: 18890,
      path: req.url.replace(/^\/local-api/, '') || '/',
      method: req.method,
      headers
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
    delete headers.cookie
    delete headers['x-tether-proxy-token']
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
    let relative
    try {
      const url = new URL(req.url, 'http://localhost')
      relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    } catch (_) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad request')
      return
    }
    if (relative.includes('\0')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad request')
      return
    }
    const file = path.join(here, path.normalize(relative).replace(/^([/\\])+/, ''))
    if (!file.startsWith(here + path.sep) && file !== path.join(here, 'index.html')) {
      res.writeHead(403).end('forbidden')
      return
    }
    fs.realpath(file, (realError, realFile) => {
      if (realError) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found'); return }
      if (!realFile.startsWith(realRoot + path.sep) && realFile !== path.join(realRoot, 'index.html')) {
        res.writeHead(403).end('forbidden')
        return
      }
      fs.readFile(realFile, (error, data) => {
        if (error) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found'); return }
        if (path.extname(realFile) === '.html') setProxyCookie(res)
        res.writeHead(200, { 'content-type': TYPES[path.extname(realFile)] || 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(data)
      })
    })
  }

  const server = http.createServer((req, res) => {
    for (const [key, value] of Object.entries(CORS)) res.setHeader(key, value)
    const origin = req.headers.origin
    if (ORIGIN_OK(origin)) res.setHeader('access-control-allow-origin', origin)
    if (req.method === 'OPTIONS') {
      if (origin && !sameOrigin(req, origin)) { res.writeHead(403).end(); return }
      res.writeHead(204).end(); return
    }
    const proxyRoute = req.url.startsWith('/local-api/') || isLocalDeviceApi(req.url)
      || req.url === '/api' || req.url.startsWith('/api/')
    if (proxyRoute) {
      if (!proxyAuthorized(req)) { reject(res, 401, 'proxy_auth_required', 'local proxy session required'); return }
      if (origin && !sameOrigin(req, origin)) { reject(res, 403, 'origin_denied', 'cross-origin request denied'); return }
      if (!['GET', 'HEAD'].includes(req.method) && !origin) {
        reject(res, 403, 'origin_required', 'origin required for state-changing requests'); return
      }
      if ((req.url === '/api' || req.url.startsWith('/api/')) && !apiPathAllowed(req.url)) {
        reject(res, 403, 'path_denied', 'api path is not allowed through the local proxy'); return
      }
    }
    if (req.url === '/app-context') {
      setProxyCookie(res)
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
