import type { Session, SessionState, SessionStatus } from '../types/index.js'
import { logger } from '../utils/logger.js'

const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 小时

export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  private userProjectSelections: Map<string, string> = new Map()

  constructor() {
    this.startTimeoutChecker()
  }

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

  // 会话状态管理
  setStatus(sessionKey: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionKey)
    if (session) {
      if (!session.state) {
        session.state = {
          status: 'idle',
          currentTaskId: '',
          expiresAt: 0,
          chatId: ''
        }
      }
      session.state.status = status
      logger.info({ msg: 'Session status updated', sessionKey, status })
    }
  }

  getState(sessionKey: string): SessionState | undefined {
    const session = this.sessions.get(sessionKey)
    return session?.state
  }

  setState(sessionKey: string, state: Partial<SessionState>): void {
    const session = this.sessions.get(sessionKey)
    if (session) {
      if (!session.state) {
        session.state = {
          status: 'idle',
          currentTaskId: '',
          expiresAt: 0,
          chatId: ''
        }
      }
      Object.assign(session.state, state)
      logger.info({ msg: 'Session state updated', sessionKey, state })
    }
  }

  clearState(sessionKey: string): void {
    const session = this.sessions.get(sessionKey)
    if (session) {
      session.state = undefined
      logger.info({ msg: 'Session state cleared', sessionKey })
    }
  }

  // 会话超时检查器
  private startTimeoutChecker(): void {
    setInterval(() => {
      const now = Date.now()
      for (const [key, session] of this.sessions.entries()) {
        if (session.state && session.state.expiresAt && now > session.state.expiresAt) {
          if (session.state.status !== 'idle') {
            logger.warn({ msg: 'Session timed out', key, expiresAt: session.state.expiresAt })

            // 取消执行（如果存在句柄）
            if (session.state.executionHandle) {
              try {
                session.state.executionHandle.finish()
              } catch (e) {
                logger.error({ msg: 'Error finishing timed out session', error: e })
              }
            }

            this.clearState(key)
          }
        }
      }
    }, 30000) // 每 30 秒检查一次
  }
}

export const sessionManager = new SessionManager()
