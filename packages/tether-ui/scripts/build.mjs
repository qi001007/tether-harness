import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..', '..')
const sharedPath = path.join(root, 'packages/tether-ui/src/app.js')
const pluginPath = path.join(root, 'packages/dsh-plugin-tether-client/lib/client.js')

const strip = (file) => fs.readFileSync(path.join(root, 'packages/tether-ui/src', file), 'utf8')
  .replace(/^export /gm, '')
  .trim()

const shared = strip('app.js')
const dshHost = strip('hosts/dsh.js')

const plugin = `window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const Native = require('tether-dsh-native-ui')
    const PANEL_ID = 'tether'
${dshHost}
    const host = createDshHost()

${shared}
    const tetherPanel = createTetherPanel({ React, Native, host })
    const App = tetherPanel.App
    const TetherIcon = tetherPanel.TetherIcon

    return {
      name: 'tether',
      inject: ['slots', 'layout'],
      apply(ctx) {
        if (new URL(window.location.href).searchParams.has('tether_native')) {
          ctx.layout.selectPanel(null)
          return
        }
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register({ name: 'main', key: PANEL_ID }, App)
        })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => 'Tether'
        }, TetherIcon))
      }
    }
  }
})
`

if (process.argv.includes('--check')) {
  const current = fs.existsSync(pluginPath) ? fs.readFileSync(pluginPath, 'utf8') : ''
  if (current !== plugin) {
    console.error('client.js is out of date; run node packages/tether-ui/scripts/build.mjs')
    process.exit(1)
  }
  console.log('client.js matches shared source')
} else {
  fs.writeFileSync(pluginPath, plugin)
  console.log(JSON.stringify({ plugin: pluginPath, bytes: Buffer.byteLength(plugin), lines: plugin.split('\n').length }))
}