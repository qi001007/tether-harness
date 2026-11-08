import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { bundledMonacoRuntime } from './monaco-build.mjs'

const root = path.resolve(import.meta.dirname, '..', '..', '..')
const uiRoot = path.join(root, 'packages/tether-ui')
const cytoscapeBundle = await build({
  absWorkingDir: uiRoot,
  stdin: {
    contents: "import cytoscape from 'cytoscape'; window.__tetherCytoscape = cytoscape",
    resolveDir: uiRoot,
    sourcefile: 'cytoscape-runtime.js'
  },
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  write: false,
  logLevel: 'silent'
})
const sharedPath = path.join(root, 'packages/tether-ui/src/app.js')
const pluginPath = path.join(root, 'packages/dsh-plugin-tether-client/lib/client.js')
const pluginVersion = JSON.parse(fs.readFileSync(path.join(root, 'packages/dsh-plugin-tether-client/package.json'), 'utf8')).version

const strip = (file) => fs.readFileSync(path.join(root, 'packages/tether-ui/src', file), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
  .trim()

const shared = strip('app.js')
const connectionPanel = strip('connection-panel.js')
const settingsPanel = strip('settings-panel.js')
const teamManagement = strip('team-management.js')
const targetFileExplorer = strip('target-file-explorer.js')
const fileCache = strip('file-cache.js')
const dshHost = strip('hosts/dsh.js')
const transferEngine = strip('transfer.js')
const transferPage = strip('transfer-page.js')
const terminalDock = strip('terminal-dock.js')
const agentIcons = strip('agent-icons.js')
const agentCache = strip('agent-cache.js')
const agentAccountCache = strip('agent-account-cache.js')
const agentAccountsPanel = strip('agent-accounts-panel.js')
const agentCatalog = strip('agent-catalog.js')
const agentsHome = strip('agents-home.js')
const agentsPage = strip('agents-page.js')
const monacoRuntime = await bundledMonacoRuntime()

const plugin = `window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const Native = require('tether-dsh-native-ui')
${cytoscapeBundle.outputFiles[0].text}
    const cytoscape = window.__tetherCytoscape
${monacoRuntime}
    const EditorRuntime = TetherMonacoRuntime
    const PANEL_ID = 'tether'
    const PLUGIN_VERSION = ${JSON.stringify(pluginVersion)}
${targetFileExplorer}
${fileCache}
${dshHost}
${connectionPanel}
${settingsPanel}
${teamManagement}
${transferEngine}
${transferPage}
${terminalDock}
${agentIcons}
${agentCache}
${agentAccountCache}
${agentAccountsPanel}
${agentCatalog}
${agentsHome}
${agentsPage}
    let localPluginRpc = null
    let localPluginRemote = null
    let exitPanel = null
    const host = createDshHost({
      pluginVersion: PLUGIN_VERSION,
      localPluginUpdates: createDshLocalPluginUpdateBridge(() => localPluginRpc),
      localDeviceIdentity: createDshLocalIdentityBridge(() => localPluginRpc),
      localPluginSurfaceReload: createDshLocalPluginSurfaceReloadBridge(() => localPluginRemote)
    })
    host.exitPanel = () => {
      try { if (typeof exitPanel === 'function') exitPanel() } catch (_) { /* DSH panel may already be gone */ }
    }

${shared}
    const tetherPanel = createTetherPanel({ React, Native, host, EditorRuntime })
    const App = tetherPanel.App
    const TetherIcon = tetherPanel.TetherIcon

    return {
      name: 'tether',
      inject: ['slots', 'layout', 'connection', 'remote', 'remote.pluginManager', 'commandUi', 'uiWorkspace', 'sessions'],
      apply(ctx) {
        localPluginRemote = ctx.remote
        if (ctx.connection && ctx.connection.rpc && typeof ctx.connection.rpc.call === 'function') {
          localPluginRpc = ctx.connection.rpc
        }
        if (typeof ctx.effect === 'function') {
          const stopHotReload = createDshPluginHotReloadWatch({
            getRpc: () => localPluginRpc,
            reloadSurface: () => host.reloadLocalPluginSurface(),
            storage: (() => { try { return window.localStorage } catch (_) { return null } })()
          })
          ctx.effect(() => stopHotReload)
        }
        exitPanel = () => {
          try { ctx.layout.selectPanel(null) } catch (_) { /* DSH layout is optional in embedded surfaces */ }
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
            const targetFiles = createDshTargetExplorerBridge({ getRpc: () => localPluginRpc, getHost: () => host })
            const targetFilePicker = { open: null, pendingSessionStart: null }
            ctx.inject(['commandUi'], (scope) => {
              const commands = scope.get('commandUi')
              scope.effect(() => commands.register({
                name: 'tether-target-files',
                label: () => '目标设备文件',
                available: () => true,
                ui: { kind: 'action', run: (session) => {
                  const result = targetFilePicker.open?.(session?.sessionId) || 'not-ready'
                  if (result !== 'opened') window.alert(result === 'busy'
                    ? '目标设备文件浏览器正在打开，请稍候。'
                    : result === 'not-accepting'
                      ? '当前会话暂不接受附件。'
                      : '目标设备文件浏览器尚未就绪，请待工作区加载完成后重试。')
                } }
              }), 'tether: target files command')
            })
            if (ctx.connection && ctx.connection.rpc && typeof ctx.connection.rpc.call === 'function') {
              const attachments = createDshTargetAttachments(React, Native, targetFiles, targetFilePicker, ctx.uiWorkspace, ctx.sessions)
              ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
                name: 'conversation.input.attachments', priority: -1000, locale: 'conversation',
                inject: (sessionId) => ({ sessionId })
              }, attachments))
            }
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
