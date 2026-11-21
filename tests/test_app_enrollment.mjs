import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { enrollmentDecision, newLocalDeviceId, canEnrollManagedNode, requestLocalPairing } = createRequire(import.meta.url)('../apps/tether-app/enrollment.js')

test('a successful enroll response rotates to the device token', () => {
  const decision = enrollmentDecision(true, { token: 'device-token', device_id: 'DEV-A' })
  assert.equal(decision.mode, 'device')
  assert.equal(decision.token, 'device-token')
})

test('an unknown or offline local device falls back to account registration', () => {
  assert.equal(enrollmentDecision(false, { detail: { code: 'device_not_found' } }).mode, 'account')
  assert.equal(enrollmentDecision(false, { detail: { code: 'device_offline' } }).mode, 'account')
})

test('a device owned by another account is refused instead of being hijacked', () => {
  const decision = enrollmentDecision(false, { detail: { code: 'device_owned', error: 'device belongs to another account' } })
  assert.equal(decision.mode, 'refuse')
  assert.equal(decision.code, 'device_owned')
  assert.match(decision.error, /其他账号/)
})

test('unexpected enrollment failures stay errors and keep the server message', () => {
  const decision = enrollmentDecision(false, { detail: { code: 'login_required', error: 'login required' } })
  assert.equal(decision.mode, 'error')
  assert.equal(decision.code, 'login_required')
  assert.equal(decision.error, 'login required')
  assert.equal(enrollmentDecision(false, null).mode, 'error')
})


test('a new local identity never uses the old hostname as the Hub device ID', () => {
  const first = newLocalDeviceId('QA 本机')
  const second = newLocalDeviceId('QA 本机')
  assert.match(first, /^QA-[0-9a-f]{24}$/)
  assert.notEqual(first, second)
})

test('local enrollment leaves existing managed and external device identities alone', () => {
  const supervisor = { remoteUrl: 'https://hub.example', nodeMode: 'managed', procs: {}, readManagedNodeState: () => null }
  const initial = { supervisor, config: {}, hasDeviceTokenFile: false }
  const cases = [
    { hasDeviceTokenFile: true },
    { config: { device: 'existing-fixture' } },
    { config: { nodeToken: 'old-device-token' } },
    { config: { userToken: 'old-user-token' } },
    { supervisor: { ...supervisor, nodeToken: 'old-device-token' } },
    { supervisor: { ...supervisor, nodeMode: 'external' } },
    { supervisor: { ...supervisor, readManagedNodeState: () => ({ invalid: true }) } },
    { supervisor: { ...supervisor, procs: { node: {} } } }
  ]
  assert.equal(canEnrollManagedNode(initial), true)
  for (const override of cases) assert.equal(canEnrollManagedNode({ ...initial, ...override }), false)
})

test('local enrollment exchanges a one-time code without forwarding the account session', async () => {
  const token = 'test-device-token-'.padEnd(43, 'Z')
  const calls = []
  const options = {
    origin: 'https://hub.example', actorId: 'fixture-user', deviceId: 'fixture-device', platform: 'win32',
    issue: async (url, options) => {
      calls.push([url, options])
      return Response.json({ code: 'ABCD2345' })
    },
    exchange: async (url, options) => {
      calls.push([url, options])
      return Response.json({ device_id: 'fixture-device', owner_id: 'fixture-user', token })
    },
    canContinue: () => true
  }
  assert.equal(await requestLocalPairing(options), token)
  assert.deepEqual(calls.map(([url]) => url), [
    'https://hub.example/api/pairing/codes', 'https://hub.example/api/pairing/exchange'
  ])
  assert.equal(calls[1][1].credentials, 'omit')
  assert.equal(calls[1][1].redirect, 'error')
  assert.equal(calls[1][1].headers.Authorization, undefined)
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    code: 'ABCD2345', device_id: 'fixture-device', name: 'fixture-device', platform: 'win32'
  })
  await assert.rejects(requestLocalPairing({
    ...options,
    canContinue: () => false,
    exchange: () => assert.fail('must not redeem after an account change')
  }), /已变化/)
  await assert.rejects(requestLocalPairing({
    ...options,
    exchange: async () => Response.json({ device_id: 'fixture-device', owner_id: 'foreign-owner', token })
  }), /未确认/)
})
