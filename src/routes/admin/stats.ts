import { Hono } from 'hono'
import { adminStatsView } from '../../services/stats'
import type { AppEnv } from '../../types'

/** 总览台聚合数据 */
export function statsRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/stats', (c) => c.json(adminStatsView(c.env.DB)))

  return app
}
