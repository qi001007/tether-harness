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

module.exports = { enrollmentDecision }
