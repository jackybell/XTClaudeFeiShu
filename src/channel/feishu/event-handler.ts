import type { Message } from '../../types/index.js'
import type { FeishuEvent } from '../types.js'

export class FeishuEventHandler {
  private botId: string

  constructor(botId: string) {
    this.botId = botId
  }

  verifyAuth(_event: any): boolean {
    // Feishu already verifies via signature
    return true
  }

  isMentioned(event: any): boolean {
    // Handle actual SDK event structure (event.message, not event.event.message)
    const message = event.message || event.event?.message
    if (!message) {
      return false
    }

    const chatType = message.chat_type
    if (chatType !== 'group') {
      return true // Private chat always counts as mentioned
    }

    // Check if bot is mentioned in group
    const mention = message.mentions
    if (!mention) {
      return false
    }

    return mention.some((m: any) =>
      m.bot && m.id.open_id === this.botId
    )
  }

  extractMessageContent(event: any): { text: string; images?: string[] } {
    // Handle actual SDK event structure
    const message = event.message || event.event?.message
    if (!message) {
      return { text: '[Invalid message]' }
    }

    const messageType = message.message_type
    const content = JSON.parse(message.content)

    if (messageType === 'text') {
      return { text: content.text }
    }

    // TODO: Handle image and file types
    return { text: '[Unsupported message type]' }
  }

  stripMention(text: string): string {
    // Remove @mention tags like @_AT_
    return text.replace(/@_AT_[^_]+_/g, '').trim()
  }

  toMessage(event: any): Message {
    // Handle actual SDK event structure
    const message = event.message || event.event?.message
    const sender = event.sender || event.event?.sender

    if (!message || !sender) {
      throw new Error('Invalid event structure: missing message or sender')
    }

    const { text, images } = this.extractMessageContent(event)

    return {
      chatId: message.chat_id,
      userId: sender.sender_id.open_id,
      userName: sender.sender_id.open_id, // Will fetch actual name later
      text: this.stripMention(text),
      images,
      messageType: message.chat_type as 'private' | 'group',
      rawEvent: event
    }
  }
}
