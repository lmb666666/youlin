export const SCHEDULER_LOCK_KEY = 'internal.schedulerLock'
/** 短 TTL + 心跳：进程崩溃后最多阻塞 90 秒，长任务靠续租维持 */
export const SCHEDULER_LOCK_TTL_MS = 90_000
export const SCHEDULER_LOCK_RENEW_MS = 30_000
