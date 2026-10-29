const assert = require('node:assert/strict')
const test = require('node:test')
const { isSurfaceBootFailure, rendererDiagnostic, rendererFrameState, rendererRequestScope, rendererSettledFrameState, safeRendererMessage, safeRendererPath } = require('../apps/tether-app/renderer-diagnostics.js')

test('renderer diagnostics retain source and error clues while removing credentials and URL queries', () => {
  const diagnostic = rendererDiagnostic(
    'TypeError: request failed with token=secret-value and "private prompt text"',
    'https://user:pass@example.test/assets/app.js?access_token=secret#section',
    42
  )
  assert.match(diagnostic, /\/assets\/app\.js:42/)
  assert.match(diagnostic, /TypeError/)
  assert.doesNotMatch(diagnostic, /user|pass|secret|private prompt|access_token|#section/)
})

test('renderer error messages strip URL credentials and bearer values', () => {
  const safe = safeRendererMessage('Error https://example.test/path?token=private Bearer abcdef0123456789abcdef0123456789')
  assert.match(safe, /\[url\]/)
  assert.match(safe, /Bearer \[redacted\]/)
  assert.doesNotMatch(safe, /private|abcdef/)
  assert.equal(safeRendererPath('file:///workspace/app.js?key=value'), '/workspace/app.js')
})

test('surface boot activation failures are recognized without matching unrelated renderer errors', () => {
  assert.equal(isSurfaceBootFailure('Error: web boot: 1 entry did not activate\ntether-dsh-client: failed'), true)
  assert.equal(isSurfaceBootFailure('web boot: 2 entries did not activate\nA: failed\nB: failed'), true)
  assert.equal(isSurfaceBootFailure('TypeError: web boot: network down'), false)
  assert.equal(isSurfaceBootFailure('web boot: gateway answered 502'), false)
  assert.equal(isSurfaceBootFailure(''), false)
  assert.equal(isSurfaceBootFailure(undefined), false)
})

test('renderer network diagnostics scope local and configured gateway requests only', () => {
  assert.equal(rendererRequestScope('http://127.0.0.1:18892/api/state?token=x', 'https://g123.example.test'), 'local')
  assert.equal(rendererRequestScope('https://g456.example.test/tether-connect', 'https://g123.example.test'), 'hub')
  assert.equal(rendererRequestScope('https://g456.example.test/tether-connect', 'https://example.test'), 'hub')
  assert.equal(rendererRequestScope('https://unrelated.test/path', 'https://g123.example.test'), '')
  assert.equal(rendererRequestScope('https://g456.other.test/path', 'https://g123.example.test'), '')
})

test('frame diagnostics read only DOM readiness and composer presence', async () => {
  let script = ''
  const state = await rendererFrameState({ executeJavaScript: async (value) => { script = value; return { readyState: 'complete', childElements: 2, hasComposer: true } } })
  assert.deepEqual(state, { readyState: 'complete', childElements: 2, hasComposer: true })
  assert.match(script, /readyState/)
  assert.match(script, /hasComposer/)
  assert.doesNotMatch(script, /innerText|textContent|body\.innerHTML/)
})

test('settled frame diagnostics require the same live frame URL', async () => {
  let executed = false
  const live = { url: 'https://gateway.test/tether-connect?private=x', executeJavaScript: async () => { executed = true; return { readyState: 'complete' } } }
  assert.deepEqual(await rendererSettledFrameState(() => live, 1, 2, live.url), { readyState: 'complete' })
  assert.equal(executed, true)
  executed = false
  assert.equal(await rendererSettledFrameState(() => ({ ...live, url: 'https://gateway.test/other' }), 1, 2, live.url), null)
  assert.equal(executed, false)
  assert.equal(await rendererSettledFrameState(() => null, 1, 2, live.url), null)
})
