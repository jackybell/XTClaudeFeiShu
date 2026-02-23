/**
 * 实现 AsyncIterable 的异步队列。
 * 生产者调用 enqueue() 添加项目，消费者使用 for-await-of 读取。
 * finish() 表示不会再添加更多项目。
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolve: (() => void) | null = null;
  private finished = false;

  enqueue(item: T): void {
    if (this.finished) return;
    this.queue.push(item);
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  finish(): void {
    this.finished = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.finished) return;
      await new Promise<void>((r) => {
        this.resolve = r;
      });
    }
  }
}
