'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PORT = 18893
const CALLBACK_PATH = '/oauth/callback'

function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function createCandidateOidcOpenExternal({ issuer, credentialsFile, fetchImpl = globalThis.fetch }) {
  return async function openCandidateLogin(authorizationUrl) {
    let authorization
    let credentials
    try {
      authorization = new URL(authorizationUrl)
      const issuerUrl = new URL(issuer)
      if (authorization.origin !== issuerUrl.origin || authorization.searchParams.get('response_type') !== 'code' ||
        !authorization.searchParams.get('client_id') || !authorization.searchParams.get('redirect_uri') ||
        !authorization.searchParams.get('state') || !authorization.searchParams.get('code_challenge') ||
        authorization.searchParams.get('code_challenge_method') !== 'S256') throw new Error()
      const lines = fs.readFileSync(credentialsFile, 'utf8').split(/\r?\n/)
      const usernameLine = lines.find((line) => line.startsWith('用户名：'))
      const passwordLine = lines.find((line) => line.startsWith('密码：'))
      const username = usernameLine && usernameLine.slice('用户名：'.length).trim()
      const password = passwordLine && passwordLine.slice('密码：'.length).trim()
      if (!username || !password || lines.filter((line) => line.startsWith('用户名：')).length !== 1 ||
        lines.filter((line) => line.startsWith('密码：')).length !== 1) throw new Error()
      credentials = { username, password }
    } catch (_) {
      throw new Error('Candidate OIDC credentials or authorization request is invalid')
    }

    const params = new URLSearchParams({
      clientId: authorization.searchParams.get('client_id'),
      responseType: authorization.searchParams.get('response_type'),
      redirectUri: authorization.searchParams.get('redirect_uri'),
      type: 'code',
      scope: authorization.searchParams.get('scope') || '',
      state: authorization.searchParams.get('state'),
      nonce: authorization.searchParams.get('nonce') || '',
      code_challenge_method: authorization.searchParams.get('code_challenge_method'),
      code_challenge: authorization.searchParams.get('code_challenge')
    })
    const response = await fetchImpl(`${issuer.replace(/\/$/, '')}/api/login?${params}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'zh-CN',
        'x-casdoor-device': 'tether-desktop-development-bootstrap'
      },
      body: JSON.stringify({ type: 'code', signinMethod: 'Password', organization: 'tether', ...credentials, application: 'tether-desktop', autoSignin: true })
    }).catch(() => { throw new Error('Candidate OIDC sign-in request failed') })
    let result
    try { result = await response.json() } catch (_) { throw new Error('Candidate OIDC sign-in response is invalid') }
    if (!response.ok || !result || typeof result.data !== 'string' || !result.data.trim()) {
      throw new Error('Candidate OIDC sign-in requires unsupported interaction or failed')
    }
    let callback
    try {
      callback = new URL(authorization.searchParams.get('redirect_uri'))
      if (callback.origin !== `http://${CALLBACK_HOST}:${CALLBACK_PORT}` || callback.pathname !== CALLBACK_PATH) throw new Error()
    } catch (_) { throw new Error('Candidate OIDC callback request is invalid') }
    callback.search = new URLSearchParams({ code: result.data, state: authorization.searchParams.get('state') }).toString()
    const callbackResponse = await fetchImpl(callback, { method: 'GET' }).catch(() => { throw new Error('Candidate OIDC callback failed') })
    if (!callbackResponse.ok) throw new Error('Candidate OIDC callback failed')
  }
}

function createOidcAuth({ issuer, clientId, redirectUri, storageFile, safeStorage, openExternal, fetchImpl = globalThis.fetch, log = () => {} }) {
  const expectedRedirectUri = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`
  if (redirectUri !== expectedRedirectUri) throw new Error(`redirectUri must be ${expectedRedirectUri}`)

  let session = null
  let metadataPromise = null
  let loginServer = null
  let loginPending = false
  let rejectPendingLogin = null
  let closed = false

  async function discover() {
    if (!metadataPromise) {
      metadataPromise = (async () => {
        const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
        const response = await fetchImpl(discoveryUrl)
        if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}`)
        const metadata = await response.json()
        if (!metadata || metadata.issuer !== issuer || typeof metadata.authorization_endpoint !== 'string' || typeof metadata.token_endpoint !== 'string') {
          throw new Error('OIDC discovery response is invalid')
        }
        new URL(metadata.authorization_endpoint)
        new URL(metadata.token_endpoint)
        return metadata
      })().catch((error) => {
        metadataPromise = null
        throw error
      })
    }
    return metadataPromise
  }

  function clearStorage() {
    session = null
    try { fs.rmSync(storageFile, { force: true }) } catch (error) { log('oidc-storage-clear-failed', error) }
  }

  function validateSession(value) {
    return value && typeof value.id_token === 'string' && value.id_token.length > 0 &&
      typeof value.access_token === 'string' && value.access_token.length > 0 &&
      Number.isFinite(value.expires_at) &&
      (value.refresh_token === undefined || typeof value.refresh_token === 'string')
  }

  function persist() {
    const directory = path.dirname(storageFile)
    fs.mkdirSync(directory, { recursive: true })
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    const temporaryFile = `${storageFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    try {
      fs.writeFileSync(temporaryFile, encrypted, { mode: 0o600 })
      fs.chmodSync(temporaryFile, 0o600)
      fs.renameSync(temporaryFile, storageFile)
      fs.chmodSync(storageFile, 0o600)
    } catch (error) {
      try { fs.rmSync(temporaryFile, { force: true }) } catch {}
      throw error
    }
  }

  async function exchangeToken(form) {
    const metadata = await discover()
    const response = await fetchImpl(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, client_id: clientId }).toString()
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || typeof body.id_token !== 'string' || !body.id_token ||
      typeof body.access_token !== 'string' || !body.access_token ||
      !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0 ||
      (body.refresh_token !== undefined && typeof body.refresh_token !== 'string')) {
      throw new Error(body && body.error_description || `OIDC token response is invalid (HTTP ${response.status})`)
    }
    return {
      id_token: body.id_token,
      access_token: body.access_token,
      ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
      expires_at: Date.now() + Number(body.expires_in) * 1000
    }
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) {
      clearStorage()
      return false
    }
    try {
      const refreshed = await exchangeToken({ grant_type: 'refresh_token', refresh_token: session.refresh_token })
      session = { ...refreshed, refresh_token: refreshed.refresh_token || session.refresh_token }
      persist()
      return true
    } catch (error) {
      log('oidc-refresh-failed', error)
      clearStorage()
      return false
    }
  }

  async function initialize() {
    if (!fs.existsSync(storageFile)) return status()
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Electron safeStorage encryption is unavailable')
      const encrypted = fs.readFileSync(storageFile)
      const decoded = JSON.parse(safeStorage.decryptString(encrypted))
      if (!validateSession(decoded)) throw new Error('Stored OIDC session is invalid')
      session = decoded
      if (session.expires_at <= Date.now()) await refreshSession()
    } catch (error) {
      log('oidc-storage-invalid', error)
      clearStorage()
    }
    return status()
  }

  function status() {
    return { state: session && session.expires_at > Date.now() ? 'authenticated' : 'unauthenticated' }
  }

  async function beginLogin() {
    if (loginPending) throw new Error('An OIDC login is already in progress')
    if (closed) throw new Error('OIDC auth module is closed')
    loginPending = true
    let metadata
    try {
      metadata = await discover()
    } catch (error) {
      loginPending = false
      throw error
    }
    const { verifier, challenge } = createPkcePair()
    const state = crypto.randomBytes(24).toString('base64url')
    const authorization = new URL(metadata.authorization_endpoint)
    authorization.search = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      scope: 'openid profile email offline_access', state,
      code_challenge: challenge, code_challenge_method: 'S256'
    }).toString()

    let resolveCompletion
    let rejectCompletion
    const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject })
    rejectPendingLogin = rejectCompletion
    const server = http.createServer(async (request, response) => {
      const callback = new URL(request.url, `http://${CALLBACK_HOST}:${CALLBACK_PORT}`)
      if (request.method !== 'GET' || callback.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { connection: 'close' }).end('Not found')
        return
      }
      server.close()
      loginServer = null
      rejectPendingLogin = null
      const callbackState = callback.searchParams.get('state')
      const code = callback.searchParams.get('code')
      const error = callback.searchParams.get('error')
      if (!callbackState || callbackState !== state || (!!code === !!error) || (error && !/^[A-Za-z0-9_.-]+$/.test(error))) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('Invalid OIDC callback. Return to Tether and try again.')
        loginPending = false
        rejectCompletion(new Error('OIDC callback state or parameters are invalid'))
        return
      }
      if (error) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('Sign-in was not completed. Return to Tether to try again.')
        loginPending = false
        rejectCompletion(new Error(`OIDC authorization failed: ${error}`))
        return
      }
      try {
        session = await exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
        persist()
        loginPending = false
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end('Sign-in complete. You can return to Tether.')
        resolveCompletion({ state: 'authenticated' })
      } catch (exchangeError) {
        clearStorage()
        loginPending = false
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('Tether could not complete sign-in. Return to the app and try again.')
        rejectCompletion(exchangeError)
      }
    })
    loginServer = server
    await new Promise((resolve, reject) => {
      server.once('error', (error) => {
        loginServer = null
        loginPending = false
        rejectPendingLogin = null
        if (error.code === 'EADDRINUSE') reject(new Error(`OIDC callback port ${CALLBACK_PORT} is occupied`))
        else reject(error)
      })
      server.listen(CALLBACK_PORT, CALLBACK_HOST, resolve)
    })
    try {
      await openExternal(authorization.toString())
    } catch (error) {
      server.close()
      loginServer = null
      loginPending = false
      rejectPendingLogin = null
      throw error
    }
    return { authorizationUrl: authorization.toString(), completion }
  }

  async function fetchWithAuth(url, init = {}) {
    if (!session) return fetchImpl(url, init)
    const withBearer = () => ({ ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${session.id_token}` } })
    const first = await fetchImpl(url, withBearer())
    if (first.status !== 401) return first
    if (!await refreshSession()) return first
    return fetchImpl(url, withBearer())
  }

  function authorizationHeader() {
    return status().state === 'authenticated' ? `Bearer ${session.id_token}` : ''
  }

  function logout() {
    clearStorage()
  }

  function close() {
    closed = true
    if (loginServer) {
      loginServer.close()
      loginServer = null
      loginPending = false
      const reject = rejectPendingLogin
      rejectPendingLogin = null
      if (reject) reject(new Error('OIDC login was closed before completion'))
    }
  }

  return { initialize, status, beginLogin, fetch: fetchWithAuth, authorizationHeader, logout, close }
}

module.exports = { createOidcAuth, createPkcePair, createCandidateOidcOpenExternal }
