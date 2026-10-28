function safeRendererPath(value) {
  const raw = String(value || '')
  try {
    return new URL(raw).pathname.slice(0, 240) || '/'
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].slice(0, 240)
  }
}

function safeRendererMessage(value) {
  return String(value || '')
    .split(/\r?\n/, 1)[0]
    .replace(/https?:\/\/[^\s)'"<>]+/gi, '[url]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(['"`])[^'"`]*\1/g, '[value]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[value]')
    .slice(0, 240)
}

function rendererDiagnostic(message, source, line) {
  return 'renderer error source=' + safeRendererPath(source) + ':' + Number(line || 0)
    + ' message=' + safeRendererMessage(message)
}

function rendererRequestScope(value, controllerUrl) {
  try {
    const request = new URL(value)
    const hostname = request.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname)) return 'local'
    const controller = new URL(controllerUrl)
    const hub = controller.hostname.toLowerCase()
    if (hostname === hub) return 'hub'
    const labels = hub.split('.')
    const suffix = labels.length > 1 && /^g[a-z0-9-]+$/.test(labels[0])
      ? '.' + labels.slice(1).join('.')
      : '.' + hub
    const gateway = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : ''
    if (/^g[a-z0-9-]+$/.test(gateway)) return 'hub'
  } catch (_) { /* ignore malformed and out-of-scope requests */ }
  return ''
}

function rendererFrameState(frame) {
  return frame.executeJavaScript(`(() => ({
    readyState: document.readyState,
    childElements: document.body ? document.body.children.length : 0,
    hasComposer: !!document.querySelector('textarea,[contenteditable="true"],[data-composer-stat]')
  }))()`)
}

async function rendererSettledFrameState(fromId, processId, routingId, expectedUrl) {
  try {
    const frame = fromId(processId, routingId)
    if (!frame || frame.url !== expectedUrl) return null
    return await rendererFrameState(frame)
  } catch (_) { return null }
}

module.exports = { rendererDiagnostic, rendererFrameState, rendererRequestScope, rendererSettledFrameState, safeRendererMessage, safeRendererPath }
