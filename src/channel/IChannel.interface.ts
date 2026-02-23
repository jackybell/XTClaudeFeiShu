import type { Message, Card } from '../types/index.js'

export interface IChannel {
  // 渠道元数据
  readonly channelType: string

  // 初始化渠道（设置 WebSocket 等）
  initialize(): Promise<void>

  // 开始监听消息
  onMessage(callback: (message: Message) => void | Promise<void>): void

  // 发送文本消息
  sendText(chatId: string, text: string): Promise<void>

  // 发送卡片消息，返回卡片/消息 ID
  sendCard(chatId: string, card: Card): Promise<string>

  // 更新现有卡片
  updateCard(chatId: string, cardId: string, card: Card): Promise<void>

  // 发送文件
  sendFile(chatId: string, filePath: string): Promise<void>

  // 获取用户信息
  getUserInfo(userId: string): Promise<{ name: string; avatar?: string }>

  // 验证消息是否真实
  verifyAuth(event: any): boolean

  // 检查消息是否提及机器人（用于群聊）
  isMentioned(event: any, botId: string): boolean

  // 提取消息内容
  extractMessage(event: any): { text: string; images?: string[]; files?: any[] }

  // 关闭渠道
  shutdown(): Promise<void>
}
