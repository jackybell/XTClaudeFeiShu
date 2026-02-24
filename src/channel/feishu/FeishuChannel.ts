import * as lark from '@larksuiteoapi/node-sdk'
import { createReadStream } from 'fs'
import type { IChannel } from '../IChannel.interface.js'
import type { Message, Card } from '../../types/index.js'
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
  // 事件去重：跟踪已处理的事件 ID
  private processedEvents = new Set<string>()
  private readonly MAX_PROCESSED_EVENTS = 1000

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

  private async handleEvent(event: any): Promise<void> {
    try {
      // 提取事件 ID 用于去重
      const eventId = event?.header?.event_id || event?.event_id || JSON.stringify(event)

      // 检查事件是否已处理过
      if (this.processedEvents.has(eventId)) {
        logger.warn({ msg: 'Duplicate event detected, skipping', eventId })
        return
      }

      // 添加到已处理事件
      this.processedEvents.add(eventId)

      // 清理旧的事件 ID 以防止内存泄漏
      if (this.processedEvents.size > this.MAX_PROCESSED_EVENTS) {
        const firstEvent = this.processedEvents.values().next().value
        if (firstEvent) {
          this.processedEvents.delete(firstEvent)
        }
      }

      logger.info({ msg: 'Event received', eventId, eventKeys: Object.keys(event) })

      // 检查事件结构
      const eventType = event?.header?.event_type || event?.event_type
      logger.info({ msg: 'Event type', eventType, eventId })

      // 检查卡片回调事件
      if (eventType === 'card.action.triggered') {
        await this.handleCardCallback(event)
        return
      }

      if (eventType !== 'im.message.receive_v1') {
        return
      }

      if (!this.eventHandler.verifyAuth(event)) {
        logger.warn({ msg: 'Auth verification failed', eventId })
        return
      }

      const isMentioned = this.eventHandler.isMentioned(event)
      logger.info({ msg: 'Checking mention', isMentioned, chatType: event.event?.message?.chat_type, eventId })

      if (!isMentioned) {
        logger.info({ msg: 'Message not mentioned, skipping', eventId })
        return
      }

      const message = this.eventHandler.toMessage(event)
      logger.info({ msg: 'Message processed', chatId: message.chatId, userId: message.userId, text: message.text, eventId })

      if (this.messageCallback) {
        await this.messageCallback(message)
      }
    } catch (error: any) {
      logger.error({ msg: 'Error handling event', error: error?.message || error?.toString(), stack: error?.stack })
    }
  }

  private async handleCardCallback(event: any): Promise<void> {
    try {
      const action = event.action
      const userId = event.triggered_user_id?.open_id || event.sender?.sender_id?.open_id
      const chatId = event.open_chat_id || event.token?.chat_id

      if (!userId || !chatId) {
        logger.error({ msg: 'Invalid card callback event', event })
        return
      }

      // 提取按钮值
      const actionValue = action?.value || action?.text

      // 从回调创建消息
      const message: Message = {
        chatId,
        userId,
        userName: userId,
        text: actionValue,
        messageType: 'private',
        rawEvent: event
      }

      logger.info({ msg: 'Card callback converted to message', actionValue, userId })

      if (this.messageCallback) {
        await this.messageCallback(message)
      }
    } catch (error: any) {
      logger.error({ msg: 'Error handling card callback', error })
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

  async sendCard(chatId: string, card: Card): Promise<string> {
    const cardConfig = this.toCardConfig(card)
    const result = await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardConfig)
      }
    })
    // 返回消息 ID 用于后续更新
    const messageId = (result?.data as any)?.message_id || (result as any)?.message_id || ''
    logger.info({ msg: 'Card sent', cardId: messageId, cardType: card.type, hasMessageId: !!messageId })
    return messageId
  }

  async updateCard(_chatId: string, cardId: string, card: Card): Promise<void> {
    const cardConfig = this.toCardConfig(card)
    logger.info({ msg: 'Updating card', cardId, cardType: card.type })
    try {
      await this.client.im.message.patch({
        path: {
          message_id: cardId
        },
        data: {
          content: JSON.stringify(cardConfig)
        }
      })
      logger.info({ msg: 'Card updated', cardId })
    } catch (error: any) {
      // 优雅处理飞书速率限制错误
      if (error?.response?.data?.code === 230020) {
        logger.warn({ msg: 'Rate limit hit, skipping card update', cardId })
        return
      }
      // 重新抛出其他错误
      throw error
    }
  }

  async sendFile(chatId: string, filePath: string): Promise<void> {
    // 先上传文件，然后发送
    const fileName = filePath.split('/').pop() as string
    const fileStream = createReadStream(filePath)

    // 使用 drive.file.uploadAll 进行通用文件上传
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

    // 发送文件消息
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
      // 返回正确飞书格式的卡片配置
      return {
        config: {
          wide_screen_mode: true
        },
        header: {
          title: {
            tag: 'plain_text',
            content: '消息'
          },
          template: 'grey'
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
