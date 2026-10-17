import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import Database from 'better-sqlite3'
import { app } from '../app'
import { loadConfig } from '../config/loader'
import { runScheduledJobs } from '../jobs'
import { createFetchHandler } from './assets'
import { SqliteD1 } from './db'
import { createEnv, loadDotEnv } from './env'
import { applyMigrations } from './migrations'

/**
 * Node 运行时入口：HTTP 服务 + 静态资源 + 定时作业。
 *
 * 环境变量：PORT / HOST / DB_PATH / WEB_ROOT / MIGRATIONS_DIR /
 *           CRON_ENABLED / CRON_INTERVAL_SECONDS / ADMIN_TOKEN（必填）/
 *           TURNSTILE_SECRET / GITHUB_PAT / WEBDAV_PASSWORD / YOULIN_CONFIG_OVERRIDES
 */

loadDotEnv()

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const DB_PATH = process.env.DB_PATH ?? 'data/youlin.db'
const WEB_ROOT = process.env.WEB_ROOT ?? 'web/dist'
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? 'migrations'
const CRON_ENABLED = process.env.CRON_ENABLED !== 'false'
const CRON_INTERVAL_SECONDS = Math.max(30, Number(process.env.CRON_INTERVAL_SECONDS ?? 300))

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true })

const raw = new Database(DB_PATH)
raw.pragma('journal_mode = WAL')
raw.pragma('synchronous = NORMAL')
raw.pragma('busy_timeout = 5000')
raw.pragma('foreign_keys = ON')

const migration = applyMigrations(raw, MIGRATIONS_DIR)
console.log(`[db] ${DB_PATH}：应用 ${migration.applied.length} 个迁移，跳过 ${migration.skipped} 个`)

const db = new SqliteD1(raw)
const env = createEnv(db)
const handler = createFetchHandler(WEB_ROOT, (req, e) => app.fetch(req, e, undefined))

const server = serve({ fetch: (request) => handler(request, env), port: PORT, hostname: HOST }, (info) => {
  console.log(`[youlin] listening on http://${HOST}:${info.port}`)
  console.log(`[youlin] 静态资源目录 ${path.resolve(WEB_ROOT)}`)
})

let running = false
async function tick(): Promise<void> {
  if (running) {
    console.warn('[cron] 上一轮尚未结束，跳过本次')
    return
  }
  running = true
  try {
    const { cfg } = await loadConfig(env.DB, env)
    const summary = await runScheduledJobs(env.DB, env, cfg)
    console.log('[cron] tick:', JSON.stringify({ crawl: summary.crawl, backup: summary.backup?.status ?? null }))
  } catch (err) {
    console.error('[cron] 失败:', err instanceof Error ? err.stack : err)
  } finally {
    running = false
  }
}

if (CRON_ENABLED) {
  // 首次稍作延迟，避免与启动时的迁移/连接争抢
  setTimeout(() => void tick(), 5_000).unref()
  setInterval(() => void tick(), CRON_INTERVAL_SECONDS * 1000).unref()
  console.log(`[cron] 已启用，每 ${CRON_INTERVAL_SECONDS}s 检查一次`)
} else {
  console.log('[cron] 已禁用（CRON_ENABLED=false）')
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[youlin] 收到 ${sig}，正在关闭`)
    server.close(() => {
      db.close()
      process.exit(0)
    })
    setTimeout(() => {
      db.close()
      process.exit(0)
    }, 5_000).unref()
  })
}
