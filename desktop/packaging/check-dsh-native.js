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
let forceExit

function finish(code, message) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  clearTimeout(forceExit)
  if (message) process.stderr.write(message)
  process.stdout.write('', () => process.exit(code))
}

const timeout = setTimeout(() => {
  if (finished) return
  terminal.kill()
  finish(1, 'Bundled DSH PTY command did not finish within 8 seconds.\n')
}, 8000)
forceExit = setTimeout(() => {
  if (finished) return
  terminal.kill()
  finish(1, 'Bundled DSH PTY check did not clean up after its timeout.\n')
}, 10000)

terminal.onData((data) => { output += data })
terminal.onExit(({ exitCode }) => {
  if (finished) return
  if (exitCode !== 0 || !output.includes(process.versions.node)) {
    finish(1, 'Bundled DSH PTY did not return the expected Node version.\n')
    return
  }
  clearTimeout(forceExit)
  finish(0, `Bundled DSH PTY and Koffi are available under Node ${process.versions.node}.\n`)
})
