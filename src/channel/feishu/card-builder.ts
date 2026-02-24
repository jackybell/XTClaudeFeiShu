export interface CardConfig {
  title?: string
  status?: 'thinking' | 'running' | 'success' | 'error'
  content?: string
  toolCalls?: ToolCall[]
  outputFiles?: { name: string; path: string; size: number }[]
  cost?: number
  duration?: number
}

export type ToolCallStatus = 'running' | 'done' | 'error'

export interface ToolCall {
  name: string
  detail: string
  status: ToolCallStatus
}

export function buildCard(config: CardConfig): any {
  const card: any = {
    config: {
      wide_screen_mode: true
    },
    elements: []
  }

  // 带标题的头部
  if (config.title) {
    card.header = {
      title: {
        tag: 'plain_text',
        content: config.title
      },
      template: config.status || 'blue'
    }
  }

  // 状态指示器
  if (config.status) {
    const statusColors = {
      thinking: 'grey',
      running: 'blue',
      success: 'green',
      error: 'red'
    }
    if (!card.header) {
      card.header = {
        title: {
          tag: 'plain_text',
          content: '状态'
        },
        template: statusColors[config.status]
      }
    } else {
      card.header.template = statusColors[config.status]
    }
  }

  // 内容
  if (config.content) {
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: config.content
      }
    })
  }

  // 工具调用
  if (config.toolCalls && config.toolCalls.length > 0) {
    card.elements.push({
      tag: 'hr'
    })
    // 根据状态显示不同图标
    const statusIcons: Record<string, string> = {
      running: '🔄',  // 运行中
      done: '✅',     // 完成
      error: '❌'      // 错误
    }
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**工具调用:**\n' + config.toolCalls.map(t =>
          `${statusIcons[t.status] || '⏳'} \`${t.name}\`${t.detail ? ' ' + t.detail : ''}`
        ).join('\n')
      }
    })
  }

  // 输出文件
  if (config.outputFiles && config.outputFiles.length > 0) {
    card.elements.push({
      tag: 'hr'
    })
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**输出文件:**\n' + config.outputFiles.map(f =>
          `- ${f.name} (${formatSize(f.size)})`
        ).join('\n')
      }
    })
  }

  // 费用和耗时
  if (config.cost !== undefined || config.duration !== undefined) {
    card.elements.push({
      tag: 'hr'
    })
    const stats = []
    if (config.cost !== undefined) {
      stats.push(`费用: $${config.cost.toFixed(4)}`)
    }
    if (config.duration !== undefined) {
      stats.push(`耗时: ${formatDuration(config.duration)}`)
    }
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: stats.join(' | ')
      }
    })
  }

  return card
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  const mins = Math.floor(ms / 60000)
  const secs = ((ms % 60000) / 1000).toFixed(0)
  return `${mins}m ${secs}s`
}

// 确认卡片模板
export function buildConfirmCard(prompt: string, options: string[] = ['确认', '取消']): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '请确认' },
      template: 'yellow'
    },
    elements: [{
      tag: 'div',
      text: { tag: 'lark_md', content: `**${prompt}**` }
    }, {
      tag: 'hr'
    }, {
      tag: 'action',
      actions: options.map(opt => ({
        tag: 'button',
        text: { tag: 'plain_text', content: opt },
        value: opt.toLowerCase()
      }))
    }]
  }
}

// 选择卡片模板
export function buildChoiceCard(prompt: string, options: string[]): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '请选择' },
      template: 'blue'
    },
    elements: [{
      tag: 'div',
      text: { tag: 'lark_md', content: `**${prompt}**` }
    }, {
      tag: 'hr'
    }, {
      tag: 'action',
      actions: options.map((opt, idx) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: opt },
        value: `option_${idx}`
      }))
    }]
  }
}

// 输入提示卡片模板
export function buildInputPromptCard(prompt: string): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '需要输入' },
      template: 'grey'
    },
    elements: [{
      tag: 'div',
      text: { tag: 'lark_md', content: `**${prompt}**\n\n请直接回复消息` }
    }]
  }
}

/**
 * 格式化工具调用详情
 * 参照 feishu-claudecode 项目的 formatToolDetail 实现
 */
export function formatToolDetail(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''

  const inp = input as Record<string, unknown>

  switch (name) {
    case 'Read':
      return inp.file_path ? `\`${shortenPath(inp.file_path as string)}\`` : ''
    case 'Write':
      return inp.file_path ? `\`${shortenPath(inp.file_path as string)}\`` : ''
    case 'Edit':
      return inp.file_path ? `\`${shortenPath(inp.file_path as string)}\`` : ''
    case 'Bash':
      return inp.command ? `\`${truncate(inp.command as string, 60)}\`` : ''
    case 'Glob':
      return inp.pattern ? `\`${inp.pattern}\`` : ''
    case 'Grep':
      return inp.pattern ? `\`${inp.pattern}\`` : ''
    case 'WebSearch':
      return inp.query ? `"${truncate(inp.query as string, 50)}"` : ''
    case 'WebFetch':
      return inp.url ? `\`${truncate(inp.url as string, 60)}\`` : ''
    case 'Task':
      return inp.description ? `${truncate(inp.description as string, 50)}` : ''
    case 'AskUserQuestion': {
      const qs = inp.questions
      if (Array.isArray(qs) && qs.length > 0) {
        const first = qs[0] as Record<string, unknown>
        return first.question ? truncate(String(first.question), 50) : ''
      }
      return ''
    }
    default:
      return ''
  }
}

/**
 * 缩短文件路径显示
 * 例如: `/home/user/project/src/index.ts` -> `.../src/index.ts`
 */
function shortenPath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 3) return filePath
  return '.../' + parts.slice(-2).join('/')
}

/**
 * 截断文本到指定长度
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}
