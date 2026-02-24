# 飞书机器人配置指南

本文档详细介绍如何创建和配置飞书机器人，并将其连接到 XTClaudeFeiShu 项目。

## 目录

- [前置要求](#前置要求)
- [步骤 1: 创建飞书应用](#步骤-1-创建飞书应用)
- [步骤 2: 配置权限](#步骤-2-配置权限)
- [步骤 3: 发布初始版本](#步骤-3-发布初始版本)
- [步骤 4: 配置项目](#步骤-4-配置项目)
- [步骤 5: 启动项目](#步骤-5-启动项目)
- [步骤 6: 配置事件订阅](#步骤-6-配置事件订阅)
- [步骤 7: 添加消息事件](#步骤-7-添加消息事件)
- [验证配置](#验证配置)
- [故障排除](#故障排除)

## 前置要求

- 飞书账号（需要有创建应用的权限）
- 已部署的 XTClaudeFeiShu 服务
- 管理员权限（用于配置机器人）

## 步骤 1: 创建飞书应用

### 1.1 访问飞书开放平台

1. 打开 [飞书开放平台](https://open.feishu.cn/)
2. 点击右上角「登录」，使用您的飞书账号登录
3. 登录后，点击「开发者后台」

### 1.2 创建企业自建应用

1. 点击「创建企业自建应用」
2. 填写应用基本信息：
   - **应用名称**: 例如 `Claude 代码助手`
   - **应用描述**: 例如 `智能代码助手，帮助团队提升开发效率`
   - **应用图标**: 上传一个合适的图标（建议使用 Claude 或代码相关的图标）
3. 点击「创建」

### 1.3 获取应用凭证

创建成功后，在「凭证与基础信息」页面，您将看到：

- **App ID**: `cli_xxxxxxxxxxxxxxxx`
- **App Secret**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

⚠️ **重要提示**:
- 请妥善保管 App Secret，不要泄露给他人
- 这两个值将在后续配置中使用

复制这两个值，我们将在步骤 4 中使用它们。

## 步骤 2: 配置权限

### 2.1 进入权限管理

1. 在左侧菜单中，点击「权限管理」
2. 您将看到权限列表页面

### 2.2 导入权限配置

在权限管理页面，您可以手动搜索并开通权限，或者通过 JSON 快速配置。

#### 方式一：手动配置权限

搜索并开通以下权限：（最好以方式二构建权限）

| 权限名称 | 权限标识 | 用途 |
|---------|---------|------|
| 获取与更新群组信息 | `im:chat.group:readonly` | 读取群组信息 |
| 获取群组列表 | `im:chat:readonly` | 获取机器人所在群 |
| 读取群消息 | `im:message.group_msg:readonly` | 接收群消息 |
| 发送群消息 | `im:message.group_msg` | 发送群消息 |
| 获取用户基本信息 | `contact:user.base:readonly` | 获取用户信息 |
| 上传文件 | `drive:drive:readonly` | 发送图片/文件 |
| 下载文件 | `drive:file:download` | 接收图片/文件 |

#### 方式二：通过 JSON 配置

在权限管理页面，找到「权限配置」区域，使用 JSON 快速导入：

```json
{
  "scopes": {
    "tenant": [
      "aily:file:read",
      "aily:file:write",
      "application:application.app_message_stats.overview:readonly",
      "application:application:self_manage",
      "application:bot.menu:write",
      "cardkit:card:write",
      "contact:contact.base:readonly",
      "contact:department.base:readonly",
      "contact:group:readonly",
      "contact:user.base:readonly",
      "contact:user.department:readonly",
      "contact:user.employee_id:readonly",
      "corehr:file:download",
      "event:ip_list",
      "hire:location:readonly",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.members:bot_access",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": [
      "aily:file:read",
      "aily:file:write",
      "contact:contact.base:readonly",
      "im:chat.access_event.bot_p2p_chat:read"
    ]
  }
}
```

💡 **提示**: 将上面的 JSON 复制到权限配置的输入框中，系统会自动识别并配置相应权限。

### 2.3 确认权限配置

配置完成后，确认所有权限都已正确添加。权限状态应显示为「已开通」。

## 步骤 3: 发布初始版本

为了使用机器人功能，需要先发布一个初始版本。

### 3.1 创建版本

1. 在左侧菜单中，点击「版本管理与发布」
2. 点击「创建版本」
3. 填写版本信息：
   - **版本号**: `0.0.0` （初始版本）
   - **版本描述**: `初始版本，包含基本机器人功能`
4. 点击「保存」

### 3.2 申请发布

1. 点击「申请发布」
2. 填写发布说明
3. 提交审核

⚠️ **注意**:
- 企业内部应用通常不需要审核，可以直接发布
- 如果需要审核，请等待管理员审核通过

### 3.3 确认发布状态

发布成功后，应用状态应显示为「已发布」或「可用」。

## 步骤 4: 配置项目

现在，我们需要将飞书应用的信息配置到 XTClaudeFeiShu 项目中。

### 4.1 准备配置信息

您需要以下信息：
- App ID (从步骤 1.3 获取)
- App Secret (从步骤 1.3 获取)
- 项目路径 (您要管理的代码项目的绝对路径)

### 4.2 编辑配置文件

1. 在 XTClaudeFeiShu 项目根目录，找到 `xtbot.json.template` 文件
2. 复制它并重命名为 `xtbot.json`
3. 编辑 `xtbot.json` 文件：

```json
{
  "adminOpenIds": [
    "ou_xxxxxxxxxxxxxxxx"
  ],
  "bots": [
    {
      "id": "bot-001",
      "name": "Claude 代码助手",
      "channel": "feishu",
      "feishuAppId": "cli_xxxxxxxxxxxxxxxx",
      "feishuAppSecret": "your_app_secret_here",
      "projects": [
        {
          "id": "proj-001",
          "name": "我的项目",
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

### 4.3 填写配置信息

替换以下占位符：

| 占位符 | 替换为 | 示例 |
|--------|--------|------|
| `ou_xxxxxxxxxxxxxxxx` | 您的飞书 Open ID | `ou_1234567890abcdef` |
| `cli_xxxxxxxxxxxxxxxx` | 飞书应用的 App ID | `cli_a1b2c3d4e5f6g7h8` |
| `your_app_secret_here` | 飞书应用的 App Secret | `aB1cD2eF3gH4iJ5kL6mN7oP8` |
| `/path/to/your/project` | 项目代码的绝对路径 | `D:\code\my-project` |

💡 **获取 Open ID 的方法**:
1. 在飞书中给机器人发送任意消息
2. 查看服务日志，找到类似 `userId: ou_xxxxxxxxxxxxxxxx` 的输出
3. 将该 ID 添加到 `adminOpenIds` 列表

### 4.4 配置环境变量

确保 `.env` 文件中已配置 `CLAUDE_EXECUTABLE_PATH`：

```env
# Claude Code CLI 可执行文件路径
CLAUDE_EXECUTABLE_PATH=C:\Users\<用户名>\AppData\Roaming\npm\claude.cmd

# 日志级别
LOG_LEVEL=info
```

## 步骤 5: 启动项目

### 5.1 启动服务

```bash
# 开发模式
npm run dev

# 或生产模式
npm run build
npm start
```

### 5.2 验证启动成功

查看日志，应该看到类似以下输出：

```
[INFO] Initializing bot
[INFO] Bot initialized successfully
[INFO] Started
```

如果看到这些日志，说明飞书 SDK 已通过 WebSocket 成功连接到飞书服务器。

⚠️ **重要提示**:
- 确保服务保持运行状态
- 在下一步配置事件订阅时，需要服务处于运行状态

## 步骤 6: 配置事件订阅

### 6.1 进入事件订阅配置

1. 回到飞书开放平台的「开发者后台」
2. 选择您的应用
3. 在左侧菜单中，点击「事件订阅」

### 6.2 配置订阅方式

1. 找到「订阅方式」配置区域
2. 将订阅方式设置为：「使用长连接接收事件」
3. 点击「确认」或「保存」

⚠️ **注意**:
- 如果服务未启动（步骤 5），点击确认时会提示「连接失败」或「无法连接」
- 确保服务正在运行后再进行此配置

### 6.3 验证连接状态

配置成功后，页面应显示：
- 连接状态：「已连接」或「正常」
- 连接时间：显示最近连接时间

如果显示「未连接」：
1. 检查服务是否正在运行
2. 检查 `xtbot.json` 中的 App ID 和 App Secret 是否正确
3. 重启服务并重试

## 步骤 7: 添加消息事件

### 7.1 添加事件

在「事件订阅」页面：

1. 找到「事件配置」或「添加事件」区域
2. 搜索并添加以下事件：
   - `im.message.receive_v1` - 接收消息

### 7.2 确认事件订阅

添加后，事件列表应包含：
- ✅ `im.message.receive_v1` - 接收消息

### 7.3 保存配置

点击「保存」或「确认」保存事件订阅配置。

## 验证配置

### 测试机器人

1. **在飞书中找到机器人**:
   - 在飞书搜索框中搜索您的机器人名称
   - 或通过机器人详情页的「添加到群/发送消息」功能

2. **发送测试消息**:
   - 给机器人发送一条消息，例如：`/help`
   - 或发送：`你好`

3. **检查响应**:
   - 机器人应该回复帮助信息或问候语
   - 如果没有响应，检查服务日志

### 测试代码功能

发送一个代码相关的请求：

```
请帮我查看当前项目的目录结构
```

机器人应该：
1. 读取项目目录
2. 返回目录结构信息

## 故障排除

### 问题 1: 机器人无响应

**可能原因**:
- 服务未启动
- 事件订阅配置错误
- 权限未正确配置

**解决方案**:
1. 检查服务是否正在运行
2. 确认事件订阅中包含 `im.message.receive_v1`
3. 验证所有必要权限已开通

### 问题 2: 提示权限不足

**可能原因**:
- 权限未开通
- 应用未发布

**解决方案**:
1. 检查「权限管理」页面，确认所有权限已开通
2. 确认应用已发布（步骤 3）

### 问题 3: 事件订阅连接失败

**可能原因**:
- 服务未启动
- App ID 或 App Secret 配置错误

**解决方案**:
1. 确保服务正在运行（步骤 5）
2. 检查 `xtbot.json` 中的凭证信息
3. 重启服务并重试

### 问题 4: 无法获取用户 Open ID

**解决方案**:
1. 确保机器人已启动
2. 在飞书中给机器人发送消息
3. 查看服务日志，找到 `userId` 输出
4. 将该 ID 添加到 `adminOpenIds`

### 问题 5: Claude CLI 找不到

**可能原因**:
- `CLAUDE_EXECUTABLE_PATH` 配置错误

**解决方案**:
1. 检查 Claude CLI 是否安装：`claude --version`
2. 查找 Claude CLI 路径：
   - Windows: `where claude`
   - Linux/macOS: `which claude`
3. 更新 `.env` 文件中的 `CLAUDE_EXECUTABLE_PATH`

## 下一步

配置完成后，您可以：

1. **邀请团队成员**: 将机器人添加到群聊，让团队成员使用
2. **配置多个项目**: 在 `xtbot.json` 中添加更多项目
3. **调整权限**: 根据需要调整 `allowedTools` 列表
4. **监控使用**: 通过日志监控机器人的使用情况

## 相关文档

- [README.md](./README.md) - 项目概述和快速开始
- [DEPLOYMENT.md](./DEPLOYMENT.md) - 详细部署指南
- [飞书开放平台文档](https://open.feishu.cn/document/home/introduction-to-feishu-platform/)

## 获取帮助

如遇问题，请：
1. 查看本文档的故障排除部分
2. 检查服务日志
3. 参考 [DEPLOYMENT.md](./DEPLOYMENT.md) 中的详细说明
4. 访问 [飞书开放平台文档](https://open.feishu.cn/document/)

---

**祝您使用愉快！** 🎉
