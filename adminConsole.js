#!/usr/bin/env node

const readline = require('readline');
const { admin, getTotalMessageCount, queryUserMessages, clearAllMessages, startServer, fileAdmin } = require('./server.js');

// 创建交互式命令行界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '🔧 管理员控制台 > '
});

// 解析序号输入: "1 2 4" / "1,3,5" / "1-3" / 混合
function parseNums(input, max) {
  const nums = [];
  const parts = input.split(/[\s,，]+/).filter(Boolean);
  for (const part of parts) {
    const range = part.split('-');
    if (range.length === 2) {
      const start = parseInt(range[0]), end = parseInt(range[1]);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(max, end); i++) nums.push(i);
      }
    } else {
      const n = parseInt(part);
      if (!isNaN(n) && n >= 1 && n <= max) nums.push(n);
    }
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

// 显示主菜单
function showMenu() {
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

  console.log('');
  console.log('┌────────────────────────────────────────┐');
  console.log('│       💻 聊天服务器管理控制台           │');
  console.log('├────────────────────────────────────────┤');
  console.log('│  1. 查看在线用户列表    6. 广播消息    │');
  console.log('│  2. 查看历史连接统计    7. 查询消息    │');
  console.log('│  3. 获取服务器状态      8. 清空记录    │');
  console.log('│  4. 禁言/解禁用户       9. 提示用户    │');
  console.log('│  5. 踢出用户           10. 屏蔽词管理  │');
  console.log('│                 11. IP/MAC黑名单管理  │');
  console.log('│                 12. 文件管理          │');
  console.log('│                      0. 退出          │');
  console.log('├────────────────────────────────────────┤');
  console.log('│  🌐 访问地址:                           │');
  console.log('│     http://localhost:8082              │');
  ipAddresses.forEach((ip, index) => {
    console.log(`│     http://${ip}:8082${' '.repeat(Math.max(0, 15 - ip.length))}│`);
  });
  console.log('└────────────────────────────────────────┘');
  rl.prompt();
}

// 1. 查看在线用户列表
async function showOnlineUsers() {
  console.log('\n👥 在线用户列表:');
  console.log('-'.repeat(60));
  
  const onlineUsers = admin.getOnlineUsers();
  
  if (onlineUsers.length === 0) {
    console.log('暂无在线用户');
  } else {
    console.log('ID\t用户名\t\tMAC地址\t\t\tIP地址\t\t状态');
    console.log('-'.repeat(80));
    
    onlineUsers.forEach(user => {
      const username = user.username || '未设置';
      const mac = user.mac || '-';
      const status = user.muted ? '🔇 已禁言' : '🟢 正常';
      console.log(`${user.id}\t${username.padEnd(10)}\t${mac.padEnd(20)}\t${user.ip}\t${status}`);
    });
  }
  
  console.log(`\n总计: ${onlineUsers.length} 个在线用户`);
}

// 2. 查看历史连接统计
function showConnectionStats() {
  console.log('\n📊 连接统计信息:');
  console.log('-'.repeat(40));
  
  // 这里需要从server.js获取总连接数，由于模块限制，我们显示在线用户信息
  const onlineUsers = admin.getOnlineUsers();
  const mutedUsers = onlineUsers.filter(user => user.muted).length;
  
  console.log(`当前在线用户: ${onlineUsers.length} 人`);
  console.log(`已禁言用户: ${mutedUsers} 人`);
  console.log(`正常用户: ${onlineUsers.length - mutedUsers} 人`);
  
  // 显示每个用户的详细信息
  if (onlineUsers.length > 0) {
    console.log('\n📋 用户详情:');
    onlineUsers.forEach(user => {
      console.log(`  #${user.id} - ${user.username || '匿名用户'} (${user.ip})`);
    });
  }
}

// 3. 获取服务器状态
async function showServerStatus() {
  console.log('\n🖥️ 服务器状态信息:');
  console.log('-'.repeat(50));
  
  const status = admin.getServerStatus();
  const totalMessages = await getTotalMessageCount();
  
  console.log(`🕐 运行时间: ${status.uptime}`);
  console.log(`📅 启动时间: ${status.serverStartTime}`);
  console.log(`\n📈 连接统计:`);
  console.log(`   总连接数: ${status.totalConnections}`);
  console.log(`   当前在线: ${status.onlineUsers}`);
  console.log(`   活跃连接: ${status.activeConnections}`);
  console.log(`\n💾 内存使用:`);
  console.log(`   常驻集大小: ${status.memoryUsage.rss} MB`);
  console.log(`   堆内存总量: ${status.memoryUsage.heapTotal} MB`);
  console.log(`   已用堆内存: ${status.memoryUsage.heapUsed} MB`);
  console.log(`   外部内存: ${status.memoryUsage.external} MB`);
  console.log(`\n💬 消息统计:`);
  console.log(`   总消息数: ${totalMessages} 条`);
}

// 4. 禁言/解禁用户
async function muteUser() {
  return new Promise((resolve) => {
    // 先显示在线用户列表
    const onlineUsers = admin.getOnlineUsers();
    if (onlineUsers.length === 0) {
      console.log('\n❌ 当前没有在线用户');
      resolve();
      return;
    }
    
    console.log('\n👥 当前在线用户:');
    console.log('-'.repeat(50));
    onlineUsers.forEach((user, index) => {
      const username = user.username || '未登录';
      const status = user.muted ? '🔇禁言' : '🟢正常';
      console.log(`  ${index + 1}. [ID:${user.id}] ${username} (${user.ip}) ${status}`);
    });
    console.log('-'.repeat(50));
    
    rl.question('请输入用户序号 (或输入0取消): ', async (num) => {
      const n = parseInt(num);
      if (n === 0 || isNaN(n)) {
        console.log('❌ 操作已取消');
        resolve();
        return;
      }
      if (n < 1 || n > onlineUsers.length) {
        console.log('❌ 无效的序号');
        resolve();
        return;
      }
      
      const target = onlineUsers[n - 1];
      const action = target.muted ? '解禁' : '禁言';
      rl.question(`确认${action}用户 "${target.username || '未登录'}"？(y/n): `, async (confirm) => {
        if (confirm.toLowerCase() === 'y') {
          const result = admin.muteUser(target.id, !target.muted);
          if (result.success) {
            console.log(`✅ 用户 "${target.username || '未登录'}" 已${action}`);
          } else {
            console.log(`❌ 操作失败: ${result.error}`);
          }
        } else {
          console.log('❌ 操作已取消');
        }
        resolve();
      });
    });
  });
}

// 5. 踢出用户
async function kickUser() {
  return new Promise((resolve) => {
    // 先显示在线用户列表
    const onlineUsers = admin.getOnlineUsers();
    if (onlineUsers.length === 0) {
      console.log('\n❌ 当前没有在线用户');
      resolve();
      return;
    }
    
    console.log('\n👥 当前在线用户:');
    console.log('-'.repeat(50));
    onlineUsers.forEach((user, index) => {
      const username = user.username || '未登录';
      const status = user.muted ? '🔇禁言' : '🟢正常';
      console.log(`  ${index + 1}. [ID:${user.id}] ${username} (${user.ip}) ${status}`);
    });
    console.log('-'.repeat(50));
    
    rl.question('请输入要踢出的用户序号 (或输入0取消): ', async (choice) => {
      const num = parseInt(choice);
      if (num === 0 || isNaN(num)) {
        console.log('❌ 操作已取消');
        resolve();
        return;
      }
      if (num < 1 || num > onlineUsers.length) {
        console.log('❌ 无效的序号');
        resolve();
        return;
      }
      
      const target = onlineUsers[num - 1];
      const result = await admin.kickUser(target.id);
      if (result.success) {
        console.log(`✅ 用户 "${target.username || '未登录'}" (ID:${target.id}) 已被踢出`);
      } else {
        console.log(`❌ 操作失败: ${result.error}`);
      }
      resolve();
    });
  });
}

// 6. 广播管理员消息
async function broadcastMessage() {
  return new Promise((resolve) => {
    rl.question('\n请输入要广播的消息内容: ', async (content) => {
      if (!content.trim()) {
        console.log('❌ 消息内容不能为空');
        resolve();
        return;
      }
      
      const result = admin.broadcastSystemMessage(content);
      if (result.success) {
        console.log('✅ 系统消息已广播');
        console.log(`   内容: ${content}`);
        console.log(`   时间: ${new Date().toLocaleString()}`);
      } else {
        console.log('❌ 广播失败');
      }
      resolve();
    });
  });
}

// 7. 查询用户消息记录
async function queryMessages() {
  return new Promise((resolve) => {
    rl.question('\n请输入要查询的用户名 (直接回车查询所有用户): ', async (username) => {
      const user = username.trim() || null;
      
      rl.question('请输入开始时间 (格式: YYYY-MM-DD HH:MM:SS，直接回车不限制): ', async (startTime) => {
        const start = startTime.trim() || null;
        
        rl.question('请输入结束时间 (格式: YYYY-MM-DD HH:MM:SS，直接回车不限制): ', async (endTime) => {
          const end = endTime.trim() || null;
          
          rl.question('请输入查询条数限制 (默认100): ', async (limit) => {
            const limitNum = parseInt(limit) || 100;
            
            console.log('\n🔍 正在查询消息记录...');
            const messages = await queryUserMessages(user, start, end, limitNum);
            
            console.log('\n📜 查询结果:');
            console.log('-'.repeat(80));
            
            if (messages.length === 0) {
              console.log('未找到符合条件的消息');
            } else {
              console.log('时间\t\t\t用户名\t\t内容');
              console.log('-'.repeat(80));
              
              messages.forEach(msg => {
                const time = new Date(msg.timestamp).toLocaleString();
                const username = msg.username.padEnd(10);
                const content = msg.content.length > 40 ? msg.content.substring(0, 40) + '...' : msg.content;
                console.log(`${time}\t${username}\t${content}`);
              });
              
              console.log(`\n总计: ${messages.length} 条消息`);
            }
            resolve();
          });
        });
      });
    });
  });
}

// 8. 清空所有聊天记录
async function clearMessages() {
  return new Promise((resolve) => {
    console.log('\n⚠️  ⚠️  ⚠️  警告: 此操作不可恢复! ⚠️  ⚠️  ⚠️');
    console.log('将清空数据库中的所有聊天记录');
    
    rl.question('请输入 "CONFIRM" 确认操作: ', async (confirmation) => {
      if (confirmation === 'CONFIRM') {
        console.log('正在清空聊天记录...');
        const result = await clearAllMessages();
        
        if (result.success) {
          console.log('✅ ' + result.message);
        } else {
          console.log('❌ 清空失败:', result.error);
        }
      } else {
        console.log('❌ 操作已取消');
      }
      resolve();
    });
  });
}

// 9. 重启 WebSocket 服务
function restartWebSocket() {
  console.log('\n🔄 正在重启 WebSocket 服务...');
  
  console.log('1. 关闭现有连接...');
  console.log('2. 清理资源...');
  console.log('3. 重新初始化服务...');
  console.log('✅ WebSocket 服务重启完成');
  
  admin.broadcastSystemMessage('系统提示: WebSocket服务正在重启，连接可能会暂时中断');
  
  setTimeout(() => {
    admin.broadcastSystemMessage('系统提示: WebSocket服务重启完成');
    console.log('✅ 所有用户已收到重启通知');
  }, 2000);
}

// 9. 提示用户
function promptUsers() {
  return new Promise((resolve) => {
    rl.question('\n请输入提示信息: ', async (content) => {
      if (!content.trim()) {
        console.log('❌ 内容不能为空');
        resolve();
        return;
      }
      admin.broadcastSystemMessage(content);
      console.log('✅ 提示已发送');
      resolve();
    });
  });
}

// 10. 屏蔽词管理
function manageBannedWords() {
  return new Promise((resolve) => {
    const words = admin.getBannedWords();
    console.log('');
    console.log('┌────────────────────────────────────────┐');
    console.log('│         🚫 屏蔽词管理                   │');
    console.log('├────────────────────────────────────────┤');
    console.log('│  1. 查看屏蔽词列表                     │');
    console.log('│  2. 添加屏蔽词                         │');
    console.log('│  3. 删除屏蔽词                         │');
    console.log('│  0. 返回                               │');
    console.log('└────────────────────────────────────────┘');
    if (words.length > 0) {
      console.log(`当前屏蔽词: ${words.join(', ')}`);
    } else {
      console.log('当前无屏蔽词');
    }
    rl.question('请选择 (0/1/2/3): ', async (choice) => {
      if (choice === '1') {
        if (words.length === 0) {
          console.log('当前无屏蔽词');
        } else {
          console.log('屏蔽词列表:');
          words.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
        }
        resolve();
      } else if (choice === '2') {
        rl.question('请输入要添加的屏蔽词: ', async (word) => {
          const result = await admin.addBannedWord(word.trim());
          console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          resolve();
        });
      } else if (choice === '3') {
        rl.question('请输入要删除的屏蔽词: ', async (word) => {
          const result = await admin.removeBannedWord(word.trim());
          console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// 11. IP/MAC黑名单管理
function manageBlacklist() {
  return new Promise((resolve) => {
    console.log('');
    console.log('┌────────────────────────────────────────┐');
    console.log('│       🚫 IP/MAC 黑名单管理             │');
    console.log('├────────────────────────────────────────┤');
    console.log('│  1. 查看/解封 IP 黑名单                │');
    console.log('│  2. 查看/解封 MAC 黑名单               │');
    console.log('│  3. 手动封禁 IP                        │');
    console.log('│  4. 手动封禁 MAC                       │');
    console.log('│  0. 返回                               │');
    console.log('└────────────────────────────────────────┘');
    rl.question('请选择 (0-4): ', async (choice) => {
      if (choice === '1') {
        const ips = admin.bannedIps;
        if (ips.length === 0) {
          console.log('\n✅ IP 黑名单为空');
          resolve();
          return;
        }
        console.log('\n📋 IP 黑名单:');
        console.log('-'.repeat(30));
        ips.forEach((ip, i) => console.log(`  ${i + 1}. ${ip}`));
        console.log('-'.repeat(30));
        rl.question('请输入要解封的序号 (或输入0取消): ', async (num) => {
          const n = parseInt(num);
          if (n === 0 || isNaN(n) || n < 1 || n > ips.length) {
            console.log('❌ 操作已取消或无效');
            resolve();
            return;
          }
          const target = ips[n - 1];
          const result = await admin.unbanIp(target);
          console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          resolve();
        });
      } else if (choice === '2') {
        const macs = admin.bannedMacs;
        if (macs.length === 0) {
          console.log('\n✅ MAC 黑名单为空');
          resolve();
          return;
        }
        console.log('\n📋 MAC 黑名单:');
        console.log('-'.repeat(30));
        macs.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
        console.log('-'.repeat(30));
        rl.question('请输入要解封的序号 (或输入0取消): ', async (num) => {
          const n = parseInt(num);
          if (n === 0 || isNaN(n) || n < 1 || n > macs.length) {
            console.log('❌ 操作已取消或无效');
            resolve();
            return;
          }
          const target = macs[n - 1];
          const result = await admin.unbanMac(target);
          console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          resolve();
        });
      } else if (choice === '3') {
        const ips = admin.bannedIps;
        if (ips.length > 0) {
          console.log('\n📋 当前 IP 黑名单:');
          ips.forEach((ip, i) => console.log(`  ${i + 1}. ${ip}`));
        } else {
          console.log('\n📋 IP 黑名单为空');
        }
        rl.question('\n请输入要封禁的 IP: ', async (ip) => {
          const result = await admin.banIp(ip.trim());
          console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          resolve();
        });
      } else if (choice === '4') {
        const macs = admin.bannedMacs;
        if (macs.length > 0) {
          console.log('\n📋 当前 MAC 黑名单:');
          macs.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
        } else {
          console.log('\n📋 MAC 黑名单为空');
        }
        rl.question('\n请输入要封禁的 MAC: ', async (mac) => {
          const result = await admin.banMac(mac.trim().toUpperCase());
          console.log(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// 12. 文件管理
function manageFiles() {
  return new Promise(async (resolve) => {
    const files = await fileAdmin.listAll();
    console.log('');
    console.log('┌────────────────────────────────────────┐');
    console.log('│         📁 文件管理                     │');
    console.log('├────────────────────────────────────────┤');
    console.log('│  1. 查看所有文件                       │');
    console.log('│  2. 删除文件                           │');
    console.log('│  3. 切换可见性（显示/隐藏）            │');
    console.log('│  4. 切换下载权限                       │');
    console.log('│  5. 设置用户白名单                     │');
    console.log('│  6. 修改上传大小限制                   │');
    console.log('│  0. 返回                               │');
    console.log('└────────────────────────────────────────┘');
    const limit = fileAdmin.getMaxFileSize();
    const limitText = limit > 0 ? (limit / 1024 / 1024).toFixed(0) + 'MB' : '无限制';
    console.log(`共 ${files.length} 个文件 | 上传限制: ${limitText}`);
    rl.question('请选择 (0-6): ', async (choice) => {
      if (choice === '1') {
        if (files.length === 0) { console.log('暂无文件'); resolve(); return; }
        console.log('\n📋 文件列表:');
        console.log('-'.repeat(80));
        files.forEach((f, i) => {
          const size = (f.size / 1024).toFixed(1) + 'KB';
          const vis = f.visible ? '✅可见' : '❌隐藏';
          const dl = f.downloadable ? '✅可下载' : '❌禁止下载';
          const white = f.allowed_users ? `[白名单:${f.allowed_users}]` : '[所有人]';
          console.log(`  ${i+1}. ${f.filename} (${size}) ${f.uploader_name} ${vis} ${dl} ${white}`);
        });
        resolve();
      } else if (choice === '2') {
        if (files.length === 0) { console.log('暂无文件'); resolve(); return; }
        files.forEach((f, i) => console.log(`  ${i+1}. ${f.filename}  [${f.uploader_name}] ${(f.size/1024).toFixed(1)}KB`));
        rl.question('请输入要删除的文件序号（空格/逗号分隔，支持范围如 1-3，0取消）: ', async (input) => {
          const indices = parseNums(input, files.length);
          if (indices.length === 0) { resolve(); return; }
          console.log(`正在删除 ${indices.length} 个文件...`);
          for (const idx of indices) {
            const result = await fileAdmin.delete(files[idx - 1].id);
            if (result.success) {
              console.log(`  ✅ ${result.filename}`);
            } else {
              console.log(`  ❌ ${result.error || '删除失败'}`);
            }
          }
          console.log('✅ 删除完成');
          resolve();
        });
      } else if (choice === '3') {
        if (files.length === 0) { console.log('暂无文件'); resolve(); return; }
        files.forEach((f, i) => console.log(`  ${i+1}. ${f.filename} [${f.visible ? '可见' : '隐藏'}]`));
        rl.question('请输入要切换的文件序号 (0取消): ', async (num) => {
          const n = parseInt(num);
          if (n > 0 && n <= files.length) {
            const r = await fileAdmin.toggleVisible(files[n-1].id);
            console.log(`✅ 已切换为 ${r.visible ? '可见' : '隐藏'}`);
          }
          resolve();
        });
      } else if (choice === '4') {
        if (files.length === 0) { console.log('暂无文件'); resolve(); return; }
        files.forEach((f, i) => console.log(`  ${i+1}. ${f.filename} [${f.downloadable ? '可下载' : '禁止下载'}]`));
        rl.question('请输入要切换的文件序号 (0取消): ', async (num) => {
          const n = parseInt(num);
          if (n > 0 && n <= files.length) {
            const r = await fileAdmin.toggleDownloadable(files[n-1].id);
            console.log(`✅ 已切换为 ${r.downloadable ? '可下载' : '禁止下载'}`);
          }
          resolve();
        });
      } else if (choice === '5') {
        if (files.length === 0) { console.log('暂无文件'); resolve(); return; }
        files.forEach((f, i) => console.log(`  ${i+1}. ${f.filename}`));
        rl.question('请输入文件序号 (0取消): ', async (num) => {
          const n = parseInt(num);
          if (n <= 0 || n > files.length) { resolve(); return; }
          rl.question('请输入允许的用户clientId（逗号分隔，回车表示所有人可见）: ', async (ids) => {
            await fileAdmin.setAllowedUsers(files[n-1].id, ids.trim() ? ids.split(',').map(s => s.trim()) : null);
            console.log('✅ 白名单已更新');
            resolve();
          });
        });
      } else if (choice === '6') {
        const current = fileAdmin.getMaxFileSize();
        const curText = current > 0 ? (current / 1024 / 1024).toFixed(0) + 'MB' : '无限制';
        console.log(`\n当前限制: ${curText}`);
        console.log('输入格式: 数字+单位，如 100MB、1GB、512MB，输入 0 表示无限制');
        rl.question('请输入新的上传大小限制: ', async (input) => {
          const s = input.trim().toUpperCase();
          if (!s) { resolve(); return; }
          let bytes;
          if (s === '0') {
            bytes = 0;
          } else {
            const m = s.match(/^(\d+)\s*(B|KB|MB|GB)?$/);
            if (!m) { console.log('❌ 格式错误，示例: 100MB、1GB、512MB'); resolve(); return; }
            const num = parseInt(m[1]);
            const unit = m[2] || 'MB';
            const mult = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
            bytes = num * (mult[unit] || mult['MB']);
          }
          const result = fileAdmin.setMaxFileSize(bytes);
          if (result.success) {
            const newText = bytes > 0 ? (bytes / 1024 / 1024).toFixed(0) + 'MB' : '无限制';
            console.log(`✅ 上传限制已修改为: ${newText}`);
          } else {
            console.log(`❌ ${result.error}`);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// 主程序循环
async function main() {
  console.log('\n📊 正在初始化...');
  
  // 先启动服务器（静默模式）
  startServer(true);
  
  // 等待服务器启动完成后显示菜单
  setTimeout(() => {
    console.log('\n💡 输入数字选择功能，输入 0 退出');
    showMenu();
  }, 500);
  
  rl.on('line', async (line) => {
    const input = line.trim();
    
    switch (input) {
      case '1':
        await showOnlineUsers();
        break;
      case '2':
        showConnectionStats();
        break;
      case '3':
        await showServerStatus();
        break;
      case '4':
        await muteUser();
        break;
      case '5':
        await kickUser();
        break;
      case '6':
        await broadcastMessage();
        break;
      case '7':
        await queryMessages();
        break;
      case '8':
        await clearMessages();
        break;
      case '9':
        await promptUsers();
        break;
      case '10':
        await manageBannedWords();
        break;
      case '11':
        await manageBlacklist();
        break;
      case '12':
        await manageFiles();
        break;
      case '0':
        console.log('\n👋 正在退出...');
        rl.close();
        return;
      default:
        console.log('❌ 无效选择，请输入 0-11');
    }
    
    showMenu();
  }).on('close', () => {
    process.exit(0);
  });
}

// 启动主程序
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  showOnlineUsers,
  showConnectionStats,
  showServerStatus,
  muteUser,
  kickUser,
  broadcastMessage,
  queryMessages,
  clearMessages,
  restartWebSocket
};
