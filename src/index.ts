import 'dotenv/config'
import { configManager } from './config.js'
import { FeishuChannel } from './channel/feishu/FeishuChannel.js'
import { MessageBridge } from './bridge/MessageBridge.js'
import { sessionManager } from './bridge/SessionManager.js'
import { logger } from './utils/logger.js'

// 为 Windows 控制台设置 UTF-8 编码以修复中文显示问题
if (process.platform === 'win32') {
  process.stdout.setEncoding('utf8')
  process.stderr.setEncoding('utf8')
}

async function main() {
  try {
    // 加载配置
    await configManager.load()

    // 启动会话清理定时器
    sessionManager.startCleanupInterval()

    // 初始化机器人
    const bots = configManager.getBots()
    const bridges: MessageBridge[] = []

    for (const botConfig of bots) {
      logger.info({ msg: 'Initializing bot', name: botConfig.name })

      // 创建渠道
      const channel = new FeishuChannel(
        botConfig.feishuAppId,
        botConfig.feishuAppSecret,
        botConfig.feishuAppId // 暂时使用 appId 作为 botId
      )

      // 创建消息桥接器
      const bridge = new MessageBridge(botConfig, channel)

      // 设置消息处理器
      channel.onMessage(async (message) => {
        await bridge.handle(message)
      })

      // 初始化渠道
      await channel.initialize()

      bridges.push(bridge)
    }

    logger.info({ msg: 'Started', botCount: bridges.length })

    // 优雅关闭
    process.on('SIGINT', async () => {
      logger.info({ msg: 'Shutting down...' })
      // 渠道会自动清理
      process.exit(0)
    })

  } catch (error) {
    logger.error({ msg: 'Failed to start', error })
    process.exit(1)
  }
}

main()
