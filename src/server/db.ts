import Database from 'better-sqlite3'
import type { Db, DbStatement, DbResult } from '../types'

/**
 * SQLite 异步适配层：把 better-sqlite3 的同步 API 包成应用使用的异步形状。
 *
 * 只实现项目实际用到的子集：prepare / bind / first / all / run / batch / exec。
 * - bind 值做归一：true/false → 1/0，undefined → null
 * - batch 在一个事务里顺序执行
 */

type SqliteValue = string | number | bigint | Buffer | null

function normalize(value: unknown): SqliteValue {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Uint8Array) return Buffer.from(value)
  return value as SqliteValue
}

class Statement implements DbStatement {
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new Statement(this.db, this.sql, values.map(normalize))
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined
    return row ?? null
  }

  async all<T = unknown>(): Promise<DbResult<T> & { results: T[] }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[]
    return { results, success: true, meta: {} }
  }

  async run<T = unknown>(): Promise<DbResult<T>> {
    return this.runSync() as DbResult<T>
  }

  /** batch 事务内使用（同步） */
  runSync(): DbResult {
    const info = this.db.prepare(this.sql).run(...this.params)
    return {
      success: true,
      meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes },
    }
  }
}

export class SqliteDb implements Db {
  constructor(private readonly raw: Database.Database) {}

  /** 供调度器/关停使用 */
  get database(): Database.Database {
    return this.raw
  }

  prepare(query: string): DbStatement {
    return new Statement(this.raw, query)
  }

  async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
    const stmts = statements as Statement[]
    const runAll = this.raw.transaction(() => stmts.map((s) => s.runSync()))
    return runAll() as DbResult<T>[]
  }

  async exec(query: string): Promise<unknown> {
    return this.raw.exec(query)
  }

  close(): void {
    this.raw.close()
  }
}
