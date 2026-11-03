#!/usr/bin/env node
/**
 * Release gate: load each device's native DSH surface in headless Edge and
 * assert the workspace controls are not browser-default UA controls.
 *
 * Usage: node scripts/qa_surface_styles.mjs [device ...]
 * Reads apps/tether-app/data/hub.json for the Hub URL and access token.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HUB_FILE = path.join(ROOT, 'apps', 'tether-app', 'data', 'hub.json')
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
]
const PORT = 9341
const WAIT_MS = 120000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readHub() {
  const data = JSON.parse(fs.readFileSync(HUB_FILE, 'utf8'))
  if (!data.url || !data.accessToken) throw new Error('hub.json needs url and accessToken')
  return data
}

function findEdge() {
  if (process.platform !== 'win32') throw new Error('this gate currently needs Windows Edge')
  const found = EDGE_PATHS.find((value) => fs.existsSync(value))
  if (!found) throw new Error('Microsoft Edge was not found')
  return found
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('CDP endpoint ' + response.status)
  return response.json()
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP socket failed'))
  })
  return {
    ws,
    send: (method, params = {}) => new Promise((resolve) => {
      const next = ++id
      pending.set(next, resolve)
      ws.send(JSON.stringify({ id: next, method, params }))
    })
  }
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await getJson(`http://127.0.0.1:${PORT}/json/version`)
      return
    } catch (_) {
      await sleep(500)
    }
  }
  throw new Error('headless Edge did not expose CDP')
}

async function checkDevice(hub, deviceId, browser) {
  const surface = await fetch(`${hub.url.replace(/\/+$/, '')}/api/devices/${encodeURIComponent(deviceId)}/dsh/surface`, {
    headers: { Authorization: `Bearer ${hub.accessToken}` }
  })
  const surfaceData = await surface.json().catch(() => ({}))
  if (!surface.ok || !surfaceData.url) {
    return { deviceId, ok: false, error: surfaceData.detail || surface.status }
  }
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const targetId = created.result.targetId
  await sleep(500)
  const pages = await getJson(`http://127.0.0.1:${PORT}/json`)
  const page = pages.find((item) => item.id === targetId)
  if (!page) throw new Error('could not find the surface page')
  const client = await connect(page.webSocketDebuggerUrl)
  try {
    await client.send('Page.enable')
    const bootStarted = Date.now()
    await client.send('Page.navigate', { url: surfaceData.url })
    const deadline = Date.now() + WAIT_MS
    let probe = null
    while (Date.now() < deadline) {
      await sleep(500)
      const result = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const input = document.querySelector('input[placeholder*="搜索"]')
          const button = document.querySelector('button')
          const style = (element) => {
            if (!element) return null
            const computed = getComputedStyle(element)
            return {
              borderTopWidth: computed.borderTopWidth,
              borderTopStyle: computed.borderTopStyle,
              backgroundColor: computed.backgroundColor,
              height: computed.height
            }
          }
          return JSON.stringify({
            inputClass: input ? input.className : '',
            input: style(input),
            button: style(button),
            composer: !!document.querySelector('textarea,[contenteditable="true"]')
          })
        })()`,
        returnByValue: true
      })
      probe = JSON.parse(result.result.result.value)
      if (probe.composer && probe.input) break
    }
    const bootMs = Date.now() - bootStarted
    if (!probe || !probe.composer || !probe.input) {
      return { deviceId, ok: false, error: 'surface did not finish booting', probe, bootMs }
    }
    const inputStyled = probe.input.borderTopWidth === '0px'
      && probe.input.borderTopStyle === 'none'
      && probe.input.backgroundColor === 'rgba(0, 0, 0, 0)'
    const buttonStyled = !probe.button || (probe.button.borderTopWidth === '0px'
      && probe.button.borderTopStyle === 'none')
    let warmMs = null
    try {
      const warmStarted = Date.now()
      await client.send('Page.reload', { ignoreCache: false })
      const warmDeadline = Date.now() + WAIT_MS
      while (Date.now() < warmDeadline) {
        await sleep(500)
        const result = await client.send('Runtime.evaluate', {
          expression: `JSON.stringify({composer: !!document.querySelector('textarea,[contenteditable="true"]'), input: !!document.querySelector('input[placeholder*="搜索"]')})`,
          returnByValue: true
        })
        const state = JSON.parse(result.result.result.value)
        if (state.composer && state.input) {
          warmMs = Date.now() - warmStarted
          break
        }
      }
    } catch (_) {
      // A one-time ticket can refuse reload; the cold measurement is still valid.
    }
    return { deviceId, ok: inputStyled && buttonStyled, probe, bootMs, warmMs }
  } finally {
    await client.send('Target.closeTarget', { targetId })
    client.ws.close()
  }
}

async function main() {
  const hub = readHub()
  const devices = process.argv.slice(2)
  if (!devices.length) devices.push('DESKTOP-LOCAL', 'LAPTOP-01')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tether-style-gate-'))
  const edge = spawn(findEdge(), [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--window-size=1680,1050', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true })
  try {
    await waitForCdp()
    const version = await getJson(`http://127.0.0.1:${PORT}/json/version`)
    const browser = await connect(version.webSocketDebuggerUrl)
    let failed = false
    for (const deviceId of devices) {
      const result = await checkDevice(hub, deviceId, browser)
      if (!result.ok) failed = true
      const summary = result.probe
        ? ` boot=${(result.bootMs / 1000).toFixed(1)}s warm=${result.warmMs == null ? 'n/a' : (result.warmMs / 1000).toFixed(1) + 's'} input=${result.probe.inputClass || '(missing)'} border=${result.probe.input?.borderTopWidth}/${result.probe.input?.borderTopStyle} button=${result.probe.button?.borderTopWidth}/${result.probe.button?.borderTopStyle} composer=${result.probe.composer}`
        : ''
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${deviceId}${summary}${result.error ? ' error=' + JSON.stringify(result.error) : ''}`)
    }
    await browser.send('Browser.close')
    browser.ws.close()
    if (failed) process.exitCode = 1
  } finally {
    edge.kill()
    if (edge.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => edge.once('exit', resolve)),
        sleep(5000)
      ])
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch (_) {
      // Edge may still hold the profile briefly; the temp directory is safe to retry later.
    }
  }
}

main().catch((error) => {
  console.error('FAIL surface style gate:', error.message)
  process.exitCode = 1
})
