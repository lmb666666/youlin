import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { applyMigrations } from '../src/server/migrations'
import { loadDotEnv } from '../src/server/env'

/** 本地示例数据：应用迁移后执行幂等的 scripts/seed.sql */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(path.join(root, '.env'))
const dbPath = process.env.DB_PATH ?? 'data/youlin.db'

fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')

const migration = applyMigrations(db, path.join(root, 'migrations'))
const seed = fs.readFileSync(path.join(root, 'scripts', 'seed.sql'), 'utf8')
db.exec(seed)
db.close()

console.log(`[seed] ${dbPath}：应用 ${migration.applied.length} 个迁移，示例数据已写入（幂等）`)
