const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tetherApp', {
  info: () => ipcRenderer.invoke('tether:app-info'),
  services: () => ipcRenderer.invoke('tether:services'),
  probeServices: () => ipcRenderer.invoke('tether:probe-services'),
  startServices: () => ipcRenderer.invoke('tether:start-services'),
  stopServices: () => ipcRenderer.invoke('tether:stop-services'),
  restartServices: () => ipcRenderer.invoke('tether:restart-services'),
  updatesStatus: () => ipcRenderer.invoke('tether:updates-status'),
  updatesCheck: () => ipcRenderer.invoke('tether:updates-check'),
  updatesPrepare: () => ipcRenderer.invoke('tether:updates-prepare'),
  updatesApply: (preparedId) => ipcRenderer.invoke('tether:updates-apply', preparedId),
  autoStartAtLogin: () => ipcRenderer.invoke('tether:autostart-get'),
  setAutoStartAtLogin: (enabled) => ipcRenderer.invoke('tether:autostart-set', enabled),
  enrollDevice: (userToken) => ipcRenderer.invoke('tether:enroll-device', userToken),
  resetSurfaceAuth: (origin) => ipcRenderer.invoke('tether:reset-surface-auth', origin),
  workbenchLogin: () => ipcRenderer.invoke('tether:workbench-login'),
  workbenchBindLegacy: (credentials) => ipcRenderer.invoke('tether:workbench-bind-legacy', credentials),
  workbenchRegisterAccount: () => ipcRenderer.invoke('tether:workbench-register-account'),
  workbenchLogout: () => ipcRenderer.invoke('tether:workbench-logout'),
  hubRequest: (request) => ipcRenderer.invoke('tether:hub-request', request),
  subscribeHubEvents: () => ipcRenderer.invoke('tether:hub-events-subscribe'),
  unsubscribeHubEvents: () => ipcRenderer.invoke('tether:hub-events-unsubscribe'),
  workbenchCatalog: (targetId) => ipcRenderer.invoke('tether:workbench-catalog', targetId),
  workbenchOpen: (targetId, serviceId) => ipcRenderer.invoke('tether:workbench-open', targetId, serviceId),
  workbenchClose: (targetId, serviceId, grantId) => ipcRenderer.invoke('tether:workbench-close', targetId, serviceId, grantId),
  workbenchView: (targetId, serviceId, visible) => ipcRenderer.invoke('tether:workbench-view', targetId, serviceId, visible),
  filesRequest: (request) => ipcRenderer.invoke('tether:files-request', request),
  openLogs: () => ipcRenderer.invoke('tether:open-logs'),
  openDataDir: () => ipcRenderer.invoke('tether:open-data'),
  openExternal: (url) => ipcRenderer.invoke('tether:open-external', url),
  windowControl: (action) => ipcRenderer.invoke('tether:window-control', action),
  onWindowState: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:window-state', listener)
    return () => ipcRenderer.off('tether:window-state', listener)
  },
  onWorkbenchLoginResult: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:workbench-login-result', listener)
    return () => ipcRenderer.off('tether:workbench-login-result', listener)
  },
  onHubEvent: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:hub-event', listener)
    return () => ipcRenderer.off('tether:hub-event', listener)
  },
  onStatus: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:status', listener)
    return () => ipcRenderer.off('tether:status', listener)
  },
  onSurfaceBootFailed: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:surface-boot-failed', listener)
    return () => ipcRenderer.off('tether:surface-boot-failed', listener)
  },
  onSurfaceStyleBroken: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:surface-style-broken', listener)
    return () => ipcRenderer.off('tether:surface-style-broken', listener)
  }
})
