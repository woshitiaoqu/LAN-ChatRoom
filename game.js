// ===== 初始化 =====
let currentUser = localStorage.getItem('chatUsername');
if (!currentUser || !currentUser.trim()) {
  window.location.href = 'index.html';
}

let clientId = localStorage.getItem('chatClientId');
if (!clientId) {
  clientId = 'user_' + Math.random().toString(36).substr(2, 8);
  localStorage.setItem('chatClientId', clientId);
}

// ===== DOM 引用 =====
const loadingTip = document.getElementById('loadingTip');
const gameLobby = document.getElementById('gameLobby');
const activeGamesEl = document.getElementById('activeGames');
const playerListEl = document.getElementById('playerList');
const createGameBtn = document.getElementById('createGameBtn');
const inviteModal = document.getElementById('inviteModal');
const inviteAccept = document.getElementById('inviteAccept');
const inviteDecline = document.getElementById('inviteDecline');
const inviteText = document.getElementById('inviteText');
const inviteFrom = document.getElementById('inviteFrom');
const iframeModal = document.getElementById('iframeGameModal');
const iframeFrame = document.getElementById('iframeGameFrame');
const iframeTitle = document.getElementById('iframeGameTitle');
const iframeClose = document.getElementById('iframeGameClose');

// 单机游戏配置 { gameName: { title, url } }
const singlePlayerGames = {
  '2048': { title: '🎲 2048', url: 'games/2048/' },
  airplane: { title: '✈️ 飞机大战', url: 'games/airplane/' },
  'bubble-pop': { title: '🫧 打泡泡', url: 'games/bubble-pop/' },
  'emoji-match': { title: '😊 Emoji连连看', url: 'games/emoji-match/' },
  'flappy-bird': { title: '🐤 Flappy Bird', url: 'games/flappy-bird/' },
  'flappy-parkour': { title: '🏃 Flappy跑酷', url: 'games/flappy-parkour/' },
  jump: { title: '🦘 跳一跳', url: 'games/jump/' },
  'math-challenge': { title: '🧮 数学挑战', url: 'games/math-challenge/' },
  maze: { title: '🌀 迷宫', url: 'games/maze/' },
  parkour: { title: '🏄 跑酷', url: 'games/parkour/' },
  'reaction-test': { title: '⚡ 反应测试', url: 'games/reaction-test/' },
  'rhythm-tap': { title: '🎵 节奏敲击', url: 'games/rhythm-tap/' },
  snake: { title: '🐍 贪吃蛇', url: 'games/snake/' },
  'speed-tetris': { title: '⚡ 极速俄罗斯', url: 'games/speed-tetris/' },
  tetris: { title: '🧱 俄罗斯方块', url: 'games/tetris/' },
  'typing-master': { title: '⌨️ 打字大师', url: 'games/typing-master/' },
  'whack-mole': { title: '🔨 打地鼠', url: 'games/whack-mole/' },

};

// ===== 状态 =====
let socket;
let selectedGameType = null;
let pendingInvite = null;
let currentModule = null;
let moduleModals = []; // modals added by modules

// ===== 模块系统 =====
const modules = {};

function registerModule(name, mod) {
  modules[name] = mod;
}

function activateModule(name) {
  if (currentModule && currentModule.name !== name) {
    currentModule.close();
    clearModuleModals();
  }
  currentModule = modules[name];
  if (!currentModule) {
    console.error('模块未找到:', name);
    return null;
  }
  return currentModule;
}

function clearModuleModals() {
  moduleModals.forEach(m => m.remove());
  moduleModals = [];
}

// ===== WebSocket =====
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname === 'localhost'
    ? window.location.hostname
    : window.location.hostname.split(':')[0];
  const port = window.location.port || (protocol === 'wss:' ? 443 : 8082);
  socket = new WebSocket(`${protocol}//${host}:${port}`);

  socket.onopen = () => {
    const regMsg = JSON.stringify({ type: 'register', username: currentUser, clientId });
    socket.send(regMsg);
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(regMsg);
    }, 1000);
    loadingTip.classList.add('hidden');
    gameLobby.classList.remove('hidden');
    refreshLobby();
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'force_logout':
        alert(data.reason || '请重新登录');
        localStorage.removeItem('chatUsername');
        localStorage.removeItem('chatClientId');
        window.location.href = 'index.html';
        break;
      case 'game_list':
        renderActiveGames(data.games);
        break;
      case 'game_players':
        renderPlayerList(data.players);
        break;
      case 'game_created':
        if (currentModule) currentModule.onGameCreated(data.game);
        break;
      case 'game_start':
        gameLobby.classList.add('hidden');
        const mod = activateModule(data.game.type);
        if (mod) mod.open(data.game);
        break;
      case 'game_moved':
        if (currentModule) currentModule.handleMove(data);
        break;
      case 'game_chat':
        if (currentModule) currentModule.handleChat(data);
        break;
      case 'game_spectator_count':
        if (currentModule) currentModule.handleSpectatorCount(data);
        break;
      case 'game_over':
        if (currentModule) currentModule.handleGameOver(data);
        break;
      case 'game_error':
        alert(data.error);
        gameLobby.classList.remove('hidden');
        break;
      case 'game_left':
        if (currentModule) currentModule.close();
        gameLobby.classList.remove('hidden');
        refreshLobby();
        break;
      case 'game_invite_received':
        showInviteModal(data);
        break;
      case 'rps_choice_made':
        if (currentModule) currentModule.handleChoiceMade(data);
        break;
      case 'rps_result':
        if (currentModule) currentModule.handleRpsResult(data);
        break;
      case 'game_invite_sent':
        alert('邀请已发送，等待 ' + data.targetUsername + ' 响应...');
        break;
      case 'game_invite_declined':
        alert(data.targetUsername + ' 拒绝了你的邀请');
        break;
    }
  };

  socket.onclose = (event) => {
    if (event.code === 4002 || event.code === 4003) {
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatClientId');
      alert(event.reason || '请重新登录');
      window.location.href = 'index.html';
      return;
    }
    loadingTip.textContent = '连接已断开，正在重连...';
    loadingTip.classList.remove('hidden');
    gameLobby.classList.add('hidden');
    setTimeout(connectWebSocket, 2000);
  };

  socket.onerror = () => {
    socket.close();
  };
}

// ===== 游戏大厅 =====
function refreshLobby() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'game_list' }));
    socket.send(JSON.stringify({ type: 'game_players' }));
  }
}

document.querySelectorAll('.game-card').forEach(card => {
  card.addEventListener('click', () => {
    const mode = card.dataset.mode;
    if (mode === 'single') {
      const game = card.dataset.game;
      const info = singlePlayerGames[game];
      if (info) {
        iframeTitle.textContent = info.title;
        iframeFrame.src = info.url;
        iframeModal.classList.remove('hidden');
        gameLobby.classList.add('hidden');
      }
      return;
    }
    // 联机游戏
    document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedGameType = card.dataset.game;
  });
});

iframeClose.addEventListener('click', closeIframeGame);
function closeIframeGame() {
  iframeFrame.src = '';
  iframeModal.classList.add('hidden');
  gameLobby.classList.remove('hidden');
}

createGameBtn.addEventListener('click', () => {
  if (!selectedGameType) { alert('请先选择游戏类型'); return; }
  socket.send(JSON.stringify({ type: 'game_create', gameType: selectedGameType }));
});

function renderActiveGames(games) {
  const others = (games || []).filter(g => !g.players.includes(currentUser));
  if (others.length === 0) {
    activeGamesEl.innerHTML = '<p class="empty-tip">暂无进行中的游戏</p>';
    return;
  }
  const gameNames = { gomoku: '⚫ 五子棋', tictactoe: '⭕ 井字棋', rps: '✂️ 石头剪刀布' };
  activeGamesEl.innerHTML = others.map(g => {
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
        ${g.status === 'waiting' ? `<button class="game-btn-join" onclick="sendGameMsg('join','${g.id}')">加入</button>` : `<button class="game-btn-spectate" onclick="sendGameMsg('spectate','${g.id}')">观战</button>`}
      </div>
    </div>`;
  }).join('');
}

function renderPlayerList(players) {
  const others = (players || []).filter(p => p.username !== currentUser);
  if (others.length === 0) {
    playerListEl.innerHTML = '<p class="empty-tip">暂无在线用户</p>';
    return;
  }
  playerListEl.innerHTML = others.map(p => `
    <div class="player-item">
      <span class="name">${p.username}</span>
      <button class="game-btn-invite" onclick="invitePlayer('${p.username}')">邀请对战</button>
    </div>
  `).join('');
}

// ===== 全局辅助（供 HTML onclick 调用） =====
function sendGameMsg(action, gameId) {
  const map = { join: 'game_join', spectate: 'game_spectate' };
  socket.send(JSON.stringify({ type: map[action], gameId }));
}

function invitePlayer(username) {
  if (!selectedGameType) { alert('请先选择游戏类型'); return; }
  socket.send(JSON.stringify({
    type: 'game_invite',
    gameType: selectedGameType,
    targetUsername: username
  }));
  gameLobby.classList.add('hidden');
}

// ===== 邀请系统 =====
function showInviteModal(data) {
  pendingInvite = data;
  const gameNames = { gomoku: '五子棋', tictactoe: '井字棋', rps: '石头剪刀布' };
  const gameIcons = { gomoku: '⚫', tictactoe: '⭕', rps: '✂️' };
  inviteText.textContent = (gameNames[data.gameType] || data.gameType) + '对战！';
  inviteFrom.textContent = data.fromUsername + ' 邀请你';
  document.querySelector('.invite-icon').textContent = gameIcons[data.gameType] || '🎮';
  inviteModal.classList.remove('hidden');
}

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

// ===== 导出供模块使用 =====
window.GameSystem = {
  register: registerModule,
  getSocket: () => socket,
  getCurrentUser: () => currentUser,
  getLobbyEl: () => gameLobby,
  addModal: (el) => { moduleModals.push(el); },
  removeModals: clearModuleModals,
  refreshLobby
};

// ===== 启动 =====
connectWebSocket();

setInterval(() => {
  if (currentModule) return;
  refreshLobby();
}, 5000);
