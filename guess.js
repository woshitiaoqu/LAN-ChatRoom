(function() {
  const $ = id => document.getElementById(id);

  const module = {
    name: 'guess',
    gameId: null,
    myId: null,
    myName: null,
    chosen: null,

    open(game) {
      this.gameId = game.id;
      this.myName = GameSystem.getCurrentUser();
      const me = game.players.find(p => p.name === this.myName);
      this.myId = me ? me.id : null;
      this.chosen = null;
      document.body.classList.toggle('spectator', !this.myId);
      $('guessTitle').textContent = this.myId ? '🔢 猜数字' : '🔢 猜数字 (👀 观战中)';
      $('guessRound').textContent = '第 1 轮 / 共 5 轮';
      $('guessScores').textContent = '';
      $('guessResultArea').className = 'guess-result hidden';
      $('guessResultArea').innerHTML = '';
      $('guessTargetHint').textContent = '';
      this.renderInput();
      this.setStatus(this.myId ? '请输入1-100的数字' : '👀 观战中');
      $('guessModal').classList.remove('hidden');
    },

    close() {
      $('guessModal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null; this.myId = null; this.chosen = null;
      $('guessChatMessages').innerHTML = '';
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    renderInput() {
      const container = $('guessInputArea');
      container.innerHTML = '';
      if (!this.myId) return;
      const input = document.createElement('input');
      input.type = 'number'; input.min = 1; input.max = 100;
      input.id = 'guessNumberInput';
      input.placeholder = '输入1-100';
      input.className = 'guess-input';
      const btn = document.createElement('button');
      btn.textContent = '提交';
      btn.className = 'guess-submit';
      btn.addEventListener('click', () => this.submitGuess());
      input.addEventListener('keypress', e => { if (e.key === 'Enter') this.submitGuess(); });
      container.appendChild(input);
      container.appendChild(btn);
    },

    submitGuess() {
      const input = $('guessNumberInput');
      const num = parseInt(input.value);
      if (!this.myId || this.chosen) return;
      if (isNaN(num) || num < 1 || num > 100) { alert('请输入1-100的整数'); return; }
      this.chosen = num;
      input.disabled = true;
      this.setStatus('等待对手选择...');
      GameSystem.getSocket().send(JSON.stringify({ type: 'guess_choice', gameId: this.gameId, number: num }));
    },

    setStatus(text) { $('guessStatus').textContent = text; },

    handleChoiceMade(data) {
      if (data.playerId !== this.myId) this.setStatus('对手已选择，等待你...');
    },

    handleGuessResult(data) {
      $('guessRound').textContent = `第 ${data.round} 轮 / 共 5 轮`;
      $('guessTargetHint').textContent = `🎯 目标数字: ${data.target}`;

      const area = $('guessResultArea');
      area.className = 'guess-result';
      const p1name = this.myName || '玩家1';
      const p2name = '对手';
      area.innerHTML = `
        <div class="guess-round-result ${data.roundWinner === '平局' ? 'guess-draw' : (data.roundWinner === this.myName ? 'guess-win' : 'guess-lose')}">
          <div>你选了: <strong>${data.choices.p1}</strong> (差 ${Math.abs(data.choices.p1 - data.target)})</div>
          <div>对手选了: <strong>${data.choices.p2}</strong> (差 ${Math.abs(data.choices.p2 - data.target)})</div>
          <div class="guess-round-winner">${data.roundWinner === '平局' ? '🤝 平局' : (data.roundWinner === this.myName ? '🎉 你赢了此轮' : `😢 ${data.roundWinner} 赢了此轮`)}</div>
          <div class="guess-scores">比分: ${data.scores.p1} : ${data.scores.p2}</div>
        </div>
      `;
      $('guessScores').textContent = `比分: ${data.scores.p1} : ${data.scores.p2}`;

      if (data.isOver) {
        setTimeout(() => {
          alert(data.finalWinner === '平局' ? '🤝 最终平局！' : (data.finalWinner === this.myName ? '🎉 你赢得了比赛！' : `😢 ${data.finalWinner} 赢得了比赛`));
          this.close();
        }, 2000);
      } else {
        this.chosen = null;
        const input = $('guessNumberInput');
        if (input) { input.disabled = false; input.value = ''; input.focus(); }
        this.setStatus('下一轮，请输入数字');
      }
    },

    handleChat(data) {
      const container = $('guessChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    },

    handleSpectatorCount(data) { $('guessSpectators').textContent = `观战: ${data.count}人`; },
    handleGameOver(data) { setTimeout(() => this.close(), 2000); },
    onGameCreated(game) { this.gameId = game.id; }
  };

  $('guessClose').addEventListener('click', () => {
    if (module.gameId) GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    module.close();
  });
  $('guessChatSend').addEventListener('click', sendChat);
  $('guessChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });
  function sendChat() {
    const input = $('guessChatInput');
    const content = input.value.trim();
    if (content && module.gameId) { GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content })); input.value = ''; }
  }

  GameSystem.register('guess', module);
})();
