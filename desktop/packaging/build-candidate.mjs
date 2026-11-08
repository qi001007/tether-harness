import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const expectedVersion = '0.5.0'
const appPackage = JSON.parse(readFileSync(path.join(repoRoot, 'apps/tether-app/package.json'), 'utf8'))
const version = JSON.parse(readFileSync(path.join(repoRoot, 'version.json'), 'utf8'))
if (appPackage.version !== expectedVersion || version.components?.app !== expectedVersion || version.components?.node !== expectedVersion) {
  throw new Error(`Candidate versions must be synchronized to ${expectedVersion}; packaging found app=${appPackage.version}, version.json=${version.components?.app}/${version.components?.node}.`)
}
if (version.components.plugin !== '0.2.93') throw new Error('Candidate must retain the frozen DSH plugin version 0.2.93.')

const defaultRuntimeRoot = path.join(repoRoot, '.runtime/desktop-candidate')
const runtimeRoot = path.resolve(process.env.TETHER_CANDIDATE_RUNTIME_ROOT || defaultRuntimeRoot)
if (process.env.TETHER_CANDIDATE_RUNTIME_ROOT) {
  const allowedRuntimeRoot = path.resolve(repoRoot, '.scratch/tether-desktop-candidates/0.5.0')
  if (runtimeRoot !== allowedRuntimeRoot && !runtimeRoot.startsWith(allowedRuntimeRoot + path.sep)) {
    throw new Error('TETHER_CANDIDATE_RUNTIME_ROOT must point into the isolated 0.5.0 candidate scratch directory.')
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

const defaultOutputParent = path.join(repoRoot, '.scratch/tether-desktop-candidates/0.5.0')
const outputParent = path.resolve(process.env.TETHER_CANDIDATE_OUTPUT_ROOT || defaultOutputParent)
if (process.env.TETHER_CANDIDATE_OUTPUT_ROOT
    && !outputParent.replaceAll('\\', '/').includes('/.scratch/tether-desktop-candidates/0.5.0')) {
  throw new Error('TETHER_CANDIDATE_OUTPUT_ROOT must point into the isolated 0.5.0 candidate scratch directory.')
}
const output = path.join(outputParent, platformTarget[platform])
if (path.dirname(output) !== outputParent) throw new Error('Refusing to write outside the platform-specific candidate output directory.')
if (existsSync(output)) throw new Error(`Candidate output already exists; refusing to replace it: ${output}`)
mkdirSync(outputParent, { recursive: true })
const builderCli = path.join(packagingDir, 'node_modules/electron-builder/cli.js')
if (!existsSync(builderCli)) throw new Error('Packaging tools are not installed; run npm ci in desktop/packaging first.')
const electronPackagePath = path.join(repoRoot, 'apps/tether-app/node_modules/electron/package.json')
if (!existsSync(electronPackagePath)) throw new Error('Electron is not installed in apps/tether-app; run npm ci --prefix apps/tether-app first.')
const electronVersion = JSON.parse(readFileSync(electronPackagePath, 'utf8')).version
if (!/^\d+\.\d+\.\d+$/.test(electronVersion)) throw new Error(`Installed Electron version is not pinned: ${electronVersion}`)
const baseConfigPath = path.join(packagingDir, 'electron-builder.yml')
const baseConfig = readFileSync(baseConfigPath, 'utf8')
const outputSetting = 'output: .scratch/tether-desktop-candidates/0.5.0'
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
  .replace('appId: com.tether.app', `appId: com.tether.app\nelectronVersion: ${electronVersion}`)
writeFileSync(tempConfig, config)
const args = [builderCli, '--projectDir', repoRoot,
  '--config', tempConfig,
  ...(platform === 'windows' ? ['--win', 'nsis'] : platform === 'linux' ? ['--linux', 'AppImage', 'deb'] : ['--mac', 'dmg', 'zip']),
  '--' + arch, '--publish', 'never']
const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit', env: process.env })
rmSync(tempConfig, { force: true })
if (result.status !== 0) process.exit(result.status || 1)

const artifacts = []
const artifactSuffixes = ['.exe', '.dmg', '.zip', '.AppImage', '.deb', '.yml', '.blockmap']
for (const entry of readdirSync(output, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  if (entry.name === 'builder-debug.yml' || entry.name === 'builder-effective-config.yaml') continue
  if (!artifactSuffixes.some(suffix => entry.name.endsWith(suffix))) continue
  const file = path.join(output, entry.name)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  artifacts.push({ name: entry.name, size: statSync(file).size, sha256: hash.digest('hex') })
}
if (!artifacts.length) throw new Error(`No candidate artifacts were produced in ${output}`)
writeFileSync(path.join(output, 'SHA256SUMS.json'), JSON.stringify({ version: expectedVersion, channel: 'preview', platform: platformTarget[platform], artifacts }, null, 2) + '\n')
console.log(`Candidate artifacts: ${output}`)
