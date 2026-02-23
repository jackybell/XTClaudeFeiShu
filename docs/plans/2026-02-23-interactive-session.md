# Interactive Session System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Claude Code SDK to request user input (confirmation, text, choice) during execution and receive responses via Feishu messages/cards.

**Architecture:** Extend MessageBridge with state machine, use startExecution() for ongoing sessions, route user messages to SDK based on session state, adapt Feishu card callbacks to message format.

**Tech Stack:** TypeScript, Node.js, @anthropic-ai/claude-agent-sdk, @larksuiteoapi/node-sdk, pino logger

---

## Task 1: Extend Type Definitions

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add session status enum and state interface**

```typescript
// Add after existing type definitions

export enum SessionStatus {
  IDLE = 'idle',
  EXECUTING = 'executing',
  WAITING_INPUT = 'waiting_input',
  WAITING_CONFIRM = 'waiting_confirm'
}

export interface InputRequest {
  type: 'confirmation' | 'text' | 'choice'
  prompt: string
  options?: string[]
}

export interface SessionState {
  status: SessionStatus
  currentTaskId: string
  executionHandle?: any  // Will be ExecutionHandle from ClaudeExecutor
  inputRequest?: InputRequest
  expiresAt: number
  chatId: string
}
```

**Step 2: Update Session interface to include state**

```typescript
// Update existing Session interface
export interface Session {
  botId: string
  userId: string
  projectId: string
  claudeSessionId: string
  createdAt: Date
  lastActiveAt: Date
  state?: SessionState  // Add this
}
```

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add session status and state types for interactive sessions"
```

---

## Task 2: Extend SessionManager with State Management

**Files:**
- Modify: `src/bridge/SessionManager.ts`

**Step 1: Add state management methods**

```typescript
// Add after existing methods

setStatus(sessionKey: string, status: SessionStatus): void {
  const session = this.sessions.get(sessionKey)
  if (session) {
    if (!session.state) {
      session.state = {
        status: SessionStatus.IDLE,
        currentTaskId: '',
        expiresAt: 0,
        chatId: ''
      }
    }
    session.state.status = status
    logger.info({ msg: 'Session status updated', sessionKey, status })
  }
}

getState(sessionKey: string): SessionState | undefined {
  const session = this.sessions.get(sessionKey)
  return session?.state
}

setState(sessionKey: string, state: Partial<SessionState>): void {
  const session = this.sessions.get(sessionKey)
  if (session) {
    if (!session.state) {
      session.state = {
        status: SessionStatus.IDLE,
        currentTaskId: '',
        expiresAt: 0,
        chatId: ''
      }
    }
    Object.assign(session.state, state)
    logger.info({ msg: 'Session state updated', sessionKey, state })
  }
}

clearState(sessionKey: string): void {
  const session = this.sessions.get(sessionKey)
  if (session) {
    session.state = undefined
    logger.info({ msg: 'Session state cleared', sessionKey })
  }
}
```

**Step 2: Add timeout checker**

```typescript
// Add as private method
private startTimeoutChecker(): void {
  setInterval(() => {
    const now = Date.now()
    for (const [key, session] of this.sessions.entries()) {
      if (session.state && session.state.expiresAt && now > session.state.expiresAt) {
        if (session.state.status !== SessionStatus.IDLE) {
          logger.warn({ msg: 'Session timed out', key, expiresAt: session.state.expiresAt })

          // Cancel execution if handle exists
          if (session.state.executionHandle) {
            try {
              session.state.executionHandle.finish()
            } catch (e) {
              logger.error({ msg: 'Error finishing timed out session', error: e })
            }
          }

          this.clearState(key)
        }
      }
    }
  }, 30000) // Check every 30 seconds
}

// Add to constructor or initialization
constructor() {
  // ... existing code
  this.startTimeoutChecker()
}
```

**Step 3: Commit**

```bash
git add src/bridge/SessionManager.ts
git commit -m "feat: add state management and timeout checker to SessionManager"
```

---

## Task 3: Extend ExecutionHandle with sendMessage

**Files:**
- Modify: `src/claude/ClaudeExecutor.ts`

**Step 1: Add sendMessage to ExecutionHandle interface**

```typescript
// Update ExecutionHandle interface
export interface ExecutionHandle {
  stream: AsyncGenerator<SDKMessage>
  sendAnswer(toolUseId: string, sessionId: string, answerText: string): void
  sendMessage(text: string): void  // Add this
  finish(): void
}
```

**Step 2: Implement sendMessage in startExecution**

```typescript
// Find the return statement in startExecution method
// Add sendMessage method before finish

return {
  stream: wrapStream(),
  sendAnswer: (toolUseId: string, sid: string, answerText: string) => {
    // ... existing code
  },
  sendMessage: (text: string) => {
    logger.info({ msg: 'Sending user message to SDK', text })
    const userMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user' as const,
        content: text,
      },
      parent_tool_use_id: null,
      session_id: sessionId || '',
    }
    inputQueue.enqueue(userMessage)
  },
  finish: () => {
    inputQueue.finish()
  },
}
```

**Step 3: Commit**

```bash
git add src/claude/ClaudeExecutor.ts
git commit -m "feat: add sendMessage to ExecutionHandle for user input"
```

---

## Task 4: Add Interactive Card Templates

**Files:**
- Modify: `src/channel/feishu/card-builder.ts`

**Step 1: Add confirmation card template**

```typescript
// Add after existing buildCard function

export function buildConfirmCard(prompt: string, options: string[] = ['确认', '取消']): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '请确认' },
      template: 'yellow'
    },
    elements: [{
      tag: 'div',
      text: { tag: 'lark_md', content: `**${prompt}**` }
    }, {
      tag: 'hr'
    }, {
      tag: 'action',
      actions: options.map(opt => ({
        tag: 'button',
        text: { tag: 'plain_text', content: opt },
        value: opt.toLowerCase()
      }))
    }]
  }
}
```

**Step 2: Add choice card template**

```typescript
export function buildChoiceCard(prompt: string, options: string[]): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '请选择' },
      template: 'blue'
    },
    elements: [{
      tag: 'div',
      text: { tag: 'lark_md', content: `**${prompt}**` }
    }, {
      tag: 'hr'
    }, {
      tag: 'action',
      actions: options.map((opt, idx) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: opt },
        value: `option_${idx}`
      }))
    }]
  }
}
```

**Step 3: Add input prompt card template**

```typescript
export function buildInputPromptCard(prompt: string): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '需要输入' },
      template: 'grey'
    },
    elements: [{
      tag: 'div',
      text: { tag: 'lark_md', content: `**${prompt}**\n\n请直接回复消息` }
    }]
  }
}
```

**Step 4: Commit**

```bash
git add src/channel/feishu/card-builder.ts
git commit -m "feat: add interactive card templates (confirm, choice, input)"
```

---

## Task 5: Add Card Callback Handling

**Files:**
- Modify: `src/channel/feishu/FeishuChannel.ts`

**Step 1: Add card callback event detection**

```typescript
// Update handleEvent method to detect card callbacks

private async handleEvent(event: any): Promise<void> {
  try {
    // ... existing event ID extraction and deduplication code ...

    // Check for card callback event
    const eventType = event?.header?.event_type || event?.event_type

    if (eventType === 'card.action.triggered') {
      // Handle card callback
      await this.handleCardCallback(event)
      return
    }

    // ... rest of existing event handling ...
  } catch (error: any) {
    logger.error({ msg: 'Error handling event', error })
  }
}
```

**Step 2: Add handleCardCallback method**

```typescript
private async handleCardCallback(event: any): Promise<void> {
  try {
    const action = event.action
    const userId = event.triggered_user_id?.open_id || event.sender?.sender_id?.open_id
    const chatId = event.open_chat_id || event.token?.chat_id

    if (!userId || !chatId) {
      logger.error({ msg: 'Invalid card callback event', event })
      return
    }

    // Extract button value
    const actionValue = action?.value || action?.text

    // Create message from callback
    const message: Message = {
      chatId,
      userId,
      userName: userId,
      text: actionValue,
      messageType: 'private',
      rawEvent: event
    }

    logger.info({ msg: 'Card callback converted to message', actionValue, userId })

    if (this.messageCallback) {
      await this.messageCallback(message)
    }
  } catch (error: any) {
    logger.error({ msg: 'Error handling card callback', error })
  }
}
```

**Step 3: Commit**

```bash
git add src/channel/feishu/FeishuChannel.ts
git commit -m "feat: add card callback event handling"
```

---

## Task 6: Add Message Routing Logic

**Files:**
- Modify: `src/bridge/CommandHandler.ts`

**Step 1: Add session state check at start of handle**

```typescript
async handle(message: Message): Promise<boolean> {
  // First check if user has a waiting session
  const sessionKey = `${this.bot.id}:${message.userId}`
  const session = sessionManager.getSession(this.bot.id, message.userId)

  if (session?.state) {
    const { status, executionHandle } = session.state

    // Check if waiting for input
    if (status === 'waiting_input' || status === 'waiting_confirm') {
      // Check if it's a command (user wants to cancel)
      const command = this.parseCommand(message.text)
      if (command) {
        // User sent a command, cancel waiting
        logger.info({ msg: 'Command received during waiting, canceling waiting', command })
        if (executionHandle) {
          executionHandle.finish()
        }
        sessionManager.clearState(sessionKey)

        // Execute the command
        const handled = await this.executeCommand(message, command)
        return handled
      }

      // Send user response to SDK
      await this.sendUserResponse(session, message)
      return true
    }
  }

  // Normal command handling
  const isCommand = await this.executeCommand(message, this.parseCommand(message.text))
  return isCommand
}
```

**Step 2: Rename existing handle to executeCommand and add sendUserResponse**

```typescript
// Rename the existing handle method logic to executeCommand
private async executeCommand(message: Message, command: Command | null): Promise<boolean> {
  if (!command) {
    return false
  }

  logger.info({ msg: 'Command received', type: command.type, args: command.args, userId: message.userId })

  // ... existing switch statement and handler calls ...
  return true
}

// Add new method to handle user response
private async sendUserResponse(session: Session, message: Message): Promise<void> {
  const { executionHandle, inputRequest, chatId } = session.state!

  if (!executionHandle) {
    await this.channelSendText(chatId, '会话已过期，请重新开始')
    return
  }

  logger.info({ msg: 'Sending user response to SDK', text: message.text })

  try {
    // Send response to SDK
    executionHandle.sendMessage(message.text)

    // Update state back to executing
    sessionManager.setStatus(session.bot.id + ':' + session.userId, 'executing')

    // Notify user
    await this.channelSendText(chatId, '已收到你的回复，继续执行...')
  } catch (error) {
    logger.error({ msg: 'Error sending response to SDK', error })
    await this.channelSendText(chatId, `发送响应失败: ${error}`)
  }
}
```

**Step 3: Commit**

```bash
git add src/bridge/CommandHandler.ts
git commit -m "feat: add session state routing for user responses"
```

---

## Task 7: Refactor MessageBridge to Use startExecution

**Files:**
- Modify: `src/bridge/MessageBridge.ts`

**Step 1: Update executeTask to use startExecution and handle SDK requests**

```typescript
// Replace the existing executeTask method's SDK execution part
// Find the section where it calls this.claudeExecutor.execute
// Replace with startExecution and add request detection

// Change from:
const stream = this.claudeExecutor.execute({ ... })

// To:
const executionHandle = this.claudeExecutor.startExecution({
  prompt: message.text,
  cwd: project.path,
  sessionId,
  abortController,
  allowedTools: project.allowedTools,
  maxTurns: project.maxTurns,
  maxBudgetUsd: project.maxBudgetUsd,
  enableSkills: project.enableSkills ?? false,
  settingSources: project.settingSources,
  plugins: project.plugins,
})

// Save handle to session state
const sessionKey = `${this.bot.id}:${message.userId}`
sessionManager.setState(sessionKey, {
  status: 'executing',
  currentTaskId: task.id,
  executionHandle,
  chatId: message.chatId,
  expiresAt: Date.now() + 30 * 60 * 1000 // 30 min total timeout
})

// Process messages from the generator
for await (const sdkMessage of executionHandle.stream) {
  if (abortController.signal.aborted) break

  // Check for user input requests
  if (sdkMessage.type === 'user_input_required') {
    await this.handleUserInputRequest(sessionKey, sdkMessage, message.chatId)
    break // Pause execution
  }

  // ... existing message type handling ...
}
```

**Step 2: Add handleUserInputRequest method**

```typescript
private async handleUserInputRequest(sessionKey: string, sdkMessage: any, chatId: string): Promise<void> {
  const inputType = sdkMessage.input_type || 'text'
  const prompt = sdkMessage.prompt || '请输入：'
  const options = sdkMessage.options || []

  logger.info({ msg: 'User input required', inputType, prompt })

  let card

  if (inputType === 'confirmation') {
    card = {
      type: 'status',
      content: buildConfirmCard(prompt, options)
    }
    sessionManager.setStatus(sessionKey, 'waiting_confirm')
  } else if (inputType === 'choice') {
    card = {
      type: 'status',
      content: buildChoiceCard(prompt, options)
    }
    sessionManager.setStatus(sessionKey, 'waiting_confirm')
  } else {
    card = {
      type: 'status',
      content: buildInputPromptCard(prompt)
    }
    sessionManager.setStatus(sessionKey, 'waiting_input')
  }

  // Update state with request info and timeout
  sessionManager.setState(sessionKey, {
    inputRequest: { type: inputType, prompt, options },
    expiresAt: Date.now() + 5 * 60 * 1000 // 5 min timeout
  })

  // Send card
  const cardId = await this.channel.sendCard(chatId, card)
  logger.info({ msg: 'Input request card sent', cardId, inputType })
}
```

**Step 3: Add resumeExecution method**

```typescript
private async resumeExecution(session: Session): Promise<void> {
  if (!session.state?.executionHandle) {
    logger.error({ msg: 'No execution handle to resume' })
    return
  }

  const { executionHandle } = session.state
  const message = session as any // Has chatId from context

  logger.info({ msg: 'Resuming execution after user input' })

  try {
    // Continue processing message stream
    for await (const sdkMessage of executionHandle.stream) {
      if (this.currentTaskId && session.state?.executionHandle) {
        await this.processSDKMessage(sdkMessage, message.chatId, session.projectId)
      }
    }

    // Execution completed
    await this.handleExecutionComplete(session)
  } catch (error) {
    await this.handleExecutionError(session, error)
  }
}

// Extract common message processing logic from existing executeTask
private async processSDKMessage(sdkMessage: any, chatId: string, projectId: string): Promise<void> {
  // ... existing SDK message processing code ...
  // (handle stream_event, assistant, result types)
}

// Extract completion logic
private async handleExecutionComplete(session: Session): Promise<void> {
  const sessionKey = `${session.botId}:${session.userId}`
  sessionManager.clearState(sessionKey)

  // ... existing completion code ...
  // (send final card, process next task)
}

// Extract error handling logic
private async handleExecutionError(session: Session, error: any): Promise<void> {
  const sessionKey = `${session.botId}:${session.userId}`
  sessionManager.clearState(sessionKey)

  // ... existing error handling code ...
}
```

**Step 4: Update sendUserResponse in CommandHandler to resume execution**

```typescript
private async sendUserResponse(session: Session, message: Message): Promise<void> {
  // ... existing code to send message to SDK ...

  // After sending, trigger resume
  if (this.messageBridge) {
    await this.messageBridge.resumeExecution(session)
  }
}
```

**Step 5: Commit**

```bash
git add src/bridge/MessageBridge.ts src/bridge/CommandHandler.ts
git commit -m "feat: implement state machine and resume execution for user input"
```

---

## Task 8: Export New Functions

**Files:**
- Modify: `src/channel/feishu/card-builder.ts`

**Step 1: Export new card builder functions**

```typescript
// Add exports at top of file
export { buildCard } from './card-builder'
export { buildConfirmCard, buildChoiceCard, buildInputPromptCard } from './card-builder'
```

**Step 2: Update imports in MessageBridge**

```typescript
// Update import in MessageBridge.ts
import { buildCard, buildConfirmCard, buildChoiceCard, buildInputPromptCard } from '../channel/feishu/card-builder.js'
```

**Step 3: Commit**

```bash
git add src/channel/feishu/card-builder.ts src/bridge/MessageBridge.ts
git commit -m "fix: export new card builder functions"
```

---

## Task 9: Testing

**Files:**
- Create: `tests/integration/interactive-session.test.ts`

**Step 1: Write integration test for confirmation flow**

```typescript
import { describe, it, expect } from '@jest/globals'

describe('Interactive Session', () => {
  it('should handle confirmation request', async () => {
    // Test that:
    // 1. SDK sends confirmation request
    // 2. Card is sent to user
    // 3. Session state is updated to waiting_confirm
    // 4. User clicks button
    // 5. Response is sent to SDK
    // 6. Execution resumes
  })

  it('should handle text input request', async () => {
    // Test text input flow
  })

  it('should handle choice request', async () => {
    // Test choice selection flow
  })

  it('should timeout after 5 minutes', async () => {
    // Test timeout behavior
  })

  it('should cancel on command during waiting', async () => {
    // Test that /stop cancels waiting
  })
})
```

**Step 2: Manual testing checklist**

```bash
# Start the bot
npm start

# Test 1: Confirmation
# (Send task that triggers confirmation)
# Expected: Confirm card appears
# (Click confirm button)
# Expected: Execution continues

# Test 2: Text Input
# (Send task that requires file name)
# Expected: Input prompt card appears
# (Reply with filename)
# Expected: Execution continues

# Test 3: Timeout
# (Send request that needs input)
# (Wait 5 minutes without responding)
# Expected: Timeout message, execution cancelled

# Test 4: Cancel with command
# (During waiting, send /stop)
# Expected: Task cancelled
```

**Step 3: Commit**

```bash
git add tests/integration/interactive-session.test.ts
git commit -m "test: add interactive session integration tests"
```

---

## Final Steps

1. **Run all tests**
   ```bash
   npm test
   ```

2. **Manual testing in Feishu**
   - Test all three input types
   - Verify timeout works
   - Verify command cancellation works

3. **Update documentation**
   ```bash
   # Update docs/interactive-session-design.md with implementation notes
   ```

4. **Final commit**
   ```bash
   git add -A
   git commit -m "feat: complete interactive session system implementation"
   ```

---

## Implementation Notes

- **SDK Message Format**: Actual SDK message format may differ from assumed format. Adjust `handleUserInputRequest` to match actual SDK messages.
- **Card Callback Structure**: Feishu card callback event structure may vary. Add logging to verify actual structure during testing.
- **Session Cleanup**: Ensure sessions are cleaned up properly after completion, timeout, or cancellation.
- **Error Recovery**: Add proper error handling for cases where execution handle becomes invalid.
