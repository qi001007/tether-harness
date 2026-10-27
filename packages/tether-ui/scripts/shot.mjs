import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const edge = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const root = path.resolve(import.meta.dirname, '..', '..', '..')
const profile = path.join(root, '.runtime', 'cdp-webui')
const out = process.argv[2] || path.join(root, '.runtime', 'webui-desktop.png')
const panel = process.argv[3] || '文件资源管理器'
const row = process.argv[4] || ''
const width = Number(process.env.TETHER_SHOT_WIDTH || 1600)
const height = Number(process.env.TETHER_SHOT_HEIGHT || 1000)
const wheel = Number(process.env.TETHER_SHOT_WHEEL || 0)
const port = 9333
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const child = spawn(edge, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--window-size=' + width + ',' + height, 'about:blank'
], { stdio: 'ignore' })

async function version() {
  for (let i = 0; i < 40; i += 1) {
    try { return await (await fetch('http://127.0.0.1:' + port + '/json/version')).json() } catch (_) { await sleep(250) }
  }
  throw new Error('Edge CDP did not start')
}

try {
  await version()
  const page = await (await fetch('http://127.0.0.1:' + port + '/json/new?http://127.0.0.1:18891/', { method: 'PUT' })).json()
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  }
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return reply.result && reply.result.result && reply.result.result.value
  }
  await sleep(2500)
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(panel)} || x.title === ${JSON.stringify(panel)}); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  await sleep(1500)
  if (row) {
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(row)} || x.getAttribute('aria-label') === ${JSON.stringify(row)}); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  }
  if (wheel) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(width * 0.65), y: Math.round(height * 0.5), deltaX: 0, deltaY: wheel, pointerType: 'mouse' })
    await sleep(900)
  }
  await sleep(2000)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log(JSON.stringify({ out, clicked, bytes: fs.statSync(out).size }))
  socket.close()
} finally {
  child.kill()
}