import { and, ne, notLike, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { settings } from '../server/schema'
import type { Db } from '../types'

export function listSettings(db: Db): { key: string; value: string }[] {
  return getOrm(db).select({ key: settings.key, value: settings.value }).from(settings).all()
}

export function upsertSettings(db: Db, values: Record<string, unknown>): void {
  const entries = Object.entries(values)
  if (entries.length === 0) return
  getOrm(db).transaction((tx) => {
    for (const [key, value] of entries) {
      tx.insert(settings)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } })
        .run()
    }
  })
}

/** 整表替换：保留 internal.* 运行时簿记与 settings.schemaVersion */
export function replaceConfigSettings(db: Db, values: Record<string, unknown>): void {
  const entries = Object.entries(values)
  getOrm(db).transaction((tx) => {
    tx.delete(settings)
      .where(and(notLike(settings.key, 'internal.%'), ne(settings.key, 'settings.schemaVersion')))
      .run()
    for (const [key, value] of entries) {
      tx.insert(settings)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } })
        .run()
    }
  })
}
