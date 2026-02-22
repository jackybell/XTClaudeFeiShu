# XT Claude Code with Feishu

桥接服务，将飞书机器人连接到 Claude Code CLI，支持多项目切换和用户级会话隔离。

## 功能特性

- 多机器人支持，每个机器人可配置多个项目
- 用户级会话隔离，每个用户独立选择项目
- 通过 `/switch <项目名> [--clear]` 切换项目
- 文件变更自动检测并发送
- 可扩展的 Channel 架构（当前支持飞书）

## 技术栈

- TypeScript + Node.js 18+
- @anthropic-ai/claude-agent-sdk
- @larksuiteoapi/node-sdk
- pino（日志）
- chokidar（文件监听）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

复制示例配置文件：

```bash
cp xtbot.json.example xtbot.json
```

编辑 `xtbot.json`，填入你的飞书机器人信息和项目路径：

```json
{
  "adminOpenIds": ["ou_xxx", "ou_yyy"],
  "bots": [
    {
      "id": "bot-001",
      "name": "开发机器人",
      "channel": "feishu",
      "feishuAppId": "cli_xxxxxxxxx",
      "feishuAppSecret": "xxxxxxxxxxxxxxxxxx",
      "projects": [
        {
          "id": "proj-001",
          "name": "H5商城",
          "path": "/path/to/your/project",
          "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"]
        }
      ],
      "currentProjectId": "proj-001"
    }
  ]
}
```

### 3. 运行

开发模式（热重载）：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

## 命令

- `/switch <项目名> [--clear]` - 切换项目
- `/reset` - 重置当前会话
- `/stop` - 停止当前任务
- `/help` - 显示帮助

## 配置说明

### xtbot.json

| 字段 | 说明 |
|------|------|
| `adminOpenIds` | 管理员 OpenID 列表 |
| `bots` | 机器人配置数组 |
| `bots[].id` | 机器人唯一标识 |
| `bots[].name` | 机器人名称 |
| `bots[].channel` | 渠道类型（当前仅支持 "feishu"） |
| `bots[].feishuAppId` | 飞书 App ID |
| `bots[].feishuAppSecret` | 飞书 App Secret |
| `bots[].projects` | 项目配置数组 |
| `bots[].projects[].id` | 项目唯一标识 |
| `bots[].projects[].name` | 项目名称 |
| `bots[].projects[].path` | 项目路径 |
| `bots[].projects[].allowedTools` | 允许的工具列表 |
| `bots[].currentProjectId` | 默认项目 ID |

### .env

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOG_LEVEL` | 日志级别 | `info` |

## 架构

```
src/
├── channel/              # Channel 抽象层
│   ├── IChannel.interface.ts
│   └── feishu/           # 飞书实现
├── bridge/               # 核心业务逻辑
│   ├── MessageBridge.ts
│   ├── SessionManager.ts
│   ├── CommandHandler.ts
│   └── FileWatcher.ts
├── claude/               # Claude 集成
│   └── ClaudeExecutor.ts
├── types/                # 类型定义
├── utils/                # 工具函数
└── index.ts              # 入口文件
```

## License

MIT
