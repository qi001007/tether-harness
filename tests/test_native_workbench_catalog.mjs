import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { createNativeWorkbench } = require('../apps/tether-app/native-workbench.js')
const agentsPage = fs.readFileSync(path.join(root, 'packages/tether-ui/src/agents-page.js'), 'utf8')
const app = fs.readFileSync(path.join(root, 'packages/tether-ui/src/app.js'), 'utf8')

function workbenchWith(fetcher, {
  getActorId = async () => 'actor-1', getServiceSession = () => null,
  getSourceRoute = async () => null, getLocalDeviceId = () => 'local-1'
} = {}) {
  return createNativeWorkbench({
    controllerUrl: 'https://controller.test',
    loginSession: { fetch: fetcher },
    getServiceSession,
    createBootstrapContents: () => { throw new Error('unexpected DSH bootstrap') },
    getActorId,
    getLocalDeviceId,
    getSourceRoute
  })
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('native workbench caches only structured bad_op catalog failures for 60 seconds', async () => {
  let calls = 0
  const workbench = workbenchWith(async () => {
    calls += 1
    return jsonResponse(400, { detail: { code: 'bad_op' } })
  })
  const originalNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  try {
    const first = await workbench.catalog('target-1')
    assert.equal(first.protocol, 1)
    assert.equal(first.legacy, true)
    assert.deepEqual(first.services.map((service) => service.id).sort(), ['codeg', 'desktop', 'dsh', 'files', 'herdr'])
    const codeg = first.services.find((service) => service.id === 'codeg')
    assert.equal(codeg.state, 'failed')
    assert.ok(first.services.filter((service) => service.id !== 'codeg').every((service) => service.state === 'missing'
      && service.reason === '目标节点版本过旧，请升级节点后重试。'
      && service.reason_code === 'bad_op'))
    assert.deepEqual(await workbench.catalog('target-1'), first)
    assert.equal(calls, 2, 'bad_op classification and one Codeg status read are reused during the cache window')
    now += 60_001
    await workbench.catalog('target-1')
    assert.equal(calls, 4, 'bad_op and Codeg status are retried after the cache expires')
  } finally {
    Date.now = originalNow
  }
})

test('device_not_found, authentication, other HTTP, and network catalog failures never create legacy cache', async () => {
  for (const failure of [
    { status: 404, code: 'device_not_found' },
    { status: 401, code: 'auth_required' },
    { status: 403, code: 'forbidden' },
    { status: 503, code: 'controller_unavailable' },
    { network: true }
  ]) {
    let calls = 0
    const workbench = workbenchWith(async () => {
      calls += 1
      if (failure.network) throw new Error('network down')
      return jsonResponse(failure.status, { detail: { code: failure.code } })
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(workbench.catalog('target-1'), (error) => failure.network
        ? error.message === 'network down'
        : error.status === failure.status && error.code === failure.code)
    }
    assert.equal(calls, 2, 'non-bad_op failures must be requested again: ' + JSON.stringify(failure))
  }
})

test('legacy catalog cache is isolated by actor, target, and actor generation', async () => {
  let actorId = 'actor-1'
  const calls = []
  const workbench = workbenchWith(async (url) => {
    calls.push({ actorId, url })
    return jsonResponse(400, { detail: { code: 'bad_op' } })
  }, { getActorId: async () => actorId })

  await workbench.catalog('target-1')
  await workbench.catalog('target-1')
  await workbench.catalog('target-2')
  actorId = 'actor-2'
  await workbench.catalog('target-1')
  actorId = 'actor-1'
  await workbench.catalog('target-1')
  assert.equal(calls.length, 6, 'only the identical actor+target tuple reuses a cache entry')

  await workbench.clearActor('actor-1')
  await workbench.catalog('target-1')
  assert.equal(calls.length, 8, 'clearing the actor generation invalidates its legacy cache')
})

test('cold legacy drives request classifies once, skips service_open, and reuses the result for root GETs', async () => {
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const parsed = new URL(url)
    calls.push({ path: parsed.pathname, method: init.method, redirect: init.redirect })
    if (parsed.pathname.endsWith('/fs/service_catalog')) {
      return jsonResponse(400, { detail: { code: 'bad_op' } })
    }
    if (parsed.pathname.endsWith('/drives')) {
      return jsonResponse(200, { device_id: 'target id', drives: [{ path: 'C:\\' }] })
    }
    if (parsed.pathname.endsWith('/workspaces')) {
      return jsonResponse(200, { device_id: 'target id', root: 'C:\\work', workspaces: [{ path: 'C:\\work' }] })
    }
    throw new Error('unexpected request: ' + parsed.pathname)
  })

  assert.deepEqual(await workbench.requestFiles({ targetId: 'target id', operation: 'drives' }), {
    targetId: 'target id', status: 200, body: { device_id: 'target id', drives: [{ path: 'C:\\' }] }
  })
  assert.deepEqual(await workbench.requestFiles({ targetId: 'target id', operation: 'workspaces' }), {
    targetId: 'target id', status: 200,
    body: { device_id: 'target id', root: 'C:\\work', workspaces: [{ path: 'C:\\work' }] }
  })
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['POST', '/api/devices/target%20id/fs/service_catalog'],
    ['POST', '/api/devices/target%20id/fs/agents_runtime_status'],
    ['GET', '/api/devices/target%20id/drives'],
    ['GET', '/api/devices/target%20id/workspaces']
  ])
  assert.equal(calls.some((call) => call.path.endsWith('/fs/service_open')), false)
  assert.ok(calls.every((call) => call.redirect === 'error'))
})

test('cold modern roots reuse classification and continue through native service_open', async () => {
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, method: init.method })
    if (path.endsWith('/service_catalog')) {
      return jsonResponse(200, { protocol: 1, target_id: 'target-1', services: [{ id: 'files', state: 'ready' }] })
    }
    if (path.endsWith('/service_open')) return jsonResponse(409, { detail: { code: 'native_path_reached' } })
    throw new Error('unexpected request: ' + path)
  })

  await assert.rejects(workbench.requestFiles({ targetId: 'target-1', operation: 'drives' }),
    (error) => error.status === 409 && error.code === 'native_path_reached')
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/devices/target-1/fs/service_catalog', '/api/devices/target-1/fs/service_open'
  ])
})

test('cold and warm legacy list use the fixed Controller route with path-only bodies and stay read-only', async () => {
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, method: init.method, body: init.body, headers: init.headers })
    if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
    if (path.endsWith('/agents_runtime_status')) {
      return jsonResponse(200, { installed: false, running: false, url: '' })
    }
    if (path.endsWith('/fs/list')) {
      const request = JSON.parse(init.body)
      return jsonResponse(200, { device_id: 'target id', path: request.path, writable: true,
        entries: [{ name: 'folder', path: request.path + '/folder', dir: true }] })
    }
    throw new Error('unexpected request: ' + path)
  })

  const cold = await workbench.requestFiles({ targetId: 'target id', operation: 'list', path: '/cold',
    url: 'https://renderer.invalid/', headers: { Authorization: 'renderer-token' }, auth: 'renderer-token',
    body: { path: '/renderer-body', writable: true } })
  const warm = await workbench.requestFiles({ targetId: 'target id', operation: 'list', path: '/warm' })
  assert.deepEqual(cold, { targetId: 'target id', status: 200, body: { device_id: 'target id', path: '/cold',
    writable: false, entries: [{ name: 'folder', path: '/cold/folder', dir: true }] } })
  assert.equal(warm.body.writable, false)
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['POST', '/api/devices/target%20id/fs/service_catalog'],
    ['POST', '/api/devices/target%20id/fs/agents_runtime_status'],
    ['POST', '/api/devices/target%20id/fs/list'],
    ['POST', '/api/devices/target%20id/fs/list']
  ])
  assert.deepEqual(calls.filter((call) => call.path.endsWith('/fs/list')).map((call) => JSON.parse(call.body)),
    [{ path: '/cold' }, { path: '/warm' }])
  assert.equal(calls.some((call) => call.path.endsWith('/fs/service_open')), false)
})

test('modern list still classifies then opens the native files service', async () => {
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, method: init.method })
    if (path.endsWith('/service_catalog')) {
      return jsonResponse(200, { protocol: 1, target_id: 'target-1', services: [{ id: 'files', state: 'ready' }] })
    }
    if (path.endsWith('/service_open')) return jsonResponse(409, { detail: { code: 'native_path_reached' } })
    throw new Error('unexpected request: ' + path)
  })

  await assert.rejects(workbench.requestFiles({ targetId: 'target-1', operation: 'list', path: '/' }),
    (error) => error.status === 409 && error.code === 'native_path_reached')
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/devices/target-1/fs/service_catalog', '/api/devices/target-1/fs/service_open'
  ])
})

test('legacy root response validation fails closed without native or secondary fallback', async () => {
  for (const [label, response, check] of [
    ['network error', new Error('legacy network down'), (error) => error.message === 'legacy network down'],
    ['invalid JSON', { ok: true, status: 200, json: async () => { throw new Error('bad json') } },
      (error) => /无效的旧节点文件响应/.test(error.message)],
    ['HTTP error', jsonResponse(502, { detail: { code: 'upstream_failed' } }), (error) => error.status === 502],
    ['non-object JSON', jsonResponse(200, []), (error) => /无效的旧节点文件响应/.test(error.message)],
    ['wrong device', jsonResponse(200, { device_id: 'other', drives: [] }), (error) => /无效的旧节点文件响应/.test(error.message)],
    ['wrong field', jsonResponse(200, { device_id: 'target-1', drives: {} }), (error) => /无效的旧节点文件响应/.test(error.message)]
  ]) {
    const calls = []
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push({ path, method: init.method })
      if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
      if (path.endsWith('/drives')) {
        if (response instanceof Error) throw response
        return response
      }
      throw new Error('unexpected request: ' + path)
    })
    await workbench.catalog('target-1')
    await assert.rejects(workbench.requestFiles({ targetId: 'target-1', operation: 'drives' }), check, label)
    assert.deepEqual(calls.map((call) => call.path), [
      '/api/devices/target-1/fs/service_catalog', '/api/devices/target-1/fs/agents_runtime_status',
      '/api/devices/target-1/drives'
    ], label + ' must not attempt service_open or a second fallback')
  }
})

test('legacy list authentication, device, network, and malformed responses fail closed without fallback', async () => {
  for (const [label, response, check] of [
    ['401', jsonResponse(401, { detail: { code: 'auth_required' } }),
      (error) => error.status === 401 && error.code === 'auth_required'],
    ['403', jsonResponse(403, { detail: { code: 'forbidden' } }),
      (error) => error.status === 403 && error.code === 'forbidden'],
    ['device_not_found', jsonResponse(404, { detail: { code: 'device_not_found' } }),
      (error) => error.status === 404 && error.code === 'device_not_found'],
    ['network', new Error('legacy list network down'), (error) => error.message === 'legacy list network down'],
    ['array response', jsonResponse(200, []), (error) => /无效的旧节点文件响应/.test(error.message)],
    ['wrong device', jsonResponse(200, { device_id: 'other', path: '/', entries: [] }),
      (error) => /无效的旧节点文件响应/.test(error.message)],
    ['missing path', jsonResponse(200, { device_id: 'target-1', entries: [] }),
      (error) => /无效的旧节点文件响应/.test(error.message)],
    ['entries not array', jsonResponse(200, { device_id: 'target-1', path: '/', entries: {} }),
      (error) => /无效的旧节点文件响应/.test(error.message)],
    ['invalid entry', jsonResponse(200, { device_id: 'target-1', path: '/',
      entries: [{ name: 'bad', path: '/bad', dir: 'yes' }] }),
      (error) => /无效的旧节点文件响应/.test(error.message)]
  ]) {
    const calls = []
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push({ path, method: init.method })
      if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
      if (path.endsWith('/agents_runtime_status')) {
        return jsonResponse(200, { installed: false, running: false, url: '' })
      }
      if (path.endsWith('/fs/list')) {
        if (response instanceof Error) throw response
        return response
      }
      throw new Error('unexpected request: ' + path)
    })

    await assert.rejects(workbench.requestFiles({ targetId: 'target-1', operation: 'list', path: '/' }), check, label)
    assert.deepEqual(calls.map((call) => call.path), [
      '/api/devices/target-1/fs/service_catalog', '/api/devices/target-1/fs/agents_runtime_status',
      '/api/devices/target-1/fs/list'
    ], label + ' must not attempt service_open or a second fallback')
  }
})

test('legacy list rejects an actor generation change while the fixed request is in flight', async () => {
  let releaseList
  let markListStarted
  const listStarted = new Promise((resolve) => { markListStarted = resolve })
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
    if (path.endsWith('/agents_runtime_status')) {
      return jsonResponse(200, { installed: false, running: false, url: '' })
    }
    if (path.endsWith('/fs/list')) {
      markListStarted()
      return new Promise((resolve) => { releaseList = () => resolve(jsonResponse(200,
        { device_id: 'target-1', path: '/', entries: [] })) })
    }
    throw new Error('unexpected request: ' + path)
  })

  const pending = workbench.requestFiles({ targetId: 'target-1', operation: 'list', path: '/' })
  await listStarted
  await workbench.clearActor('actor-1')
  releaseList()
  await assert.rejects(pending, /工作台账号已切换/)
  assert.equal(calls.some((path) => path.endsWith('/service_open')), false)
})

function legacySession() {
  const calls = { proxy: [], beforeRequest: null, closed: 0, storage: 0, cache: 0, fetch: 0 }
  return {
    calls,
    webRequest: { onBeforeRequest(_filter, handler) { calls.beforeRequest = handler } },
    async setProxy(value) { calls.proxy.push(value) },
    async closeAllConnections() { calls.closed += 1 },
    async clearStorageData() { calls.storage += 1 },
    async clearCache() { calls.cache += 1 },
    async fetch() { calls.fetch += 1; throw new Error('legacy session fetch is not used directly') }
  }
}

const readyLegacyStatus = (url = 'http://100.64.0.8:4096/token.html?token=private-token') => ({
  device_id: 'target-1', installed: true, running: true, url
})

const readyNetworks = (serviceIp = '100.64.0.8') => ({ networks: [{
  network_id: '12422c03150d483a9f86c97899d04450', state: 'ready', devices: [
    { device_id: 'local-1', state: 'ready', service_ip: '100.64.0.7' },
    { device_id: 'target-1', state: 'ready', service_ip: serviceIp }
  ]
}] })

const readyRoute = {
  protocol: 1, state: 'ready', network_id: '12422c03150d483a9f86c97899d04450', device_id: 'local-1',
  socks_proxy: { host: '127.0.0.1', port: 41001 }
}

test('legacy catalog maps only Codeg status and never exposes its URL or token', async () => {
  for (const [status, expected] of [
    [readyLegacyStatus(), ['ready', 'legacy-codeg']],
    [{ device_id: 'target-1', installed: false, running: false, url: '' }, ['missing', undefined]],
    [{ device_id: 'target-1', installed: true, running: false, url: '' }, ['stopped', undefined]],
    [{ device_id: 'target-1', installed: false, running: true, url: 'http://100.64.0.8:4096/token.html?token=x' }, ['failed', undefined]],
    [{ device_id: 'other', installed: true, running: true, url: 'http://100.64.0.8:4096/token.html?token=x' }, ['failed', undefined]]
  ]) {
    const workbench = workbenchWith(async (url) => new URL(url).pathname.endsWith('/service_catalog')
      ? jsonResponse(400, { detail: { code: 'bad_op' } })
      : jsonResponse(200, status))
    const catalog = await workbench.catalog('target-1')
    const codeg = catalog.services.find((service) => service.id === 'codeg')
    assert.deepEqual([codeg.state, codeg.open_mode], expected)
    assert.ok(catalog.services.filter((service) => service.id !== 'codeg').every((service) => service.state === 'missing'))
    assert.doesNotMatch(JSON.stringify(catalog), /private-token|token\.html|100\.64\.0\.8/)
    assert.equal(Object.hasOwn(codeg, 'url'), false)
  }
})

test('legacy Codeg prepares about:blank with the private URL, rejects a wrong origin, and retries a failed load', async () => {
  const session = legacySession()
  const controllerCalls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    controllerCalls.push({ path, method: init.method })
    if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
    if (path.endsWith('/agents_runtime_status')) return jsonResponse(200, readyLegacyStatus())
    if (path === '/api/networks') return jsonResponse(200, readyNetworks())
    throw new Error('unexpected request: ' + path)
  }, { getServiceSession: () => session, getSourceRoute: async () => readyRoute })

  const opened = await workbench.openLegacyCodeg('target-1')
  assert.equal(opened.endpoint, 'http://100.64.0.8:4096/')
  assert.equal(opened.legacy, true)
  assert.match(opened.partition, /^persist:tether-wb-[a-f0-9]{40}$/)
  assert.ok(opened.grantId)
  assert.doesNotMatch(JSON.stringify(opened), /private-token|token\.html|\?token=/)
  assert.equal(workbench.allowGuest(opened.partition, opened.endpoint), true)
  assert.equal(workbench.allowGuest(opened.partition, 'http://100.64.0.9:4096/'), false)

  const loaded = []
  let loadAttempts = 0
  const contents = { session, getURL: () => 'about:blank', async loadURL(url) {
    loadAttempts += 1
    if (loadAttempts === 1) throw new Error('first load failed')
    loaded.push(url)
  } }
  await assert.rejects(workbench.prepareGuest({ ...contents, getURL: () => 'http://100.64.0.9:4096/' }),
    /guest 与活动授权不匹配/)
  await assert.rejects(workbench.prepareGuest({ ...contents, getURL: () => '' }), /first load failed/)
  assert.deepEqual(await workbench.prepareGuest(contents), { managed: true, prepared: true })
  assert.deepEqual(await workbench.prepareGuest(contents), { managed: true, prepared: false })
  assert.deepEqual(loaded, [
    'http://100.64.0.8:4096/token.html?token=private-token&next=%2Fworkspace%3Ftether_home%3D1'
  ])

  const requestResults = []
  session.calls.beforeRequest({ url: 'http://100.64.0.8:4096/workspace' }, (result) => requestResults.push(result))
  session.calls.beforeRequest({ url: 'ws://100.64.0.8:4096/socket' }, (result) => requestResults.push(result))
  session.calls.beforeRequest({ url: 'http://100.64.0.9:4096/workspace' }, (result) => requestResults.push(result))
  assert.deepEqual(requestResults, [{ cancel: false }, { cancel: false }, { cancel: true }])
  assert.deepEqual(controllerCalls, [
    { path: '/api/devices/target-1/fs/service_catalog', method: 'POST' },
    { path: '/api/devices/target-1/fs/agents_runtime_status', method: 'POST' },
    { path: '/api/devices/target-1/fs/agents_runtime_status', method: 'POST' },
    { path: '/api/networks', method: 'GET' }
  ], 'cold open must classify with bad_op before re-reading status and must never call service_open')
  assert.equal(controllerCalls.some((call) => /service_open|agents_runtime_start/.test(call.path)), false)
})

test('legacy Codeg uses only the authenticated target EasyTier address when no managed mesh route matches', async () => {
  const originalNetworkInterfaces = os.networkInterfaces
  const session = legacySession()
  os.networkInterfaces = () => ({
    et_6_zngp: [{ address: '10.144.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
  })
  try {
    const calls = []
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push({ path, method: init.method })
      if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
      if (path.endsWith('/agents_runtime_status')) return jsonResponse(200,
        readyLegacyStatus('http://10.144.0.3:3444/token.html?token=private-token'))
      if (path === '/api/networks') return jsonResponse(200, { networks: [] })
      if (path === '/api/state') return jsonResponse(200, { devices: [{ device_id: 'target-1', online: true,
        capabilities: { direct_api: { host: '10.144.0.3', port: 18895, token: 'private-api-token' } } }] })
      throw new Error('unexpected request: ' + path)
    }, { getServiceSession: () => session })

    const opened = await workbench.openLegacyCodeg('target-1')
    assert.equal(opened.endpoint, 'http://10.144.0.3:3444/')
    assert.equal(opened.legacy, true)
    assert.doesNotMatch(JSON.stringify(opened), /private-token|private-api-token/)
    assert.deepEqual(session.calls.proxy, [{ mode: 'direct' }])
    assert.deepEqual(calls.slice(-2), [
      { path: '/api/networks', method: 'GET' },
      { path: '/api/state', method: 'GET' }
    ])
  } finally {
    os.networkInterfaces = originalNetworkInterfaces
  }
})

test('legacy Codeg rejects an EasyTier address that does not match the authenticated target snapshot', async () => {
  const originalNetworkInterfaces = os.networkInterfaces
  os.networkInterfaces = () => ({
    et_6_zngp: [{ address: '10.144.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
  })
  try {
    const workbench = workbenchWith(async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
      if (path.endsWith('/agents_runtime_status')) return jsonResponse(200,
        readyLegacyStatus('http://10.144.0.3:3444/token.html?token=private-token'))
      if (path === '/api/networks') return jsonResponse(200, { networks: [] })
      if (path === '/api/state') return jsonResponse(200, { devices: [{ device_id: 'target-1', online: true,
        capabilities: { direct_api: { host: '10.144.0.9' } } }] })
      throw new Error('unexpected request: ' + path)
    }, { getServiceSession: () => legacySession() })
    await assert.rejects(workbench.openLegacyCodeg('target-1'),
      /目标 Codeg 未通过已鉴权的旧 EasyTier 网络检查/)
  } finally {
    os.networkInterfaces = originalNetworkInterfaces
  }
})

test('legacy Codeg reclassifies an expired cache before opening without service_open', async () => {
  const originalNow = Date.now
  let now = 2_000_000
  Date.now = () => now
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, method: init.method })
    if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
    if (path.endsWith('/agents_runtime_status')) return jsonResponse(200, readyLegacyStatus())
    if (path === '/api/networks') return jsonResponse(200, readyNetworks())
    throw new Error('unexpected request: ' + path)
  }, { getServiceSession: () => legacySession(), getSourceRoute: async () => readyRoute })

  try {
    await workbench.catalog('target-1')
    now += 60_001
    const opened = await workbench.openLegacyCodeg('target-1')
    assert.equal(opened.endpoint, 'http://100.64.0.8:4096/')
    assert.deepEqual(calls, [
      { path: '/api/devices/target-1/fs/service_catalog', method: 'POST' },
      { path: '/api/devices/target-1/fs/agents_runtime_status', method: 'POST' },
      { path: '/api/devices/target-1/fs/service_catalog', method: 'POST' },
      { path: '/api/devices/target-1/fs/agents_runtime_status', method: 'POST' },
      { path: '/api/devices/target-1/fs/agents_runtime_status', method: 'POST' },
      { path: '/api/networks', method: 'GET' }
    ])
    assert.equal(calls.some((call) => call.path.endsWith('/service_open')), false)
  } finally {
    Date.now = originalNow
  }
})

test('legacy Codeg opens from a fresh ready status when its cached catalog says stopped', async () => {
  let statusReads = 0
  const session = legacySession()
  const workbench = workbenchWith(async (url) => {
    const path = new URL(url).pathname
    if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
    if (path.endsWith('/agents_runtime_status')) {
      statusReads += 1
      return jsonResponse(200, statusReads === 1
        ? { device_id: 'target-1', installed: true, running: false, url: '' }
        : readyLegacyStatus())
    }
    if (path === '/api/networks') return jsonResponse(200, readyNetworks())
    throw new Error('unexpected request: ' + path)
  }, { getServiceSession: () => session, getSourceRoute: async () => readyRoute })

  const cached = await workbench.catalog('target-1')
  assert.equal(cached.services.find((service) => service.id === 'codeg').state, 'stopped')
  const opened = await workbench.openLegacyCodeg('target-1')
  assert.equal(opened.endpoint, 'http://100.64.0.8:4096/')
  assert.equal(statusReads, 2, 'open must re-read authenticated runtime status instead of trusting stale stopped state')
})

test('modern same-device Codeg starts its stopped runtime once and opens through the isolated token gateway', async () => {
  const originalNetworkInterfaces = os.networkInterfaces
  const session = legacySession()
  const calls = []
  let statusReads = 0
  let startCalls = 0
  os.networkInterfaces = () => ({
    et_6_zngp: [{ address: '10.144.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
  })
  try {
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push({ path, method: init.method })
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'stopped' }]
      })
      if (path.endsWith('/agents_runtime_status')) {
        statusReads += 1
        return jsonResponse(200, statusReads === 1
          ? { device_id: 'target-1', installed: true, running: false, url: '' }
          : readyLegacyStatus('http://10.144.0.3:3444/token.html?token=private-token'))
      }
      if (path.endsWith('/agents_runtime_start')) {
        startCalls += 1
        return jsonResponse(200, { installed: true, running: true })
      }
      if (path === '/api/networks') return jsonResponse(200, { networks: [] })
      if (path === '/api/state') return jsonResponse(200, { devices: [{ device_id: 'target-1', online: true,
        capabilities: { direct_api: { host: '10.144.0.3', port: 18895 } } }] })
      throw new Error('unexpected request: ' + path)
    }, { getServiceSession: () => session, getLocalDeviceId: async () => 'target-1' })

    const opened = await workbench.open('target-1', 'codeg')
    assert.equal(opened.endpoint, 'http://10.144.0.3:3444/')
    assert.equal(opened.legacy, true, 'legacy identifies the token URL bootstrap mode')
    assert.match(opened.partition, /^persist:tether-wb-[a-f0-9]{40}$/)
    assert.doesNotMatch(JSON.stringify(opened), /private-token|token\.html|\?token=/)
    assert.deepEqual(session.calls.proxy, [{ mode: 'direct' }])
    assert.equal(statusReads, 2)
    assert.equal(startCalls, 1)
    assert.deepEqual(calls.map((call) => call.path), [
      '/api/devices/target-1/fs/service_catalog',
      '/api/devices/target-1/fs/agents_runtime_status',
      '/api/devices/target-1/fs/agents_runtime_start',
      '/api/devices/target-1/fs/agents_runtime_status',
      '/api/networks', '/api/state'
    ])
    assert.equal(calls.some((call) => call.path.endsWith('/service_open')), false)
  } finally {
    os.networkInterfaces = originalNetworkInterfaces
  }
})

test('modern remote Codeg remains on service_open and never starts through the local token gateway', async () => {
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, method: init.method })
    if (path.endsWith('/service_catalog')) return jsonResponse(200, {
      protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
    })
    if (path === '/api/state') return jsonResponse(200, { user: { user_id: 'actor-1' }, devices: [
      { device_id: 'target-1', online: true, owner_id: 'another-actor' }
    ] })
    if (path === '/api/networks') return jsonResponse(200, { networks: [] })
    if (path.endsWith('/service_open')) return jsonResponse(409, { detail: { code: 'native_path_reached' } })
    throw new Error('unexpected remote fallback: ' + path)
  })

  await assert.rejects(workbench.open('target-1', 'codeg'),
    (error) => error.status === 409 && error.code === 'native_path_reached')
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/devices/target-1/fs/service_catalog', '/api/state', '/api/networks',
    '/api/devices/target-1/fs/service_open'
  ])
})

test('modern owned remote Codeg uses the token gateway only after fresh EasyTier ownership proof', async () => {
  const originalNetworkInterfaces = os.networkInterfaces
  const session = legacySession()
  const calls = []
  let statusReads = 0
  let startCalls = 0
  os.networkInterfaces = () => ({
    et_6_zngp: [{ address: '10.144.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
  })
  try {
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push(path)
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'stopped' }]
      })
      if (path === '/api/state') return jsonResponse(200, { user: { user_id: 'actor-1' }, devices: [
        { device_id: 'target-1', online: true, owner_id: 'actor-1',
          capabilities: { direct_api: { host: '10.144.0.3', port: 18895, token: 'private-api-token' } } }
      ] })
      if (path === '/api/networks') return jsonResponse(200, { networks: [] })
      if (path.endsWith('/agents_runtime_status')) {
        statusReads += 1
        return jsonResponse(200, statusReads === 1
          ? { device_id: 'target-1', installed: true, running: false, url: '' }
          : readyLegacyStatus('http://10.144.0.3:3444/token.html?token=private-token'))
      }
      if (path.endsWith('/agents_runtime_start')) {
        startCalls += 1
        return jsonResponse(200, { installed: true, running: true })
      }
      throw new Error('unexpected request: ' + path)
    }, { getServiceSession: () => session })

    const opened = await workbench.open('target-1', 'codeg')
    assert.equal(opened.endpoint, 'http://10.144.0.3:3444/')
    assert.equal(opened.legacy, true)
    assert.deepEqual(session.calls.proxy, [{ mode: 'direct' }])
    assert.doesNotMatch(JSON.stringify(opened), /private-token|private-api-token/)
    assert.equal(statusReads, 2)
    assert.equal(startCalls, 1)
    assert.deepEqual(calls, [
      '/api/devices/target-1/fs/service_catalog', '/api/state', '/api/networks',
      '/api/devices/target-1/fs/agents_runtime_status',
      '/api/devices/target-1/fs/agents_runtime_start',
      '/api/devices/target-1/fs/agents_runtime_status'
    ])
  } finally {
    os.networkInterfaces = originalNetworkInterfaces
  }
})

test('modern Codeg keeps a common ready network on service_open without requiring legacy direct_api', async () => {
  const calls = []
  const networks = { networks: [{ network_id: 'shared-network', state: 'ready', devices: [
    { device_id: 'local-1', state: 'ready' }, { device_id: 'target-1', state: 'ready' }
  ] }] }
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path.endsWith('/service_catalog')) return jsonResponse(200, {
      protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
    })
    if (path === '/api/state') return jsonResponse(200, { user: { user_id: 'actor-1' }, devices: [] })
    if (path === '/api/networks') return jsonResponse(200, networks)
    if (path.endsWith('/service_open')) return jsonResponse(409, { detail: { code: 'native_path_reached' } })
    throw new Error('unexpected request: ' + path)
  })

  await assert.rejects(workbench.open('target-1', 'codeg'),
    (error) => error.status === 409 && error.code === 'native_path_reached')
  assert.deepEqual(calls, [
    '/api/devices/target-1/fs/service_catalog', '/api/state', '/api/networks',
    '/api/devices/target-1/fs/service_open'
  ])
})

test('modern Codeg fails closed on an account mismatch or malformed network directory', async () => {
  for (const [label, state, networks, expected] of [
    ['account mismatch', { user: { user_id: 'other-actor' }, devices: [] }, { networks: [] }, /账号或设备快照无效/],
    ['malformed networks', { user: { user_id: 'actor-1' }, devices: [] }, { networks: 'unknown' }, /无效的网络目录/]
  ]) {
    const calls = []
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push(path)
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
      })
      if (path === '/api/state') return jsonResponse(200, state)
      if (path === '/api/networks') return jsonResponse(200, networks)
      throw new Error('unexpected request: ' + path)
    })
    await assert.rejects(workbench.open('target-1', 'codeg'), expected, label)
    assert.equal(calls.some((path) => path.endsWith('/service_open')), false, label)
    assert.equal(calls.some((path) => path.endsWith('/agents_runtime_start')), false, label)
  }
})

test('modern Codeg falls through to service_open when an owned target lacks a local EasyTier route', async () => {
  const originalNetworkInterfaces = os.networkInterfaces
  os.networkInterfaces = () => ({})
  try {
    const calls = []
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push(path)
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
      })
      if (path === '/api/state') return jsonResponse(200, { user: { user_id: 'actor-1' }, devices: [
        { device_id: 'target-1', online: true, owner_id: 'actor-1',
          capabilities: { direct_api: { host: '10.144.0.3' } } }
      ] })
      if (path === '/api/networks') return jsonResponse(200, { networks: [] })
      if (path.endsWith('/service_open')) return jsonResponse(409, { detail: { code: 'native_path_reached' } })
      throw new Error('unexpected request: ' + path)
    })

    await assert.rejects(workbench.open('target-1', 'codeg'),
      (error) => error.status === 409 && error.code === 'native_path_reached')
    assert.deepEqual(calls, [
      '/api/devices/target-1/fs/service_catalog', '/api/state', '/api/networks',
      '/api/devices/target-1/fs/service_open'
    ])
  } finally {
    os.networkInterfaces = originalNetworkInterfaces
  }
})

test('modern Codeg preserves authenticated state errors without trying service_open', async () => {
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path.endsWith('/service_catalog')) return jsonResponse(200, {
      protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
    })
    if (path === '/api/state') return jsonResponse(403, { detail: { code: 'forbidden' } })
    throw new Error('unexpected request: ' + path)
  })

  await assert.rejects(workbench.open('target-1', 'codeg'),
    (error) => error.status === 403 && error.code === 'forbidden')
  assert.deepEqual(calls, ['/api/devices/target-1/fs/service_catalog', '/api/state'])
})

test('modern owned Codeg rejects a token URL outside the proven direct host', async () => {
  const originalNetworkInterfaces = os.networkInterfaces
  os.networkInterfaces = () => ({
    et_6_zngp: [{ address: '10.144.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
  })
  try {
    const workbench = workbenchWith(async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
      })
      if (path === '/api/state') return jsonResponse(200, { user: { user_id: 'actor-1' }, devices: [
        { device_id: 'target-1', online: true, owner_id: 'actor-1',
          capabilities: { direct_api: { host: '10.144.0.3' } } }
      ] })
      if (path === '/api/networks') return jsonResponse(200, { networks: [] })
      if (path.endsWith('/agents_runtime_status')) return jsonResponse(200,
        readyLegacyStatus('http://10.144.0.4:3444/token.html?token=private-token'))
      throw new Error('unexpected request: ' + path)
    })

    await assert.rejects(workbench.open('target-1', 'codeg'), /已鉴权的 EasyTier 地址不匹配/)
  } finally {
    os.networkInterfaces = originalNetworkInterfaces
  }
})

test('modern same-device Codeg rejects a wrong status identity or URL without starting runtime', async () => {
  for (const [status, expected] of [
    [{ device_id: 'other-device', installed: true, running: true,
      url: 'http://10.144.0.3:3444/token.html?token=private-token' }, /旧节点返回了无效的 Codeg 状态/],
    [{ device_id: 'other-device', installed: true, running: false, url: '' }, /旧节点返回了无效的 Codeg 状态/],
    [{ device_id: 'target-1', installed: true, running: true,
      url: 'http://localhost:3444/token.html?token=private-token' }, /旧节点 Codeg 运行状态不一致/]
  ]) {
    const calls = []
    const workbench = workbenchWith(async (url, init) => {
      const path = new URL(url).pathname
      calls.push({ path, method: init.method })
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'ready' }]
      })
      if (path.endsWith('/agents_runtime_status')) return jsonResponse(200, status)
      throw new Error('unexpected request: ' + path)
    }, { getLocalDeviceId: async () => 'target-1' })

    await assert.rejects(workbench.open('target-1', 'codeg'), expected)
    assert.equal(calls.some((call) => call.path.endsWith('/agents_runtime_start')), false)
    assert.equal(calls.some((call) => call.path.endsWith('/service_open')), false)
  }
})

test('modern same-device Codeg cancels a pending runtime start when its actor generation changes', async () => {
  let actorId = 'actor-1'
  let markStartReached
  const startReached = new Promise((resolve) => { markStartReached = resolve })
  let finishStart
  const startResponse = new Promise((resolve) => { finishStart = resolve })
  const calls = []
  const workbench = workbenchWith(async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path.endsWith('/service_catalog')) return jsonResponse(200, {
      protocol: 1, target_id: 'target-1', services: [{ id: 'codeg', state: 'stopped' }]
    })
    if (path.endsWith('/agents_runtime_status')) {
      return jsonResponse(200, { device_id: 'target-1', installed: true, running: false, url: '' })
    }
    if (path.endsWith('/agents_runtime_start')) {
      markStartReached()
      return startResponse
    }
    throw new Error('unexpected request: ' + path)
  }, { getActorId: async () => actorId, getLocalDeviceId: async () => 'target-1' })

  const opening = workbench.open('target-1', 'codeg')
  await startReached
  const clearing = workbench.clearActor('actor-1')
  finishStart(jsonResponse(200, { installed: true, running: true }))
  await assert.rejects(opening, /工作台账号已切换/)
  await clearing
  assert.equal(calls.filter((path) => path.endsWith('/agents_runtime_start')).length, 1)
  assert.equal(calls.filter((path) => path.endsWith('/agents_runtime_status')).length, 1)
  assert.equal(calls.some((path) => path.endsWith('/service_open')), false)
})

test('legacy Codeg reports the exact safe error when no trusted legacy or managed network route exists', async () => {
  for (const networks of [
    { networks: [] },
    { networks: [{ network_id: '12422c03150d483a9f86c97899d04450', state: 'stopped', devices: [] }] }
  ]) {
    let routeCalls = 0
    const workbench = workbenchWith(async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
      if (path.endsWith('/agents_runtime_status')) return jsonResponse(200, readyLegacyStatus())
      if (path === '/api/networks') return jsonResponse(200, networks)
      if (path === '/api/state') return jsonResponse(200, { devices: [] })
      throw new Error('unexpected request: ' + path)
    }, {
      getServiceSession: () => legacySession(),
      getSourceRoute: async () => { routeCalls += 1; return readyRoute }
    })
    await assert.rejects(workbench.openLegacyCodeg('target-1'),
      (error) => error.message === '目标 Codeg 未通过已鉴权的旧 EasyTier 网络检查。')
    assert.equal(routeCalls, 0)
  }
})

test('legacy Codeg re-read rejects invalid URLs and untrusted network membership or service IP', async () => {
  for (const [label, secondStatus, networks] of [
    ['https scheme', readyLegacyStatus('https://100.64.0.8:4096/token.html?token=x'), readyNetworks()],
    ['missing port', readyLegacyStatus('http://100.64.0.8/token.html?token=x'), readyNetworks()],
    ['extra query', readyLegacyStatus('http://100.64.0.8:4096/token.html?token=x&next=/'), readyNetworks()],
    ['credentials', readyLegacyStatus('http://user@100.64.0.8:4096/token.html?token=x'), readyNetworks()],
    ['fragment', readyLegacyStatus('http://100.64.0.8:4096/token.html?token=x#frag'), readyNetworks()],
    ['empty token', readyLegacyStatus('http://100.64.0.8:4096/token.html?token='), readyNetworks()],
    ['service ip mismatch', readyLegacyStatus(), readyNetworks('100.64.0.9')],
    ['members alias rejected', readyLegacyStatus(), { networks: [{
      network_id: readyNetworks().networks[0].network_id, state: 'ready', members: readyNetworks().networks[0].devices
    }] }],
    ['source not ready', readyLegacyStatus(), { networks: [{ ...readyNetworks().networks[0],
      devices: [{ device_id: 'local-1', state: 'stopped', service_ip: '100.64.0.7' },
        { device_id: 'target-1', state: 'ready', service_ip: '100.64.0.8' }] }] }]
  ]) {
    let statusReads = 0
    let routeCalls = 0
    const workbench = workbenchWith(async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
      if (path.endsWith('/agents_runtime_status')) {
        statusReads += 1
        return jsonResponse(200, statusReads === 1 ? readyLegacyStatus() : secondStatus)
      }
      if (path === '/api/networks') return jsonResponse(200, networks)
      throw new Error('unexpected request: ' + path)
    }, {
      getServiceSession: () => legacySession(),
      getSourceRoute: async () => { routeCalls += 1; return readyRoute }
    })
    await workbench.catalog('target-1')
    await assert.rejects(workbench.openLegacyCodeg('target-1'), undefined, label)
    if (label !== 'service ip mismatch' && label !== 'source not ready') assert.equal(routeCalls, 0, label)
    else assert.equal(routeCalls, 0, label + ' must fail before route lookup')
  }
})

test('legacy view, close, and clearActor skip remote lifecycle calls and clear isolated sessions', async () => {
  const session = legacySession()
  const paths = []
  const workbench = workbenchWith(async (url) => {
    const path = new URL(url).pathname
    paths.push(path)
    if (path.endsWith('/service_catalog')) return jsonResponse(400, { detail: { code: 'bad_op' } })
    if (path.endsWith('/agents_runtime_status')) return jsonResponse(200, readyLegacyStatus())
    if (path === '/api/networks') return jsonResponse(200, readyNetworks())
    throw new Error('unexpected remote lifecycle request: ' + path)
  }, { getServiceSession: () => session, getSourceRoute: async () => readyRoute })

  await workbench.catalog('target-1')
  const first = await workbench.openLegacyCodeg('target-1')
  assert.deepEqual(await workbench.view('target-1', 'codeg', true), { targetId: 'target-1', serviceId: 'codeg', visible: true })
  assert.equal(session.calls.fetch, 0)
  await workbench.close('target-1', 'codeg', first.grantId)
  assert.equal(session.calls.closed, 1)
  assert.equal(session.calls.storage, 1)
  assert.equal(session.calls.cache, 1)
  await assert.rejects(workbench.prepareGuest({ session, getURL: () => first.endpoint, async loadURL() {} }),
    /guest 与活动授权不匹配/)

  await workbench.openLegacyCodeg('target-1')
  const cleared = await workbench.clearActor('actor-1')
  assert.equal(cleared.ok, true)
  assert.equal(session.calls.closed, 2)
  assert.equal(session.calls.storage, 2)
  assert.equal(session.calls.cache, 2)
  assert.equal(paths.some((path) => /service_(?:close|revoke)$/.test(path) || path.endsWith('/__tether/view')), false)
})

test('Agents can start stopped legacy Codeg but keeps missing and failed legacy states disabled', () => {
  assert.match(agentsPage, /serviceCatalog && serviceCatalog\.legacy === true/)
  assert.match(agentsPage, /\['ready', 'stopped'\]\.includes\(catalogCodeg\.state\)/)
  assert.match(agentsPage, /const runtime = await getAgentsRuntime\(device, true\)/)
  assert.match(agentsPage, /await host\.workbench\.openLegacyCodeg\(device\)/)
  assert.match(agentsPage, /legacyCodegBlocked \|\| \(codegService && codegService\.state === 'missing'\)/)
  assert.match(agentsPage, /codegService\.state === 'missing' \? 'Codeg 未安装'[\s\S]*codegService\.state === 'stopped' \? 'Codeg 未运行'[\s\S]*'Codeg 状态异常'/)
  assert.doesNotMatch(agentsPage, /legacyCodegBlocked \? '启动并打开 Codeg'/)
})

test('DSH status accepts a missing service entry as a stable state rather than a catalog error', () => {
  assert.match(app, /supported: service\.state !== 'missing', state: service\.state/)
  assert.match(app, /reason: service\.reason \|\| '', error: ''/)
})
