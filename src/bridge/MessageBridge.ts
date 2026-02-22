import type { IChannel } from '../channel/IChannel.interface.js'
import type { Message, Bot, Project } from '../types/index.js'
import { sessionManager } from './SessionManager.js'
import { CommandHandler } from './CommandHandler.js'
import { FileWatcher, type FileChangeEvent } from './FileWatcher.js'
import { ClaudeExecutor } from '../claude/ClaudeExecutor.js'
import { logger } from '../utils/logger.js'
import fs from 'fs/promises'
import path from 'path'

export class MessageBridge {
  private commandHandler: CommandHandler
  private claudeExecutor: ClaudeExecutor
  private fileWatcher?: FileWatcher
  private runningTask: boolean = false
  private outputFiles: Array<{ name: string; path: string; size: number }> = []
  private toolCalls: Array<{ name: string; status: string }> = []
  private startTime?: number

  constructor(
    private bot: Bot,
    private channel: IChannel
  ) {
    this.commandHandler = new CommandHandler(
      bot,
      (chatId, text) => this.channel.sendText(chatId, text),
      (chatId, card) => this.channel.sendCard(chatId, card)
    )
    this.claudeExecutor = new ClaudeExecutor()
  }

  async handle(message: Message): Promise<void> {
    // Check if command first
    const isCommand = await this.commandHandler.handle(message)
    if (isCommand) return

    // Check if task already running
    if (this.runningTask) {
      await this.channel.sendText(message.chatId, 'A task is already running. Use /stop to cancel it first.')
      return
    }

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

    // Start task
    await this.executeTask(message, project)
  }

  private async executeTask(message: Message, project: Project): Promise<void> {
    this.runningTask = true
    this.outputFiles = []
    this.toolCalls = []
    this.startTime = Date.now()

    // Start file watcher
    this.fileWatcher = new FileWatcher(project.path, (event) =>
      this.handleFileChange(event, message.chatId)
    )
    this.fileWatcher.start()

    try {
      // Send thinking card
      const thinkingCard = {
        type: 'status' as const,
        content: {
          status: 'thinking' as const,
          title: 'Claude is thinking...',
          content: `Project: **${project.name}**\n\n${message.text}`
        }
      }
      await this.channel.sendCard(message.chatId, thinkingCard)

      // Get or create session
      const session = sessionManager.getSession(this.bot.id, message.userId)
      const sessionId = session?.claudeSessionId

      // Execute Claude
      let responseText = ''
      await this.claudeExecutor.execute(
        {
          query: message.text,
          images: message.images,
          sessionId,
          workingDirectory: project.path,
          allowedTools: project.allowedTools,
          maxTurns: project.maxTurns,
          maxBudgetUsd: project.maxBudgetUsd,
          enableSkills: project.enableSkills ?? false,
          settingSources: project.settingSources,
          plugins: project.plugins,
          onSkillDiscovered: (skills) => {
            logger.info({ msg: 'Skills discovered for project', project: project.name, skills })
          }
        },
        async (chunk) => {
          if (chunk.type === 'system') {
            // Skills discovered during execution
            logger.info({ msg: 'System message: skills available', skills: chunk.skills })
          } else if (chunk.type === 'content') {
            responseText += chunk.content || ''
            await this.updateCard(message.chatId, project, responseText)
          } else if (chunk.type === 'tool_use') {
            this.toolCalls.push({ name: chunk.toolName || 'unknown', status: 'running' })
            await this.updateCard(message.chatId, project, responseText)
          } else if (chunk.type === 'tool_result') {
            const lastTool = this.toolCalls[this.toolCalls.length - 1]
            if (lastTool) {
              lastTool.status = 'done'
            }
          } else if (chunk.type === 'end' && chunk.sessionId) {
            sessionManager.getOrCreateSession(
              this.bot.id,
              message.userId,
              project.id,
              chunk.sessionId
            )
          }
        }
      )

      // Final result card
      const duration = this.startTime ? Date.now() - this.startTime : 0
      await this.channel.sendCard(message.chatId, {
        type: 'result',
        content: {
          status: 'success',
          title: 'Task completed',
          content: responseText || 'Done',
          toolCalls: this.toolCalls,
          outputFiles: this.outputFiles,
          duration
        }
      })

    } catch (error) {
      logger.error({ msg: 'Task execution error', error })
      await this.channel.sendCard(message.chatId, {
        type: 'error',
        content: {
          status: 'error',
          title: 'Error',
          content: (error as Error).message
        }
      })
    } finally {
      this.runningTask = false
      this.fileWatcher?.stop()
    }
  }

  private async updateCard(chatId: string, project: Project, responseText: string): Promise<void> {
    // Throttle updates (implement simple throttle)
    // For now, just update
    const duration = this.startTime ? Date.now() - this.startTime : 0
    const card = {
      type: 'status' as const,
      content: {
        status: 'running',
        title: 'Running...',
        content: `Project: **${project.name}**\n\n${responseText || 'Working...'}`,
        toolCalls: this.toolCalls,
        duration
      }
    }
    // TODO: Store card ID and update instead of creating new
    await this.channel.sendCard(chatId, card)
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
}
