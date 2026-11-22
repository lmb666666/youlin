/**
 * 并发池：按并发上限跑完所有任务。
 * 注意：fn 抛出的异常会取消剩余队列并向上传递——需要单项隔离的调用方
 * 必须在 fn 内部自行 try/catch（当前 crawl/linkcheck 两个调用点均如此）。
 */
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Math.max(1, Math.min(limit, queue.length))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
