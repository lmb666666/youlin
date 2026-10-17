import { Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv } from './types'
import { loadConfig } from './config/loader'
import { isMissingTableError } from './util/http'
import { publicRoutes } from './routes/links'
import { publicCircleRoute } from './routes/circle'
import { applyRoutes } from './routes/apply'
import { adminRoutes } from './routes/admin'

/**
 * Hono 应用装配（两个运行时共用）
 *   Workers：src/index.ts 导出 fetch + scheduled，静态资源由 wrangler assets 托管
 *   Node：src/server/main.ts 起 HTTP 服务，静态资源与 SPA fallback 由 assets.ts 处理
 */

export const app = new Hono<AppEnv>()

// 每请求装配配置（默认值 ← settings 表 ← 环境变量覆盖，见 DESIGN §9）
// 注意 /apply（申请接口）同样需要配置（文案、开关、Turnstile）
const withConfig: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { cfg } = await loadConfig(c.env.DB, c.env)
  c.set('cfg', cfg)
  await next()
}
app.use('/api/*', withConfig)
app.use('/apply', withConfig)

app.route('/', publicRoutes())
app.route('/', publicCircleRoute())
app.route('/', applyRoutes())
app.route('/', adminRoutes())

// 静态资源之外的未知路径：JSON 404（Workers 由 assets 兜底；Node 由 assets.ts 兜底 HTML）
app.notFound((c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404))

app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err)
  // 一键部署常见首因：Worker 已上线但 D1 迁移尚未执行 → 给出可操作的指引而不是裸 500
  if (isMissingTableError(msg)) {
    return c.json(
      {
        error: {
          code: 'database_not_migrated',
          message: '数据库尚未初始化：请运行 `wrangler d1 migrations apply DB --remote`，或在 Workers Builds 中将部署命令设为 `npm run deploy` 后重新部署',
        },
      },
      503,
    )
  }
  console.error('[youlin] unhandled error:', err instanceof Error ? err.stack : err)
  return c.json({ error: { code: 'internal', message: '服务器内部错误' } }, 500)
})
