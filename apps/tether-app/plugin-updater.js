const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function updateInstalledPlugin({ repoRoot }) {
  const source = path.join(repoRoot, 'packages', 'dsh-plugin-tether-client', 'lib', 'client.js')
  if (!fs.existsSync(source)) return { updated: false, reason: 'source missing', dirs: [] }
  const sourceHash = hash(source)
  const root = path.join(os.homedir(), '.dsh', 'profiles')
  if (!fs.existsSync(root)) return { updated: false, reason: 'no dsh profiles', dirs: [] }
  const dirs = []
  const errors = []
  for (const profile of fs.readdirSync(root)) {
    const target = path.join(root, profile, 'node_modules', 'tether-dsh-client', 'lib', 'client.js')
    if (!fs.existsSync(target)) continue
    try {
      if (hash(target) === sourceHash) continue
      const backup = target + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
      fs.copyFileSync(target, backup)
      fs.copyFileSync(source, target)
      if (hash(target) !== sourceHash) throw new Error('hash mismatch after copy')
      dirs.push({ profile, backup })
    } catch (error) {
      errors.push({ profile, error: String(error.message || error) })
    }
  }
  return { updated: dirs.length > 0, sourceHash, dirs, errors }
}

module.exports = { updateInstalledPlugin }