let socket;
let currentUser = '';
let clientId = localStorage.getItem('chatClientId');
if (!clientId) {
  clientId = 'user_' + Math.random().toString(36).substr(2, 8);
  localStorage.setItem('chatClientId', clientId);
}

// 获取DOM元素
const loginSection = document.querySelector('.login');
const chatSection = document.querySelector('.chat');
const usernameInput = document.getElementById('username');
const loginBtn = document.getElementById('loginBtn');
const messagesDiv = document.querySelector('.messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');

// 获取DOM元素
const loginForm = document.getElementById('loginForm');
const chatContainer = document.getElementById('chatContainer');

// 检查本地存储中是否有用户名
const storedUser = localStorage.getItem('chatUsername');
if (storedUser && storedUser.trim()) {
  currentUser = storedUser.trim();
  loginForm.classList.add('hidden');
  chatContainer.classList.remove('hidden');
  connectWebSocket();
} else {
  // 没有用户名，清除可能残留的状态
  localStorage.removeItem('chatUsername');
  localStorage.removeItem('chatClientId');
}

// 登录处理
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (username) {
    currentUser = username;
    // 保存用户名到localStorage
    localStorage.setItem('chatUsername', username);
    loginForm.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    connectWebSocket();
  }
});

// 登出处理
function logout() {
  localStorage.removeItem('chatUsername');
  localStorage.removeItem('chatClientId');
  if (socket) socket.close();
  location.reload();
}

// 添加登出按钮
const logoutButton = document.createElement('button');
logoutButton.textContent = '登出';
logoutButton.classList.add('logout-btn');
logoutButton.onclick = logout;
document.querySelector('.container').appendChild(logoutButton);

// 连接WebSocket服务器
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname === 'localhost' 
    ? window.location.hostname 
    : window.location.hostname.split(':')[0];
  const port = window.location.port || (protocol === 'wss:' ? 443 : 8082);
  socket = new WebSocket(`${protocol}//${host}:${port}`);

  socket.onopen = () => {
    console.log('WebSocket连接已建立');
    addSystemMessage('已连接到聊天室');
    // 连接成功后立即发送用户名和客户端ID
    if (currentUser) {
      const regMsg = JSON.stringify({ type: 'register', username: currentUser, clientId: clientId });
      socket.send(regMsg);
      console.log('发送注册消息:', regMsg);
      // 1秒后重试一次，确保服务器收到
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(regMsg);
          console.log('重试注册消息:', regMsg);
        }
      }, 1000);
    } else {
      console.error('currentUser 为空，无法注册');
    }
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'history') {
      data.messages.forEach(message => {
        displayMessage(message);
      });
    } else if (data.type === 'force_logout') {
      alert(data.reason || '请重新登录');
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatClientId');
      window.location.href = window.location.pathname + '?t=' + Date.now();
    } else if (data.type === 'error') {
      alert(data.content);
    } else if (data.type === 'game_list') {
      renderActiveGames(data.games);
    } else if (data.type === 'game_players') {
      renderPlayerList(data.players);
    } else if (data.type === 'game_created') {
      currentGameId = data.game.id;
      // 不打开棋盘，留在大厅等待对手加入
    } else if (data.type === 'game_start') {
      currentGameId = data.game.id;
      openGomoku(data.game);
    } else if (data.type === 'game_moved') {
      handleGomokuMove(data);
    } else if (data.type === 'game_chat') {
      addGomokuChat(data);
    } else if (data.type === 'game_spectator_count') {
      document.getElementById('gomokuSpectators').textContent = `观战: ${data.count}人`;
    } else if (data.type === 'game_over') {
      alert(data.winnerName === '平局' ? '平局！' : `🎉 ${data.winnerName} 获胜！`);
      setTimeout(() => { closeGomoku(); }, 2000);
    } else if (data.type === 'game_error') {
      alert(data.error);
      gameLobby.classList.remove('hidden');
    } else if (data.type === 'game_left') {
      closeGomoku();
    } else if (data.type === 'game_invite_received') {
      showInviteModal(data);
    } else if (data.type === 'game_invite_sent') {
      alert('邀请已发送，等待 ' + data.targetUsername + ' 响应...');
    } else if (data.type === 'game_invite_declined') {
      alert(data.targetUsername + ' 拒绝了你的邀请');
    } else if (data.type === 'sharer_list') {
      handleSharerListMsg(data);
    } else if (data.type === 'screen_share_stop') {
      handleScreenShareStopMsg(data);
    } else if (data.type === 'webrtc_signal') {
      handleWebRTCSignal(data);
    } else {
      displayMessage(data);
    }
  };

  socket.onclose = (event) => {
    // 4002 = 未注册被踢, 4003 = 临时封禁中
    if (event.code === 4002 || event.code === 4003) {
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatClientId');
      alert(event.reason || '请重新登录');
      window.location.href = window.location.pathname + '?t=' + Date.now();
      return;
    }
    localStorage.removeItem('chatUsername');
    localStorage.removeItem('chatClientId');
    setTimeout(() => {
      window.location.href = window.location.pathname + '?t=' + Date.now();
    }, 100);
  };

  socket.onerror = () => {
    socket.close();
  };
}

// 发送消息
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// 图片按钮点击
imageBtn.addEventListener('click', () => {
  imageInput.click();
});

// 图片选择处理
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // 检查文件类型
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件');
    return;
  }
  
  // 检查文件大小（限制 5MB）
  if (file.size > 5 * 1024 * 1024) {
    alert('图片大小不能超过 5MB');
    return;
  }
  
  try {
    // 转换为 base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result;
      const message = {
        username: currentUser,
        type: 'image',
        content: base64,
        time: new Date().toLocaleTimeString()
      };
      socket.send(JSON.stringify(message));
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error('图片发送失败:', err);
    alert('图片发送失败');
  }
  
  // 清空文件选择
  imageInput.value = '';
});

function sendMessage() {
  const content = messageInput.value.trim();
  if (content && socket && currentUser) {
    const message = {
      username: currentUser,
      content,
      time: new Date().toLocaleTimeString()
    };
    socket.send(JSON.stringify(message));
    messageInput.value = '';
  } else if (!currentUser) {
    alert('请先登录');
    logout();
  }
}

// 显示消息
function displayMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  
  // 判断是否为图片消息
  const isImage = message.type === 'image';
  const content = isImage 
    ? `<img src="${message.content}" alt="图片" class="message-image" onclick="window.open(this.src)">`
    : `<div class="content">${message.content}</div>`;
  
  messageElement.innerHTML = `
    <span class="username">${message.username}</span>
    <span class="time">${message.time}</span>
    ${content}
  `;
  
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 显示系统消息
function addSystemMessage(content) {
  const message = {
    username: '系统',
    content,
    time: new Date().toLocaleTimeString()
  };
  displayMessage(message);
}

// ===== 小窗模式 =====
const stealthBtn = document.getElementById('stealthBtn');
let miniActive = false;
let savedState = {};

function toggleMini() {
  miniActive = !miniActive;
  const container = document.querySelector('.container');
  const chat = document.querySelector('.chat');
  const h1 = document.querySelector('h1');
  const login = document.querySelector('.login');
  const logoutBtn = document.querySelector('.logout-btn');

  if (miniActive) {
    // 保存当前状态
    savedState = {
      width: window.outerWidth,
      height: window.outerHeight,
      x: window.screenX,
      y: window.screenY
    };

    document.body.classList.add('mini-mode');
    document.title = '聊天';

    // 尝试缩小浏览器窗口
    try {
      window.resizeTo(350, 450);
      window.moveTo(
        window.screen.availWidth - 370,
        window.screen.availHeight - 470
      );
    } catch(e) {}
  } else {
    document.body.classList.remove('mini-mode');
    document.title = '局域网聊天室';

    // 恢复窗口大小
    try {
      window.resizeTo(savedState.width, savedState.height);
      window.moveTo(savedState.x, savedState.y);
    } catch(e) {}
  }
}

// Ctrl+Shift+H 切换小窗
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'H') {
    e.preventDefault();
    toggleMini();
  }
  if (e.key === 'Escape' && miniActive) {
    toggleMini();
  }
});

stealthBtn.addEventListener('click', toggleMini);

// ===== 游戏系统 =====
let currentGameId = null;
let myGameColor = null;
let selectedGameType = null;
let lastMoveCell = null;

const gameLobby = document.getElementById('gameLobby');
const gomokuModal = document.getElementById('gomokuModal');
const gameBtn = document.getElementById('gameBtn');
const lobbyClose = document.getElementById('lobbyClose');
const gomokuClose = document.getElementById('gomokuClose');

// 打开游戏大厅
let lobbyRefreshTimer = null;

gameBtn.addEventListener('click', () => {
  gameLobby.classList.remove('hidden');
  refreshLobby();
});

lobbyClose.addEventListener('click', () => {
  gameLobby.classList.add('hidden');
});

function refreshLobby() {
  socket.send(JSON.stringify({ type: 'game_list' }));
  socket.send(JSON.stringify({ type: 'game_players' }));
}
gomokuClose.addEventListener('click', () => {
  if (currentGameId) {
    socket.send(JSON.stringify({ type: 'game_leave', gameId: currentGameId }));
  }
  closeGomoku();
});

// 选择游戏
document.querySelectorAll('.game-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedGameType = card.dataset.game;
  });
});

// 创建房间按钮
document.getElementById('createGameBtn').addEventListener('click', () => {
  if (!selectedGameType) { alert('请先选择游戏类型'); return; }
  createGame(selectedGameType);
});

// 渲染进行中的游戏列表
function renderActiveGames(games) {
  const container = document.getElementById('activeGames');
  const others = (games || []).filter(g => !g.players.includes(currentUser));
  if (others.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无进行中的游戏</p>';
    return;
  }
  const gameNames = { gomoku: '⚫ 五子棋' };
  container.innerHTML = others.map(g => {
    const statusText = g.status === 'waiting' ? '⏳ 等待加入' : '🎮 进行中';
    const specText = g.spectatorCount > 0 ? `👀 ${g.spectatorCount}人观战` : '';
    return `
    <div class="active-game-item">
      <div class="game-info">
        <strong>${gameNames[g.type] || g.type}</strong>
        ${g.players.join(' vs ')}
        <span class="game-status">${statusText}</span>
        ${specText ? `<span class="game-spec-count">${specText}</span>` : ''}
      </div>
      <div>
        ${g.status === 'waiting' ? `<button class="game-btn-join" onclick="joinGame('${g.id}')">加入</button>` : `<button class="game-btn-spectate" onclick="spectateGame('${g.id}')">观战</button>`}
      </div>
    </div>`;
  }).join('');
}

// 渲染在线玩家列表
function renderPlayerList(players) {
  const container = document.getElementById('playerList');
  const others = (players || []).filter(p => p.username !== currentUser);
  if (others.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无在线用户</p>';
    return;
  }
  container.innerHTML = others.map(p => `
    <div class="player-item">
      <span class="name">${p.username}</span>
      <button class="game-btn-invite" onclick="invitePlayer('${p.username}')">邀请对战</button>
    </div>
  `).join('');
}

// 创建游戏
function createGame(gameType) {
  if (!gameType) { alert('请先选择游戏'); return; }
  socket.send(JSON.stringify({ type: 'game_create', gameType }));
  // 留在大厅等待对手加入
}

// 加入游戏
function joinGame(gameId) {
  socket.send(JSON.stringify({ type: 'game_join', gameId }));
  // 大厅由 game_start 或 game_error 控制显隐
}

// 观战
function spectateGame(gameId) {
  socket.send(JSON.stringify({ type: 'game_spectate', gameId }));
  // 大厅由 game_start 或 game_error 控制显隐
}


// 打开五子棋界面
function openGomoku(game) {
  gomokuModal.classList.remove('hidden');
  gameLobby.classList.add('hidden');

  // 判断我的颜色
  const me = game.players.find(p => p.name === currentUser);
  myGameColor = me ? me.color : null;

  // 观战者模式
  if (myGameColor) {
    document.body.classList.remove('spectator');
  } else {
    document.body.classList.add('spectator');
  }

  // 更新标题
  const title = myGameColor
    ? `五子棋 (${myGameColor === 'black' ? '⚫ 黑棋' : '⚪ 白棋'})`
    : '五子棋 (👀 观战中)';
  document.getElementById('gomokuTitle').textContent = title;

  // 渲染棋盘
  renderGomokuBoard(game.board || Array(15).fill(null).map(() => Array(15).fill(null)));

  // 更新回合信息
  updateTurnInfo(game.currentTurn, game.winner);
}

// 渲染棋盘
function renderGomokuBoard(board) {
  const container = document.getElementById('gomokuBoard');
  container.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'gomoku-cell';
      if (board[r][c]) cell.classList.add(board[r][c]);
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', () => onGomokuClick(r, c));
      container.appendChild(cell);
    }
  }
}

// 点击棋盘
function onGomokuClick(row, col) {
  if (!currentGameId || !myGameColor) return;
  socket.send(JSON.stringify({
    type: 'game_move',
    gameId: currentGameId,
    row,
    col
  }));
}

// 处理下棋结果
function handleGomokuMove(data) {
  const { move, currentTurn, winner, status } = data;
  const cells = document.querySelectorAll('.gomoku-cell');
  const idx = move.row * 15 + move.col;
  const cell = cells[idx];
  if (cell) {
    cell.classList.add(move.color);
    if (lastMoveCell) lastMoveCell.classList.remove('last-move');
    cell.classList.add('last-move');
    lastMoveCell = cell;
  }
  updateTurnInfo(currentTurn, winner);
}

// 更新回合/胜负信息
let gameEndTimer = null;
function updateTurnInfo(currentTurn, winnerName) {
  const el = document.getElementById('gomokuTurn');
  if (gameEndTimer) { clearInterval(gameEndTimer); gameEndTimer = null; }
  if (winnerName) {
    el.textContent = '游戏结束';
    el.style.color = '#e91e63';
    // 弹窗显示胜负
    const isMe = myGameColor && (winnerName === currentUser);
    const msg = myGameColor
      ? (isMe ? '🎉 你赢了！' : '😢 你输了')
      : `🎉 ${winnerName} 获胜！`;
    alert(msg);
    // 5秒后自动返回大厅
    let countdown = 5;
    gameEndTimer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(gameEndTimer);
        gameEndTimer = null;
        closeGomoku();
      }
    }, 1000);
  } else if (myGameColor) {
    const isMyTurn = currentTurn === myGameColor;
    el.textContent = isMyTurn ? '轮到你了' : '等待对手...';
    el.style.color = isMyTurn ? '#4caf50' : '#999';
  } else {
    el.textContent = currentTurn === 'black' ? '⚫ 黑棋落子中...' : '⚪ 白棋落子中...';
    el.style.color = '#666';
  }
}

// 五子棋聊天
const gomokuChatInput = document.getElementById('gomokuChatInput');
const gomokuChatSend = document.getElementById('gomokuChatSend');

gomokuChatSend.addEventListener('click', sendGomokuChat);
gomokuChatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendGomokuChat();
});

function sendGomokuChat() {
  const content = gomokuChatInput.value.trim();
  if (content && currentGameId) {
    socket.send(JSON.stringify({ type: 'game_chat', gameId: currentGameId, content }));
    gomokuChatInput.value = '';
  }
}

function addGomokuChat(data) {
  // 底部聊天记录
  const container = document.getElementById('gomokuChatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // 弹幕效果
  const layer = document.getElementById('danmakuLayer');
  if (!layer) return;
  const danmaku = document.createElement('div');
  danmaku.className = 'danmaku-item';
  danmaku.textContent = `${data.username}: ${data.content}`;
  // 随机颜色
  const colors = ['#fff', '#ff0', '#0ff', '#f90', '#f0f', '#0f0'];
  danmaku.style.color = colors[Math.floor(Math.random() * colors.length)];
  // 随机垂直位置（10% ~ 80%）
  danmaku.style.top = (10 + Math.random() * 70) + '%';
  // 随机动画时长（8~12秒）
  const duration = 8 + Math.random() * 4;
  danmaku.style.animationDuration = duration + 's';
  layer.appendChild(danmaku);
  // 动画结束后删除元素
  danmaku.addEventListener('animationend', () => danmaku.remove());
}

// 关闭五子棋
function closeGomoku() {
  if (gameEndTimer) { clearInterval(gameEndTimer); gameEndTimer = null; }
  gomokuModal.classList.add('hidden');
  document.body.classList.remove('spectator');
  currentGameId = null;
  myGameColor = null;
  lastMoveCell = null;
  document.getElementById('gomokuChatMessages').innerHTML = '';
  // 返回游戏大厅
  gameLobby.classList.remove('hidden');
  refreshLobby();
}

// ===== 邀请对战 =====
let pendingInvite = null;
const inviteModal = document.getElementById('inviteModal');
const inviteAccept = document.getElementById('inviteAccept');
const inviteDecline = document.getElementById('inviteDecline');

// 邀请玩家
function invitePlayer(username) {
  if (!selectedGameType) { alert('请先选择游戏类型'); return; }
  socket.send(JSON.stringify({
    type: 'game_invite',
    gameType: selectedGameType,
    targetUsername: username
  }));
  gameLobby.classList.add('hidden');
}

// 收到邀请
function showInviteModal(data) {
  pendingInvite = data;
  const gameNames = { gomoku: '五子棋' };
  const gameIcons = { gomoku: '⚫' };
  document.getElementById('inviteText').textContent = (gameNames[data.gameType] || data.gameType) + '对战！';
  document.getElementById('inviteFrom').textContent = data.fromUsername + ' 邀请你';
  document.querySelector('.invite-icon').textContent = gameIcons[data.gameType] || '🎮';
  inviteModal.classList.remove('hidden');
}

// 接受邀请
inviteAccept.addEventListener('click', () => {
  if (pendingInvite) {
    socket.send(JSON.stringify({
      type: 'game_invite_accept',
      gameId: pendingInvite.gameId
    }));
    inviteModal.classList.add('hidden');
    pendingInvite = null;
  }
});

// 拒绝邀请
inviteDecline.addEventListener('click', () => {
  if (pendingInvite) {
    socket.send(JSON.stringify({
      type: 'game_invite_decline',
      gameId: pendingInvite.gameId
    }));
    inviteModal.classList.add('hidden');
    pendingInvite = null;
  }
});

// ===== 屏幕共享 =====
let localScreenStream = null;
let peerConnections = {}; // peerId → RTCPeerConnection
const screenShareVideo = document.getElementById('screenShareVideo');
const screenShareArea = document.getElementById('screenShareArea');
const screenShareName = document.getElementById('screenShareName');
const sharerListEl = document.getElementById('sharerList');
let currentSharers = {}; // id → { name }
let watchingSharerId = null; // 当前正在观看的 sharer id

document.getElementById('screenShareBtn').addEventListener('click', async () => {
  if (localScreenStream) { stopScreenShare(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    const host = window.location.host;
    const msg = '屏幕共享不可用：当前为非安全上下文（HTTP），浏览器禁止屏幕共享。\n\n解决方法：\n1. 在浏览器地址栏输入：edge://flags/#unsafely-treat-insecure-origin-as-secure\n2. 启用该选项，在输入框中添加：http://' + host + '\n3. 点击右下角"Relaunch"重启浏览器';
    document.getElementById('shareUnsupportedText').textContent = msg;
    document.getElementById('shareUnsupportedModal').classList.remove('hidden');
    return;
  }
  try {
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    document.getElementById('screenShareBtn').textContent = '⏹ 停止';
    document.getElementById('screenShareBtn').style.background = '#ff4757';
    socket.send(JSON.stringify({ type: 'screen_share_start' }));
    localScreenStream.getVideoTracks()[0].onended = () => stopScreenShare();
  } catch (e) { console.log('屏幕共享取消:', e.message); }
});

function stopScreenShare() {
  if (localScreenStream) { localScreenStream.getTracks().forEach(t => t.stop()); localScreenStream = null; }
  for (const id in peerConnections) { peerConnections[id].close(); delete peerConnections[id]; }
  document.getElementById('screenShareBtn').textContent = '📺 共享';
  document.getElementById('screenShareBtn').style.background = '';
  socket.send(JSON.stringify({ type: 'screen_share_stop' }));
}

// 关闭屏幕共享不可用弹窗
document.getElementById('shareUnsupportedClose').addEventListener('click', () => {
  document.getElementById('shareUnsupportedModal').classList.add('hidden');
});

// 收到共享者列表 → 渲染列表
function handleSharerListMsg(data) {
  const myServerId = data.yourId;
  const newSharers = {};
  data.sharers.forEach(s => {
    if (s.id != myServerId) { newSharers[s.id] = { name: s.name }; }
  });
  // 检测已停止共享的人，清理连接
  for (const id in currentSharers) {
    if (!newSharers[id]) {
      const idNum = Number(id);
      if (peerConnections[idNum]) { peerConnections[idNum].close(); delete peerConnections[idNum]; }
      if (watchingSharerId === idNum) { watchingSharerId = null; screenShareArea.classList.add('hidden'); screenShareVideo.srcObject = null; }
    }
  }
  currentSharers = newSharers;
  renderSharerList();
}

function renderSharerList() {
  const ids = Object.keys(currentSharers);
  if (ids.length === 0) { sharerListEl.classList.add('hidden'); sharerListEl.innerHTML = ''; return; }
  sharerListEl.classList.remove('hidden');
  sharerListEl.innerHTML = ids.map(id => {
    const s = currentSharers[id];
    const isWatching = watchingSharerId === id;
    return '<div class="sharer-item">' +
      '<span class="sharer-name">' + s.name + ' 正在共享屏幕</span>' +
      (isWatching
        ? '<span class="sharer-watching">正在观看</span><button class="stop-watch-btn" onclick="stopWatching()">停止观看</button>'
        : '<button onclick="startWatching(\'' + id + '\')">加入观看</button>') +
      '</div>';
  }).join('');
}

// 观看某个共享者
function startWatching(sharerId) {
  sharerId = Number(sharerId);
  if (watchingSharerId) {
    if (peerConnections[watchingSharerId]) { peerConnections[watchingSharerId].close(); delete peerConnections[watchingSharerId]; }
  }
  watchingSharerId = sharerId;
  const sharer = currentSharers[sharerId];
  if (!sharer) return;
  const pc = new RTCPeerConnection({ iceServers: [] });
  peerConnections[sharerId] = pc;
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.oniceconnectionstatechange = () => console.log('[屏幕共享] ICE状态:', pc.iceConnectionState);
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: sharerId, signal: e.candidate }));
  };
  pc.ontrack = (e) => {
    console.log('[屏幕共享] ontrack 触发, 流:', !!e.streams[0], '轨道数:', e.streams[0]?.getTracks().length);
    screenShareVideo.srcObject = e.streams[0];
    screenShareName.textContent = sharer.name + ' 的屏幕';
    screenShareArea.classList.remove('hidden');
    screenShareVideo.play().catch(() => {});
  };
  pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
    socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: sharerId, signal: pc.localDescription }));
  });
  renderSharerList();
}

// 停止观看
function stopWatching() {
  if (watchingSharerId && peerConnections[watchingSharerId]) {
    peerConnections[watchingSharerId].close();
    delete peerConnections[watchingSharerId];
  }
  watchingSharerId = null;
  screenShareArea.classList.add('hidden');
  screenShareVideo.srcObject = null;
  renderSharerList();
}

// WebRTC 信令处理
function handleWebRTCSignal(data) {
  const { fromId, fromName, signal } = data;
  if (signal.type === 'offer') {
    let pc = peerConnections[fromId];
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: [] });
      peerConnections[fromId] = pc;
      pc.oniceconnectionstatechange = () => console.log('[屏幕共享-被观看端] ICE状态:', pc.iceConnectionState, 'from:', fromName);
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: fromId, signal: e.candidate }));
      };
      pc.ontrack = (e) => {
        screenShareVideo.srcObject = e.streams[0];
        screenShareName.textContent = fromName + ' 的屏幕';
        screenShareArea.classList.remove('hidden');
        screenShareVideo.play().catch(() => {});
      };
    }
    pc.setRemoteDescription(new RTCSessionDescription(signal)).then(() => {
      if (localScreenStream) {
        localScreenStream.getTracks().forEach(t => pc.addTrack(t, localScreenStream));
      }
      return pc.createAnswer();
    })
      .then(answer => pc.setLocalDescription(answer)).then(() => {
        socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: fromId, signal: pc.localDescription }));
      });
  } else if (signal.type === 'answer') {
    const pc = peerConnections[fromId];
    if (pc) pc.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    const pc = peerConnections[fromId];
    if (pc) pc.addIceCandidate(new RTCIceCandidate(signal));
  }
}

function handleScreenShareStopMsg(data) {
  // 兼容旧的单独 stop 消息（从 share_list 也能处理）
  if (peerConnections[data.fromId]) { peerConnections[data.fromId].close(); delete peerConnections[data.fromId]; }
  if (watchingSharerId === data.fromId) { watchingSharerId = null; screenShareArea.classList.add('hidden'); screenShareVideo.srcObject = null; }
  delete currentSharers[data.fromId];
  renderSharerList();
}

// 关闭观看区域
document.getElementById('screenShareClose').addEventListener('click', stopWatching);

// 自定义全屏
document.getElementById('screenShareFullscreenBtn').addEventListener('click', () => {
  const video = document.getElementById('screenShareVideo');
  if (document.getElementById('customFullscreenOverlay')) return;
  const w = prompt('全屏窗口宽度（如 90% 或 800px）', '90%');
  if (!w) return;
  const h = prompt('全屏窗口高度（如 90% 或 600px）', '90%');
  if (!h) return;
  const overlay = document.createElement('div');
  overlay.id = 'customFullscreenOverlay';
  overlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:' + w + ';height:' + h + ';z-index:9999;background:#000;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,0.8);';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:rgba(0,0,0,0.7);color:#fff;font-size:13px;flex-shrink:0;';
  const span = document.createElement('span');
  span.textContent = screenShareName.textContent || '全屏观看';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;';
  header.appendChild(span);
  header.appendChild(closeBtn);
  overlay.appendChild(header);
  const originalParent = video.parentNode;
  const placeholder = document.createElement('div');
  placeholder.style.display = 'none';
  originalParent.insertBefore(placeholder, video);
  overlay.appendChild(video);
  video.style.cssText = 'width:100%;flex:1;display:block;background:#000;object-fit:contain;';
  const backdrop = document.createElement('div');
  backdrop.id = 'customFullscreenBackdrop';
  backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9998;';
  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);
  const restore = () => {
    placeholder.parentNode.insertBefore(video, placeholder);
    placeholder.remove();
    video.style.cssText = '';
    overlay.remove();
    backdrop.remove();
  };
  closeBtn.addEventListener('click', restore);
  backdrop.addEventListener('click', restore);
  document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { restore(); document.removeEventListener('keydown', onEsc); } });
});
