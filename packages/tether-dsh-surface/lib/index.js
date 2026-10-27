import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
export const name = 'tether-dsh-surface'
export const inject = ['webServer', 'connection']

function isLoopbackOrigin(value) {
  let url
  try { url = new URL(value) } catch (_) { return false }
  if (url.protocol !== 'http:' || url.username || url.password) return false
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return false
  const port = Number(url.port || 80)
  return port > 0 && port <= 65535 && url.pathname === '/' && !url.search && !url.hash
}

function descriptorPath() {
  const root = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(root, 'storages', 'tether', 'native-surface.json')
}

function publish(webServer, connection) {
  const origin = webServer.getOrigin()
  if (!isLoopbackOrigin(origin)) throw new Error('tether-dsh-surface requires a plain HTTP loopback DSH listener')
  const descriptor = {
    version: 1,
    pid: process.pid,
    origin,
    authenticated_url: connection.authenticatedUrl(origin),
    updated_at: Date.now()
  }
  const target = descriptorPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  let current
  try { current = JSON.parse(fs.readFileSync(target, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('tether-dsh-surface descriptor is unreadable; refusing to replace it')
  }
  if (current && (current.pid !== process.pid || current.origin !== origin)) {
    let hostAlive = true
    try { process.kill(current.pid, 0) } catch (error) {
      if (error.code === 'ESRCH') hostAlive = false
      else if (error.code !== 'EPERM') throw error
    }
    if (hostAlive) throw new Error('tether-dsh-surface descriptor belongs to another live DSH host; refusing to replace it')
    const latest = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (latest.pid !== current.pid || latest.origin !== current.origin) throw new Error('tether-dsh-surface descriptor changed during startup; refusing to replace it')
    fs.unlinkSync(target)
    current = undefined
  }
  const temp = path.join(path.dirname(target), `.native-surface-${process.pid}-${Date.now()}.tmp`)
  fs.writeFileSync(temp, JSON.stringify(descriptor), { mode: 0o600, flag: 'wx' })
  try {
    if (current) fs.unlinkSync(target)
    fs.linkSync(temp, target)
    fs.unlinkSync(temp)
  } catch (error) {
    try { fs.unlinkSync(temp) } catch (_) { /* already moved */ }
    if (error.code === 'EEXIST') throw new Error('tether-dsh-surface descriptor appeared during startup; refusing to replace it')
    throw error
  }
  return () => {
    try {
      const latest = JSON.parse(fs.readFileSync(target, 'utf8'))
      if (latest.pid === process.pid && latest.origin === origin) fs.unlinkSync(target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

export function apply(ctx) {
  let disposed = false
  let dispose
  ctx.effect(() => () => {
    disposed = true
    dispose?.()
  })
  const start = () => {
    if (!disposed) dispose = publish(ctx.webServer, ctx.connection)
    if (disposed) dispose?.()
  }
  const settled = ctx.get('loader')?.await()
  if (settled === undefined) start()
  else Promise.resolve(settled).then(start).catch((error) => {
    console.error('tether-dsh-surface could not publish its descriptor:', error.message)
  })
}

export const internals = { isLoopbackOrigin, descriptorPath }
