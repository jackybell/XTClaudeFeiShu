# 交互式会话系统设计方案

## 需求背景

Claude Code SDK 在执行过程中需要用户交互：
- 确认类（是/否）：删除文件、运行危险命令等
- 文字输入类：请输入文件名、请描述功能等
- 选择类：选择一个选项 [1/2/3]

飞书是异步消息系统，不能像 CLI 那样实时等待输入，需要设计异步确认机制。

## 核心设计

### 会话状态机

```
┌─────────────────────────────────────────────────────────────┐
│                      会话状态管理                              │
├─────────────────────────────────────────────────────────────┤
│  IDLE              → 空闲，可以接收新任务                      │
│  EXECUTING         → 执行中，接收 SDK 消息流                   │
│  WAITING_INPUT     → 等待用户文本输入                         │
│  WAITING_CONFIRM   → 等待用户确认（按钮）                      │
└─────────────────────────────────────────────────────────────┘
```

### 消息处理流程

```
用户消息
    ↓
检查会话状态
    ├─ IDLE → 创建新任务
    ├─ WAITING_INPUT → 发送用户输入到 SDK，继续执行
    └─ EXECUTING → 忽略（或排队）

SDK 消息流
    ├─ 正常输出 → 发送给用户
    ├─ 请求输入 → 切换到 WAITING_INPUT
    └─ 请求确认 → 发送卡片，切换到 WAITING_CONFIRM
```

## 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `types/index.ts` | 添加会话状态枚举，会话数据结构 |
| `SessionManager.ts` | 添加会话状态管理（set/get 状态） |
| `ClaudeExecutor.ts` | 扩展 `ExecutionHandle`，添加 `sendMessage()` 方法 |
| `MessageBridge.ts` | 改用 `startExecution()`，实现状态机，处理 SDK 消息 |
| `CommandHandler.ts` | 检查会话状态，路由消息到新任务或确认响应 |
| `card-builder.ts` | 添加输入提示卡片、确认卡片模板 |
| `FeishuChannel.ts` | 支持卡片按钮回调处理 |

## 关键实现要点

### 1. 消息路由

```typescript
// MessageBridge.handle()
async handle(message: Message): Promise<void> {
  const session = sessionManager.getSession(this.bot.id, message.userId)

  if (session?.status === 'WAITING_INPUT') {
    // 用户回复是对 SDK 的响应
    await this.handleUserResponse(message, session)
    return
  }

  // 否则作为新任务处理
  await this.handleNewTask(message)
}
```

### 2. SDK 请求检测

```typescript
// SDK 消息类型
type: 'user_input_required'    // 需要文本输入
type: 'confirmation_required'  // 需要确认

// 处理逻辑
if (sdkMessage.type === 'user_input_required') {
  sessionManager.setStatus(sessionId, 'WAITING_INPUT')
  await sendCard("请回复: " + sdkMessage.prompt)
}
```

### 3. 响应发送

```typescript
// 使用 ExecutionHandle 的方法
async handleUserResponse(message: Message, session: Session) {
  const handle = session.executionHandle
  handle.sendMessage(message.text)

  // 恢复执行状态
  sessionManager.setStatus(session.id, 'EXECUTING')

  // 继续处理消息流
  for await (const msg of handle.stream) {
    await this.processSDKMessage(msg)
  }
}
```

### 4. ClaudeExecutor 扩展

```typescript
export interface ExecutionHandle {
  stream: AsyncGenerator<SDKMessage>
  sendAnswer(toolUseId: string, sessionId: string, answerText: string): void
  sendMessage(text: string): void  // 新增：发送用户文本
  finish(): void
}

// 实现
sendMessage(text: string): void {
  const userMessage: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: text
    },
    parent_tool_use_id: null,
    session_id: this.sessionId || ''
  }
  this.inputQueue.enqueue(userMessage)
}
```

### 5. 超时处理

```typescript
// 设置 5 分钟超时
const timeout = setTimeout(() => {
  if (session.status === 'WAITING_INPUT') {
    executionHandle.finish()
    sessionManager.setStatus(session.id, 'IDLE')
    await sendCard("操作超时，已取消")
  }
}, 5 * 60 * 1000)

// 用户响应后清除超时
clearTimeout(timeout)
```

### 6. 卡片按钮交互

```typescript
// 确认卡片模板
{
  "header": { "title": { "content": "请确认", "tag": "plain_text" } },
  "elements": [{
    "tag": "action",
    "actions": [
      { "tag": "button", "text": { "content": "确认", "tag": "plain_text" }, "value": "confirm" },
      { "tag": "button", "text": { "content": "取消", "tag": "plain_text" }, "value": "cancel", "type": "danger" }
    ]
  }]
}

// 按钮回调处理
async handleCardCallback(action: { value: string }) {
  if (action.value === 'confirm') {
    executionHandle.sendMessage("yes")
  } else {
    executionHandle.sendMessage("no")
  }
}
```

## 用户交互示例

```
Bot: 正在执行任务...
Bot: [卡片] 发现危险操作：是否删除文件 test.js？
         [确认] [取消]

User: [点击确认]

Bot: 继续执行...
Bot: [卡片] 请输入新的文件名：

User: newFile.js

Bot: 继续执行...
Bot: 任务完成
```

## 实现优先级

1. **Phase 1**: 基础状态管理和消息路由
2. **Phase 2**: SDK 请求检测和处理
3. **Phase 3**: 卡片按钮交互
4. **Phase 4**: 超时和错误处理

## 注意事项

- 需要处理并发问题（同一用户多个会话）
- 需要处理会话持久化（进程重启后恢复）
- 需要处理卡片按钮回调的 URL 验证
- 需要考虑飞书卡片按钮的交互限制
