const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');

let win, tray;
let dbReady = false;

function createWindow() {
  win = new BrowserWindow({
    width: 900, height: 650,
    minWidth: 400, minHeight: 250,
    title: 'LAN Chat 服务端',
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile('console.html');
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

let logQueue = [];
function appendLog(msg) {
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(`addLog(${JSON.stringify(msg)})`).catch(() => {});
  } else {
    logQueue.push(msg);
  }
}

const origLog = console.log;
const origErr = console.error;
console.log = (...args) => { origLog(...args); appendLog(args.join(' ')); };
console.error = (...args) => { origErr(...args); appendLog('[ERR] ' + args.join(' ')); };

let admin, db, wss, fileAdmin, getTotalMessageCount, queryUserMessages, clearAllMessages, startServer;
const mod = require('./server.js');

function waitForDb() {
  return new Promise(resolve => {
    if (dbReady) return resolve();
    const check = setInterval(() => {
      if (mod.db) { dbReady = true; clearInterval(check); resolve(); }
    }, 100);
  });
}

function setupAdminHandlers() {
  admin = mod.admin;
  wss = mod.wss;
  fileAdmin = mod.fileAdmin;
  getTotalMessageCount = mod.getTotalMessageCount;
  queryUserMessages = mod.queryUserMessages;
  clearAllMessages = mod.clearAllMessages;
  startServer = mod.startServer;

  const dbGuard = (fn) => async (...args) => {
    await waitForDb();
    return fn(...args);
  };

  ipcMain.handle('admin:getOnlineUsers', () => admin.getOnlineUsers());
  ipcMain.handle('admin:getServerStatus', () => admin.getServerStatus());
  ipcMain.handle('admin:getBannedWords', () => admin.getBannedWords());
  ipcMain.handle('admin:broadcast', (e, content) => admin.broadcastSystemMessage(content));
  ipcMain.handle('admin:muteUser', (e, userId, mute) => admin.muteUser(userId, mute));
  ipcMain.handle('admin:muteByUsername', (e, username, mute) => admin.muteUserByUsername(username, mute));
  ipcMain.handle('admin:kickUser', (e, userId) => admin.kickUser(userId));
  ipcMain.handle('admin:kickByUsername', (e, username) => admin.kickUserByUsername(username));
  ipcMain.handle('admin:banIp', (e, ip) => admin.banIp(ip));
  ipcMain.handle('admin:unbanIp', (e, ip) => admin.unbanIp(ip));
  ipcMain.handle('admin:banMac', (e, mac) => admin.banMac(mac));
  ipcMain.handle('admin:unbanMac', (e, mac) => admin.unbanMac(mac));
  ipcMain.handle('admin:addBannedWord', (e, word) => admin.addBannedWord(word));
  ipcMain.handle('admin:removeBannedWord', (e, word) => admin.removeBannedWord(word));
  ipcMain.handle('admin:bannedIps', () => admin.bannedIps);
  ipcMain.handle('admin:bannedMacs', () => admin.bannedMacs);
  ipcMain.handle('admin:getTotalMessageCount', dbGuard(getTotalMessageCount));
  ipcMain.handle('admin:queryMessages', dbGuard((username, start, end, limit) =>
    queryUserMessages(username, start, end, limit)));
  ipcMain.handle('admin:clearMessages', dbGuard(clearAllMessages));
  ipcMain.handle('admin:getFiles', dbGuard(() => fileAdmin.getFileList()));
  ipcMain.handle('admin:deleteFile', dbGuard((e, id) => fileAdmin.deleteFile(id)));
}

// 先注册 IPC 处理器，再创建窗口（避免渲染器过早调用）
setupAdminHandlers();

app.whenReady().then(() => {
  console.log('正在启动 LAN Chat 服务端...');
  startServer(true);
  createWindow();
  win.once('ready-to-show', () => {
    win.show();
    for (const msg of logQueue) {
      win.webContents.executeJavaScript(`addLog(${JSON.stringify(msg)})`).catch(() => {});
    }
    logQueue = [];
    win.webContents.executeJavaScript('ready()').catch(() => {});
  });

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
});

app.on('window-all-closed', () => {});
