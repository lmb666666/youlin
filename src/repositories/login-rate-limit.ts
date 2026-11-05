import { and, count, eq, gt, lt } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { loginAttempts } from '../server/schema'
import type { Db } from '../types'

const WINDOW_MS = 3_600_000

/** 原子消费一次登录尝试：未超限则记录并返回 true */
export function consumeLoginAttempt(db: Db, ip: string, limit: number, now = Date.now()): boolean {
  return getOrm(db).transaction((tx) => {
    const cutoff = now - WINDOW_MS
    tx.delete(loginAttempts).where(lt(loginAttempts.at, cutoff)).run()
    const used = Number(
      tx.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.at, cutoff))).get()?.n ?? 0,
    )
    if (used >= limit) return false
    tx.insert(loginAttempts).values({ ip, at: now }).run()
    return true
  })
}

/** 登录成功后清空该 IP 的历史尝试 */
export function resetLoginAttempts(db: Db, ip: string): void {
  getOrm(db).delete(loginAttempts).where(eq(loginAttempts.ip, ip)).run()
}
