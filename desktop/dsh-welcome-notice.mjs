#!/usr/bin/env node
// Pre-acknowledge the DeepSeek Harness "预览版说明" notice.
//
// DSH compares that notice's copy version against
// ui-settings-general.welcomeNoticeVersion and only persists the click through
// the Host settings RPC. Preview builds can refuse that write (the client then
// shows "暂时无法保存确认状态，请重试。" and the modal never closes), so seed the
// value into the profile patch layer instead. The version is read from the
// installed build, never hardcoded: a real notice bump must still show.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ENTRY_ID = 'ui-settings-general'
const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-general'
const CLIENT_SUFFIX = '@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'
const FIELD = 'welcomeNoticeVersion'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const check = flag('check')
const revert = flag('revert')
const override = option('version')

function log(message) {
  console.log(`[tether] ${message}`)
}

function fail(message) {
  console.error(`[tether] ${message}`)
  process.exit(1)
}

if (flag('help')) {
  console.log(`usage: node desktop/dsh-welcome-notice.mjs [options]

  (no flags)      seed the acknowledgement into the desktop profile
  --check         report only; exit 1 when the profile would change
  --revert        remove the seeded field again
  --home <dir>    DSH home (default: $DSH_HOME, <app>/.dsh, then ~/.dsh)
  --app <dir>     DeepSeek Harness install (default: auto-detect)
  --profile <id>  profile to touch (default: desktop)
  --all           every profile with a package.json
  --version <v>   skip detection and use this notice version`)
  process.exit(0)
}

function findAppDir() {
  const explicit = option('app')
  if (explicit) return explicit
  const candidates = [
    process.env.DSH_APP_DIR,
    'D:\\DeepSeek Harness',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'),
    '/Applications/DeepSeek Harness.app/Contents/Resources',
    path.join(os.homedir(), 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources'),
    path.join(process.env.ProgramFiles || '', 'DeepSeek Harness')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'resources', 'app.asar'))) return candidate
    if (fs.existsSync(path.join(candidate, 'app.asar'))) return candidate
  }
  return undefined
}

function asarPathFor(appDir) {
  const nested = path.join(appDir, 'resources', 'app.asar')
  return fs.existsSync(nested) ? nested : path.join(appDir, 'app.asar')
}

// Chromium pickle header: uint32 payload size at offset 4, JSON at offset 8
// with a NUL tail. Entry offsets are relative to the end of the header.
function readAsarEntry(asar, matches) {
  const fd = fs.openSync(asar, 'r')
  try {
    const head = Buffer.alloc(8)
    fs.readSync(fd, head, 0, 8, 0)
    const pickleSize = head.readUInt32LE(4)
    if (pickleSize < 8 || pickleSize > 64 * 1024 * 1024) throw new Error('unexpected asar header size')
    const pickle = Buffer.alloc(pickleSize)
    fs.readSync(fd, pickle, 0, pickleSize, 8)
    const header = JSON.parse(pickle.toString('utf8', 8).replace(/\u0000+$/, ''))
    const dataStart = 8 + pickleSize
    let hit
    const walk = (node, prefix) => {
      for (const [name, value] of Object.entries(node.files || {})) {
        if (hit) return
        const full = `${prefix}/${name}`
        if (value.files) walk(value, full)
        else if (matches(full)) hit = { full, value }
      }
    }
    walk(header, '')
    if (!hit) return undefined
    const buffer = Buffer.alloc(Number(hit.value.size))
    fs.readSync(fd, buffer, 0, buffer.length, dataStart + Number(hit.value.offset))
    return { path: hit.full, text: buffer.toString('utf8') }
  } finally {
    fs.closeSync(fd)
  }
}

function readNoticeVersion() {
  if (override) return { version: override, source: '--version' }
  const appDir = findAppDir()
  if (!appDir) fail('DeepSeek Harness install not found; pass --app <dir> or --version <value>.')
  const asar = asarPathFor(appDir)
  if (!fs.existsSync(asar)) fail(`app.asar not found under ${appDir}.`)
  const entry = readAsarEntry(asar, (name) => name.endsWith(CLIENT_SUFFIX))
  if (entry === undefined) fail(`Could not find ${CLIENT_SUFFIX} in ${asar}; pass --version <value>.`)
  const match = entry.text.match(/WELCOME_NOTICE_VERSION\s*=\s*"([^"]+)"/)
  if (match === null) fail(`WELCOME_NOTICE_VERSION not declared in ${entry.path}; pass --version <value>.`)
  return { version: match[1], source: entry.path }
}

function findHome() {
  const explicit = option('home')
  if (explicit) return explicit
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const appDir = findAppDir()
  const portable = appDir === undefined ? undefined : path.join(appDir, '.dsh')
  if (portable !== undefined && fs.existsSync(path.join(portable, 'profiles'))) return portable
  return path.join(os.homedir(), '.dsh')
}

function profileDirs(home) {
  const root = path.join(home, 'profiles')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function blockRange(lines, id) {
  const matcher = new RegExp(`^- id:\\s*["']?${escapeRe(id)}["']?\\s*$`)
  const start = lines.findIndex((line) => matcher.test(line))
  if (start < 0) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- \S/.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

function seed(lines, version) {
  const block = blockRange(lines, ENTRY_ID)
  if (block === undefined) {
    const gap = lines.length > 0 && lines[lines.length - 1].trim() !== '' ? [''] : []
    return [...lines, ...gap, `- id: ${ENTRY_ID}`, `  name: "${PACKAGE_NAME}"`, '  config:', `    ${FIELD}: "${version}"`, '']
  }
  const body = lines.slice(block.start, block.end)
  const fieldIndex = body.findIndex((line) => new RegExp(`^\\s+${FIELD}:`).test(line))
  if (fieldIndex >= 0) {
    const indent = body[fieldIndex].match(/^\s*/)[0]
    const next = [...lines]
    next[block.start + fieldIndex] = `${indent}${FIELD}: "${version}"`
    return next
  }
  const configIndex = body.findIndex((line) => /^\s+config:\s*(\{\s*\})?\s*$/.test(line))
  const next = [...lines]
  if (configIndex >= 0) {
    const configLine = body[configIndex]
    const indent = configLine.match(/^\s*/)[0]
    if (/\{\s*\}/.test(configLine)) next[block.start + configIndex] = `${indent}config:`
    next.splice(block.start + configIndex + 1, 0, `${indent}  ${FIELD}: "${version}"`)
    return next
  }
  next.splice(block.end, 0, '  config:', `    ${FIELD}: "${version}"`)
  return next
}

function unseed(lines) {
  const block = blockRange(lines, ENTRY_ID)
  if (block === undefined) return lines
  const fieldIndex = lines.findIndex((line, index) => index >= block.start && index < block.end && new RegExp(`^\\s+${FIELD}:`).test(line))
  if (fieldIndex < 0) return lines
  const next = lines.filter((_, index) => index !== fieldIndex)
  const body = next.slice(block.start, block.end - 1)
  const onlyShell = body.every((line) => line.trim() === '' || /^\s+name:/.test(line) || /^\s+config:\s*$/.test(line) || /^- id:\s/.test(line))
  if (onlyShell) next.splice(block.start, block.end - block.start - 1)
  return next
}

function readVersionField(text) {
  const lines = text.split('\n')
  const block = blockRange(lines, ENTRY_ID)
  if (block === undefined) return undefined
  const matcher = new RegExp(`^\\s+${FIELD}:\\s*["']?([^"'\\s]+)`)
  for (let i = block.start; i < block.end; i += 1) {
    const match = lines[i].match(matcher)
    if (match !== null) return match[1]
  }
  return undefined
}

function writeWithBackup(file, text) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  let backup = `${file}.bak-tether-notice-${stamp}`
  for (let n = 2; fs.existsSync(backup); n += 1) backup = `${file}.bak-tether-notice-${stamp}-${n}`
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, backup)
    log(`backup: ${backup}`)
  }
  fs.writeFileSync(file, text)
}

const resolved = revert ? { version: undefined, source: 'revert' } : readNoticeVersion()
const { version, source } = resolved
const home = findHome()
if (version !== undefined) log(`DSH notice version ${version} (from ${source})`)
log(`DSH home: ${home}`)

const wanted = option('profile')
const all = flag('all')
const profiles = profileDirs(home)
  .filter((dir) => all || path.basename(dir) === (wanted || 'desktop'))
if (profiles.length === 0) fail(`No DSH profile "${wanted || 'desktop'}" under ${path.join(home, 'profiles')}. Launch DeepSeek Harness once, then rerun.`)

let changed = 0
let pending = 0
for (const dir of profiles) {
  const file = path.join(dir, 'cordis.patch.yml')
  const label = path.basename(dir)
  if (!fs.existsSync(file)) {
    if (revert) {
      log(`${label}: no patch layer, nothing to revert`)
      continue
    }
    if (check) {
      log(`${label}: needs ${FIELD}=${version}`)
      pending += 1
      continue
    }
    writeWithBackup(file, seed([], version).join('\n'))
    log(`${label}: created patch layer with ${FIELD}=${version}`)
    changed += 1
    continue
  }
  const original = fs.readFileSync(file, 'utf8')
  const lines = original.split('\n')
  const current = readVersionField(original)
  if (revert) {
    if (current === undefined) {
      log(`${label}: already clean`)
      continue
    }
    const next = unseed(lines)
    const text = next.join('\n')
    // An emptied patch layer must stay a YAML array; a blank document parses as null.
    writeWithBackup(file, text.trim() === '' ? '[]\n' : text)
    log(`${label}: removed ${FIELD}`)
    changed += 1
    continue
  }
  if (current === version) {
    log(`${label}: already acknowledged`)
    continue
  }
  if (check) {
    log(`${label}: needs ${FIELD}=${version} (currently ${current ?? 'unset'})`)
    pending += 1
    continue
  }
  const next = seed(lines, version)
  if (next.join('\n') === original) {
    log(`${label}: already acknowledged`)
    continue
  }
  writeWithBackup(file, next.join('\n'))
  log(`${label}: set ${FIELD}=${version}`)
  changed += 1
}

if (changed > 0 && !check) log('Restart DeepSeek Harness for the patched profile to take effect.')
if (check && pending > 0) process.exit(1)
