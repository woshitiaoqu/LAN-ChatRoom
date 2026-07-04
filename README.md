# 局域网聊天室

这是一个基于 WebSocket 的局域网即时聊天应用，支持多用户实时聊天和用户名设置。 100%仅依靠 cline + deepseek-API

## 功能特性

- 实时消息传输
- 多用户支持
- 自定义用户名
- 简洁的用户界面
- 自动消息滚动

## 技术栈

- Node.js (Express + WebSocket)
- MongoDB (消息存储)
- HTML5 + CSS3
- JavaScript (ES6)

## 环境要求

1. Node.js (v18+)
2. MongoDB (v6+)

## 安装指南

### 1. 安装和启动 MongoDB

- macOS:

  ```bash
  # 安装MongoDB
  brew tap mongodb/brew
  brew install mongodb-community@6.0

  # 启动MongoDB服务
  brew services start mongodb-community

  # 检查服务状态
  brew services list

  # 如果服务未运行，手动启动
  mongod --config /usr/local/etc/mongod.conf
  ```

- Windows:

> 注意，win 的配置我自己也不是很清楚，推荐使用 mac 来运行本项目

1. 下载安装包：https://www.mongodb.com/try/download/community
2. 按照安装向导完成安装
3. 启动 MongoDB 服务：
   - 打开命令提示符（管理员权限）
   - 运行以下命令：
     ```bash
     net start MongoDB
     ```
   - 检查服务状态：
     ```bash
     sc query MongoDB
     ```
   - 如果服务未运行，手动启动：
     ```bash
     "C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe" --config "C:\Program Files\MongoDB\Server\6.0\bin\mongod.cfg"
     ```

- 常见问题：
  - 如果端口 27017 被占用：
    ```bash
    sudo lsof -i :27017  # 查看占用进程
    sudo kill <PID>      # 终止占用进程
    ```
  - 如果权限不足：
    ```bash
    sudo chown -R `whoami` /data/db  # macOS/Linux
    ```

### 2. 克隆仓库

```bash
git clone https://github.com/Ganzhe2028/LAN-ChatRoom.git
cd LAN-ChatRoom
```

### 3. 安装依赖

```bash
npm install
```

### 4. 启动服务器

```bash
npm start
```

### 5. 访问应用

在浏览器中访问：

```
http://localhost:8081
```

## 数据库配置

- 默认使用本地 MongoDB 实例 (mongodb://localhost:27017)
- 数据库名称：chatApp
- 集合名称：messages
- 如果需要修改配置，请编辑 server.js 中的相关参数

## 使用说明

1. 打开应用后，输入用户名并点击"加入聊天室"
2. 在消息输入框中输入内容，按回车发送
3. 所有在线用户将实时收到消息
4. 用户加入或离开时会有系统通知

## 注意事项

- 确保所有用户在同一个局域网内
- 默认端口为 8081，可在 server.js 中修改
- 建议使用现代浏览器以获得最佳体验
- 确保 MongoDB 服务已启动

## 项目结构

```
LAN-ChatRoom/
├── index.html        # 前端页面
├── style.css         # 样式表
├── script.js         # 前端逻辑
├── server.js         # 后端服务器
├── package.json      # 项目配置
└── README.md         # 项目文档
```
