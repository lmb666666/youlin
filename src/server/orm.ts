import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Db } from '../types'
import { SqliteDb } from './db'
import * as schema from './schema'

export type Orm = BetterSQLite3Database<typeof schema>

// 同一个 Db 实例复用同一个 Drizzle 客户端；测试按文件创建独立内存库
const cache = new WeakMap<Db, Orm>()

export function getOrm(db: Db): Orm {
  const cached = cache.get(db)
  if (cached) return cached
  const orm = drizzle((db as SqliteDb).database, { schema })
  cache.set(db, orm)
  return orm
}
