import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

/**
 * 迁移执行器：读 migrations/*.sql 按文件名顺序执行，记录到 d1_migrations。
 *
 * 表名沿用历史命名，保证已有 Docker 数据库升级时不会重复建表；
 * 已应用的迁移不会重复执行。
 */

const TABLE = 'd1_migrations'

export interface MigrationResult {
  applied: string[]
  skipped: number
}

export function applyMigrations(db: Database.Database, dir: string): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL UNIQUE,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  )
  const done = new Set(
    (db.prepare(`SELECT name FROM ${TABLE}`).all() as { name: string }[]).map((r) => r.name),
  )
  if (!fs.existsSync(dir)) throw new Error(`迁移目录不存在：${dir}`)

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const applied: string[] = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    const run = db.transaction(() => {
      db.exec(sql)
      db.prepare(`INSERT INTO ${TABLE} (name) VALUES (?)`).run(file)
    })
    try {
      run()
      applied.push(file)
    } catch (err) {
      // 并发首启：另一实例可能已应用同一迁移（事务已回滚，记录在对方名下）；
      // 重读确认后跳过，否则原样抛出阻止启动
      const doneNow = new Set(
        (db.prepare(`SELECT name FROM ${TABLE}`).all() as { name: string }[]).map((r) => r.name),
      )
      if (!doneNow.has(file)) throw err
    }
  }
  return { applied, skipped: files.length - applied.length }
}
