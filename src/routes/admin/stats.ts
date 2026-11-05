import { Hono } from 'hono'
import { isoUtc } from '../../util/time'
import { adminStats } from '../../repositories/stats'
import type { AppEnv } from '../../types'

/** 总览台聚合数据 */
export function statsRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/stats', async (c) => {
    const s = adminStats(c.env.DB)
    return c.json({
      friends: { active: s.friendsActive, hidden: s.friendsHidden, unreachable: s.friendsUnreachable },
      circle: { sources: s.circleSources, due: s.sourcesDue },
      articles: { total: s.articles, lastArticleAt: isoUtc(s.lastArticleAt) ?? null },
      applications: { pending: s.applicationsPending, total: s.applicationsTotal },
    })
  })

  return app
}
