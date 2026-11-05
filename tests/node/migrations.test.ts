import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { applyMigrations } from '../../src/server/migrations'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MIGRATIONS = path.join(ROOT, 'migrations')

describe('迁移边界', () => {
  it('0003 去重时不会撞上已有的「名称 #id」分组', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youlin-mig-'))
    const db = new Database(':memory:')
    try {
      fs.copyFileSync(path.join(MIGRATIONS, '0001_init.sql'), path.join(dir, '0001_init.sql'))
      fs.copyFileSync(path.join(MIGRATIONS, '0002_apply_rate_limit.sql'), path.join(dir, '0002_apply_rate_limit.sql'))
      applyMigrations(db, dir)

      db.prepare("INSERT INTO groups (name, sort) VALUES ('X', 0), ('X', 0), ('X #2', 0)").run()
      fs.copyFileSync(path.join(MIGRATIONS, '0003_group_name_unique.sql'), path.join(dir, '0003_group_name_unique.sql'))
      expect(() => applyMigrations(db, dir)).not.toThrow()

      const names = db.prepare('SELECT name FROM groups ORDER BY id').all() as { name: string }[]
      expect(names).toHaveLength(3)
      expect(new Set(names.map((n) => n.name)).size).toBe(3)
      expect(names[0]!.name).toBe('X')
    } finally {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('0005 合并重复 pending 链接后再建唯一索引', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youlin-mig-'))
    const db = new Database(':memory:')
    try {
      for (const file of ['0001_init.sql', '0002_apply_rate_limit.sql', '0003_group_name_unique.sql', '0004_login_attempts.sql']) {
        fs.copyFileSync(path.join(MIGRATIONS, file), path.join(dir, file))
      }
      applyMigrations(db, dir)
      db.prepare("INSERT INTO applications (site_name, link, status) VALUES ('A', 'https://dup.example.com/', 'pending'), ('B', 'https://dup.example.com/', 'pending')").run()
      fs.copyFileSync(path.join(MIGRATIONS, '0005_pending_application_link_unique.sql'), path.join(dir, '0005_pending_application_link_unique.sql'))
      expect(() => applyMigrations(db, dir)).not.toThrow()
      const pending = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'pending'").get() as { n: number }
      expect(pending.n).toBe(1)
    } finally {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
