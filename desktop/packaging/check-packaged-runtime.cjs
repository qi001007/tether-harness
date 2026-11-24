const fs = require('node:fs')
const path = require('node:path')

function requireFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Packaged runtime is missing ${label}: ${file}`)
  }
}

// The app.asar `files` whitelist is hand-maintained, so a new main-process module
// can ship missing and the packaged app then fails on its first require (0.5.14
// shipped without data-maintenance.js). Read the whitelist itself as the contract.
function listedAppModules(configPath = path.join(__dirname, 'electron-builder.yml')) {
  const modules = []
  let inFiles = false
  for (const line of fs.readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inFiles = /^files:/.test(line)
      continue
    }
    if (!inFiles) continue
    const match = /^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (match && !match[1].startsWith('!') && match[1].endsWith('.js')) modules.push(match[1])
  }
  return modules
}

function readAsarTree(archivePath) {
  const descriptor = fs.openSync(archivePath, 'r')
  try {
    const pickle = Buffer.alloc(16)
    if (fs.readSync(descriptor, pickle, 0, 16, 0) !== 16) throw new Error(`Packaged app archive has no header: ${archivePath}`)
    const headerSize = pickle.readUInt32LE(12)
    if (headerSize < 2 || headerSize > 64 * 1024 * 1024) throw new Error(`Packaged app archive header size is invalid: ${archivePath}`)
    const header = Buffer.alloc(headerSize)
    if (fs.readSync(descriptor, header, 0, headerSize, 16) !== headerSize) {
      throw new Error(`Packaged app archive header is truncated: ${archivePath}`)
    }
    const tree = JSON.parse(header.toString('utf8'))
    if (!tree || typeof tree.files !== 'object' || tree.files === null) {
      throw new Error(`Packaged app archive header has no file tree: ${archivePath}`)
    }
    return tree
  } finally {
    fs.closeSync(descriptor)
  }
}

function requireAsarModule(archivePath, moduleName) {
  const entry = readAsarTree(archivePath).files[moduleName]
  if (!entry || entry.files !== undefined || typeof entry.size !== 'number' || entry.size <= 0
      || typeof entry.offset !== 'string') {
    throw new Error(`Packaged app archive is missing main-process module ${moduleName}: ${archivePath}`)
  }
}

function requirePnpmLauncher(runtime, windows) {
  const nodeRuntime = path.join(runtime, 'components', 'nodejs')
  const metadataPath = path.join(nodeRuntime, 'pnpm.json')
  requireFile(metadataPath, 'pnpm launcher metadata')
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  const shim = windows ? 'pnpm.cmd' : path.join('bin', 'pnpm')
  if (metadata.component !== 'pnpm' || metadata.shim !== shim || typeof metadata.entry !== 'string'
      || typeof metadata.version !== 'string') {
    throw new Error(`Packaged pnpm launcher metadata is invalid: ${metadataPath}`)
  }
  const launcher = path.join(nodeRuntime, shim)
  requireFile(launcher, 'pnpm launcher')
  // `dsh plugin --profile web add` forwards to pnpm on PATH; a launcher that points
  // outside the package would silently reintroduce the hand-patched D: path.
  if (!/^\.\.?[\\/]/.test(metadata.entry)) {
    throw new Error(`Packaged pnpm launcher must stay inside the runtime: ${metadata.entry}`)
  }
  const implementation = path.join(nodeRuntime, metadata.entry)
  requireFile(implementation, 'pnpm implementation')
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(implementation), '..', 'package.json'), 'utf8'))
  if (manifest.name !== 'pnpm' || manifest.version !== metadata.version) {
    throw new Error(`Packaged pnpm version ${manifest.version} does not match its launcher metadata ${metadata.version}`)
  }
}

function requireUniqueExecutable(componentRoot, executable) {
  const matches = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) matches.push(target)
    }
  }
  if (fs.existsSync(componentRoot)) walk(componentRoot)
  if (matches.length !== 1) {
    throw new Error(`Packaged runtime executable must occur exactly once: ${path.basename(componentRoot)}/${executable} (found ${matches.length})`)
  }
}

module.exports = async function checkPackagedRuntime(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  const runtime = path.join(resources, 'tether-runtime')
  const platform = context.electronPlatformName
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error(`Unsupported packaged runtime architecture: ${context.arch}`)

  const windows = platform === 'win32'
  const suffix = windows ? '.exe' : ''
  requireFile(path.join(runtime, `tether-python${suffix}`), 'Python')
  requireFile(path.join(runtime, 'components', 'nodejs', windows ? 'node.exe' : 'bin', ...(windows ? [] : ['node'])), 'Node.js')
  requireFile(path.join(runtime, 'components', 'meshcentral', 'meshcentral.js'), 'MeshCentral entry point')

  const meshAgent = platform === 'win32' && arch === 'x64' ? ['windows-x64', 'MeshService64.exe']
    : platform === 'linux' && arch === 'x64' ? ['linux-x64', 'meshagent_x86-64']
      : platform === 'darwin' && arch === 'x64' ? ['macos-x64', 'meshagent_osx-x86-64']
        : platform === 'darwin' && arch === 'arm64' ? ['macos-arm64', 'meshagent_osx-arm-64'] : null
  if (!meshAgent) throw new Error(`Unsupported packaged MeshAgent platform/architecture: ${platform}/${arch}`)
  requireFile(path.join(runtime, 'components', 'meshagent', ...meshAgent), 'MeshAgent')

  const office = windows ? ['dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-x64', 'bin', 'libreoffice-kit.exe'] : platform === 'linux'
    ? ['libreoffice', 'opt', 'libreoffice26.8', 'program', 'soffice']
    : platform === 'darwin' ? ['libreoffice', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'] : null
  if (!office) throw new Error(`Unsupported packaged runtime platform: ${platform}`)
  requireFile(path.join(runtime, 'components', ...office), 'LibreOffice executable')

  if (windows) {
    requireFile(path.join(runtime, 'components', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'), 'Office converter')
    requireFile(path.join(runtime, 'components', 'libreoffice', 'System64', 'msvcp140_2.dll'), 'Office C++ runtime')
  }

  for (const [component, executable] of [
    ['caddy', `caddy${suffix}`], ['rclone', `rclone${suffix}`],
    ['easytier', `easytier-core${suffix}`], ['easytier', `easytier-cli${suffix}`]
  ]) requireUniqueExecutable(path.join(runtime, 'components', component), executable)

  requirePnpmLauncher(runtime, windows)

  const archive = path.join(resources, 'app.asar')
  requireFile(archive, 'app.asar')
  for (const moduleName of listedAppModules()) requireAsarModule(archive, moduleName)
  requireAsarModule(archive, 'package.json')
}
