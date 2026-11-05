import { Hono } from 'hono'
import { publicCircle } from '../services/public'
import { corsHeaders } from '../util/cors'
import type { AppEnv } from '../types'

/**
 * 朋友圈接口（DESIGN §4.2）
 *   GET /api/circle            stats + articles（默认截到 crawl.outputMaxArticles）
 *   GET /api/circle?limit=N    再截断（上限 api.maxLimit）
 * 统计口径：基于"参与朋友圈"的全集，而非截断后的输出。
 */

export function publicCircleRoute() {
  const app = new Hono<AppEnv>()

  app.get('/api/circle', (c) => {
    const cfg = c.get('cfg')
    return c.json(publicCircle(c.env.DB, cfg, c.req.query('limit')), 200, {
      ...corsHeaders(cfg),
      'Cache-Control': `public, max-age=${cfg.api.cacheSeconds}`,
    })
  })

  app.options('/api/circle', (c) => {
    const cfg = c.get('cfg')
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(cfg), 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    })
  })

  return app
}
