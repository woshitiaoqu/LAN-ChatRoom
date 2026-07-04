# AGENTS.md

## 项目概述

局域网聊天室：Node.js (Express + WebSocket) 后端，原生 HTML/CSS/JS 前端，SQLite 存储消息。单包项目，无 monorepo 结构。

## 环境要求

- Node.js v18+
- 无需外部数据库——使用 SQLite（运行时自动创建 `chat.db` 文件）
- 首次运行前需 `npm install`

## 命令

- 启动服务器：`npm start`（执行 `node server.js`）
- 启动服务器+管理控制台：`node adminConsole.js`（一个终端搞定）
- 无测试框架、linter、formatter 或 typecheck

## 关键事实

- **端口**：服务器监听 `8082`（README 写的 8081 是错的）。修改见 `server.js:345`。
- **数据库**：SQLite 文件 `./chat.db`。README 错误地写了 MongoDB——忽略它。
- **静态文件**：Express 从项目根目录 (`.`) 提供 `index.html`、`script.js`、`style.css`。
- **管理模块**：`adminConsole.js` 从 `server.js` 导入，需单独运行。
- **导出**：`server.js` 导出 `admin`、`wss`、`getTotalMessageCount`、`queryUserMessages`、`clearAllMessages`、`db`、`startServer` 供管理控制台使用。

## 注意事项

- `server.js` 使用 `require.main === module` 保护 `server.listen()`——确保 `adminConsole.js` 通过 `require` 导入时不会触发端口监听。
- `server.js` 使用 `startServer(silent)` 参数控制启动日志输出——`adminConsole.js` 传入 `true` 静默启动。
- `script.js` 使用 `currentUser` 变量存储当前登录用户名，通过 localStorage 持久化。
- **消息加密**：使用 AES-256-GCM 加密所有 WebSocket 消息。密钥在 `server.js` 和 `script.js` 中硬编码（`SECRET_KEY` 变量），修改时需同步。
- **图片发送**：支持发送图片，格式为 base64 编码，限制 5MB。数据库 `messages` 表有 `type` 字段区分文本/图片。
- 界面语言为中文 (zh-CN)。UI 文本、注释和控制台输出均为中文。
