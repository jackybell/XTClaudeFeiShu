import chokidar from 'chokidar'
import { logger } from '../utils/logger.js'

export interface FileChangeEvent {
  type: 'add' | 'change'
  path: string
  timestamp: number
}

export class FileWatcher {
  private watcher?: ReturnType<typeof chokidar.watch>
  private fileSentTimestamps: Map<string, number> = new Map()
  private readonly DEBOUNCE_MS = 5000

  constructor(
    private workDir: string,
    private onFileChange: (event: FileChangeEvent) => void | Promise<void>
  ) {}

  start(): void {
    this.watcher = chokidar.watch(this.workDir, {
      ignoreInitial: true,
      ignored: /node_modules|\.git|dist|\.claude|outputs/,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })

    this.watcher
      .on('add', (path: string) => this.handleFileChange('add', path))
      .on('change', (path: string) => this.handleFileChange('change', path))
      .on('error', (error: unknown) => logger.error({ msg: 'File watcher error', error }))

    logger.info({ msg: 'File watcher started', workDir: this.workDir })
  }

  private async handleFileChange(type: 'add' | 'change', path: string): Promise<void> {
    const now = Date.now()
    const lastSent = this.fileSentTimestamps.get(path)

    // Debounce: don't send same file within 5 seconds
    if (lastSent && now - lastSent < this.DEBOUNCE_MS) {
      logger.debug({ msg: 'File change debounced', path })
      return
    }

    this.fileSentTimestamps.set(path, now)

    await this.onFileChange({ type, path, timestamp: now })
    logger.info({ msg: 'File change detected', type, path })
  }

  stop(): void {
    this.watcher?.close()
    this.fileSentTimestamps.clear()
    logger.info({ msg: 'File watcher stopped' })
  }
}
