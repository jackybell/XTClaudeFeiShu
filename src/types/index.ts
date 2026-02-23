// 会话状态类型
export enum SessionStatus {
  IDLE = 'idle',
  EXECUTING = 'executing',
  WAITING_INPUT = 'waiting_input',
  WAITING_CONFIRM = 'waiting_confirm'
}

// 输入请求类型
export interface InputRequest {
  type: 'confirmation' | 'text' | 'choice'
  prompt: string
  options?: string[]
}

// 会话状态
export interface SessionState {
  status: SessionStatus
  currentTaskId: string
  executionHandle?: any  // Will be ExecutionHandle from ClaudeExecutor
  inputRequest?: InputRequest
  expiresAt: number
  chatId: string
}

// 渠道消息类型
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

// 机器人配置
export interface Project {
  id: string
  name: string
  path: string
  allowedTools: string[]
  maxTurns?: number
  maxBudgetUsd?: number
  enableSkills?: boolean
  settingSources?: ('project' | 'local' | 'user')[]
  plugins?: Array<{ type: 'local'; path: string }>
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

// 会话类型
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
  state?: SessionState  // Add this
}

// 命令类型
export interface Command {
  type: 'switch' | 'reset' | 'stop' | 'help' | 'skills' | 'projects'
  args: string[]
  options: {
    clear?: boolean
  }
  subCommand?: 'list' | 'add' | 'remove'
}
