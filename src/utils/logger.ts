import pino from 'pino'
import fs from 'fs'
import path from 'path'

// 确保日志目录存在
const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

// 创建文件日志流
const logFile = path.join(logsDir, 'app.log')
const errorLogFile = path.join(logsDir, 'error.log')

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label }
    }
  }
}, pino.multistream([
  // 控制台输出（美化格式）
  {
    level: process.env.LOG_LEVEL || 'info',
    stream: pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        sync: false
      }
    })
  },
  // 所有日志写入文件
  {
    level: 'trace',
    stream: pino.destination({ dest: logFile, sync: false })
  },
  // 错误日志写入单独文件
  {
    level: 'error',
    stream: pino.destination({ dest: errorLogFile, sync: false })
  }
]))
