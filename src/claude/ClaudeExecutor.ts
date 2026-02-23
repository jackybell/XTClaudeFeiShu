import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '../utils/logger.js'
import { AsyncQueue } from '../utils/async-queue.js'
import path from 'node:path'
import os from 'node:os'
import type { Project } from '../types/index.js'

export interface ExecutorOptions {
  prompt: string
  cwd: string
  sessionId?: string
  abortController: AbortController
  allowedTools: string[]
  maxTurns?: number
  maxBudgetUsd?: number
  outputsDir?: string
  enableSkills?: boolean
  settingSources?: ('project' | 'local' | 'user')[]
  plugins?: Array<{ type: 'local'; path: string }>
}

export type SDKMessage = {
  type: string
  subtype?: string
  uuid?: string
  session_id?: string
  message?: {
    content?: Array<{
      type: string
      text?: string
      name?: string
      id?: string
      input?: unknown
    }>
  }
  // Result fields
  duration_ms?: number
  duration_api_ms?: number
  total_cost_usd?: number
  result?: string
  is_error?: boolean
  num_turns?: number
  errors?: string[]
  result_type?: string
  error?: string
  max_turns?: number
  max_budget_usd?: number
  // Stream event fields
  event?: {
    type: string
    index?: number
    delta?: {
      type: string
      text?: string
    }
    content_block?: {
      type: string
      text?: string
      name?: string
      id?: string
      input?: unknown
    }
  }
  parent_tool_use_id?: string | null
}

export interface ExecutionHandle {
  stream: AsyncGenerator<SDKMessage>
  sendAnswer(toolUseId: string, sessionId: string, answerText: string): void
  finish(): void
}

export class ClaudeExecutor {
  private buildQueryOptions(options: ExecutorOptions): Record<string, unknown> {
    // Pass environment variables to child process (for ANTHROPIC_AUTH_TOKEN, etc.)
    // const env: Record<string, string> = {
    //   ...process.env,
    //   // Ensure critical environment variables are passed
    // }
    const queryOptions: Record<string, unknown> = {
      allowedTools: options.allowedTools,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      cwd: options.cwd,
      abortController: options.abortController,
      includePartialMessages: true,
      extraArgs: { verbose: null },  // Required for includePartialMessages to work
      // Load MCP servers and settings from user/project config files
      settingSources: ['user', 'project'],
    }

    // Configure Claude executable path based on platform
    const claudeExecutablePath = process.env.CLAUDE_EXECUTABLE_PATH
    const isWindows = os.platform() === 'win32'

    if (claudeExecutablePath) {
      if (isWindows && claudeExecutablePath.endsWith('.cmd')) {
        // On Windows, .cmd files cannot be spawned directly
        // Use node executable with cli.js as argument
        const cmdDir = path.dirname(claudeExecutablePath)
        const cliJsPath = path.join(cmdDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
        queryOptions.executable = 'node' as const
        queryOptions.executableArgs = [cliJsPath]
        logger.info({ msg: 'Using Claude Code executable (Windows)', cliJsPath })
      } else {
        // On Unix/Linux/macOS, use the executable path directly
        queryOptions.pathToClaudeCodeExecutable = claudeExecutablePath
        logger.info({ msg: 'Using Claude Code executable', path: claudeExecutablePath })
      }
    } else {
      logger.info({ msg: 'Using default Claude API (ANTHROPIC_API_KEY from env)' })
    }

    // Build system prompt appendix from sections
    const appendSections: string[] = []

    if (options.outputsDir) {
      appendSections.push(`## Output Files\nWhen producing output files for the user (images, PDFs, documents, archives, code files, etc.), copy them to: ${options.outputsDir}\nUse \`cp\` via the Bash tool. The bridge will automatically send files placed there to the user in Feishu.`)
    }

    if (appendSections.length > 0) {
      queryOptions.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: '\n\n' + appendSections.join('\n\n'),
      }
    }

    if (options.maxTurns !== undefined) {
      queryOptions.maxTurns = options.maxTurns
    }

    if (options.maxBudgetUsd !== undefined) {
      queryOptions.maxBudgetUsd = options.maxBudgetUsd
    }

    if (options.sessionId) {
      queryOptions.resume = options.sessionId
    }

    // Enable skills support if requested
    if (options.enableSkills) {
      queryOptions.settingSources = options.settingSources || ['user','project']
      queryOptions.plugins = options.plugins || []
      logger.info({
        msg: 'Skills enabled',
        settingSources: queryOptions.settingSources,
        plugins: queryOptions.plugins
      })
    }

    return queryOptions
  }

  /**
   * Start a multi-turn execution session that allows sending tool results back to Claude
   */
  startExecution(options: ExecutorOptions): ExecutionHandle {
    const { prompt, cwd, sessionId, abortController } = options

    logger.info({ cwd, hasSession: !!sessionId }, 'Starting Claude execution (multi-turn)')

    const inputQueue = new AsyncQueue<SDKUserMessage>()

    // Push the initial user message
    const initialMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user' as const,
        content: prompt,
      },
      parent_tool_use_id: null,
      session_id: sessionId || '',
    }
    inputQueue.enqueue(initialMessage)

    const queryOptions = this.buildQueryOptions(options)

    const stream = query({
      prompt: inputQueue,
      options: queryOptions as any,
    })

    async function* wrapStream(): AsyncGenerator<SDKMessage> {
      try {
        for await (const message of stream) {
          yield message as SDKMessage
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || abortController.signal.aborted) {
          logger.info('Claude execution aborted')
          return
        }
        throw err
      }
    }

    return {
      stream: wrapStream(),
      sendAnswer: (toolUseId: string, sid: string, answerText: string) => {
        logger.info({ toolUseId }, 'Sending answer to Claude')
        const answerMessage: SDKUserMessage = {
          type: 'user',
          message: {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: answerText,
              },
            ],
          },
          parent_tool_use_id: null,
          session_id: sid,
        }
        inputQueue.enqueue(answerMessage)
      },
      finish: () => {
        inputQueue.finish()
      },
    }
  }

  /**
   * Simple one-shot execution (returns async generator of messages)
   */
  async *execute(options: ExecutorOptions): AsyncGenerator<SDKMessage> {
    const { prompt, cwd, sessionId, abortController } = options

    logger.info({ cwd, hasSession: !!sessionId }, 'Starting Claude execution')

    const queryOptions = this.buildQueryOptions(options)
    logger.debug(queryOptions);
    const stream = query({
      prompt,
      options: queryOptions as any,
    })

    try {
      for await (const message of stream) {
        logger.debug("收到消息")
        yield message as SDKMessage
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        logger.info('Claude execution aborted')
        return
      }
      throw err
    }
  }
}
