const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tetherApp', {
  info: () => ipcRenderer.invoke('tether:app-info'),
  openDataDir: () => ipcRenderer.invoke('tether:open-data'),
  openExternal: (url) => ipcRenderer.invoke('tether:open-external', url),
  onStatus: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('tether:status', listener)
    return () => ipcRenderer.off('tether:status', listener)
  }
})