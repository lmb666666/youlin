/** 并发池：按并发上限跑完所有任务（调用方自行处理单项异常） */
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
