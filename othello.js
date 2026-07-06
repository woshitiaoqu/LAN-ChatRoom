(function() {
  const $ = id => document.getElementById(id);

  const module = {
    name: 'othello',
    gameId: null,
    myColor: null,

    open(game) {
      this.gameId = game.id;
      const me = game.players.find(p => p.name === GameSystem.getCurrentUser());
      this.myColor = me ? me.color : null;
      this.lastBoard = game.board || this.emptyBoard();
      document.body.classList.toggle('spectator', !this.myColor);
      $('othTitle').textContent = this.myColor ? `黑白棋 (${this.myColor === 'black' ? '⚫' : '⚪'})` : '黑白棋 (👀 观战中)';
      this.renderBoard(this.lastBoard);
      this.updateStatus(game.currentTurn, game.winner);
      $('othModal').classList.remove('hidden');
    },

    close() {
      $('othModal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null; this.myColor = null; this.lastBoard = null;
      $('othChatMessages').innerHTML = '';
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    emptyBoard() {
      const b = Array(8).fill(null).map(() => Array(8).fill(null));
      b[3][3] = 'white'; b[3][4] = 'black'; b[4][3] = 'black'; b[4][4] = 'white';
      return b;
    },

    renderBoard(board) {
      const container = $('othBoard');
      container.innerHTML = '';
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const cell = document.createElement('div');
          cell.className = 'oth-cell';
          cell.dataset.row = r; cell.dataset.col = c;
          const val = board[r][c];
          if (val) {
            cell.classList.add('placed', val);
            cell.textContent = val === 'black' ? '⚫' : '⚪';
          }
          cell.addEventListener('click', () => this.onClick(r, c));
          container.appendChild(cell);
        }
      }
    },

    onClick(row, col) {
      if (!this.gameId || !this.myColor) return;
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_move', gameId: this.gameId, row, col }));
    },

    handleMove(data) {
      const { move, currentTurn, winner, board } = data;
      if (board) { this.lastBoard = board; this.renderBoard(board); }
      else { this.renderBoard(this.lastBoard || this.emptyBoard()); }
      this.updateStatus(currentTurn, winner);
    },

    updateStatus(currentTurn, winnerName) {
      const el = $('othStatus');
      if (winnerName) {
        el.textContent = '游戏结束'; el.style.color = '#e91e63';
        const me = GameSystem.getCurrentUser();
        alert(this.myColor ? (winnerName === me ? '🎉 你赢了！' : '😢 你输了') : (winnerName === '平局' ? '平局！' : `🎉 ${winnerName} 获胜！`));
      } else if (this.myColor) {
        const myTurn = currentTurn === this.myColor;
        el.textContent = myTurn ? '轮到你了' : '等待对手...';
        el.style.color = myTurn ? '#4caf50' : '#999';
      } else {
        el.textContent = currentTurn === 'black' ? '⚫ 黑方落子中...' : '⚪ 白方落子中...';
        el.style.color = '#666';
      }
    },

    handleChat(data) {
      const container = $('othChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    },

    handleSpectatorCount(data) { $('othSpectators').textContent = `观战: ${data.count}人`; },
    handleGameOver(data) { setTimeout(() => this.close(), 2000); },
    onGameCreated(game) { this.gameId = game.id; }
  };

  $('othClose').addEventListener('click', () => {
    if (module.gameId) GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    module.close();
  });
  $('othChatSend').addEventListener('click', sendChat);
  $('othChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });
  function sendChat() {
    const input = $('othChatInput');
    const content = input.value.trim();
    if (content && module.gameId) { GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content })); input.value = ''; }
  }

  GameSystem.register('othello', module);
})();
