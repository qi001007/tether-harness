const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const NETWORK_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i
const LEASE_SECONDS = 30 * 60

function requiresLocalRelayConsent(pathname) {
  return /^\/api\/(?:networks\/[^/]+\/sftp-relay|devices\/[^/]+\/sftp-relay\/consent)\/?$/i.test(pathname)
}

const isDeviceId = value => typeof value === 'string' && DEVICE_ID.test(value)

function responseMessage(body, status) {
  const detail = body?.detail
  const message = [detail?.message, detail?.code, detail, body?.message, body?.error?.code, body?.error]
    .find(value => typeof value === 'string' && value.trim())
  return message ? message.trim().slice(0, 180) : 'HTTP ' + status
}

async function requestJson(fetchImpl, url, stage, method, body, headers = {}) {
  let response
  try {
    response = await fetchImpl(url, {
      method,
      headers: { ...headers, 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    })
  } catch (error) {
    throw new Error(stage + (error?.name === 'TimeoutError' ? '超时' : '无法连接'))
  }
  const value = await response.json().catch(() => null)
  if (!response.ok || value?.ok === false) {
    throw new Error(stage + '失败（' + responseMessage(value, response.status) + '）')
  }
  return value?.value ?? value
}

function createSftpRelayManager({ fetchLocal = fetch, fetchHub, now = Date.now }) {
  let writing = false
  return async function manage(request, { device, port, token, controller }) {
    const action = request?.action
    const networkId = request?.network_id
    if (!['list', 'enable', 'disable', 'getPolicy', 'setPolicy'].includes(action) || typeof networkId !== 'string' || !NETWORK_ID.test(networkId) ||
        !isDeviceId(device) || !token || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('本机中转设置或私有网络不可用')
    }
    const local = 'http://127.0.0.1:' + port + '/api/devices/' + encodeURIComponent(device) + '/sftp-relay/consent'
    if (action === 'getPolicy' || action === 'setPolicy') {
      const update = action === 'setPolicy'
      if (update && typeof request.enabled !== 'boolean') throw new Error('请选择是否转发')
      if (update && writing) throw new Error('正在保存本机设置')
      if (update) writing = true
      try {
        const value = await requestJson(fetchLocal, update ? local : local + '?network_id=' + encodeURIComponent(networkId),
          update ? '保存本机中转设置' : '读取本机中转设置', update ? 'POST' : 'GET',
          update ? { network_id: networkId, persistent: true, enabled: request.enabled } : undefined,
          { authorization: 'Bearer ' + token })
        if (value?.network_id !== networkId || typeof value.persistent !== 'boolean' ||
            (update && value.persistent !== request.enabled)) throw new Error('本机节点未确认此私网的设置')
        return { network_id: networkId, persistent: value.persistent }
      } finally {
        if (update) writing = false
      }
    }
    const cloud = new URL('/api/networks/' + encodeURIComponent(networkId) + '/sftp-relay', controller).toString()
    if (action === 'list') {
      const value = await requestJson(fetchHub, cloud, '读取中转状态', 'GET')
      if (!Array.isArray(value?.relays)) throw new Error('Hub 返回的中转状态格式无效')
      return { relays: value.relays.filter(relay => relay?.relay_device_id === device &&
        isDeviceId(relay.source_device_id) && isDeviceId(relay.executor_device_id) &&
        Number.isSafeInteger(relay.expires_at) && Number.isFinite(new Date(relay.expires_at * 1000).getTime())).map(relay => ({
        relay_device_id: device,
        source_device_id: relay.source_device_id,
        executor_device_id: relay.executor_device_id,
        expires_at: relay.expires_at
      })) }
    }

    const source = request.source_device_id
    const executor = request.executor_device_id
    const enabled = action === 'enable'
    const expiry = enabled ? Math.floor(now() / 1000) + LEASE_SECONDS : request.expires_at
    if (!isDeviceId(source) || !isDeviceId(executor) ||
        new Set([device, source, executor]).size !== 3 || !Number.isSafeInteger(expiry) || expiry <= 0) {
      throw new Error('请选择私有网络中的另外两台设备')
    }
    if (writing) throw new Error('正在处理本机中转，请稍后')
    writing = true
    const scope = { source_device_id: source, executor_device_id: executor, expires_at: expiry }
    const consent = (allowed) => requestJson(fetchLocal, local, allowed ? '本机授权' : '停止本机中转', 'POST',
      { network_id: networkId, ...scope, enabled: allowed }, { authorization: 'Bearer ' + token })
    let localApplied = false
    try {
      await consent(enabled)
      localApplied = true
      const value = await requestJson(fetchHub, cloud, enabled ? 'Hub 登记中转' : 'Hub 停用中转',
        enabled ? 'POST' : 'DELETE', { relay_device_id: device, ...scope })
      if (value?.enabled !== enabled || value.relay_device_id !== device ||
          value.source_device_id !== source || value.executor_device_id !== executor ||
          !Number.isSafeInteger(value.expires_at) || value.expires_at > expiry ||
          (enabled && value.expires_at <= Math.floor(now() / 1000))) {
        throw new Error('Hub 未确认这条中转')
      }
      return { enabled, relay_device_id: device, source_device_id: source,
        executor_device_id: executor, expires_at: value.expires_at }
    } catch (error) {
      if (enabled) {
        try { await consent(false) } catch (rollback) {
          throw new Error(error.message + '。' + rollback.message + '，请检查本机服务')
        }
      }
      if (!enabled && localApplied) throw new Error('本机已停止。' + error.message)
      throw error
    } finally {
      writing = false
    }
  }
}

module.exports = { createSftpRelayManager, requiresLocalRelayConsent }
