import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..', '..')
const sharedPath = path.join(root, 'packages/tether-ui/src/app.js')
const pluginPath = path.join(root, 'packages/dsh-plugin-tether-client/lib/client.js')
const pluginVersion = JSON.parse(fs.readFileSync(path.join(root, 'packages/dsh-plugin-tether-client/package.json'), 'utf8')).version

const strip = (file) => fs.readFileSync(path.join(root, 'packages/tether-ui/src', file), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
  .trim()

const shared = strip('app.js')
const connectionPanel = strip('connection-panel.js')
const dshHost = strip('hosts/dsh.js')

const plugin = `window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const Native = require('tether-dsh-native-ui')
    const PANEL_ID = 'tether'
    const PLUGIN_VERSION = ${JSON.stringify(pluginVersion)}
${dshHost}
${connectionPanel}
    let localPluginRpc = null
    let localPluginRemote = null
    const host = createDshHost({
      pluginVersion: PLUGIN_VERSION,
      localPluginUpdates: createDshLocalPluginUpdateBridge(() => localPluginRpc),
      localDeviceIdentity: createDshLocalIdentityBridge(() => localPluginRpc),
      localPluginSurfaceReload: createDshLocalPluginSurfaceReloadBridge(() => localPluginRemote)
    })

${shared}
    const tetherPanel = createTetherPanel({ React, Native, host })
    const App = tetherPanel.App
    const TetherIcon = tetherPanel.TetherIcon

    return {
      name: 'tether',
      inject: ['slots', 'layout', 'connection', 'remote', 'remote.workspaceFiles', 'remote.pluginManager'],
      apply(ctx) {
        localPluginRemote = ctx.remote
        if (ctx.connection && ctx.connection.rpc && typeof ctx.connection.rpc.call === 'function') {
          localPluginRpc = ctx.connection.rpc
        }
        if (new URL(window.location.href).searchParams.has('tether_native')) {
          ctx.layout.selectPanel(null)
          const targetFiles = createDshTargetFilesBridge({ getRpc: () => localPluginRpc, getRemote: () => localPluginRemote })
          if (ctx.fileDrag && typeof ctx.fileDrag.read === 'function') {
            const attachments = createDshTargetAttachments(React, Native, targetFiles)
            ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
              name: 'conversation.input.attachments', priority: -1000, locale: 'conversation',
              inject: () => ({ readFileDrag: ctx.fileDrag.read })
            }, attachments))
          }
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
