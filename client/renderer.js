const serverList = document.getElementById('serverList');
const discoveryView = document.getElementById('discovery-view');
const chatView = document.getElementById('chat-view');
const chatWebview = document.getElementById('chatWebview');
const backBtn = document.getElementById('backBtn');
const connectedServer = document.getElementById('connectedServer');
const manualIp = document.getElementById('manualIp');
const manualPort = document.getElementById('manualPort');
const manualConnectBtn = document.getElementById('manualConnectBtn');

let serverCount = 0;

function addServer(server) {
  const existing = document.querySelector(`.server-item[data-key="${server.ip}:${server.port}"]`);
  if (existing) {
    existing.querySelector('.server-name').textContent = server.name;
    return;
  }

  const searching = document.getElementById('searchingIndicator');
  if (searching) searching.remove();

  serverCount++;
  const item = document.createElement('div');
  item.className = 'server-item';
  item.dataset.key = `${server.ip}:${server.port}`;
  item.innerHTML = `
    <div class="server-info">
      <div class="server-name">${escapeHtml(server.name)}</div>
      <div class="server-ip">${server.ip}:${server.port}</div>
    </div>
    <button class="server-connect-btn">连接</button>
  `;

  item.querySelector('.server-connect-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    connect(`http://${server.ip}:${server.port}`);
  });

  item.addEventListener('click', () => {
    connect(`http://${server.ip}:${server.port}`);
  });

  serverList.appendChild(item);
}

function connect(url) {
  connectedServer.textContent = '连接中 ' + url + ' ...';
  discoveryView.classList.add('hidden');
  chatView.classList.remove('hidden');
  document.title = 'LAN Chat - ' + url;
  chatWebview.src = url;
}

backBtn.addEventListener('click', () => {
  chatWebview.src = 'about:blank';
  chatView.classList.add('hidden');
  discoveryView.classList.remove('hidden');
  document.title = 'LAN Chat - 客户端';
});

manualConnectBtn.addEventListener('click', () => {
  const ip = manualIp.value.trim();
  const port = manualPort.value.trim() || '8082';
  if (!ip) { alert('请输入服务器 IP 地址'); return; }
  connect(`http://${ip}:${port}`);
});

manualIp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') manualConnectBtn.click();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.electronAPI.onServerDiscovered(addServer);