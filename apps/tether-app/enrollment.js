const { randomBytes } = require('node:crypto')

function newLocalDeviceId(hostname) {
  const prefix = String(hostname || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80).replace(/-+$/, '')
  return (prefix || 'Tether') + '-' + randomBytes(12).toString('hex')
}

function canEnrollManagedNode({ supervisor, config, hasDeviceTokenFile }) {
  return !!supervisor.remoteUrl && supervisor.nodeMode === 'managed'
    && config.nodeMode !== 'external' && !config.device && !config.nodeToken && !config.userToken
    && !supervisor.nodeToken && !supervisor.userToken && !hasDeviceTokenFile
    && !supervisor.procs.node && !supervisor.readManagedNodeState()
}

async function requestLocalPairing({ origin, actorId, deviceId, platform, issue, exchange, canContinue }) {
  const request = (body) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  })
  const response = await issue(new URL('/api/pairing/codes', origin).href, request({}))
  if (!response.ok) throw new Error('Hub 未能创建本机配对许可，请重试。')
  const { code } = await response.json()
  if (typeof code !== 'string' || !/^[A-Z0-9]{8}$/.test(code)) throw new Error('Hub 未返回有效的本机配对许可。')
  if (!canContinue()) throw new Error('登录状态或本机身份已变化，请重新确认。')
  const paired = await exchange(new URL('/api/pairing/exchange', origin).href, request({
    code, device_id: deviceId, name: deviceId, platform
  }))
  if (!paired.ok) throw new Error('本机接入失败，请稍后重试。')
  const result = await paired.json()
  if (result?.device_id !== deviceId || result.owner_id !== actorId
      || typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(result.token)) {
    throw new Error('Hub 未确认本机与当前账号的配对。')
  }
  return result.token
}

function enrollmentDecision(responseOk, data) {
  const detail = data && data.detail
  const code = (detail && detail.code) || (data && data.code) || ''
  if (responseOk && data && typeof data.token === 'string' && data.token) {
    return { mode: 'device', token: data.token, code: '' }
  }
  if (code === 'device_owned') {
    return { mode: 'refuse', code, error: '这台设备已属于其他账号' }
  }
  if (code === 'device_not_found' || code === 'device_offline') {
    return { mode: 'account', code }
  }
  return {
    mode: 'error',
    code,
    error: (detail && (detail.error || detail.message)) || (data && data.error) || 'HTTP error'
  }
}

module.exports = { enrollmentDecision, newLocalDeviceId, canEnrollManagedNode, requestLocalPairing }
