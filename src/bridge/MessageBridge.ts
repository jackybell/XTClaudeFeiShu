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
          title: `玄瞳开发助手正在思考... [${taskDisplayId}]`,
          content: `项目: **${project.name}**\n\n${message.text}`
        }
      }
      this.currentCardId = await this.channel.sendCard(message.chatId, thinkingCard)
      logger.info({ msg: 'Initial card sent', cardId: this.currentCardId })

      // 获取或创建会话
      const session = sessionManager.getSession(this.bot.id, message.userId)
      const sessionId = session?.claudeSessionId

      // 使用异步生成器执行 Claude
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

      // 处理来自生成器的消息
      for await (const sdkMessage of stream) {
        if (abortController.signal.aborted) break

        // 处理来自 SDK 的不同消息类型
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
          // 完整的助手消息
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
          // 执行结果
          logger.info({ msg: 'Result message received', result_type: sdkMessage.result_type })

          if (sdkMessage.result_type === 'error_during_execution') {
            logger.error({ msg: 'Execution error', error: sdkMessage.error })
            throw new Error(`Execution error: ${sdkMessage.error || 'Unknown error'}`)
          } else if (sdkMessage.result_type === 'error_max_turns') {
            throw new Error(`Max turns (${sdkMessage.max_turns}) exceeded`)
          } else if (sdkMessage.result_type === 'error_max_budget_usd') {
            throw new Error(`Max budget ($${sdkMessage.max_budget_usd}) exceeded`)
          }

          // 成功完成 - 保存会话
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

      // 在发送最终卡片之前清除所有待处理的更新
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate)
        this.pendingUpdate = null
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

      // 标记任务为失败
      taskQueue.fail(task.id!, errorMessage)

      // 在发送错误卡片之前清除所有待处理的更新
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

      // 即使此任务失败，仍处理下一个任务
      await this.processNextTask(this.bot.id, project.id)

    } finally {
      this.fileWatcher?.stop()
      // 重置状态
      this.lastUpdateTime = 0
      this.pendingUpdate = null
      this.pendingCardContent = null
      this.currentTaskId = undefined
    }
  }

  private async updateCard(chatId: string, project: Project, responseText: string): Promise<void> {
    // 如果有 cardId 则使用 updateCard，否则发送新卡片
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

    // 节流更新以避免飞书速率限制
    const now = Date.now()
    const timeSinceLastUpdate = now - this.lastUpdateTime
    const minUpdateInterval = 5000 // 更新间隔 5 秒

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
}
