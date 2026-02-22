import type { Command, Message, Bot } from '../types/index.js'
import { sessionManager } from './SessionManager.js'
import { logger } from '../utils/logger.js'

export class CommandHandler {
  constructor(
    private bot: Bot,
    private channelSendText: (chatId: string, text: string) => Promise<void>,
    private channelSendCard: (chatId: string, card: any) => Promise<void>
  ) {}

  parseCommand(text: string): Command | null {
    const trimmed = text.trim()

    if (!trimmed.startsWith('/')) {
      return null
    }

    const parts = trimmed.split(/\s+/)
    const command = parts[0].slice(1) // Remove /
    const args = parts.slice(1)
    const options: { clear?: boolean } = {}

    // Parse options
    const clearIndex = args.indexOf('--clear')
    if (clearIndex !== -1) {
      options.clear = true
      args.splice(clearIndex, 1)
    }

    const validCommands = ['switch', 'reset', 'stop', 'help']
    if (!validCommands.includes(command)) {
      return null
    }

    return { type: command as any, args, options }
  }

  async handle(message: Message): Promise<boolean> {
    const command = this.parseCommand(message.text)
    if (!command) {
      return false
    }

    logger.info({ msg: 'Command received', type: command.type, args: command.args, userId: message.userId })

    switch (command.type) {
      case 'switch':
        await this.handleSwitch(message, command)
        break
      case 'reset':
        await this.handleReset(message)
        break
      case 'stop':
        await this.handleStop(message)
        break
      case 'help':
        await this.handleHelp(message)
        break
    }

    return true
  }

  private async handleSwitch(message: Message, command: Command): Promise<void> {
    const projectName = command.args[0]

    if (!projectName) {
      const projects = this.bot.projects.map(p => `- ${p.name}`).join('\n')
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: 'Available Projects',
          content: `Current: **${this.getCurrentProjectName()}**\n\nAvailable projects:\n${projects}\n\nUsage: \`/switch <project-name> [--clear]\``
        }
      })
      return
    }

    const project = this.bot.projects.find(p => p.name === projectName || p.id === projectName)

    if (!project) {
      await this.channelSendText(message.chatId, `Project "${projectName}" not found. Use /help to see available projects.`)
      return
    }

    // Update user's project selection
    sessionManager.setUserProject(this.bot.id, message.userId, project.id)

    // Handle --clear option
    if (command.options.clear) {
      sessionManager.deleteSession(this.bot.id, message.userId)
    }

    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: 'Project Switched',
        content: `Switched to **${project.name}**\nPath: \`${project.path}\`\n\n${command.options.clear ? 'Previous session cleared.' : 'Previous session preserved.'}`
      }
    })
  }

  private async handleReset(message: Message): Promise<void> {
    sessionManager.deleteSession(this.bot.id, message.userId)
    await this.channelSendText(message.chatId, 'Session reset. Next message will start a fresh conversation.')
  }

  private async handleStop(message: Message): Promise<void> {
    // TODO: Implement stopping running tasks
    await this.channelSendText(message.chatId, 'Stop functionality coming soon.')
  }

  private async handleHelp(message: Message): Promise<void> {
    const projects = this.bot.projects.map(p => `- ${p.name}`).join('\n')
    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: 'Available Commands',
        content: `**/switch <project> [--clear]** - Switch project\n**/reset** - Reset current session\n**/stop** - Stop current task\n**/help** - Show this help\n\nAvailable projects:\n${projects}`
      }
    })
  }

  private getCurrentProjectName(): string {
    const project = this.bot.projects.find(p => p.id === this.bot.currentProjectId)
    return project?.name || 'Unknown'
  }
}
