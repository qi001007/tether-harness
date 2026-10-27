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
  openLogs: () => ipcRenderer.invoke('tether:open-logs'),
  openDataDir: () => ipcRenderer.invoke('tether:open-data'),
  openExternal: (url) => ipcRenderer.invoke('tether:open-external', url),
  onStatus: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:status', listener)
    return () => ipcRenderer.off('tether:status', listener)
  }
})
