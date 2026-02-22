import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '../utils/logger.js'

export interface ClaudeOptions {
  query: string
  images?: string[]
  sessionId?: string
  workingDirectory: string
  allowedTools: string[]
  maxTurns?: number
  maxBudgetUsd?: number
}

export interface StreamChunk {
  type: 'content' | 'tool_use' | 'tool_result' | 'end'
  content?: string
  toolName?: string
  toolInput?: string
  sessionId?: string
}

export class ClaudeExecutor {
  private runningTasks: Map<string, AbortController> = new Map()

  async execute(options: ClaudeOptions, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const taskId = Math.random().toString(36).substring(7)
    const abortController = new AbortController()
    this.runningTasks.set(taskId, abortController)

    try {
      const queryIterator = query({
        prompt: options.query,
        options: {
          abortController,
          sessionId: options.sessionId,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          cwd: options.workingDirectory,
          allowedTools: options.allowedTools,
          maxTurns: options.maxTurns || 100,
          maxBudgetUsd: options.maxBudgetUsd || 1.5
        }
      })

      for await (const message of queryIterator) {
        if (abortController.signal.aborted) break

        if (message.type === 'stream_event') {
          const partialMsg = message as SDKPartialAssistantMessage
          if (partialMsg.event.type === 'content_block_delta') {
            const delta = partialMsg.event.delta
            if (delta.type === 'text_delta') {
              onChunk({ type: 'content', content: delta.text })
            }
          } else if (partialMsg.event.type === 'content_block_start') {
            const block = partialMsg.event.contentBlock
            if (block?.type === 'tool_use') {
              onChunk({
                type: 'tool_use',
                toolName: block.name,
                toolInput: JSON.stringify(block.input)
              })
            }
          }
        } else if (message.type === 'assistant') {
          // Full assistant message received
          const assistantMsg = message
          if (assistantMsg.message.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                onChunk({ type: 'content', content: block.text })
              } else if (block.type === 'tool_use') {
                onChunk({
                  type: 'tool_use',
                  toolName: block.name,
                  toolInput: JSON.stringify(block.input)
                })
              }
            }
          }
        } else if (message.type === 'result') {
          onChunk({ type: 'end', sessionId: message.session_id })
        }
      }
    } finally {
      this.runningTasks.delete(taskId)
    }
  }

  abort(): void {
    for (const controller of this.runningTasks.values()) {
      controller.abort()
    }
    this.runningTasks.clear()
    logger.info({ msg: 'All tasks aborted' })
  }
}
