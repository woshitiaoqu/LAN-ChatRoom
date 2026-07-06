# 局域网聊天室

基于 WebSocket 的局域网即时聊天应用，支持多用户实时聊天、游戏对战、管理控制台。

## 功能特性

- 实时消息传输（WebSocket）
- 多用户支持，自定义用户名
- 图片发送（base64，限制 5MB）
- 五子棋对战（邀请、观战、观战聊天）
- 管理控制台（踢出用户、禁言、IP/MAC 黑名单、屏蔽词）
- 小窗模式（Ctrl+Shift+H）
- SQLite 消息持久化

## 技术栈

- Node.js (Express + WebSocket)
- SQLite（消息存储，运行时自动创建 `chat.db`）
- 原生 HTML5 + CSS3 + JavaScript (ES6)

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

## 项目结构

```
LAN-ChatRoom/
├── server.js           # 后端服务器（Express + WebSocket + 游戏模块）
├── adminConsole.js     # 管理控制台
├── script.js           # 前端逻辑（聊天 + 游戏 + 小窗）
├── index.html          # 页面结构
├── style.css           # 样式表
├── package.json        # 项目配置
└── chat.db             # SQLite 数据库（运行时自动创建）
```

## 注意事项

- 确保所有用户在同一个局域网内
- 默认端口 8082，可在 `server.js` 中修改
- 数据库文件 `chat.db` 包含聊天记录，已在 `.gitignore` 中排除
- `mongodb` 是残留依赖，项目实际使用 SQLite
