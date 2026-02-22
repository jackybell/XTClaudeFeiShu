// Channel message types
export interface Message {
  chatId: string
  userId: string
  userName: string
  text: string
  images?: string[]
  files?: FileAttachment[]
  messageType: 'private' | 'group'
  rawEvent: any
}

export interface FileAttachment {
  name: string
  path: string
  size: number
}

export interface Card {
  type: 'text' | 'status' | 'result' | 'error'
  content: any
}

// Bot configuration
export interface Project {
  id: string
  name: string
  path: string
  allowedTools: string[]
  maxTurns?: number
  maxBudgetUsd?: number
}

export interface Bot {
  id: string
  name: string
  channel: 'feishu'
  feishuAppId: string
  feishuAppSecret: string
  projects: Project[]
  currentProjectId: string
}

export interface XtBotConfig {
  adminOpenIds: string[]
  bots: Bot[]
}

// Session types
export interface UserProjectSelection {
  botId: string
  userId: string
  projectId: string
}

export interface Session {
  botId: string
  userId: string
  projectId: string
  claudeSessionId: string
  createdAt: Date
  lastActiveAt: Date
}

// Command types
export interface Command {
  type: 'switch' | 'reset' | 'stop' | 'help'
  args: string[]
  options: {
    clear?: boolean
  }
}
