const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onServerDiscovered: (callback) => {
    const h = (e, d) => callback(d);
    ipcRenderer.on('server-discovered', h);
    return () => ipcRenderer.removeListener('server-discovered', h);
  },
  onNavigate: (callback) => {
    const h = (e, url) => callback(url);
    ipcRenderer.on('navigate-to', h);
    return () => ipcRenderer.removeListener('navigate-to', h);
  },
  connectToServer: (url) => ipcRenderer.invoke('connect-server', url),
  backToDiscovery: () => ipcRenderer.invoke('back-to-discovery'),
  rescan: () => ipcRenderer.invoke('rescan'),
});