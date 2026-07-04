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
      // 服务器强制登出（未注册）
      alert(data.reason || '请重新登录');
      localStorage.removeItem('chatUsername');
      localStorage.removeItem('chatClientId');
      window.location.href = window.location.pathname + '?t=' + Date.now();
    } else if (data.type === 'error') {
      alert(data.content);
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
    : `<div class="content">${message.content}</div>`;
  
  messageElement.innerHTML = `
    <span class="username">${message.username}</span>
    <span class="time">${message.time}</span>
    ${content}
  `;
  
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 显示系统消息
function addSystemMessage(content) {
  const message = {
    username: '系统',
    content,
    time: new Date().toLocaleTimeString()
  };
  displayMessage(message);
}
