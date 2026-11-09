'use strict'

const crypto = require('node:crypto')
const net = require('node:net')
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
      || endpoint.search || endpoint.pathname !== '/') throw new Error('服务端返回的工作台 origin 无效。')
  const origin = new URL('/', endpoint)
  let guestUrl = null
  if (serviceId === 'desktop') {
    const guestPath = String(descriptor.guest_path || '')
    guestUrl = new URL(guestPath, origin)
    const query = Array.from(guestUrl.searchParams.entries())
    if (!guestPath.startsWith('/') || guestPath.startsWith('//') || guestUrl.origin !== origin.origin
        || guestUrl.username || guestUrl.password || guestUrl.hash
        || !['/sharing', '/default/sharing'].includes(guestUrl.pathname)
        || query.length !== 1 || query[0][0] !== 'c' || !query[0][1]) {
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
  return { endpoint, origin, guestUrl, bootstrapUrl, caPem, epoch: descriptor.tls.epoch,
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

function createNativeWorkbench({ controllerUrl, loginSession, getServiceSession, getActorId, getLocalDeviceId, getSourceRoute, logSafe = () => {} }) {
  if (!controllerUrl || !loginSession || typeof loginSession.fetch !== 'function'
      || typeof getServiceSession !== 'function' || typeof getActorId !== 'function'
      || typeof getLocalDeviceId !== 'function' || typeof getSourceRoute !== 'function') {
    throw new TypeError('native workbench requires trusted Controller/session access from Electron main')
  }
  const base = new URL(controllerUrl).origin
  const active = new Map()
  const pending = new Map()
  const operationIds = new Map()
  const actorGenerations = new Map()
  const clearingActors = new Set()
  const revocationFailures = new Set()
  const tupleKey = (actorId, targetId, serviceId) => [actorId, targetId, serviceId].join('\u0000')

  async function catalog(targetId, { signal } = {}) {
    if (typeof targetId !== 'string' || !targetId) throw new TypeError('invalid target')
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    const result = await postJson(loginSession.fetch.bind(loginSession), apiUrl(base, targetId, 'service_catalog'), {}, { signal })
    if (!result || result.protocol !== 1 || result.target_id !== targetId || !Array.isArray(result.services)) {
      throw new Error('Controller 返回了无效的服务目录。')
    }
    return { protocol: 1, target_id: targetId, services: result.services.map((service) => ({
      id: service.id, state: service.state, reason: service.reason || '',
      agent_busy: service.agent_busy === true, view_only_reason: service.view_only_reason || '',
      updated_at: service.updated_at || null
    })) }
  }

  async function open(targetId, serviceId) {
    if (typeof targetId !== 'string' || !targetId || !SERVICE_IDS.has(serviceId)) throw new TypeError('invalid target or service')
    const actorId = await getActorId()
    if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
    if (clearingActors.has(actorId)) throw new Error('工作台授权正在清理，请稍后重试。')
    const key = tupleKey(actorId, targetId, serviceId)
    const cached = active.get(key)
    if (cached) return cached.public
    const generation = actorGenerations.get(actorId) || 0
    const existing = pending.get(key)
    if (existing) {
      if (existing.generation === generation) return existing
      try { await existing } catch (_) { /* stale generation is discarded */ }
      return open(targetId, serviceId)
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
    const serviceCatalog = await catalog(targetId, { signal: openingController.signal })
    if (!serviceCatalog.services.some((service) => service.id === serviceId)) throw new Error('目标服务目录中没有该服务。')
    if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
    const sourceDeviceId = await getLocalDeviceId()
    if (typeof sourceDeviceId !== 'string' || !sourceDeviceId) throw new Error('本机设备身份尚未就绪。')
    if (!isCurrent() || openingController.signal.aborted) throw new Error('工作台账号已切换，请重新打开服务。')
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
    const publicEndpoint = serviceId === 'desktop' ? verified.guestUrl : verified.endpoint
    const publicResult = { targetId, serviceId, grantId: descriptor.grant_id, endpoint: publicEndpoint.toString(), partition, leaseExpiresAt }
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

  async function close(targetId, serviceId, grantId) {
    const actorId = await getActorId()
    const record = active.get(tupleKey(actorId, targetId, serviceId))
    if (!record || !grantId || record.descriptor.grant_id !== grantId) throw new Error('找不到本次工作台授权视图。')
    if (record.viewTimer) { clearInterval(record.viewTimer); record.viewTimer = null }
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
    await open(targetId, 'files')
    const actorId = await getActorId()
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
    let origin
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') return false
      origin = parsed.origin
    } catch (_) { return false }
    for (const record of active.values()) {
      if (record.partition === partition && record.endpoint.origin === origin) return true
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
      try {
        await postJson(loginSession.fetch.bind(loginSession),
          apiUrl(base, record.targetId, 'service_revoke'), {
            grant_id: record.descriptor.grant_id, operation_id: record.operationId
          })
      } catch (error) {
        errors.push('revoke_failed')
      }
      try {
        const serviceSession = getServiceSession(record.partition)
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
    for (const key of operationIds.keys()) if (key.startsWith(actorId + '\u0000')) operationIds.delete(key)
    if (revocationFailures.has(actorId)) errors.push('revoke_failed')
    revocationFailures.delete(actorId)
    clearingActors.delete(actorId)
    logSafe('native-workbench-clear-actor', { count: records.length, failed: errors.length })
    return { ok: errors.length === 0, cleared: records.length, errors }
  }

  return {
    catalog, open, close, view, requestFiles, allowGuest, clearActor,
    currentActorId: async () => {
      const actorId = await getActorId()
      if (typeof actorId !== 'string' || !actorId) throw new Error('Controller 登录身份尚未就绪。')
      return actorId
    }
  }
}

module.exports = { createNativeWorkbench }
