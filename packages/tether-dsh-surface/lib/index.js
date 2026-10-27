import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalPluginUpdateHandler, selectedProfile } from './local-updates.js'
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

function identityDirectory() {
  const root = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(root, 'storages', 'tether')
}

function pidIsAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

function readLocalDeviceId({ directory = identityDirectory(), now = Date.now(), isPidAlive = pidIsAlive } = {}) {
  let names
  try { names = fs.readdirSync(directory) } catch (_) { return null }
  const ids = new Set()
  for (const name of names) {
    const match = /^node-identity-(\d+)\.json$/.exec(name)
    if (!match) continue
    const file = path.join(directory, name)
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.size > 4096) continue
      const descriptor = JSON.parse(fs.readFileSync(file, 'utf8'))
      const pid = Number(match[1])
      if (descriptor.version !== 1 || descriptor.pid !== pid || !Number.isSafeInteger(pid) || pid <= 0
          || typeof descriptor.device_id !== 'string' || !descriptor.device_id || descriptor.device_id.length > 256
          || /[\u0000-\u001f\u007f]/.test(descriptor.device_id)
          || !Number.isFinite(descriptor.updated_at) || now - descriptor.updated_at > 12000
          || descriptor.updated_at - now > 5000 || !isPidAlive(pid)) continue
      ids.add(descriptor.device_id)
    } catch (_) { /* invalid, stale, or racing descriptor is unknown */ }
  }
  return ids.size === 1 ? ids.values().next().value : null
}

function installedProfile() {
  const root = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  return selectedProfile(packageRoot, root) || null
}

function publish(webServer, connection) {
  const origin = webServer.getOrigin()
  if (!isLoopbackOrigin(origin)) throw new Error('tether-dsh-surface requires a plain HTTP loopback DSH listener')
  const descriptor = {
    version: 1,
    pid: process.pid,
    profile: installedProfile(),
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

function registerRpc(rpc, route, handler) {
  if (!rpc || typeof rpc.handle !== 'function') return () => {}
  try {
    const dispose = rpc.handle(route, handler)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (error) {
    console.error('tether-dsh-surface could not register ' + route + ':', error?.message || error)
    return () => {}
  }
}

export function apply(ctx) {
  let disposed = false
  let dispose
  const rpc = ctx.connection && ctx.connection.rpc
  const disposeUpdates = registerRpc(rpc, '/tether-updates', createLocalPluginUpdateHandler({ env: process.env }))
  const disposeIdentity = registerRpc(rpc, '/tether-identity', (action, _payload, _signal, peer) => {
    if (peer?.principal?.kind !== 'owner') {
      return { ok: false, error: { code: 'forbidden', message: 'Only the Host owner may read local Tether identity.', details: {} } }
    }
    if (action !== 'get') throw new Error('unsupported local identity operation')
    return { ok: true, value: { device_id: readLocalDeviceId() } }
  })
  ctx.effect(() => () => {
    disposed = true
    dispose?.()
    void disposeUpdates?.()
    void disposeIdentity?.()
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

export const internals = { isLoopbackOrigin, descriptorPath, installedProfile, identityDirectory, readLocalDeviceId }
