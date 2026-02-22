import * as lark from '@larksuiteoapi/node-sdk'
import { createReadStream } from 'fs'
import type { IChannel } from '../IChannel.interface.js'
import type { Message, Card } from '../../types/index.js'
import type { FeishuEvent } from '../types.js'
import { FeishuEventHandler } from './event-handler.js'
import { buildCard } from './card-builder.js'
import { logger } from '../../utils/logger.js'

export class FeishuChannel implements IChannel {
  readonly channelType = 'feishu'

  private client: lark.Client
  private eventHandler: FeishuEventHandler
  private wsClient: lark.WSClient
  private eventDispatcher: lark.EventDispatcher
  private messageCallback?: (message: Message) => void | Promise<void>

  constructor(
    private appId: string,
    appSecret: string,
    botId: string
  ) {
    this.client = new lark.Client({
      appId,
      appSecret
    })
    this.eventHandler = new FeishuEventHandler(botId)
    this.eventDispatcher = new lark.EventDispatcher({
      loggerLevel: lark.LoggerLevel.error
    })
    this.eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        await this.handleEvent(data)
      }
    })
    this.wsClient = new lark.WSClient({
      appId,
      appSecret,
      loggerLevel: lark.LoggerLevel.error
    })
  }

  async initialize(): Promise<void> {
    await this.wsClient.start({
      eventDispatcher: this.eventDispatcher
    })
    logger.info({ msg: 'Feishu channel initialized', appId: this.appId })
  }

  private async handleEvent(event: FeishuEvent): Promise<void> {
    try {
      if (event.header.event_type !== 'im.message.receive_v1') {
        return
      }

      if (!this.eventHandler.verifyAuth(event)) {
        logger.warn({ msg: 'Auth verification failed' })
        return
      }

      if (!this.eventHandler.isMentioned(event)) {
        return
      }

      const message = this.eventHandler.toMessage(event)
      if (this.messageCallback) {
        await this.messageCallback(message)
      }
    } catch (error) {
      logger.error({ msg: 'Error handling event', error })
    }
  }

  onMessage(callback: (message: Message) => void | Promise<void>): void {
    this.messageCallback = callback
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text })
      }
    })
  }

  async sendCard(chatId: string, card: Card): Promise<void> {
    const cardConfig = this.toCardConfig(card)
    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardConfig)
      }
    })
  }

  async updateCard(_chatId: string, cardId: string, card: Card): Promise<void> {
    const cardConfig = this.toCardConfig(card)
    await this.client.im.message.patch({
      path: {
        message_id: cardId
      },
      data: {
        content: JSON.stringify(cardConfig)
      }
    })
  }

  async sendFile(chatId: string, filePath: string): Promise<void> {
    // Upload file first, then send
    const fileName = filePath.split('/').pop() as string
    const fileStream = createReadStream(filePath)

    // Use drive.file.uploadAll for general file upload
    const uploadResult = await this.client.drive.file.uploadAll({
      data: {
        file_name: fileName,
        parent_type: 'explorer',
        parent_node: 'root',
        size: 0,
        file: fileStream
      }
    })

    if (!uploadResult?.file_token) {
      throw new Error('Failed to upload file')
    }

    // Send file message
    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: chatId,
        msg_type: 'file',
        content: JSON.stringify({
          file_key: uploadResult.file_token
        })
      }
    })
  }

  async getUserInfo(userId: string): Promise<{ name: string; avatar?: string }> {
    const result = await this.client.contact.user.get({
      params: {
        user_id_type: 'open_id'
      },
      path: {
        user_id: userId
      }
    })

    return {
      name: result.data?.user?.name || 'Unknown',
      avatar: result.data?.user?.avatar?.avatar_72
    }
  }

  verifyAuth(event: any): boolean {
    return this.eventHandler.verifyAuth(event)
  }

  isMentioned(event: any, _botId: string): boolean {
    return this.eventHandler.isMentioned(event)
  }

  extractMessage(event: any): { text: string; images?: string[]; files?: any[] } {
    return this.eventHandler.extractMessageContent(event)
  }

  async shutdown(): Promise<void> {
    this.wsClient.close()
    logger.info({ msg: 'Feishu channel shut down' })
  }

  private toCardConfig(card: Card): any {
    if (card.type === 'text') {
      return {
        config: {
          wide_screen_mode: true
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: card.content
            }
          }
        ]
      }
    }

    return buildCard(card.content)
  }
}
