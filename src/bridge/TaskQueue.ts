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
  // Queue key: "botId:projectId"
  private queues: Map<string, QueuedTask[]> = new Map()
  private runningTasks: Set<string> = new Map<`${string}:${string}`, string>()

  /**
   * Get queue key for bot and project
   */
  private getQueueKey(botId: string, projectId: string): string {
    return `${botId}:${projectId}`
  }

  /**
   * Enqueue a task. Returns the task ID and whether it will run immediately.
   */
  enqueue(botId: string, projectId: string, message: Message, project: Project): QueuedTask {
    const key = this.getQueueKey(botId, projectId)
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Get or create queue
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

    // Update positions for all waiting tasks
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
   * Get the next task from queue for execution
   */
  getNext(botId: string, projectId: string): QueuedTask | null {
    const key = this.getQueueKey(botId, projectId)
    const queue = this.queues.get(key)

    if (!queue || queue.length === 0) {
      return null
    }

    // Find first waiting task
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
   * Mark a task as completed and remove from queue
   */
  complete(taskId: string): void {
    for (const [key, queue] of this.queues.entries()) {
      const task = queue.find(t => t.id === taskId)
      if (task) {
        task.status = 'completed'
        task.completedAt = new Date()
        this.runningTasks.delete(key)

        // Remove completed tasks from queue (keep recent history)
        const now = Date.now()
        const completedThreshold = 5 * 60 * 1000 // 5 minutes

        // Remove old completed/failed tasks
        for (let i = queue.length - 1; i >= 0; i--) {
          const t = queue[i]
          if ((t.status === 'completed' || t.status === 'failed') &&
              t.completedAt && (now - t.completedAt.getTime() > completedThreshold)) {
            queue.splice(i, 1)
          } else if (t.status === 'cancelled') {
            // Remove cancelled tasks immediately
            queue.splice(i, 1)
          }
        }

        logger.info({
          msg: 'Task completed',
          taskId,
          queueLength: queue.length
        })

        // Update positions for remaining tasks
        this.updatePositions(key)

        return
      }
    }
  }

  /**
   * Mark a task as failed
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
   * Cancel a waiting task
   */
  cancel(taskId: string): boolean {
    for (const [key, queue] of this.queues.entries()) {
      const index = queue.findIndex(t => t.id === taskId)
      if (index !== -1) {
        const task = queue[index]
        if (task.status === 'waiting') {
          task.status = 'cancelled'

          // Remove from queue
          queue.splice(index, 1)

          this.updatePositions(key)

          logger.info({
            msg: 'Task cancelled',
            taskId
          })

          return true
        }
        return false // Can't cancel running/completed tasks
      }
    }
    return false
  }

  /**
   * Get task by ID
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
   * Get all tasks for a bot/project combination
   */
  getTasks(botId: string, projectId: string): QueuedTask[] {
    const key = this.getQueueKey(botId, projectId)
    return this.queues.get(key) || []
  }

  /**
   * Get current statistics for a bot/project
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
   * Check if a task is currently running for the bot/project
   */
  isRunning(botId: string, projectId: string): boolean {
    const key = this.getQueueKey(botId, projectId)
    return this.runningTasks.has(key)
  }

  /**
   * Get the currently running task for bot/project
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
   * Update position numbers for all waiting tasks
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
   * Clear all tasks (for testing or shutdown)
   */
  clear(): void {
    this.queues.clear()
    this.runningTasks.clear()
    logger.info({ msg: 'Task queue cleared' })
  }
}

// Global task queue instance
export const taskQueue = new TaskQueue()
