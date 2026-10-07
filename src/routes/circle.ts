import { Hono } from 'hono'
import { isoUtc } from '../util/time'
import { corsHeaders } from './links'
import type { AppEnv } from '../types'

/**
 * 朋友圈接口（DESIGN §4.2）
 *   GET /api/circle            stats + articles（默认截到 crawl.outputMaxArticles）
 *   GET /api/circle?limit=N    再截断（上限 api.maxLimit）
 * 统计口径见 internal/DECISIONS.md D17：基于"参与朋友圈"的全集，而非截断后的输出。
 */

export function publicCircleRoute() {
  const app = new Hono<AppEnv>()

  app.get('/api/circle', async (c) => {
    const cfg = c.get('cfg')

    const gate = `f.status = 'active' AND f.in_circle = 1`
    const participating = `${gate} AND f.feed IS NOT NULL`

    const statsRow = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM friends f
            WHERE ${participating}) AS friends,
         (SELECT COUNT(*) FROM friends f LEFT JOIN source_state s ON s.friend_id = f.id
            WHERE ${participating} AND (s.reachable = 0 OR s.crawlable = 0)) AS failed,
         (SELECT COUNT(DISTINCT a.friend_id) FROM articles a JOIN friends f ON f.id = a.friend_id
            WHERE ${gate}) AS active,
         (SELECT COUNT(*) FROM articles a JOIN friends f ON f.id = a.friend_id
            WHERE ${gate}) AS articles,
         (SELECT MAX(a.fetched_at) FROM articles a JOIN friends f ON f.id = a.friend_id
            WHERE ${gate}) AS updated_at`,
    ).first<{ friends: number; failed: number; active: number; articles: number; updated_at: string | null }>()

    const requested = Number(c.req.query('limit'))
    const cap = Math.min(cfg.crawl.outputMaxArticles, cfg.api.maxLimit)
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, cap) : cap

    const articleRows = await c.env.DB.prepare(
      `SELECT a.title, a.link, a.author, a.published_at, f.avatar
         FROM articles a JOIN friends f ON f.id = a.friend_id
        WHERE ${gate}
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT ?`,
    )
      .bind(limit)
      .all<{ title: string; link: string; author: string | null; published_at: string; avatar: string | null }>()

    const updatedAt = isoUtc(statsRow?.updated_at)
    return c.json(
      {
        stats: {
          friends: statsRow?.friends ?? 0,
          active: statsRow?.active ?? 0,
          failed: statsRow?.failed ?? 0,
          articles: statsRow?.articles ?? 0,
          updatedAt: updatedAt ?? null,
        },
        articles: articleRows.results.map((a) => {
          const out: { title: string; link: string; author?: string; avatar?: string; publishedAt: string } = {
            title: a.title,
            link: a.link,
            publishedAt: isoUtc(a.published_at) ?? a.published_at,
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
