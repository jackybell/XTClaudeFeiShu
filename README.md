# XTClaudeFeiShu

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6%2B-blue.svg)](https://www.typescriptlang.org/)

**将飞书机器人连接到 Claude Code CLI 的智能桥接服务**

[English](#english-documentation) | [中文文档](#中文文档)

</div>

---

## 中文文档

### 📖 项目简介

XTClaudeFeiShu 是一个创新的桥接服务，将 Anthropic 的 Claude Code CLI 与飞书（Lark）机器人无缝连接。通过这个服务，用户可以直接在飞书中与 Claude 进行智能对话，让 Claude 帮助编写代码、调试问题、重构项目等。

#### 核心特性

- 🤖 **智能代码助手** - 在飞书中直接与 Claude 交互，获取代码建议和问题解决方案
- 🔄 **实时消息流** - 支持 Claude 的流式输出，实时查看思考和执行过程
- 🎯 **多项目管理** - 支持配置多个项目，用户可自由切换工作上下文
- 🛠️ **灵活工具控制** - 精细控制 Claude 可用的工具集（Read、Write、Edit、Bash 等）
- 📊 **预算管理** - 设置对话预算限制，避免意外超支
- 🔐 **权限控制** - 管理员权限机制，确保安全性
- 📝 **交互式卡片** - 精美的飞书卡片消息，支持工具调用详情展示
- 🔔 **文件监听** - 可选的文件变更监听功能
- 📦 **任务队列** - 多任务排队处理，避免资源冲突

### 🚀 快速开始

#### 前置要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 18.0.0 | 推荐使用 LTS 版本 |
| npm | >= 9.0.0 | 随 Node.js 安装 |
| Claude Code CLI | 最新版 | Anthropic 官方 CLI 工具 |

#### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd XTClaudeFeiShu

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置 CLAUDE_EXECUTABLE_PATH

# 4. 配置机器人
cp xtbot.json.template xtbot.json
# 编辑 xtbot.json，配置飞书应用和项目信息

# 5. 启动服务
npm run dev  # 开发模式
# 或
npm run build && npm start  # 生产模式
```

#### 验证安装

```bash
# 检查 Node.js 版本
node --version  # 应显示 >= 18.0.0

# 检查 Claude CLI
claude --version

# 检查服务状态
npm run dev
# 应看到 "Started" 日志
```

### ⚙️ 配置说明

#### 环境变量 (.env)

```env
# Claude Code CLI 可执行文件路径（必填）
# Windows 示例
CLAUDE_EXECUTABLE_PATH=C:\Users\<用户名>\AppData\Roaming\npm\claude.cmd
# Linux/macOS 示例
# CLAUDE_EXECUTABLE_PATH=/usr/local/bin/claude

# 日志级别（可选）
LOG_LEVEL=info  # trace, debug, info, warn, error, fatal
```

#### 机器人配置 (xtbot.json)

```json
{
  "adminOpenIds": ["ou_xxxxxxxxxxxxxxxx"],
  "bots": [
    {
      "id": "bot-001",
      "name": "Claude 助手",
      "channel": "feishu",
      "feishuAppId": "cli_xxxxxxxxxxxxxxxx",
      "feishuAppSecret": "your_app_secret_here",
      "projects": [
        {
          "id": "proj-001",
          "name": "我的项目",
          "path": "/path/to/your/project",
          "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
          "maxTurns": 100,
          "maxBudgetUsd": 1.5,
          "enableSkills": true
        }
      ],
      "currentProjectId": "proj-001"
    }
  ]
}
```

#### 配置项详解

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `adminOpenIds` | string[] | ✅ | 管理员的飞书 Open ID 列表 |
| `bots[].feishuAppId` | string | ✅ | 飞书应用 App ID |
| `bots[].feishuAppSecret` | string | ✅ | 飞书应用 App Secret |
| `projects[].path` | string | ✅ | 项目代码的绝对路径 |
| `projects[].allowedTools` | string[] | ✅ | Claude 可用的工具列表 |
| `projects[].maxTurns` | number | ❌ | 最大对话轮次，默认 100 |
| `projects[].maxBudgetUsd` | number | ❌ | 最大预算（美元），默认 1.5 |

### 🎮 使用指南

#### 基本命令

在飞书中与机器人对话时，可以使用以下命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` | 显示帮助信息 | `/help` |
| `/status` | 查看当前会话状态 | `/status` |
| `/projects` | 列出所有可用项目 | `/projects` |
| `/switch <项目ID>` | 切换到指定项目 | `/switch proj-001` |
| `/clear` | 清除当前会话 | `/clear` |
| `/cancel` | 取消正在执行的任务 | `/cancel` |

#### 使用示例

**1. 代码审查**
```
用户: 请审查 src/index.ts 文件，看看有没有性能问题
Claude: [读取文件并分析...] 我发现以下几个可以优化的地方...
```

**2. Bug 调试**
```
用户: 我的程序报错了：TypeError: Cannot read property 'x' of undefined
Claude: [分析错误...] 让我检查相关代码...
```

**3. 功能开发**
```
用户: 帮我添加一个用户登录功能
Claude: [分析项目结构...] 我将创建以下文件...
```

**4. 代码重构**
```
用户: 重构 utils.ts，让它更易读
Claude: [读取文件...] 我建议进行以下重构...
```

### 🏗️ 架构设计

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   飞书客户端  │◄────►│  FeishuBot   │◄────►│  飞书服务器  │
└─────────────┘      └──────────────┘      └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │MessageBridge │
                     └──────────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐
         │ Commands │ │ Sessions │ │   Task   │
         │ Handler  │ │ Manager  │ │  Queue   │
         └──────────┘ └──────────┘ └──────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ClaudeExecutor│
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Claude Code  │
                     │     CLI      │
                     └──────────────┘
```

#### 核心组件

- **FeishuChannel** - 飞书消息收发通道
- **MessageBridge** - 消息路由和处理中心
- **SessionManager** - 用户会话状态管理
- **TaskQueue** - 任务队列，避免并发冲突
- **ClaudeExecutor** - Claude Code CLI 执行器
- **CommandHandler** - 命令解析和执行
- **FileWatcher** - 可选的文件监听功能

#### 目录结构

```
src/
├── channel/              # Channel 抽象层
│   ├── IChannel.interface.ts
│   └── feishu/           # 飞书实现
├── bridge/               # 核心业务逻辑
│   ├── MessageBridge.ts
│   ├── SessionManager.ts
│   ├── CommandHandler.ts
│   ├── TaskQueue.ts
│   └── FileWatcher.ts
├── claude/               # Claude 集成
│   └── ClaudeExecutor.ts
├── types/                # 类型定义
├── utils/                # 工具函数
└── index.ts              # 入口文件
```

### 📦 部署指南

#### 开发环境

```bash
npm run dev
```

#### 生产环境（PM2）

```bash
# 安装 PM2
npm install -g pm2

# 构建
npm run build

# 启动
pm2 start dist/index.js --name xt-claude-feishu

# 查看日志
pm2 logs xt-claude-feishu

# 设置开机自启
pm2 startup
pm2 save
```

#### Docker 部署

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY xtbot.json ./

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
```

```bash
npm run build
docker build -t xt-claude-feishu .
docker run -d -p 3000:3000 --name xt-claude-feishu xt-claude-feishu
```

详细的部署说明请参考 [DEPLOYMENT.md](./DEPLOYMENT.md)

### 🔧 故障排除

#### 常见问题

**Q: 启动时报错 "Claude executable file not found"**

A: 检查 `.env` 中的 `CLAUDE_EXECUTABLE_PATH` 是否正确指向 Claude CLI 可执行文件。

```bash
# 查找 Claude CLI 路径
# Windows
where claude

# Linux/macOS
which claude
```

**Q: 飞书机器人无响应**

A: 检查以下几点：
1. 飞书应用事件订阅是否配置正确
2. 服务器端口是否可从公网访问
3. 检查日志中是否有错误信息

**Q: 提示 "Security error: Claude executable path must be absolute"**

A: 确保使用绝对路径，不能使用相对路径。

**Q: 对话中断，提示预算超限**

A: 在 `xtbot.json` 中增加 `maxBudgetUsd` 的值。

更多问题请参考 [DEPLOYMENT.md#故障排除](./DEPLOYMENT.md#故障排除)

### 🛡️ 安全建议

1. **不要提交敏感信息** - 将 `xtbot.json` 和 `.env` 添加到 `.gitignore`
2. **定期更新依赖** - 使用 `npm audit` 检查安全漏洞
3. **限制管理员权限** - 只添加必要的管理员 Open ID
4. **监控预算** - 设置合理的 `maxBudgetUsd` 限制
5. **使用 HTTPS** - 生产环境建议使用反向代理配置 HTTPS

### 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

### 🙏 致谢

- [Anthropic](https://www.anthropic.com/) - 提供 Claude AI
- [飞书开放平台](https://open.feishu.cn/) - 提供机器人 API
- [Claude Code CLI](https://github.com/anthropics/claude-code) - 官方 CLI 工具

---

## English Documentation

### 📖 Introduction

XTClaudeFeiShu is an innovative bridge service that seamlessly connects Anthropic's Claude Code CLI with Feishu (Lark) bot. Through this service, users can interact with Claude directly in Feishu for code writing, debugging, project refactoring, and more.

#### Key Features

- 🤖 **Intelligent Code Assistant** - Interact with Claude in Feishu for code suggestions and solutions
- 🔄 **Real-time Message Streaming** - Support for Claude's streaming output, view thinking and execution in real-time
- 🎯 **Multi-project Management** - Configure multiple projects, users can freely switch working contexts
- 🛠️ **Flexible Tool Control** - Fine-grained control over available tools (Read, Write, Edit, Bash, etc.)
- 📊 **Budget Management** - Set conversation budget limits to avoid unexpected costs
- 🔐 **Permission Control** - Admin permission mechanism for security
- 📝 **Interactive Cards** - Beautiful Feishu card messages with tool call details
- 🔔 **File Watching** - Optional file change monitoring
- 📦 **Task Queue** - Multi-task queuing to avoid resource conflicts

### 🚀 Quick Start

#### Prerequisites

| Dependency | Version | Description |
|------------|---------|-------------|
| Node.js | >= 18.0.0 | LTS version recommended |
| npm | >= 9.0.0 | Installed with Node.js |
| Claude Code CLI | Latest | Official Anthropic CLI tool |

#### Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd XTClaudeFeiShu

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env file, configure CLAUDE_EXECUTABLE_PATH

# 4. Configure bot
cp xtbot.json.template xtbot.json
# Edit xtbot.json, configure Feishu app and project info

# 5. Start service
npm run dev  # Development mode
# or
npm run build && npm start  # Production mode
```

### 🎮 Usage

#### Basic Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/help` | Show help information | `/help` |
| `/status` | View current session status | `/status` |
| `/projects` | List all available projects | `/projects` |
| `/switch <project_id>` | Switch to specified project | `/switch proj-001` |
| `/clear` | Clear current session | `/clear` |
| `/cancel` | Cancel running task | `/cancel` |

#### Examples

**Code Review**
```
User: Please review src/index.ts for performance issues
Claude: [Reading file...] I found several optimization opportunities...
```

**Bug Debugging**
```
User: My program throws: TypeError: Cannot read property 'x' of undefined
Claude: [Analyzing error...] Let me check the related code...
```

### 🏗️ Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ Feishu App  │◄────►│  FeishuBot   │◄────►│ Feishu API  │
└─────────────┘      └──────────────┘      └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │MessageBridge │
                     └──────────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐
         │ Commands │ │ Sessions │ │   Task   │
         │ Handler  │ │ Manager  │ │  Queue   │
         └──────────┘ └──────────┘ └──────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ClaudeExecutor│
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Claude Code  │
                     │     CLI      │
                     └──────────────┘
```

#### Directory Structure

```
src/
├── channel/              # Channel abstraction layer
│   ├── IChannel.interface.ts
│   └── feishu/           # Feishu implementation
├── bridge/               # Core business logic
│   ├── MessageBridge.ts
│   ├── SessionManager.ts
│   ├── CommandHandler.ts
│   ├── TaskQueue.ts
│   └── FileWatcher.ts
├── claude/               # Claude integration
│   └── ClaudeExecutor.ts
├── types/                # Type definitions
├── utils/                # Utility functions
└── index.ts              # Entry point
```

### 📦 Deployment

For detailed deployment instructions, please refer to [DEPLOYMENT.md](./DEPLOYMENT.md)

#### Development

```bash
npm run dev
```

#### Production (PM2)

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name xt-claude-feishu
pm2 logs xt-claude-feishu
pm2 startup
pm2 save
```

#### Docker

```bash
npm run build
docker build -t xt-claude-feishu .
docker run -d -p 3000:3000 --name xt-claude-feishu xt-claude-feishu
```

### 🔧 Troubleshooting

#### Common Issues

**Q: "Claude executable file not found" error on startup**

A: Check if `CLAUDE_EXECUTABLE_PATH` in `.env` correctly points to the Claude CLI executable.

```bash
# Find Claude CLI path
# Windows
where claude

# Linux/macOS
which claude
```

**Q: Feishu bot not responding**

A: Check the following:
1. Whether Feishu app event subscription is configured correctly
2. Whether server port is accessible from public network
3. Check logs for error messages

**Q: "Security error: Claude executable path must be absolute"**

A: Make sure to use an absolute path, not a relative path.

**Q: Conversation interrupted with budget exceeded**

A: Increase the `maxBudgetUsd` value in `xtbot.json`.

For more issues, please refer to [DEPLOYMENT.md#troubleshooting](./DEPLOYMENT.md#故障排除)

### 🛡️ Security Recommendations

1. **Don't commit sensitive information** - Add `xtbot.json` and `.env` to `.gitignore`
2. **Update dependencies regularly** - Use `npm audit` to check for vulnerabilities
3. **Limit admin privileges** - Only add necessary admin Open IDs
4. **Monitor budget** - Set reasonable `maxBudgetUsd` limits
5. **Use HTTPS** - Use reverse proxy with HTTPS in production

### 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Create a Pull Request

### 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🙏 Acknowledgments

- [Anthropic](https://www.anthropic.com/) - For Claude AI
- [Feishu Open Platform](https://open.feishu.cn/) - For the bot API
- [Claude Code CLI](https://github.com/anthropics/claude-code) - Official CLI tool

---

<div align="center">

**Made with ❤️ by the XTClaudeFeiShu Team**

</div>
