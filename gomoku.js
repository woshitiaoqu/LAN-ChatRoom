// ===== 五子棋模块 =====
(function() {
  const $ = id => document.getElementById(id);

  const module = {
    name: 'gomoku',
    gameId: null,
    myColor: null,
    lastMoveCell: null,
    endTimer: null,

    open(game) {
      this.gameId = game.id;
      const me = game.players.find(p => p.name === GameSystem.getCurrentUser());
      this.myColor = me ? me.color : null;

      document.body.classList.toggle('spectator', !this.myColor);
      $('gomokuTitle').textContent = this.myColor
        ? `五子棋 (${this.myColor === 'black' ? '⚫ 黑棋' : '⚪ 白棋'})`
        : '五子棋 (👀 观战中)';

      this.renderBoard(game.board || Array(15).fill(null).map(() => Array(15).fill(null)));
      this.updateTurn(game.currentTurn, game.winner);
      $('gomokuModal').classList.remove('hidden');
    },

    close() {
      if (this.endTimer) { clearInterval(this.endTimer); this.endTimer = null; }
      $('gomokuModal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null;
      this.myColor = null;
      this.lastMoveCell = null;
      $('gomokuChatMessages').innerHTML = '';
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    renderBoard(board) {
      const container = $('gomokuBoard');
      container.innerHTML = '';
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          const cell = document.createElement('div');
          cell.className = 'gomoku-cell';
          if (board[r][c]) cell.classList.add(board[r][c]);
          cell.addEventListener('click', () => this.onClick(r, c));
          container.appendChild(cell);
        }
      }
    },

    onClick(row, col) {
      if (!this.gameId || !this.myColor) return;
      GameSystem.getSocket().send(JSON.stringify({
        type: 'game_move', gameId: this.gameId, row, col
      }));
    },

    handleMove(data) {
      const { move, currentTurn, winner } = data;
      const cells = document.querySelectorAll('.gomoku-cell');
      const cell = cells[move.row * 15 + move.col];
      if (cell) {
        cell.classList.add(move.color);
        if (this.lastMoveCell) this.lastMoveCell.classList.remove('last-move');
        cell.classList.add('last-move');
        this.lastMoveCell = cell;
      }
      this.updateTurn(currentTurn, winner);
    },

    updateTurn(currentTurn, winnerName) {
      const el = $('gomokuTurn');
      if (this.endTimer) { clearInterval(this.endTimer); this.endTimer = null; }
      if (winnerName) {
        el.textContent = '游戏结束';
        el.style.color = '#e91e63';
        const me = GameSystem.getCurrentUser();
        const isMe = this.myColor && (winnerName === me);
        alert(this.myColor
          ? (isMe ? '🎉 你赢了！' : '😢 你输了')
          : `🎉 ${winnerName} 获胜！`);
        let count = 5;
        this.endTimer = setInterval(() => {
          if (--count <= 0) { clearInterval(this.endTimer); this.endTimer = null; this.close(); }
        }, 1000);
      } else if (this.myColor) {
        const myTurn = currentTurn === this.myColor;
        el.textContent = myTurn ? '轮到你了' : '等待对手...';
        el.style.color = myTurn ? '#4caf50' : '#999';
      } else {
        el.textContent = currentTurn === 'black' ? '⚫ 黑棋落子中...' : '⚪ 白棋落子中...';
        el.style.color = '#666';
      }
    },

    handleChat(data) {
      const container = $('gomokuChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;

      const layer = $('danmakuLayer');
      if (!layer) return;
      const d = document.createElement('div');
      d.className = 'danmaku-item';
      d.textContent = `${data.username}: ${data.content}`;
      d.style.color = ['#fff','#ff0','#0ff','#f90','#f0f','#0f0'][Math.floor(Math.random()*6)];
      d.style.top = (10 + Math.random() * 70) + '%';
      d.style.animationDuration = (8 + Math.random() * 4) + 's';
      layer.appendChild(d);
      d.addEventListener('animationend', () => d.remove());
    },

    handleSpectatorCount(data) {
      $('gomokuSpectators').textContent = `观战: ${data.count}人`;
    },

    handleGameOver(data) {
      setTimeout(() => this.close(), 2000);
    },

    onGameCreated(game) {
      this.gameId = game.id;
    }
  };

  // 关闭按钮
  $('gomokuClose').addEventListener('click', () => {
    if (module.gameId) {
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    }
    module.close();
  });

  // 聊天
  $('gomokuChatSend').addEventListener('click', sendChat);
  $('gomokuChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

  function sendChat() {
    const input = $('gomokuChatInput');
    const content = input.value.trim();
    if (content && module.gameId) {
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content }));
      input.value = '';
    }
  }

  GameSystem.register('gomoku', module);
})();
