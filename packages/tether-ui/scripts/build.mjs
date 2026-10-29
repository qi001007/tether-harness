import fs from 'node:fs'
import path from 'node:path'
import { bundledMonacoRuntime } from './monaco-build.mjs'

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
const monacoRuntime = await bundledMonacoRuntime()

const plugin = `window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const Native = require('tether-dsh-native-ui')
${monacoRuntime}
    const EditorRuntime = TetherMonacoRuntime
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
    const tetherPanel = createTetherPanel({ React, Native, host, EditorRuntime })
    const App = tetherPanel.App
    const TetherIcon = tetherPanel.TetherIcon

    return {
      name: 'tether',
      inject: ['slots', 'layout', 'connection', 'remote', 'remote.workspaceFiles', 'remote.pluginManager', 'commandUi'],
      apply(ctx) {
        localPluginRemote = ctx.remote
        if (ctx.connection && ctx.connection.rpc && typeof ctx.connection.rpc.call === 'function') {
          localPluginRpc = ctx.connection.rpc
        }
        const embedded = (() => { try { return window.top !== window.self } catch (_) { return true } })()
        if (embedded || new URL(window.location.href).searchParams.has('tether_native')) {
          try { ctx.layout.selectPanel(null) } catch (_) { /* embedded surface has no Tether panel */ }
          try {
            if (typeof document !== 'undefined') {
              document.documentElement.dataset.tetherNativeSurface = '1'
              const nativeSurfaceStyleId = 'tether-native-surface-chrome'
              if (!document.getElementById(nativeSurfaceStyleId)) {
                const nativeSurfaceStyle = document.createElement('style')
                nativeSurfaceStyle.id = nativeSurfaceStyleId
                nativeSurfaceStyle.textContent = 'html[data-tether-native-surface] :is(div, aside, nav):has([aria-label="全局面板"]) { border-right-color: transparent !important; border-inline-end-color: transparent !important; }'
                document.head.appendChild(nativeSurfaceStyle)
              }
            }
          } catch (_) { /* DSH chrome stays usable if style injection is unavailable */ }
          try {
            const targetFiles = createDshTargetFilesBridge({ getRpc: () => localPluginRpc, getRemote: () => localPluginRemote })
            const targetFilePicker = { open: null }
            if (ctx.fileDrag && typeof ctx.fileDrag.read === 'function') {
              const attachments = createDshTargetAttachments(React, Native, targetFiles, targetFilePicker)
              ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
                name: 'conversation.input.attachments', priority: -1000, locale: 'conversation',
                inject: () => ({ readFileDrag: ctx.fileDrag.read })
              }, attachments))
            }
            ctx.inject(['commandUi'], (scope) => {
              const commands = scope.get('commandUi')
              scope.effect(() => commands.register({
                name: 'tether-target-file', label: () => '目标设备文件', icon: TetherIcon,
                available: () => typeof targetFilePicker.open === 'function',
                ui: { kind: 'action', run: () => targetFilePicker.open?.() }
              }), 'tether: target device file action')
            })
          } catch (_) { /* attachments are optional in an embedded surface */ }
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
