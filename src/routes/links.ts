import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { publicLinks } from '../services/public'
import { pingDatabase } from '../repositories/health'
import { corsHeaders } from '../util/cors'

/**
 * 友链数据接口（DESIGN §4.1）
 *   GET /api/links           全部分组
 *   GET /api/links?group=X   按分组名过滤（精确匹配）
 */

export function publicRoutes() {
  const app = new Hono<AppEnv>()

  // 健康检查：供 uptime 监控；附带数据库可达性
  app.get('/healthz', (c) => {
    const db = pingDatabase(c.env.DB)
    return c.json(
      { ok: db, db },
      db ? 200 : 503,
      { 'Cache-Control': 'no-store' },
    )
  })

  app.get('/api/links', (c) => {
    const cfg = c.get('cfg')
    return c.json(publicLinks(c.env.DB, cfg, c.req.query('group')), 200, {
      ...corsHeaders(cfg),
      'Cache-Control': `public, max-age=${cfg.api.cacheSeconds}`,
    })
  })

  app.options('/api/links', (c) => {
    const cfg = c.get('cfg')
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(cfg), 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    })
  })

  return app
}
