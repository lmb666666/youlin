import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { app } from '../src/app'
import { setConfigCacheMs } from '../src/config/loader'
import { SqliteD1 } from '../src/server/db'
import { createEnv } from '../src/server/env'
import { applyMigrations } from '../src/server/migrations'

/**
 * Node 测试 harness：每个测试文件独立一个内存 SQLite，迁移与生产一致。
 * `SELF.fetch` 直接走 Hono 的 app.request，不监听端口。
 */

process.env.ADMIN_TOKEN ??= 'test-admin-token'
process.env.TURNSTILE_SECRET ??= 'test-turnstile-secret'
process.env.GITHUB_PAT ??= 'test-github-pat'
process.env.WEBDAV_PASSWORD ??= 'davpass'

// 测试里直接写 settings 表，关闭配置缓存，避免用例间读到旧值
setConfigCacheMs(0)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = new Database(':memory:')
raw.pragma('foreign_keys = ON')
applyMigrations(raw, path.join(ROOT, 'migrations'))

export const env = createEnv(new SqliteD1(raw))

export const SELF = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return app.request(new Request(input, init), undefined, env)
  },
}
