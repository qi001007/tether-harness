'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const tls = require('node:tls')
const { SocksClient } = require('socks')
const { createNativeWorkbench } = require('../native-workbench.js')

const originalTlsConnect = tls.connect
const originalSocksConnect = SocksClient.createConnection

test.after(() => {
  tls.connect = originalTlsConnect
  SocksClient.createConnection = originalSocksConnect
})

function jsonResponse(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value }
}

function createWorkbench({ serviceId = 'codeg', onOpen } = {}) {
  const operationIds = []
  const caPem = 'isolated-qa-test-ca'
  const caHash = crypto.createHash('sha256').update(caPem).digest('hex')
  const descriptor = {
    protocol: 1,
    target_id: 'qa-target',
    id: serviceId,
    state: 'ready',
    transport: 'caddy-easytier',
    endpoint: 'https://10.224.10.20:52002/',
    network_id: 'qa-network',
    grant_id: 'qa-grant',
    operation_id: 'server-effective-operation',
    lease_expires_at: Date.now() / 1000 + 3600,
    bootstrap: {
      method: 'POST',
      ticket: 'one-use-qa-ticket',
      expires_at: Date.now() / 1000 + 300,
      url: 'https://10.224.10.20:52002/__tether/bootstrap'
    },
    tls: { root_ca_pem: caPem, root_ca_sha256: caHash, epoch: caHash.slice(0, 16) }
  }
  if (serviceId === 'desktop') {
    descriptor.guest_path = '/sharing?c=isolated-qa'
    descriptor.consent = 'prompt'
    descriptor.view_only = false
    descriptor.native_session_expires_at = Date.now() / 1000 + 3600
  }
  const revokeCalls = []
  const closeCalls = []
  const loginSession = {
    fetch: async (url, request) => {
      const path = new URL(url).pathname
      if (path.endsWith('/service_catalog')) return jsonResponse(200, {
        protocol: 1, target_id: 'qa-target', services: [{ id: serviceId, state: 'ready' }]
      })
      if (path.endsWith('/service_open')) {
        const body = JSON.parse(request.body)
        operationIds.push(body.operation_id)
        if (onOpen) return onOpen(operationIds.length, descriptor)
        return jsonResponse(200, descriptor)
      }
      if (path.endsWith('/service_revoke')) {
        revokeCalls.push(JSON.parse(request.body))
        return jsonResponse(200, { grant_id: 'qa-grant', state: 'revoked', connections_closed: true })
      }
      if (path.endsWith('/service_close')) {
        closeCalls.push(JSON.parse(request.body))
        return jsonResponse(200, { grant_id: 'qa-grant', state: 'view_closed' })
      }
      throw new Error('unexpected QA endpoint')
    }
  }
  const serviceSession = {
    setProxy: async () => {},
    closeAllConnections: async () => {},
    setCertificateVerifyProc: () => {},
    webRequest: { onBeforeRequest: () => {} },
    fetch: async () => ({ ok: true, status: 200 })
  }
  const workbench = createNativeWorkbench({
    controllerUrl: 'http://127.0.0.1:32101',
    loginSession,
    getServiceSession: () => serviceSession,
    getActorId: async () => 'qa-actor',
    getLocalDeviceId: async () => 'qa-source',
    getSourceRoute: async (networkId, deviceId) => ({
      protocol: 1, state: 'ready', network_id: networkId, device_id: deviceId,
      socks_proxy: { host: '127.0.0.1', port: 1080 }
    })
  })
  return { workbench, operationIds, revokeCalls, closeCalls }
}

test('close then reopen gets a fresh operation id; unknown failure retains the id', async (t) => {
  SocksClient.createConnection = async () => ({ socket: { destroy: () => {} } })
  tls.connect = () => {
    const socket = new EventEmitter()
    socket.setTimeout = () => {}
    socket.end = () => {}
    socket.getPeerCertificate = () => ({ raw: Buffer.from('qa-leaf') })
    process.nextTick(() => socket.emit('secureConnect'))
    return socket
  }

  await t.test('successful close followed by reopen uses a new operation id', async () => {
    const { workbench, operationIds } = createWorkbench()
    const opened = await workbench.open('qa-target', 'codeg')
    await workbench.close('qa-target', 'codeg', opened.grantId)
    await workbench.open('qa-target', 'codeg')
    assert.equal(operationIds.length, 2)
    assert.notEqual(operationIds[0], operationIds[1])
  })

  await t.test('desktop close revokes the returned operation and confirms closure', async () => {
    const { workbench, operationIds, revokeCalls, closeCalls } = createWorkbench({ serviceId: 'desktop' })
    const opened = await workbench.open('qa-target', 'desktop')
    await workbench.close('qa-target', 'desktop', opened.grantId)
    assert.equal(revokeCalls.length, 1)
    assert.equal(revokeCalls[0].operation_id, 'server-effective-operation')
    assert.equal(closeCalls.length, 0)
    assert.notEqual(operationIds[0], revokeCalls[0].operation_id)
  })

  await t.test('unknown open timeout retains its operation id for explicit retry', async () => {
    const { workbench, operationIds } = createWorkbench({
      onOpen: (count) => {
        if (count === 1) return Promise.reject(new Error('temporary transport failure'))
        return Promise.reject(new Error('temporary transport failure'))
      }
    })
    await assert.rejects(workbench.open('qa-target', 'codeg'), /temporary transport failure/)
    await assert.rejects(workbench.open('qa-target', 'codeg'), /temporary transport failure/)
    assert.equal(operationIds.length, 2)
    assert.equal(operationIds[0], operationIds[1])
  })

  await t.test('structured operation conflict clears the terminal operation id', async () => {
    const { workbench, operationIds } = createWorkbench({
      onOpen: (count, descriptor) => count === 1
        ? jsonResponse(409, { detail: { code: 'operation_conflict' } })
        : jsonResponse(200, descriptor)
    })
    await assert.rejects(workbench.open('qa-target', 'codeg'), /本次工作台会话已结束，请重新打开。/)
    await workbench.open('qa-target', 'codeg')
    assert.equal(operationIds.length, 2)
    assert.notEqual(operationIds[0], operationIds[1])
  })
})
