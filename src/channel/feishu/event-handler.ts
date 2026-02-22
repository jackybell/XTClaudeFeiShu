import type { Message } from '../../types/index.js'
import type { FeishuEvent } from '../types.js'

export class FeishuEventHandler {
  private botId: string

  constructor(botId: string) {
    this.botId = botId
  }

  verifyAuth(_event: FeishuEvent): boolean {
    // Feishu already verifies via signature
    return true
  }

  isMentioned(event: FeishuEvent): boolean {
    const chatType = event.event.message.chat_type
    if (chatType !== 'group') {
      return true // Private chat always counts as mentioned
    }

    // Check if bot is mentioned in group
    const mention = event.event.message.mention
    if (!mention) {
      return false
    }

    return mention.some((m: any) =>
      m.bot && m.id.open_id === this.botId
    )
  }

  extractMessageContent(event: FeishuEvent): { text: string; images?: string[] } {
    const messageType = event.event.message.message_type
    const content = JSON.parse(event.event.message.content)

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

  toMessage(event: FeishuEvent): Message {
    const sender = event.event.sender
    const message = event.event.message
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
