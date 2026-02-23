import type { Message } from '../../types/index.js'
import type { FeishuEvent } from '../types.js'

export class FeishuEventHandler {
  private botId: string

  constructor(botId: string) {
    this.botId = botId
  }

  verifyAuth(_event: any): boolean {
    // 飞书已通过签名验证
    return true
  }

  isMentioned(event: any): boolean {
    // 处理实际的 SDK 事件结构（event.message，而不是 event.event.message）
    const message = event.message || event.event?.message
    if (!message) {
      return false
    }

    const chatType = message.chat_type
    if (chatType !== 'group') {
      return true // 私聊始终视为已提及
    }

    // 检查机器人在群聊中是否被提及
    const mention = message.mentions
    if (!mention) {
      return false
    }

    return mention.some((m: any) =>
      m.bot && m.id.open_id === this.botId
    )
  }

  extractMessageContent(event: any): { text: string; images?: string[] } {
    // 处理实际的 SDK 事件结构
    const message = event.message || event.event?.message
    if (!message) {
      return { text: '[Invalid message]' }
    }

    const messageType = message.message_type

    try {
      // 记录原始内容用于调试
      console.log('Raw content:', message.content)
      console.log('Content type:', typeof message.content)

      const content = JSON.parse(message.content)

      if (messageType === 'text') {
        return { text: content.text }
      }
    } catch (error) {
      console.error('Failed to parse message content:', error)
      console.error('Raw content string:', message.content)
    }

    // TODO: 处理图片和文件类型
    return { text: '[Unsupported message type]' }
  }

  stripMention(text: string): string {
    // 移除 @提及标签，如 @_AT_
    return text.replace(/@_AT_[^_]+_/g, '').trim()
  }

  toMessage(event: any): Message {
    // 处理实际的 SDK 事件结构
    const message = event.message || event.event?.message
    const sender = event.sender || event.event?.sender

    if (!message || !sender) {
      throw new Error('Invalid event structure: missing message or sender')
    }

    const { text, images } = this.extractMessageContent(event)

    return {
      chatId: message.chat_id,
      userId: sender.sender_id.open_id,
      userName: sender.sender_id.open_id, // 稍后获取实际名称
      text: this.stripMention(text),
      images,
      messageType: message.chat_type as 'private' | 'group',
      rawEvent: event
    }
  }
}
