import type { Context } from 'hono'

/**
 * 后台任务：进程常驻，直接放行 Promise 即可（异常统一记录，避免 unhandled rejection）。
 */
export function runInBackground(_c: Context, task: Promise<unknown>): void {
  task.catch((err) => {
    console.error('[bg] 后台任务失败:', err instanceof Error ? err.stack : err)
  })
}
