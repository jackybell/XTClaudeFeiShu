import pino from 'pino'
import fs from 'fs'
import path from 'path'

const isDevelopment = process.env.NODE_ENV !== 'production'

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

// Create streams for file logging
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
  // Console output with pretty print
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
  // All logs to file
  {
    level: 'trace',
    stream: pino.destination({ dest: logFile, sync: false })
  },
  // Error logs to separate file
  {
    level: 'error',
    stream: pino.destination({ dest: errorLogFile, sync: false })
  }
]))
