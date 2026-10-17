import type { Context } from 'hono'

/**
 * 后台任务：Workers 用 waitUntil 延续执行，Node 没有执行上下文但进程常驻，
 * 直接放行 Promise 即可（异常统一记录，避免 unhandled rejection）。
 */
export function runInBackground(c: Context, task: Promise<unknown>): void {
  const guarded = task.catch((err) => {
    console.error('[bg] 后台任务失败:', err instanceof Error ? err.stack : err)
  })
  try {
    c.executionCtx.waitUntil(guarded)
  } catch {
    // Node：无常驻执行上下文，Promise 自行完成
  }
}
