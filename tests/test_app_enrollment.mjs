import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { enrollmentDecision } = createRequire(import.meta.url)('../apps/tether-app/enrollment.js')

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
