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
        } else {
          console.log(`❌ 用户 #${clientId} 注册失败: 用户名为空`);
        }
        return;
      }

      // 未注册用户禁止发消息，踢出并封禁IP+MAC
      if (!userInfo.registered) {
        console.log(`🚫 用户 #${clientId} (${clientIp} / ${macAddress}) 未登录就发消息，封禁并断开`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'force_logout', reason: '请通过登录页面登录' }));
        }
        await admin.banIp(clientIp);
        if (macAddress !== '本机' && macAddress !== '-') {
          await admin.banMac(macAddress);
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
    activeConnections.delete(ws);
    const info = admin.onlineUsers.get(clientId);
    // 未注册就断开 → 封禁IP+MAC
    if (info && !info.registered) {
      console.log(`🚫 用户 #${clientId} (${clientIp} / ${macAddress}) 未登录就断开，封禁`);
      admin.banIp(clientIp);
      if (macAddress !== '本机' && macAddress !== '-') {
        admin.banMac(macAddress);
      }
    }
    admin.onlineUsers.delete(clientId);
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
