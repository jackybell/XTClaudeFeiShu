import 'dotenv/config'
import { configManager } from './config.js'
import { FeishuChannel } from './channel/feishu/FeishuChannel.js'
import { MessageBridge } from './bridge/MessageBridge.js'
import { sessionManager } from './bridge/SessionManager.js'
import { logger } from './utils/logger.js'

async function main() {
  try {
    // Load configuration
    await configManager.load()

    // Start session cleanup interval
    sessionManager.startCleanupInterval()

    // Initialize bots
    const bots = configManager.getBots()
    const bridges: MessageBridge[] = []

    for (const botConfig of bots) {
      logger.info({ msg: 'Initializing bot', name: botConfig.name })

      // Create channel
      const channel = new FeishuChannel(
        botConfig.feishuAppId,
        botConfig.feishuAppSecret,
        botConfig.feishuAppId // Use appId as botId for now
      )

      // Create bridge
      const bridge = new MessageBridge(botConfig, channel)

      // Setup message handler
      channel.onMessage(async (message) => {
        await bridge.handle(message)
      })

      // Initialize channel
      await channel.initialize()

      bridges.push(bridge)
    }

    logger.info({ msg: 'Started', botCount: bridges.length })

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info({ msg: 'Shutting down...' })
      // Channels will be cleaned up automatically
      process.exit(0)
    })

  } catch (error) {
    logger.error({ msg: 'Failed to start', error })
    process.exit(1)
  }
}

main()
