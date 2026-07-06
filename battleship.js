(function() {
  const $ = id => document.getElementById(id);

  const module = {
    name: 'battleship',
    gameId: null,
    myId: null,
    myName: null,
    phase: null,
    placingIndex: 0,
    shipsToPlace: null,

    open(game) {
      this.gameId = game.id;
      this.myName = GameSystem.getCurrentUser();
      const me = game.players.find(p => p.name === this.myName);
      this.myId = me ? me.id : null;
      this.playerIdx = this.myId ? game.players.findIndex(p => p.id === this.myId) : -1;
      this.phase = 'placing';
      this.placingIndex = 0;
      this.shipsToPlace = [2, 2, 3];
      this.myBoard = Array(6).fill(null).map(() => Array(6).fill(null));
      this.attackBoard = Array(6).fill(null).map(() => Array(6).fill(null));
      document.body.classList.toggle('spectator', !this.myId);
      $('bsTitle').textContent = this.myId ? '🚢 海战棋' : '🚢 海战棋 (👀 观战中)';
      $('bsPhase').textContent = '布置船只...';
      $('bsEnemyLabel').textContent = '敌方海域';
      this.renderMyBoard(null);
      this.renderEnemyBoard(null);
      this.setStatus(this.myId ? '点击你的棋盘布置船只' : '👀 等待双方布置...');
      $('bsModal').classList.remove('hidden');
      if (this.myId) this.showPlacementUI();
    },

    close() {
      $('bsModal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null; this.myId = null; this.phase = null; this.playerIdx = -1;
      this.myBoard = null; this.attackBoard = null;
      $('bsPlacementUI').classList.add('hidden');
      $('bsChatMessages').innerHTML = '';
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    showPlacementUI() {
      const ui = $('bsPlacementUI');
      ui.classList.remove('hidden');
      const len = this.shipsToPlace[this.placingIndex] || 0;
      ui.innerHTML = `
        <div class="bs-placement-info">布置船只 ${this.placingIndex + 1}/3 (长度: ${len})</div>
        <div class="bs-placement-options">
          <label><input type="radio" name="bsDir" value="h" checked> 横向</label>
          <label><input type="radio" name="bsDir" value="v"> 纵向</label>
        </div>
        <button class="bs-place-btn" onclick="document.querySelector('.bs-my-board').classList.add('placing')">点击棋盘放置</button>
      `;
    },

    renderMyBoard(board) {
      const container = $('bsMyBoard');
      container.innerHTML = '';
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          const cell = document.createElement('div');
          cell.className = 'bs-cell bs-my-cell';
          cell.dataset.row = r; cell.dataset.col = c;
          if (board && board[r][c]) {
            cell.classList.add(board[r][c] === 'ship' ? 'bs-ship' : 'bs-hit');
            if (board[r][c] === 'hit') cell.textContent = '💥';
          }
          if (this.myId && this.phase === 'placing') {
            cell.addEventListener('click', () => this.placeShip(r, c));
          }
          container.appendChild(cell);
        }
      }
    },

    renderEnemyBoard(board) {
      const container = $('bsEnemyBoard');
      container.innerHTML = '';
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          const cell = document.createElement('div');
          cell.className = 'bs-cell bs-enemy-cell';
          cell.dataset.row = r; cell.dataset.col = c;
          if (board && board[r] && board[r][c]) {
            cell.classList.add(board[r][c] === 'hit' ? 'bs-hit' : 'bs-miss');
            cell.textContent = board[r][c] === 'hit' ? '💥' : '·';
          }
          if (this.myId && this.phase === 'playing') {
            cell.addEventListener('click', () => this.attack(r, c));
          }
          container.appendChild(cell);
        }
      }
    },

    placeShip(row, col) {
      if (!this.myId || this.phase !== 'placing') return;
      if (this.placingIndex >= this.shipsToPlace.length) return;
      const dir = document.querySelector('input[name="bsDir"]:checked')?.value || 'h';
      const len = this.shipsToPlace[this.placingIndex];
      for (let i = 0; i < len; i++) {
        const r = dir === 'h' ? row : row + i;
        const c = dir === 'h' ? col + i : col;
        if (r < 6 && c < 6) this.myBoard[r][c] = 'ship';
      }
      this.renderMyBoard(this.myBoard);
      GameSystem.getSocket().send(JSON.stringify({
        type: 'battleship_place', gameId: this.gameId,
        row, col, dir, length: len
      }));
    },

    attack(row, col) {
      if (!this.myId || this.phase !== 'playing') return;
      GameSystem.getSocket().send(JSON.stringify({
        type: 'battleship_attack', gameId: this.gameId, row, col
      }));
    },

    handleBattleshipPlaced(data) {
      this.placingIndex++;
      if (this.placingIndex >= this.shipsToPlace.length) {
        $('bsPhase').textContent = '等待对手布置...';
        this.setStatus('等待对手完成布置');
        $('bsPlacementUI').classList.add('hidden');
      } else {
        this.showPlacementUI();
      }
    },

    handleBattleshipStart(data) {
      this.phase = 'playing';
      $('bsPhase').textContent = '战斗开始！';
      $('bsPlacementUI').classList.add('hidden');
      this.renderMyBoard(this.myBoard);
      this.renderEnemyBoard(this.attackBoard);
      const myTurn = data.currentTurn === this.myId;
      this.setStatus(myTurn ? '点击敌方海域攻击' : '等待对手...');
    },

    handleBattleshipResult(data) {
      const myKey = 'p' + (this.playerIdx + 1);
      if (data.attacker === myKey) {
        this.attackBoard[data.row][data.col] = data.hit ? 'hit' : 'miss';
        this.renderEnemyBoard(this.attackBoard);
      } else {
        this.myBoard[data.row][data.col] = data.hit ? 'hit' : 'miss';
        this.renderMyBoard(this.myBoard);
      }
      if (data.currentTurn) {
        this.setStatus(data.currentTurn === this.myId ? '点击敌方海域攻击' : '等待对手...');
      }
      if (data.allSunk) {
        $('bsPhase').textContent = '游戏结束';
        this.setStatus(`🎉 ${data.winnerName} 获胜！`);
        setTimeout(() => this.close(), 3000);
      }
    },

    setStatus(text) { $('bsStatus').textContent = text; },

    handleChat(data) {
      const container = $('bsChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    },

    handleSpectatorCount(data) { $('bsSpectators').textContent = `观战: ${data.count}人`; },
    handleGameOver(data) { setTimeout(() => this.close(), 2000); },
    onGameCreated(game) { this.gameId = game.id; }
  };

  $('bsClose').addEventListener('click', () => {
    if (module.gameId) GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    module.close();
  });
  $('bsChatSend').addEventListener('click', sendChat);
  $('bsChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });
  function sendChat() {
    const input = $('bsChatInput');
    const content = input.value.trim();
    if (content && module.gameId) { GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content })); input.value = ''; }
  }

  GameSystem.register('battleship', module);
})();
