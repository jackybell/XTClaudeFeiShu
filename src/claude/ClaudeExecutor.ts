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
  // 结果字段
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
  // 流事件字段
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
    // 将环境变量传递给子进程（用于 ANTHROPIC_AUTH_TOKEN 等）
    // const env: Record<string, string> = {
    //   ...process.env,
    //   // 确保关键环境变量被传递
    // }
    const queryOptions: Record<string, unknown> = {
      allowedTools: options.allowedTools,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      cwd: options.cwd,
      abortController: options.abortController,
      includePartialMessages: true,
      extraArgs: { verbose: null },  // includePartialMessages 工作所必需的
      // 从用户/项目配置文件加载 MCP 服务器和设置
      settingSources: ['user', 'project'],
    }

    // 根据平台配置 Claude 可执行文件路径
    const claudeExecutablePath = process.env.CLAUDE_EXECUTABLE_PATH
    const isWindows = os.platform() === 'win32'

    if (claudeExecutablePath) {
      if (isWindows && claudeExecutablePath.endsWith('.cmd')) {
        // 在 Windows 上，.cmd 文件不能直接生成
        // 使用 node 可执行文件并将 cli.js 作为参数
        const cmdDir = path.dirname(claudeExecutablePath)
        const cliJsPath = path.join(cmdDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
        queryOptions.executable = 'node' as const
        queryOptions.executableArgs = [cliJsPath]
        logger.info({ msg: 'Using Claude Code executable (Windows)', cliJsPath })
      } else {
        // 在 Unix/Linux/macOS 上，直接使用可执行文件路径
        queryOptions.pathToClaudeCodeExecutable = claudeExecutablePath
        logger.info({ msg: 'Using Claude Code executable', path: claudeExecutablePath })
      }
    } else {
      logger.info({ msg: 'Using default Claude API (ANTHROPIC_API_KEY from env)' })
    }

    // 从部分构建系统提示附录
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

    // 如果请求，启用技能支持
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
   * 启动多轮执行会话，允许将工具结果发送回 Claude
   */
  startExecution(options: ExecutorOptions): ExecutionHandle {
    const { prompt, cwd, sessionId, abortController } = options

    logger.info({ cwd, hasSession: !!sessionId }, 'Starting Claude execution (multi-turn)')

    const inputQueue = new AsyncQueue<SDKUserMessage>()

    // 推送初始用户消息
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
   * 简单的一次性执行（返回消息的异步生成器）
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
        yield message as SDKMessage
        logger.debug("Receive Messages"+JSON.stringify(message))
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
