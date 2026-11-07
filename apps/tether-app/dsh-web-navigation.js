'use strict'

function dshViewUrlAllowed(value) {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  } catch (_) { return false }
}

function createDshWebNavigationGuard(initialUrl) {
  let origin = ''
  try {
    const parsed = new URL(String(initialUrl || ''))
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origin = parsed.origin
  } catch (_) { /* the guest may start at about:blank */ }

  const targetOrigin = (value) => {
    try {
      const parsed = new URL(String(value || ''))
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : ''
    } catch (_) { return '' }
  }

  return {
    navigate(value) {
      if (String(value) === 'about:blank' && !origin) return true
      const nextOrigin = targetOrigin(value)
      if (!origin && nextOrigin && dshViewUrlAllowed(value)) origin = nextOrigin
      return !!origin && nextOrigin === origin
    },
    didStart(value, isMainFrame) {
      if (!isMainFrame) return true
      if (String(value) === 'about:blank' && !origin) return true
      const nextOrigin = targetOrigin(value)
      if (!origin && nextOrigin && dshViewUrlAllowed(value)) origin = nextOrigin
      return !!origin && nextOrigin === origin
    },
    redirect(value, isMainFrame) {
      if (isMainFrame === false) return true
      const nextOrigin = targetOrigin(value)
      return !!origin && !!nextOrigin && nextOrigin === origin
    },
    get origin() { return origin }
  }
}

module.exports = { createDshWebNavigationGuard, dshViewUrlAllowed }
