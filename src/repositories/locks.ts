import type { Db } from '../types'

/**
 * 基于 settings 表的跨进程短锁。
 *
 * SQLite 单条 upsert 是原子的：仅当没有锁或已过期时才覆盖。
 * 锁带 TTL，进程崩溃后最多阻塞一个 TTL；持有者释放时校验 owner，避免误删。
 */

export interface LockInfo {
  owner: string
  expiresAt: number
}

export async function acquireLock(db: Db, key: string, owner: string, ttlMs: number, now = Date.now()): Promise<boolean> {
  const value = JSON.stringify({ owner, expiresAt: now + ttlMs } satisfies LockInfo)
  const result = await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CASE WHEN json_valid(settings.value)
                  THEN json_extract(settings.value, '$.expiresAt')
                  ELSE 0 END <= ?`,
    )
    .bind(key, value, now)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function renewLock(db: Db, key: string, owner: string, ttlMs: number, now = Date.now()): Promise<boolean> {
  const value = JSON.stringify({ owner, expiresAt: now + ttlMs } satisfies LockInfo)
  const result = await db
    .prepare(
      `UPDATE settings SET value = ?
        WHERE key = ?
          AND CASE WHEN json_valid(value) THEN json_extract(value, '$.owner') ELSE NULL END = ?`,
    )
    .bind(value, key, owner)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function releaseLock(db: Db, key: string, owner: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM settings
        WHERE key = ?
          AND CASE WHEN json_valid(value) THEN json_extract(value, '$.owner') ELSE NULL END = ?`,
    )
    .bind(key, owner)
    .run()
}

export async function readLock(db: Db, key: string): Promise<LockInfo | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as Partial<LockInfo>
    return typeof parsed.owner === 'string' && typeof parsed.expiresAt === 'number'
      ? { owner: parsed.owner, expiresAt: parsed.expiresAt }
      : null
  } catch {
    return null
  }
}
