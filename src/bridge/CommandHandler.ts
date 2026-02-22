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
          title: '可用项目',
          content: `当前: **${this.getCurrentProjectName()}**\n\n可用项目:\n${projects}\n\n用法: \`/switch <项目名> [--clear]\``
        }
      })
      return
    }

    const project = this.bot.projects.find(p => p.name === projectName || p.id === projectName)

    if (!project) {
      await this.channelSendText(message.chatId, `未找到项目 "${projectName}"。使用 /help 查看可用项目。`)
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
        title: '项目已切换',
        content: `已切换到 **${project.name}**\n路径: \`${project.path}\`\n\n${command.options.clear ? '已清除之前的会话。' : '保留了之前的会话。'}`
      }
    })
  }

  private async handleReset(message: Message): Promise<void> {
    sessionManager.deleteSession(this.bot.id, message.userId)
    await this.channelSendText(message.chatId, '会话已重置。下一条消息将开始新的对话。')
  }

  private async handleStop(message: Message): Promise<void> {
    // TODO: Implement stopping running tasks
    await this.channelSendText(message.chatId, '停止功能即将推出。')
  }

  private async handleHelp(message: Message): Promise<void> {
    const projects = this.bot.projects.map(p => `- ${p.name}`).join('\n')
    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: '可用命令',
        content: `**/switch <项目> [--clear]** - 切换项目\n**/reset** - 重置当前会话\n**/stop** - 停止当前任务\n**/skills** - 查看可用技能\n**/projects [list|add|remove]** - 管理项目\n**/help** - 显示此帮助\n\n可用项目:\n${projects}`
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
      await this.channelSendText(message.chatId, '未找到项目。')
      return
    }

    if (!project.enableSkills) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: '未启用技能',
          content: `项目 **${project.name}** 未启用技能。\n\n要启用技能，请在项目配置中设置 \`enableSkills: true\`。`
        }
      })
      return
    }

    const skillInfo = [
      `**项目:** ${project.name}`,
      `**技能已启用:** ${project.enableSkills ? '是' : '否'}`,
      `**设置来源:** ${project.settingSources?.join(', ') || '未配置'}`,
      `**插件:** ${project.plugins?.length || 0} 个`
    ].join('\n')

    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: '技能配置',
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
          title: '项目管理命令',
          content: `**/projects list** - 列出所有项目\n**/projects add <id> <name> <path>** - 添加新项目（仅管理员）\n**/projects remove <id>** - 删除项目（仅管理员）\n\n用法:\n\`/projects add proj-003 "我的项目" /path/to/project\``
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
        `   路径: \`${p.path}\``,
        `   技能: ${skillsStatus}`,
        `   工具: ${p.allowedTools.length} 个可用`
      ].join('\n')
    }).join('\n\n')

    await this.channelSendCard(message.chatId, {
      type: 'text',
      content: {
        title: `项目列表 (${this.bot.projects.length})`,
        content: projectsList || '未配置项目。'
      }
    })
  }

  private async handleProjectsAdd(message: Message, command: Command): Promise<void> {
    // Check admin permission
    if (!configManager.isAdmin(message.userId)) {
      await this.channelSendText(message.chatId, '⚠️ 只有管理员可以添加项目。')
      return
    }

    const args = command.args.slice(1) // Remove 'add' subcommand
    if (args.length < 3) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: '用法',
          content: `**/projects add <id> <name> <path>**\n\n示例:\n\`/projects add proj-003 "我的项目" /home/user/project\`\n\n注意: 路径必须是绝对路径。`
        }
      })
      return
    }

    const projectId = args[0]
    const projectName = args[1]
    const projectPath = args[2]

    // Check if project already exists
    if (this.bot.projects.find(p => p.id === projectId)) {
      await this.channelSendText(message.chatId, `⚠️ 项目 id "${projectId}" 已存在。`)
      return
    }

    // Check if path exists
    try {
      await fs.access(projectPath)
    } catch {
      await this.channelSendText(message.chatId, `⚠️ 路径不存在或无法访问: ${projectPath}`)
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
          title: '✓ 项目已添加',
          content: `成功添加项目:\n\n**${newProject.name}** (\`${newProject.id}\`)\n路径: \`${newProject.path}\`\n\n现在可以使用以下命令切换:\n\`/switch ${newProject.name}\``
        }
      })
    } catch (error) {
      logger.error({ msg: 'Failed to add project', error })
      await this.channelSendText(message.chatId, `⚠️ 添加项目失败: ${(error as Error).message}`)
    }
  }

  private async handleProjectsRemove(message: Message, command: Command): Promise<void> {
    // Check admin permission
    if (!configManager.isAdmin(message.userId)) {
      await this.channelSendText(message.chatId, '⚠️ 只有管理员可以删除项目。')
      return
    }

    const args = command.args.slice(1) // Remove 'remove' subcommand
    if (args.length < 1) {
      await this.channelSendCard(message.chatId, {
        type: 'text',
        content: {
          title: '用法',
          content: `**/projects remove <project-id>**\n\n示例:\n\`/projects remove proj-003\`\n\n注意: 使用项目 ID，而不是名称。`
        }
      })
      return
    }

    const projectId = args[0]
    const project = this.bot.projects.find(p => p.id === projectId)

    if (!project) {
      await this.channelSendText(message.chatId, `⚠️ 未找到项目 id "${projectId}"。`)
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
          title: '✓ 项目已删除',
          content: `成功删除项目:\n\n**${project.name}** (\`${project.id}\`)\n路径: \`${project.path}\``
        }
      })
    } catch (error) {
      logger.error({ msg: 'Failed to remove project', error })
      await this.channelSendText(message.chatId, `⚠️ 删除项目失败: ${(error as Error).message}`)
    }
  }

  private getCurrentProjectName(): string {
    const project = this.bot.projects.find(p => p.id === this.bot.currentProjectId)
    return project?.name || '未知'
  }
}
