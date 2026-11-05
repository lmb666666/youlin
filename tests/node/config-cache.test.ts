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
    const env = { YOULIN_CONFIG_OVERRIDES: '' } as Env

    try {
      const initial = await loadFlatSettings(base, env)
      expect(initial['site.name']).toBe('我的博客')

      raw.prepare("INSERT INTO settings (key, value) VALUES ('site.name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify('缓存测试'))

      const cached = await loadFlatSettings(base, env)
      expect(cached['site.name']).toBe('我的博客')

      invalidateConfigCache()
      const fresh = await loadFlatSettings(base, env)
      expect(fresh['site.name']).toBe('缓存测试')
    } finally {
      setConfigCacheMs(0)
      base.close()
    }
  })
})
