const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { execSync } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 通过 IP 获取 MAC 地址
function getMacByIp(ip) {
  try {
    // 去掉 IPv6 前缀
    const cleanIp = ip.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === 'localhost') return '本机';
    
    const output = execSync('arp -a', { encoding: 'utf8', timeout: 3000 });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes(cleanIp)) {
        // 匹配 MAC 地址格式 (xx-xx-xx-xx-xx-xx 或 xx:xx:xx:xx:xx:xx)
        const match = line.match(/([0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i);
        if (match) return match[0].toUpperCase();
      }
    }
  } catch (err) {
    // 获取失败静默处理
  }
  return '-';
}

// SQLite数据库配置
let db;

// 初始化SQLite数据库
async function initDatabase() {
  try {
    db = await open({
      filename: './chat.db',
      driver: sqlite3.Database
    });

    // 创建消息表（支持 text 和 image 类型）
    await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'text',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建屏蔽词表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS banned_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL UNIQUE
      )
    `);

    // 创建 IP 黑名单表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS banned_ips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL UNIQUE
      )
    `);

    // 创建 MAC 黑名单表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS banned_macs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mac TEXT NOT NULL UNIQUE
      )
    `);

    // 加载屏蔽词
    const wordRows = await db.all('SELECT word FROM banned_words');
    admin.bannedWords = wordRows.map(r => r.word);

    // 加载 IP 黑名单
    const ipRows = await db.all('SELECT ip FROM banned_ips');
    admin.bannedIps = ipRows.map(r => r.ip);

    // 加载 MAC 黑名单
    const macRows = await db.all('SELECT mac FROM banned_macs');
    admin.bannedMacs = macRows.map(r => r.mac);

    // 检查并添加 type 字段（兼容旧数据库）
    try {
      await db.exec('ALTER TABLE messages ADD COLUMN type TEXT DEFAULT \'text\'');
    } catch (e) {
      // 字段已存在，忽略错误
    }

    await db.exec('CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp DESC)');
    
    const countResult = await db.get('SELECT COUNT(*) as count FROM messages');
    console.log(`📊 数据库就绪 (${countResult.count} 条历史消息)`);
  } catch (err) {
    console.error('❌ 数据库初始化失败:', err);
    process.exit(1);
  }
}

// 保存消息到数据库
async function saveMessage(message) {
  const startTime = Date.now();
  try {
    const msgType = message.type || 'text';
    const contentPreview = msgType === 'image' ? '[图片]' : message.content.substring(0, 30);
    console.log(`💾 正在保存消息: [${message.username}] ${contentPreview}${message.content.length > 30 ? '...' : ''}`);
    
    await db.run(
      'INSERT INTO messages (username, content, type) VALUES (?, ?, ?)',
      [message.username, message.content, msgType]
    );
    
    const duration = Date.now() - startTime;
    console.log(`✅ 消息保存成功 (耗时: ${duration}ms)`);
  } catch (err) {
    console.error(`❌ 保存消息失败:`, err);
  }
}

// 获取最近的消息
async function getRecentMessages(limit = 50) {
  const startTime = Date.now();
  try {
    const messages = await db.all(
      'SELECT username, content, type, timestamp FROM messages ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    
    const duration = Date.now() - startTime;
    console.log(`✅ 成功获取 ${messages.length} 条历史消息 (耗时: ${duration}ms)`);
    return messages;
  } catch (err) {
    console.error('❌ 获取历史消息失败:', err);
    return [];
  }
}

// 查询用户消息记录
async function queryUserMessages(username, startTime, endTime, limit = 100) {
  try {
    let query = 'SELECT username, content, timestamp FROM messages WHERE 1=1';
    const params = [];
    
    if (username) {
      query += ' AND username = ?';
      params.push(username);
    }
    
    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }
    
    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    return await db.all(query, params);
  } catch (err) {
    console.error('❌ 查询用户消息失败:', err);
    return [];
  }
}

// 清空所有聊天记录
async function clearAllMessages() {
  try {
    await db.run('DELETE FROM messages');
    await db.run('VACUUM'); // 清理数据库空间
    return { success: true, message: '所有聊天记录已清空' };
  } catch (err) {
    console.error('❌ 清空聊天记录失败:', err);
    return { success: false, error: err.message };
  }
}

// 获取消息总数
async function getTotalMessageCount() {
  try {
    const result = await db.get('SELECT COUNT(*) as count FROM messages');
    return result.count;
  } catch (err) {
    console.error('❌ 获取消息总数失败:', err);
    return 0;
  }
}

// 静态文件服务
app.use(express.static('.'));

// 初始化数据库
initDatabase().then(() => {}).catch(err => {
  console.error('❌ 数据库初始化失败:', err);
});

// 连接统计
let connectionCount = 0;
const activeConnections = new Set();
const serverStartTime = Date.now();

// ==================== 游戏管理模块 ====================
const gameManager = {
  games: new Map(),       // gameId → game info
  playerGames: new Map(), // clientId → gameId
  nextGameId: 1,

  // 创建游戏
  createGame(type, creatorId, creatorName) {
    const gameId = 'game_' + this.nextGameId++;
    const game = {
      id: gameId,
      type,
      status: 'waiting', // waiting, playing, finished
      players: [{ id: creatorId, name: creatorName, color: 'black' }],
      spectators: new Map(),
      board: null,
      currentTurn: null,
      winner: null,
      createdAt: Date.now()
    };

    if (type === 'gomoku') {
      game.board = Array(15).fill(null).map(() => Array(15).fill(null));
      game.currentTurn = 'black';
    }

    this.games.set(gameId, game);
    this.playerGames.set(creatorId, gameId);
    return game;
  },

  // 加入游戏
  joinGame(gameId, playerId, playerName) {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: '游戏不存在' };
    if (game.status !== 'waiting') return { success: false, error: '游戏已开始' };
    if (game.players.length >= 2) return { success: false, error: '游戏已满' };
    if (game.players[0].id === playerId) return { success: false, error: '不能跟自己下' };

    game.players.push({ id: playerId, name: playerName, color: 'white' });
    game.status = 'playing';
    this.playerGames.set(playerId, gameId);
    return { success: true, game };
  },

  // 观战
  spectateGame(gameId, playerId, playerName) {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: '游戏不存在' };
    if (game.status !== 'playing') return { success: false, error: '游戏尚未开始' };
    if (game.players.find(p => p.id === playerId)) return { success: false, error: '你是玩家' };
    game.spectators.set(playerId, playerName);
    this.playerGames.set(playerId, gameId);
    return { success: true, game };
  },

  // 下棋（五子棋）
  makeMove(gameId, playerId, row, col) {
    const game = this.games.get(gameId);
    if (!game || game.type !== 'gomoku') return { success: false, error: '游戏无效' };
    if (game.status !== 'playing') return { success: false, error: '游戏未开始' };

    const player = game.players.find(p => p.id === playerId);
    if (!player) return { success: false, error: '你不是玩家' };
    if (player.color !== game.currentTurn) return { success: false, error: '还没轮到你' };
    if (row < 0 || row >= 15 || col < 0 || col >= 15) return { success: false, error: '位置无效' };
    if (game.board[row][col] !== null) return { success: false, error: '此位置已有棋子' };

    game.board[row][col] = player.color;
    game.currentTurn = game.currentTurn === 'black' ? 'white' : 'black';

    // 检查胜负
    const winner = this.checkGomokuWinner(game.board, row, col, player.color);
    if (winner) {
      game.status = 'finished';
      game.winner = playerId;
      // 通知房间内所有人游戏结束
      this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName: player.name });
      // 3秒后清理已结束的游戏
      const finishedGameId = game.id;
      setTimeout(() => {
        this.games.delete(finishedGameId);
        for (const [pid, gid] of this.playerGames) {
          if (gid === finishedGameId) this.playerGames.delete(pid);
        }
        this.broadcastGameListToAll();
      }, 3000);
      this.broadcastGameListToAll();
    }

    return { success: true, game, move: { row, col, color: player.color }, winnerName: winner ? player.name : null };
  },

  // 五子棋胜负检测
  checkGomokuWinner(board, row, col, color) {
    const directions = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of directions) {
      let count = 1;
      for (let i = 1; i < 5; i++) {
        const r = row + dr*i, c = col + dc*i;
        if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === color) count++;
        else break;
      }
      for (let i = 1; i < 5; i++) {
        const r = row - dr*i, c = col - dc*i;
        if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === color) count++;
        else break;
      }
      if (count >= 5) return color;
    }
    return null;
  },

  // 离开游戏
  leaveGame(playerId) {
    const gameId = this.playerGames.get(playerId);
    if (!gameId) return;
    const game = this.games.get(gameId);
    if (!game) return;

    this.playerGames.delete(playerId);

    // 如果是玩家，通知对手
    const playerIdx = game.players.findIndex(p => p.id === playerId);
    if (playerIdx !== -1) {
      game.players.splice(playerIdx, 1);
      if (game.status === 'playing') {
        game.status = 'finished';
        game.winner = game.players[0]?.id || null;
      }
      // 通知房间内所有人
      this.broadcastToGame(gameId, { type: 'game_left', gameId, playerId });
      // 如果房间空了，删除
      if (game.players.length === 0 && game.spectators.size === 0) {
        this.games.delete(gameId);
      }
    } else {
      game.spectators.delete(playerId);
    }
  },

  // 游戏内聊天
  gameChat(gameId, playerName, content) {
    this.broadcastToGame(gameId, {
      type: 'game_chat',
      gameId,
      username: playerName,
      content,
      time: new Date().toLocaleTimeString()
    });
  },

  // 向房间内所有人发消息
  broadcastToGame(gameId, message) {
    const game = this.games.get(gameId);
    if (!game) return;
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        const info = admin.onlineUsers.get(client.id);
        if (!info) return;
        // 是玩家或观战者
        if (game.players.find(p => p.id === client.id) || game.spectators.has(client.id)) {
          client.send(data);
        }
      }
    });
  },

  // 获取所有游戏列表
  getGameList() {
    const list = [];
    for (const [id, game] of this.games) {
      if (game.status === 'finished') continue;
      list.push({
        id,
        type: game.type,
        status: game.status,
        players: game.players.map(p => p.name),
        spectatorCount: game.spectators.size
      });
    }
    return list;
  },

  // 获取在线用户列表（供选择对手）
  getOnlinePlayerList(excludeId) {
    const list = [];
    for (const [id, info] of admin.onlineUsers.entries()) {
      if (info.username && id !== excludeId) {
        list.push({ id, username: info.username });
      }
    }
    return list;
  },

  // 向所有连接的客户端广播游戏列表
  broadcastGameListToAll() {
    const data = JSON.stringify({ type: 'game_list', games: this.getGameList() });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  },

  // 向所有连接的客户端广播在线玩家列表
  broadcastPlayerListToAll() {
    const data = JSON.stringify({ type: 'game_players', players: this.getOnlinePlayerList() });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
};

// ==================== 新增：管理员功能模块 ====================
const admin = {
  onlineUsers: new Map(),
  bannedWords: [],
  bannedIps: [],      // IP 黑名单
  bannedMacs: [],     // MAC 黑名单

  // 添加屏蔽词
  async addBannedWord(word) {
    if (!word) return { success: false, message: '词不能为空' };
    if (this.bannedWords.includes(word)) return { success: false, message: '词已存在' };
    try {
      await db.run('INSERT INTO banned_words (word) VALUES (?)', [word]);
      this.bannedWords.push(word);
      return { success: true, message: `已添加屏蔽词: ${word}` };
    } catch (err) {
      return { success: false, message: '添加失败' };
    }
  },

  // 删除屏蔽词
  async removeBannedWord(word) {
    const index = this.bannedWords.indexOf(word);
    if (index === -1) return { success: false, message: '未找到该屏蔽词' };
    try {
      await db.run('DELETE FROM banned_words WHERE word = ?', [word]);
      this.bannedWords.splice(index, 1);
      return { success: true, message: `已移除屏蔽词: ${word}` };
    } catch (err) {
      return { success: false, message: '删除失败' };
    }
  },

  // 查看屏蔽词
  getBannedWords() {
    return this.bannedWords;
  },

  // 过滤屏蔽词
  filterText(text) {
    let filtered = text;
    for (const word of this.bannedWords) {
      const regex = new RegExp(word, 'gi');
      filtered = filtered.replace(regex, '*'.repeat(word.length));
    }
    return filtered;
  },

  // 添加 IP 到黑名单
  async banIp(ip) {
    if (this.bannedIps.includes(ip)) return { success: false, message: 'IP 已在黑名单中' };
    try {
      await db.run('INSERT INTO banned_ips (ip) VALUES (?)', [ip]);
      this.bannedIps.push(ip);
      return { success: true, message: `已封禁 IP: ${ip}` };
    } catch (err) {
      return { success: false, message: '操作失败' };
    }
  },

  // 移除 IP 黑名单
  async unbanIp(ip) {
    const index = this.bannedIps.indexOf(ip);
    if (index === -1) return { success: false, message: '未找到该 IP' };
    try {
      await db.run('DELETE FROM banned_ips WHERE ip = ?', [ip]);
      this.bannedIps.splice(index, 1);
      return { success: true, message: `已解封 IP: ${ip}` };
    } catch (err) {
      return { success: false, message: '操作失败' };
    }
  },

  // 添加 MAC 到黑名单
  async banMac(mac) {
    if (!mac || !/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i.test(mac)) {
      return { success: false, message: '无效的MAC地址格式 (例: D4-35-38-64-1C-2C)' };
    }
    const normalized = mac.toUpperCase().replace(/:/g, '-');
    if (this.bannedMacs.includes(normalized)) return { success: false, message: 'MAC 已在黑名单中' };
    try {
      await db.run('INSERT INTO banned_macs (mac) VALUES (?)', [normalized]);
      this.bannedMacs.push(normalized);
      return { success: true, message: `已封禁 MAC: ${normalized}` };
    } catch (err) {
      return { success: false, message: '操作失败' };
    }
  },

  // 移除 MAC 黑名单
  async unbanMac(mac) {
    const index = this.bannedMacs.indexOf(mac);
    if (index === -1) return { success: false, message: '未找到该 MAC' };
    try {
      await db.run('DELETE FROM banned_macs WHERE mac = ?', [mac]);
      this.bannedMacs.splice(index, 1);
      return { success: true, message: `已解封 MAC: ${mac}` };
    } catch (err) {
      return { success: false, message: '操作失败' };
    }
  },

  // 检查是否被封禁
  isBanned(ip, mac) {
    return this.bannedIps.includes(ip) || (mac && this.bannedMacs.includes(mac));
  },

  // 获取在线用户列表
  getOnlineUsers() {
    return Array.from(this.onlineUsers.entries()).map(([id, info]) => ({
      id,
      ...info
    }));
  },

  // 通过ID禁言/解禁用户
  muteUser(userId, mute = true) {
    if (this.onlineUsers.has(userId)) {
      this.onlineUsers.get(userId).muted = mute;
      return { success: true, userId, muted: mute };
    }
    return { success: false, error: '用户未找到' };
  },

  // 通过昵称禁言/解禁用户
  muteUserByUsername(username, mute = true) {
    let found = false;
    let userId = null;
    
    for (const [id, info] of this.onlineUsers.entries()) {
      if (info.username === username) {
        info.muted = mute;
        found = true;
        userId = id;
        break;
      }
    }
    
    return found ? { success: true, userId, username, muted: mute } : { success: false, error: '用户未找到' };
  },

  // 通过ID踢出用户（仅断开连接，不封禁）
  async kickUser(userId) {
    let targetClient = null;
    let userInfo = null;
    wss.clients.forEach(client => {
      if (client.id === userId && client.readyState === WebSocket.OPEN) {
        targetClient = client;
      }
    });
    userInfo = this.onlineUsers.get(userId);
    if (targetClient) {
      targetClient.close(1000, '管理员强制断开连接');
      this.onlineUsers.delete(userId);
      return { success: true, userId };
    }
    return { success: false, error: '用户未找到或连接已关闭' };
  },

  // 通过昵称踢出用户（仅断开连接，不封禁）
  async kickUserByUsername(username) {
    let targetClient = null;
    let userId = null;
    let userInfo = null;
    
    for (const [id, info] of this.onlineUsers.entries()) {
      if (info.username === username) {
        userInfo = info;
        wss.clients.forEach(client => {
          if (client.id === id && client.readyState === WebSocket.OPEN) {
            targetClient = client;
            userId = id;
          }
        });
        break;
      }
    }
    
    if (targetClient) {
      targetClient.close(1000, '管理员强制断开连接');
      this.onlineUsers.delete(userId);
      return { success: true, userId, username };
    }
    return { success: false, error: '用户未找到或连接已关闭' };
  },

  // 广播系统消息
  broadcastSystemMessage(content) {
    const sysMsg = {
      username: '【系统管理员】',
      content: content,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    broadcast(sysMsg);
    saveMessage(sysMsg);
    return { success: true, message: sysMsg };
  },

  // 获取服务器状态
  getServerStatus() {
    const now = Date.now();
    const uptime = now - serverStartTime;
    const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const uptimeSeconds = Math.floor((uptime % (1000 * 60)) / 1000);
    
    const memoryUsage = process.memoryUsage();
    const memoryMB = {
      rss: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
      external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100
    };
    
    return {
      uptime: `${uptimeHours}小时 ${uptimeMinutes}分钟 ${uptimeSeconds}秒`,
      memoryUsage: memoryMB,
      totalConnections: connectionCount,
      onlineUsers: wss.clients.size,
      activeConnections: activeConnections.size,
      serverStartTime: new Date(serverStartTime).toLocaleString()
    };
  }
};

// WebSocket连接处理
wss.on('connection', async (ws, req) => {
  connectionCount++;
  const clientId = connectionCount;
  const clientIp = req.socket.remoteAddress;
  const macAddress = getMacByIp(clientIp);
  
  // 检查黑名单
  if (admin.isBanned(clientIp, macAddress)) {
    ws.close(4001, '您已被封禁，无法访问');
    console.log(`🚫 被封禁用户尝试连接: ${clientIp} (${macAddress})`);
    return;
  }
  
  ws.id = clientId;
  activeConnections.add(ws);

  admin.onlineUsers.set(clientId, {
    ip: clientIp,
    mac: macAddress,
    username: null,
    clientId: null,
    connectTime: new Date().toLocaleString(),
    muted: false,
    registered: false
  });

  try {
    const history = await getRecentMessages();
    ws.send(JSON.stringify({
      type: 'history',
      messages: history.reverse()
    }));
  } catch (err) {
    console.error(`历史消息加载失败 #${clientId}:`, err);
  }

  ws.on('message', async (message) => {
    try {
      const rawMessage = typeof message === 'string' ? message : message.toString('utf8');
      const parsedMessage = JSON.parse(rawMessage);
      
      const userInfo = admin.onlineUsers.get(clientId);
      
      // 处理注册消息（连接时发送用户名）
      if (parsedMessage.type === 'register') {
        console.log(`📩 收到注册消息 #${clientId}:`, JSON.stringify(parsedMessage));
        if (userInfo && parsedMessage.username && parsedMessage.username.trim()) {
          userInfo.username = parsedMessage.username.trim();
          userInfo.clientId = parsedMessage.clientId || null;
          userInfo.registered = true;
          console.log(`👤 用户 #${clientId} 注册成功: ${userInfo.username} [${parsedMessage.clientId || ''}] IP:${clientIp} MAC:${macAddress}`);
          // 广播在线用户列表更新
          gameManager.broadcastPlayerListToAll();
        } else {
          console.log(`❌ 用户 #${clientId} 注册失败: 用户名为空`);
        }
        return;
      }

      // 未注册用户禁止发消息，踢出（不封禁）
      if (!userInfo.registered) {
        console.log(`🚫 用户 #${clientId} (${clientIp} / ${macAddress}) 未登录就发消息，断开`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'force_logout', reason: '请通过登录页面登录' }));
        }
        ws.close(4002, '未登录');
        return;
      }
      
      if (userInfo && userInfo.muted) {
        ws.send(JSON.stringify({
          type: 'error',
          content: '您已被管理员禁言，无法发送消息'
        }));
        return;
      }
      
      if (!userInfo.username && parsedMessage.username) {
        userInfo.username = parsedMessage.username;
      }

      // ===== 游戏消息处理 =====
      if (parsedMessage.type === 'game_create') {
        const game = gameManager.createGame(parsedMessage.gameType, clientId, userInfo.username);
        gameManager.broadcastGameListToAll();
        ws.send(JSON.stringify({ type: 'game_created', game }));
        return;
      }

      if (parsedMessage.type === 'game_join') {
        const result = gameManager.joinGame(parsedMessage.gameId, clientId, userInfo.username);
        if (result.success) {
          // 查找赢家用户名
          let winnerName = null;
          if (result.game.winner) {
            const w = result.game.players.find(p => p.id === result.game.winner);
            winnerName = w ? w.name : null;
          }
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'game_start',
            game: { id: result.game.id, type: result.game.type, players: result.game.players, board: result.game.board, currentTurn: result.game.currentTurn, winner: winnerName }
          });
          gameManager.broadcastGameListToAll();
        } else {
          ws.send(JSON.stringify({ type: 'game_error', error: result.error }));
        }
        return;
      }

      if (parsedMessage.type === 'game_spectate') {
        const result = gameManager.spectateGame(parsedMessage.gameId, clientId, userInfo.username);
        if (result.success) {
          // 查找赢家用户名
          let winnerName = null;
          if (result.game.winner) {
            const w = result.game.players.find(p => p.id === result.game.winner);
            winnerName = w ? w.name : null;
          }
          ws.send(JSON.stringify({
            type: 'game_start',
            game: { id: result.game.id, type: result.game.type, players: result.game.players, board: result.game.board, currentTurn: result.game.currentTurn, winner: winnerName }
          }));
          // 通知玩家有新观战者
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'game_spectator_count',
            gameId: parsedMessage.gameId,
            count: result.game.spectators.size
          });
        } else {
          ws.send(JSON.stringify({ type: 'game_error', error: result.error }));
        }
        return;
      }

      if (parsedMessage.type === 'game_move') {
        const result = gameManager.makeMove(parsedMessage.gameId, clientId, parsedMessage.row, parsedMessage.col);
        if (result.success) {
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'game_moved',
            gameId: parsedMessage.gameId,
            move: result.move,
            currentTurn: result.game.currentTurn,
            winner: result.winnerName || null,
            status: result.game.status
          });
        } else {
          ws.send(JSON.stringify({ type: 'game_error', error: result.error }));
        }
        return;
      }

      if (parsedMessage.type === 'game_leave') {
        gameManager.leaveGame(clientId);
        ws.send(JSON.stringify({ type: 'game_left' }));
        gameManager.broadcastGameListToAll();
        return;
      }

      if (parsedMessage.type === 'game_chat') {
        gameManager.gameChat(parsedMessage.gameId, userInfo.username, parsedMessage.content);
        return;
      }

      if (parsedMessage.type === 'game_list') {
        ws.send(JSON.stringify({ type: 'game_list', games: gameManager.getGameList() }));
        return;
      }

      if (parsedMessage.type === 'game_players') {
        ws.send(JSON.stringify({ type: 'game_players', players: gameManager.getOnlinePlayerList(clientId) }));
        return;
      }

      // ===== 邀请对战 =====
      if (parsedMessage.type === 'game_invite') {
        const targetName = parsedMessage.targetUsername;
        // 找到被邀请人的 WebSocket
        let targetWs = null;
        let targetId = null;
        for (const [id, info] of admin.onlineUsers.entries()) {
          if (info.username === targetName) {
            targetId = id;
            wss.clients.forEach(client => {
              if (client.id === id && client.readyState === WebSocket.OPEN) {
                targetWs = client;
              }
            });
            break;
          }
        }
        if (!targetWs) {
          ws.send(JSON.stringify({ type: 'game_error', error: '用户不在线' }));
          return;
        }
        // 创建游戏
        const game = gameManager.createGame(parsedMessage.gameType, clientId, userInfo.username);
        // 保存邀请信息
        game.inviteeId = targetId;
        game.inviteeName = targetName;
        // 发送邀请给被邀请人
        targetWs.send(JSON.stringify({
          type: 'game_invite_received',
          gameId: game.id,
          gameType: game.type,
          fromUsername: userInfo.username
        }));
        // 通知邀请人已发送
        ws.send(JSON.stringify({
          type: 'game_invite_sent',
          gameId: game.id,
          targetUsername: targetName
        }));
        gameManager.broadcastGameListToAll();
        return;
      }

      // 被邀请人接受邀请
      if (parsedMessage.type === 'game_invite_accept') {
        const game = gameManager.games.get(parsedMessage.gameId);
        if (!game) {
          ws.send(JSON.stringify({ type: 'game_error', error: '游戏不存在或已取消' }));
          return;
        }
        // 加入游戏
        const result = gameManager.joinGame(parsedMessage.gameId, clientId, userInfo.username);
        if (result.success) {
          // 通知所有人游戏开始
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'game_start',
            game: { id: result.game.id, type: result.game.type, players: result.game.players, board: result.game.board, currentTurn: result.game.currentTurn }
          });
          gameManager.broadcastGameListToAll();
        } else {
          ws.send(JSON.stringify({ type: 'game_error', error: result.error }));
        }
        return;
      }

      // 被邀请人拒绝邀请
      if (parsedMessage.type === 'game_invite_decline') {
        const game = gameManager.games.get(parsedMessage.gameId);
        if (game) {
          // 通知邀请人被拒绝
          const creatorWs = wss.clients.values().next().value; // fallback
          for (const [id, info] of admin.onlineUsers.entries()) {
            if (info.username === game.players[0]?.name) {
              wss.clients.forEach(client => {
                if (client.id === id && client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({
                    type: 'game_invite_declined',
                    gameId: game.id,
                    targetUsername: userInfo.username
                  }));
                }
              });
              break;
            }
          }
          // 删除游戏
          gameManager.games.delete(parsedMessage.gameId);
          gameManager.broadcastGameListToAll();
        }
        return;
      }
      
      // 过滤屏蔽词
      if (parsedMessage.content && parsedMessage.type !== 'image') {
        parsedMessage.content = admin.filterText(parsedMessage.content);
      }
      
      await saveMessage(parsedMessage);
      broadcast(parsedMessage);
    } catch (err) {
      console.error(`消息处理失败 #${clientId}:`, err);
    }
  });

  ws.on('close', () => {
    gameManager.leaveGame(clientId);
    activeConnections.delete(ws);
    admin.onlineUsers.delete(clientId);
    // 广播在线用户列表和游戏列表更新
    gameManager.broadcastPlayerListToAll();
    gameManager.broadcastGameListToAll();
  });

  ws.on('error', (error) => {
    console.error(`   ⚠️ 用户 #${clientId} 连接错误:`, error);
  });
});

function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// 服务器状态监控
setInterval(() => {
  const now = new Date().toLocaleTimeString();
  const users = admin.getOnlineUsers();
  console.log(`📊 [${now}] 在线: ${wss.clients.size} | 总连接: ${connectionCount} | 活跃: ${activeConnections.size}`);
  users.forEach(user => {
    console.log(`   #${user.id} ${user.username || '匿名'} (${user.ip}) ${user.muted ? '[禁言]' : ''}`);
  });
}, 60000);

// 启动服务器
const PORT = 8082;
const HOST = '0.0.0.0';

function startServer(silent = false) {
  server.listen(PORT, HOST, () => {
    if (!silent) {
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();
      const ipAddresses = [];
      
      Object.keys(networkInterfaces).forEach((iface) => {
        networkInterfaces[iface].forEach((details) => {
          if (details.family === 'IPv4' && !details.internal) {
            ipAddresses.push(details.address);
          }
        });
      });

      console.log('\n🚀 ========== 聊天服务器启动成功 ==========');
      console.log(`📅 启动时间: ${new Date().toLocaleString()}`);
      console.log(`📊 服务器信息:`);
      console.log(`   🔌 端口: ${PORT}`);
      console.log(`   🖥️  主机: ${HOST}`);
      console.log(`\n🌐 访问地址:`);
      console.log(`   💻 本机访问: http://localhost:${PORT}`);
      console.log(`   🌍 局域网访问:`);
      ipAddresses.forEach((ip, index) => {
        console.log(`      ${index + 1}. http://${ip}:${PORT}`);
      });
      console.log('\n📝 日志说明:');
      console.log('   🔗 新用户连接');
      console.log('   📨 收到消息');
      console.log('   💾 保存消息');
      console.log('   📥 获取历史消息');
      console.log('   🔌 用户断开连接');
      console.log('   📊 服务器状态监控');
      console.log('\n🔧 管理员功能已启用');
      console.log('   运行 node adminConsole.js 启动管理控制台');
      console.log('========================================\n');
    } else {
      console.log(`✅ 服务器已启动 → http://localhost:${PORT}`);
    }
  });
}

if (require.main === module) {
  startServer();
}

// 导出管理员模块供adminConsole.js使用
module.exports = {
  admin,
  wss,
  getTotalMessageCount,
  queryUserMessages,
  clearAllMessages,
  db,
  startServer
};

// 优雅关闭处理
process.on('SIGINT', () => {
  console.log('\n\n🛑 收到关闭信号，正在优雅关闭服务器...');
  console.log(`📊 最终统计:`);
  console.log(`   🔗 总连接数: ${connectionCount}`);
  console.log(`   👥 当前在线用户: ${wss.clients.size}`);
  
  wss.close(() => {
    console.log('✅ WebSocket服务器已关闭');
    server.close(() => {
      console.log('✅ HTTP服务器已关闭');
      if (db) {
        db.close();
        console.log('✅ 数据库连接已关闭');
      }
      console.log('👋 服务器已完全关闭');
      process.exit(0);
    });
  });
});
