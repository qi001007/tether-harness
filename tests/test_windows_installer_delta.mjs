import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../apps/tether-app/package.json', import.meta.url))
const { NsisUpdater } = require('electron-updater')
const { GenericProvider } = require('electron-updater/out/providers/GenericProvider')
const { CancellationError, CancellationToken } = require('builder-util-runtime')
const { configureWindowsDelta } = require('./update-service.js')
const hash = (bytes) => crypto.createHash('sha512').update(bytes).digest('base64')
const fromVersion = '0.5.10'
const toVersion = '0.5.11'
const installerName = `Tether-${toVersion}-win-x64.exe`
const source = Buffer.alloc(1024 * 1024 + 11, 37)
const literal = Buffer.from('updated')
const target = Buffer.concat([literal, source, literal])

function makeDelta(operations, literals) {
  const header = Buffer.from(JSON.stringify({ format: 1, operations }))
  const size = Buffer.alloc(4)
  size.writeUInt32BE(header.length)
  return Buffer.concat([size, header, literals])
}

const delta = makeDelta([[-1, literal.length], [0, source.length], [-1, literal.length]], Buffer.concat([literal, literal]))

async function setup(t, {
  origin = 'https://github.com/qi001007/tether-harness/releases/download/v0.5.11-preview.1/',
  generic = false, mutateEntry = () => {}, sourceBytes = source, patchBytes = delta, servedPatch = patchBytes,
  cancel = false, patchError = false, signatureError = false
} = {}) {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'tether-installer-delta-'))
  t.after(() => fs.rm(cache, { recursive: true, force: true }))
  await fs.writeFile(path.join(cache, 'installer.exe'), sourceBytes)
  const requests = []
  const signatureChecks = []
  const token = new CancellationToken()
  const updater = new NsisUpdater(undefined, { version: fromVersion, baseCachePath: cache })
  updater.logger = { info() {}, warn() {}, error() {} }
  updater.autoInstallOnAppQuit = false
  updater.configOnDisk.value = Promise.resolve({ updaterCacheDirName: '.', publisherName: 'Tether' })
  updater.verifyUpdateCodeSignature = async (publishers, file) => {
    assert.deepEqual(publishers, ['Tether'])
    signatureChecks.push(await fs.readFile(file))
    return signatureError ? 'unexpected signer' : null
  }
  updater.httpExecutor = { async download(url, file, options) {
    requests.push(url.href)
    assert.equal(options.cancellationToken, token)
    const patch = url.pathname.endsWith('.delta')
    assert.equal(Object.keys(options.headers).some((name) => name.toLowerCase() === 'range'), false)
    const bytes = patch ? servedPatch : target
    await fs.writeFile(file, bytes)
    if (patch && cancel) {
      token.cancel()
      throw new CancellationError()
    }
    if (patch && patchError) throw new Error('patch server returned unavailable')
    if (options.sha512 !== hash(bytes)) throw new Error('HTTP download checksum mismatch')
  } }
  configureWindowsDelta(updater, fromVersion)
  const entry = {
    fromVersion, toVersion, sourceSize: source.length, sourceSha512: hash(source),
    size: patchBytes.length, sha512: hash(patchBytes), path: 'Tether-0.5.10-to-0.5.11-win-x64.delta'
  }
  mutateEntry(entry)
  const info = { version: toVersion, files: [{ url: installerName, size: target.length, sha512: hash(target) }], tetherDelta: [entry] }
  const provider = generic ? new GenericProvider({ url: origin }, updater, {})
    : { resolveFiles: ({ files }) => files.map((file) => ({ info: file, url: new URL(file.url, origin) })) }
  const download = () => updater.doDownloadUpdate({ updateInfoAndProvider: { info, provider }, cancellationToken: token,
    requestHeaders: {}, disableWebInstaller: true, disableDifferentialDownload: false })
  const pending = () => fs.readdir(path.join(cache, 'pending'))
  return { updater, download, requests, signatureChecks, pending }
}

test('one trusted delta reconstructs the target through the NSIS signature and pending-cache path', async (t) => {
  const { updater, download, requests, signatureChecks, pending } = await setup(t)
  let prepared
  updater.on('update-downloaded', (event) => { prepared = event })
  await download()
  assert.equal(requests.length, 1)
  assert.match(requests[0], /\.delta$/)
  assert.deepEqual(signatureChecks, [target])
  assert.equal(prepared.version, toVersion)
  assert.deepEqual(await fs.readFile(prepared.downloadedFile), target)
  assert.deepEqual((await pending()).sort(), [installerName, 'update-info.json'].sort())
})

for (const [reason, options, expectedRequests] of [
  ['another source version', { mutateEntry: (entry) => { entry.fromVersion = '0.5.9' } }, 1],
  ['another target version', { mutateEntry: (entry) => { entry.toVersion = '0.5.12' } }, 1],
  ['an unapproved release origin', { origin: 'https://github.com/other-owner/tether-harness/releases/download/v0.5.11/' }, 1],
  ['a remote patch path', { mutateEntry: (entry) => { entry.path = 'https://untrusted.example/file.delta' } }, 1],
  ['the wrong cached installer bytes', { sourceBytes: Buffer.alloc(source.length) }, 1],
  ['a corrupt download', { servedPatch: delta.subarray(0, -1) }, 2],
  ['a failed patch request', { patchError: true }, 2],
  ['an out-of-bounds source range', { patchBytes: makeDelta([[2, source.length]], Buffer.alloc(0)) }, 2],
  ['a target reconstruction SHA512 mismatch', { patchBytes: makeDelta([[-1, literal.length], [0, source.length], [-1, literal.length]], Buffer.alloc(literal.length * 2)) }, 2]
]) {
  test(`${reason} falls back to one complete installer request`, async (t) => {
    const { download, requests, signatureChecks, pending } = await setup(t, options)
    await download()
    assert.equal(requests.length, expectedRequests)
    assert.match(requests.at(-1), /\.exe$/)
    assert.deepEqual(signatureChecks, [target])
    assert.deepEqual((await pending()).sort(), [installerName, 'update-info.json'].sort())
  })
}

test('loopback is restricted to the configured generic update provider', async (t) => {
  const origin = 'http://127.0.0.1:45123/releases/'
  const standard = await setup(t, { origin })
  await standard.download()
  assert.match(standard.requests[0], /\.exe$/)
  const loopback = await setup(t, { origin, generic: true })
  await loopback.download()
  assert.match(loopback.requests[0], /\.delta$/)
})

test('cancelling the patch keeps the NSIS cancellation behavior without a full download', async (t) => {
  const { updater, download, requests, signatureChecks, pending } = await setup(t, { cancel: true })
  let cancellation
  updater.on('update-cancelled', (event) => { cancellation = event })
  await assert.rejects(download(), CancellationError)
  assert.equal(cancellation.version, toVersion)
  assert.equal(requests.length, 1)
  assert.deepEqual(signatureChecks, [])
  assert.deepEqual(await pending(), [])
})

test('a correctly reconstructed installer still requires the configured publisher signature', async (t) => {
  const { download, requests, signatureChecks, pending } = await setup(t, { signatureError: true })
  await assert.rejects(download(), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })
  assert.equal(requests.length, 1)
  assert.deepEqual(signatureChecks, [target])
  assert.deepEqual(await pending(), [])
})
