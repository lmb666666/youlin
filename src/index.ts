import type { ScheduledController, ExecutionContext, ExportedHandler } from '@cloudflare/workers-types'
import { app } from './app'
import { loadConfig } from './config/loader'
import { runScheduledJobs } from './jobs'
import type { Env } from './types'

/**
 * Cloudflare Workers 入口（wrangler.jsonc 的 main）。
 * 静态资源由 wrangler assets 托管，这里只处理 /api/*、/apply、/healthz。
 */
export default {
  fetch: app.fetch,
  // Cron（DESIGN §6）：每 5 分钟取最久未检查的 batchSize 个源，顺带检查自动备份是否到点。
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const { cfg } = await loadConfig(env.DB, env)
        const summary = await runScheduledJobs(env.DB, env, cfg)
        console.log('[cron] tick:', JSON.stringify({ crawl: summary.crawl, backup: summary.backup?.status ?? null }))
      })(),
    )
  },
} satisfies ExportedHandler<Env>
