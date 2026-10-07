import { Hono } from 'hono'
import { isoUtc } from '../../util/time'
import type { AppEnv } from '../../types'

/** 总览台聚合数据（一次查询出全部计数，避免前端拼多个接口） */
export function statsRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/stats', async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM friends WHERE status = 'active') AS friends_active,
         (SELECT COUNT(*) FROM friends WHERE status = 'hidden') AS friends_hidden,
         (SELECT COUNT(*) FROM friends WHERE status = 'active' AND in_circle = 1 AND feed IS NOT NULL) AS circle_sources,
         (SELECT COUNT(*) FROM articles) AS articles,
         (SELECT MAX(a.fetched_at) FROM articles a) AS last_article_at,
         (SELECT COUNT(*) FROM applications WHERE status = 'pending') AS applications_pending,
         (SELECT COUNT(*) FROM applications) AS applications_total,
         (SELECT COUNT(*) FROM friends f LEFT JOIN source_state s ON s.friend_id = f.id
            WHERE f.status = 'active' AND s.reachable = 0) AS friends_unreachable,
         (SELECT COUNT(*) FROM friends f LEFT JOIN source_state s ON s.friend_id = f.id
            WHERE f.status = 'active' AND (s.next_check_at IS NULL OR s.next_check_at <= datetime('now'))) AS sources_due`,
    ).first<{
      friends_active: number
      friends_hidden: number
      circle_sources: number
      articles: number
      last_article_at: string | null
      applications_pending: number
      applications_total: number
      friends_unreachable: number
      sources_due: number
    }>()

    return c.json({
      friends: { active: row?.friends_active ?? 0, hidden: row?.friends_hidden ?? 0, unreachable: row?.friends_unreachable ?? 0 },
      circle: { sources: row?.circle_sources ?? 0, due: row?.sources_due ?? 0 },
      articles: { total: row?.articles ?? 0, lastArticleAt: isoUtc(row?.last_article_at) ?? null },
      applications: { pending: row?.applications_pending ?? 0, total: row?.applications_total ?? 0 },
    })
  })

  return app
}
