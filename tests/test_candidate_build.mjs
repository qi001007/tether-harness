import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { builderTargetArgs, pruneManagedCandidateOutputs, replaceCandidateOutputSetting, writeCandidateOwnershipMarker } from '../desktop/packaging/build-candidate.mjs'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const buildScript = read('desktop/packaging/build-candidate.mjs')
const require = createRequire(import.meta.url)
const checkPackagedRuntime = require('../desktop/packaging/check-packaged-runtime.cjs')

/** Plain (non-glob, non-exclusion) entries of the electron-builder `files` list. */
function listedPackagedFiles() {
  const listed = new Set()
  let inFiles = false
  for (const line of read('desktop/packaging/electron-builder.yml').split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inFiles = /^files:/.test(line)
      continue
    }
    if (!inFiles) continue
    const entry = /^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (entry && !entry[1].startsWith('!')) listed.add(entry[1])
  }
  return listed
}

test('candidate app and node versions are synchronized with the frozen plugin', () => {
  const manifest = JSON.parse(read('version.json'))
  const appPackage = JSON.parse(read('apps/tether-app/package.json'))
  const appLock = JSON.parse(read('apps/tether-app/package-lock.json'))

  assert.match(manifest.components.app, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.components.node, manifest.components.app)
  assert.equal(manifest.components.plugin, '0.2.93')
  assert.equal(appPackage.version, manifest.components.app)
  assert.equal(appLock.version, manifest.components.app)
  assert.equal(appLock.packages[''].version, manifest.components.app)
})

test('candidate builder validates manifest semver and synchronized versions', () => {
  assert.match(buildScript, /const expectedVersion = version\.components\?\.app/)
  assert.match(buildScript, /semverPattern\.test\(expectedVersion\)/)
  assert.match(buildScript, /appPackage\.version !== expectedVersion \|\| version\.components\?\.node !== expectedVersion/)
  assert.match(buildScript, /version\.components\.plugin !== '0\.2\.93'/)
})

test('candidate output and runtime guards use the isolated versioned scratch root', () => {
  assert.match(buildScript, /\.scratch\/tether-desktop-candidates\/\$\{expectedVersion\}/)
  assert.match(read('desktop/packaging/electron-builder.yml'), /output: \.scratch\/tether-desktop-candidates\/\d+\.\d+\.\d+/)
  assert.match(buildScript, /lstatSync\(output\).*?Candidate output already exists/s)
  assert.match(buildScript, /path\.dirname\(managedOutputParent\) !== allowedOutputParent/)
})

test('candidate builder rewrites the versioned base output for the active candidate', () => {
  const baseConfig = 'directories:\n  output: .scratch/tether-desktop-candidates/0.5.4\n'
  assert.equal(replaceCandidateOutputSetting(baseConfig, 'D:/candidate/0.5.5/windows-x64'),
    'directories:\n  output: "D:/candidate/0.5.5/windows-x64"\n')
  assert.throws(() => replaceCandidateOutputSetting('directories:\n  output: dist\n', 'D:/candidate/0.5.5'),
    /electron-builder output setting changed unexpectedly/)
})

test('web build and desktop auth bundle markers are required before electron-builder', () => {
  const webBuildIndex = buildScript.indexOf("['run', 'build:web', '--prefix', 'packages/tether-ui']")
  const markerCheckIndex = buildScript.indexOf("'workbenchAuthStatus', 'authReady'")
  const electronBuilderIndex = buildScript.indexOf('const result = spawnSync(process.execPath, args')
  assert.ok(webBuildIndex >= 0 && markerCheckIndex > webBuildIndex && electronBuilderIndex > markerCheckIndex)
  assert.equal(buildScript.includes("'tether-desktop', '/oauth/callback'"), false)
})

test('builder pins the verified Electron package and distribution versions', () => {
  assert.match(buildScript, /const electronDist = path\.join\(path\.dirname\(electronPackagePath\), 'dist'\)/)
  assert.match(buildScript, /\.trim\(\)\.replace\(\/\^v\/, ''\)/)
  assert.match(buildScript, /electronDistVersion !== electronVersion/)
  assert.match(buildScript, /electronVersion: \$\{electronVersion\}\\nelectronDist: "\$\{electronDist/)
})

test('desktop OIDC helper is included in the packaged application', () => {
  assert.match(read('desktop/packaging/electron-builder.yml'), /^  - oidc-auth\.js$/m)
})

test('candidate builder uses NSIS on Windows and keeps Linux and macOS targets', () => {
  assert.deepEqual(builderTargetArgs('windows'), ['--win', 'nsis'])
  assert.deepEqual(builderTargetArgs('linux'), ['--linux', 'AppImage', 'deb'])
  assert.deepEqual(builderTargetArgs('macos'), ['--mac', 'dmg', 'zip'])

  const builderConfig = read('desktop/packaging/electron-builder.yml')
  const artifactTemplate = builderConfig.match(/^artifactName: (.+)$/m)?.[1]
  assert.equal(artifactTemplate, 'Tether-${version}-${os}-${arch}.${ext}')
  assert.equal(artifactTemplate
    .replace('${version}', '0.5.3')
    .replace('${os}', 'win')
    .replace('${arch}', 'x64')
    .replace('${ext}', 'exe'), 'Tether-0.5.3-win-x64.exe')
  assert.match(buildScript, /const artifactSuffixes = \['\.exe'/)
})

test('builder diagnostic configuration files are omitted from candidate hashes', () => {
  assert.match(buildScript, /entry\.name === 'builder-debug\.yml'/)
  assert.match(buildScript, /entry\.name === 'builder-effective-config\.yaml'/)
})

test('candidate output marker records a platform-independent owning run path', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-marker-'))
  try {
    const run = path.join(root, 'r11')
    mkdirSync(run)
    const markerPath = writeCandidateOwnershipMarker({
      outputParent: run, version: '0.5.3'
    })
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    assert.equal(marker.format, 'tether-candidate-output')
    assert.equal(marker.version, '0.5.3')
    assert.equal(Object.hasOwn(marker, 'platform'), false)
    assert.equal(marker.path, path.resolve(run))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('same legal candidate run marker is reusable by multiple platform builds', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-multiplatform-'))
  try {
    const run = path.join(root, 'r11')
    mkdirSync(run)
    const windowsMarker = writeCandidateOwnershipMarker({ outputParent: run, version: '0.5.3' })
    const linuxMarker = writeCandidateOwnershipMarker({ outputParent: run, version: '0.5.3' })

    assert.equal(linuxMarker, windowsMarker)
    assert.deepEqual(JSON.parse(readFileSync(linuxMarker, 'utf8')), {
      format: 'tether-candidate-output', version: '0.5.3', path: path.resolve(run)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('successful candidate cleanup removes only older valid direct-child runs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-prune-'))
  try {
    const addRun = (name, marker = {}) => {
      const run = path.join(root, name)
      mkdirSync(run)
      writeFileSync(path.join(run, '.tether-candidate-owner.json'), JSON.stringify({
        format: 'tether-candidate-output', version: '0.5.3', platform: 'windows-x64', path: run, ...marker
      }))
      return run
    }
    const oldRun = addRun('r5')
    const recentRun = addRun('r10')
    const currentRun = addRun('r11')
    const otherPlatformRun = addRun('r12', { platform: 'linux-x64' })
    const oldVersionRun = addRun('old-version-run', { version: '0.5.1' })
    addRun('wrong-format', { format: 'other' })
    addRun('wrong-version', { version: 'latest' })
    addRun('wrong-path', { path: path.join(root, 'elsewhere') })
    mkdirSync(path.join(root, 'unmarked'))
    mkdirSync(path.join(root, 'runtime'))

    const base = new Date(1_800_000_000_000)
    for (const [index, run] of [oldRun, oldVersionRun, recentRun, currentRun, otherPlatformRun].entries()) {
      const timestamp = new Date(base.getTime() + index * 1000)
      utimesSync(path.join(run, '.tether-candidate-owner.json'), timestamp, timestamp)
    }
    const removed = pruneManagedCandidateOutputs({
      allowedOutputParent: root, currentOutputParent: currentRun,
      version: '0.5.3'
    })

    assert.deepEqual(removed, [recentRun, oldVersionRun, oldRun])
    assert.deepEqual(readdirSync(root).sort(), [
      'r11', 'r12', 'runtime', 'unmarked', 'wrong-format', 'wrong-path', 'wrong-version'
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ownership marker creation refuses unmarked data and rejects marker links', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-marker-safe-'))
  try {
    const unmarked = path.join(root, 'unmarked')
    mkdirSync(unmarked)
    writeFileSync(path.join(unmarked, 'keep.txt'), 'keep')
    assert.throws(() => writeCandidateOwnershipMarker({ outputParent: unmarked, version: '0.5.3' }))
    assert.equal(readdirSync(unmarked).includes('.tether-candidate-owner.json'), false)

    const linkedRun = path.join(root, 'linked-run')
    const markerTarget = path.join(root, 'marker-target')
    mkdirSync(linkedRun)
    mkdirSync(markerTarget)
    writeFileSync(path.join(markerTarget, 'keep.txt'), 'keep')
    const markerPath = path.join(linkedRun, '.tether-candidate-owner.json')
    symlinkSync(markerTarget, markerPath, process.platform === 'win32' ? 'junction' : 'dir')

    assert.throws(() => writeCandidateOwnershipMarker({ outputParent: linkedRun, version: '0.5.3' }))
    assert.deepEqual(pruneManagedCandidateOutputs({
      allowedOutputParent: root, currentOutputParent: path.join(root, 'current'), version: '0.5.3'
    }), [])
    assert.equal(readFileSync(path.join(markerTarget, 'keep.txt'), 'utf8'), 'keep')
    assert.equal(readdirSync(root).includes('linked-run'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('candidate cleanup never follows a linked or reparse-point directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-link-'))
  try {
    const target = path.join(root, 'target')
    mkdirSync(target)
    writeFileSync(path.join(target, '.tether-candidate-owner.json'), JSON.stringify({
      format: 'tether-candidate-output', version: '0.5.3', platform: 'windows-x64', path: target
    }))
    const link = path.join(root, 'linked-old-run')
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')

    assert.deepEqual(pruneManagedCandidateOutputs({
      allowedOutputParent: root, currentOutputParent: path.join(root, 'current'),
      version: '0.5.3'
    }), [])
    assert.equal(readdirSync(target).includes('.tether-candidate-owner.json'), true)
    assert.equal(readdirSync(root).includes('linked-old-run'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('repeated failed candidate runs converge to current plus the latest managed run', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-failed-runs-'))
  try {
    const names = ['r10', 'r11', 'r12', 'r13', 'r14']
    for (const [index, name] of names.entries()) {
      const run = path.join(root, name)
      mkdirSync(run)
      const marker = writeCandidateOwnershipMarker({ outputParent: run, version: '0.5.3' })
      pruneManagedCandidateOutputs({
        allowedOutputParent: root, currentOutputParent: run, version: '0.5.3'
      })
      const timestamp = new Date(1_900_000_000_000 + index * 1000)
      utimesSync(marker, timestamp, timestamp)
      writeFileSync(path.join(run, 'partial-output.bin'), `failed-${name}`)
    }

    assert.deepEqual(readdirSync(root).sort(), ['r13', 'r14'])
    assert.equal(readFileSync(path.join(root, 'r14', '.tether-candidate-owner.json'), 'utf8').includes('0.5.3'), true)
    assert.equal(readFileSync(path.join(root, 'r14', 'partial-output.bin'), 'utf8'), 'failed-r14')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('default candidate root is never treated as a managed run', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tether-candidate-root-'))
  try {
    mkdirSync(path.join(root, 'windows-x64'))
    assert.deepEqual(pruneManagedCandidateOutputs({
      allowedOutputParent: root, currentOutputParent: root,
      version: '0.5.3'
    }), [])
    assert.deepEqual(readdirSync(root), ['windows-x64'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('candidate run ownership and pruning happen before heavy builds', () => {
  const markerIndex = buildScript.indexOf('writeCandidateOwnershipMarker({ outputParent: managedOutputParent')
  const cleanupIndex = buildScript.indexOf('pruneManagedCandidateOutputs({', markerIndex)
  const webBuildIndex = buildScript.indexOf("['run', 'build:web', '--prefix', 'packages/tether-ui']")
  const builderIndex = buildScript.indexOf('const result = spawnSync(process.execPath, args')
  const pathCheckIndex = buildScript.indexOf('if (!pathHasNoLinks(allowedOutputParent)')
  const directChildCheckIndex = buildScript.indexOf('path.dirname(managedOutputParent) !== allowedOutputParent')
  const outputCheckIndex = buildScript.indexOf('lstatSync(output)')
  assert.ok(markerIndex > 0 && cleanupIndex > markerIndex)
  assert.ok(pathCheckIndex > 0 && markerIndex > pathCheckIndex)
  assert.ok(directChildCheckIndex > 0 && markerIndex > directChildCheckIndex)
  assert.ok(outputCheckIndex > 0 && markerIndex > outputCheckIndex)
  assert.ok(webBuildIndex > cleanupIndex && builderIndex > webBuildIndex)
})

// 0.5.14 shipped an app.asar without data-maintenance.js: main.js requires it on
// startup, but the electron-builder `files` whitelist is hand-maintained and was
// never updated. Resolve the real require graph instead of restating the list.
test('every main-process module reachable from the app entry points is packaged', () => {
  const appFiles = readdirSync(new URL('apps/tether-app/', root))
  const listed = listedPackagedFiles()
  assert.ok(listed.has('main.js'), 'electron-builder files list must include main.js')

  const resolve = (from, specifier) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    return [base, `${base}.js`, `${base}.json`, `${base}/index.js`].find(candidate => appFiles.includes(candidate))
  }
  const reachable = new Set()
  const queue = ['main.js', 'preload.js']
  while (queue.length) {
    const current = queue.shift()
    if (reachable.has(current)) continue
    reachable.add(current)
    const source = read(`apps/tether-app/${current}`)
    for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const resolved = resolve(current, match[1])
      assert.ok(resolved, `${current} requires an unresolved module: ${match[1]}`)
      queue.push(resolved)
    }
    // Child-process helpers are spawned by path, not required.
    for (const match of source.matchAll(/path\.join\(__dirname,\s*['"]([^'"]+\.js)['"]\)/g)) {
      assert.ok(appFiles.includes(match[1]), `${current} spawns an unknown module: ${match[1]}`)
      queue.push(match[1])
    }
  }

  const missing = [...reachable].filter(name => !listed.has(name))
  assert.deepEqual(missing, [], `electron-builder files list omits packaged modules: ${missing.join(', ')}`)
  assert.ok(reachable.has('data-maintenance.js'), 'main.js must still require ./data-maintenance')
})

/** Minimal readable asar: 16-byte size header, padded JSON tree, then contents. */
function writeFakeAsar(file, modules) {
  const entries = {}
  const bodies = []
  let offset = 0
  for (const name of modules) {
    const body = Buffer.from(`module.exports = ${JSON.stringify(name)}\n`)
    entries[name] = { size: body.length, offset: String(offset) }
    bodies.push(body)
    offset += body.length
  }
  const json = Buffer.from(JSON.stringify({ files: entries }))
  const paddedLength = Math.ceil(json.length / 8) * 8
  const headerSize = 8 + paddedLength
  const header = Buffer.alloc(16)
  header.writeUInt32LE(4, 0)
  header.writeUInt32LE(headerSize, 4)
  header.writeUInt32LE(headerSize - 4, 8)
  header.writeUInt32LE(json.length, 12)
  const padding = Buffer.alloc(paddedLength, 0x20)
  json.copy(padding)
  writeFileSync(file, Buffer.concat([header, padding, ...bodies]))
}

test('packaged runtime guard rejects a runtime without pnpm and an asar without a listed module', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'tether-packaged-runtime-'))
  try {
    const resources = path.join(workspace, 'resources')
    const runtime = path.join(resources, 'tether-runtime')
    const required = [
      'tether-python.exe',
      'components/nodejs/node.exe',
      'components/nodejs/pnpm.cmd',
      'components/dsh/node_modules/pnpm/bin/pnpm.mjs',
      'components/meshcentral/meshcentral.js',
      'components/meshagent/windows-x64/MeshService64.exe',
      'components/dsh/node_modules/@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe',
      'components/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js',
      'components/libreoffice/System64/msvcp140_2.dll',
      'components/caddy/caddy.exe',
      'components/rclone/rclone.exe',
      'components/easytier/easytier-core.exe',
      'components/easytier/easytier-cli.exe'
    ]
    for (const relative of required) {
      mkdirSync(path.dirname(path.join(runtime, relative)), { recursive: true })
      writeFileSync(path.join(runtime, relative), 'fixture\n')
    }
    writeFileSync(path.join(runtime, 'components/nodejs/pnpm.json'), JSON.stringify({
      component: 'pnpm', version: '11.28.5', license: 'MIT', shim: 'pnpm.cmd',
      entry: '../dsh/node_modules/pnpm/bin/pnpm.mjs'
    }))
    writeFileSync(path.join(runtime, 'components/dsh/node_modules/pnpm/package.json'),
      JSON.stringify({ name: 'pnpm', version: '11.28.5', bin: { pnpm: 'bin/pnpm.mjs' } }))

    const archive = path.join(resources, 'app.asar')
    const packaged = [...listedPackagedFiles()]
    writeFakeAsar(archive, packaged)
    const context = {
      appOutDir: resources, electronPlatformName: 'win32', arch: 1,
      packager: { getResourcesDir: appOutDir => appOutDir }
    }
    await assert.doesNotReject(checkPackagedRuntime(context))

    writeFakeAsar(archive, packaged.filter(name => name !== 'data-maintenance.js'))
    await assert.rejects(checkPackagedRuntime(context), /missing main-process module data-maintenance\.js/)
    writeFakeAsar(archive, packaged)

    const launcher = path.join(runtime, 'components/nodejs/pnpm.cmd')
    rmSync(launcher)
    await assert.rejects(checkPackagedRuntime(context), /missing pnpm launcher/)

    writeFileSync(launcher, 'fixture\n')
    writeFileSync(path.join(runtime, 'components/nodejs/pnpm.json'), JSON.stringify({
      component: 'pnpm', version: '11.28.5', license: 'MIT', shim: 'pnpm.cmd',
      entry: 'D:/DeepSeek Harness/pnpm.mjs'
    }))
    await assert.rejects(checkPackagedRuntime(context), /must stay inside the runtime/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
