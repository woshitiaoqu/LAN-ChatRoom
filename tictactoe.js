// ===== 井字棋模块 =====
(function() {
  const $ = id => document.getElementById(id);

  const module = {
    name: 'tictactoe',
    gameId: null,
    myColor: null,
    lastCell: null,

    open(game) {
      this.gameId = game.id;
      const me = game.players.find(p => p.name === GameSystem.getCurrentUser());
      this.myColor = me ? me.color : null;

      document.body.classList.toggle('spectator', !this.myColor);
      $('tttTitle').textContent = this.myColor
        ? `井字棋 (${this.myColor === 'x' ? '✖️' : '⭕'})`
        : '井字棋 (👀 观战中)';

      this.renderBoard(game.board || Array(3).fill(null).map(() => Array(3).fill(null)));
      this.updateStatus(game.currentTurn, game.winner);
      $('tttModal').classList.remove('hidden');
    },

    close() {
      $('tttModal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null;
      this.myColor = null;
      this.lastCell = null;
      $('tttChatMessages').innerHTML = '';
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    renderBoard(board) {
      const container = $('tttBoard');
      container.innerHTML = '';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const cell = document.createElement('div');
          cell.className = 'ttt-cell';
          cell.dataset.row = r;
          cell.dataset.col = c;
          if (board[r][c]) {
            cell.classList.add('placed');
            cell.textContent = board[r][c] === 'x' ? '✖' : '⭕';
          }
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
      const cells = $('tttBoard').children;
      const idx = move.row * 3 + move.col;
      const cell = cells[idx];
      if (cell && !cell.classList.contains('placed')) {
        cell.classList.add('placed');
        cell.textContent = move.color === 'x' ? '✖' : '⭕';
      }
      if (this.lastCell) this.lastCell.classList.remove('last-move');
      cell.classList.add('last-move');
      this.lastCell = cell;
      this.updateStatus(currentTurn, winner);
    },

    updateStatus(currentTurn, winnerName) {
      const el = $('tttStatus');
      if (winnerName) {
        el.textContent = '游戏结束';
        el.style.color = '#e91e63';
        const me = GameSystem.getCurrentUser();
        const isMe = this.myColor && (winnerName === me);
        alert(this.myColor
          ? (isMe ? '🎉 你赢了！' : '😢 你输了')
          : (winnerName === '平局' ? '平局！' : `🎉 ${winnerName} 获胜！`));
      } else if (this.myColor) {
        const myTurn = currentTurn === this.myColor;
        el.textContent = myTurn ? '轮到你了' : '等待对手...';
        el.style.color = myTurn ? '#4caf50' : '#999';
      } else {
        el.textContent = currentTurn === 'x' ? '✖️ X落子中...' : '⭕ O落子中...';
        el.style.color = '#666';
      }
    },

    handleChat(data) {
      const container = $('tttChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    },

    handleSpectatorCount(data) {
      $('tttSpectators').textContent = `观战: ${data.count}人`;
    },

    handleGameOver(data) {
      setTimeout(() => this.close(), 2000);
    },

    onGameCreated(game) {
      this.gameId = game.id;
    }
  };

  // 关闭按钮
  $('tttClose').addEventListener('click', () => {
    if (module.gameId) {
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    }
    module.close();
  });

  // 聊天
  $('tttChatSend').addEventListener('click', sendChat);
  $('tttChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

  function sendChat() {
    const input = $('tttChatInput');
    const content = input.value.trim();
    if (content && module.gameId) {
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content }));
      input.value = '';
    }
  }

  GameSystem.register('tictactoe', module);
})();
