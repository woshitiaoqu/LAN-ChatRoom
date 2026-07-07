# LAN ChatRoom 打包脚本
# 用法: .\build.ps1 [server|client|all]

param([string]$Target = "all")

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Dist = "$Root\dist"

# 安装依赖
Write-Host "=== 安装依赖 ===" -ForegroundColor Cyan
Set-Location $Root
npm install

function Build-Server {
    Write-Host "=== 打包服务端 ===" -ForegroundColor Cyan
    $OutDir = "$Dist\server"
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    New-Item -ItemType Directory -Path "$OutDir\uploads" -Force | Out-Null

    # 复制 Node.js 运行时
    Copy-Item "C:\Program Files\nodejs\node.exe" -Destination "$OutDir\node.exe"

    # 复制服务端文件
    $serverFiles = @(
        'server.js', 'adminConsole.js', 'config.json', 'package.json',
        'index.html', 'script.js', 'style.css',
        'game.html', 'game.js',
        'gomoku.js', 'tictactoe.js', 'rps.js', 'connect4.js', 'othello.js', 'guess.js', 'battleship.js'
    )
    foreach ($f in $serverFiles) {
        Copy-Item "$Root\$f" -Destination "$OutDir\$f"
    }

    # 复制游戏目录
    Copy-Item -Recurse "$Root\games" -Destination "$OutDir\games"

    # 复制 node_modules（不含开发依赖）
    Copy-Item -Recurse "$Root\node_modules" -Destination "$OutDir\node_modules"

    # 创建启动脚本
    @"
@echo off
title LAN ChatRoom - 服务端
echo ========================================
echo   LAN ChatRoom 服务端
echo   局域网聊天室  v1.1
echo ========================================
echo.
"%~dp0node.exe" "%~dp0server.js"
pause
"@ | Out-File -FilePath "$OutDir\start.bat" -Encoding ASCII

    $size = (Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Host "✅ 服务端已打包到 $OutDir (${size:N1} MB)" -ForegroundColor Green
    Write-Host "   运行 $OutDir\start.bat 启动服务" -ForegroundColor Green
}

function Build-Client {
    Write-Host "=== 打包客户端 ===" -ForegroundColor Cyan
    $OutDir = "$Dist\client"
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

    # 复制 Node.js 运行时
    Copy-Item "C:\Program Files\nodejs\node.exe" -Destination "$OutDir\node.exe"

    # 复制客户端脚本
    @"
const dgram = require('dgram');
const readline = require('readline');
const { exec } = require('child_process');

const DISCOVERY_PORT = 25000;
const servers = new Map();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('\n🔍 LAN ChatRoom - 客户端');
console.log('正在搜索局域网服务器...\n');

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

socket.on('message', (msg) => {
  try {
    const data = JSON.parse(msg.toString());
    if (data.type === 'lan-chat-server') {
      const key = \`\${data.ip}:\${data.port}\`;
      if (!servers.has(key)) {
        servers.set(key, { name: data.name, ip: data.ip, port: data.port, version: data.version });
        renderServers();
      }
    }
  } catch (e) { /* 忽略 */ }
});

socket.bind(DISCOVERY_PORT, () => { /* 只收不发 */ });

// 5秒后如果没有发现服务器，提示手动输入
setTimeout(() => {
  if (servers.size === 0) {
    console.log('⚠️  未自动发现服务器，请输入 IP 地址手动连接');
    promptManual();
  }
}, 5000);

function renderServers() {
  console.clear();
  console.log('\n🔍 LAN ChatRoom - 客户端');
  console.log(\`发现 \${servers.size} 台服务器:\n\`);
  let i = 1;
  servers.forEach((s) => {
    console.log(\`  \${i}. \${s.name}\`);
    console.log(\`     \${s.ip}:\${s.port}\`);
    i++;
  });
  console.log('');
  console.log('  0. 手动输入 IP 地址');
  console.log('  q. 退出\n');
  rl.question('请选择服务器序号: ', (answer) => {
    const choice = parseInt(answer);
    if (answer === '0' || answer.toLowerCase() === 'm') {
      promptManual();
    } else if (answer.toLowerCase() === 'q') {
      socket.close();
      process.exit(0);
    } else if (choice >= 1 && choice <= servers.size) {
      const s = Array.from(servers.values())[choice - 1];
      const url = \`http://\${s.ip}:\${s.port}\`;
      console.log(\`\n✅ 正在连接 \${s.name}...\`);
      exec(\`start "" "\${url}"\`);
      rl.question('\n按回车键返回服务器列表...', () => renderServers());
    } else {
      renderServers();
    }
  });
}

function promptManual() {
  rl.question('请输入服务器 IP 地址 (如 192.168.1.5): ', (ip) => {
    if (!ip.trim()) { renderServers(); return; }
    rl.question(\`端口 [8082]: \`, (port) => {
      const p = parseInt(port) || 8082;
      const url = \`http://\${ip.trim()}:\${p}\`;
      console.log(\`\n✅ 正在连接 \${url}...\`);
      exec(\`start "" "\${url}"\`);
      rl.question('\n按回车键返回...', () => renderServers());
    });
  });
}

rl.on('close', () => {
  socket.close();
  process.exit(0);
});
"@ | Out-File -FilePath "$OutDir\client.js" -Encoding ASCII

    @"
@echo off
title LAN ChatRoom - 客户端
echo ========================================
echo   LAN ChatRoom 客户端
echo   自动搜索局域网服务器
echo ========================================
echo.
"%~dp0node.exe" "%~dp0client.js"
pause
"@ | Out-File -FilePath "$OutDir\start.bat" -Encoding ASCII

    $size = (Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Host "✅ 客户端已打包到 $OutDir (${size:N1} MB)" -ForegroundColor Green
    Write-Host "   运行 $OutDir\start.bat 搜索服务器" -ForegroundColor Green
}

switch ($Target.ToLower()) {
    "server" { Build-Server }
    "client" { Build-Client }
    default { Build-Server; Build-Client }
}

Set-Location $Root
Write-Host "`n=== 打包完成 ===" -ForegroundColor Green
Write-Host "服务端: $Dist\server\start.bat"
Write-Host "客户端: $Dist\client\start.bat"