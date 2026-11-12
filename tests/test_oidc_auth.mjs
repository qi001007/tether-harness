import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const require = createRequire(import.meta.url)
const { createOidcAuth, createPkcePair, createCandidateOidcOpenExternal } = require('../apps/tether-app/oidc-auth.js')
const redirectUri = 'http://127.0.0.1:18893/oauth/callback'

async function listen(server, port = 0, host = '127.0.0.1') {
  server.listen(port, host)
  await once(server, 'listening')
  return server.address().port
}

async function closeServer(server) {
  if (!server.listening) return
  server.closeAllConnections()
  server.close()
  await once(server, 'close')
}

function encryptedStorage() {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    decryptString: (value) => {
      const bytes = Buffer.from(value)
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
}

async function oidcFixture(tokenHandler, apiHandler = null) {
  const calls = []
  const server = createServer(async (request, response) => {
    const body = []
    for await (const chunk of request) body.push(chunk)
    const text = Buffer.concat(body).toString()
    calls.push({ url: request.url, method: request.method, headers: request.headers, body: text })
    if (request.url === '/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`
      }))
      return
    }
    if (request.url === '/token') {
      await tokenHandler(new URLSearchParams(text), response, calls)
      return
    }
    if ((new URL(request.url, 'http://localhost').pathname === '/api' || new URL(request.url, 'http://localhost').pathname === '/api/login') && apiHandler) {
      await apiHandler(request, response, calls)
      return
    }
    response.writeHead(404).end()
  })
  const port = await listen(server)
  const issuer = `http://127.0.0.1:${port}`
  return { server, issuer, calls }
}

test('candidate bootstrap exchanges credentials for code and completes the real loopback callback', async (t) => {
  let payload
  const fixture = await oidcFixture(async (_form, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: 'qa-id', access_token: 'qa-access', expires_in: 3600 }))
  }, async (_request, response, calls) => {
    const call = calls.at(-1)
    payload = JSON.parse(call.body)
    assert.equal(call.url.startsWith('/api/login?'), true)
    const query = new URLSearchParams(call.url.split('?')[1])
    assert.deepEqual(Object.fromEntries(query), {
      clientId: 'tether-desktop', responseType: 'code', redirectUri,
      type: 'code', scope: 'openid profile email offline_access', state: query.get('state'),
      nonce: '', code_challenge_method: 'S256', code_challenge: query.get('code_challenge')
    })
    assert.ok(query.get('state'))
    assert.match(query.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/)
    assert.equal(query.has('username'), false)
    assert.equal(query.has('password'), false)
    assert.equal(call.headers['content-type'], 'application/json')
    assert.equal(call.headers['accept-language'], 'zh-CN')
    assert.equal(call.headers['x-casdoor-device'], 'tether-desktop-development-bootstrap')
    assert.equal(Object.values(call.headers).some((value) => String(value).includes('qa-user') || String(value).includes('秘密密码')), false)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: 'qa-code' }))
  })
  t.after(() => closeServer(fixture.server))
  const dir = mkdtempSync(join(tmpdir(), 'tether-oidc-qa-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const credentialsFile = join(dir, 'credentials.txt')
  writeFileSync(credentialsFile, '用户名：qa-user\n密码：秘密密码\n', 'utf8')
  const auth = makeAuth(fixture.issuer, join(dir, 'session.bin'), {
    openExternal: createCandidateOidcOpenExternal({ issuer: fixture.issuer, credentialsFile })
  })
  t.after(() => auth.close())
  const login = await auth.beginLogin()
  await login.completion
  assert.equal(auth.status().state, 'authenticated')
  assert.equal(payload.username, 'qa-user')
  assert.equal(payload.password, '秘密密码')
  assert.equal(payload.type, 'code')
  assert.equal(payload.signinMethod, 'Password')
  assert.equal(payload.organization, 'tether')
  assert.equal(payload.application, 'tether-desktop')
  assert.equal(payload.autoSignin, true)
  assert.deepEqual(payload, {
    type: 'code', signinMethod: 'Password', organization: 'tether', username: 'qa-user',
    password: '秘密密码', application: 'tether-desktop', autoSignin: true
  })
})

test('candidate bootstrap rejects missing fields and interactive Casdoor responses without exposing password', async (t) => {
  for (const [contents, result] of [['用户名：qa\n', { data: 'qa-code' }], ['用户名：qa\n密码：秘密密码\n', { data: { mfa: true } }]]) {
    const fixture = await oidcFixture(async () => {}, async (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    })
    t.after(() => closeServer(fixture.server))
    const dir = mkdtempSync(join(tmpdir(), 'tether-oidc-qa-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const credentialsFile = join(dir, 'credentials.txt')
    writeFileSync(credentialsFile, contents, 'utf8')
    const auth = makeAuth(fixture.issuer, join(dir, 'session.bin'), {
      openExternal: createCandidateOidcOpenExternal({ issuer: fixture.issuer, credentialsFile })
    })
    t.after(() => auth.close())
    await assert.rejects(auth.beginLogin(), (error) => {
      assert.doesNotMatch(error.message, /秘密密码/)
      return /Candidate OIDC/.test(error.message)
    })
  }
})

function makeAuth(issuer, storageFile, options = {}) {
  return createOidcAuth({
    issuer,
    clientId: 'tether-desktop',
    redirectUri,
    storageFile,
    safeStorage: options.safeStorage || encryptedStorage(),
    openExternal: options.openExternal || (async () => {}),
    fetchImpl: options.fetchImpl || globalThis.fetch,
    log: () => {}
  })
}

function storeSession(storageFile, safeStorage, overrides = {}) {
  const session = {
    id_token: 'saved-id', access_token: 'saved-access', refresh_token: 'saved-refresh',
    expires_at: Date.now() + 60_000, ...overrides
  }
  writeFileSync(storageFile, safeStorage.encryptString(JSON.stringify(session)))
  return session
}

function tokenFetch(handler) {
  return async (input, init = {}) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      const base = url.origin
      return { ok: true, status: 200, json: async () => ({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token` }) }
    }
    if (url.pathname === '/token') return handler(new URLSearchParams(init.body || ''))
    if (url.pathname === '/api') return handler.api ? handler.api(init) : { ok: false, status: 401, json: async () => ({}) }
    throw new Error('Unexpected OIDC test URL')
  }
}

function tokenResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('PKCE verifier and challenge use RFC 7636 S256', () => {
  const { verifier, challenge } = createPkcePair()
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'))
})

test('loopback callback uses the exact path/state and exchanges a code without client_secret', async (t) => {
  let tokenResponseCount = 0
  const fixture = await oidcFixture(async (form, response) => {
    tokenResponseCount += 1
    assert.equal(form.get('grant_type'), 'authorization_code')
    assert.ok(form.get('code_verifier'))
    assert.equal(form.get('redirect_uri'), redirectUri)
    assert.equal(form.has('client_secret'), false)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id_token: 'id-token-one', access_token: 'access-one', refresh_token: 'refresh-one', expires_in: 3600
    }))
  })
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const storageFile = join(storageDir, 'session.bin')
  let authorizationUrl
  const auth = makeAuth(fixture.issuer, storageFile, { openExternal: async (url) => { authorizationUrl = url } })
  t.after(() => auth.close())

  const login = await auth.beginLogin()
  assert.equal(login.authorizationUrl, authorizationUrl)
  const authorization = new URL(authorizationUrl)
  assert.equal(authorization.searchParams.get('response_type'), 'code')
  assert.equal(authorization.searchParams.get('redirect_uri'), redirectUri)
  assert.equal(authorization.searchParams.get('client_id'), 'tether-desktop')
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  const callbackState = authorization.searchParams.get('state')
  const wrongPath = await fetch(`http://127.0.0.1:18893/not-callback?code=bad&state=${callbackState}`)
  assert.equal(wrongPath.status, 404)
  const callback = await fetch(`${redirectUri}?code=good-code&state=${encodeURIComponent(callbackState)}`)
  assert.equal(callback.status, 200)
  assert.deepEqual(await login.completion, { state: 'authenticated' })
  assert.equal(auth.status().state, 'authenticated')
  assert.equal(auth.authorizationHeader(), 'Bearer id-token-one')
  const encrypted = readFileSync(storageFile)
  assert.equal(encrypted.includes(Buffer.from('id-token-one')), false)
  assert.equal((await auth.initialize()).state, 'authenticated')
  assert.equal(auth.authorizationHeader(), 'Bearer id-token-one')
  const tokenCalls = fixture.calls.filter((call) => call.url === '/token')
  assert.equal(tokenCalls.length, 1)
  assert.equal(tokenResponseCount, 1)
})

test('loopback callback rejects an incorrect state without exchanging the code', async (t) => {
  const fixture = await oidcFixture(async (_form, response) => {
    response.writeHead(500).end()
  })
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const auth = makeAuth(fixture.issuer, join(storageDir, 'session.bin'), { safeStorage })
  t.after(() => auth.close())
  const login = await auth.beginLogin()
  const completion = login.completion.catch((error) => error)
  const response = await fetch(`${redirectUri}?code=bad&state=incorrect`)
  assert.equal(response.status, 400)
  assert.match((await completion).message, /state or parameters are invalid/)
  assert.equal(fixture.calls.filter((call) => call.url === '/token').length, 0)
})

test('openExternal failure closes the listener without an unhandled completion rejection', async (t) => {
  const fixture = await oidcFixture(async () => {})
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const auth = makeAuth(fixture.issuer, join(storageDir, 'session.bin'), {
    openExternal: async () => { throw new Error('browser launch failed') }
  })
  t.after(() => auth.close())
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    await assert.rejects(auth.beginLogin(), /browser launch failed/)
    const listenerCheck = createServer()
    assert.equal(await listen(listenerCheck, 18893), 18893)
    await closeServer(listenerCheck)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('failed token exchange returns a non-200 loopback response', async (t) => {
  const fixture = await oidcFixture(async (_form, response) => {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' }))
  })
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const storageFile = join(storageDir, 'session.bin')
  const auth = makeAuth(fixture.issuer, storageFile)
  t.after(() => auth.close())
  const login = await auth.beginLogin()
  const completion = login.completion.catch((error) => error)
  const state = new URL(login.authorizationUrl).searchParams.get('state')
  const response = await fetch(`${redirectUri}?code=expired-code&state=${state}`)
  assert.equal(response.status, 502)
  assert.match(await response.text(), /could not complete sign-in/i)
  assert.match((await completion).message, /OIDC token response is invalid/)
  assert.equal(auth.status().state, 'unauthenticated')
  assert.equal(existsSync(storageFile), false)
})

test('401 refreshes once with a fresh id_token and retries once', async (t) => {
  const apiCalls = []
  const fixture = await oidcFixture(async (form, response) => {
    assert.equal(form.has('client_secret'), false)
    if (form.get('grant_type') === 'refresh_token') {
      assert.equal(form.get('refresh_token'), 'refresh-one')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        id_token: 'id-token-two', access_token: 'access-two', refresh_token: 'refresh-two', expires_in: 3600
      }))
      return
    }
    assert.equal(form.get('grant_type'), 'authorization_code')
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id_token: 'id-token-one', access_token: 'access-one', refresh_token: 'refresh-one', expires_in: 3600
    }))
  }, (request, response) => {
    apiCalls.push(request.headers.authorization)
    response.writeHead(apiCalls.length === 1 ? 401 : 200).end('ok')
  })
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const auth = makeAuth(fixture.issuer, join(storageDir, 'session.bin'), { safeStorage })
  t.after(() => auth.close())
  const login = await auth.beginLogin()
  const state = new URL(login.authorizationUrl).searchParams.get('state')
  await fetch(`${redirectUri}?code=initial&state=${state}`)
  await login.completion

  const authWithAdapter = makeAuth(fixture.issuer, join(storageDir, 'second-session.bin'), { safeStorage })
  // Load the real encrypted session created above through the same safeStorage format.
  const encryptedSession = readFileSync(join(storageDir, 'session.bin'))
  const secondPath = join(storageDir, 'second-session.bin')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(secondPath, encryptedSession)
  await authWithAdapter.initialize()
  const result = await authWithAdapter.fetch(`${fixture.issuer}/api`)
  assert.equal(result.status, 200)
  assert.deepEqual(apiCalls, ['Bearer id-token-one', 'Bearer id-token-two'])
  const tokenCalls = fixture.calls.filter((call) => call.url === '/token')
  assert.equal(tokenCalls.length, 2)
  assert.equal(tokenCalls.filter((call) => new URLSearchParams(call.body).get('grant_type') === 'refresh_token').length, 1)
  assert.equal(authWithAdapter.authorizationHeader(), 'Bearer id-token-two')
  authWithAdapter.close()
})

test('logout clears only OIDC storage and the in-memory session', async (t) => {
  const fixture = await oidcFixture(async (_form, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: 'id', access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
  })
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const storageFile = join(storageDir, 'session.bin')
  const unrelated = join(storageDir, 'hub.json')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(unrelated, 'keep')
  const auth = makeAuth(fixture.issuer, storageFile)
  t.after(() => auth.close())
  const login = await auth.beginLogin()
  const state = new URL(login.authorizationUrl).searchParams.get('state')
  await fetch(`${redirectUri}?code=initial&state=${state}`)
  await login.completion
  auth.logout()
  assert.equal(auth.status().state, 'unauthenticated')
  assert.equal(auth.authorizationHeader(), '')
  assert.equal(existsSync(storageFile), false)
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep')
})

test('occupied fixed callback port fails clearly without selecting another port', async (t) => {
  const occupied = createServer((_request, response) => response.end())
  const actualPort = await listen(occupied, 18893)
  assert.equal(actualPort, 18893)
  t.after(() => closeServer(occupied))
  const fixture = await oidcFixture(async () => {})
  t.after(() => closeServer(fixture.server))
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const auth = makeAuth(fixture.issuer, join(storageDir, 'session.bin'))
  t.after(() => auth.close())
  await assert.rejects(auth.beginLogin(), /callback port 18893 is occupied/)
})

test('a new auth instance restores the encrypted session without reopening the browser', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage)
  let browserCalls = 0
  const auth = makeAuth('https://issuer.invalid', storageFile, {
    safeStorage,
    openExternal: async () => { browserCalls += 1 }
  })
  t.after(() => auth.close())
  assert.equal((await auth.initialize()).state, 'authenticated')
  assert.equal(browserCalls, 0)
  assert.equal(auth.authorizationHeader(), 'Bearer saved-id')
  auth.close()
  assert.equal(existsSync(storageFile), true)
})

test('temporary safeStorage unavailability preserves the session for a later status check', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage)
  const original = readFileSync(storageFile)
  safeStorage.isEncryptionAvailable = () => false
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage })
  t.after(() => auth.close())
  assert.equal((await auth.initialize()).state, 'retryable')
  assert.deepEqual(readFileSync(storageFile), original)
  safeStorage.isEncryptionAvailable = () => true
  assert.equal((await auth.ensureSession()).state, 'authenticated')
  assert.equal(auth.authorizationHeader(), 'Bearer saved-id')
})

test('expired session refresh rotates credentials and survives a new auth instance', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage, { expires_at: Date.now() - 1 })
  let refreshCalls = 0
  const fetchImpl = tokenFetch(async (form) => {
    assert.equal(form.get('grant_type'), 'refresh_token')
    assert.equal(form.get('refresh_token'), 'saved-refresh')
    refreshCalls += 1
    return tokenResponse(200, { id_token: 'rotated-id', access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 })
  })
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl })
  t.after(() => auth.close())
  assert.equal((await auth.initialize()).state, 'retryable')
  assert.equal((await auth.ensureSession()).state, 'authenticated')
  assert.equal(auth.authorizationHeader(), 'Bearer rotated-id')
  const reopened = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl })
  t.after(() => reopened.close())
  assert.equal((await reopened.initialize()).state, 'authenticated')
  assert.equal(reopened.authorizationHeader(), 'Bearer rotated-id')
  assert.equal(refreshCalls, 1)
})

test('business fetch refreshes an expired session before sending its request', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage, { expires_at: Date.now() + 10 })
  let apiAuthorization = ''
  const handler = async () => tokenResponse(200, { id_token: 'preflight-id', access_token: 'preflight-access', refresh_token: 'preflight-refresh', expires_in: 3600 })
  handler.api = async (init) => {
    apiAuthorization = new Headers(init.headers).get('Authorization')
    return tokenResponse(200, {})
  }
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl: tokenFetch(handler) })
  t.after(() => auth.close())
  await auth.initialize()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal((await auth.fetch('https://issuer.invalid/api')).status, 200)
  assert.equal(apiAuthorization, 'Bearer preflight-id')
})

test('temporary refresh failures preserve the encrypted file and a later status check recovers', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage, { expires_at: Date.now() - 1 })
  const original = readFileSync(storageFile)
  let refreshCalls = 0
  const fetchImpl = tokenFetch(async () => {
    refreshCalls += 1
    if (refreshCalls === 1) throw new Error('network unavailable')
    if (refreshCalls === 2) return tokenResponse(503, { error: 'invalid_grant' })
    return tokenResponse(200, { id_token: 'recovered-id', access_token: 'recovered-access', refresh_token: 'recovered-refresh', expires_in: 3600 })
  })
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl })
  t.after(() => auth.close())
  assert.equal((await auth.initialize()).state, 'retryable')
  assert.deepEqual(readFileSync(storageFile), original)
  assert.equal((await auth.ensureSession()).state, 'retryable')
  assert.deepEqual(readFileSync(storageFile), original)
  assert.equal((await auth.ensureSession()).state, 'retryable')
  assert.deepEqual(readFileSync(storageFile), original)
  assert.equal((await auth.ensureSession()).state, 'authenticated')
  assert.equal(auth.authorizationHeader(), 'Bearer recovered-id')
  assert.equal(refreshCalls, 3)
})

test('invalid_grant clears the unusable persisted session', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage, { expires_at: Date.now() - 1 })
  const auth = makeAuth('https://issuer.invalid', storageFile, {
    safeStorage,
    fetchImpl: tokenFetch(async () => tokenResponse(400, { error: 'invalid_grant' }))
  })
  t.after(() => auth.close())
  assert.equal((await auth.initialize()).state, 'retryable')
  assert.equal((await auth.ensureSession()).state, 'unauthenticated')
  assert.equal(existsSync(storageFile), false)
})

test('an expired session without a refresh token is cleared instead of retrying forever', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage, { refresh_token: undefined, expires_at: Date.now() - 1 })
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage })
  t.after(() => auth.close())
  assert.equal((await auth.initialize()).state, 'retryable')
  assert.equal((await auth.ensureSession()).state, 'unauthenticated')
  assert.equal(existsSync(storageFile), false)
})

test('a temporary refresh failure after 401 preserves the session and is not reported as login failure', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage)
  const original = readFileSync(storageFile)
  const handler = async () => { throw new Error('network unavailable') }
  handler.api = async () => tokenResponse(401, {})
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl: tokenFetch(handler) })
  t.after(() => auth.close())
  await auth.initialize()
  await assert.rejects(auth.fetch('https://issuer.invalid/api'), (error) => error.code === 'OIDC_REFRESH_UNAVAILABLE')
  assert.deepEqual(readFileSync(storageFile), original)
})

test('parallel 401 responses share one refresh and retry with the rotated token', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage)
  let refreshCalls = 0
  let apiCalls = 0
  let startRefresh
  let releaseRefresh
  const refreshStarted = new Promise((resolve) => { startRefresh = resolve })
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve })
  const handler = async (form) => {
    assert.equal(form.get('grant_type'), 'refresh_token')
    refreshCalls += 1
    startRefresh()
    await refreshGate
    return tokenResponse(200, { id_token: 'parallel-id', access_token: 'parallel-access', refresh_token: 'parallel-refresh', expires_in: 3600 })
  }
  handler.api = async (init) => {
    apiCalls += 1
    return tokenResponse(new Headers(init.headers).get('Authorization') === 'Bearer parallel-id' ? 200 : 401, {})
  }
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl: tokenFetch(handler) })
  t.after(() => auth.close())
  await auth.initialize()
  const requests = [auth.fetch('https://issuer.invalid/api'), auth.fetch('https://issuer.invalid/api'), auth.fetch('https://issuer.invalid/api')]
  await refreshStarted
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(apiCalls, 3)
  releaseRefresh()
  const responses = await Promise.all(requests)
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200])
  assert.equal(refreshCalls, 1)
})

test('logout while refresh is in flight cannot restore the session file', async (t) => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tether-oidc-'))
  t.after(() => rmSync(storageDir, { recursive: true, force: true }))
  const safeStorage = encryptedStorage()
  const storageFile = join(storageDir, 'session.bin')
  storeSession(storageFile, safeStorage)
  let startRefresh
  let releaseRefresh
  const refreshStarted = new Promise((resolve) => { startRefresh = resolve })
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve })
  const handler = async () => {
    startRefresh()
    await refreshGate
    return tokenResponse(200, { id_token: 'resurrected-id', access_token: 'resurrected-access', refresh_token: 'resurrected-refresh', expires_in: 3600 })
  }
  handler.api = async () => tokenResponse(401, {})
  const auth = makeAuth('https://issuer.invalid', storageFile, { safeStorage, fetchImpl: tokenFetch(handler) })
  t.after(() => auth.close())
  await auth.initialize()
  const request = auth.fetch('https://issuer.invalid/api')
  await refreshStarted
  auth.logout()
  releaseRefresh()
  assert.equal((await request).status, 401)
  assert.equal(auth.status().state, 'unauthenticated')
  assert.equal(existsSync(storageFile), false)
})
