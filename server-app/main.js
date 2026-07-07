const { app, BrowserWindow, Menu, Tray } = require('electron');
const path = require('path');
const { startServer } = require('./server.js');

let win, tray;

function createWindow() {
  win = new BrowserWindow({
    width: 800, height: 600,
    minWidth: 400, minHeight: 250,
    title: 'LAN Chat 服务端',
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile('index.html');
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function appendLog(msg) {
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(`addLog(${JSON.stringify(msg)})`);
  }
}

const origLog = console.log;
const origErr = console.error;
console.log = (...args) => { origLog(...args); appendLog(args.join(' ')); };
console.error = (...args) => { origErr(...args); appendLog('[ERR] ' + args.join(' ')); };

app.whenReady().then(() => {
  createWindow();
  win.once('ready-to-show', () => win.show());

  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    tray.setToolTip('LAN Chat 服务端');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: () => win.show() },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => win.show());
  } catch (e) {}

  console.log('正在启动 LAN Chat 服务端...');
  startServer(true);
});

app.on('window-all-closed', () => {});
