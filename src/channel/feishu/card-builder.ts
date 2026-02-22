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
    header: config.title ? {
      title: {
        tag: 'plain_text',
        content: config.title
      },
      template: config.status || 'blue'
    } : undefined,
    elements: []
  }

  // Status indicator
  if (config.status) {
    const statusColors = {
      thinking: 'grey',
      running: 'blue',
      success: 'green',
      error: 'red'
    }
    card.header = card.header || {}
    card.header.template = statusColors[config.status]
  }

  // Content
  if (config.content) {
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: config.content
      }
    })
  }

  // Tool calls
  if (config.toolCalls && config.toolCalls.length > 0) {
    card.elements.push({
      tag: 'hr'
    })
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**Tool Calls:**\n' + config.toolCalls.map(t =>
          `- \`${t.name}\` ${t.status}`
        ).join('\n')
      }
    })
  }

  // Output files
  if (config.outputFiles && config.outputFiles.length > 0) {
    card.elements.push({
      tag: 'hr'
    })
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**Output Files:**\n' + config.outputFiles.map(f =>
          `- ${f.name} (${formatSize(f.size)})`
        ).join('\n')
      }
    })
  }

  // Cost and duration
  if (config.cost !== undefined || config.duration !== undefined) {
    card.elements.push({
      tag: 'hr'
    })
    const stats = []
    if (config.cost !== undefined) {
      stats.push(`Cost: $${config.cost.toFixed(4)}`)
    }
    if (config.duration !== undefined) {
      stats.push(`Duration: ${formatDuration(config.duration)}`)
    }
    card.elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: stats.join(' | ')
      }
    })
  }

  return { config: card }
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
