import { Hono } from 'hono'
import { isoUtc } from '../util/time'
import { corsHeaders } from './links'
import { circleStats, listCircleArticles } from '../repositories/articles'
import type { AppEnv } from '../types'

/**
 * 朋友圈接口（DESIGN §4.2）
 *   GET /api/circle            stats + articles（默认截到 crawl.outputMaxArticles）
 *   GET /api/circle?limit=N    再截断（上限 api.maxLimit）
 * 统计口径：基于"参与朋友圈"的全集，而非截断后的输出。
 */

export function publicCircleRoute() {
  const app = new Hono<AppEnv>()

  app.get('/api/circle', async (c) => {
    const cfg = c.get('cfg')
    const stats = circleStats(c.env.DB)

    const requested = Number(c.req.query('limit'))
    const cap = Math.min(cfg.crawl.outputMaxArticles, cfg.api.maxLimit)
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, cap) : cap
    const articles = listCircleArticles(c.env.DB, limit)

    return c.json(
      {
        stats: {
          friends: stats.friends,
          active: stats.active,
          failed: stats.failed,
          articles: stats.articles,
          updatedAt: isoUtc(stats.updatedAt) ?? null,
        },
        articles: articles.map((a) => {
          const out: { title: string; link: string; author?: string; avatar?: string; publishedAt: string } = {
            title: a.title,
            link: a.link,
            publishedAt: isoUtc(a.publishedAt) ?? a.publishedAt,
          }
          if (a.author) out.author = a.author
          if (a.avatar) out.avatar = a.avatar
          return out
        }),
      },
      200,
      {
        ...corsHeaders(cfg),
        'Cache-Control': `public, max-age=${cfg.api.cacheSeconds}`,
      },
    )
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
