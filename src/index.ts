import { Hono } from 'hono'
import type { AppEnv, Env } from './types'
import { loadConfig } from './config/loader'
import { publicRoutes } from './routes/links'
import { adminRoutes } from './routes/admin'

const app = new Hono<AppEnv>()

// 每请求装配配置（默认值 ← settings 表 ← 环境变量覆盖，见 DESIGN §9）
app.use('/api/*', async (c, next) => {
  const { cfg } = await loadConfig(c.env.DB, c.env)
  c.set('cfg', cfg)
  await next()
})

app.route('/', publicRoutes())
app.route('/', adminRoutes())

// /api/* 之外交给 Static Assets（wrangler assets 配置），这里不需要兜底路由
app.notFound((c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404))

app.onError((err, c) => {
  console.error('[youlin] unhandled error:', err instanceof Error ? err.stack : err)
  return c.json({ error: { code: 'internal', message: '服务器内部错误' } }, 500)
})

export default {
  fetch: app.fetch,
  // P1：Cron 分批轮转抓取（DESIGN §6）。P0 先占位，保证部署配置完整。
  async scheduled(_event: unknown, _env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(Promise.resolve())
  },
} satisfies ExportedHandler<Env>
