'use strict'

const crypto = require('node:crypto')
const net = require('node:net')
const os = require('node:os')
const tls = require('node:tls')
const { X509Certificate } = require('node:crypto')
const { SocksClient } = require('socks')

const SERVICE_IDS = new Set(['dsh', 'codeg', 'herdr', 'files', 'desktop'])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizedFingerprint(value) {
  return String(value || '').replace(/^sha256[:=]/i, '').replace(/[^a-f0-9]/gi, '').toLowerCase()
}

function expiryMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000
  const text = String(value || '')
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000
  return Date.parse(text)
}

function apiUrl(base, targetId, operation) {
  return new URL('/api/devices/' + encodeURIComponent(targetId) + '/fs/' + operation, base).toString()
}

function strictLegacyCodegUrl(value) {
  if (typeof value !== 'string') return null
  const match = /^http:\/\/((?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}):([1-9]\d{0,4})\/token\.html\?token=([^&#]+)$/.exec(value)
  if (!match || match[1].split('.').some((part) => Number(part) > 255) || Number(match[2]) > 65535) return null
  let parsed
  try { parsed = new URL(value) } catch (_) { return null }
  const effectivePort = parsed.port || (parsed.protocol === 'http:' ? '80' : '')
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.hash
      || parsed.hostname !== match[1] || effectivePort !== match[2]
      || parsed.pathname !== '/token.html' || [...parsed.searchParams.keys()].length !== 1
      || !parsed.searchParams.get('token')) return null
  return parsed
}

function legacyCodegService(status, targetId) {
  const base = { id: 'codeg', agent_busy: false, view_only_reason: '', updated_at: null,
    legacy: true }
  if (!status || typeof status !== 'object' || Array.isArray(status)
      || (status.device_id && status.device_id !== targetId)) {
    return { ...base, state: 'failed', reason: '旧节点返回了无效的 Codeg 状态。', reason_code: 'legacy_status_invalid' }
  }
  if (status.running === true) {
    if (status.installed === true && strictLegacyCodegUrl(status.url)) {
      return { ...base, state: 'ready', reason: '', reason_code: '', open_mode: 'legacy-codeg' }
    }
    return { ...base, state: 'failed', reason: '旧节点 Codeg 运行状态不一致。', reason_code: 'legacy_status_invalid' }
  }
  if (status.running !== false) {
    return { ...base, state: 'failed', reason: '旧节点返回了无效的 Codeg 状态。', reason_code: 'legacy_status_invalid' }
  }
  if (status.installed === false) {
    return { ...base, state: 'missing', reason: '目标节点未安装 Codeg。', reason_code: 'legacy_codeg_missing' }
  }
  if (status.installed === true) {
    return { ...base, state: 'stopped', reason: '目标节点 Codeg 已停止。', reason_code: 'legacy_codeg_stopped' }
  }
  return { ...base, state: 'failed', reason: '旧节点返回了无效的 Codeg 状态。', reason_code: 'legacy_status_invalid' }
}

function ipv4Number(value) {
  if (!net.isIPv4(value)) return null
  return value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0)
}

function isPrivateIPv4(value) {
  const ip = ipv4Number(value)
  if (ip === null) return false
  const first = ip >>> 24
  const second = (ip >>> 16) & 255
  return first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function hasLocalEasyTierRoute(targetHost) {
  const target = ipv4Number(targetHost)
  if (target === null || !isPrivateIPv4(targetHost)) return false
  return Object.entries(os.networkInterfaces()).some(([name, interfaces]) => /^et[_-]|easytier/i.test(name)
    && Array.isArray(interfaces) && interfaces.some((item) => {
      if (!item || item.internal || !(item.family === 'IPv4' || item.family === 4)
          || !isPrivateIPv4(item.address)) return false
      const address = ipv4Number(item.address)
      const mask = ipv4Number(item.netmask)
      return address !== null && mask !== null && (address & mask) === (target & mask)
    }))
}

async function postJson(fetcher, url, body, { signal } = {}) {
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
    redirect: 'error'
  }
  if (signal) request.signal = signal
  const response = await fetcher(url, request)
  if (!response.ok) {
    const error = new Error('服务授权请求失败（HTTP ' + response.status + '）')
    error.status = response.status
    try {
      const payload = await response.json()
      const detail = payload && payload.detail
      if (detail && typeof detail === 'object' && typeof detail.code === 'string') error.code = detail.code
    } catch (_) { /* preserve only a structured error code */ }
    throw error
  }
  return response.status === 204 ? null : response.json()
}

const FILE_OPERATIONS = new Set(['list', 'drives', 'workspaces', 'stat', 'fingerprint', 'preview',
  'preview_content', 'mkdir', 'rename', 'delete', 'copy', 'content_get', 'content_put'])
const TEXT_ENCODINGS = new Set(['utf-8', 'utf-8-bom', 'utf-16-le', 'utf-16-be', 'gb18030'])
const NEWLINE_MODES = new Set(['lf', 'crlf', 'cr'])

function bytesFromRequest(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return null
}

function verifyEndpoint(descriptor, targetId, serviceId) {
  if (!descriptor || descriptor.protocol !== 1 || descriptor.target_id !== targetId || descriptor.id !== serviceId
      || descriptor.state !== 'ready' || descriptor.transport !== 'caddy-easytier') {
    throw new Error((descriptor && descriptor.reason) || '目标服务尚未就绪或授权失败。')
  }
  const endpoint = new URL(descriptor.endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash
      || (serviceId !== 'desktop' && endpoint.search)
      || (serviceId !== 'desktop' && endpoint.pathname !== '/')) throw new Error('服务端返回的工作台 origin 无效。')
  if (serviceId === 'desktop') {
    const query = new URLSearchParams(endpoint.search)
    if (!['/sharing', '/default/sharing'].includes(endpoint.pathname) || !query.get('c')) {
      throw new Error('服务端返回的远程桌面 guest 页面无效。')
    }
    if (!['prompt', 'none'].includes(descriptor.consent) || typeof descriptor.view_only !== 'boolean') {
      throw new Error('服务端返回的远程桌面授权状态无效。')
    }
    if (!Number.isFinite(expiryMillis(descriptor.native_session_expires_at))
        || expiryMillis(descriptor.native_session_expires_at) <= Date.now()) {
      throw new Error('远程桌面会话缺少有效的到期时间。')
    }
  }
  const origin = new URL('/', endpoint)
  const bootstrap = descriptor.bootstrap
  const bootstrapUrl = bootstrap && new URL(bootstrap.url)
  if (!bootstrap || bootstrap.method !== 'POST' || !bootstrap.ticket || !bootstrap.expires_at
      || !bootstrapUrl || bootstrapUrl.origin !== origin.origin || bootstrapUrl.pathname !== '/__tether/bootstrap') {
    throw new Error('服务端没有提供有效的一次性工作台 bootstrap。')
  }
  if (!Number.isFinite(expiryMillis(bootstrap.expires_at)) || expiryMillis(bootstrap.expires_at) <= Date.now()) {
    throw new Error('工作台 bootstrap 票据已过期。')
  }
  const caPem = descriptor.tls && descriptor.tls.root_ca_pem
  const expectedCa = normalizedFingerprint(descriptor.tls && descriptor.tls.root_ca_sha256)
  if (!caPem || !expectedCa) throw new Error('服务端缺少工作台 TLS 信任信息。')
  const actualCa = sha256(Buffer.from(caPem, 'utf8'))
  if (actualCa !== expectedCa) throw new Error('工作台 TLS 根证书指纹不匹配。')
  if (String(descriptor.tls.epoch || '') !== actualCa.slice(0, 16)) throw new Error('工作台 TLS 信任版本与根证书不匹配。')
  if (typeof descriptor.network_id !== 'string' || !descriptor.network_id) {
    throw new Error('服务端没有提供可信网络标识。')
  }
  return { endpoint, origin, bootstrapUrl, caPem, epoch: descriptor.tls.epoch,
    networkId: descriptor.network_id,
    nativeSessionExpiresAt: serviceId === 'desktop' ? expiryMillis(descriptor.native_session_expires_at) : null }
}

function validateSourceRoute(route, networkId, sourceDeviceId) {
  const proxy = route && route.socks_proxy
  if (!route || route.protocol !== 1 || route.state !== 'ready'
      || route.network_id !== networkId || route.device_id !== sourceDeviceId
      || !proxy || proxy.host !== '127.0.0.1' || !Number.isInteger(proxy.port)
      || proxy.port < 1 || proxy.port > 65535) {
    throw new Error('本机没有就绪的目标网络 SOCKS 路由。')
  }
  return { host: proxy.host, port: proxy.port }
}

async function verifyMeshCertificate(endpoint, caPem, proxy, expectedLeaf) {
  const peer = await new Promise((resolve, reject) => {
    const port = Number(endpoint.port || 443)
    let secureSocket = null
    let settled = false
    const timeout = setTimeout(() => {
      if (secureSocket) secureSocket.destroy(new Error('工作台 TLS 握手超时。'))
      finish(reject, new Error('工作台 SOCKS/TLS 连接超时。'))
    }, 5000)
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }
    SocksClient.createConnection({
      proxy: { host: proxy.host, port: proxy.port, type: 5 },
      command: 'connect',
      destination: { host: endpoint.hostname, port },
      timeout: 5000
    }).then(({ socket }) => {
      if (settled) { socket.destroy(); return }
      try {
        secureSocket = tls.connect({ socket, host: endpoint.hostname,
          servername: net.isIP(endpoint.hostname) ? undefined : endpoint.hostname,
          ca: caPem, rejectUnauthorized: true })
        secureSocket.setTimeout(5000, () => secureSocket.destroy(new Error('工作台 TLS 握手超时。')))
        secureSocket.once('secureConnect', () => {
          const certificate = secureSocket.getPeerCertificate(true)
          secureSocket.end()
          finish(resolve, certificate)
        })
        secureSocket.once('error', (error) => finish(reject, error))
      } catch (error) {
        socket.destroy()
        finish(reject, error)
      }
    }).catch((error) => finish(reject, error))
  })
  if (!peer || !peer.raw) throw new Error('工作台没有返回有效 TLS 证书。')
  const current = sha256(peer.raw)
  if (expectedLeaf && current !== expectedLeaf) throw new Error('工作台 TLS 证书与当前握手不匹配。')
  return current
}

function installCertificatePin(serviceSession, endpoint, caPem, proxy) {
  const expectedHost = endpoint.hostname.toLowerCase()
  serviceSession.setCertificateVerifyProc((request, callback) => {
    try {
      if (String(request.hostname || '').toLowerCase() !== expectedHost) {
        callback(-3)
        return
      }
      if (!request.certificate || !request.certificate.data) {
        callback(-2)
        return
      }
      const actual = sha256(new X509Certificate(request.certificate.data).raw)
      void verifyMeshCertificate(endpoint, caPem, proxy, actual).then(() => callback(0), () => callback(-2))
    } catch (_) {
      callback(-2)
    }
  })
  serviceSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let allowed = false
    try {
      const url = new URL(details.url)
      const origin = new URL(endpoint.origin)
      allowed = ['https:', 'wss:'].includes(url.protocol) && url.hostname === origin.hostname && url.port === origin.port
    } catch (_) { /* reject invalid URLs */ }
    callback({ cancel: !allowed })
  })
}

function installLegacyOriginGuard(serviceSession, endpoint) {
  if (!serviceSession.webRequest || typeof serviceSession.webRequest.onBeforeRequest !== 'function') {
    throw new Error('Electron 服务请求隔离不可用。')
  }
  serviceSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let allowed = false
    try {
      const target = new URL(details.url)
      allowed = !target.username && !target.password && !target.hash
        && ['http:', 'ws:'].includes(target.protocol)
        && target.hostname === endpoint.hostname && target.port === endpoint.port
    } catch (_) { /* reject invalid URLs */ }
    callback({ cancel: !allowed })
  })
}

async function configureSocksProxy(serviceSession, proxy) {
  if (!serviceSession || typeof serviceSession.setProxy !== 'function') throw new Error('Electron SOCKS 服务隔离不可用。')
  await serviceSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: 'socks5://' + proxy.host + ':' + proxy.port,
    proxyBypassRules: '<-loopback>'
  })
}

async function resetServiceSession(serviceSession) {
  if (!serviceSession) return
  if (typeof serviceSession.closeAllConnections === 'function') await serviceSession.closeAllConnections()
  if (typeof serviceSession.setProxy === 'function') await serviceSession.setProxy({ mode: 'direct' })
}

function createNativeWorkbench({ controllerUrl, loginSession, getServiceSession, createBootstrapContents, getActorId, getLocalDeviceId, getSourceRoute, logSafe = () => {} }) {
  if (!controllerUrl || !loginSession || typeof loginSession.fetch !== 'function'
      || typeof getServiceSession !== 'function' || typeof createBootstrapContents !== 'function' || typeof getActorId !== 'function'
      || typeof getLocalDeviceId !== 'function' || typeof getSourceRoute !== 'function') {
    throw new TypeError('native workbench requires trusted Controller/session access from Electron main')
  }
  const base = new URL(controllerUrl).origin
  const trustedControllerHost = new URL(controllerUrl).hostname
  const active = new Map()
  const pending = new Map()
  const operationIds = new Map()
  const actorGenerations = new Map()
  const incompatibleCatalogs = new Map()
  const managedSessions = new WeakSet()
  const clearingActors = new Set()
  const revocationFailures = new Set()
  const tupleKey = (actorId, targetId, serviceId) => [actorId, targetId, serviceId].join('\u0000')

  async function openDshSurface(targetId) {
    if (typeof targetId !== 'string' || !targetId || targetId.length > 200) throw new TypeError('invalid target')
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    const key = tupleKey(actorId, targetId, 'dsh-native')
    const generation = actorGenerations.get(actorId) || 0
    const activeRecord = active.get(key)
    if (activeRecord) await close(targetId, 'dsh-native', activeRecord.grantId)
    const response = await loginSession.fetch(new URL('/api/devices/' + encodeURIComponent(targetId) + '/dsh/surface', base).toString(), {
      method: 'GET', headers: { 'Cache-Control': 'no-store' }, redirect: 'error'
    })
    if (!response.ok) throw new Error('DSH surface 授权失败（HTTP ' + response.status + '）。')
    const descriptor = await response.json()
    let ticketUrl
    try { ticketUrl = new URL(descriptor && (descriptor.url || descriptor.endpoint)) } catch (_) { throw new Error('Hub 返回了无效的 DSH gateway。') }
    const expectedHost = new RegExp('^g([1-9]\\d{0,4})\\.' + trustedControllerHost.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '$', 'i')
    const gatewayMatch = expectedHost.exec(ticketUrl.hostname)
    const ticketEntries = [...ticketUrl.searchParams.entries()]
    if (!descriptor || descriptor.available !== true || ticketUrl.protocol !== 'https:' || ticketUrl.username || ticketUrl.password
        || ticketUrl.hash || ticketUrl.port || !gatewayMatch || Number(gatewayMatch[1]) > 65535
        || ticketUrl.pathname !== '/tether-connect' || ticketEntries.length !== 1 || ticketEntries[0][0] !== 'ticket'
        || !ticketEntries[0][1]) throw new Error('Hub 返回了无效的 DSH gateway。')
    const partition = 'persist:tether-wb-' + crypto.randomBytes(20).toString('hex')
    const serviceSession = getServiceSession(partition)
    if (!serviceSession || !serviceSession.cookies || typeof serviceSession.cookies.get !== 'function') {
      throw new Error('Electron 服务隔离会话不可用。')
    }
    managedSessions.add(serviceSession)
    let bootstrap = null
    let bootstrapStage = 'create-bootstrap'
    const destroyBootstrap = () => {
      if (!bootstrap) return
      const current = bootstrap
      bootstrap = null
      try { current.destroy() } catch (_) { /* hidden bootstrap may already be gone */ }
    }
    try {
      bootstrap = createBootstrapContents(partition)
      const contents = bootstrap && bootstrap.contents
      if (!contents || contents.session !== serviceSession || typeof contents.loadURL !== 'function'
          || typeof contents.getURL !== 'function' || typeof contents.on !== 'function'
          || typeof contents.stop !== 'function' || typeof bootstrap.destroy !== 'function') {
        throw new Error('invalid bootstrap contents')
      }
      bootstrapStage = 'navigate-bootstrap'
      let blocked = false
      const allowsOrigin = (value) => {
        try { return new URL(String(value)).origin === ticketUrl.origin } catch (_) { return false }
      }
      const block = (event) => {
        blocked = true
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        contents.stop()
      }
      contents.on('will-navigate', (event, url) => { if (!allowsOrigin(url)) block(event) })
      contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false && !allowsOrigin(url)) block(event)
      })
      contents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false && !allowsOrigin(url)) block()
      })
      await contents.loadURL(ticketUrl.toString())
      if (blocked) throw new Error('blocked bootstrap navigation')
      bootstrapStage = 'validate-endpoint'
      let endpoint
      try { endpoint = new URL(contents.getURL()) } catch (_) { throw new Error('invalid bootstrap endpoint') }
      const endpointQuery = [...endpoint.searchParams.entries()]
      const expectedEndpoint = new URL('/?tether_native=1', ticketUrl.origin)
      if (endpoint.origin !== ticketUrl.origin || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
          || endpoint.port || endpoint.hash || endpoint.pathname !== '/' || endpointQuery.length !== 1
          || endpointQuery[0][0] !== 'tether_native' || endpointQuery[0][1] !== '1'
          || endpoint.href !== expectedEndpoint.href) {
        throw new Error('invalid bootstrap endpoint')
      }
      bootstrapStage = 'validate-cookie'
      const cookies = await serviceSession.cookies.get({})
      if (!Array.isArray(cookies) || !cookies.some((cookie) => cookie && typeof cookie.name === 'string'
          && cookie.name.startsWith('__Host-tether_') && cookie.httpOnly === true && cookie.secure === true
          && cookie.path === '/'
          && String(cookie.domain || '').replace(/^\./, '').toLowerCase() === endpoint.hostname.toLowerCase())) {
        throw new Error('missing bootstrap cookie')
      }
      bootstrapStage = 'finalize-record'
      if ((actorGenerations.get(actorId) || 0) !== generation) throw new Error('工作台账号已切换，请重新打开服务。')
      const grantId = crypto.randomBytes(20).toString('hex')
      const record = { actorId, targetId, serviceId: 'dsh-native', generation, grantId, endpoint,
        serviceSession, partition, legacy: true, public: { targetId, serviceId: 'dsh-native', grantId,
          endpoint: endpoint.toString(), partition } }
      active.set(key, record)
      return record.public
    } catch (_) {
      logSafe('dsh-bootstrap-failed-' + bootstrapStage, { targetId, serviceId: 'dsh-native' })
      destroyBootstrap()
      try { await resetServiceSession(serviceSession) } catch (_) { /* continue clearing stored credentials */ }
      await Promise.allSettled([
        typeof serviceSession.clearStorageData === 'function' ? serviceSession.clearStorageData() : Promise.resolve(),
        typeof serviceSession.clearCache === 'function' ? serviceSession.clearCache() : Promise.resolve()
      ])
      throw new Error('DSH gateway 票据兑换失败。')
    } finally {
      destroyBootstrap()
    }
  }

  function legacyCatalogEntry(actorId, targetId) {
    const cacheKey = tupleKey(actorId, targetId, 'catalog')
    const cached = incompatibleCatalogs.get(cacheKey)
    const generation = actorGenerations.get(actorId) || 0
    if (!cached || cached.generation !== generation || cached.expiresAt <= Date.now()) {
      if (cached) incompatibleCatalogs.delete(cacheKey)
      return null
    }
    return cached
  }

  async function catalog(targetId, { signal } = {}) {
    if (typeof targetId !== 'string' || !targetId) throw new TypeError('invalid target')
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    const cacheKey = tupleKey(actorId, targetId, 'catalog')
    const generation = actorGenerations.get(actorId) || 0
    const cached = legacyCatalogEntry(actorId, targetId)
    if (cached) return cached.value
    let result
    try {
      result = await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'service_catalog'), {}, { signal })
    } catch (error) {
      if (!error || error.code !== 'bad_op') throw error
      if ((actorGenerations.get(actorId) || 0) !== generation) throw new Error('工作台账号已切换，请重新打开服务。')
      const reason = '目标节点版本过旧，请升级节点后重试。'
      let codeg
      try {
        const status = await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'agents_runtime_status'), {}, { signal })
        codeg = legacyCodegService(status, targetId)
      } catch (statusError) {
        codeg = { id: 'codeg', state: 'failed', reason: '无法读取旧节点 Codeg 状态。',
          reason_code: statusError && statusError.code || 'legacy_status_unavailable', agent_busy: false,
          view_only_reason: '', updated_at: null, legacy: true }
      }
      if ((actorGenerations.get(actorId) || 0) !== generation) throw new Error('工作台账号已切换，请重新打开服务。')
      const value = { protocol: 1, target_id: targetId, legacy: true, services: [...SERVICE_IDS].map((id) => id === 'codeg'
        ? codeg
        : { id, state: 'missing', reason, reason_code: error.code,
            agent_busy: false, view_only_reason: '', updated_at: null }) }
      incompatibleCatalogs.set(cacheKey, { generation, value, expiresAt: Date.now() + 60_000 })
      return value
    }
    if (!result || result.protocol !== 1 || result.target_id !== targetId || !Array.isArray(result.services)) {
      throw new Error('Controller 返回了无效的服务目录。')
    }
    return { protocol: 1, target_id: targetId, services: result.services.map((service) => ({
      id: service.id, state: service.state, reason: service.reason || '',
      agent_busy: service.agent_busy === true, view_only_reason: service.view_only_reason || '',
      updated_at: service.updated_at || null
    })) }
  }

  async function open(targetId, serviceId, prefetchedCatalog = null) {
    if (typeof targetId !== 'string' || !targetId || !SERVICE_IDS.has(serviceId)) throw new TypeError('invalid target or service')
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    if (clearingActors.has(actorId)) throw new Error('工作台授权正在清理，请稍后重试。')
    const key = tupleKey(actorId, targetId, serviceId)
    const cached = active.get(key)
    const generation = actorGenerations.get(actorId) || 0
    if (cached && !(serviceId === 'codeg' && cached.legacy === true)) return cached.public
    if (cached && cached.legacy === true && cached.generation === generation) {
      const refreshed = await openLegacyCodeg(targetId, { ...cached.refreshOptions,
        expectedActorId: actorId, expectedGeneration: generation })
      if (refreshed) return refreshed
      await resetServiceSession(cached.serviceSession)
      if (active.get(key) === cached) active.delete(key)
    }
    const existing = pending.get(key)
    if (existing) {
      if (existing.generation === generation) return existing
      try { await existing } catch (_) { /* stale generation is discarded */ }
      return open(targetId, serviceId, prefetchedCatalog)
    }
    const isCurrent = () => (actorGenerations.get(actorId) || 0) === generation
    const operationId = operationIds.get(key) || crypto.randomUUID()
    operationIds.set(key, operationId)
    const revokeStaleGrant = async (grantId) => {
      if (!grantId) return
      const newerActive = active.get(key)
      const newerPending = pending.get(key)
      if ((newerActive && newerActive.generation > generation)
          || (newerPending && newerPending.generation > generation)) return
      try {
        await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'service_revoke'), {
          grant_id: grantId, operation_id: operationId
        })
      } catch (_) { revocationFailures.add(actorId) }
    }
    let openedDescriptor = null
    let openedSession = null
    let cancelOpening = null
    const opening = (async () => {
      const openingController = new AbortController()
      cancelOpening = () => openingController.abort()
      try {
    const serviceCatalog = prefetchedCatalog || await catalog(targetId, { signal: openingController.signal })
    if (!serviceCatalog.services.some((service) => service.id === serviceId)) throw new Error('目标服务目录中没有该服务。')
    if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
    const sourceDeviceId = await getLocalDeviceId()
    if (typeof sourceDeviceId !== 'string' || !sourceDeviceId) throw new Error('本机设备身份尚未就绪。')
    if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
    if (serviceId === 'codeg' && targetId === sourceDeviceId) {
      const localCodeg = await openLegacyCodeg(targetId, {
        allowModernLocal: true, expectedActorId: actorId, expectedGeneration: generation,
        catalogResult: serviceCatalog
      })
      if (!isCurrent() || openingController.signal.aborted) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      return localCodeg
    }
    if (serviceId === 'codeg' && serviceCatalog.protocol === 1 && !serviceCatalog.legacy) {
      const compatibleCodeg = await openLegacyCodeg(targetId, {
        allowModernOwnedEasyTier: true, sourceDeviceId, expectedActorId: actorId,
        expectedGeneration: generation, catalogResult: serviceCatalog
      })
      if (!isCurrent() || openingController.signal.aborted) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      if (compatibleCodeg) return compatibleCodeg
    }
    const openBody = {
      service_id: serviceId,
      operation_id: operationId,
      source_device_id: sourceDeviceId
    }
    const startupController = new AbortController()
    const startupDeadline = Date.now() + 30000
    const startupTimer = setTimeout(() => startupController.abort(), 30000)
    const cancelStartup = () => startupController.abort()
    openingController.signal.addEventListener('abort', cancelStartup, { once: true })
    let descriptor
    try {
      while (true) {
        if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
        if (startupController.signal.aborted || Date.now() >= startupDeadline) {
          throw new Error('目标服务启动等待超时，请稍后重试。')
        }
        try {
          descriptor = await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'service_open'),
            openBody, { signal: startupController.signal })
          openedDescriptor = descriptor
          if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
          if (startupController.signal.aborted || Date.now() >= startupDeadline) {
            throw new Error('目标服务启动等待超时，请稍后重试。')
          }
          break
        } catch (error) {
          if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
          if (startupController.signal.aborted) throw new Error('目标服务启动等待超时，请稍后重试。')
          if (error.status === 401 || error.status === 403 || error.code !== 'service_starting') throw error
        }

        while (true) {
          if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
          if (startupController.signal.aborted || Date.now() >= startupDeadline) {
            throw new Error('目标服务启动等待超时，请稍后重试。')
          }
          const currentCatalog = await catalog(targetId, { signal: startupController.signal })
          if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
          const status = currentCatalog.services.find((service) => service.id === serviceId)
          if (!status) throw new Error('目标服务目录中没有该服务。')
          if (status.state === 'ready') break
          if (status.state !== 'starting' || status.reason !== 'service_starting') {
            throw new Error('目标服务启动失败，请检查服务状态后重试。')
          }
          const delay = Math.min(500, Math.max(0, startupDeadline - Date.now()))
          await new Promise((resolve, reject) => {
            const finish = () => {
              clearTimeout(timer)
              startupController.signal.removeEventListener('abort', onAbort)
            }
            const onAbort = () => { finish(); reject(new Error('service startup wait aborted')) }
            const timer = setTimeout(() => { finish(); resolve() }, delay)
            startupController.signal.addEventListener('abort', onAbort, { once: true })
          })
        }
      }
    } catch (error) {
      if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
      if (startupController.signal.aborted || Date.now() >= startupDeadline) {
        throw new Error('目标服务启动等待超时，请稍后重试。')
      }
      throw error
    } finally {
      clearTimeout(startupTimer)
      openingController.signal.removeEventListener('abort', cancelStartup)
    }
    if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
    const verified = verifyEndpoint(descriptor, targetId, serviceId)
    const partition = 'persist:tether-wb-' + sha256(key + '\u0000' + generation).slice(0, 40)
    const serviceSession = getServiceSession(partition)
    openedSession = serviceSession
    if (!serviceSession || typeof serviceSession.fetch !== 'function') throw new Error('Electron 服务隔离会话不可用。')
    managedSessions.add(serviceSession)
    const sourceRoute = validateSourceRoute(await getSourceRoute(verified.networkId, sourceDeviceId), verified.networkId, sourceDeviceId)
    if (!isCurrent()) throw new Error('工作台账号已切换，请重新打开服务。')
    await configureSocksProxy(serviceSession, sourceRoute)
    await verifyMeshCertificate(verified.origin, verified.caPem, sourceRoute)
    installCertificatePin(serviceSession, verified.origin, verified.caPem, sourceRoute)
    if (!isCurrent()) throw new Error('工作台账号已切换，请重新打开服务。')
    const response = await serviceSession.fetch(verified.bootstrapUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ticket: descriptor.bootstrap.ticket }),
      redirect: 'error'
    })
    if (!response.ok) throw new Error('工作台 bootstrap 失败（HTTP ' + response.status + '）。')
    if (!isCurrent()) throw new Error('工作台账号已切换，请重新打开服务。')
    const leaseExpiresAt = expiryMillis(descriptor.lease_expires_at)
    if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= Date.now()) throw new Error('工作台授权租约已过期。')
    const publicResult = { targetId, serviceId, grantId: descriptor.grant_id, endpoint: verified.endpoint.toString(), partition, leaseExpiresAt }
    if (serviceId === 'desktop') {
      publicResult.consent = descriptor.consent
      publicResult.viewOnly = descriptor.view_only
      publicResult.viewOnlyReason = typeof descriptor.view_only_reason === 'string' ? descriptor.view_only_reason : ''
      publicResult.nativeSessionExpiresAt = verified.nativeSessionExpiresAt
    }
    active.set(key, { actorId, targetId, serviceId, generation, operationId, descriptor, endpoint: verified.origin, serviceSession, sourceRoute,
      partition, leaseExpiresAt, public: publicResult, viewTimer: null })
    logSafe('native-workbench-open', { targetId, serviceId, tlsEpoch: verified.epoch })
    return publicResult
      } catch (error) {
        if (openedDescriptor && openedDescriptor.grant_id) await revokeStaleGrant(openedDescriptor.grant_id)
        if (openedSession) {
          try {
            await resetServiceSession(openedSession)
            await Promise.all([
              typeof openedSession.clearStorageData === 'function' ? openedSession.clearStorageData() : Promise.resolve(),
              typeof openedSession.clearCache === 'function' ? openedSession.clearCache() : Promise.resolve()
            ])
          } catch (_) { /* no session data may survive */ }
        }
        throw error
      }
    })()
    opening.generation = generation
    opening.cancel = () => { if (cancelOpening) cancelOpening() }
    pending.set(key, opening)
    try { return await opening } finally { if (pending.get(key) === opening) pending.delete(key) }
  }

  async function openLegacyCodeg(targetId, options = {}) {
    if (typeof targetId !== 'string' || !targetId) throw new TypeError('invalid target')
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    if (options.expectedActorId != null && options.expectedActorId !== actorId) {
      throw new Error('工作台账号已切换，请重新打开服务。')
    }
    if (clearingActors.has(actorId)) throw new Error('工作台授权正在清理，请稍后重试。')
    const generation = actorGenerations.get(actorId) || 0
    if (options.expectedGeneration != null && options.expectedGeneration !== generation) {
      throw new Error('工作台账号已切换，请重新打开服务。')
    }
    const key = tupleKey(actorId, targetId, 'codeg')
    const cached = active.get(key)
    if (cached && (cached.legacy !== true || cached.generation !== generation)) {
      throw new Error('目标 Codeg 已由其他工作台模式打开。')
    }
    if (cached && cached.refreshOptions) options = { ...cached.refreshOptions, ...options }
    const localDeviceId = options.allowModernLocal === true ? await getLocalDeviceId() : ''
    const allowModernLocal = options.allowModernLocal === true && localDeviceId === targetId
    if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
      throw new Error('工作台账号已切换，请重新打开服务。')
    }
    let catalogResult = options.catalogResult || null
    let legacy = legacyCatalogEntry(actorId, targetId)
    if (!legacy) {
      if (!catalogResult) catalogResult = await catalog(targetId)
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      legacy = legacyCatalogEntry(actorId, targetId)
    }
    const catalogHasCodeg = catalogResult && catalogResult.protocol === 1
      && catalogResult.target_id === targetId && Array.isArray(catalogResult.services)
      && catalogResult.services.some((service) => service && service.id === 'codeg')
    const allowModernOwnedEasyTier = options.allowModernOwnedEasyTier === true
      && typeof options.sourceDeviceId === 'string' && options.sourceDeviceId && options.sourceDeviceId !== targetId
      && catalogHasCodeg
    if (!legacy && !(allowModernLocal && catalogHasCodeg) && !allowModernOwnedEasyTier) {
      throw new Error('目标 Codeg 未通过旧节点兼容检查。')
    }
    let serviceSession = null
    try {
      let modernOwnerProof = null
      if (allowModernOwnedEasyTier) {
        const stateResponse = await loginSession.fetch(new URL('/api/state', base).toString(), {
          method: 'GET', headers: { 'Cache-Control': 'no-store' }, redirect: 'error'
        })
        let state
        try { state = await stateResponse.json() } catch (_) { throw new Error('Controller 返回了无效的设备快照。') }
        if (!stateResponse.ok) {
          const error = new Error('Controller 无法验证当前账号和目标设备（HTTP ' + stateResponse.status + '）。')
          error.status = stateResponse.status
          error.code = state && state.detail && state.detail.code
          throw error
        }
        if (!state || typeof state !== 'object' || Array.isArray(state) || !state.user
            || typeof state.user !== 'object' || state.user.user_id !== actorId || !Array.isArray(state.devices)) {
          throw new Error('Controller 返回的账号或设备快照无效。')
        }
        if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
          throw new Error('工作台账号已切换，请重新打开服务。')
        }

        const networksResponse = await loginSession.fetch(new URL('/api/networks', base).toString(), {
          method: 'GET', headers: { 'Cache-Control': 'no-store' }, redirect: 'error'
        })
        let networksPayload
        try { networksPayload = await networksResponse.json() } catch (_) { throw new Error('Controller 返回了无效的网络目录。') }
        if (!networksResponse.ok) {
          const error = new Error('Controller 无法验证目标设备的网络状态（HTTP ' + networksResponse.status + '）。')
          error.status = networksResponse.status
          error.code = networksPayload && networksPayload.detail && networksPayload.detail.code
          throw error
        }
        const networks = Array.isArray(networksPayload) ? networksPayload
          : networksPayload && Array.isArray(networksPayload.networks) ? networksPayload.networks : null
        if (!networks) throw new Error('Controller 返回了无效的网络目录。')
        if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
          throw new Error('工作台账号已切换，请重新打开服务。')
        }
        const hasCommonReadyNetwork = networks.some((item) => item && item.state === 'ready'
          && Array.isArray(item.devices)
          && item.devices.some((device) => device && device.device_id === options.sourceDeviceId && device.state === 'ready')
          && item.devices.some((device) => device && device.device_id === targetId && device.state === 'ready'))
        if (hasCommonReadyNetwork) return null

        const target = state.devices.find((item) => item && item.device_id === targetId)
        const directHost = target && target.online === true && target.owner_id === actorId
          && target.capabilities && target.capabilities.direct_api && target.capabilities.direct_api.host
        if (typeof directHost !== 'string' || !isPrivateIPv4(directHost) || !hasLocalEasyTierRoute(directHost)) return null
        modernOwnerProof = { directHost, networks }
      }

      let status = await postJson(loginSession.fetch.bind(loginSession),
        apiUrl(base, targetId, 'agents_runtime_status'), {})
      let current = legacyCodegService(status, targetId)
      if ((allowModernLocal || modernOwnerProof) && current.state === 'stopped') {
        if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
          throw new Error('工作台账号已切换，请重新打开服务。')
        }
        await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'agents_runtime_start'), {})
        if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
          throw new Error('工作台账号已切换，请重新打开服务。')
        }
        status = await postJson(loginSession.fetch.bind(loginSession),
          apiUrl(base, targetId, 'agents_runtime_status'), {})
        current = legacyCodegService(status, targetId)
      }
      const tokenUrl = status && strictLegacyCodegUrl(status.url)
      if (current.state !== 'ready' || !tokenUrl) throw new Error(current.reason || '目标 Codeg 尚未运行。')
      const bootstrapUrl = new URL(tokenUrl)
      bootstrapUrl.searchParams.set('next', '/workspace?tether_home=1')
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      const sourceDeviceId = modernOwnerProof ? options.sourceDeviceId : await getLocalDeviceId()
      if (typeof sourceDeviceId !== 'string' || !sourceDeviceId) throw new Error('本机设备身份尚未就绪。')

      let networks
      if (modernOwnerProof) {
        networks = modernOwnerProof.networks
      } else {
        const networksResponse = await loginSession.fetch(new URL('/api/networks', base).toString(), {
          method: 'GET', headers: { 'Cache-Control': 'no-store' }, redirect: 'error'
        })
        let networksPayload
        try { networksPayload = await networksResponse.json() } catch (_) { throw new Error('Controller 返回了无效的网络目录。') }
        if (!networksResponse.ok) {
          const detail = networksPayload && networksPayload.detail
          const error = new Error((detail && detail.error) || (typeof detail === 'string' && detail)
            || (networksPayload && networksPayload.error) || ('网络目录请求失败（HTTP ' + networksResponse.status + '）。'))
          error.status = networksResponse.status
          error.code = detail && detail.code || networksPayload && networksPayload.code
          throw error
        }
        networks = Array.isArray(networksPayload) ? networksPayload
          : networksPayload && Array.isArray(networksPayload.networks) ? networksPayload.networks : null
      }
      if (!networks) throw new Error('Controller 返回了无效的网络目录。')
      const readyNetworks = networks.filter((item) => item && item.state === 'ready')
      const network = readyNetworks.find((item) => {
        if (typeof item.network_id !== 'string' || !item.network_id
            || !Array.isArray(item.devices)) return false
        const source = item.devices.find((device) => device && device.device_id === sourceDeviceId && device.state === 'ready')
        const target = item.devices.find((device) => device && device.device_id === targetId && device.state === 'ready')
        return !!source && !!target && target.service_ip === tokenUrl.hostname
      })
      let sourceRoute = null
      if (network) {
        sourceRoute = validateSourceRoute(await getSourceRoute(network.network_id, sourceDeviceId),
          network.network_id, sourceDeviceId)
      } else if (modernOwnerProof) {
        if (modernOwnerProof.directHost !== tokenUrl.hostname) {
          throw new Error('目标 Codeg 状态 URL 与已鉴权的 EasyTier 地址不匹配。')
        }
      } else {
        const stateResponse = await loginSession.fetch(new URL('/api/state', base).toString(), {
          method: 'GET', headers: { 'Cache-Control': 'no-store' }, redirect: 'error'
        })
        let state
        try { state = await stateResponse.json() } catch (_) { throw new Error('Controller 返回了无效的设备快照。') }
        if (!stateResponse.ok) throw new Error('Controller 无法验证目标设备的旧网络地址。')
        const target = Array.isArray(state && state.devices)
          ? state.devices.find((item) => item && item.device_id === targetId && item.online === true) : null
        const legacyHost = target && target.capabilities && target.capabilities.direct_api
          && target.capabilities.direct_api.host
        if (legacyHost !== tokenUrl.hostname || !hasLocalEasyTierRoute(tokenUrl.hostname)) {
          throw new Error('目标 Codeg 未通过已鉴权的旧 EasyTier 网络检查。')
        }
      }
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      const partition = 'persist:tether-wb-' + sha256(key + '\u0000' + generation + '\u0000legacy-codeg').slice(0, 40)
      serviceSession = getServiceSession(partition)
      if (!serviceSession || typeof serviceSession.fetch !== 'function') throw new Error('Electron 服务隔离会话不可用。')
      managedSessions.add(serviceSession)
      installLegacyOriginGuard(serviceSession, tokenUrl)
      if (sourceRoute) await configureSocksProxy(serviceSession, sourceRoute)
      else await resetServiceSession(serviceSession)
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      const grantId = crypto.randomUUID()
      const endpoint = new URL('/', tokenUrl)
      const effectiveGrantId = cached ? cached.grantId : grantId
      const publicResult = { targetId, serviceId: 'codeg', grantId: effectiveGrantId, endpoint: endpoint.toString(),
        partition, legacy: true }
      // legacy marks the existing token-URL bootstrap flow, not the target Node version.
      active.set(key, { actorId, targetId, serviceId: 'codeg', generation, legacy: true,
        grantId: effectiveGrantId, endpoint, legacyTokenUrl: bootstrapUrl.toString(), guestPrepared: false,
        serviceSession, sourceRoute, partition, public: publicResult, viewTimer: null,
        refreshOptions: { allowModernLocal, allowModernOwnedEasyTier,
          sourceDeviceId: allowModernOwnedEasyTier ? options.sourceDeviceId : '' } })
      logSafe(cached ? 'native-workbench-refresh-legacy' : 'native-workbench-open-legacy',
        { targetId, serviceId: 'codeg' })
      return publicResult
    } catch (error) {
      if (serviceSession && !cached) {
        try {
          await resetServiceSession(serviceSession)
          await Promise.all([
            typeof serviceSession.clearStorageData === 'function' ? serviceSession.clearStorageData() : Promise.resolve(),
            typeof serviceSession.clearCache === 'function' ? serviceSession.clearCache() : Promise.resolve()
          ])
        } catch (_) { /* no legacy session data may survive */ }
      }
      throw error
    }
  }

  function managedGuestRecord(contents) {
    if (!contents || !contents.session || typeof contents.getURL !== 'function') throw new TypeError('invalid guest contents')
    if (!managedSessions.has(contents.session)) return null
    const records = [...active.values()].filter((item) => item.serviceSession === contents.session)
    if (records.length !== 1) throw new Error('工作台 guest 与活动授权不匹配。')
    const record = records[0]
    const currentUrl = String(contents.getURL() || '')
    if (record.serviceId === 'dsh-native') {
      if (currentUrl === '' || currentUrl === 'about:blank') return record
      let committedUrl
      try { committedUrl = new URL(currentUrl) } catch (_) { throw new Error('工作台 guest 与活动授权不匹配。') }
      if (!record.endpoint || committedUrl.href !== record.endpoint.href) {
        throw new Error('工作台 guest 与活动授权不匹配。')
      }
      return record
    }
    let guestUrl
    if (record.legacy === true && (currentUrl === '' || currentUrl === 'about:blank')) return record
    try { guestUrl = new URL(currentUrl) } catch (_) { throw new Error('工作台 guest 与活动授权不匹配。') }
    if (guestUrl.href !== 'about:blank'
        && ((guestUrl.protocol !== 'http:' && guestUrl.protocol !== 'https:')
          || !record.endpoint || record.endpoint.origin !== guestUrl.origin)) {
      throw new Error('工作台 guest 与活动授权不匹配。')
    }
    return record
  }

  function guestPolicy(contents) {
    const record = managedGuestRecord(contents)
    if (!record) return { managed: false }
    if (record.serviceId === 'dsh-native') {
      return { managed: true, serviceId: record.serviceId, endpoint: record.endpoint.href }
    }
    return { managed: true, serviceId: record.serviceId }
  }

  async function prepareGuest(contents) {
    const record = managedGuestRecord(contents)
    if (!record) return { managed: false, prepared: false }
    if (record.serviceId === 'dsh-native') return { managed: true, prepared: false }
    if (record.legacy !== true) return { managed: true, prepared: false }
    if (record.guestPrepared) return { managed: true, prepared: false }
    if (typeof contents.loadURL !== 'function') throw new Error('工作台 guest 无法加载目标页面。')
    await contents.loadURL(record.legacyTokenUrl)
    record.guestPrepared = true
    return { managed: true, prepared: true }
  }

  async function close(targetId, serviceId, grantId) {
    const actorId = await getActorId()
    const record = active.get(tupleKey(actorId, targetId, serviceId))
    const recordGrantId = record && record.legacy === true ? record.grantId : record && record.descriptor && record.descriptor.grant_id
    if (!record || !grantId || recordGrantId !== grantId) throw new Error('找不到本次工作台授权视图。')
    if (record.viewTimer) { clearInterval(record.viewTimer); record.viewTimer = null }
    if (record.legacy === true) {
      active.delete(tupleKey(actorId, targetId, serviceId))
      await resetServiceSession(record.serviceSession)
      await Promise.all([
        typeof record.serviceSession.clearStorageData === 'function' ? record.serviceSession.clearStorageData() : Promise.resolve(),
        typeof record.serviceSession.clearCache === 'function' ? record.serviceSession.clearCache() : Promise.resolve()
      ])
      logSafe('native-workbench-close-legacy', { targetId, serviceId })
      return { targetId, serviceId, state: 'closed' }
    }
    try {
      await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'service_close'), { grant_id: grantId })
    } catch (error) {
      try { await view(targetId, serviceId, true) } catch (_) { /* retain the original close error */ }
      throw error
    }
    active.delete(tupleKey(actorId, targetId, serviceId))
    await resetServiceSession(record.serviceSession)
    logSafe('native-workbench-close', { targetId, serviceId })
    return { targetId, serviceId, state: 'closed' }
  }

  async function view(targetId, serviceId, visible) {
    const actorId = await getActorId()
    const record = active.get(tupleKey(actorId, targetId, serviceId))
    if (!record) throw new Error('工作台授权不存在或已关闭。')
    if (record.viewTimer) { clearInterval(record.viewTimer); record.viewTimer = null }
    if (record.legacy === true) return { targetId, serviceId, visible: !!visible }
    if (visible) {
      const ping = () => record.serviceSession.fetch(new URL('/__tether/view', record.endpoint).toString(), {
        method: 'POST', headers: { 'Origin': record.endpoint.origin, 'Cache-Control': 'no-store' }, redirect: 'error'
      }).then((response) => {
        if (!response.ok) throw new Error('工作台视图续联失败（HTTP ' + response.status + '）。')
      })
      let firstError = null
      try { await ping() } catch (error) { firstError = error }
      record.viewTimer = setInterval(() => { void ping().catch((error) => logSafe('native-workbench-view-error', { targetId, serviceId, message: String(error.message || error) })) }, 60000)
      if (firstError) throw firstError
    }
    return { targetId, serviceId, visible: !!visible }
  }

  async function requestFiles(request) {
    if (!request || typeof request !== 'object' || typeof request.targetId !== 'string'
        || !request.targetId || !FILE_OPERATIONS.has(request.operation)) {
      throw new TypeError('invalid files request')
    }
    const { targetId, operation } = request
    if (typeof request.path !== 'string' && !['drives', 'workspaces'].includes(operation)) {
      throw new TypeError('invalid files path')
    }
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    const generation = actorGenerations.get(actorId) || 0
    const rootOperation = ['drives', 'workspaces'].includes(operation)
    const legacyOperation = rootOperation || operation === 'list'
    let classifiedCatalog = null
    let legacyEntry = legacyOperation ? legacyCatalogEntry(actorId, targetId) : null
    if (legacyOperation && !legacyEntry) {
      classifiedCatalog = await catalog(targetId)
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      if (classifiedCatalog.legacy === true) legacyEntry = legacyCatalogEntry(actorId, targetId)
    }
    if (operation === 'list' && legacyEntry) {
      const response = await loginSession.fetch(apiUrl(base, targetId, 'list'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ path: request.path }), redirect: 'error'
      })
      let result
      try { result = await response.json() } catch (_) { throw new Error('Controller 返回了无效的旧节点文件响应。') }
      if (!response.ok) {
        const detail = result && result.detail
        const error = new Error((detail && detail.error) || (typeof detail === 'string' && detail)
          || (result && result.error) || ('旧节点文件请求失败（HTTP ' + response.status + '）。'))
        error.status = response.status
        error.code = detail && detail.code || result && result.code
        throw error
      }
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)
          || (Object.hasOwn(result, 'device_id') && result.device_id !== targetId)
          || typeof result.path !== 'string' || !Array.isArray(result.entries)
          || !result.entries.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
            && typeof entry.name === 'string' && typeof entry.path === 'string' && typeof entry.dir === 'boolean')) {
        throw new Error('Controller 返回了无效的旧节点文件响应。')
      }
      return { targetId, status: response.status, body: { ...result, writable: false } }
    }
    if (rootOperation && legacyEntry) {
      const url = new URL('/api/devices/' + encodeURIComponent(targetId) + '/' + operation, base)
      const response = await loginSession.fetch(url.toString(), {
        method: 'GET', headers: { 'Cache-Control': 'no-store' }, redirect: 'error'
      })
      let result
      try { result = await response.json() } catch (_) { throw new Error('Controller 返回了无效的旧节点文件响应。') }
      if (!response.ok) {
        const detail = result && result.detail
        const error = new Error((detail && detail.error) || (typeof detail === 'string' && detail)
          || (result && result.error) || ('旧节点文件请求失败（HTTP ' + response.status + '）。'))
        error.status = response.status
        error.code = detail && detail.code || result && result.code
        throw error
      }
      if ((actorGenerations.get(actorId) || 0) !== generation || clearingActors.has(actorId)) {
        throw new Error('工作台账号已切换，请重新打开服务。')
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)
          || (result.device_id && result.device_id !== targetId) || !Array.isArray(result[operation])) {
        throw new Error('Controller 返回了无效的旧节点文件响应。')
      }
      return { targetId, status: response.status, body: result }
    }
    await open(targetId, 'files', classifiedCatalog)
    const key = tupleKey(actorId, targetId, 'files')
    const record = active.get(key)
    if (!record || record.actorId !== actorId || record.targetId !== targetId || record.serviceId !== 'files') {
      throw new Error('目标文件服务授权不可用。')
    }
    let url
    let method
    const headers = { 'Origin': record.endpoint.origin, 'Sec-Fetch-Site': 'same-origin', 'Cache-Control': 'no-store' }
    let body
    const jsonOperation = ['list', 'drives', 'workspaces', 'stat', 'fingerprint', 'preview', 'mkdir', 'rename', 'delete', 'copy']
    if (jsonOperation.includes(operation)) {
      method = 'POST'
      url = new URL('/api/files/v1/' + operation, record.endpoint)
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(request.body || (request.path ? { path: request.path } : {}))
    } else if (operation === 'preview_content') {
      method = 'GET'
      url = new URL('/api/files/v1/preview/content', record.endpoint)
      url.searchParams.set('path', request.path)
      if (request.body && request.body.version) url.searchParams.set('version', String(request.body.version))
    } else if (operation === 'content_get') {
      method = 'GET'
      url = new URL('/api/files/v1/content', record.endpoint)
      url.searchParams.set('path', request.path)
      const params = request.body || {}
      if (Number.isInteger(params.offset) && params.offset >= 0) url.searchParams.set('offset', String(params.offset))
      if (Number.isInteger(params.limit) && params.limit >= 0) url.searchParams.set('limit', String(params.limit))
      if (typeof params.range === 'string' && /^bytes=\d+-\d*$/.test(params.range)) headers.Range = params.range
    } else {
      method = 'PUT'
      url = new URL('/api/files/v1/content', record.endpoint)
      url.searchParams.set('path', request.path)
      const expectedVersion = String(request.expectedVersion || '')
      if (expectedVersion !== 'absent' && !/^[a-f0-9]{64}$/i.test(expectedVersion)) {
        throw new TypeError('invalid expected file version')
      }
      if (!TEXT_ENCODINGS.has(request.encoding) || !NEWLINE_MODES.has(request.newline)) {
        throw new TypeError('invalid text encoding or newline mode')
      }
      headers['Content-Type'] = 'application/octet-stream'
      headers['X-Tether-Expected-Version'] = expectedVersion
      headers['X-Tether-Text-Encoding'] = request.encoding
      headers['X-Tether-Newline'] = request.newline
      body = bytesFromRequest(request.bytes)
      if (!body && typeof request.text === 'string' && request.encoding === 'utf-8') body = Buffer.from(request.text, 'utf8')
      if (!body) throw new TypeError('file content must be encoded bytes')
    }
    const response = await record.serviceSession.fetch(url.toString(), { method, headers, body,
      redirect: 'error' })
    if (operation === 'content_get' || operation === 'preview_content') {
      if (!response.ok) {
        let detail = {}
        try { detail = await response.json() } catch (_) { /* preserve HTTP status */ }
        const error = new Error((detail && detail.detail && detail.detail.error) || detail.error ||
          ('目标文件服务请求失败（HTTP ' + response.status + '）。'))
        error.status = response.status
        error.code = detail && detail.detail && detail.detail.code || detail.code
        throw error
      }
      return { targetId, status: response.status, etag: response.headers.get('etag'),
        contentType: response.headers.get('content-type'), bytes: await response.arrayBuffer() }
    }
    let result = {}
    try { result = response.status === 204 ? {} : await response.json() } catch (_) { /* report controlled JSON error below */ }
    if (!response.ok) {
      const detail = result && result.detail
      const error = new Error((detail && detail.error) || (typeof detail === 'string' && detail) ||
        result.error || ('目标文件服务请求失败（HTTP ' + response.status + '）。'))
      error.status = response.status
      error.code = detail && detail.code || result.code
      throw error
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('目标文件服务返回了无效JSON。')
    if (result.target_id && result.target_id !== targetId) throw new Error('目标文件服务返回了其他设备的数据。')
    return { targetId, status: response.status, body: result }
  }

  function allowGuest(partition, url) {
    if (typeof partition !== 'string' || !partition || typeof url !== 'string') return false
    let parsed
    try {
      parsed = new URL(url)
    } catch (_) { return false }
    for (const record of active.values()) {
      if (record.partition !== partition || record.endpoint.origin !== parsed.origin) continue
      if (record.serviceId === 'dsh-native') {
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.href === record.endpoint.href
      }
      if (record.legacy === true) return parsed.protocol === 'http:' && !parsed.username && !parsed.password
      return parsed.protocol === 'https:'
    }
    return false
  }

  async function clearActor(actorId) {
    if (typeof actorId !== 'string' || !actorId) throw new TypeError('invalid actor')
    clearingActors.add(actorId)
    actorGenerations.set(actorId, (actorGenerations.get(actorId) || 0) + 1)
    const pendingOpens = [...pending.entries()]
      .filter(([key]) => key.startsWith(actorId + '\u0000'))
      .map(([, opening]) => opening)
    for (const opening of pendingOpens) if (typeof opening.cancel === 'function') opening.cancel()
    await Promise.allSettled(pendingOpens)
    const records = [...active.entries()].filter(([, record]) => record.actorId === actorId)
    for (const [key, record] of records) {
      if (record.viewTimer) clearInterval(record.viewTimer)
      active.delete(key)
    }
    const results = await Promise.all(records.map(async ([, record]) => {
      const errors = []
      if (record.legacy !== true) {
        try {
          await postJson(loginSession.fetch.bind(loginSession),
            apiUrl(base, record.targetId, 'service_revoke'), {
              grant_id: record.descriptor.grant_id, operation_id: record.operationId
            })
        } catch (error) {
          errors.push('revoke_failed')
        }
      }
      try {
        const serviceSession = record.serviceSession || getServiceSession(record.partition)
        if (!serviceSession) throw new Error('session unavailable')
        await resetServiceSession(serviceSession)
        await Promise.all([
          typeof serviceSession.clearStorageData === 'function' ? serviceSession.clearStorageData() : Promise.resolve(),
          typeof serviceSession.clearCache === 'function' ? serviceSession.clearCache() : Promise.resolve()
        ])
      } catch (_) {
        errors.push('storage_clear_failed')
      }
      return errors
    }))
    const errors = results.flat()
    for (const key of incompatibleCatalogs.keys()) if (key.startsWith(actorId + '\u0000')) incompatibleCatalogs.delete(key)
    for (const key of operationIds.keys()) if (key.startsWith(actorId + '\u0000')) operationIds.delete(key)
    if (revocationFailures.has(actorId)) errors.push('revoke_failed')
    revocationFailures.delete(actorId)
    clearingActors.delete(actorId)
    logSafe('native-workbench-clear-actor', { count: records.length, failed: errors.length })
    return { ok: errors.length === 0, cleared: records.length, errors }
  }

  return {
    catalog, open, openLegacyCodeg, openDshSurface, guestPolicy, prepareGuest, close, view, requestFiles, allowGuest, clearActor,
    currentActorId: async () => {
      const actorId = await getActorId()
      if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
      return actorId
    }
  }
}

module.exports = { createNativeWorkbench }
