const serverList = document.getElementById('serverList');
const discoveryView = document.getElementById('discovery-view');
const chatView = document.getElementById('chat-view');
const chatWebview = document.getElementById('chatWebview');
const backBtn = document.getElementById('backBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const connectedServer = document.getElementById('connectedServer');
const manualIp = document.getElementById('manualIp');
const manualPort = document.getElementById('manualPort');
const manualConnectBtn = document.getElementById('manualConnectBtn');

function addServer(server) {
  const key = `${server.ip}:${server.port}`;
  if (document.querySelector(`.server-item[data-key="${key}"]`)) return;

  document.getElementById('searchingIndicator')?.remove();

  const item = document.createElement('div');
  item.className = 'server-item';
  item.dataset.key = key;
  item.innerHTML = `
    <div class="server-info">
      <div class="server-name">${esc(server.name)}</div>
      <div class="server-ip">${server.ip}:${server.port}</div>
    </div>
    <button class="server-connect-btn">连接</button>
  `;
  item.querySelector('.server-connect-btn').onclick = (e) => { e.stopPropagation(); connect(key); };
  item.onclick = () => connect(key);
  serverList.appendChild(item);
}

function connect(key) {
  const [ip, port] = key.split(':');
  const url = `http://${ip}:${port}`;
  connectedServer.textContent = `${ip}:${port}`;
  discoveryView.classList.add('hidden');
  chatView.classList.remove('hidden');
  document.title = `LAN Chat - ${ip}:${port}`;
  chatWebview.src = url;
  chatWebview.addEventListener('did-start-loading', () => {
    document.title = '加载中...';
  });
}

backBtn.onclick = () => {
  chatWebview.src = 'about:blank';
  chatView.classList.add('hidden');
  discoveryView.classList.remove('hidden');
  document.title = 'LAN Chat - 客户端';
  window.electronAPI.rescan();
};

fullscreenBtn.onclick = () => {
  const w = require('electron').remote?.getCurrentWindow();
  if (w) w.setFullScreen(!w.isFullScreen());
};

manualConnectBtn.onclick = () => {
  const ip = manualIp.value.trim();
  const port = manualPort.value.trim() || '8082';
  if (!ip) { alert('请输入服务器 IP'); return; }
  connect(`${ip}:${port}`);
};

manualIp.onkeydown = (e) => { if (e.key === 'Enter') manualConnectBtn.click(); };

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

window.electronAPI.onServerDiscovered(addServer);
window.electronAPI.onNavigate((url) => {
  const m = url.match(/http:\/\/([\d.]+):(\d+)/);
  if (m) connect(`${m[1]}:${m[2]}`);
});