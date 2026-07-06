(function() {
  const $ = id => document.getElementById(id);

  const module = {
    name: 'connect4',
    gameId: null,
    myColor: null,

    open(game) {
      this.gameId = game.id;
      const me = game.players.find(p => p.name === GameSystem.getCurrentUser());
      this.myColor = me ? me.color : null;
      document.body.classList.toggle('spectator', !this.myColor);
      $('c4Title').textContent = this.myColor ? `四子棋 (${this.myColor === 'red' ? '🔴' : '🟡'})` : '四子棋 (👀 观战中)';
      this.renderBoard(game.board || Array(6).fill(null).map(() => Array(7).fill(null)));
      this.updateStatus(game.currentTurn, game.winner);
      $('c4Modal').classList.remove('hidden');
    },

    close() {
      $('c4Modal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null; this.myColor = null;
      $('c4ChatMessages').innerHTML = '';
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    renderBoard(board) {
      const container = $('c4Board');
      container.innerHTML = '';
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          const cell = document.createElement('div');
          cell.className = 'c4-cell';
          cell.dataset.col = c;
          const val = board[r][c];
          if (val) { cell.classList.add('placed', val); cell.textContent = val === 'red' ? '🔴' : '🟡'; }
          if (r === 0) {
            cell.addEventListener('click', () => this.onClick(c));
            if (!val) cell.classList.add('drop-zone');
          }
          container.appendChild(cell);
        }
      }
    },

    onClick(col) {
      if (!this.gameId || !this.myColor) return;
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_move', gameId: this.gameId, row: col, col: 0 }));
    },

    handleMove(data) {
      const { move, currentTurn, winner, board } = data;
      if (board) { this.renderBoard(board); }
      this.updateStatus(currentTurn, winner);
    },

    updateStatus(currentTurn, winnerName) {
      const el = $('c4Status');
      if (winnerName) {
        el.textContent = '游戏结束'; el.style.color = '#e91e63';
        const me = GameSystem.getCurrentUser();
        alert(this.myColor ? (winnerName === me ? '🎉 你赢了！' : '😢 你输了') : (winnerName === '平局' ? '平局！' : `🎉 ${winnerName} 获胜！`));
      } else if (this.myColor) {
        const myTurn = currentTurn === this.myColor;
        el.textContent = myTurn ? '轮到你了' : '等待对手...';
        el.style.color = myTurn ? '#4caf50' : '#999';
      } else {
        el.textContent = currentTurn === 'red' ? '🔴 红方落子中...' : '🟡 黄方落子中...';
        el.style.color = '#666';
      }
    },

    handleChat(data) {
      const container = $('c4ChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    },

    handleSpectatorCount(data) { $('c4Spectators').textContent = `观战: ${data.count}人`; },
    handleGameOver(data) { setTimeout(() => this.close(), 2000); },
    onGameCreated(game) { this.gameId = game.id; }
  };

  $('c4Close').addEventListener('click', () => {
    if (module.gameId) GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    module.close();
  });
  $('c4ChatSend').addEventListener('click', sendChat);
  $('c4ChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });
  function sendChat() {
    const input = $('c4ChatInput');
    const content = input.value.trim();
    if (content && module.gameId) { GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content })); input.value = ''; }
  }

  GameSystem.register('connect4', module);
})();
