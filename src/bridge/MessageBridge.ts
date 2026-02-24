import type { IChannel } from '../channel/IChannel.interface.js'
import type { Message, Bot, Project, Session, SessionStatus } from '../types/index.js'
import { sessionManager } from './SessionManager.js'
import { CommandHandler } from './CommandHandler.js'
import { FileWatcher, type FileChangeEvent } from './FileWatcher.js'
import { ClaudeExecutor } from '../claude/ClaudeExecutor.js'
import { taskQueue, type QueuedTask } from './TaskQueue.js'
import { logger } from '../utils/logger.js'
import { buildConfirmCard, buildChoiceCard, buildInputPromptCard, formatToolDetail, type ToolCall } from '../channel/feishu/card-builder.js'
import fs from 'fs/promises'
import path from 'path'

export class MessageBridge {
  private commandHandler: CommandHandler
  private claudeExecutor: ClaudeExecutor
  private fileWatcher?: FileWatcher
  private outputFiles: Array<{ name: string; path: string; size: number }> = []
  private toolCalls: ToolCall[] = []
  private startTime?: number
  private currentCardId: string = ''
  private lastUpdateTime: number = 0
  private pendingUpdate: NodeJS.Timeout | null = null
  private pendingCardContent: any = null
  private currentTaskId?: string

  constructor(
    private bot: Bot,
    private channel: IChannel
  ) {
    this.commandHandler = new CommandHandler(
      bot,
      (chatId, text) => this.channel.sendText(chatId, text),
      (chatId, card) => this.channel.sendCard(chatId, card),
      this // 传递 MessageBridge 引用给 /status 命令
    )
    this.claudeExecutor = new ClaudeExecutor()
  }

  async handle(message: Message): Promise<void> {
    // 首先检查是否是命令
    const isCommand = await this.commandHandler.handle(message)
    if (isCommand) return

    // 获取用户选择的项目
    const projectId = sessionManager.getUserProject(
      this.bot.id,
      message.userId,
      this.bot.currentProjectId
    )
    const project = this.bot.projects.find(p => p.id === projectId)
    if (!project) {
      await this.channel.sendText(message.chatId, 'Project not found.')
      return
    }

    // 检查用户是否有活跃的会话（有 executionHandle）
    const session = sessionManager.getSession(this.bot.id, message.userId)
    if (session?.state?.executionHandle) {
      logger.info({
        msg: 'User has active session, sending as reply',
        userId: message.userId,
        status: session.state.status
      })
      // 将消息作为回复发送给 SDK
      try {
        session.state.executionHandle.sendMessage(message.text)
        sessionManager.setStatus(`${this.bot.id}:${message.userId}`, 'executing')
        await this.channel.sendText(message.chatId, '已收到你的回复，继续执行...')
        await this.resumeExecution(session)
        return
      } catch (error) {
        logger.error({ msg: 'Error sending reply to SDK', error })
      }
    }

    // 检查该机器人的项目是否已有任务在运行
    if (taskQueue.isRunning(this.bot.id, project.id)) {
      // 将任务加入队列 - 它会等待
      const queuedTask = taskQueue.enqueue(this.bot.id, project.id, message, project)

      // 向用户发送已排队的通知
      await this.channel.sendText(message.chatId,
        `任务已加入队列。当前位置: 第 ${queuedTask.position! + 1} 位\n当前有任务正在执行，请稍候...`
      )

      logger.info({
        msg: 'Task queued',
        taskId: queuedTask.id,
        position: queuedTask.position
      })

      return
    }

    // 没有任务运行，立即执行
    const task = taskQueue.enqueue(this.bot.id, project.id, message, project)
    await this.executeTask(task)
  }

  /**
   * 在当前任务完成后处理队列中的下一个任务
   */
  private async processNextTask(botId: string, projectId: string): Promise<void> {
    // 处理下一个任务前稍等片刻
    await new Promise(resolve => setTimeout(resolve, 1000))

    const nextTask = taskQueue.getNext(botId, projectId)
    if (nextTask) {
      logger.info({
        msg: 'Starting next task from queue',
        taskId: nextTask.id
      })

      // 通知用户他们的任务开始了
      await this.channel.sendText(nextTask.message.chatId, '轮到你的任务了，开始执行...')

      await this.executeTask(nextTask)
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    const { message, project } = task
    const taskDisplayId = task.id.slice(5, 18) // 用于显示的短 ID（时间戳部分），在 catch 块中也可访问
    this.currentTaskId = task.id
    this.outputFiles = []
    this.toolCalls = []
    this.startTime = Date.now()
    this.currentCardId = ''
    this.lastUpdateTime = 0
    this.pendingUpdate = null
    this.pendingCardContent = null

    // 启动文件监听器
    this.fileWatcher = new FileWatcher(project.path, (event) =>
      this.handleFileChange(event, message.chatId)
    )
    this.fileWatcher.start()

    try {
      // 发送思考中卡片并保存卡片 ID
      const thinkingCard = {
        type: 'status' as const,
        content: {
          status: 'thinking' as const,
          title: `正在思考... [${taskDisplayId}]`,
          content: `项目: **${project.name}**\n\n${message.text}`
        }
      }
      this.currentCardId = await this.channel.sendCard(message.chatId, thinkingCard)
      logger.info({ msg: 'Initial card sent', cardId: this.currentCardId })

      // 获取或创建会话
      const session = sessionManager.getSession(this.bot.id, message.userId)
      const sessionId = session?.claudeSessionId

      // 使用 startExecution 进行多轮执行
      let responseText = ''
      const abortController = new AbortController()

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

      // 保存执行句柄到会话状态
      const sessionKey = `${this.bot.id}:${message.userId}`
      sessionManager.setState(sessionKey, {
        status: 'executing' as SessionStatus,
        currentTaskId: task.id,
        executionHandle,
        chatId: message.chatId,
        expiresAt: Date.now() + 30 * 60 * 1000 // 30 分钟总超时
      })

      // 处理来自生成器的消息
      for await (const sdkMessage of executionHandle.stream) {
        if (abortController.signal.aborted) {
          logger.debug(`zhongguanhui :[${taskDisplayId}]被终止`)
          break
        }

        // 检查用户输入请求
        if (sdkMessage.type === 'user_input_required') {
          logger.debug(`zhongguanhui :[${taskDisplayId}]需要用户输入`)
          await this.handleUserInputRequest(sessionKey, sdkMessage, message.chatId)
          break // 暂停执行
        }

        // 检查结果消息 - 执行完成
        if (sdkMessage.type === 'result') {
          logger.info({ msg: 'Result message received, breaking loop', result_type: sdkMessage.result_type })
          // 保存 session_id
          if (sdkMessage.session_id) {
            sessionManager.getOrCreateSession(
              this.bot.id,
              message.userId,
              project.id,
              sdkMessage.session_id
            )
          }
          break // 退出循环
        }

        // 处理其他 SDK 消息类型
        // logger.debug(`zhongguanhui :[${taskDisplayId}]其他消息`)
        await this.processSDKMessage(sdkMessage, message.chatId, project.id, taskDisplayId, responseText, (text) => {
          responseText = text
        })
      }

      // 如果正常完成（非等待用户输入），处理完成逻辑
      const currentState = sessionManager.getState(sessionKey)
      if (currentState && currentState.status !== 'waiting_input' && currentState.status !== 'waiting_confirm') {
        await this.handleExecutionComplete(sessionKey, task, message.chatId, message.userId, project.id, responseText)
      }

      logger.info({ msg: 'Claude execute finished', responseTextLength: responseText.length })

      // 在发送最终卡片之前清除所有待处理的更新
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate)
        this.pendingUpdate = null
      }

      // 确保所有工具状态为完成（用于未调用 handleExecutionComplete 的情况）
      for (const tool of this.toolCalls) {
        if (tool.status === 'running') {
          tool.status = 'done'
        }
      }

      // 最终结果卡片 - 更新现有卡片
      logger.info({ msg: 'Preparing final result card', currentCardId: this.currentCardId })
      const duration = this.startTime ? Date.now() - this.startTime : 0
      const finalCard = {
        type: 'result' as const,
        content: {
          status: 'success' as const,
          title: `任务完成 [${taskDisplayId}]`,
          content: responseText || '完成',
          toolCalls: this.toolCalls,
          outputFiles: this.outputFiles,
          duration
        }
      }

      if (this.currentCardId) {
        logger.info({ msg: 'Updating final result card', cardId: this.currentCardId })
        await this.channel.updateCard(message.chatId, this.currentCardId, finalCard)
        logger.info({ msg: 'Final result card updated successfully' })
      } else {
        logger.info({ msg: 'Sending final result card as new card' })
        this.currentCardId = await this.channel.sendCard(message.chatId, finalCard)
        logger.info({ msg: 'Final result card sent successfully', cardId: this.currentCardId })
      }

      // 标记任务为已完成
      taskQueue.complete(task.id!)

      // 处理队列中的下一个任务
      await this.processNextTask(this.bot.id, project.id)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      logger.error({ msg: 'Task execution error', error: errorMessage, stack: errorStack })

      // 使用统一的错误处理
      await this.handleExecutionError(`${this.bot.id}:${message.userId}`, task, message.chatId, errorMessage, this.bot.id, project.id)

    } finally {
      this.fileWatcher?.stop()
      // 重置状态
      this.lastUpdateTime = 0
      this.pendingUpdate = null
      this.pendingCardContent = null
      this.currentTaskId = undefined
    }
  }

  private async updateCard(chatId: string, project: Project, responseText: string, taskDisplayId: string = ''): Promise<void> {
    // 如果有 cardId 则使用 updateCard，否则发送新卡片
    const duration = this.startTime ? Date.now() - this.startTime : 0
    const card = {
      type: 'status' as const,
      content: {
        status: 'running',
        title: `执行中...(${taskDisplayId})`,
        content: `项目: **${project.name}**\n\n${responseText || '工作中...'}`,
        toolCalls: this.toolCalls,
        duration
      }
    }

    // 节流更新以避免飞书速率限制
    const now = Date.now()
    const timeSinceLastUpdate = now - this.lastUpdateTime
    const minUpdateInterval = 1000 // 更新间隔 1 秒

    // 存储待处理的卡片内容
    this.pendingCardContent = { chatId, card }

    if (timeSinceLastUpdate < minUpdateInterval) {
      // 安排稍后更新
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate)
      }
      this.pendingUpdate = setTimeout(async () => {
        await this.doUpdateCard()
      }, minUpdateInterval - timeSinceLastUpdate)
      return
    }

    // 清除所有待处理的超时并立即更新
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate)
      this.pendingUpdate = null
    }

    await this.doUpdateCard()
  }

  private async doUpdateCard(): Promise<void> {
    if (!this.pendingCardContent) return

    const { chatId, card } = this.pendingCardContent
    this.pendingCardContent = null

    logger.info({ msg: 'doUpdateCard called', currentCardId: this.currentCardId })

    if (this.currentCardId) {
      // 更新现有卡片
      await this.channel.updateCard(chatId, this.currentCardId, card)
      this.lastUpdateTime = Date.now()
    } else {
      // 发送新卡片（后备方案）
      logger.warn({ msg: 'No cardId, sending new card instead of update' })
      this.currentCardId = await this.channel.sendCard(chatId, card)
      this.lastUpdateTime = Date.now()
    }
  }

  private async handleFileChange(event: FileChangeEvent, chatId: string): Promise<void> {
    try {
      const stats = await fs.stat(event.path)
      const fileName = path.basename(event.path)

      this.outputFiles.push({
        name: fileName,
        path: event.path,
        size: stats.size
      })

      await this.channel.sendFile(chatId, event.path)
      logger.info({ msg: 'File sent', path: event.path, size: stats.size })
    } catch (error) {
      logger.error({ msg: 'Error handling file change', error, path: event.path })
    }
  }

  /**
   * 获取当前用户项目的队列状态
   */
  getQueueStatus(message: Message): { stats: any; tasks: any[] } | null {
    const projectId = sessionManager.getUserProject(
      this.bot.id,
      message.userId,
      this.bot.currentProjectId
    )
    if (!projectId) return null

    const project = this.bot.projects.find(p => p.id === projectId)
    if (!project) return null

    const stats = taskQueue.getStats(this.bot.id, project.id)
    const tasks = taskQueue.getTasks(this.bot.id, project.id)

    return {
      stats,
      tasks: tasks.map(t => ({
        id: t.id,
        status: t.status,
        queuedAt: t.queuedAt,
        position: t.position,
        isMine: t.message.userId === message.userId
      }))
    }
  }

  /**
   * 处理用户输入请求
   */
  private async handleUserInputRequest(sessionKey: string, sdkMessage: any, chatId: string): Promise<void> {
    const inputType = sdkMessage.input_type || 'text'
    const prompt = sdkMessage.prompt || '请输入：'
    const options = sdkMessage.options || []

    logger.info({ msg: 'User input required', inputType, prompt })

    let card

    if (inputType === 'confirmation') {
      card = {
        type: 'status' as const,
        content: buildConfirmCard(prompt, options)
      }
      sessionManager.setStatus(sessionKey, 'waiting_confirm' as SessionStatus)
    } else if (inputType === 'choice') {
      card = {
        type: 'status' as const,
        content: buildChoiceCard(prompt, options)
      }
      sessionManager.setStatus(sessionKey, 'waiting_confirm' as SessionStatus)
    } else {
      card = {
        type: 'status' as const,
        content: buildInputPromptCard(prompt)
      }
      sessionManager.setStatus(sessionKey, 'waiting_input' as SessionStatus)
    }

    // 更新状态，包含请求信息和超时
    sessionManager.setState(sessionKey, {
      inputRequest: { type: inputType, prompt, options },
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 分钟超时
    })

    // 发送卡片
    const cardId = await this.channel.sendCard(chatId, card)
    logger.info({ msg: 'Input request card sent', cardId, inputType })
  }

  /**
   * 恢复执行
   */
  async resumeExecution(session: Session): Promise<void> {
    if (!session.state?.executionHandle) {
      logger.error({ msg: 'No execution handle to resume' })
      return
    }

    const { executionHandle } = session.state
    const project = this.bot.projects.find(p => p.id === session.projectId)
    if (!project) {
      logger.error({ msg: 'Project not found for resume', projectId: session.projectId })
      return
    }

    logger.info({ msg: 'Resuming execution after user input' })

    try {
      let responseText = ''
      // 继续处理消息流
      let taskDisplayId = '恢复执行，无法获取taskid'
      for await (const sdkMessage of executionHandle.stream) {
        const currentState = sessionManager.getState(`${session.botId}:${session.userId}`)
        if (this.currentTaskId && currentState?.executionHandle) {
          // 检查结果消息 - 执行完成
          if (sdkMessage.type === 'result') {
            logger.info({ msg: 'Result message received in resume, breaking loop', result_type: sdkMessage.result_type })
            // 保存 session_id
            if (sdkMessage.session_id) {
              sessionManager.getOrCreateSession(
                session.botId,
                session.userId,
                session.projectId,
                sdkMessage.session_id
              )
            }
            break // 退出循环
          }

          await this.processSDKMessage(sdkMessage, currentState.chatId, session.projectId, taskDisplayId, responseText, (text) => {
            responseText = text
          })
        }
      }

      // 执行完成
      const sessionKey = `${session.botId}:${session.userId}`
      const currentState = sessionManager.getState(sessionKey)
      if (currentState) {
        const task = taskQueue.getTasks(session.botId, session.projectId).find(t => t.id === currentState.currentTaskId)
        if (task) {
          await this.handleExecutionComplete(sessionKey, task, currentState.chatId, session.userId, session.projectId, responseText)
        }
      }
    } catch (error) {
      await this.handleExecutionError(`${session.botId}:${session.userId}`, null, session.state?.chatId || '', String(error), session.botId, session.projectId)
    }
  }

  /**
   * 处理 SDK 消息（提取的通用逻辑）
   */
  private async processSDKMessage(sdkMessage: any, chatId: string, projectId: string, taskDisplayId: string, currentResponseText: string, updateResponseText: (text: string) => void): Promise<void> {
    const project = this.bot.projects.find(p => p.id === projectId)
    if (!project) return

    if (sdkMessage.type === 'system') {
      // 发现技能
      if (sdkMessage.subtype === 'init' || sdkMessage.subtype === 'config_change') {
        const skills = (sdkMessage as any).skills || (sdkMessage as any).slash_commands || []
        if (skills.length > 0) {
          logger.info({ msg: 'System message: skills available', skills })
        }
      }
    } else if (sdkMessage.type === 'stream_event') {
      // 流式内容增量
      const event = sdkMessage.event
      if (event?.type === 'content_block_delta') {
        const delta = event.delta
        if (delta?.type === 'text_delta' && delta.text) {
          // 累积文本：在当前文本基础上追加增量
          const newText = currentResponseText + delta.text
          updateResponseText(newText)
          // 传递累积的完整文本给 updateCard
          await this.updateCard(chatId, project, newText, taskDisplayId)
        }
      } else if (event?.type === 'content_block_start') {
        const block = event.content_block
        if (block?.type === 'tool_use' && block.name) {
          // 流事件中的 tool_use 可能没有 input，先添加占位
          this.addToolCall(block.name, undefined)
          await this.updateCard(chatId, project, currentResponseText, taskDisplayId)
        }
      }
    } else if (sdkMessage.type === 'assistant') {
      // 完整的助手消息
      const content = sdkMessage.message?.content
      if (content) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            // 累积文本：在当前文本基础上追加
            const newText = currentResponseText + block.text
            updateResponseText(newText)
            // 传递累积的完整文本给 updateCard
            await this.updateCard(chatId, project, newText, taskDisplayId)
          } else if (block.type === 'tool_use' && block.name) {
            // assistant 消息中的 tool_use 通常包含完整的 input
            this.addToolCall(block.name, block.input)
            await this.updateCard(chatId, project, currentResponseText, taskDisplayId)
          } else if (block.type === 'tool_result') {
            // 工具执行完成，将最后一个运行中的工具标记为完成
            this.completeLastTool()
            await this.updateCard(chatId, project, currentResponseText, taskDisplayId)
          }
        }
      }
    }
    // 注意: result 消息现在在主循环中处理，不会传递到这里
  }

  /**
   * 处理执行完成
   */
  private async handleExecutionComplete(
    sessionKey: string,
    task: QueuedTask | null,
    chatId: string,
    _userId: string,
    projectId: string,
    responseText: string
  ): Promise<void> {
    const project = this.bot.projects.find(p => p.id === projectId)
    if (!project) return

    // 将所有运行中的工具标记为完成
    for (const tool of this.toolCalls) {
      if (tool.status === 'running') {
        tool.status = 'done'
      }
    }

    // 清除状态
    sessionManager.clearState(sessionKey)

    // 在发送最终卡片之前清除所有待处理的更新
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate)
      this.pendingUpdate = null
    }

    // 最终结果卡片 - 更新现有卡片
    logger.info({ msg: 'Preparing final result card', currentCardId: this.currentCardId })
    const duration = this.startTime ? Date.now() - this.startTime : 0
    const taskDisplayId = task?.id.slice(5, 18) || 'unknown'
    const finalCard = {
      type: 'result' as const,
      content: {
        status: 'success' as const,
        title: `任务完成 [${taskDisplayId}]`,
        content: responseText || '完成',
        toolCalls: this.toolCalls,
        outputFiles: this.outputFiles,
        duration
      }
    }

    if (this.currentCardId) {
      logger.info({ msg: 'Updating final result card', cardId: this.currentCardId })
      await this.channel.updateCard(chatId, this.currentCardId, finalCard)
      logger.info({ msg: 'Final result card updated successfully' })
    } else {
      logger.info({ msg: 'Sending final result card as new card' })
      this.currentCardId = await this.channel.sendCard(chatId, finalCard)
      logger.info({ msg: 'Final result card sent successfully', cardId: this.currentCardId })
    }

    // 标记任务为已完成
    if (task) {
      taskQueue.complete(task.id!)
    }

    // 处理队列中的下一个任务
    await this.processNextTask(this.bot.id, project.id)
  }

  /**
   * 处理执行错误
   */
  private async handleExecutionError(
    sessionKey: string,
    task: QueuedTask | null,
    chatId: string,
    errorMessage: string,
    botId: string,
    projectId: string
  ): Promise<void> {
    // 清除状态
    sessionManager.clearState(sessionKey)

    // 标记任务为失败
    if (task) {
      taskQueue.fail(task.id!, errorMessage)
    }

    // 在发送错误卡片之前清除所有待处理的更新
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate)
      this.pendingUpdate = null
    }

    const taskDisplayId = task?.id.slice(5, 18) || 'unknown'
    const errorCard = {
      type: 'error' as const,
      content: {
        status: 'error' as const,
        title: `错误 [${taskDisplayId}]`,
        content: errorMessage
      }
    }

    if (this.currentCardId) {
      await this.channel.updateCard(chatId, this.currentCardId, errorCard)
    } else {
      this.currentCardId = await this.channel.sendCard(chatId, errorCard)
    }

    // 即使此任务失败，仍处理下一个任务
    await this.processNextTask(botId, projectId)
  }

  /**
   * 添加工具调用记录
   * 每次工具调用都是独立记录，即使同名工具也分别记录
   */
  private addToolCall(name: string, input: unknown): void {
    this.toolCalls.push({
      name,
      detail: input !== undefined ? formatToolDetail(name, input) : '',
      status: 'running'
    })
  }

  /**
   * 将最后一个运行中的工具标记为完成
   * 当收到 tool_result 消息时调用
   */
  private completeLastTool(): void {
    // 从后往前找最后一个状态为 running 的工具
    for (let i = this.toolCalls.length - 1; i >= 0; i--) {
      if (this.toolCalls[i].status === 'running') {
        this.toolCalls[i].status = 'done'
        break
      }
    }
  }
}
