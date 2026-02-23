import type { IChannel } from '../channel/IChannel.interface.js'
import type { Message, Bot, Project } from '../types/index.js'
import { sessionManager } from './SessionManager.js'
import { CommandHandler } from './CommandHandler.js'
import { FileWatcher, type FileChangeEvent } from './FileWatcher.js'
import { ClaudeExecutor, type SDKMessage } from '../claude/ClaudeExecutor.js'
import { taskQueue, type QueuedTask } from './TaskQueue.js'
import { logger } from '../utils/logger.js'
import fs from 'fs/promises'
import path from 'path'

export class MessageBridge {
  private commandHandler: CommandHandler
  private claudeExecutor: ClaudeExecutor
  private fileWatcher?: FileWatcher
  private outputFiles: Array<{ name: string; path: string; size: number }> = []
  private toolCalls: Array<{ name: string; status: string }> = []
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
      this // Pass MessageBridge reference for /status command
    )
    this.claudeExecutor = new ClaudeExecutor()
  }

  async handle(message: Message): Promise<void> {
    // Check if command first
    const isCommand = await this.commandHandler.handle(message)
    if (isCommand) return

    // Get user's selected project
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

    // Check if a task is already running for this bot/project
    if (taskQueue.isRunning(this.bot.id, project.id)) {
      // Enqueue task - it will wait
      const queuedTask = taskQueue.enqueue(this.bot.id, project.id, message, project)

      // Send queued notification to user
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

    // No task running, execute immediately
    const task = taskQueue.enqueue(this.bot.id, project.id, message, project)
    await this.executeTask(task)
  }

  /**
   * Process next task in queue after current task completes
   */
  private async processNextTask(botId: string, projectId: string): Promise<void> {
    // Wait a bit before processing next task
    await new Promise(resolve => setTimeout(resolve, 1000))

    const nextTask = taskQueue.getNext(botId, projectId)
    if (nextTask) {
      logger.info({
        msg: 'Starting next task from queue',
        taskId: nextTask.id
      })

      // Notify user that their task is starting
      await this.channel.sendText(nextTask.message.chatId, '轮到你的任务了，开始执行...')

      await this.executeTask(nextTask)
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    const { message, project } = task
    const taskDisplayId = task.id.slice(5, 18) // Short ID for display (timestamp portion), accessible in catch block
    this.currentTaskId = task.id
    this.outputFiles = []
    this.toolCalls = []
    this.startTime = Date.now()
    this.currentCardId = ''
    this.lastUpdateTime = 0
    this.pendingUpdate = null
    this.pendingCardContent = null

    // Start file watcher
    this.fileWatcher = new FileWatcher(project.path, (event) =>
      this.handleFileChange(event, message.chatId)
    )
    this.fileWatcher.start()

    try {
      // Send thinking card and save card ID
      const thinkingCard = {
        type: 'status' as const,
        content: {
          status: 'thinking' as const,
          title: `思考中... [${taskDisplayId}]`,
          content: `项目: **${project.name}**\n\n${message.text}`
        }
      }
      this.currentCardId = await this.channel.sendCard(message.chatId, thinkingCard)
      logger.info({ msg: 'Initial card sent', cardId: this.currentCardId })

      // Get or create session
      const session = sessionManager.getSession(this.bot.id, message.userId)
      const sessionId = session?.claudeSessionId

      // Execute Claude using async generator
      let responseText = ''
      const abortController = new AbortController()

      const stream = this.claudeExecutor.execute({
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

      // Process messages from the generator
      for await (const sdkMessage of stream) {
        if (abortController.signal.aborted) break

        // Handle different message types from SDK
        if (sdkMessage.type === 'system') {
          // Skills discovered
          if (sdkMessage.subtype === 'init' || sdkMessage.subtype === 'config_change') {
            const skills = (sdkMessage as any).skills || (sdkMessage as any).slash_commands || []
            if (skills.length > 0) {
              logger.info({ msg: 'System message: skills available', skills })
            }
          }
        } else if (sdkMessage.type === 'stream_event') {
          // Streaming content delta
          const event = sdkMessage.event
          if (event?.type === 'content_block_delta') {
            const delta = event.delta
            if (delta?.type === 'text_delta' && delta.text) {
              responseText += delta.text
              await this.updateCard(message.chatId, project, responseText)
            }
          } else if (event?.type === 'content_block_start') {
            const block = event.content_block
            if (block?.type === 'tool_use') {
              this.toolCalls.push({ name: block.name || 'unknown', status: 'running' })
              await this.updateCard(message.chatId, project, responseText)
            }
          }
        } else if (sdkMessage.type === 'assistant') {
          // Full assistant message
          const content = sdkMessage.message?.content
          if (content) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                responseText += block.text
                await this.updateCard(message.chatId, project, responseText)
              } else if (block.type === 'tool_use') {
                this.toolCalls.push({ name: block.name || 'unknown', status: 'running' })
                await this.updateCard(message.chatId, project, responseText)
              }
            }
          }
        } else if (sdkMessage.type === 'result') {
          // Execution result
          logger.info({ msg: 'Result message received', result_type: sdkMessage.result_type })

          if (sdkMessage.result_type === 'error_during_execution') {
            logger.error({ msg: 'Execution error', error: sdkMessage.error })
            throw new Error(`Execution error: ${sdkMessage.error || 'Unknown error'}`)
          } else if (sdkMessage.result_type === 'error_max_turns') {
            throw new Error(`Max turns (${sdkMessage.max_turns}) exceeded`)
          } else if (sdkMessage.result_type === 'error_max_budget_usd') {
            throw new Error(`Max budget ($${sdkMessage.max_budget_usd}) exceeded`)
          }

          // Successful completion - save session
          if (sdkMessage.session_id) {
            sessionManager.getOrCreateSession(
              this.bot.id,
              message.userId,
              project.id,
              sdkMessage.session_id
            )
          }
        }
      }

      logger.info({ msg: 'Claude execute finished', responseTextLength: responseText.length })

      // Clear any pending update before sending final card
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate)
        this.pendingUpdate = null
      }

      // Final result card - update existing card
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

      // Mark task as completed
      taskQueue.complete(task.id!)

      // Process next task in queue
      await this.processNextTask(this.bot.id, project.id)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      logger.error({ msg: 'Task execution error', error: errorMessage, stack: errorStack })

      // Mark task as failed
      taskQueue.fail(task.id!, errorMessage)

      // Clear any pending update before sending error card
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate)
        this.pendingUpdate = null
      }

      const errorCard = {
        type: 'error' as const,
        content: {
          status: 'error' as const,
          title: `错误 [${taskDisplayId}]`,
          content: errorMessage
        }
      }

      if (this.currentCardId) {
        await this.channel.updateCard(message.chatId, this.currentCardId, errorCard)
      } else {
        this.currentCardId = await this.channel.sendCard(message.chatId, errorCard)
      }

      // Still process next task even if this one failed
      await this.processNextTask(this.bot.id, project.id)

    } finally {
      this.fileWatcher?.stop()
      // Reset state
      this.lastUpdateTime = 0
      this.pendingUpdate = null
      this.pendingCardContent = null
      this.currentTaskId = undefined
    }
  }

  private async updateCard(chatId: string, project: Project, responseText: string): Promise<void> {
    // Use updateCard if we have a cardId, otherwise send new card
    const duration = this.startTime ? Date.now() - this.startTime : 0
    const card = {
      type: 'status' as const,
      content: {
        status: 'running',
        title: '执行中...',
        content: `项目: **${project.name}**\n\n${responseText || '工作中...'}`,
        toolCalls: this.toolCalls,
        duration
      }
    }

    // Throttle updates to avoid Feishu rate limit
    const now = Date.now()
    const timeSinceLastUpdate = now - this.lastUpdateTime
    const minUpdateInterval = 5000 // 5 seconds between updates

    // Store pending card content
    this.pendingCardContent = { chatId, card }

    if (timeSinceLastUpdate < minUpdateInterval) {
      // Schedule update for later
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate)
      }
      this.pendingUpdate = setTimeout(async () => {
        await this.doUpdateCard()
      }, minUpdateInterval - timeSinceLastUpdate)
      return
    }

    // Clear any pending timeout and do immediate update
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
      // Update existing card
      await this.channel.updateCard(chatId, this.currentCardId, card)
      this.lastUpdateTime = Date.now()
    } else {
      // Send new card (fallback)
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
   * Get queue status for current user's project
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
}
