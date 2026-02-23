import type { Session } from '../types/index.js'
import { logger } from '../utils/logger.js'

const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 小时

export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  private userProjectSelections: Map<string, string> = new Map()

  private getSessionKey(botId: string, userId: string): string {
    return `${botId}:${userId}`
  }

  private getUserSelectionKey(botId: string, userId: string): string {
    return `${botId}:${userId}`
  }

  // 用户项目选择
  getUserProject(botId: string, userId: string, defaultProjectId: string): string {
    const key = this.getUserSelectionKey(botId, userId)
    return this.userProjectSelections.get(key) || defaultProjectId
  }

  setUserProject(botId: string, userId: string, projectId: string): void {
    const key = this.getUserSelectionKey(botId, userId)
    this.userProjectSelections.set(key, projectId)
    logger.info({ msg: 'User project selection updated', botId, userId, projectId })
  }

  // 会话管理
  getOrCreateSession(
    botId: string,
    userId: string,
    projectId: string,
    claudeSessionId: string
  ): Session {
    const key = this.getSessionKey(botId, userId)
    let session = this.sessions.get(key)

    if (!session || session.projectId !== projectId) {
      session = {
        botId,
        userId,
        projectId,
        claudeSessionId,
        createdAt: new Date(),
        lastActiveAt: new Date()
      }
      this.sessions.set(key, session)
      logger.info({ msg: 'Session created', botId, userId, projectId, claudeSessionId })
    } else {
      session.lastActiveAt = new Date()
    }

    return session
  }

  getSession(botId: string, userId: string): Session | undefined {
    const key = this.getSessionKey(botId, userId)
    return this.sessions.get(key)
  }

  deleteSession(botId: string, userId: string): void {
    const key = this.getSessionKey(botId, userId)
    this.sessions.delete(key)
    logger.info({ msg: 'Session deleted', botId, userId })
  }

  clearProjectSessions(botId: string, projectId: string): void {
    for (const [key, session] of this.sessions.entries()) {
      if (session.botId === botId && session.projectId === projectId) {
        this.sessions.delete(key)
      }
    }
    logger.info({ msg: 'Project sessions cleared', botId, projectId })
  }

  // 清理过期会话
  cleanupExpiredSessions(): void {
    const now = Date.now()
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt.getTime() > SESSION_EXPIRY_MS) {
        this.sessions.delete(key)
        logger.info({ msg: 'Expired session removed', key })
      }
    }
  }

  // 启动清理定时器
  startCleanupInterval(intervalMs: number = 60 * 60 * 1000): void {
    setInterval(() => {
      this.cleanupExpiredSessions()
    }, intervalMs)
  }
}

export const sessionManager = new SessionManager()
