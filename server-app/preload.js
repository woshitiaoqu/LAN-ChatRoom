const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('serverAPI', {
  onLog: (cb) => {
    ipcRenderer.on('log', (e, msg) => cb(msg));
  },
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
