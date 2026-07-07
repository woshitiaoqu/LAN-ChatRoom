let socket;
let currentUser = '';
let clientId = localStorage.getItem('chatClientId');
if (!clientId) {
  clientId = 'user_' + Math.random().toString(36).substr(2, 8);
  localStorage.setItem('chatClientId', clientId);
}

// 获取DOM元素
const loginSection = document.querySelector('.login');
const chatSection = document.querySelector('.chat');
const usernameInput = document.getElementById('username');
const loginBtn = document.getElementById('loginBtn');
const messagesDiv = document.querySelector('.messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const filePanel = document.getElementById('filePanel');
const filePanelClose = document.getElementById('filePanelClose');
const fileList = document.getElementById('fileList');
const fileUploadBtn = document.getElementById('fileUploadBtn');

// 获取DOM元素
const loginForm = document.getElementById('loginForm');
const chatContainer = document.getElementById('chatContainer');

// 检查本地存储中是否有用户名
const storedUser = localStorage.getItem('chatUsername');
if (storedUser && storedUser.trim()) {
  currentUser = storedUser.trim();
  loginForm.classList.add('hidden');
  chatContainer.classList.remove('hidden');
  connectWebSocket();
} else {
  // 没有用户名，清除可能残留的状态
  localStorage.removeItem('chatUsername');
  localStorage.removeItem('chatClientId');
}

// 登录处理
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (username) {
    currentUser = username;
    // 保存用户名到localStorage
    localStorage.setItem('chatUsername', username);
    loginForm.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    connectWebSocket();
  }
});

// 登出处理
function logout() {
  localStorage.removeItem('chatUsername');
  localStorage.removeItem('chatClientId');
  if (socket) socket.close();
  location.reload();
}

// 添加登出按钮
const logoutButton = document.createElement('button');
logoutButton.textContent = '登出';
logoutButton.classList.add('logout-btn');
logoutButton.onclick = logout;
document.querySelector('.container').appendChild(logoutButton);

// 连接WebSocket服务器
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname === 'localhost' 
    ? window.location.hostname 
    : window.location.hostname.split(':')[0];
  const port = window.location.port || (protocol === 'wss:' ? 443 : 8082);
  socket = new WebSocket(`${protocol}//${host}:${port}`);

  socket.onopen = () => {
    console.log('WebSocket连接已建立');
    addSystemMessage('已连接到聊天室');
    // 连接成功后立即发送用户名和客户端ID
    if (currentUser) {
      const regMsg = JSON.stringify({ type: 'register', username: currentUser, clientId: clientId });
      socket.send(regMsg);
      console.log('发送注册消息:', regMsg);
      // 1秒后重试一次，确保服务器收到
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(regMsg);
          console.log('重试注册消息:', regMsg);
        }
      }, 1000);
    } else {
      console.error('currentUser 为空，无法注册');
    }
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'history') {
      data.messages.forEach(message => {
        displayMessage(message);
      });
    } else if (data.type === 'force_logout') {
      alert(data.reason || '请重新登录');
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatClientId');
      window.location.href = window.location.pathname + '?t=' + Date.now();
    } else if (data.type === 'error') {
      alert(data.content);
    } else if (data.type === 'sharer_list') {
      handleSharerListMsg(data);
    } else if (data.type === 'screen_share_stop') {
      handleScreenShareStopMsg(data);
      } else if (data.type === 'file_added') {
        addSystemMessage(data.file.uploader + ' 上传了文件: ' + data.file.filename);
        renderFileList();
      } else if (data.type === 'file_deleted' || data.type === 'file_updated') {
        renderFileList();
      } else {
      displayMessage(data);
    }
  };

  socket.onclose = (event) => {
    // 4002 = 未注册被踢, 4003 = 临时封禁中
    if (event.code === 4002 || event.code === 4003) {
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatClientId');
      alert(event.reason || '请重新登录');
      window.location.href = window.location.pathname + '?t=' + Date.now();
      return;
    }
    localStorage.removeItem('chatUsername');
    localStorage.removeItem('chatClientId');
    setTimeout(() => {
      window.location.href = window.location.pathname + '?t=' + Date.now();
    }, 100);
  };

  socket.onerror = () => {
    socket.close();
  };
}

// 发送消息
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// 图片按钮点击
imageBtn.addEventListener('click', () => {
  imageInput.click();
});

// 图片选择处理
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // 检查文件类型
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件');
    return;
  }
  
  // 检查文件大小（限制 5MB）
  if (file.size > 5 * 1024 * 1024) {
    alert('图片大小不能超过 5MB');
    return;
  }
  
  try {
    // 转换为 base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result;
      const message = {
        username: currentUser,
        type: 'image',
        content: base64,
        time: new Date().toLocaleTimeString()
      };
      socket.send(JSON.stringify(message));
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error('图片发送失败:', err);
    alert('图片发送失败');
  }
  
  // 清空文件选择
  imageInput.value = '';
});

// ===== 文件共享 =====

// 文件按钮 → 打开文件面板
fileBtn.addEventListener('click', () => {
  filePanel.classList.remove('hidden');
  renderFileList();
});
filePanelClose.addEventListener('click', () => filePanel.classList.add('hidden'));

// 上传按钮 → 选择文件
fileUploadBtn.addEventListener('click', () => fileInput.click());

const fileUploadStatus = document.getElementById('fileUploadStatus');
const fileStatusText = document.getElementById('fileStatusText');
const fileProgressFill = document.getElementById('fileProgressFill');

function showFileStatus(text, progress) {
  fileUploadStatus.classList.remove('hidden');
  fileStatusText.textContent = text;
  if (progress != null) fileProgressFill.style.width = progress + '%';
}

function hideFileStatus() {
  fileUploadStatus.classList.add('hidden');
}

// 选择文件后上传（含SHA-256哈希去重）
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileInput.value = '';

  // 客户端文件大小校验（防误操作，实际限制由服务端控制）
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB 软限制
  if (file.size > MAX_FILE_SIZE) {
    alert('文件过大，请选择 2GB 以内的文件');
    return;
  }

  fileUploadBtn.disabled = true;
  showFileStatus('正在计算文件哈希...', 10);

  try {
    // 计算SHA-256哈希
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    showFileStatus('正在上传...', 40);

    // 上传到服务器
    const formData = new FormData();
    formData.append('file', file);
    formData.append('hash', hashHex);
    formData.append('clientId', clientId);
    formData.append('username', currentUser);

    const res = await fetch('/upload', { method: 'POST', body: formData });
    const result = await res.json();

    showFileStatus('处理完成', 100);

    if (result.error) {
      addSystemMessage('上传失败: ' + result.error);
      setTimeout(hideFileStatus, 1500);
      return;
    }

    if (result.duplicate) {
      addSystemMessage('文件已存在（去重）: ' + result.filename);
    } else {
      addSystemMessage('你上传了文件: ' + result.filename);
    }
    renderFileList();
    setTimeout(hideFileStatus, 1500);
  } catch (err) {
    console.error('上传失败:', err);
    showFileStatus('上传失败', 0);
    setTimeout(hideFileStatus, 2000);
  } finally {
    fileUploadBtn.disabled = false;
  }
});

// 渲染文件列表
async function renderFileList() {
  try {
    const res = await fetch('/api/files?clientId=' + encodeURIComponent(clientId));
    const files = await res.json();
    if (fileList) {
      fileList.innerHTML = files.map(f => {
        const size = (f.size / 1024).toFixed(1) + 'KB';
        const isOwner = f.uploader_name === currentUser;
        return '<div class="file-item">' +
          '<div class="file-item-info">' +
          '<div class="file-item-name">' + f.filename + '</div>' +
          '<div class="file-item-meta">' + size + ' · ' + f.uploader_name + ' · ' + f.uploaded_at + '</div>' +
          '</div>' +
          '<div class="file-item-actions">' +
          '<a class="file-item-dl" href="/download/' + f.id + '" download>下载</a>' +
          (isOwner ? '<button class="file-item-del" data-id="' + f.id + '">删除</button>' : '') +
          '</div>' +
          '</div>';
      }).join('');
      if (files.length === 0) fileList.innerHTML = '<div class="file-empty">暂无文件</div>';
    }
  } catch (err) {
    console.error('获取文件列表失败:', err);
  }
}

// 文件列表上的委托事件：删除按钮
fileList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.file-item-del');
  if (!btn) return;
  const id = btn.dataset.id;
  if (!confirm('确定删除此文件？')) return;
  try {
    const res = await fetch('/api/files/' + id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser })
    });
    const result = await res.json();
    if (result.success) {
      addSystemMessage('你删除了文件');
      renderFileList();
    } else {
      alert(result.error || '删除失败');
    }
  } catch (err) {
    console.error('删除失败:', err);
    alert('删除失败');
  }
});

function sendMessage() {
  const content = messageInput.value.trim();
  if (content && socket && currentUser) {
    const message = {
      username: currentUser,
      content,
      time: new Date().toLocaleTimeString()
    };
    socket.send(JSON.stringify(message));
    messageInput.value = '';
  } else if (!currentUser) {
    alert('请先登录');
    logout();
  }
}

// 显示消息
function displayMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  
  // 判断是否为图片消息
  const isImage = message.type === 'image';
  const content = isImage 
    ? `<img src="${message.content}" alt="图片" class="message-image" onclick="window.open(this.src)">`
    : `<div class="content" data-copy="${message.content.replace(/"/g, '&quot;')}">${message.content}</div>`;
  
  messageElement.innerHTML = `
    <span class="username">${message.username}</span>
    <span class="time">${message.time}</span>
    ${content}
  `;
  
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 点击文本消息自动复制
messagesDiv.addEventListener('click', (e) => {
  const el = e.target.closest('.content');
  if (el && el.dataset.copy) {
    navigator.clipboard.writeText(el.dataset.copy).then(() => {
      el.title = '已复制';
      setTimeout(() => el.title = '', 1500);
    }).catch(() => {});
  }
});

// 显示系统消息
function addSystemMessage(content) {
  const message = {
    username: '系统',
    content,
    time: new Date().toLocaleTimeString()
  };
  displayMessage(message);
}

// ===== 小窗模式 =====
const stealthBtn = document.getElementById('stealthBtn');
let miniActive = false;
let savedState = {};

function toggleMini() {
  miniActive = !miniActive;
  const container = document.querySelector('.container');
  const chat = document.querySelector('.chat');
  const h1 = document.querySelector('h1');
  const login = document.querySelector('.login');
  const logoutBtn = document.querySelector('.logout-btn');

  if (miniActive) {
    // 保存当前状态
    savedState = {
      width: window.outerWidth,
      height: window.outerHeight,
      x: window.screenX,
      y: window.screenY
    };

    document.body.classList.add('mini-mode');
    document.title = '聊天';

    // 尝试缩小浏览器窗口
    try {
      window.resizeTo(350, 450);
      window.moveTo(
        window.screen.availWidth - 370,
        window.screen.availHeight - 470
      );
    } catch(e) {}
  } else {
    document.body.classList.remove('mini-mode');
    document.title = '局域网聊天室';

    // 恢复窗口大小
    try {
      window.resizeTo(savedState.width, savedState.height);
      window.moveTo(savedState.x, savedState.y);
    } catch(e) {}
  }
}

// Ctrl+Shift+H 切换小窗
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'H') {
    e.preventDefault();
    toggleMini();
  }
  if (e.key === 'Escape' && miniActive) {
    toggleMini();
  }
});

stealthBtn.addEventListener('click', toggleMini);

// ===== 屏幕共享 =====
let localScreenStream = null;
let peerConnections = {}; // peerId → RTCPeerConnection
const screenShareVideo = document.getElementById('screenShareVideo');
const screenShareArea = document.getElementById('screenShareArea');
const screenShareName = document.getElementById('screenShareName');
const sharerListEl = document.getElementById('sharerList');
let currentSharers = {}; // id → { name }
let watchingSharerId = null; // 当前正在观看的 sharer id

document.getElementById('screenShareBtn').addEventListener('click', async () => {
  if (localScreenStream) { stopScreenShare(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    const host = window.location.host;
    const msg = '屏幕共享不可用：当前为非安全上下文（HTTP），浏览器禁止屏幕共享。\n\n解决方法：\n1. 在浏览器地址栏输入：edge://flags/#unsafely-treat-insecure-origin-as-secure\n2. 启用该选项，在输入框中添加：http://' + host + '\n3. 点击右下角"Relaunch"重启浏览器';
    document.getElementById('shareUnsupportedText').textContent = msg;
    document.getElementById('shareUnsupportedModal').classList.remove('hidden');
    return;
  }
  try {
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    document.getElementById('screenShareBtn').textContent = '⏹ 停止';
    document.getElementById('screenShareBtn').style.background = '#ff4757';
    socket.send(JSON.stringify({ type: 'screen_share_start' }));
    localScreenStream.getVideoTracks()[0].onended = () => stopScreenShare();
  } catch (e) { console.log('屏幕共享取消:', e.message); }
});

function stopScreenShare() {
  if (localScreenStream) { localScreenStream.getTracks().forEach(t => t.stop()); localScreenStream = null; }
  for (const id in peerConnections) { peerConnections[id].close(); delete peerConnections[id]; }
  document.getElementById('screenShareBtn').textContent = '📺 共享';
  document.getElementById('screenShareBtn').style.background = '';
  socket.send(JSON.stringify({ type: 'screen_share_stop' }));
}

// 关闭屏幕共享不可用弹窗
document.getElementById('shareUnsupportedClose').addEventListener('click', () => {
  document.getElementById('shareUnsupportedModal').classList.add('hidden');
});

// 收到共享者列表 → 渲染列表
function handleSharerListMsg(data) {
  const myServerId = data.yourId;
  const newSharers = {};
  data.sharers.forEach(s => {
    if (s.id != myServerId) { newSharers[s.id] = { name: s.name }; }
  });
  // 检测已停止共享的人，清理连接
  for (const id in currentSharers) {
    if (!newSharers[id]) {
      const idNum = Number(id);
      if (peerConnections[idNum]) { peerConnections[idNum].close(); delete peerConnections[idNum]; }
      if (watchingSharerId === idNum) { watchingSharerId = null; screenShareArea.classList.add('hidden'); screenShareVideo.srcObject = null; }
    }
  }
  currentSharers = newSharers;
  renderSharerList();
}

function renderSharerList() {
  const ids = Object.keys(currentSharers);
  if (ids.length === 0) { sharerListEl.classList.add('hidden'); sharerListEl.innerHTML = ''; return; }
  sharerListEl.classList.remove('hidden');
  sharerListEl.innerHTML = ids.map(id => {
    const s = currentSharers[id];
    const isWatching = watchingSharerId === id;
    return '<div class="sharer-item">' +
      '<span class="sharer-name">' + s.name + ' 正在共享屏幕</span>' +
      (isWatching
        ? '<span class="sharer-watching">正在观看</span><button class="stop-watch-btn" onclick="stopWatching()">停止观看</button>'
        : '<button onclick="startWatching(\'' + id + '\')">加入观看</button>') +
      '</div>';
  }).join('');
}

// 观看某个共享者
function startWatching(sharerId) {
  sharerId = Number(sharerId);
  if (watchingSharerId) {
    if (peerConnections[watchingSharerId]) { peerConnections[watchingSharerId].close(); delete peerConnections[watchingSharerId]; }
  }
  watchingSharerId = sharerId;
  const sharer = currentSharers[sharerId];
  if (!sharer) return;
  const pc = new RTCPeerConnection({ iceServers: [] });
  peerConnections[sharerId] = pc;
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.oniceconnectionstatechange = () => console.log('[屏幕共享] ICE状态:', pc.iceConnectionState);
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: sharerId, signal: e.candidate }));
  };
  pc.ontrack = (e) => {
    console.log('[屏幕共享] ontrack 触发, 流:', !!e.streams[0], '轨道数:', e.streams[0]?.getTracks().length);
    screenShareVideo.srcObject = e.streams[0];
    screenShareName.textContent = sharer.name + ' 的屏幕';
    screenShareArea.classList.remove('hidden');
    screenShareVideo.play().catch(() => {});
  };
  pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
    socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: sharerId, signal: pc.localDescription }));
  });
  renderSharerList();
}

// 停止观看
function stopWatching() {
  if (watchingSharerId && peerConnections[watchingSharerId]) {
    peerConnections[watchingSharerId].close();
    delete peerConnections[watchingSharerId];
  }
  watchingSharerId = null;
  screenShareArea.classList.add('hidden');
  screenShareVideo.srcObject = null;
  renderSharerList();
}

// WebRTC 信令处理
function handleWebRTCSignal(data) {
  const { fromId, fromName, signal } = data;
  if (signal.type === 'offer') {
    let pc = peerConnections[fromId];
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: [] });
      peerConnections[fromId] = pc;
      pc.oniceconnectionstatechange = () => console.log('[屏幕共享-被观看端] ICE状态:', pc.iceConnectionState, 'from:', fromName);
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: fromId, signal: e.candidate }));
      };
      pc.ontrack = (e) => {
        screenShareVideo.srcObject = e.streams[0];
        screenShareName.textContent = fromName + ' 的屏幕';
        screenShareArea.classList.remove('hidden');
        screenShareVideo.play().catch(() => {});
      };
    }
    pc.setRemoteDescription(new RTCSessionDescription(signal)).then(() => {
      if (localScreenStream) {
        localScreenStream.getTracks().forEach(t => pc.addTrack(t, localScreenStream));
      }
      return pc.createAnswer();
    })
      .then(answer => pc.setLocalDescription(answer)).then(() => {
        socket.send(JSON.stringify({ type: 'webrtc_signal', targetId: fromId, signal: pc.localDescription }));
      });
  } else if (signal.type === 'answer') {
    const pc = peerConnections[fromId];
    if (pc) pc.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    const pc = peerConnections[fromId];
    if (pc) pc.addIceCandidate(new RTCIceCandidate(signal));
  }
}

function handleScreenShareStopMsg(data) {
  // 兼容旧的单独 stop 消息（从 share_list 也能处理）
  if (peerConnections[data.fromId]) { peerConnections[data.fromId].close(); delete peerConnections[data.fromId]; }
  if (watchingSharerId === data.fromId) { watchingSharerId = null; screenShareArea.classList.add('hidden'); screenShareVideo.srcObject = null; }
  delete currentSharers[data.fromId];
  renderSharerList();
}

// 关闭观看区域
document.getElementById('screenShareClose').addEventListener('click', stopWatching);

// 自定义全屏
document.getElementById('screenShareFullscreenBtn').addEventListener('click', () => {
  const video = document.getElementById('screenShareVideo');
  if (document.getElementById('customFullscreenOverlay')) return;
  const w = prompt('全屏窗口宽度（如 90% 或 800px）', '90%');
  if (!w) return;
  const h = prompt('全屏窗口高度（如 90% 或 600px）', '90%');
  if (!h) return;
  const overlay = document.createElement('div');
  overlay.id = 'customFullscreenOverlay';
  overlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:' + w + ';height:' + h + ';z-index:9999;background:#000;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,0.8);';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:rgba(0,0,0,0.7);color:#fff;font-size:13px;flex-shrink:0;';
  const span = document.createElement('span');
  span.textContent = screenShareName.textContent || '全屏观看';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;';
  header.appendChild(span);
  header.appendChild(closeBtn);
  overlay.appendChild(header);
  const originalParent = video.parentNode;
  const placeholder = document.createElement('div');
  placeholder.style.display = 'none';
  originalParent.insertBefore(placeholder, video);
  overlay.appendChild(video);
  video.style.cssText = 'width:100%;flex:1;display:block;background:#000;object-fit:contain;';
  const backdrop = document.createElement('div');
  backdrop.id = 'customFullscreenBackdrop';
  backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9998;';
  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);
  const restore = () => {
    placeholder.parentNode.insertBefore(video, placeholder);
    placeholder.remove();
    video.style.cssText = '';
    overlay.remove();
    backdrop.remove();
  };
  closeBtn.addEventListener('click', restore);
  backdrop.addEventListener('click', restore);
  document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { restore(); document.removeEventListener('keydown', onEsc); } });
});
