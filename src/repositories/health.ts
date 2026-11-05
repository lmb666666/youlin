import { sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import type { Db } from '../types'

/** 健康检查的数据库探活 */
export function pingDatabase(db: Db): boolean {
  try {
    getOrm(db).get(sql`SELECT 1`)
    return true
  } catch {
    return false
  }
}
