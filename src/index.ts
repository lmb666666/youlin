import { Hono } from 'hono'
import type { AppEnv, Env } from './types'
import { loadConfig } from './config/loader'
import { publicRoutes } from './routes/links'
import { publicCircleRoute } from './routes/circle'
import { adminRoutes } from './routes/admin'
import { runCronTick } from './crawler/crawl'

const app = new Hono<AppEnv>()

// 每请求装配配置（默认值 ← settings 表 ← 环境变量覆盖，见 DESIGN §9）
app.use('/api/*', async (c, next) => {
  const { cfg } = await loadConfig(c.env.DB, c.env)
  c.set('cfg', cfg)
  await next()
})

app.route('/', publicRoutes())
app.route('/', publicCircleRoute())
app.route('/', adminRoutes())

// /api/* 之外交给 Static Assets（wrangler assets 配置），这里不需要兜底路由
app.notFound((c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404))

app.onError((err, c) => {
  console.error('[youlin] unhandled error:', err instanceof Error ? err.stack : err)
  return c.json({ error: { code: 'internal', message: '服务器内部错误' } }, 500)
})

export default {
  fetch: app.fetch,
  // Cron 抓取（DESIGN §6）：每 5 分钟取最久未检查的 batchSize 个源，
  // 条件请求 + 增量 upsert + 每日清理，单次远低于免费版 10ms CPU。
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const { cfg } = await loadConfig(env.DB, env)
        const summary = await runCronTick(env.DB, env, cfg)
        console.log('[cron] tick:', JSON.stringify(summary))
      })(),
    )
  },
} satisfies ExportedHandler<Env>
