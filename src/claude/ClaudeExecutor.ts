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
  enableSkills?: boolean
  settingSources?: ('project' | 'local' | 'user')[]
  plugins?: Array<{ type: 'local'; path: string }>
  onSkillDiscovered?: (skills: string[]) => void
}

export interface StreamChunk {
  type: 'content' | 'tool_use' | 'tool_result' | 'end' | 'system'
  content?: string
  toolName?: string
  toolInput?: string
  sessionId?: string
  skills?: string[]
}

export class ClaudeExecutor {
  private runningTasks: Map<string, AbortController> = new Map()

  async execute(options: ClaudeOptions, onChunk: (chunk: StreamChunk) => void): Promise<void> {
    const taskId = Math.random().toString(36).substring(7)
    const abortController = new AbortController()
    this.runningTasks.set(taskId, abortController)

    try {
      const queryOptions: Record<string, unknown> = {
        abortController,
        sessionId: options.sessionId,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        cwd: options.workingDirectory,
        allowedTools: options.allowedTools,
        maxTurns: options.maxTurns || 100,
        maxBudgetUsd: options.maxBudgetUsd || 1.5,
        includePartialMessages: true
      }

      // Enable skills support if requested
      if (options.enableSkills) {
        queryOptions.settingSources = options.settingSources || ['project', 'local']
        queryOptions.plugins = options.plugins || []
        logger.info({
          msg: 'Skills enabled',
          settingSources: queryOptions.settingSources,
          plugins: queryOptions.plugins
        })
      }

      const queryIterator = query({
        prompt: options.query,
        options: queryOptions
      })

      for await (const message of queryIterator) {
        if (abortController.signal.aborted) break

        // Handle system messages (for skill discovery)
        if (message.type === 'system') {
          const systemMsg = message as { subtype?: string; skills?: string[]; slash_commands?: string[] }
          if (systemMsg.subtype === 'init' || systemMsg.subtype === 'config_change') {
            const skills = systemMsg.skills || systemMsg.slash_commands || []
            if (skills.length > 0) {
              logger.info({ msg: 'Skills discovered', skills })
              onChunk({ type: 'system', skills })
              if (options.onSkillDiscovered) {
                options.onSkillDiscovered(skills)
              }
            }
          }
        } else if (message.type === 'stream_event') {
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
          if (message.result_type === 'error_during_execution') {
            throw new Error(`Execution error: ${message.error || 'Unknown error'}`)
          } else if (message.result_type === 'error_max_turns') {
            throw new Error(`Max turns (${message.max_turns}) exceeded`)
          } else if (message.result_type === 'error_max_budget_usd') {
            throw new Error(`Max budget ($${message.max_budget_usd}) exceeded`)
          }
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
