const fs = require('node:fs')
const path = require('node:path')

function requireFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Packaged runtime is missing ${label}: ${file}`)
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

  const office = windows ? ['program', 'soffice.com'] : platform === 'linux'
    ? ['opt', 'libreoffice26.8', 'program', 'soffice']
    : platform === 'darwin' ? ['LibreOffice.app', 'Contents', 'MacOS', 'soffice'] : null
  if (!office) throw new Error(`Unsupported packaged runtime platform: ${platform}`)
  requireFile(path.join(runtime, 'components', 'libreoffice', ...office), 'LibreOffice executable')

  for (const [component, executable] of [
    ['caddy', `caddy${suffix}`], ['rclone', `rclone${suffix}`],
    ['easytier', `easytier-core${suffix}`], ['easytier', `easytier-cli${suffix}`]
  ]) requireUniqueExecutable(path.join(runtime, 'components', component), executable)
}
