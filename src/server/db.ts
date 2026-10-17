import Database from 'better-sqlite3'
import type { D1DatabaseLike, D1PreparedStatement, D1Result } from '../types'

/**
 * D1 兼容层：把 better-sqlite3 的同步 API 包成 D1 的异步形状。
 *
 * 只实现项目实际用到的子集：prepare / bind / first / all / run / batch / exec。
 * - bind 值做归一：true/false → 1/0，undefined → null（D1 不接受前两者）
 * - batch 在一个事务里顺序执行，语义与 D1 的 batch 一致
 */

type SqliteValue = string | number | bigint | Buffer | null

function normalize(value: unknown): SqliteValue {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Uint8Array) return Buffer.from(value)
  return value as SqliteValue
}

class Statement implements D1PreparedStatement {
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(this.db, this.sql, values.map(normalize))
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined
    return row ?? null
  }

  async all<T = unknown>(): Promise<D1Result<T> & { results: T[] }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[]
    return { results, success: true, meta: {} }
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.runSync() as D1Result<T>
  }

  /** batch 事务内使用（同步） */
  runSync(): D1Result {
    const info = this.db.prepare(this.sql).run(...this.params)
    return {
      success: true,
      meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes },
    }
  }
}

export class SqliteD1 implements D1DatabaseLike {
  constructor(private readonly raw: Database.Database) {}

  /** 供调度器/关停使用 */
  get database(): Database.Database {
    return this.raw
  }

  prepare(query: string): D1PreparedStatement {
    return new Statement(this.raw, query)
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const stmts = statements as Statement[]
    const runAll = this.raw.transaction(() => stmts.map((s) => s.runSync()))
    return runAll() as D1Result<T>[]
  }

  async exec(query: string): Promise<unknown> {
    return this.raw.exec(query)
  }

  close(): void {
    this.raw.close()
  }
}
