import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'

const require = createRequire(new URL('../../apps/tether-app/package.json', import.meta.url))
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder.js')
const { load, dump } = createRequire(require.resolve('electron-updater'))('js-yaml')
const MAX_HEADER_SIZE = 1024 * 1024
const MAX_BLOCKMAP_SIZE = 16 * 1024 * 1024
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/

const installerName = (version) => `Tether-${version}-win-x64.exe`
const compareVersions = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function readInstaller(metadata) {
  if (!VERSION.test(metadata?.version ?? '')) throw new Error('Invalid Windows update version')
  const name = installerName(metadata.version)
  const file = metadata.files?.find((file) => file.url === name)
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0
      || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
      || (metadata.path != null && metadata.path !== name)
      || (metadata.sha512 != null && metadata.sha512 !== file.sha512)) {
    throw new Error('Windows installer metadata does not match the expected asset')
  }
  return { name, version: metadata.version, size: file.size, sha512: file.sha512 }
}

function readBlockMap(bytes, installerSize) {
  const map = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_BLOCKMAP_SIZE }))
  const file = map.files?.[0]
  if (map.version !== '2' || map.files.length !== 1 || file.offset !== 0
      || !Array.isArray(file.sizes) || !Array.isArray(file.checksums)
      || file.sizes.length !== file.checksums.length
      || file.sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)
      || file.checksums.some((checksum) => typeof checksum !== 'string' || !checksum)
      || file.sizes.reduce((total, size) => total + size, 0) !== installerSize) {
    throw new Error('Blockmap does not cover the complete Windows installer')
  }
  return map
}

async function hashFile(file, algorithm, encoding) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(encoding)
}

async function fetchPublishedBase(repository, channel, filename, version, token) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Invalid GitHub release repository')
  }
  const request = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(30000)
  })
  if (!request.ok) throw new Error(`Could not list released Windows base packages (HTTP ${request.status})`)
  const tag = channel === 'preview' ? /^v(\d+\.\d+\.\d+)-preview\.(\d+)$/ : /^v(\d+\.\d+\.\d+)$/
  const candidates = (await request.json()).flatMap((release) => {
    const matched = tag.exec(release.tag_name)
    if (release.draft || release.prerelease !== (channel === 'preview') || !matched
        || compareVersions(matched[1], version) >= 0) return []
    const name = installerName(matched[1])
    const assets = release.assets ?? []
    const installer = assets.find((asset) => asset.name === name)
    const meta = assets.find((asset) => asset.name === filename)
    const blockmap = assets.find((asset) => asset.name === `${name}.blockmap`)
    return installer && meta && blockmap
      ? [{ version: matched[1], iteration: Number(matched[2] || 0), release, installer, meta, blockmap }]
      : []
  }).sort((left, right) => compareVersions(right.version, left.version) || right.iteration - left.iteration)
  const base = candidates[0]
  if (!base) return null
  const download = async (asset, limit) => {
    const url = `https://github.com/${repository}/releases/download/${base.release.tag_name}/${asset.name}`
    if (asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size <= 0
        || asset.size > limit || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) {
      throw new Error(`Unverifiable published release asset: ${asset.name}`)
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`Could not download ${asset.name} (HTTP ${response.status})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length !== asset.size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) {
      throw new Error(`Published release asset checksum mismatch: ${asset.name}`)
    }
    return bytes
  }
  const source = readInstaller(load((await download(base.meta, MAX_HEADER_SIZE)).toString('utf8')))
  if (source.version !== base.version || source.size !== base.installer.size) {
    throw new Error('Published installer disagrees with its update metadata')
  }
  return { ...source, blockMapBytes: await download(base.blockmap, MAX_BLOCKMAP_SIZE) }
}

async function readLocalBase(directory, filename) {
  const source = readInstaller(load(await readFile(path.join(directory, filename), 'utf8')))
  return { ...source, blockMapBytes: await readFile(path.join(directory, `${source.name}.blockmap`)) }
}

export async function buildWindowsDelta({ targetDirectory, fromDirectory, repository, channel = 'preview', token }) {
  if (channel !== 'preview' && channel !== 'stable') throw new Error('Unknown Windows release channel')
  const filename = channel === 'preview' ? 'preview.yml' : 'latest.yml'
  const metadataPath = path.join(targetDirectory, filename)
  const targetMetadata = load(await readFile(metadataPath, 'utf8'))
  const target = readInstaller(targetMetadata)
  let source
  let plan
  try {
    source = fromDirectory ? await readLocalBase(fromDirectory, filename)
      : await fetchPublishedBase(repository, channel, filename, target.version, token)
    if (!source || compareVersions(source.version, target.version) >= 0) {
      console.log('Windows delta skipped: no earlier compatible Windows installer')
      return null
    }
    const oldMap = readBlockMap(source.blockMapBytes, source.size)
    const newMap = readBlockMap(await readFile(path.join(targetDirectory, `${target.name}.blockmap`)), target.size)
    plan = computeOperations(oldMap, newMap, { info() {}, warn: console.warn })
  } catch (error) {
    console.warn(`Windows delta skipped: ${error.message}`)
    return null
  }
  let targetOffset = 0
  let literalSize = 0
  const operations = plan.map(({ kind, start, end }) => {
    const length = end - start
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || length <= 0) {
      throw new Error('Invalid byte range in the Windows delta plan')
    }
    if (kind === OperationKind.COPY && end <= source.size) {
      targetOffset += length
      return [start, length]
    }
    if (kind !== OperationKind.DOWNLOAD || start !== targetOffset || end > target.size) {
      throw new Error('Windows delta plan does not match the installer byte ranges')
    }
    targetOffset += length
    literalSize += length
    return [-1, length]
  })
  if (targetOffset !== target.size) throw new Error('Windows delta plan does not cover the target installer')
  const header = Buffer.from(JSON.stringify({ format: 1, operations }))
  const lengthPrefix = Buffer.alloc(4)
  lengthPrefix.writeUInt32BE(header.length)
  const deltaSize = lengthPrefix.length + header.length + literalSize
  if (header.length > MAX_HEADER_SIZE || deltaSize >= target.size) {
    console.log('Windows delta skipped: patch is not usable or no smaller than the installer')
    return null
  }
  const installerPath = path.join(targetDirectory, target.name)
  if ((await stat(installerPath)).size !== target.size
      || await hashFile(installerPath, 'sha512', 'base64') !== target.sha512) {
    throw new Error('Built Windows installer differs from its update metadata')
  }
  const name = `Tether-${source.version}-to-${target.version}-win-x64.delta`
  const destination = path.join(targetDirectory, name)
  const temporary = `${destination}.${process.pid}.tmp`
  async function* parts() {
    yield lengthPrefix
    yield header
    for (const { kind, start, end } of plan) {
      if (kind === OperationKind.DOWNLOAD) yield* createReadStream(installerPath, { start, end: end - 1 })
    }
  }
  try {
    await pipeline(Readable.from(parts()), createWriteStream(temporary, { flags: 'wx' }))
    if ((await stat(temporary)).size !== deltaSize) throw new Error('Windows delta package size mismatch')
    const asset = { fromVersion: source.version, toVersion: target.version,
      sourceSize: source.size, sourceSha512: source.sha512,
      size: deltaSize, sha512: await hashFile(temporary, 'sha512', 'base64'), path: name }
    await rename(temporary, destination)
    targetMetadata.tetherDelta = [asset]
    await writeFile(`${metadataPath}.${process.pid}.tmp`, dump(targetMetadata), { flag: 'wx' })
    await rename(`${metadataPath}.${process.pid}.tmp`, metadataPath)
    console.log(`Windows delta: ${name}, ${deltaSize} bytes (${literalSize} literal bytes)`)
    return asset
  } finally {
    await rm(temporary, { force: true })
    await rm(`${metadataPath}.${process.pid}.tmp`, { force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'target-directory': { type: 'string' },
      'from-directory': { type: 'string' },
      repository: { type: 'string' },
      channel: { type: 'string', default: 'preview' }
    }
  })
  if (!values['target-directory'] || Boolean(values['from-directory']) === Boolean(values.repository)) {
    console.error('Usage: node build-windows-delta.mjs --target-directory <path> (--from-directory <path> | --repository <owner/repo>) [--channel preview|stable]')
    process.exitCode = 2
  } else {
    await buildWindowsDelta({ targetDirectory: values['target-directory'], fromDirectory: values['from-directory'],
      repository: values.repository, channel: values.channel, token: process.env.TETHER_WINDOWS_DELTA_GITHUB_TOKEN })
  }
}
