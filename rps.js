// ===== 石头剪刀布模块 =====
(function() {
  const $ = id => document.getElementById(id);

  const CND = ['rock', 'paper', 'scissors'];
  const ICONS = { rock: '✊', paper: '✋', scissors: '✌️' };
  const NAMES = { rock: '石头', paper: '布', scissors: '剪刀' };

  const module = {
    name: 'rps',
    gameId: null,
    myId: null,
    myName: null,
    myChoice: null,
    opponentName: null,
    round: 0,

    open(game) {
      this.gameId = game.id;
      this.myName = GameSystem.getCurrentUser();
      this.myId = null;
      this.round = 0;

      const me = game.players.find(p => p.name === this.myName);
      this.myId = me ? me.id : null;
      this.opponentName = game.players.find(p => p.id !== this.myId)?.name || '对手';

      document.body.classList.toggle('spectator', !this.myId);
      $('rpsRound').textContent = '';
      $('rpsResult').textContent = '';
      $('rpsResult').className = 'rps-result';
      this.renderChoices();
      this.setStatus(this.myId ? '请做出选择' : '👀 观战中');
      $('rpsModal').classList.remove('hidden');
    },

    close() {
      $('rpsModal').classList.add('hidden');
      document.body.classList.remove('spectator');
      this.gameId = null;
      this.myId = null;
      this.myChoice = null;
      GameSystem.getLobbyEl().classList.remove('hidden');
      GameSystem.refreshLobby();
    },

    renderChoices() {
      const container = $('rpsChoices');
      container.innerHTML = '';
      CND.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'rps-choice-btn';
        btn.dataset.choice = c;
        btn.innerHTML = `<div style="font-size:40px;margin-bottom:4px;">${ICONS[c]}</div><div>${NAMES[c]}</div>`;
        btn.addEventListener('click', () => this.choose(c));
        container.appendChild(btn);
      });
    },

    choose(choice) {
      if (!this.myId || this.myChoice) return;
      this.myChoice = choice;
      document.querySelectorAll('.rps-choice-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.choice === choice);
      });
      this.setStatus('等待对手选择...');
      GameSystem.getSocket().send(JSON.stringify({
        type: 'rps_choice',
        gameId: this.gameId,
        choice
      }));
    },

    setStatus(text) {
      $('rpsStatus').textContent = text;
    },

    handleChoiceMade(data) {
      if (data.playerId !== this.myId) {
        this.setStatus('对手已选择，等待你...');
      }
    },

    handleRpsResult(data) {
      this.round++;
      $('rpsRound').textContent = `第 ${this.round} 轮`;

      // 显示双方选择
      const p1 = document.querySelector('.rps-my-choice');
      const p2 = document.querySelector('.rps-opponent-choice');
      if (this.myId) {
        const myChoiceObj = Object.entries(data.choices).find(([id]) => Number(id) === this.myId);
        const oppChoiceObj = Object.entries(data.choices).find(([id]) => Number(id) !== this.myId);
        if (myChoiceObj) {
          p1.innerHTML = `<div style="font-size:14px;color:#999;">你</div><div style="font-size:36px;">${ICONS[myChoiceObj[1]]}</div><div>${NAMES[myChoiceObj[1]]}</div>`;
        }
        if (oppChoiceObj) {
          p2.innerHTML = `<div style="font-size:14px;color:#999;">${this.opponentName}</div><div style="font-size:36px;">${ICONS[oppChoiceObj[1]]}</div><div>${NAMES[oppChoiceObj[1]]}</div>`;
        }
      }

      // 显示结果
      const el = $('rpsResult');
      if (data.winnerName === '平局') {
        el.textContent = '🤝 平局！';
        el.className = 'rps-result rps-draw';
      } else if (data.winnerName === this.myName) {
        el.textContent = '🎉 你赢了！';
        el.className = 'rps-result rps-win';
      } else {
        el.textContent = '😢 你输了';
        el.className = 'rps-result rps-lose';
      }
      el.classList.remove('hidden');

      // 重置，准备下一轮
      this.myChoice = null;
      document.querySelectorAll('.rps-choice-btn').forEach(b => b.classList.remove('selected'));
      this.setStatus('下一轮，请选择');
    },

    handleChat(data) {
      const container = $('rpsChatMessages');
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="chat-name">${data.username}</span><span class="chat-time">${data.time}</span> ${data.content}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    },

    handleSpectatorCount(data) {
      $('rpsSpectators').textContent = `观战: ${data.count}人`;
    },

    handleGameOver(data) {
      setTimeout(() => this.close(), 2000);
    },

    onGameCreated(game) {
      this.gameId = game.id;
    }
  };

  // 关闭按钮
  $('rpsClose').addEventListener('click', () => {
    if (module.gameId) {
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_leave', gameId: module.gameId }));
    }
    module.close();
  });

  // 聊天
  $('rpsChatSend').addEventListener('click', sendChat);
  $('rpsChatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

  function sendChat() {
    const input = $('rpsChatInput');
    const content = input.value.trim();
    if (content && module.gameId) {
      GameSystem.getSocket().send(JSON.stringify({ type: 'game_chat', gameId: module.gameId, content }));
      input.value = '';
    }
  }

  GameSystem.register('rps', module);
})();
