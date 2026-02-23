import type { Command, Message, Bot, Session } from '../types/index.js'
import { sessionManager } from './SessionManager.js'
import { configManager } from '../config.js'
import { taskQueue } from './TaskQueue.js'
import type { MessageBridge } from './MessageBridge.js'
import { logger } from '../utils/logger.js'
import fs from 'fs/promises'

export class CommandHandler {
  constructor(
    private bot: Bot,
    private channelSendText: (chatId: string, text: string) => Promise<void>,
    private channelSendCard: (chatId: string, card: any) => Promise<string>,
    private messageBridge?: MessageBridge
  ) {}

  parseCommand(text: string): Command | null {
    const trimmed = text.trim()

    if (!trimmed.startsWith('/')) {
      return null
    }

    const parts = trimmed.split(/\s+/)
    const command = parts[0].slice(1) // 移除 /
    const args = parts.slice(1)
    const options: { clear?: boolean } = {}
    let subCommand: 'list' | 'add' | 'remove' | undefined

    // 解析 /projects 的子命令
    if (command === 'projects' && args.length > 0) {
      const sub = args[0]
      if (sub === 'list' || sub === 'add' || sub === 'remove') {
        subCommand = sub
      }
    }

    // 解析选项
    const clearIndex = args.indexOf('--clear')
    if (clearIndex !== -1) {
      options.clear = true
      args.splice(clearIndex, 1)
    }

    const validCommands = ['switch', 'reset', 'stop', 'status', 'help', 'skills', 'projects']
    if (!validCommands.includes(command)) {
      return null
    }

    return { type: command as any, args, options, subCommand }
  }

  async handle(message: Message): Promise<boolean> {
    // 首先检查用户是否有等待中的会话
    const sessionKey = `${this.bot.id}:${message.userId}`
    const session = sessionManager.getSession(this.bot.id, message.userId)

    if (session?.state) {
      const { status, executionHandle } = session.state

      // 检查是否在等待输入
      if (status === 'waiting_input' || status === 'waiting_confirm') {
        // 检查是否是命令（用户想要取消）
        const command = this.parseCommand(message.text)
        if (command) {
          // 用户发送了命令，取消等待
          logger.info({ msg: 'Command received during waiting, canceling waiting', command })
          if (executionHandle) {
            executionHandle.finish()
          }
          sessionManager.clearState(sessionKey)

          // 执行命令
          const handled = await this.executeCommand(message, command)
          return handled
        }

        // 发送用户响应到 SDK
        await this.sendUserResponse(session, message)
        return true
      }
    }

    // 正常命令处理
    const isCommand = await this.executeCommand(message, this.parseCommand(message.text))
    return isCommand
  }

  // 重命名现有的 handle 方法逻辑为 executeCommand
  private async executeCommand(message: Message, command: Command | null): Promise<boolean> {
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
      case 'status':
        await this.handleStatus(message)
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

  // 添加新方法来处理用户响应
  private async sendUserResponse(session: Session, message: Message): Promise<void> {
    const { executionHandle, inputRequest, chatId } = session.state!

    if (!executionHandle) {
      await this.channelSendText(chatId, '会话已过期，请重新开始')
      return
    }

    logger.info({ msg: 'Sending user response to SDK', text: message.text })

    try {
      // 发送响应到 SDK
      executionHandle.sendMessage(message.text)

      // 更新状态回执行中
      sessionManager.setStatus(session.botId + ':' + session.userId, 'executing')

      // 通知用户
      await this.channelSendText(chatId, '已收到你的回复，继续执行...')
    } catch (error) {
      logger.error({ msg: 'Error sending response to SDK', error })
      await this.channelSendText(chatId, `发送响应失败: ${error}`)
    }
  }

  private async handleSwitch(message: Message, command: Command): Promise<void> {
    const projectName = command.args[0]

    if (!projectName) {
      const projects = this.bot.projects.map(p => `- ${p.name}`).join('\n')
      await this.channelSendCard(message.chatId, {
        type: 'status',
        content: {
          status: 'success',
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

    // 更新用户的项目选择
    sessionManager.setUserProject(this.bot.id, message.userId, project.id)

    // 处理 --clear 选项
    if (command.options.clear) {
      sessionManager.deleteSession(this.bot.id, message.userId)
    }

    await this.channelSendCard(message.chatId, {
      type: 'status',
      content: {
        status: 'success',
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
    // 获取用户选择的项目
    const projectId = sessionManager.getUserProject(
      this.bot.id,
      message.userId,
      this.bot.currentProjectId
    )
    if (!projectId) {
      await this.channelSendText(message.chatId, '未找到项目。')
      return
    }

    // 检查用户是否有等待中的任务
    const tasks = taskQueue.getTasks(this.bot.id, projectId)
    const myWaitingTasks = tasks.filter(t =>
      t.message.userId === message.userId && t.status === 'waiting'
    )

    if (myWaitingTasks.length === 0) {
      await this.channelSendText(message.chatId, '你没有等待中的任务。')
      return
    }

    // 取消该用户的所有等待任务
    let cancelledCount = 0
    for (const task of myWaitingTasks) {
      if (taskQueue.cancel(task.id)) {
        cancelledCount++
      }
    }

    await this.channelSendText(message.chatId,
      `已取消 ${cancelledCount} 个等待中的任务。`
    )
  }

  private async handleStatus(message: Message): Promise<void> {
    if (!this.messageBridge) {
      await this.channelSendText(message.chatId, '状态查询功能不可用。')
      return
    }

    const queueInfo = this.messageBridge.getQueueStatus(message)
    if (!queueInfo) {
      await this.channelSendText(message.chatId, '未找到项目。')
      return
    }

    const { stats, tasks } = queueInfo

    // 构建状态消息
    const runningTask = tasks.find(t => t.status === 'running')
    const myWaitingTasks = tasks.filter(t => t.isMine && t.status === 'waiting')
    const otherWaitingTasks = tasks.filter(t => !t.isMine && t.status === 'waiting')

    let content = `**队列状态**\n\n`
    content += `🔄 运行中: ${stats.running}\n`
    content += `⏳ 等待中: ${stats.waiting}\n`
    content += `✅ 已完成: ${stats.completed}\n`
    content += `❌ 失败: ${stats.failed}\n\n`

    if (runningTask) {
      content += `**当前运行中的任务**\n`
      content += `- ID: ${runningTask.id.slice(0, 8)}...\n`
      content += `- 状态: 运行中\n`
      content += `- 你的任务: ${runningTask.isMine ? '是' : '否'}\n\n`
    }

    if (myWaitingTasks.length > 0) {
      content += `**你的等待任务**\n`
      for (const task of myWaitingTasks) {
        content += `- 第 ${task.position! + 1} 位 (ID: ${task.id.slice(0, 8)}...)\n`
      }
      content += '\n'
    }

    if (otherWaitingTasks.length > 0) {
      content += `**其他人等待中的任务**: ${otherWaitingTasks.length} 个\n`
    }

    if (stats.waiting === 0 && stats.running === 0) {
      content += '\n当前没有任务在队列中。'
    }

    await this.channelSendCard(message.chatId, {
      type: 'status',
      content: {
        status: 'success',
        title: '任务队列状态',
        content
      }
    })
  }

  private async handleHelp(message: Message): Promise<void> {
    const projects = this.bot.projects.map(p => `- ${p.name}`).join('\n')
    await this.channelSendCard(message.chatId, {
      type: 'status',
      content: {
        status: 'success',
        title: '可用命令',
        content: `**/switch <项目> [--clear]** - 切换项目\n**/reset** - 重置当前会话\n**/stop** - 取消等待中的任务\n**/status** - 查看任务队列状态\n**/skills** - 查看可用技能\n**/projects [list|add|remove]** - 管理项目\n**/help** - 显示此帮助\n\n可用项目:\n${projects}`
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
        type: 'status',
        content: {
          status: 'success',
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
      type: 'status',
      content: {
        status: 'success',
        title: '技能配置',
        content: skillInfo
      }
    })
  }

  private async handleProjects(message: Message, command: Command): Promise<void> {
    const subCommand = command.subCommand

    if (!subCommand) {
      await this.channelSendCard(message.chatId, {
        type: 'status',
        content: {
          status: 'success',
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
      type: 'status',
      content: {
        status: 'success',
        title: `项目列表 (${this.bot.projects.length})`,
        content: projectsList || '未配置项目。'
      }
    })
  }

  private async handleProjectsAdd(message: Message, command: Command): Promise<void> {
    // 检查管理员权限
    if (!configManager.isAdmin(message.userId)) {
      await this.channelSendText(message.chatId, '⚠️ 只有管理员可以添加项目。')
      return
    }

    const args = command.args.slice(1) // 移除 'add' 子命令
    if (args.length < 3) {
      await this.channelSendCard(message.chatId, {
        type: 'status',
        content: {
          status: 'error',
          title: '用法',
          content: `**/projects add <id> <name> <path>**\n\n示例:\n\`/projects add proj-003 "我的项目" /home/user/project\`\n\n注意: 路径必须是绝对路径。`
        }
      })
      return
    }

    const projectId = args[0]
    const projectName = args[1]
    const projectPath = args[2]

    // 检查项目是否已存在
    if (this.bot.projects.find(p => p.id === projectId)) {
      await this.channelSendText(message.chatId, `⚠️ 项目 id "${projectId}" 已存在。`)
      return
    }

    // 检查路径是否存在
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
      // 注意：configManager 已经更新了内存中的配置，无需再次推送

      await this.channelSendCard(message.chatId, {
        type: 'status',
        content: {
          status: 'success',
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
    // 检查管理员权限
    if (!configManager.isAdmin(message.userId)) {
      await this.channelSendText(message.chatId, '⚠️ 只有管理员可以删除项目。')
      return
    }

    const args = command.args.slice(1) // 移除 'remove' 子命令
    if (args.length < 1) {
      await this.channelSendCard(message.chatId, {
        type: 'status',
        content: {
          status: 'success',
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
      // 注意：configManager 已经更新了内存中的配置

      await this.channelSendCard(message.chatId, {
        type: 'status',
        content: {
          status: 'success',
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
