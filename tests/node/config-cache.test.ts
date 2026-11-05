import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SqliteDb } from '../../src/server/db'
import { applyMigrations } from '../../src/server/migrations'
import { invalidateConfigCache, loadFlatSettings, setConfigCacheMs } from '../../src/config/loader'
import type { Env } from '../../src/types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('配置读取缓存', () => {
  it('TTL 内复用，invalidate 后重新读', async () => {
    setConfigCacheMs(1_000)
    const raw = new Database(':memory:')
    applyMigrations(raw, path.join(ROOT, 'migrations'))
    const base = new SqliteDb(raw)
    let selects = 0
    const db = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (query: string) => {
            if (/SELECT key, value FROM settings/.test(query)) selects++
            return target.prepare(query)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as SqliteDb
    const env = { YOULIN_CONFIG_OVERRIDES: '' } as Env

    try {
      await loadFlatSettings(db, env)
      await loadFlatSettings(db, env)
      expect(selects).toBe(1)

      invalidateConfigCache()
      await loadFlatSettings(db, env)
      expect(selects).toBe(2)
    } finally {
      setConfigCacheMs(0)
      base.close()
    }
  })
})
