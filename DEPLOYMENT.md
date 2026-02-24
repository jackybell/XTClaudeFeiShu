# 部署指南

本文档介绍如何部署 XTClaudeFeiShu - 一个将飞书机器人连接到 Claude Code CLI 的桥接服务。

## 目录

- [环境要求](#环境要求)
- [飞书应用配置](#飞书应用配置)
- [项目配置](#项目配置)
- [部署步骤](#部署步骤)
- [运行与监控](#运行与监控)
- [故障排除](#故障排除)

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 18.0.0 | 推荐使用 LTS 版本 |
| npm | >= 9.0.0 | 随 Node.js 安装 |
| Claude Code CLI | 最新版 | Anthropic 官方 CLI 工具 |

### 检查环境

```bash
# 检查 Node.js 版本
node --version

# 检查 npm 版本
npm --version

# 检查 Claude Code CLI 是否安装
claude --version
```

## 飞书应用配置

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 进入「开发者后台」→「创建企业自建应用」
3. 填写应用名称和描述

### 2. 获取凭证

在应用「凭证与基础信息」页面获取：
- **App ID**: `cli_xxxxxxxxxxxxxxxx`
- **App Secret**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 3. 配置权限

在「权限管理」中开通以下权限：

| 权限名称 | 权限标识 | 用途 |
|----------|----------|------|
| 获取与更新群组信息 | `im:chat.group:readonly` | 读取群组信息 |
| 获取群组列表 | `im:chat:readonly` | 获取机器人所在群 |
| 读取群消息 | `im:message.group_msg:readonly` | 接收群消息 |
| 发送群消息 | `im:message.group_msg` | 发送群消息 |
| 获取用户信息 | `contact:user.base:readonly` | 获取用户基本信息 |
| 上传图片 | `drive:drive:readonly` | 发送图片/文件 |
| 下载图片 | `drive:file:download` | 接收图片/文件 |

### 4. 配置事件订阅

1. 在「事件订阅」页面开启事件订阅
2. 配置请求网址（部署后填写，格式：`http://your-server:port/webhook/feishu`）
3. 订阅以下事件：
   - `im.message.receive_v1` - 接收消息

### 5. 发布应用

1. 在「版本管理与发布」中创建版本
2. 提交审核并通过
3. 在「应用能力」→「机器人」中启用机器人能力

## 项目配置

### 1. 克隆项目

```bash
git clone <repository-url>
cd XTClaudeFeiShu
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# Claude Code CLI 可执行文件路径（必填）
# Windows 示例
CLAUDE_EXECUTABLE_PATH=C:\Users\<用户名>\AppData\Roaming\npm\claude.cmd
# Linux/macOS 示例
# CLAUDE_EXECUTABLE_PATH=/usr/local/bin/claude

# 日志级别（可选）
# 可选值: trace, debug, info, warn, error, fatal
LOG_LEVEL=info
```

### 4. 配置机器人

复制配置模板：

```bash
cp xtbot.json.template xtbot.json
```

编辑 `xtbot.json` 文件：

```json
{
  "adminOpenIds": [
    "ou_xxxxxxxxxxxxxxxx"
  ],
  "bots": [
    {
      "id": "bot-001",
      "name": "机器人名称",
      "channel": "feishu",
      "feishuAppId": "cli_xxxxxxxxxxxxxxxx",
      "feishuAppSecret": "your_app_secret_here",
      "projects": [
        {
          "id": "proj-001",
          "name": "项目名称",
          "path": "/path/to/your/project",
          "allowedTools": [
            "Read",
            "Edit",
            "Write",
            "Glob",
            "Grep",
            "Bash"
          ],
          "maxTurns": 100,
          "maxBudgetUsd": 1.5,
          "enableSkills": true,
          "settingSources": ["user", "project"],
          "plugins": []
        }
      ],
      "currentProjectId": "proj-001"
    }
  ]
}
```

#### 配置项说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `adminOpenIds` | string[] | 是 | 管理员的飞书 Open ID 列表 |
| `bots[].id` | string | 是 | 机器人唯一标识 |
| `bots[].name` | string | 是 | 机器人显示名称 |
| `bots[].channel` | string | 是 | 固定为 `feishu` |
| `bots[].feishuAppId` | string | 是 | 飞书应用 App ID |
| `bots[].feishuAppSecret` | string | 是 | 飞书应用 App Secret |
| `projects[].id` | string | 是 | 项目唯一标识 |
| `projects[].name` | string | 是 | 项目显示名称 |
| `projects[].path` | string | 是 | 项目代码的绝对路径 |
| `projects[].allowedTools` | string[] | 是 | 允许 Claude 使用的工具列表 |
| `projects[].maxTurns` | number | 否 | 最大对话轮次，默认 100 |
| `projects[].maxBudgetUsd` | number | 否 | 最大预算（美元），默认 1.5 |
| `projects[].enableSkills` | boolean | 否 | 是否启用技能，默认 false |

#### 获取管理员 Open ID

1. 在飞书中给机器人发送任意消息
2. 查看日志，找到类似以下的输出：
   ```
   userId: ou_xxxxxxxxxxxxxxxx
   ```
3. 将该 ID 添加到 `adminOpenIds` 列表

## 部署步骤

### 开发环境

```bash
# 开发模式（支持热重载）
npm run dev
```

### 生产环境

```bash
# 编译 TypeScript
npm run build

# 启动服务
npm start
```

### 使用 PM2 部署（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/index.js --name xt-claude-feishu

# 查看状态
pm2 status

# 查看日志
pm2 logs xt-claude-feishu

# 设置开机自启
pm2 startup
pm2 save
```

### Docker 部署（可选）

创建 `Dockerfile`：

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

构建并运行：

```bash
# 构建
npm run build
docker build -t xt-claude-feishu .

# 运行
docker run -d \
  --name xt-claude-feishu \
  -p 3000:3000 \
  -e CLAUDE_EXECUTABLE_PATH=/usr/local/bin/claude \
  -v /path/to/xtbot.json:/app/xtbot.json \
  xt-claude-feishu
```

## 运行与监控

### 健康检查

服务启动后会监听配置的端口，可以通过以下方式检查：

```bash
# 检查进程
ps aux | grep node

# 检查端口（默认 3000）
netstat -tlnp | grep 3000
```

### 日志管理

日志输出到标准输出，支持以下级别：
- `trace` - 最详细
- `debug` - 调试信息
- `info` - 常规信息（推荐）
- `warn` - 警告
- `error` - 错误
- `fatal` - 致命错误

通过 `LOG_LEVEL` 环境变量控制。

## 故障排除

### 常见问题

#### 1. Claude CLI 找不到

**症状**: 启动时报错 `Claude executable file not found`

**解决方案**:
```bash
# 检查 Claude CLI 是否安装
claude --version

# 确认 .env 中的路径正确
# Windows: 注意使用双反斜杠或正斜杠
CLAUDE_EXECUTABLE_PATH=C:\\Users\\<用户名>\\AppData\\Roaming\\npm\\claude.cmd
# 或
CLAUDE_EXECUTABLE_PATH=C:/Users/<用户名>/AppData/Roaming/npm/claude.cmd
```

#### 2. 飞书消息接收不到

**症状**: 机器人无响应

**解决方案**:
1. 检查飞书应用事件订阅是否配置正确
2. 确认服务器端口可从公网访问
3. 检查日志中是否有事件接收记录
4. 确认机器人已添加到群聊或在私聊中

#### 3. 权限错误

**症状**: `Security error: Claude executable path must be absolute`

**解决方案**:
确保 `CLAUDE_EXECUTABLE_PATH` 是绝对路径，不能是相对路径。

#### 4. 预算超限

**症状**: 对话中断，提示预算超限

**解决方案**:
在 `xtbot.json` 中调整 `maxBudgetUsd` 值。

#### 5. 内存泄漏

**症状**: 服务运行一段时间后内存持续增长

**解决方案**:
1. 重启服务
2. 检查是否有长时间运行的会话未正确清理
3. 考虑使用 PM2 的内存限制重启策略

### 获取帮助

如遇问题，请提供以下信息：
1. Node.js 版本 (`node --version`)
2. 操作系统版本
3. 完整的错误日志
4. 复现步骤

## 安全建议

1. **不要提交敏感信息**: 将 `xtbot.json` 和 `.env` 添加到 `.gitignore`
2. **定期更新依赖**: `npm audit` 检查安全漏洞
3. **限制管理员权限**: 只添加必要的管理员 Open ID
4. **监控预算**: 设置合理的 `maxBudgetUsd` 限制
5. **使用 HTTPS**: 生产环境建议使用反向代理配置 HTTPS
