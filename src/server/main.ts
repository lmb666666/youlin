import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import Database from 'better-sqlite3'
import { app } from '../app'
import { loadConfig } from '../config/loader'
import { runScheduledJobs } from '../jobs'
import { createFetchHandler } from './assets'
import { SqliteDb } from './db'
import { createEnv, loadDotEnv } from './env'
import { applyMigrations } from './migrations'
import { acquireLock, releaseLock, renewLock } from '../repositories/locks'
import { SCHEDULER_LOCK_KEY, SCHEDULER_LOCK_RENEW_MS, SCHEDULER_LOCK_TTL_MS } from './scheduler-lock'
import { logger, resolveLogLevel } from '../log'
import type { Env } from '../types'

/**
 * Node 运行时入口：HTTP 服务 + 静态资源 + 定时作业。
 *
 * 环境变量：PORT / HOST / DB_PATH / WEB_ROOT / MIGRATIONS_DIR /
 *           CRON_ENABLED / CRON_INTERVAL_SECONDS / LOG_LEVEL / TRUST_PROXY / ADMIN_TOKEN（必填）/
 *           TURNSTILE_SECRET / GITHUB_PAT / WEBDAV_PASSWORD / YOULIN_CONFIG_OVERRIDES
 */

loadDotEnv()
logger.level = resolveLogLevel()

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const DB_PATH = process.env.DB_PATH ?? 'data/youlin.db'
const WEB_ROOT = process.env.WEB_ROOT ?? 'web/dist'
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? 'migrations'
const CRON_ENABLED = process.env.CRON_ENABLED !== 'false'
const parsedInterval = Number(process.env.CRON_INTERVAL_SECONDS ?? 300)
const CRON_INTERVAL_SECONDS = Number.isFinite(parsedInterval) ? Math.max(30, parsedInterval) : 300

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true })

const raw = new Database(DB_PATH)
raw.pragma('journal_mode = WAL')
raw.pragma('synchronous = NORMAL')
raw.pragma('busy_timeout = 5000')
raw.pragma('foreign_keys = ON')

const migration = applyMigrations(raw, MIGRATIONS_DIR)
logger.info({ dbPath: DB_PATH, applied: migration.applied.length, skipped: migration.skipped }, 'database migrations applied')

const db = new SqliteDb(raw)
const env = createEnv(db)
const handler = createFetchHandler(WEB_ROOT, (req, e) => app.fetch(req, e, undefined))

const server = serve(
  {
    // 把 @hono/node-server 的 incoming 带进应用 Env，clientIp 才能在 Node 上取到真实 socket 地址
    fetch: (request, nodeEnv) => handler(request, { ...env, incoming: nodeEnv.incoming } as Env),
    port: PORT,
    hostname: HOST,
  },
  (info) => {
    logger.info({ url: `http://${HOST}:${info.port}`, webRoot: path.resolve(WEB_ROOT) }, 'youlin listening')
  },
)

let running = false
let schedulerLockOwner: string | null = null
async function tick(): Promise<void> {
  if (running) {
    logger.debug('scheduler tick skipped: previous tick still running')
    return
  }
  running = true
  const owner = randomUUID()
  let locked = false
  try {
    locked = await acquireLock(env.DB, SCHEDULER_LOCK_KEY, owner, SCHEDULER_LOCK_TTL_MS)
    if (!locked) {
      logger.debug('scheduler tick skipped: lock held by another instance')
      return
    }
    schedulerLockOwner = owner
    const heartbeat = setInterval(() => {
      void renewLock(env.DB, SCHEDULER_LOCK_KEY, owner, SCHEDULER_LOCK_TTL_MS)
        .then((ok) => {
          if (!ok) logger.warn({ owner }, 'scheduler lock lost before tick finished')
        })
        .catch((err) => logger.warn({ err }, 'scheduler lock renew failed'))
    }, SCHEDULER_LOCK_RENEW_MS)
    try {
      const { cfg } = await loadConfig(env.DB, env)
      const summary = await runScheduledJobs(env.DB, env, cfg)
      logger.info({ crawl: summary.crawl, backup: summary.backup?.status ?? null }, 'scheduler tick completed')
    } finally {
      clearInterval(heartbeat)
    }
  } catch (err) {
    logger.error({ err }, 'scheduler tick failed')
  } finally {
    if (locked) {
      await releaseLock(env.DB, SCHEDULER_LOCK_KEY, owner).catch((err) => {
        logger.warn({ err }, 'scheduler lock release failed')
      })
      if (schedulerLockOwner === owner) schedulerLockOwner = null
    }
    running = false
  }
}

let tickPromise: Promise<void> | null = null
function runTick(): void {
  if (tickPromise || shuttingDown) return
  tickPromise = tick().finally(() => {
    tickPromise = null
  })
}

if (CRON_ENABLED) {
  // 首次稍作延迟，避免与启动时的迁移/连接争抢
  setTimeout(runTick, 5_000).unref()
  setInterval(runTick, CRON_INTERVAL_SECONDS * 1000).unref()
  logger.info({ intervalSeconds: CRON_INTERVAL_SECONDS }, 'scheduler enabled')
} else {
  logger.info('scheduler disabled (CRON_ENABLED=false)')
}

// 常驻服务：单个后台任务漏网不该让整个实例退出（错误仍完整记录）
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection')
})

let shuttingDown = false
async function shutdown(sig: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal: sig }, 'shutting down')
  // 给进行中的 tick 一点收尾时间；超时则按进程退出来保证部署不长时间卡住
  if (tickPromise) {
    await Promise.race([tickPromise, new Promise((resolve) => setTimeout(resolve, 4_000))])
  }
  // 部署重启时尽快释放调度锁，避免新实例空等 TTL
  if (schedulerLockOwner) {
    const owner = schedulerLockOwner
    schedulerLockOwner = null
    await releaseLock(env.DB, SCHEDULER_LOCK_KEY, owner).catch((err) => {
      logger.warn({ err }, 'scheduler lock release on shutdown failed')
    })
  }
  server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => {
    db.close()
    process.exit(0)
  }, 5_000).unref()
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => void shutdown(sig))
}
