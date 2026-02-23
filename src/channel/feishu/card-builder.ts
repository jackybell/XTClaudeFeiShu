export interface CardConfig {
  title?: string
  status?: 'thinking' | 'running' | 'success' | 'error'
  content?: string
  toolCalls?: { name: string; status: string }[]
  outputFiles?: { name: string; path: string; size: number }[]
  cost?: number
  duration?: number
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
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**工具调用:**\n' + config.toolCalls.map(t =>
          `- \`${t.name}\` ${t.status}`
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
