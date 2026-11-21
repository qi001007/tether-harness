import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createSftpRelayManager, requiresLocalRelayConsent } from '../apps/tether-app/sftp-relay.js'

const networkId = '5066405689d84594a64af986e90a1de8'
const local = { device: 'DESK', port: 18894, token: 'local-test-token', controller: 'https://hub.invalid' }
const pair = { network_id: networkId, source_device_id: 'SOURCE', executor_device_id: 'DESTINATION' }
const expiry = 1800 + 1700000000
const reply = (value, status = 200) => Response.json(value, { status })
const record = { relay_device_id: 'DESK', source_device_id: 'SOURCE', executor_device_id: 'DESTINATION', expires_at: expiry }

function setup({ localReplies = [], hubReplies = [] } = {}) {
  const calls = []
  const fetch = (scope, replies) => async (url, options) => {
    calls.push({ scope, url: new URL(url), method: options.method, headers: options.headers,
      body: options.body && JSON.parse(options.body), redirect: options.redirect })
    const response = replies.shift()
    if (response instanceof Error) throw response
    return response || reply({ ok: true })
  }
  const manage = createSftpRelayManager({
    fetchLocal: fetch('local', localReplies),
    fetchHub: fetch('hub', hubReplies),
    now: () => 1700000000000
  })
  return { calls, manage: request => manage(request, local) }
}

test('explicit enable consents on the local console before the owner Hub registration', async () => {
  const { manage, calls } = setup({ hubReplies: [reply({ enabled: true, ...record })] })
  assert.deepEqual(await manage({ action: 'enable', ...pair, expires_at: 9999999999 }), { enabled: true, ...record })
  assert.deepEqual(calls.map(call => [call.scope, call.method]), [['local', 'POST'], ['hub', 'POST']])
  assert.equal(calls[0].url.origin, 'http://127.0.0.1:18894')
  assert.equal(calls[0].url.pathname, '/api/devices/DESK/sftp-relay/consent')
  assert.equal(calls[0].headers.authorization, 'Bearer local-test-token')
  assert.deepEqual(calls[0].body, { ...pair, enabled: true, expires_at: expiry })
  assert.equal(calls[1].url.pathname, '/api/networks/' + networkId + '/sftp-relay')
  assert.deepEqual(calls[1].body, record)
  assert.equal(calls[1].headers.authorization, undefined)
  assert.ok(calls.every(call => call.redirect === 'error'))
})

test('rejected Hub enable revokes local consent and preserves the actual error', async () => {
  const { manage, calls } = setup({ hubReplies: [reply({ detail: { message: '设备未配对' } }, 409)] })
  await assert.rejects(manage({ action: 'enable', ...pair }), /设备未配对/)
  assert.deepEqual(calls.map(call => [call.scope, call.method, call.body.enabled]),
    [['local', 'POST', true], ['hub', 'POST', undefined], ['local', 'POST', false]])
})

test('an ambiguous local activation failure attempts to withdraw without contacting Hub', async () => {
  const { manage, calls } = setup({ localReplies: [Object.assign(new Error(), { name: 'TimeoutError' })] })
  await assert.rejects(manage({ action: 'enable', ...pair }), /本机授权超时/)
  assert.deepEqual(calls.map(call => [call.scope, call.body.enabled]), [['local', true], ['local', false]])
})

test('local stop precedes Hub DELETE and stays stopped if the Hub reply fails', async () => {
  const { manage, calls } = setup({ hubReplies: [reply({ detail: { code: 'network_offline' } }, 503)] })
  await assert.rejects(manage({ action: 'disable', ...pair, expires_at: expiry }), /本机已停止.*network_offline/)
  assert.deepEqual(calls.map(call => [call.scope, call.method, call.body.enabled]),
    [['local', 'POST', false], ['hub', 'DELETE', undefined]])
})

test('a successful registration is untouched by subsequent status-read failure', async () => {
  const { manage, calls } = setup({ hubReplies: [reply({ enabled: true, ...record }), reply({}, 503)] })
  await manage({ action: 'enable', ...pair })
  await assert.rejects(manage({ action: 'list', network_id: networkId }), /HTTP 503/)
  assert.deepEqual(calls.map(call => call.method), ['POST', 'POST', 'GET'])
})

test('untrusted device fields cannot select the relay or bypass the typed bridge', async () => {
  const { manage, calls } = setup()
  await assert.rejects(manage({ action: 'enable', ...pair, source_device_id: 'DESK' }), /另外两台/)
  await assert.rejects(manage({ action: 'enable', ...pair, source_device_id: ['SOURCE'] }), /另外两台/)
  await assert.rejects(manage({ action: 'enable', ...pair, network_id: '../master' }), /不可用/)
  assert.deepEqual(calls, [])
  assert.ok(requiresLocalRelayConsent('/api/networks/' + networkId + '/sftp-relay'))
  assert.ok(requiresLocalRelayConsent('/api/devices/DESK/sftp-relay/consent'))
  assert.equal(requiresLocalRelayConsent('/api/networks'), false)
})

test('renderer entry points use the dedicated bridge and the transfer panes pass the selected devices', () => {
  const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const main = read('apps/tether-app/main.js')
  const preload = read('apps/tether-app/preload.js')
  const app = read('packages/tether-ui/src/app.js')
  const transfer = read('packages/tether-ui/src/transfer-page.js')
  assert.match(main, /handleTrusted\('tether:sftp-relay'/)
  assert.match(main, /if \(requiresLocalRelayConsent\(decodedPath\)\) throw/)
  assert.match(preload, /sftpRelay: \(request\) => ipcRenderer.invoke\('tether:sftp-relay', request\)/)
  assert.doesNotMatch(preload, /localApiToken/)
  assert.match(app, /host\?\.kind === 'app' && host.sftpRelay/)
  assert.match(app, /允许这台设备为此私网自动转发/)
  assert.match(app, /action: 'setPolicy'/)
  assert.match(transfer, /onLocalRelay\(relaySource, target.device\)/)
})


test('owner preference survives a new manager and can be turned off without the Hub', async () => {
  let persistent = false
  const scope = { network_id: networkId }
  const local = async (url, options) => {
    assert.equal(options.headers.authorization, 'Bearer local-test-token')
    assert.equal(new URL(url).origin, 'http://127.0.0.1:18894')
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      assert.deepEqual(body, { ...scope, persistent: true, enabled: !persistent })
      persistent = body.enabled
    } else {
      assert.equal(new URL(url).searchParams.get('network_id'), networkId)
    }
    return reply({ ...scope, persistent })
  }
  const manager = () => createSftpRelayManager({ fetchLocal: local, fetchHub: () => assert.fail('unexpected Hub request') })
  const host = { device: 'DESK', port: 18894, token: 'local-test-token', controller: 'https://hub.invalid' }
  assert.equal((await manager()({ action: 'setPolicy', enabled: true, ...scope }, host)).persistent, true)
  assert.equal((await manager()({ action: 'getPolicy', ...scope }, host)).persistent, true)
  assert.equal((await manager()({ action: 'setPolicy', enabled: false, ...scope }, host)).persistent, false)
})
