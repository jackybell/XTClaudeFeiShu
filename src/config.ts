import fs from 'fs/promises'
import path from 'path'
import { logger } from './utils/logger.js'
import type { XtBotConfig, Bot, Project } from './types/index.js'

class ConfigManager {
  private config: XtBotConfig | null = null
  private configPath: string

  constructor(configPath: string = 'xtbot.json') {
    this.configPath = path.resolve(configPath)
  }

  async load(): Promise<XtBotConfig> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const parsedConfig = JSON.parse(content) as XtBotConfig
      this.validateConfig(parsedConfig)
      this.config = parsedConfig
      logger.info('Configuration loaded successfully', {
        botsCount: this.config.bots.length
      })
      return this.config
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${this.configPath}`)
      }
      throw error
    }
  }

  private validateConfig(config: any): void {
    if (!config.bots || !Array.isArray(config.bots)) {
      throw new Error('Invalid config: bots must be an array')
    }

    if (!config.adminOpenIds || !Array.isArray(config.adminOpenIds)) {
      throw new Error('Invalid config: adminOpenIds must be an array')
    }

    for (const bot of config.bots) {
      this.validateBot(bot)
    }
  }

  private validateBot(bot: any): void {
    const required = ['id', 'name', 'channel', 'feishuAppId', 'feishuAppSecret', 'projects', 'currentProjectId']
    for (const field of required) {
      if (!bot[field]) {
        throw new Error(`Invalid bot: missing required field '${field}'`)
      }
    }

    if (bot.channel !== 'feishu') {
      throw new Error(`Invalid bot: unsupported channel '${bot.channel}'`)
    }

    if (!Array.isArray(bot.projects) || bot.projects.length === 0) {
      throw new Error(`Invalid bot '${bot.id}': projects must be a non-empty array`)
    }

    const projectIds = new Set(bot.projects.map((p: Project) => p.id))
    if (projectIds.size !== bot.projects.length) {
      throw new Error(`Invalid bot '${bot.id}': duplicate project IDs`)
    }

    if (!projectIds.has(bot.currentProjectId)) {
      throw new Error(`Invalid bot '${bot.id}': currentProjectId not found in projects`)
    }

    for (const project of bot.projects) {
      this.validateProject(project)
    }
  }

  private validateProject(project: any): void {
    const required = ['id', 'name', 'path', 'allowedTools']
    for (const field of required) {
      if (!project[field]) {
        throw new Error(`Invalid project: missing required field '${field}'`)
      }
    }

    if (!Array.isArray(project.allowedTools)) {
      throw new Error(`Invalid project '${project.id}': allowedTools must be an array`)
    }
  }

  getBots(): Bot[] {
    if (!this.config) {
      throw new Error('Configuration not loaded')
    }
    return this.config.bots
  }

  getBotById(id: string): Bot | undefined {
    return this.getBots().find(b => b.id === id)
  }

  getAdminOpenIds(): string[] {
    if (!this.config) {
      throw new Error('Configuration not loaded')
    }
    return this.config.adminOpenIds
  }

  isAdmin(userId: string): boolean {
    return this.getAdminOpenIds().includes(userId)
  }
}

export const configManager = new ConfigManager()
