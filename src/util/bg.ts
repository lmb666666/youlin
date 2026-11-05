import { logger } from '../log'

/**
 * 后台任务：进程常驻，直接放行 Promise 即可（异常统一记录，避免 unhandled rejection）。
 */
export function runDetached(task: Promise<unknown>): void {
  task.catch((err) => {
    logger.error({ err }, 'background task failed')
  })
}
