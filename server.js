const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const initSqlJs = require('sql.js');
const { open } = require('sqlite');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const os = require('os');
const dgram = require('dgram');

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
    const SQL = await initSqlJs();
    db = await open({
      filename: './chat.db',
      driver: SQL.Database
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

    // 创建文件共享表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS file_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        uploader_id INTEGER NOT NULL,
        uploader_name TEXT NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        visible INTEGER DEFAULT 1,
        downloadable INTEGER DEFAULT 1,
        allowed_users TEXT,
        deleted INTEGER DEFAULT 0
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
    return messages.map(m => ({ ...m, time: new Date(m.timestamp).toLocaleTimeString() }));
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

// 获取本机局域网 IP
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// 加载配置文件
let config = {};
const configPath = path.join(__dirname, 'config.json');
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('✅ 已加载配置文件 config.json');
  }
} catch (e) {
  console.error('⚠️  config.json 解析失败，使用默认配置:', e.message);
}

// 保存配置到 config.json
function saveConfig() {
  try {
    const merged = { ...config, maxUploadSize: maxFileSize, imageMaxSize: serverConfig.imageMaxSize, allowedExtensions: serverConfig.allowedExtensions, port: PORT };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) { /* 静默 */ }
}
app.use(express.static('.'));

// 文件上传配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

let maxFileSize = typeof config.maxUploadSize === 'number' ? config.maxUploadSize : 0; // 0 = 无限制（字节）
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// 服务器配置（可动态修改）
const serverConfig = {
  imageMaxSize: config.imageMaxSize || 5 * 1024 * 1024,  // 图片 base64 最大字节数（默认 5MB）
  allowedExtensions: config.allowedExtensions || '',      // 文件上传允许的扩展名，逗号分隔，空=全部允许
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname))
});

let upload = multer({ storage, limits: { fileSize: maxFileSize || undefined } });

function recreateUpload() {
  upload = multer({ storage, limits: { fileSize: maxFileSize || undefined } });
}

// 初始化数据库
initDatabase().then(() => {}).catch(err => {
  console.error('❌ 数据库初始化失败:', err);
});

// 连接统计
let connectionCount = 0;
const activeConnections = new Set();
const serverStartTime = Date.now();

// 当前所有共享屏幕的用户（允许多人同时共享）
const currentSharers = new Map(); // clientId → { username }

// ==================== 游戏管理模块 ====================
const gameManager = {
  games: new Map(),       // gameId → game info
  playerGames: new Map(), // clientId → gameId
  nextGameId: 1,

  // 创建游戏
  createGame(type, creatorId, creatorName) {
    const gameId = 'game_' + this.nextGameId++;
    const colorMap = { gomoku: 'black', tictactoe: 'x', connect4: 'red', othello: 'black' };
    const game = {
      id: gameId,
      type,
      status: 'waiting', // waiting, playing, finished
      players: [{ id: creatorId, name: creatorName, color: colorMap[type] || 'black' }],
      spectators: new Map(),
      board: null,
      currentTurn: null,
      winner: null,
      createdAt: Date.now()
    };

    if (type === 'gomoku') {
      game.board = Array(15).fill(null).map(() => Array(15).fill(null));
      game.currentTurn = 'black';
    } else if (type === 'tictactoe') {
      game.board = Array(3).fill(null).map(() => Array(3).fill(null));
      game.currentTurn = 'x';
    } else if (type === 'rps') {
      game.choices = {};
      game.rpsResult = null;
    } else if (type === 'connect4') {
      game.board = Array(6).fill(null).map(() => Array(7).fill(null));
      game.currentTurn = 'red';
    } else if (type === 'othello') {
      game.board = Array(8).fill(null).map(() => Array(8).fill(null));
      game.board[3][3] = 'white'; game.board[3][4] = 'black';
      game.board[4][3] = 'black'; game.board[4][4] = 'white';
      game.currentTurn = 'black';
    } else if (type === 'guess') {
      game.target = Math.floor(Math.random() * 100) + 1;
      game.choices = {};
      game.scores = { p1: 0, p2: 0 };
      game.round = 1;
    } else if (type === 'battleship') {
      game.boards = { p1: Array(6).fill(null).map(() => Array(6).fill(null)), p2: Array(6).fill(null).map(() => Array(6).fill(null)) };
      game.ships = { p1: [], p2: [] };
      game.phase = 'placing'; // placing → playing → finished
      game.attacks = { p1: Array(6).fill(null).map(() => Array(6).fill(null)), p2: Array(6).fill(null).map(() => Array(6).fill(null)) };
      game.placed = {};
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

    const colorMap = { gomoku: 'white', tictactoe: 'o', othello: 'white', connect4: 'yellow' };
    game.players.push({ id: playerId, name: playerName, color: colorMap[game.type] || 'white' });
    game.status = game.type === 'battleship' ? 'placing' : 'playing';
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

  // 下棋
  makeMove(gameId, playerId, row, col) {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: '游戏无效' };
    if (game.status !== 'playing') return { success: false, error: '游戏未开始' };

    const player = game.players.find(p => p.id === playerId);
    if (!player) return { success: false, error: '你不是玩家' };
    if (player.color !== game.currentTurn) return { success: false, error: '还没轮到你' };

    let size, colorA, colorB, winner, isDraw;

    if (game.type === 'connect4') {
      size = 6; colorA = 'red'; colorB = 'yellow';
      const col = row;
      if (col < 0 || col >= 7) return { success: false, error: '列无效' };
      let dropRow = -1;
      for (let r = 5; r >= 0; r--) { if (game.board[r][col] === null) { dropRow = r; break; } }
      if (dropRow === -1) return { success: false, error: '此列已满' };
      game.board[dropRow][col] = player.color;
      game.currentTurn = game.currentTurn === colorA ? colorB : colorA;
      winner = this.checkConnect4Winner(game.board, dropRow, col, player.color);
      if (winner) {
        game.status = 'finished';
        game.winner = playerId;
        this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName: player.name });
        const finishedGameId = game.id;
        setTimeout(() => {
          this.games.delete(finishedGameId);
          for (const [pid, gid] of this.playerGames) {
            if (gid === finishedGameId) this.playerGames.delete(pid);
          }
          this.broadcastGameListToAll();
        }, 3000);
        this.broadcastGameListToAll();
      } else {
        isDraw = game.board.every(r => r.every(c => c !== null));
        if (isDraw) {
          game.status = 'finished';
          this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName: '平局' });
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
      }
      return { success: true, game, move: { row: dropRow, col, color: player.color }, winnerName: winner ? player.name : (isDraw ? '平局' : null) };
    }

    if (game.type === 'othello') {
      size = 8; colorA = 'black'; colorB = 'white';
      if (row < 0 || row >= 8 || col < 0 || col >= 8) return { success: false, error: '位置无效' };
      if (game.board[row][col] !== null) return { success: false, error: '此位置已有棋子' };
      const flips = this.getOthelloFlips(game.board, row, col, player.color);
      if (flips.length === 0) return { success: false, error: '无效落子' };
      game.board[row][col] = player.color;
      flips.forEach(([r, c]) => { game.board[r][c] = player.color; });
      game.currentTurn = game.currentTurn === colorA ? colorB : colorA;
      // 如果对方无合法落子，继续轮到自己
      if (!this.hasOthelloMoves(game.board, game.currentTurn)) {
        game.currentTurn = game.currentTurn === colorA ? colorB : colorA;
        if (!this.hasOthelloMoves(game.board, game.currentTurn)) {
          game.status = 'finished';
          const p1count = game.board.flat().filter(c => c === 'black').length;
          const p2count = game.board.flat().filter(c => c === 'white').length;
          const winnerName = p1count > p2count ? game.players[0].name : (p2count > p1count ? game.players[1].name : '平局');
          this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName, board: game.board });
          setTimeout(() => { this.games.delete(gameId); this.broadcastGameListToAll(); }, 3000);
          this.broadcastGameListToAll();
          return { success: true, game, move: { row, col, color: player.color }, winnerName };
        }
      }
      winner = null; isDraw = false;
      return { success: true, game, move: { row, col, color: player.color, flips }, winnerName: null };
    }

    if (game.type === 'gomoku') { size = 15; colorA = 'black'; colorB = 'white'; }
    else if (game.type === 'tictactoe') { size = 3; colorA = 'x'; colorB = 'o'; }
    else return { success: false, error: '未知游戏类型' };

    if (row < 0 || row >= size || col < 0 || col >= size) return { success: false, error: '位置无效' };
    if (game.board[row][col] !== null) return { success: false, error: '此位置已有棋子' };

    game.board[row][col] = player.color;
    game.currentTurn = game.currentTurn === colorA ? colorB : colorA;

    // 检查胜负
    if (game.type === 'gomoku') {
      winner = this.checkGomokuWinner(game.board, row, col, player.color);
    } else if (game.type === 'tictactoe') {
      winner = this.checkTicTacToeWinner(game.board, player.color);
    }

    if (winner) {
      game.status = 'finished';
      game.winner = playerId;
      this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName: player.name });
      const finishedGameId = game.id;
      setTimeout(() => {
        this.games.delete(finishedGameId);
        for (const [pid, gid] of this.playerGames) {
          if (gid === finishedGameId) this.playerGames.delete(pid);
        }
        this.broadcastGameListToAll();
      }, 3000);
      this.broadcastGameListToAll();
    } else {
      // 平局检查（棋盘满了无人胜）
      const isDraw = game.board.every(r => r.every(c => c !== null));
      if (isDraw) {
        game.status = 'finished';
        this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName: '平局' });
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
    }

    return { success: true, game, move: { row, col, color: player.color }, winnerName: winner ? player.name : (isDraw ? '平局' : null) };
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

  // 井字棋胜负检测
  checkTicTacToeWinner(board, color) {
    const lines = [
      [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
      [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
      [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]]
    ];
    for (const line of lines) {
      if (line.every(([r, c]) => board[r][c] === color)) return color;
    }
    return null;
  },

  // 四子棋胜负检测
  checkConnect4Winner(board, row, col, color) {
    const directions = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of directions) {
      let count = 1;
      for (let i = 1; i < 4; i++) {
        const r = row + dr*i, c = col + dc*i;
        if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === color) count++;
        else break;
      }
      for (let i = 1; i < 4; i++) {
        const r = row - dr*i, c = col - dc*i;
        if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === color) count++;
        else break;
      }
      if (count >= 4) return color;
    }
    return null;
  },

  // 黑白棋辅助函数
  getOthelloFlips(board, row, col, color) {
    const opp = color === 'black' ? 'white' : 'black';
    const dirs = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
    const flips = [];
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      const candidates = [];
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === opp) {
        candidates.push([r, c]);
        r += dr; c += dc;
      }
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === color) {
        flips.push(...candidates);
      }
    }
    return flips;
  },
  hasOthelloMoves(board, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === null && this.getOthelloFlips(board, r, c, color).length > 0) return true;
      }
    }
    return false;
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
      const wasPlaying = game.status === 'playing';
      game.players.splice(playerIdx, 1);
      if (wasPlaying) {
        game.status = 'finished';
        game.winner = game.players[0]?.id || null;
        const winnerPlayer = game.winner ? game.players.find(p => p.id === game.winner) : null;
        this.broadcastToGame(gameId, { type: 'game_over', gameId, winnerName: winnerPlayer ? winnerPlayer.name : '平局' });
      } else {
        this.broadcastToGame(gameId, { type: 'game_left', gameId, playerId });
      }
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

// ==================== 文件共享 API ====================

function broadcastFileEvent(type, data) {
  const msg = JSON.stringify({ type, ...data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// 上传文件（含哈希去重）
function fixFilename(name) {
  try {
    const buf = Buffer.from(name, 'latin1');
    const decoded = buf.toString('utf8');
    if (/[\u4e00-\u9fff\u3000-\u303f]/.test(decoded) && /[\x80-\xff]/.test(name)) return decoded;
  } catch (e) {}
  return name;
}

app.post('/upload', (req, res) => {
  const mw = upload.single('file');
  mw(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const limitMB = maxFileSize > 0 ? (maxFileSize / 1024 / 1024).toFixed(0) : '无限制';
        return res.status(413).json({ error: `文件过大，当前限制 ${limitMB}MB` });
      }
      console.error('❌ Multer 上传错误:', err);
      return res.status(500).json({ error: '上传失败: ' + err.message });
    }

    try {
      if (!req.file) return res.status(400).json({ error: '未选择文件' });
      const { hash, clientId, username } = req.body;
      if (!hash) return res.status(400).json({ error: '缺少文件哈希' });

      const originalname = fixFilename(req.file.originalname);

      // 查重
      const existing = await db.get('SELECT id, filename, size FROM file_shares WHERE hash = ? AND deleted = 0', hash);
      if (existing) {
        fs.unlink(req.file.path, () => {});
        return res.json({ duplicate: true, id: existing.id, filename: existing.filename, size: existing.size });
      }

      // 检查扩展名白名单
      if (serverConfig.allowedExtensions) {
        const ext = path.extname(req.file.originalname).toLowerCase().replace(/^\./, '');
        const allowed = serverConfig.allowedExtensions.split(',');
        if (!allowed.includes(ext)) {
          fs.unlink(req.file.path, () => {});
          return res.status(415).json({ error: `不支持的文件格式，允许: ${serverConfig.allowedExtensions}` });
        }
      }

      const storedName = req.file.filename;
      await db.run(
        'INSERT INTO file_shares (filename, stored_name, mime_type, size, hash, uploader_id, uploader_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [originalname, storedName, req.file.mimetype, req.file.size, hash, parseInt(clientId) || 0, username || '未知']
      );
      const fileId = db.lastID || (await db.get('SELECT id FROM file_shares WHERE stored_name = ?', storedName)).id;

      broadcastFileEvent('file_added', { file: { id: fileId, filename: originalname, size: req.file.size, uploader: username, time: new Date().toLocaleString() } });
      res.json({ id: fileId, filename: originalname, size: req.file.size });
    } catch (err) {
      console.error('❌ 文件上传失败:', err);
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: '上传失败' });
    }
  });
});

// 下载文件
app.get('/download/:id', async (req, res) => {
  const file = await db.get('SELECT * FROM file_shares WHERE id = ? AND deleted = 0', parseInt(req.params.id));
  if (!file) return res.status(404).json({ error: '文件不存在' });
  if (!file.downloadable) return res.status(403).json({ error: '文件已被禁止下载' });

  const filePath = path.join(uploadDir, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已丢失' });

  const encodedFilename = encodeURIComponent(file.filename);
  res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader('Content-Type', file.mime_type);
  res.sendFile(filePath);
});

// 获取文件列表（按用户权限过滤）
app.get('/api/files', async (req, res) => {
  const userClientId = req.query.clientId;
  const files = await db.all('SELECT id, filename, mime_type, size, uploader_name, uploader_id, uploaded_at FROM file_shares WHERE deleted = 0 AND visible = 1 ORDER BY uploaded_at DESC');
  const filtered = files.filter(f => {
    if (!f.allowed_users) return true;
    try { return JSON.parse(f.allowed_users).includes(userClientId); } catch { return true; }
  });
  res.json(filtered);
});

// 上传者删除自己的文件
app.delete('/api/files/:id', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: '缺少用户名' });

    const file = await db.get('SELECT * FROM file_shares WHERE id = ? AND deleted = 0', parseInt(req.params.id));
    if (!file) return res.status(404).json({ error: '文件不存在' });

    if (file.uploader_name !== username) {
      return res.status(403).json({ error: '只能删除自己上传的文件' });
    }

    await db.run('UPDATE file_shares SET deleted = 1 WHERE id = ?', file.id);
    // 删除物理文件
    const filePath = path.join(uploadDir, file.stored_name);
    fs.unlink(filePath, () => {});
    broadcastFileEvent('file_deleted', { id: file.id });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ 文件删除失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

// 获取服务器配置（客户端用）
app.get('/api/config', (req, res) => {
  res.json(fileAdmin.getConfig());
});

// ==================== 文件管理（admin API）====================

const fileAdmin = {
  async listAll() {
    return await db.all('SELECT id, filename, size, hash, uploader_name, uploader_id, visible, downloadable, allowed_users, deleted, uploaded_at FROM file_shares WHERE deleted = 0 ORDER BY uploaded_at DESC');
  },
  async delete(id) {
    const file = await db.get('SELECT stored_name, filename FROM file_shares WHERE id = ? AND deleted = 0', id);
    if (!file) return { error: '文件不存在或已删除' };
    await db.run('UPDATE file_shares SET deleted = 1 WHERE id = ?', id);
    broadcastFileEvent('file_deleted', { id });
    return { success: true, filename: file.filename };
  },
  async toggleVisible(id) {
    const f = await db.get('SELECT visible FROM file_shares WHERE id = ?', id);
    if (!f) return { error: '文件不存在' };
    await db.run('UPDATE file_shares SET visible = ? WHERE id = ?', f.visible ? 0 : 1, id);
    broadcastFileEvent('file_updated', { id, visible: !f.visible });
    return { visible: !f.visible };
  },
  async toggleDownloadable(id) {
    const f = await db.get('SELECT downloadable FROM file_shares WHERE id = ?', id);
    if (!f) return { error: '文件不存在' };
    await db.run('UPDATE file_shares SET downloadable = ? WHERE id = ?', f.downloadable ? 0 : 1, id);
    broadcastFileEvent('file_updated', { id, downloadable: !f.downloadable });
    return { downloadable: !f.downloadable };
  },
  async setAllowedUsers(id, userIds) {
    // userIds: null (all) or JSON array of clientId strings
    await db.run('UPDATE file_shares SET allowed_users = ? WHERE id = ?', userIds ? JSON.stringify(userIds) : null, id);
    broadcastFileEvent('file_updated', { id, allowed_users: userIds });
  },
  getMaxFileSize() {
    return maxFileSize;
  },
  getMaxFileSizeMB() {
    return maxFileSize > 0 ? (maxFileSize / 1024 / 1024) : Infinity;
  },
  setMaxFileSize(bytes) {
    const size = parseInt(bytes);
    if (isNaN(size) || size < 0) return { error: '无效的大小' };
    maxFileSize = size;
    recreateUpload();
    saveConfig();
    return { success: true, maxFileSize: size, maxFileSizeMB: size > 0 ? (size / 1024 / 1024) : Infinity };
  },
  getConfig() {
    return {
      imageMaxSize: serverConfig.imageMaxSize,
      imageMaxSizeMB: (serverConfig.imageMaxSize / 1024 / 1024).toFixed(0),
      allowedExtensions: serverConfig.allowedExtensions,
      maxFileSize,
      maxFileSizeMB: maxFileSize > 0 ? (maxFileSize / 1024 / 1024).toFixed(0) : '∞',
    };
  },
  setImageMaxSize(bytes) {
    const size = parseInt(bytes);
    if (isNaN(size) || size < 0) return { error: '无效的大小' };
    serverConfig.imageMaxSize = size;
    saveConfig();
    return { success: true, imageMaxSize: size, imageMaxSizeMB: (size / 1024 / 1024).toFixed(0) };
  },
  setAllowedExtensions(exts) {
    // exts: "jpg,png,gif" 或 "" (全部允许)
    if (typeof exts !== 'string') return { error: '格式错误' };
    const cleaned = exts.trim().toLowerCase();
    if (cleaned === '') {
      serverConfig.allowedExtensions = '';
    } else {
      const parts = cleaned.split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean);
      serverConfig.allowedExtensions = [...new Set(parts)].join(',');
    }
    saveConfig();
    return { success: true, allowedExtensions: serverConfig.allowedExtensions || '(全部允许)' };
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
          // 如果有人在共享屏幕，把当前所有共享者列表发给新用户（附带自己的 clientId）
          if (currentSharers.size > 0) {
            const sharerList = Array.from(currentSharers.entries()).map(([id, info]) => ({ id, name: info.username }));
            ws.send(JSON.stringify({ type: 'sharer_list', sharers: sharerList, yourId: clientId }));
          }
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
          let winnerName = null;
          if (result.game.winner) {
            const w = result.game.players.find(p => p.id === result.game.winner);
            winnerName = w ? w.name : null;
          }
          const gameData = { id: result.game.id, type: result.game.type, players: result.game.players, board: result.game.board, currentTurn: result.game.currentTurn, winner: winnerName };
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'game_start',
            game: gameData
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
          let winnerName = null;
          if (result.game.winner) {
            const w = result.game.players.find(p => p.id === result.game.winner);
            winnerName = w ? w.name : null;
          }
          const gameData = { id: result.game.id, type: result.game.type, players: result.game.players, board: result.game.board, currentTurn: result.game.currentTurn, winner: winnerName };
          ws.send(JSON.stringify({ type: 'game_start', game: gameData }));
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
          const board = result.game.board;
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'game_moved',
            gameId: parsedMessage.gameId,
            move: result.move,
            currentTurn: result.game.currentTurn,
            winner: result.winnerName || null,
            status: result.game.status,
            board
          });
        } else {
          ws.send(JSON.stringify({ type: 'game_error', error: result.error }));
        }
        return;
      }

      if (parsedMessage.type === 'rps_choice') {
        const game = gameManager.games.get(parsedMessage.gameId);
        if (!game || game.type !== 'rps') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏无效' })); return; }
        if (game.status !== 'playing') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏未开始' })); return; }
        const player = game.players.find(p => p.id === clientId);
        if (!player) { ws.send(JSON.stringify({ type: 'game_error', error: '你不是玩家' })); return; }

        const choice = parsedMessage.choice;
        if (!['rock', 'paper', 'scissors'].includes(choice)) { ws.send(JSON.stringify({ type: 'game_error', error: '无效选择' })); return; }

        game.choices[clientId] = choice;

        // 如果双方都已选择，判定胜负
        if (game.choices[game.players[0].id] && game.choices[game.players[1].id]) {
          const c1 = game.choices[game.players[0].id];
          const c2 = game.choices[game.players[1].id];
          let winnerName = null;
          if (c1 === c2) {
            winnerName = '平局';
          } else if (
            (c1 === 'rock' && c2 === 'scissors') ||
            (c1 === 'scissors' && c2 === 'paper') ||
            (c1 === 'paper' && c2 === 'rock')
          ) {
            winnerName = game.players[0].name;
          } else {
            winnerName = game.players[1].name;
          }
          game.rpsResult = { p1choice: c1, p2choice: c2, winnerName };
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'rps_result',
            gameId: parsedMessage.gameId,
            choices: { [game.players[0].id]: c1, [game.players[1].id]: c2 },
            winnerName
          });
          // 重置选择，准备下一轮
          game.choices = {};
        } else {
          // 通知对方等待
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'rps_choice_made',
            gameId: parsedMessage.gameId,
            playerId: clientId
          });
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

      if (parsedMessage.type === 'guess_choice') {
        const game = gameManager.games.get(parsedMessage.gameId);
        if (!game || game.type !== 'guess') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏无效' })); return; }
        if (game.status !== 'playing') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏未开始' })); return; }
        const playerIdx = game.players.findIndex(p => p.id === clientId);
        if (playerIdx === -1) { ws.send(JSON.stringify({ type: 'game_error', error: '你不是玩家' })); return; }

        const num = parseInt(parsedMessage.number);
        if (isNaN(num) || num < 1 || num > 100) { ws.send(JSON.stringify({ type: 'game_error', error: '请输入1-100的整数' })); return; }

        const key = 'p' + (playerIdx + 1);
        game.choices[key] = num;

        if (game.choices.p1 && game.choices.p2) {
          const d1 = Math.abs(game.choices.p1 - game.target);
          const d2 = Math.abs(game.choices.p2 - game.target);
          let roundWinner = null;
          if (d1 < d2) { roundWinner = game.players[0].name; game.scores.p1++; }
          else if (d2 < d1) { roundWinner = game.players[1].name; game.scores.p2++; }
          else { roundWinner = '平局'; }

          const isOver = game.round >= 5;
          let finalWinner = null;
          if (isOver) {
            if (game.scores.p1 > game.scores.p2) finalWinner = game.players[0].name;
            else if (game.scores.p2 > game.scores.p1) finalWinner = game.players[1].name;
            else finalWinner = '平局';
            game.status = 'finished';
          }

          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'guess_result',
            gameId: parsedMessage.gameId,
            target: game.target,
            choices: { p1: game.choices.p1, p2: game.choices.p2 },
            roundWinner,
            scores: { p1: game.scores.p1, p2: game.scores.p2 },
            round: game.round,
            isOver,
            finalWinner
          });

          if (isOver) {
            setTimeout(() => { gameManager.games.delete(parsedMessage.gameId); gameManager.broadcastGameListToAll(); }, 3000);
            gameManager.broadcastGameListToAll();
          } else {
            game.round++;
            game.target = Math.floor(Math.random() * 100) + 1;
            game.choices = {};
          }
        } else {
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'guess_choice_made',
            gameId: parsedMessage.gameId,
            playerId: clientId
          });
        }
        return;
      }

      if (parsedMessage.type === 'battleship_place') {
        const game = gameManager.games.get(parsedMessage.gameId);
        if (!game || game.type !== 'battleship') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏无效' })); return; }
        if (game.phase !== 'placing') { ws.send(JSON.stringify({ type: 'game_error', error: '不在布置阶段' })); return; }
        const playerIdx = game.players.findIndex(p => p.id === clientId);
        if (playerIdx === -1) { ws.send(JSON.stringify({ type: 'game_error', error: '你不是玩家' })); return; }
        const key = 'p' + (playerIdx + 1);
        const board = game.boards[key];
        const shipLen = parseInt(parsedMessage.length);
        if (![2, 3].includes(shipLen)) { ws.send(JSON.stringify({ type: 'game_error', error: '无效船长度' })); return; }
        const { row, col, dir } = parsedMessage;
        if (row < 0 || row >= 6 || col < 0 || col >= 6) { ws.send(JSON.stringify({ type: 'game_error', error: '位置无效' })); return; }
        const cells = [];
        for (let i = 0; i < shipLen; i++) {
          const r = dir === 'h' ? row : row + i;
          const c = dir === 'h' ? col + i : col;
          if (r >= 6 || c >= 6 || board[r][c] !== null) { ws.send(JSON.stringify({ type: 'game_error', error: '位置无效或重叠' })); return; }
          cells.push([r, c]);
        }
        cells.forEach(([r, c]) => { board[r][c] = 'ship'; });
        game.ships[key].push({ cells, hits: 0, length: shipLen });
        game.placed[clientId] = (game.placed[clientId] || 0) + 1;

        ws.send(JSON.stringify({ type: 'battleship_placed', gameId: parsedMessage.gameId, shipIndex: game.ships[key].length - 1 }));

        const needShips = [2, 2, 3];
        if ((game.placed[game.players[0]?.id] || 0) >= needShips.length && (game.placed[game.players[1]?.id] || 0) >= needShips.length) {
          game.phase = 'playing';
          game.currentTurn = game.players[0].id;
          gameManager.broadcastToGame(parsedMessage.gameId, { type: 'battleship_start', gameId: parsedMessage.gameId, currentTurn: game.currentTurn });
        }
        return;
      }

      if (parsedMessage.type === 'battleship_attack') {
        const game = gameManager.games.get(parsedMessage.gameId);
        if (!game || game.type !== 'battleship') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏无效' })); return; }
        if (game.phase !== 'playing') { ws.send(JSON.stringify({ type: 'game_error', error: '游戏未开始' })); return; }
        const playerIdx = game.players.findIndex(p => p.id === clientId);
        if (playerIdx === -1) { ws.send(JSON.stringify({ type: 'game_error', error: '你不是玩家' })); return; }
        if (game.currentTurn !== clientId) { ws.send(JSON.stringify({ type: 'game_error', error: '还没轮到你' })); return; }

        const { row, col } = parsedMessage;
        if (row < 0 || row >= 6 || col < 0 || col >= 6) { ws.send(JSON.stringify({ type: 'game_error', error: '位置无效' })); return; }

        const myKey = 'p' + (playerIdx + 1);
        const oppKey = 'p' + (playerIdx === 0 ? 2 : 1);
        const attacks = game.attacks[myKey];
        if (attacks[row][col] !== null) { ws.send(JSON.stringify({ type: 'game_error', error: '已攻击过此位置' })); return; }

        const oppBoard = game.boards[oppKey];
        const hit = oppBoard[row][col] === 'ship';
        attacks[row][col] = hit ? 'hit' : 'miss';

        if (hit) {
          oppBoard[row][col] = 'hit';
          const ship = game.ships[oppKey].find(s => s.cells.some(([r, c]) => r === row && c === col));
          if (ship) ship.hits++;
        }

        const allSunk = game.ships[oppKey].every(s => s.hits >= s.length);
        let winner = null;
        if (allSunk) {
          game.phase = 'finished';
          game.status = 'finished';
          winner = game.players[playerIdx].name;
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'battleship_result',
            gameId: parsedMessage.gameId,
            attacker: myKey,
            row, col, hit,
            winnerName: winner,
            allSunk: true,
            playerAttacks: game.attacks
          });
          setTimeout(() => { gameManager.games.delete(parsedMessage.gameId); gameManager.broadcastGameListToAll(); }, 3000);
          gameManager.broadcastGameListToAll();
        } else {
          game.currentTurn = game.players[playerIdx === 0 ? 1 : 0].id;
          gameManager.broadcastToGame(parsedMessage.gameId, {
            type: 'battleship_result',
            gameId: parsedMessage.gameId,
            attacker: myKey,
            row, col, hit,
            winnerName: null,
            allSunk: false,
            currentTurn: game.currentTurn
          });
        }
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
        if (targetName === userInfo.username) {
          ws.send(JSON.stringify({ type: 'game_error', error: '不能邀请自己' }));
          return;
        }
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

      // ===== 屏幕共享信令 =====
      if (parsedMessage.type === 'screen_share_start') {
        currentSharers.set(clientId, { username: userInfo.username });
        // 广播更新后的共享者列表给所有人（附带各自的 clientId 以便过滤自己）
        const sharerList = Array.from(currentSharers.entries()).map(([id, info]) => ({ id, name: info.username }));
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'sharer_list', sharers: sharerList, yourId: client.id }));
          }
        });
        return;
      }

      if (parsedMessage.type === 'screen_share_stop') {
        currentSharers.delete(clientId);
        const sharerList = Array.from(currentSharers.entries()).map(([id, info]) => ({ id, name: info.username }));
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'sharer_list', sharers: sharerList, yourId: client.id }));
          }
        });
        return;
      }

      // WebRTC 信令转发（offer/answer/ice）
      if (parsedMessage.type === 'webrtc_signal') {
        const targetId = parsedMessage.targetId;
        wss.clients.forEach(client => {
          if (client.id === targetId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'webrtc_signal',
              fromId: clientId,
              fromName: userInfo.username,
              signal: parsedMessage.signal
            }));
          }
        });
        return;
      }

      // 过滤屏蔽词
      if (parsedMessage.content && parsedMessage.type !== 'image') {
        parsedMessage.content = admin.filterText(parsedMessage.content);
      }

      // 服务端校验图片大小
      if (parsedMessage.type === 'image' && parsedMessage.content) {
        const base64Size = Buffer.from(parsedMessage.content.replace(/^data:image\/\w+;base64,/, ''), 'base64').length;
        if (base64Size > serverConfig.imageMaxSize) {
          ws.send(JSON.stringify({ type: 'error', content: `图片过大，限制 ${(serverConfig.imageMaxSize / 1024 / 1024).toFixed(0)}MB` }));
          return;
        }
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
    // 如果共享者断开连接，清除共享状态并广播列表更新
    if (currentSharers.has(clientId)) {
      currentSharers.delete(clientId);
      const sharerList = Array.from(currentSharers.entries()).map(([id, info]) => ({ id, name: info.username }));
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.id !== clientId) {
          client.send(JSON.stringify({ type: 'sharer_list', sharers: sharerList, yourId: client.id }));
        }
      });
    }
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
const PORT = config.port || 8082;
const HOST = '0.0.0.0';

function startServer(silent = false) {
  server.listen(PORT, HOST, () => {
    if (!silent) {
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
    startDiscovery();
  });
}

if (require.main === module) {
  startServer();
}

// ==================== UDP 服务发现 ====================
let udpBeacon = null;
function startDiscovery() {
  const discovery = config.discovery || {};
  if (discovery.enabled === false) return;
  const broadcastPort = discovery.broadcastPort || 25000;
  const intervalMs = discovery.intervalMs || 2000;
  const serverName = discovery.serverName || os.hostname();
  const localIP = getLocalIP();

  try {
    udpBeacon = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpBeacon.bind(() => udpBeacon.setBroadcast(true));

    const beacon = () => {
      const payload = JSON.stringify({
        type: 'lan-chat-server',
        name: serverName,
        ip: localIP,
        port: PORT,
        version: '1.1',
      });
      udpBeacon.send(payload, 0, payload.length, broadcastPort, '255.255.255.255');
    };
    beacon();
    setInterval(beacon, intervalMs);
    console.log(`📡 UDP 服务发现已启动（端口 ${broadcastPort}）`);
  } catch (e) {
    console.error('⚠️  UDP 服务发现启动失败:', e.message);
  }
}

// 导出管理员模块供adminConsole.js使用
module.exports = {
  admin,
  wss,
  getTotalMessageCount,
  queryUserMessages,
  clearAllMessages,
  db,
  startServer,
  fileAdmin
};

// 优雅关闭处理
process.on('SIGINT', () => {
  console.log('\n\n🛑 收到关闭信号，正在优雅关闭服务器...');
  console.log(`📊 最终统计:`);
  console.log(`   🔗 总连接数: ${connectionCount}`);
  console.log(`   👥 当前在线用户: ${wss.clients.size}`);

  if (udpBeacon) { udpBeacon.close(); console.log('✅ UDP 广播已关闭'); }

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
