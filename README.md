# 局域网聊天室

基于 WebSocket 的局域网即时聊天应用，支持多用户实时聊天、游戏大厅、屏幕共享、管理控制台。
支持 **打包为独立 EXE**（服务端 + 客户端），客户端自动发现局域网服务器。

## 功能特性

- 实时消息传输（WebSocket）
- 多用户支持，自定义用户名
- 图片发送（base64，限制可配置，默认 5MB）
- **屏幕共享**（多人同时共享，自由选择观看，自定义全屏大小，基于 WebRTC）
- **📁 文件共享**（SHA-256 哈希去重防重复上传，WEB 端上传/下载，终端管理）
  - 上传文件，自动计算 SHA-256 哈希，重复文件自动去重
  - 文件面板浏览、下载、上传者自行删除
  - 管理员控制台：删除文件、切换可见/隐藏、切换下载权限、设置用户白名单、修改上传大小/图片限制、设置允许的文件格式
- **🎮 游戏大厅**（`game.html`）
   - 🕹️ **单机游戏**（21 款）：俄罗斯方块、2048、贪吃蛇、Flappy Bird、飞机大战、迷宫等
   - 🌐 **联机游戏（局域网）**：
     - ⚫ 五子棋（创建房间、邀请对战、观战、弹幕聊天）
     - ⭕ 井字棋（两人对战，三连一线获胜）
     - ✂️ 石头剪刀布（多轮猜拳对战）
     - 🔴 四子棋（两人对战，垂直四连获胜）
     - ⚫ 黑白棋（翻转棋盘，占地为王）
     - 🔢 猜数字（五轮猜数，比拼运气）
     - 🚢 海战棋（布置舰队，炮击敌舰）
- 管理控制台（踢出用户、禁言、IP/MAC 黑名单、屏蔽词、文件管理）
- 小窗模式（Ctrl+Shift+H）
- SQLite 消息持久化
- **📡 UDP 服务发现**：客户端自动嗅探局域网内的服务端，零配置连接
- **⚙️ config.json 配置**：端口、文件限制、广播参数均可配置，运行时修改自动持久化

## 技术栈

- Node.js (Express + WebSocket)
- SQLite（消息存储，运行时自动创建 `chat.db`）
- 前端：原生 HTML5 + CSS3 + JavaScript (ES6)
- 单机游戏：Vite + React + TypeScript + Tailwind CSS（iframe 嵌入）

## 环境要求

- Node.js v18+
- 无需安装数据库——SQLite 自动创建

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动（服务器 + 管理控制台，一个终端搞定）
node adminConsole.js

# 3. 浏览器访问
http://localhost:8082
```

局域网内其他用户通过 `http://<你的IP>:8082` 访问。

## 项目结构

```
LAN-ChatRoom/
├── server.js           # 后端服务器（Express + WebSocket + 游戏管理 + 屏幕共享信令）
├── adminConsole.js     # 管理控制台
├── script.js           # 前端逻辑（聊天 + 屏幕共享 WebRTC + 小窗）
├── index.html          # 聊天室页面
├── game.html           # 游戏大厅页面
├── game.js             # 游戏大厅核心（WebSocket + 模块系统 + 大厅渲染）
├── gomoku.js           # 五子棋联机模块
├── tictactoe.js        # 井字棋联机模块
├── rps.js              # 石头剪刀布联机模块
├── connect4.js         # 四子棋联机模块
├── othello.js          # 黑白棋联机模块
├── guess.js            # 猜数字联机模块
├── battleship.js       # 海战棋联机模块
├── games/              # 单机游戏（iframe 嵌入）
│   ├── tetris/         # 俄罗斯方块
│   ├── 2048/           # 2048
│   ├── snake/          # 贪吃蛇
│   └── ...             # 共 21 款
├── style.css           # 样式表
├── package.json        # 项目配置
├── uploads/            # 上传文件存储目录（运行时自动创建）
└── chat.db             # SQLite 数据库（运行时自动创建）
```

## 管理控制台

运行 `node adminConsole.js` 后，终端会显示管理菜单：

| 选项 | 功能 |
|------|------|
| 1 | 查看在线用户列表 |
| 2 | 查看历史连接统计 |
| 3 | 获取服务器状态 |
| 4 | 禁言/解禁用户 |
| 5 | 踢出用户（仅断开，不封禁） |
| 6 | 广播系统消息 |
| 7 | 查询用户消息记录 |
| 8 | 清空聊天记录 |
| 9 | 提示用户 |
| 10 | 屏蔽词管理 |
| 11 | IP/MAC 黑名单管理 |
| 12 | **文件管理**（查看/删除文件，切换可见性/下载权限，设置用户白名单，修改上传大小限制，设置图片发送限制，设置允许上传的文件格式） |

## 注意事项

- 确保所有用户在同一个局域网内
- 默认端口 8082，可在 `config.json` 中修改
- 数据库文件 `chat.db` 包含聊天记录，已在 `.gitignore` 中排除
- **屏幕共享** 需要浏览器支持 `getDisplayMedia`，通过局域网 IP 访问时可能因非安全上下文被限制，可将地址加入浏览器不安全来源白名单（`edge://flags/#unsafely-treat-insecure-origin-as-secure`）

## 打包为独立软件（便携版）

无需安装 Node.js，下载即用。

```bash
# 一键打包服务端 + 客户端
.\build.ps1
# 或分别打包
.\build.ps1 server
.\build.ps1 client
```

打包后目录结构：

```
dist/
├── server/                    # 服务端（约 127MB）
│   ├── node.exe              # Node.js 运行时
│   ├── server.js             # 聊天服务
│   ├── adminConsole.js       # 管理员控制台
│   ├── config.json           # 配置文件
│   ├── index.html / script.js / style.css  # 前端页面
│   ├── game.html / game.js   # 游戏大厅
│   ├── gomoku.js / tictactoe.js / ...      # 联机游戏模块
│   ├── games/                # 单机游戏（21 款）
│   ├── node_modules/         # 依赖
│   ├── uploads/              # 上传文件目录
│   └── start.bat             ← 双击启动
│
└── client/                    # 客户端（约 88MB）
    ├── node.exe              # Node.js 运行时
    ├── client.js             # 自动发现脚本
    └── start.bat             ← 双击启动
```

### 使用方法

**服务端**：双击 `dist/server/start.bat`，终端显示服务器地址（如 `http://192.168.1.5:8082`）。

**客户端**：双击 `dist/client/start.bat`，自动搜索局域网内的服务端，显示列表：

```
🔍 LAN ChatRoom - 客户端
发现 1 台服务器:

  1. 客厅-PC
     192.168.1.5:8082

  0. 手动输入 IP 地址
  q. 退出

请选择服务器序号:
```

选择序号后自动打开浏览器进入聊天室。如果未自动发现，可选 0 手动输入 IP。

### 配置说明（config.json）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 8082 | HTTP 服务端口 |
| `discovery.enabled` | boolean | true | 是否启动 UDP 服务发现 |
| `discovery.broadcastPort` | number | 25000 | UDP 广播端口 |
| `discovery.intervalMs` | number | 2000 | 广播间隔（毫秒） |
| `discovery.serverName` | string | null | 服务器名称（null=使用主机名） |
| `maxUploadSize` | number | 0 | 文件上传大小限制（0=无限制） |
| `imageMaxSize` | number | 5242880 | 图片 base64 大小限制（默认 5MB） |
| `allowedExtensions` | string | "" | 允许上传的文件扩展名（逗号分隔，空=全部允许） |

> 运行时通过管理员控制台修改的配置会自动保存到 `config.json`。
