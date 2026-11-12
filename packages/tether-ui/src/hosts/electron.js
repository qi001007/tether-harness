import { createWebHost } from './web.js'

export function createElectronHost({ apiBase = '' } = {}) {
  const webHost = createWebHost({ apiBase })
  return {
    ...webHost,
    kind: 'app',
    appInfo: () => window.tetherApp.info(),
    hubRequest: (request) => window.tetherApp.hubRequest(request),
    filesRequest: (request) => window.tetherApp.filesRequest(request),
    subscribeHubEvents: (callback) => {
      const removeListener = window.tetherApp.onHubEvent(callback)
      let active = true
      let ready = false
      Promise.resolve(window.tetherApp.subscribeHubEvents()).then(() => {
        ready = true
        if (!active) return window.tetherApp.unsubscribeHubEvents()
        return undefined
      }).catch(() => {})
      return () => {
        active = false
        if (typeof removeListener === 'function') removeListener()
        if (ready) void window.tetherApp.unsubscribeHubEvents()
      }
    },
    connectionInfo: async (activeBase) => {
      if (webHost.hubConfig()) return webHost.connectionInfo(activeBase)
      const state = await window.tetherApp.services()
      return {
        address: state.remoteUrl || (state.endpoints && state.endpoints.api) || '未配置',
        status: state.lastProbe && state.lastProbe.status || 'unknown',
        errorKind: state.lastProbe && state.lastProbe.errorKind,
        checkedAt: state.lastProbe && state.lastProbe.checkedAt,
        durationMs: state.lastProbe && state.lastProbe.durationMs
      }
    },
    probeConnection: async (activeBase, token) => {
      if (webHost.hubConfig()) return webHost.probeConnection(activeBase, token)
      const state = await window.tetherApp.probeServices()
      return {
        address: state.remoteUrl || (state.endpoints && state.endpoints.api) || '未配置',
        status: state.lastProbe && state.lastProbe.status || 'unknown',
        errorKind: state.lastProbe && state.lastProbe.errorKind,
        checkedAt: state.lastProbe && state.lastProbe.checkedAt,
        durationMs: state.lastProbe && state.lastProbe.durationMs
      }
    },
    updates: {
      status: () => window.tetherApp.updatesStatus(),
      check: () => window.tetherApp.updatesCheck(),
      prepare: () => window.tetherApp.updatesPrepare(),
      apply: (preparedId) => window.tetherApp.updatesApply(preparedId)
    },
    workbench: {
      login: () => window.tetherApp.workbenchLogin(),
      authStatus: () => window.tetherApp.workbenchAuthStatus(),
      bindLegacy: (credentials) => window.tetherApp.workbenchBindLegacy(credentials),
      registerAccount: () => window.tetherApp.workbenchRegisterAccount(),
      logout: () => window.tetherApp.workbenchLogout(),
      onLoginResult: (callback) => window.tetherApp.onWorkbenchLoginResult(callback),
      catalog: (targetId) => window.tetherApp.workbenchCatalog(targetId),
      open: (targetId, serviceId) => window.tetherApp.workbenchOpen(targetId, serviceId),
      openLegacyCodeg: (targetId) => window.tetherApp.workbenchOpenLegacyCodeg(targetId),
      openDshSurface: (targetId) => window.tetherApp.workbenchOpenDshSurface(targetId),
      close: (targetId, serviceId, grantId) => window.tetherApp.workbenchClose(targetId, serviceId, grantId),
      view: (targetId, serviceId, visible) => window.tetherApp.workbenchView(targetId, serviceId, visible)
    },
    windowControls: {
      action: (name) => window.tetherApp.windowControl(name),
      state: () => window.tetherApp.windowControl('state'),
      onState: (callback) => window.tetherApp.onWindowState(callback)
    }
  }
}
