import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ownershipMarkerName = '.tether-candidate-owner.json'
const candidateVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function pathHasNoLinks(target) {
  const absolute = path.resolve(target)
  const root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink()) return false
    } catch {
      return false
    }
  }
  return true
}

function ensureDirectoryTreeNoLinks(target) {
  const absolute = path.resolve(target)
  const root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      const stat = lstatSync(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Candidate output path contains a non-directory or link: ${current}`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      mkdirSync(current)
    }
  }
}

function isCandidateMarker(marker, candidatePath) {
  return marker && typeof marker === 'object' && !Array.isArray(marker)
    && marker.format === 'tether-candidate-output'
    && typeof marker.version === 'string' && candidateVersionPattern.test(marker.version)
    && marker.path === candidatePath
}

function readCandidateOwnershipMarker(candidatePath) {
  try {
    if (!pathHasNoLinks(candidatePath) || !lstatSync(candidatePath).isDirectory()) return null
    const markerPath = path.join(candidatePath, ownershipMarkerName)
    const markerStat = lstatSync(markerPath)
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) return null
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    return isCandidateMarker(marker, candidatePath) ? { marker, markerStat } : null
  } catch {
    return null
  }
}

export function writeCandidateOwnershipMarker({ outputParent, version }) {
  const ownerPath = path.resolve(outputParent)
  if (!candidateVersionPattern.test(version) || !pathHasNoLinks(ownerPath)
      || !lstatSync(ownerPath).isDirectory()) {
    throw new Error('Candidate ownership marker requires a real run directory and valid Tether version.')
  }
  const markerPath = path.join(ownerPath, ownershipMarkerName)
  const content = JSON.stringify({
    format: 'tether-candidate-output', version, path: ownerPath
  }, null, 2) + '\n'
  let markerExists = false
  try {
    lstatSync(markerPath)
    markerExists = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!markerExists && readdirSync(ownerPath).length) {
    throw new Error('Refusing to mark a non-empty unowned candidate directory.')
  }
  try {
    writeFileSync(markerPath, content, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    try {
      const markerStat = lstatSync(markerPath)
      if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('Invalid candidate ownership marker.')
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
      if (!isCandidateMarker(marker, ownerPath) || marker.version !== version) {
        throw new Error('Candidate output directory is owned by a different or invalid run.')
      }
    } catch (markerError) {
      if (markerError.code === 'ENOENT') throw new Error('Candidate ownership marker disappeared during validation.')
      throw markerError
    }
  }
  return markerPath
}

export function pruneManagedCandidateOutputs({ allowedOutputParent, currentOutputParent, version }) {
  const allowedPath = path.resolve(allowedOutputParent)
  const currentPath = path.resolve(currentOutputParent)
  if (currentPath === allowedPath || path.dirname(currentPath) !== allowedPath
      || !candidateVersionPattern.test(version)) return []
  try {
    if (!lstatSync(allowedPath).isDirectory() || !pathHasNoLinks(allowedPath)) return []
  } catch {
    return []
  }
  const currentMarker = readCandidateOwnershipMarker(currentPath)
  if (!currentMarker || currentMarker.marker.version !== version) return []

  const managed = []
  for (const entry of readdirSync(allowedPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const candidatePath = path.resolve(allowedPath, entry.name)
    if (path.dirname(candidatePath) !== allowedPath || candidatePath === currentPath) continue
    const owned = readCandidateOwnershipMarker(candidatePath)
    if (!owned) continue
    managed.push({ path: candidatePath, modified: owned.markerStat.mtimeMs })
  }

  managed.sort((left, right) => right.modified - left.modified)
  const keep = new Set([currentPath, ...managed.slice(0, 1).map(candidate => candidate.path)])
  const removed = []
  for (const candidate of managed) {
    if (keep.has(candidate.path)) continue
    rmSync(candidate.path, { recursive: true, force: false })
    removed.push(candidate.path)
  }
  return removed
}

export function builderTargetArgs(platform) {
  if (platform === 'windows') return ['--win', 'nsis']
  if (platform === 'linux') return ['--linux', 'AppImage', 'deb']
  if (platform === 'macos') return ['--mac', 'dmg', 'zip']
  throw new Error(`Unsupported candidate platform: ${platform}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const packagingDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(packagingDir, '../..')
const [platform, arch] = process.argv.slice(2)
const platformTarget = { windows: 'windows-x64', linux: 'linux-x64', macos: `macos-${arch}` }
if (!platformTarget[platform] || !['x64', 'arm64'].includes(arch)
    || (platform !== 'macos' && arch !== 'x64')) {
  throw new Error('Usage: node build-candidate.mjs windows|linux|macos x64|arm64')
}
if (platform === 'macos' && process.platform !== 'darwin') throw new Error('macOS candidates must be built on a macOS runner.')
if (platform === 'windows' && process.platform !== 'win32') throw new Error('Windows candidates must be built on a Windows runner.')
if (platform === 'linux' && process.platform !== 'linux') throw new Error('Linux candidates must be built on a Linux runner.')

const appPackage = JSON.parse(readFileSync(path.join(repoRoot, 'apps/tether-app/package.json'), 'utf8'))
const version = JSON.parse(readFileSync(path.join(repoRoot, 'version.json'), 'utf8'))
const expectedVersion = version.components?.app
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
if (typeof expectedVersion !== 'string' || !semverPattern.test(expectedVersion)) {
  throw new Error(`version.json components.app must contain a valid semantic version; found ${expectedVersion}.`)
}
if (appPackage.version !== expectedVersion || version.components?.node !== expectedVersion) {
  throw new Error(`Candidate versions must be synchronized to ${expectedVersion}; packaging found app=${appPackage.version}, version.json=${version.components?.app}/${version.components?.node}.`)
}
if (version.components.plugin !== '0.2.93') throw new Error('Candidate must retain the frozen DSH plugin version 0.2.93.')

const defaultRuntimeRoot = path.join(repoRoot, '.runtime/desktop-candidate')
const runtimeRoot = path.resolve(process.env.TETHER_CANDIDATE_RUNTIME_ROOT || defaultRuntimeRoot)
const candidateRoot = path.resolve(repoRoot, `.scratch/tether-desktop-candidates/${expectedVersion}`)
if (process.env.TETHER_CANDIDATE_RUNTIME_ROOT) {
  const allowedRuntimeRoot = candidateRoot
  if (runtimeRoot !== allowedRuntimeRoot && !runtimeRoot.startsWith(allowedRuntimeRoot + path.sep)) {
    throw new Error(`TETHER_CANDIDATE_RUNTIME_ROOT must point into the isolated ${expectedVersion} candidate scratch directory.`)
  }
}
const runtimeExe = path.join(runtimeRoot, process.platform === 'win32' ? 'tether-python.exe' : 'tether-python')
if (!existsSync(runtimeExe)) throw new Error(`Missing packaged Python runtime: ${runtimeExe}`)
const nodeRuntime = path.join(runtimeRoot, 'components/nodejs', process.platform === 'win32' ? 'node.exe' : 'bin/node')
if (!existsSync(nodeRuntime)) throw new Error(`Missing pinned Node.js 24.22.2 runtime: ${nodeRuntime}`)
const meshcentralEntry = path.join(runtimeRoot, 'components/meshcentral/meshcentral.js')
if (!existsSync(meshcentralEntry)) throw new Error(`Missing pinned MeshCentral runtime: ${meshcentralEntry}`)
const meshagentPath = path.join(runtimeRoot, 'components/meshagent', platformTarget[platform],
  platformTarget[platform] === 'windows-x64' ? 'MeshService64.exe' : platformTarget[platform] === 'linux-x64'
    ? 'meshagent_x86-64' : platformTarget[platform] === 'macos-x64' ? 'meshagent_osx-x86-64' : 'meshagent_osx-arm-64')
if (!existsSync(meshagentPath)) throw new Error(`Missing pinned MeshAgent runtime: ${meshagentPath}`)
const officeRelative = process.platform === 'win32'
  ? 'program/soffice.com'
  : process.platform === 'darwin'
    ? 'LibreOffice.app/Contents/MacOS/soffice'
    : 'opt/libreoffice26.8/program/soffice'
const officeExecutable = path.join(runtimeRoot, 'components/libreoffice', officeRelative)
if (!existsSync(officeExecutable)) throw new Error(`Missing pinned LibreOffice runtime: ${officeExecutable}`)
for (const icon of ['assets/tether-app-s.ico', 'assets/tether-app-s.png']) {
  if (!existsSync(path.join(runtimeRoot, icon))) throw new Error(`Missing packaged app resource: ${icon}`)
}
const componentDir = path.join(runtimeRoot, 'components')
for (const component of ['codeg', 'easytier', 'sftpgo', 'caddy', 'rclone', 'meshcentral', 'meshagent']) {
  if (!existsSync(path.join(componentDir, component))) throw new Error(`Missing assembled runtime component: ${component}`)
}

const defaultOutputParent = candidateRoot
const outputParent = path.resolve(process.env.TETHER_CANDIDATE_OUTPUT_ROOT || defaultOutputParent)
const allowedOutputParent = candidateRoot
if (process.env.TETHER_CANDIDATE_OUTPUT_ROOT
    && outputParent !== allowedOutputParent && !outputParent.startsWith(allowedOutputParent + path.sep)) {
  throw new Error(`TETHER_CANDIDATE_OUTPUT_ROOT must point into the isolated ${expectedVersion} candidate scratch directory.`)
}
const output = path.join(outputParent, platformTarget[platform])
if (path.dirname(output) !== outputParent) throw new Error('Refusing to write outside the platform-specific candidate output directory.')
const managedOutputParent = outputParent === allowedOutputParent ? output : outputParent
if (path.dirname(managedOutputParent) !== allowedOutputParent) {
  throw new Error('Candidate run directory must be a direct child of the isolated candidate root.')
}
ensureDirectoryTreeNoLinks(outputParent)
if (!pathHasNoLinks(allowedOutputParent) || !pathHasNoLinks(outputParent)) {
  throw new Error('Candidate output paths must not contain symbolic links or reparse points.')
}
try {
  lstatSync(output)
  throw new Error(`Candidate output already exists; refusing to replace it: ${output}`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const builderCli = path.join(packagingDir, 'node_modules/electron-builder/cli.js')
if (!existsSync(builderCli)) throw new Error('Packaging tools are not installed; run npm ci in desktop/packaging first.')
const electronPackagePath = path.join(repoRoot, 'apps/tether-app/node_modules/electron/package.json')
if (!existsSync(electronPackagePath)) throw new Error('Electron is not installed in apps/tether-app; run npm ci --prefix apps/tether-app first.')
const electronVersion = JSON.parse(readFileSync(electronPackagePath, 'utf8')).version
if (typeof electronVersion !== 'string' || !semverPattern.test(electronVersion)) throw new Error(`Installed Electron version is not valid semver: ${electronVersion}`)
const electronDist = path.join(path.dirname(electronPackagePath), 'dist')
const electronDistVersionPath = path.join(electronDist, 'version')
if (!existsSync(electronDistVersionPath)) throw new Error(`Installed Electron distribution has no version marker: ${electronDistVersionPath}`)
const electronDistVersion = readFileSync(electronDistVersionPath, 'utf8').trim().replace(/^v/, '')
if (electronDistVersion !== electronVersion) {
  throw new Error(`Installed Electron package/dist versions differ: package=${electronVersion}, dist=${electronDistVersion}.`)
}
const baseConfigPath = path.join(packagingDir, 'electron-builder.yml')
const baseConfig = readFileSync(baseConfigPath, 'utf8')
const outputSetting = `output: .scratch/tether-desktop-candidates/${expectedVersion}`
if (!baseConfig.includes(outputSetting)) throw new Error('electron-builder output setting changed unexpectedly.')
const tempConfig = path.join(os.tmpdir(), `tether-builder-${platformTarget[platform]}.yml`)
const builderOutput = outputParent.replaceAll('\\', '/') + `/${platformTarget[platform]}`
const runtimeSetting = 'from: .runtime/desktop-candidate'
const nodeBinSetting = runtimeSetting + '/node-bin'
if (baseConfig.split(runtimeSetting).length !== 3 || baseConfig.split(nodeBinSetting).length !== 2) {
  throw new Error('electron-builder runtime resource mapping changed unexpectedly.')
}
const config = baseConfig.replace(outputSetting, `output: "${builderOutput}"`)
  .replace(nodeBinSetting, `from: "${runtimeRoot.replaceAll('\\', '/')}/node-bin"`)
  .replace(runtimeSetting, `from: "${runtimeRoot.replaceAll('\\', '/')}"`)
  .replace('appId: com.tether.app', `appId: com.tether.app\nelectronVersion: ${electronVersion}\nelectronDist: "${electronDist.replaceAll('\\', '/')}"`)

if (managedOutputParent === output) mkdirSync(managedOutputParent)
if (!pathHasNoLinks(managedOutputParent)) {
  throw new Error('Candidate run directory must not be a symbolic link or reparse point.')
}
writeCandidateOwnershipMarker({ outputParent: managedOutputParent, version: expectedVersion })
pruneManagedCandidateOutputs({
  allowedOutputParent, currentOutputParent: managedOutputParent,
  version: expectedVersion
})

writeFileSync(tempConfig, config)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const webBuild = spawnSync(npmCommand, ['run', 'build:web', '--prefix', 'packages/tether-ui'], {
  cwd: repoRoot, stdio: 'inherit', env: process.env, shell: process.platform === 'win32'
})
if (webBuild.status !== 0) {
  rmSync(tempConfig, { force: true })
  throw new Error(`Shared web UI build failed with status ${webBuild.status}.`)
}
const webBundlePath = path.join(repoRoot, 'packages/tether-ui/web/dist/app.js')
if (!existsSync(webBundlePath)) {
  rmSync(tempConfig, { force: true })
  throw new Error(`Shared web UI build did not produce ${webBundlePath}.`)
}
const webBundle = readFileSync(webBundlePath, 'utf8')
for (const marker of ['workbenchAuthStatus', 'authReady']) {
  if (!webBundle.includes(marker)) {
    rmSync(tempConfig, { force: true })
    throw new Error(`Shared web UI bundle is missing required desktop auth marker: ${marker}.`)
  }
}
const args = [builderCli, '--projectDir', repoRoot,
  '--config', tempConfig,
  ...builderTargetArgs(platform),
  '--' + arch, '--publish', 'never']
const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit', env: process.env })
rmSync(tempConfig, { force: true })
if (result.status !== 0) process.exit(result.status || 1)

const artifacts = []
const artifactSuffixes = ['.exe', '.dmg', '.zip', '.AppImage', '.deb', '.yml', '.blockmap']
for (const entry of readdirSync(output, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  if (entry.name === 'builder-debug.yml' || entry.name === 'builder-effective-config.yaml'
      || !artifactSuffixes.some(suffix => entry.name.endsWith(suffix))) continue
  const file = path.join(output, entry.name)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  artifacts.push({ name: entry.name, size: statSync(file).size, sha256: hash.digest('hex') })
}
if (!artifacts.length) throw new Error(`No candidate artifacts were produced in ${output}`)
writeFileSync(path.join(output, 'SHA256SUMS.json'), JSON.stringify({ version: expectedVersion, channel: 'preview', platform: platformTarget[platform], artifacts }, null, 2) + '\n')
console.log(`Candidate artifacts: ${output}`)
}
