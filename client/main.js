const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const dgram = require('dgram');

const DISCOVERY_PORT = 25000;
const SEARCH_TIMEOUT = 5000;

let mainWindow;
const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const discoveredServers = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    title: 'LAN Chat - 客户端',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

// UDP 监听
udpSocket.on('message', (msg, rinfo) => {
  try {
    const data = JSON.parse(msg.toString());
    if (data.type === 'lan-chat-server') {
      const key = `${rinfo.address}:${data.port}`;
      const server = {
        name: data.name || rinfo.address,
        ip: rinfo.address,
        port: data.port || 8082,
        version: data.version || '1.0',
        lastSeen: Date.now(),
      };
      if (!discoveredServers.has(key) || discoveredServers.get(key).name !== server.name) {
        discoveredServers.set(key, server);
        if (mainWindow) mainWindow.webContents.send('server-discovered', server);
      }
    }
  } catch (e) { /* 忽略无效包 */ }
});

udpSocket.bind(DISCOVERY_PORT, () => { /* 只收不发 */ });

// 客户端请求连接服务器
ipcMain.handle('connect-server', async (event, url) => {
  mainWindow.loadURL(url);
});

// 客户端请求返回发现页
ipcMain.handle('back-to-discovery', async () => {
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
});

// 客户端请求重新搜索
ipcMain.handle('rescan', async () => {
  discoveredServers.clear();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  udpSocket.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});