import type { Command, Message, Bot } from '../types/index.js'
import { sessionManager } from './SessionManager.js'
import { configManager } from '../config.js'
import { logger } from '../utils/logger.js'
import fs from 'fs/promises'

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
    let subCommand: 'list' | 'add' | 'remove' | undefined

    // Parse sub-command for /projects
    if (command === 'projects' && args.length > 0) {
      const sub = args[0]
      if (sub === 'list' || sub === 'add' || sub === 'remove') {
        subCommand = sub
      }
    }

    // Parse options
    const clearIndex = args.indexOf('--clear')
    if (clearIndex !== -1) {
      options.clear = true
      args.splice(clearIndex, 1)
    }

    const validCommands = ['switch', 'reset', 'stop', 'help', 'skills', 'projects']
    if (!validCommands.includes(command)) {
      return null
    }

    return { type: command as any, args, options, subCommand }
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
      case 'skills':
        await this.handleSkills(message)
        break
      case 'projects':
        await this.handleProjects(message, command)
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
        content: `**/switch <project> [--clear]** - Switch project\n**/reset** - Reset current session\n**/stop** - Stop current task\n**/skills** - List available skills\n**/projects [list|add|remove]** - Manage projects\n**/help** - Show this help\n\nAvailable projects:\n${projects}`
      }
    })
  }

  private async handleSkills(message: Message): Promise<void> {
    const projectId = sessionManager.getUserProject(
      this.bot.id,
      message.userId,
      this.bot.currentProjectId
    )
    const project = this.bot.projects.find(p => p.id === projectId)

    if (!project) {
      await this.channelSendText(message.chatId, 'Project not found.')
      return
    }

    if (!project.enableSkills) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: 'Skills Not Enabled',
          content: `Skills are not enabled for project **${project.name}**.\n\nTo enable skills, set \`enableSkills: true\` in the project configuration.`
        }
      })
      return
    }

    const skillInfo = [
      `**Project:** ${project.name}`,
      `**Skills Enabled:** ${project.enableSkills ? 'Yes' : 'No'}`,
      `**Setting Sources:** ${project.settingSources?.join(', ') || 'Not configured'}`,
      `**Plugins:** ${project.plugins?.length || 0} configured`
    ].join('\n')

    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: 'Skills Configuration',
        content: skillInfo
      }
    })
  }

  private async handleProjects(message: Message, command: Command): Promise<void> {
    const subCommand = command.subCommand

    if (!subCommand) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: 'Projects Commands',
          content: `**/projects list** - List all projects\n**/projects add <id> <name> <path>** - Add a new project (admin only)\n**/projects remove <id>** - Remove a project (admin only)\n\nUsage:\n\`/projects add proj-003 "My Project" /path/to/project\``
        }
      })
      return
    }

    switch (subCommand) {
      case 'list':
        await this.handleProjectsList(message)
        break
      case 'add':
        await this.handleProjectsAdd(message, command)
        break
      case 'remove':
        await this.handleProjectsRemove(message, command)
        break
    }
  }

  private async handleProjectsList(message: Message): Promise<void> {
    const projectsList = this.bot.projects.map(p => {
      const isCurrent = p.id === this.bot.currentProjectId
      const skillsStatus = p.enableSkills ? '✓' : '✗'
      return [
        `${isCurrent ? '→' : ' '} **${p.name}** (\`${p.id}\`)`,
        `   Path: \`${p.path}\``,
        `   Skills: ${skillsStatus}`,
        `   Tools: ${p.allowedTools.length} allowed`
      ].join('\n')
    }).join('\n\n')

    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: `Projects (${this.bot.projects.length})`,
        content: projectsList || 'No projects configured.'
      }
    })
  }

  private async handleProjectsAdd(message: Message, command: Command): Promise<void> {
    // Check admin permission
    if (!configManager.isAdmin(message.userId)) {
      await this.channelSendText(message.chatId, '⚠️ Only administrators can add projects.')
      return
    }

    const args = command.args.slice(1) // Remove 'add' subcommand
    if (args.length < 3) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: 'Usage',
          content: `**/projects add <id> <name> <path>**\n\nExample:\n\`/projects add proj-003 "My Project" /home/user/project\`\n\nNote: Path must be an absolute path.`
        }
      })
      return
    }

    const projectId = args[0]
    const projectName = args[1]
    const projectPath = args[2]

    // Check if project already exists
    if (this.bot.projects.find(p => p.id === projectId)) {
      await this.channelSendText(message.chatId, `⚠️ Project with id "${projectId}" already exists.`)
      return
    }

    // Check if path exists
    try {
      await fs.access(projectPath)
    } catch {
      await this.channelSendText(message.chatId, `⚠️ Path does not exist or is not accessible: ${projectPath}`)
      return
    }

    const newProject = {
      id: projectId,
      name: projectName,
      path: projectPath,
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
      maxTurns: 100,
      maxBudgetUsd: 1.5,
      enableSkills: false
    }

    try {
      await configManager.addProject(this.bot.id, newProject)
      // Reload bot configuration
      this.bot.projects.push(newProject)

      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: '✓ Project Added',
          content: `Successfully added project:\n\n**${newProject.name}** (\`${newProject.id}\`)\nPath: \`${newProject.path}\`\n\nYou can now switch to it with:\n\`/switch ${newProject.name}\``
        }
      })
    } catch (error) {
      logger.error({ msg: 'Failed to add project', error })
      await this.channelSendText(message.chatId, `⚠️ Failed to add project: ${(error as Error).message}`)
    }
  }

  private async handleProjectsRemove(message: Message, command: Command): Promise<void> {
    // Check admin permission
    if (!configManager.isAdmin(message.userId)) {
      await this.channelSendText(message.chatId, '⚠️ Only administrators can remove projects.')
      return
    }

    const args = command.args.slice(1) // Remove 'remove' subcommand
    if (args.length < 1) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: 'Usage',
          content: `**/projects remove <project-id>**\n\nExample:\n\`/projects remove proj-003\`\n\nNote: Use the project ID, not the name.`
        }
      })
      return
    }

    const projectId = args[0]
    const project = this.bot.projects.find(p => p.id === projectId)

    if (!project) {
      await this.channelSendText(message.chatId, `⚠️ Project with id "${projectId}" not found.`)
      return
    }

    try {
      await configManager.removeProject(this.bot.id, projectId)
      // Update local bot projects
      const index = this.bot.projects.findIndex(p => p.id === projectId)
      if (index !== -1) {
        this.bot.projects.splice(index, 1)
      }

      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: '✓ Project Removed',
          content: `Successfully removed project:\n\n**${project.name}** (\`${project.id}\`)\nPath: \`${project.path}\``
        }
      })
    } catch (error) {
      logger.error({ msg: 'Failed to remove project', error })
      await this.channelSendText(message.chatId, `⚠️ Failed to remove project: ${(error as Error).message}`)
    }
  }

  private getCurrentProjectName(): string {
    const project = this.bot.projects.find(p => p.id === this.bot.currentProjectId)
    return project?.name || 'Unknown'
  }
}
