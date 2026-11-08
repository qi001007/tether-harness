const path = require('node:path')

const runtime = process.env.TETHER_DSH_RUNTIME_DIR
if (!runtime) throw new Error('TETHER_DSH_RUNTIME_DIR is required')
const modules = path.join(path.resolve(runtime), 'node_modules')
const nodePty = require(path.join(modules, 'node-pty'))
require(path.join(modules, 'koffi'))

const terminal = nodePty.spawn(process.execPath, ['--version'], {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
})
let output = ''
let finished = false
const timeout = setTimeout(() => {
  if (finished) return
  finished = true
  terminal.kill()
  process.stderr.write('Bundled DSH PTY command did not finish within 8 seconds.\n')
  process.exitCode = 1
}, 8000)

terminal.onData((data) => { output += data })
terminal.onExit(({ exitCode }) => {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  if (exitCode !== 0 || !output.includes(process.versions.node)) {
    process.stderr.write('Bundled DSH PTY did not return the expected Node version.\n')
    process.exitCode = 1
    return
  }
  process.stdout.write(`Bundled DSH PTY and Koffi are available under Node ${process.versions.node}.\n`)
})
