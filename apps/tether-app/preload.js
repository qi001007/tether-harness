const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tetherApp', {
  info: () => ipcRenderer.invoke('tether:app-info'),
  services: () => ipcRenderer.invoke('tether:services'),
  startServices: () => ipcRenderer.invoke('tether:start-services'),
  stopServices: () => ipcRenderer.invoke('tether:stop-services'),
  restartServices: () => ipcRenderer.invoke('tether:restart-services'),
  openLogs: () => ipcRenderer.invoke('tether:open-logs'),
  openDataDir: () => ipcRenderer.invoke('tether:open-data'),
  openExternal: (url) => ipcRenderer.invoke('tether:open-external', url),
  onStatus: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:status', listener)
    return () => ipcRenderer.off('tether:status', listener)
  }
})