import type { Message, Project } from '../types/index.js'
import { logger } from '../utils/logger.js'

export interface QueuedTask {
  id: string
  message: Message
  project: Project
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled'
  queuedAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
  position?: number
}

export interface TaskQueueStats {
  running: number
  waiting: number
  completed: number
  failed: number
}

export class TaskQueue {
  // 队列键："botId:projectId"
  private queues: Map<string, QueuedTask[]> = new Map()
  private runningTasks: Map<string, string> = new Map()

  /**
   * 获取机器人和项目的队列键
   */
  private getQueueKey(botId: string, projectId: string): string {
    return `${botId}:${projectId}`
  }

  /**
   * 将任务加入队列。返回任务 ID 和是否立即运行。
   */
  enqueue(botId: string, projectId: string, message: Message, project: Project): QueuedTask {
    const key = this.getQueueKey(botId, projectId)
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // 获取或创建队列
    let queue = this.queues.get(key)
    if (!queue) {
      queue = []
      this.queues.set(key, queue)
    }

    const task: QueuedTask = {
      id: taskId,
      message,
      project,
      status: 'waiting',
      queuedAt: new Date(),
      position: queue.length
    }

    queue.push(task)

    // 更新所有等待中任务的位置
    this.updatePositions(key)

    logger.info({
      msg: 'Task enqueued',
      taskId,
      botId,
      projectId,
      position: task.position,
      queueLength: queue.length
    })

    return task
  }

  /**
   * 从队列中获取下一个要执行的任务
   */
  getNext(botId: string, projectId: string): QueuedTask | null {
    const key = this.getQueueKey(botId, projectId)
    const queue = this.queues.get(key)

    if (!queue || queue.length === 0) {
      return null
    }

    // 查找第一个等待中的任务
    const taskIndex = queue.findIndex(t => t.status === 'waiting')
    if (taskIndex === -1) {
      return null
    }

    const task = queue[taskIndex]
    task.status = 'running'
    task.startedAt = new Date()

    this.runningTasks.set(key, task.id)

    logger.info({
      msg: 'Task started',
      taskId: task.id,
      botId,
      projectId,
      waitingAhead: taskIndex
    })

    return task
  }

  /**
   * 标记任务为已完成并从队列中移除
   */
  complete(taskId: string): void {
    for (const [key, queue] of this.queues.entries()) {
      const task = queue.find(t => t.id === taskId)
      if (task) {
        task.status = 'completed'
        task.completedAt = new Date()
        this.runningTasks.delete(key)

        // 从队列中移除已完成的任务（保留最近的历史记录）
        const now = Date.now()
        const completedThreshold = 5 * 60 * 1000 // 5 分钟

        // 移除旧的已完成/失败的任务
        for (let i = queue.length - 1; i >= 0; i--) {
          const t = queue[i]
          if ((t.status === 'completed' || t.status === 'failed') &&
              t.completedAt && (now - t.completedAt.getTime() > completedThreshold)) {
            queue.splice(i, 1)
          } else if (t.status === 'cancelled') {
            // 立即移除已取消的任务
            queue.splice(i, 1)
          }
        }

        logger.info({
          msg: 'Task completed',
          taskId,
          queueLength: queue.length
        })

        // 更新剩余任务的位置
        this.updatePositions(key)

        return
      }
    }
  }

  /**
   * 标记任务为失败
   */
  fail(taskId: string, error: string): void {
    for (const [key, queue] of this.queues.entries()) {
      const task = queue.find(t => t.id === taskId)
      if (task) {
        task.status = 'failed'
        task.completedAt = new Date()
        task.error = error
        this.runningTasks.delete(key)

        logger.info({
          msg: 'Task failed',
          taskId,
          error
        })

        this.updatePositions(key)
        return
      }
    }
  }

  /**
   * 取消等待中的任务
   */
  cancel(taskId: string): boolean {
    for (const [key, queue] of this.queues.entries()) {
      const index = queue.findIndex(t => t.id === taskId)
      if (index !== -1) {
        const task = queue[index]
        if (task.status === 'waiting') {
          task.status = 'cancelled'

          // 从队列中移除
          queue.splice(index, 1)

          this.updatePositions(key)

          logger.info({
            msg: 'Task cancelled',
            taskId
          })

          return true
        }
        return false // 无法取消运行中/已完成的任务
      }
    }
    return false
  }

  /**
   * 根据 ID 获取任务
   */
  getTask(taskId: string): QueuedTask | undefined {
    for (const queue of this.queues.values()) {
      const task = queue.find(t => t.id === taskId)
      if (task) {
        return task
      }
    }
    return undefined
  }

  /**
   * 获取机器人和项目的所有任务
   */
  getTasks(botId: string, projectId: string): QueuedTask[] {
    const key = this.getQueueKey(botId, projectId)
    return this.queues.get(key) || []
  }

  /**
   * 获取机器人和项目的当前统计信息
   */
  getStats(botId: string, projectId: string): TaskQueueStats {
    const tasks = this.getTasks(botId, projectId)
    return {
      running: tasks.filter(t => t.status === 'running').length,
      waiting: tasks.filter(t => t.status === 'waiting').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length
    }
  }

  /**
   * 检查机器人和项目是否有正在运行的任务
   */
  isRunning(botId: string, projectId: string): boolean {
    const key = this.getQueueKey(botId, projectId)
    return this.runningTasks.has(key)
  }

  /**
   * 获取机器人和项目当前正在运行的任务
   */
  getRunningTask(botId: string, projectId: string): QueuedTask | null {
    const key = this.getQueueKey(botId, projectId)
    const taskId = this.runningTasks.get(key)
    if (!taskId) return null

    const queue = this.queues.get(key)
    if (!queue) return null

    return queue.find(t => t.id === taskId) || null
  }

  /**
   * 更新所有等待中任务的位置编号
   */
  private updatePositions(key: string): void {
    const queue = this.queues.get(key)
    if (!queue) return

    let position = 0
    for (const task of queue) {
      if (task.status === 'waiting') {
        task.position = position++
      }
    }
  }

  /**
   * 清空所有任务（用于测试或关闭）
   */
  clear(): void {
    this.queues.clear()
    this.runningTasks.clear()
    logger.info({ msg: 'Task queue cleared' })
  }
}

// 全局任务队列实例
export const taskQueue = new TaskQueue()
