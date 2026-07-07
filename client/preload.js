const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onServerDiscovered: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('server-discovered', handler);
    return () => ipcRenderer.removeListener('server-discovered', handler);
  },
  connectToServer: (url) => ipcRenderer.invoke('connect-server', url),
  backToDiscovery: () => ipcRenderer.invoke('back-to-discovery'),
  rescan: () => ipcRenderer.invoke('rescan'),
});