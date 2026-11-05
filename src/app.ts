import { Hono, type MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './types'
import { loadConfig } from './config/loader'
import { isMissingTableError } from './util/http'
import { AppError } from './errors'
import { corsHeaders } from './util/cors'
import type { AppConfig } from './types'
import { publicRoutes } from './routes/links'
import { publicCircleRoute } from './routes/circle'
import { applyRoutes } from './routes/apply'
import { adminRoutes } from './routes/admin'

/**
 * Hono 应用装配（Node 运行时）
 *   src/server/main.ts 起 HTTP 服务，静态资源与 SPA fallback 由 assets.ts 处理
 */

export const app = new Hono<AppEnv>()

// 基础安全响应头（静态资源由 assets.ts 单独处理）
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Content-Security-Policy', "frame-ancestors 'none'")
})

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

// 尾斜杠统一回到申请页
app.get('/apply/', (c) => c.redirect('/apply', 308))

// 静态资源之外的未知路径：JSON 404（页面路径由 assets.ts 兜底 HTML）
app.notFound((c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404))

/** 错误响应也带上与成功响应一致的安全头（中间件在异常路径上不会执行到这里） */
function errorJson(c: Parameters<Parameters<typeof app.onError>[0]>[1], status: ContentfulStatusCode, body: unknown): Response {
  const res = c.json(body as Record<string, unknown>, status)
  if (c.req.path.startsWith('/api/admin/')) res.headers.set('Cache-Control', 'no-store')
  const cfg = c.get('cfg') as AppConfig | undefined
  if (cfg && (c.req.path === '/apply' || c.req.path.startsWith('/api/links') || c.req.path.startsWith('/api/circle'))) {
    for (const [k, v] of Object.entries(corsHeaders(cfg))) res.headers.set(k, v)
  }
  return res
}

app.onError((err, c) => {
  if (err instanceof AppError) {
    return errorJson(c, err.status as ContentfulStatusCode, {
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  // 启动时迁移失败或数据库文件不可写 → 给出可操作的指引而不是裸 500
  if (isMissingTableError(msg)) {
    return errorJson(c, 503, {
      error: {
        code: 'database_not_migrated',
        message: '数据库尚未初始化：请检查 /data 卷权限，并确认容器启动日志中的迁移结果；本地可删除 data/youlin.db 后重启',
      },
    })
  }
  console.error('[youlin] unhandled error:', err instanceof Error ? err.stack : err)
  return errorJson(c, 500, { error: { code: 'internal', message: '服务器内部错误' } })
})
