import type { Message, Card } from '../types/index.js'

export interface IChannel {
  // Channel metadata
  readonly channelType: string

  // Initialize channel (setup WebSocket, etc.)
  initialize(): Promise<void>

  // Start listening for messages
  onMessage(callback: (message: Message) => void | Promise<void>): void

  // Send text message
  sendText(chatId: string, text: string): Promise<void>

  // Send card message, returns card/message ID
  sendCard(chatId: string, card: Card): Promise<string>

  // Update existing card
  updateCard(chatId: string, cardId: string, card: Card): Promise<void>

  // Send file
  sendFile(chatId: string, filePath: string): Promise<void>

  // Get user info
  getUserInfo(userId: string): Promise<{ name: string; avatar?: string }>

  // Verify if message is authentic
  verifyAuth(event: any): boolean

  // Check if message mentions the bot (for group chats)
  isMentioned(event: any, botId: string): boolean

  // Extract message content
  extractMessage(event: any): { text: string; images?: string[]; files?: any[] }

  // Shutdown channel
  shutdown(): Promise<void>
}
