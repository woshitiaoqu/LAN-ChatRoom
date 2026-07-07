const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const dgram = require('dgram');

const DISCOVERY_PORT = 25000;
let mainWindow;
const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const discoveredServers = new Map();

function createWindow() {
  const { screen } = require('electron');
  const bounds = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1200, bounds.width),
    height: Math.min(800, bounds.height),
    minWidth: 400,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    title: 'LAN Chat - 客户端',
    show: false,
  });
  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

udpSocket.on('message', (msg, rinfo) => {
  try {
    const data = JSON.parse(msg.toString());
    if (data.type === 'lan-chat-server' && mainWindow) {
      const key = `${data.ip}:${data.port}`;
      if (!discoveredServers.has(key)) {
        discoveredServers.set(key, { name: data.name || rinfo.address, ip: data.ip, port: data.port || 8082 });
        mainWindow.webContents.send('server-discovered', discoveredServers.get(key));
      }
    }
  } catch (e) { /* ignore */ }
});

udpSocket.bind(DISCOVERY_PORT);

ipcMain.handle('connect-server', async (event, url) => {
  event.sender.send('navigate-to', url);
});

ipcMain.handle('back-to-discovery', async () => {
  discoveredServers.clear();
  mainWindow.loadFile('index.html');
});

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